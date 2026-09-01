import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import dotenv from "dotenv";
import { FinancialMetrics, SectorBenchmarks, AssessmentScores, AssessmentRun } from "./src/types";
import { db } from "./src/db/index.ts";
import { assessments } from "./src/db/schema.ts";
import { requireAuth, optionalAuth, AuthRequest } from "./src/middleware/auth.ts";
import { eq } from "drizzle-orm";

dotenv.config();

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://127.0.0.1:8000";
const RAG_SERVICE_TIMEOUT = parseInt(process.env.RAG_SERVICE_TIMEOUT || "60000", 10);
console.log(`[RAG Config] Service URL: ${RAG_SERVICE_URL}, Timeout: ${RAG_SERVICE_TIMEOUT}ms`);

// Spawn Python FastAPI RAG Microservice
let ragProcess: any = null;
function startRAGService() {
  const venvPython = path.join(process.cwd(), "rag_service", "venv", "bin", "python");
  const mainPy = path.join(process.cwd(), "rag_service", "main.py");

  if (!fs.existsSync(venvPython)) {
    console.warn("[RAG Service] Virtualenv python not found at:", venvPython);
    return;
  }

  console.log("[RAG Service] Starting Python FastAPI RAG engine on port 8000...");
  const ragEnv = { ...process.env };
  delete ragEnv.PORT;
  ragEnv.RAG_PORT = "8000";

  ragProcess = spawn(venvPython, [mainPy], {
    env: ragEnv,
    stdio: "inherit",
  });

  ragProcess.on("error", (err: any) => {
    console.error("[RAG Service] Failed to spawn Python RAG engine:", err);
  });

  ragProcess.on("exit", (code: number) => {
    console.log(`[RAG Service] Process exited with code ${code}`);
  });
}

// Graceful cleanup on server termination
process.on("SIGINT", () => {
  if (ragProcess) {
    try {
      ragProcess.kill();
    } catch (_) {}
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (ragProcess) {
    try {
      ragProcess.kill();
    } catch (_) {}
  }
  process.exit(0);
});

startRAGService();

const app = express();
const PORT = 3000;

// Memory stores for guest security & rate limiting
const guestDocumentIds = new Set<string>();
const guestRateLimiter = new Map<string, { count: number; resetTime: number }>();

function checkGuestRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = guestRateLimiter.get(ip);
  if (!record || now > record.resetTime) {
    guestRateLimiter.set(ip, { count: 1, resetTime: now + 15 * 60 * 1000 });
    return true;
  }
  if (record.count >= 10) {
    return false; // Limit exceeded: 10 requests per 15 min per IP
  }
  record.count++;
  return true;
}

// Setup in-memory file upload middleware (max 15MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Multer error handling middleware wrapper
const handleUpload = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  upload.single("file")(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File size exceeds the 15 MB limit." });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next();
  });
};

app.use(express.json({ limit: "2mb" }));

// Server-side File Validation Helper
function validateUploadedFile(file?: Express.Multer.File): { valid: boolean; error?: string; isPDF: boolean; isCSV: boolean } {
  if (!file || !file.buffer || file.buffer.length === 0) {
    return { valid: false, error: "Uploaded file is empty. Please upload a valid PDF or CSV file.", isPDF: false, isCSV: false };
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const isPdfExt = ext === ".pdf";
  const isCsvExt = ext === ".csv" || ext === ".txt";

  if (!isPdfExt && !isCsvExt) {
    return { valid: false, error: "Invalid file extension. Only PDF (.pdf) and CSV (.csv) files are allowed.", isPDF: false, isCSV: false };
  }

  // Inspect file signature / magic bytes
  const header = file.buffer.subarray(0, 5).toString("latin1");
  if (isPdfExt) {
    if (!header.startsWith("%PDF")) {
      return { valid: false, error: "Invalid PDF file signature. The file is corrupted or invalid.", isPDF: false, isCSV: false };
    }
    return { valid: true, isPDF: true, isCSV: false };
  }

  // CSV validation: ensure no binary null bytes
  const sample = file.buffer.subarray(0, 2048);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      return { valid: false, error: "Invalid CSV file content. Binary data detected.", isPDF: false, isCSV: false };
    }
  }

  return { valid: true, isPDF: false, isCSV: true };
}

// Fetch helper with AbortController timeout protection
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 120000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Document Ownership Verification for RAG Security
async function verifyDocumentOwnership(docId: string, userUid?: string): Promise<{ authorized: boolean; reason?: string }> {
  if (!docId) return { authorized: false, reason: "Missing doc_id parameter." };

  if (userUid) {
    try {
      const found = await db.select().from(assessments).where(eq(assessments.id, docId));
      if (found.length === 0) {
        if (guestDocumentIds.has(docId)) return { authorized: true };
        return { authorized: false, reason: "Document not found." };
      }
      if (found[0].userUid !== userUid) {
        return { authorized: false, reason: "Forbidden: You do not own this document." };
      }
      return { authorized: true };
    } catch (err: any) {
      console.error("[Ownership Check Error]:", err.message);
      if (guestDocumentIds.has(docId)) return { authorized: true };
      return { authorized: false, reason: "Database verification failed." };
    }
  } else {
    if (guestDocumentIds.has(docId)) return { authorized: true };
    try {
      const found = await db.select().from(assessments).where(eq(assessments.id, docId));
      if (found.length > 0) {
        if (found[0].userUid) {
          return { authorized: false, reason: "Forbidden: Authenticated document cannot be accessed by guests." };
        }
        return { authorized: true };
      }
    } catch {}
    return { authorized: false, reason: "Forbidden: Unauthorized or non-existent document ID." };
  }
}

// Sector benchmarks
const SECTOR_BENCHMARKS: Record<string, SectorBenchmarks> = {
  Manufacturing: {
    sector: "Manufacturing",
    revenue_per_employee: { p25: 72000, p50: 98000, p75: 130000 },
    output_per_payroll: { p25: 2.8, p50: 3.7, p75: 5.2 },
    gross_margin: { p25: 25, p50: 35, p75: 45 },
    operating_margin: { p25: 5, p50: 12, p75: 20 },
  },
  Services: {
    sector: "Services",
    revenue_per_employee: { p25: 100000, p50: 145000, p75: 210000 },
    output_per_payroll: { p25: 2.8, p50: 3.8, p75: 4.9 },
    gross_margin: { p25: 40, p50: 55, p75: 70 },
    operating_margin: { p25: 8, p50: 18, p75: 28 },
  },
  Retail: {
    sector: "Retail",
    revenue_per_employee: { p25: 150000, p50: 190000, p75: 250000 },
    output_per_payroll: { p25: 4.2, p50: 5.3, p75: 6.5 },
    gross_margin: { p25: 20, p50: 28, p75: 38 },
    operating_margin: { p25: 2, p50: 6, p75: 12 },
  },
  Other: {
    sector: "Other",
    revenue_per_employee: { p25: 110000, p50: 160000, p75: 220000 },
    output_per_payroll: { p25: 3.2, p50: 4.0, p75: 5.5 },
    gross_margin: { p25: 28, p50: 38, p75: 50 },
    operating_margin: { p25: 5, p50: 10, p75: 18 },
  },
};


/** Hardcoded fallback recommendations used only when the LLM produces no valid recommendations. */
const FALLBACK_RECOMMENDATIONS: string[] = [
  "Review current payroll allocation to optimize labour output.",
  "Track supplier expenses more accurately to raise gross margins.",
  "Explore standard automation software (ERPs, cloud bookkeeping) to improve digital flow."
];

/**
 * Validates raw LLM recommendation output.
 * Returns a cleaned string[] when at least one non-empty string is present;
 * returns null when the input is missing, not an array, empty, or contains only blank strings.
 */
function validateLLMRecommendations(recs: any): string[] | null {
  if (!Array.isArray(recs) || recs.length === 0) return null;
  const valid = recs
    .filter((r: any): r is string => typeof r === "string")
    .map((r: string) => r.trim())
    .filter((r: string) => r.length > 0);
  return valid.length > 0 ? valid : null;
}

// Scoring logic — clearly handles null inputs vs reported zeros
function calculateScores(metrics: any, sectorName: string, llmRecommendations?: any): { scores: AssessmentScores, benchmarks: SectorBenchmarks } {
  const benchmarks = SECTOR_BENCHMARKS[sectorName] || SECTOR_BENCHMARKS["Other"];

  // 1. LABOUR EFFICIENCY (0-50)
  let revPerEmp = 0;
  let revPerEmpScore = 0;
  let hasRevPerEmp = false;
  const refRevPerEmpP50 = benchmarks.revenue_per_employee.p50;

  if (metrics.revenue !== null && metrics.headcount !== null && metrics.headcount > 0) {
    revPerEmp = metrics.revenue / metrics.headcount;
    const ratio = revPerEmp / refRevPerEmpP50;
    revPerEmpScore = Math.min(Math.max(ratio * 12.5, 3), 25);
    hasRevPerEmp = true;
  }

  let outputPerPayroll = 0;
  let outputPerPayrollScore = 0;
  let hasOutputPerPayroll = false;
  const refOutputPerPayrollP50 = benchmarks.output_per_payroll.p50;

  if (metrics.revenue !== null && metrics.payroll !== null && metrics.payroll > 0) {
    outputPerPayroll = metrics.revenue / metrics.payroll;
    const ratio = outputPerPayroll / refOutputPerPayrollP50;
    outputPerPayrollScore = Math.min(Math.max(ratio * 12.5, 3), 25);
    hasOutputPerPayroll = true;
  }

  let labourEfficiencyScore = 0;
  if (hasRevPerEmp && hasOutputPerPayroll) {
    labourEfficiencyScore = Math.round((revPerEmpScore + outputPerPayrollScore) * 10) / 10;
  } else if (hasRevPerEmp) {
    labourEfficiencyScore = Math.round(revPerEmpScore * 2 * 10) / 10;
  } else if (hasOutputPerPayroll) {
    labourEfficiencyScore = Math.round(outputPerPayrollScore * 2 * 10) / 10;
  } else {
    labourEfficiencyScore = 25.0; // Default baseline if metrics non-disclosed
  }

  // 2. FINANCIAL HEALTH (0-50)
  let grossMarginVal = metrics.grossMargin;
  if (grossMarginVal === null && metrics.revenue !== null && metrics.revenue > 0 && metrics.cogs !== null) {
    grossMarginVal = ((metrics.revenue - metrics.cogs) / metrics.revenue) * 100;
    grossMarginVal = Math.max(-100, Math.min(100, grossMarginVal));
  }

  let grossMarginScore = 0;
  let hasGrossMargin = false;
  if (grossMarginVal !== null) {
    const ratio = grossMarginVal / benchmarks.gross_margin.p50;
    grossMarginScore = Math.min(Math.max(ratio * 6.25, 1.5), 12.5);
    hasGrossMargin = true;
  }

  let operatingMarginScore = 0;
  let hasOperatingMargin = false;
  if (metrics.operatingMargin !== null) {
    const ratio = metrics.operatingMargin / benchmarks.operating_margin.p50;
    operatingMarginScore = Math.min(Math.max(ratio * 6.25, 1.5), 12.5);
    hasOperatingMargin = true;
  }

  let marginScore = 12.5;
  if (hasGrossMargin && hasOperatingMargin) {
    marginScore = grossMarginScore + operatingMarginScore;
  } else if (hasGrossMargin) {
    marginScore = grossMarginScore * 2;
  } else if (hasOperatingMargin) {
    marginScore = operatingMarginScore * 2;
  }

  // Liquidity (Current Ratio) (0-25)
  let currentRatio = 1.5;
  let liquidityScore = 12.5;
  if (metrics.currentAssets !== null && metrics.currentLiabilities !== null && metrics.currentLiabilities > 0) {
    currentRatio = metrics.currentAssets / metrics.currentLiabilities;
    if (currentRatio >= 1.5) {
      liquidityScore = 25;
    } else if (currentRatio >= 1.0) {
      liquidityScore = 15 + ((currentRatio - 1.0) / 0.5) * 10;
    } else {
      liquidityScore = Math.max(3, currentRatio * 15);
    }
  }

  const financialHealthScore = Math.round((marginScore + liquidityScore) * 10) / 10;
  const productivityIndex = Math.round((labourEfficiencyScore + financialHealthScore) * 10) / 10;

  // Digital Maturity Calculation: grounded in verified digital tool signals and document evidence
  const toolsCount = metrics.digitalTools ? metrics.digitalTools.length : 0;
  let level: "Low" | "Medium" | "High";

  if (metrics.digitalMaturityLevel && ["Low", "Medium", "High"].includes(metrics.digitalMaturityLevel)) {
    level = metrics.digitalMaturityLevel as "Low" | "Medium" | "High";
  } else if (toolsCount >= 4) {
    level = "High";
  } else if (toolsCount >= 1) {
    level = "Medium";
  } else {
    level = "Low";
  }

  // If 0 tools are detected, ensure level is Low unless explicitly stated otherwise
  if (toolsCount === 0 && (!metrics.digitalMaturityLevel || metrics.digitalMaturityLevel === "Medium")) {
    level = "Low";
  }

  let digitalMaturityScore: number;
  if (level === "High") {
    digitalMaturityScore = Math.min(100, Math.max(75, 70 + toolsCount * 6));
  } else if (level === "Medium") {
    digitalMaturityScore = Math.min(74, Math.max(40, 35 + toolsCount * 12));
  } else {
    // Low / Undisclosed digital tools
    digitalMaturityScore = toolsCount === 0 ? 20 : 35;
  }
  // Dynamic contextual pathway & automation recommendation
  const company = metrics.companyName || "The enterprise";
  const toolList = metrics.digitalTools && metrics.digitalTools.length > 0 ? metrics.digitalTools : [];
  const toolStr = toolList.length > 0 ? toolList.join(", ") : "no explicit cloud platforms";
  
  let digitalPathwayAnalysis = "";
  let digitalRecommendation = "";

  if (level === "High") {
    digitalPathwayAnalysis = `${company} displays advanced digital maturity within the ${sectorName} sector (leveraging ${toolStr}). Operating on interconnected digital infrastructure significantly strengthens output per payroll and allows scaling without linear administrative costs.`;
    digitalRecommendation = `Consolidate API workflows across ${toolList.slice(0, 2).join(" and ") || "enterprise systems"} to automate cross-functional reconciliation and real-time inventory visibility.`;
  } else if (level === "Medium") {
    digitalPathwayAnalysis = `${company} maintains foundational digital tools in ${sectorName} (${toolStr}). While core record-keeping is digitised, workflow integration gaps remain, creating opportunities to accelerate labour productivity toward upper benchmark percentiles.`;
    digitalRecommendation = `Implement automated data-capture companion tools and live bank feeds into ${toolList[0] || "existing bookkeeping software"} to eliminate routine manual ledger entries.`;
  } else {
    // Low
    digitalPathwayAnalysis = `Analysis indicates ${company} has an undisclosed or legacy bookkeeping setup in the ${sectorName} sector (${toolStr}). Sector peers adopting unified cloud accounting report up to 2.5x higher output per payroll than firms relying on manual ledgers.`;
    digitalRecommendation = `Deploy a modern cloud accounting foundation (e.g., Xero or QuickBooks) with digital invoicing to establish real-time operational visibility and cut administrative overhead.`;
  }

  const validLLMRecs = validateLLMRecommendations(llmRecommendations);
  const recommendations = validLLMRecs ?? FALLBACK_RECOMMENDATIONS;
  const recommendationSource: "llm" | "fallback" = validLLMRecs !== null ? "llm" : "fallback";

  const scores: AssessmentScores = {
    labourEfficiencyScore,
    labourDetails: {
      revenuePerEmployee: Math.round(revPerEmp),
      outputPerPayroll: Math.round(outputPerPayroll * 100) / 100,
      revenuePerEmployeeBenchmark: benchmarks.revenue_per_employee.p50,
      outputPerPayrollBenchmark: benchmarks.output_per_payroll.p50,
    },
    financialHealthScore,
    financialDetails: {
      grossMargin: grossMarginVal !== null ? Math.round(grossMarginVal * 10) / 10 : null,
      operatingMargin: metrics.operatingMargin !== null ? Math.round(metrics.operatingMargin * 10) / 10 : null,
      currentRatio: Math.round(currentRatio * 100) / 100,
      grossMarginBenchmark: benchmarks.gross_margin.p50,
      operatingMarginBenchmark: benchmarks.operating_margin.p50,
    },
    productivityIndex,
    digitalMaturityScore,
    digitalMaturityLevel: level,
    digitalPathwayAnalysis,
    digitalRecommendation,
    qualitativeAnalysis: metrics.qualitativeAnalysis || "Assessment completed successfully based on provided financials.",
    recommendations,
    recommendationSource,
  };

  return { scores, benchmarks };
}

// --- API ROUTES ---

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Get Benchmarks
app.get("/api/benchmarks", (req, res) => {
  res.json(SECTOR_BENCHMARKS);
});

// Get History
app.get("/api/history", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userUid = req.user!.uid;
    const runs = await db
      .select()
      .from(assessments)
      .where(eq(assessments.userUid, userUid));
    
    // Return descending sorted by date
    const sorted = runs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json(sorted);
  } catch (error: any) {
    console.error("Failed to load assessments:", error);
    res.status(500).json({ error: "Failed to load assessment history from database." });
  }
});

// Get single assessment
app.get("/api/history/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userUid = req.user!.uid;
    const result = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, req.params.id));
    
    if (result.length === 0) {
      return res.status(404).json({ error: "Assessment run not found." });
    }
    
    const run = result[0];
    if (run.userUid !== userUid) {
      return res.status(403).json({ error: "Forbidden: You do not own this assessment." });
    }
    
    res.json(run);
  } catch (error: any) {
    console.error("Failed to load assessment details:", error);
    res.status(500).json({ error: "Failed to load assessment from database." });
  }
});

// Delete single assessment
app.delete("/api/history/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userUid = req.user!.uid;
    const result = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, req.params.id));
    
    if (result.length === 0) {
      return res.status(404).json({ error: "Assessment run not found." });
    }
    
    const run = result[0];
    if (run.userUid !== userUid) {
      return res.status(403).json({ error: "Forbidden: You do not own this assessment." });
    }
    
    await db.delete(assessments).where(eq(assessments.id, req.params.id));
    res.json({ success: true, message: "Assessment deleted successfully." });
  } catch (error: any) {
    console.error("Failed to delete assessment:", error);
    res.status(500).json({ error: "Failed to delete assessment from database." });
  }
});

// Export Assessment Report to Google Doc
app.post("/api/export-docs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userUid = req.user!.uid;
    const { assessmentId, googleAccessToken } = req.body;

    if (!assessmentId) {
      return res.status(400).json({ error: "Missing assessmentId parameter." });
    }
    if (!googleAccessToken) {
      return res.status(400).json({ error: "Google access token is required to export reports." });
    }

    const result = await db
      .select()
      .from(assessments)
      .where(eq(assessments.id, assessmentId));

    if (result.length === 0) {
      return res.status(404).json({ error: "Assessment run not found." });
    }

    const run = result[0];
    if (run.userUid !== userUid) {
      return res.status(403).json({ error: "Forbidden: You do not own this assessment." });
    }

    const metrics = run.metrics as any;
    const scores = run.scores as any;

    const { google } = await import("googleapis");
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleAccessToken });

    const docs = google.docs({ version: "v1", auth: oauth2Client });

    // Create a brand new Google Doc
    const docTitle = `${run.companyName} - Productive Point Business Performance Report`;
    const createRes = await docs.documents.create({
      requestBody: {
        title: docTitle,
      },
    });

    const documentId = createRes.data.documentId;
    if (!documentId) {
      throw new Error("Failed to create Google Doc");
    }

    const textContent = `PRODUCTIVE POINT BUSINESS PERFORMANCE & PRODUCTIVITY REPORT
================================================================================
Company Name:       ${run.companyName}
Date of Assessment: ${new Date(run.date).toLocaleDateString()}
Sector / Industry:  ${run.sector}
Source Document:    ${run.fileName} (${run.fileType})
================================================================================

1. EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
Productive Point Productivity Index: ${scores.productivityIndex} / 100
Labour Efficiency Score:   ${scores.labourEfficiencyScore} / 50
Financial Health Score:    ${scores.financialHealthScore} / 50
Digital Maturity Level:    ${scores.digitalMaturityLevel} (Score: ${scores.digitalMaturityScore} / 100)

Expert Qualitative Overview:
${scores.qualitativeAnalysis}

2. KEY OPERATIONAL & FINANCIAL METRICS
--------------------------------------------------------------------------------
* LABOUR EFFICIENCY:
  - Revenue per Employee:  $${scores.labourDetails.revenuePerEmployee?.toLocaleString() || "N/A"}
    (Industry Median Benchmark: $${scores.labourDetails.revenuePerEmployeeBenchmark?.toLocaleString() || "N/A"})
  - Output per Payroll Ratio: ${scores.labourDetails.outputPerPayroll || "N/A"}x
    (Industry Median Benchmark: ${scores.labourDetails.outputPerPayrollBenchmark || "N/A"}x)

* FINANCIAL HEALTH:
  - Gross Profit Margin:   ${scores.financialDetails.grossMargin || "N/A"}%
    (Industry Median Benchmark: ${scores.financialDetails.grossMarginBenchmark || "N/A"}%)
  - Operating Profit Margin: ${scores.financialDetails.operatingMargin !== null ? scores.financialDetails.operatingMargin + "%" : "N/A"}
    (Industry Median Benchmark: ${scores.financialDetails.operatingMarginBenchmark || "N/A"}%)
  - Current Ratio (Liquidity): ${scores.financialDetails.currentRatio || "N/A"}x

3. DIGITAL TOOLS & ECOSYSTEM
--------------------------------------------------------------------------------
Identified Systems & Platforms:
${metrics.digitalTools && metrics.digitalTools.length > 0 ? metrics.digitalTools.map((t: string) => `  - ${t}`).join("\n") : "  - No software or bookkeeping packages explicitly detected."}

Operational Leverage Pathway:
${scores.digitalPathwayAnalysis || "Digital readiness analysis completed."}

Automation Recommendation:
${scores.digitalRecommendation || "Deploy cloud bookkeeping integrations to streamline administrative workflows."}

4. STRATEGIC PRODUCTIVITY RECOMMENDATIONS
--------------------------------------------------------------------------------
Based on this analysis, we recommend implementing the following high-impact operational improvements:

${scores.recommendations.map((rec: string, index: number) => `[${index + 1}] ${rec}`).join("\n\n")}

--------------------------------------------------------------------------------
Report generated automatically by Productive Point - See your business clearly.
`;

    // Populate Google Doc with the generated report content
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text: textContent,
            },
          },
        ],
      },
    });

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
    res.json({ success: true, documentId, docUrl });

  } catch (error: any) {
    console.error("Google Docs Export Error:", error);
    res.status(500).json({ error: `Google Docs export failed: ${error.message || error}` });
  }
});

// Assess Document Endpoint
app.post("/api/assess", optionalAuth, handleUpload, async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    const sector = (req.body.sector || "Other") as string;
    const customCompanyName = req.body.companyName as string;

    // Rate Limit Check for Guest users
    if (!req.user?.uid) {
      const clientIp = req.ip || req.socket.remoteAddress || "guest";
      if (!checkGuestRateLimit(clientIp)) {
        return res.status(429).json({ error: "Guest assessment rate limit exceeded. Please wait 15 minutes or sign in." });
      }
    }

    // Validate uploaded file signature and format
    const valResult = validateUploadedFile(file);
    if (!valResult.valid || !file) {
      return res.status(400).json({ error: valResult.error || "Invalid upload." });
    }

    const isPDF = valResult.isPDF;
    const isCSV = valResult.isCSV;

    // Helper: Extract text using Python RAG service /extract endpoint
    async function extractTextForOllama(buffer: Buffer, originalName: string, isPDFFile: boolean): Promise<string> {
      if (!isPDFFile) {
        return buffer.toString("utf-8");
      }

      try {
        const FormData = (await import("form-data")).default;
        const form = new FormData();
        form.append("file", buffer, { filename: originalName || "document.pdf" });

        const extractRes = await fetchWithTimeout(`${RAG_SERVICE_URL}/extract`, {
          method: "POST",
          body: form.getBuffer(),
          headers: form.getHeaders(),
        }, RAG_SERVICE_TIMEOUT);

        if (extractRes.ok) {
          const data: any = await extractRes.json();
          if (data && data.text && data.text.length > 20) {
            return data.text;
          }
        }
      } catch (err: any) {
        console.warn("[Text Extract Warning] Python /extract service call failed:", err.message);
      }

      // Safe PDF string extraction fallback
      const raw = buffer.toString("binary");
      const textBlocks: string[] = [];
      const regex = /\(([^)]+)\)\s*Tj|\[([^\]]+)\]\s*TJ/g;
      let match;
      while ((match = regex.exec(raw)) !== null) {
        const text = match[1] || match[2];
        if (text) textBlocks.push(text.replace(/\\/g, ""));
      }
      return textBlocks.length > 5 ? textBlocks.join(" ") : buffer.toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    }

    interface TaskLLMConfig {
      provider: "ollama";
      model: string;
      ollamaUrl?: string;
    }

    function resolveTaskLLM(task: "assessment" | "rag" | "strategy"): TaskLLMConfig {
      const globalProvider = (process.env.LLM_PROVIDER || "").toLowerCase();
      const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const taskEnvPrefix = task.toUpperCase();
      let model = process.env[`${taskEnvPrefix}_MODEL`] || process.env.OLLAMA_MODEL || "qwen2.5:7b";

      return { provider: "ollama", model, ollamaUrl };
    }

    const llmConfig = resolveTaskLLM("assessment");
    console.log(`[Assessment Router] Task: Financial Assessment | Model: ${llmConfig.model}`);

    const ollamaUrl = llmConfig.ollamaUrl;
    const ollamaModel = llmConfig.model;

    let mimeType = isPDF ? "application/pdf" : "text/csv";

    const promptText = `You are an elite SME Productivity & Financial Analyst.
Analyze the attached financial statement (which is a ${isPDF ? "PDF" : "CSV"} document) for an SME in the '${sector}' sector.

CRITICAL ANTI-HALLUCINATION INSTRUCTIONS:
- You must ONLY extract numbers that are explicitly written in the attached text, or directly derivable from them with 100% mathematical certainty.
- NEVER guess, approximate, estimate, or extrapolate any of these metrics: revenue, headcount, cogs, payroll, grossMargin, operatingMargin, currentAssets, currentLiabilities.
- UK / micro-entity accounts frequently do NOT disclose headcount, payroll, or operating margin values. If missing, return null.
- DIGITAL TOOLS ("digitalTools"): Extract ONLY software platforms, ERP, CRM, or accounting systems that are EXPLICITLY NAMED in the document text. If NO software or IT systems are mentioned in the document, you MUST return an empty array [] and set "digitalMaturityLevel": "Low". NEVER invent, assume, or default to tools (such as Sage, Excel, Verizon, etc.) if they do not appear in the text.
- In the "extractedJustifications" string, document the exact page number, section heading, or calculation note for each metric found (e.g., "Revenue: Page 2, Statement of Profit or Loss, 'Turnover: £450,000'").
- If a metric is missing, explicitly state in "extractedJustifications" that it was not disclosed.

Your task is to:
1. Extract key financial metrics with highest precision. Use null if missing.
2. Scan for mentions of software systems, bookkeeping packages, or digital ERP/CRM tools. Return [] if none mentioned.
3. Classify digital maturity level as 'Low' (0 tools / manual), 'Medium' (1-3 tools), or 'High' (4+ tools or enterprise ERP).
4. Formulate 3 to 5 practical productivity improvement recommendations.
5. Provide a crisp qualitative summary.

Return the result as a single JSON object matching the requested schema.`;

    function extractJSONObject(rawText: string): any {
      let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      try {
        return JSON.parse(cleaned);
      } catch (e1) {
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const candidate = cleaned.slice(firstBrace, lastBrace + 1);
          try {
            return JSON.parse(candidate);
          } catch (e2) {
            try {
              const sanitized = candidate
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
              return JSON.parse(sanitized);
            } catch (e3) {}
          }
        }
        return {};
      }
    }

    const tryOllama = async () => {
      let targetUrl = ollamaUrl || "http://localhost:11434";
      const isDocker = process.env.SQL_HOST === "db";
      if (isDocker) {
        if (targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1")) {
          targetUrl = targetUrl.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal");
        }
      } else {
        if (targetUrl.includes("host.docker.internal")) {
          targetUrl = targetUrl.replace("host.docker.internal", "127.0.0.1");
        }
      }
      console.log(`[Assessment Engine] Calling local Ollama model '${ollamaModel}' at ${targetUrl}...`);
      let docText = await extractTextForOllama(file.buffer, file.originalname, isPDF);

      // Cap document text passed to LLM at 50,000 characters
      if (docText.length > 50000) {
        docText = docText.slice(0, 50000) + "\n\n[TRUNCATED AT 50,000 CHARACTERS]";
      }

      const jsonFormatGuide = `
You MUST return ONLY a JSON object (no markdown, no backticks) with this structure:
{
  "companyName": "Company Name string or null",
  "revenue": number or null,
  "headcount": integer or null,
  "cogs": number or null,
  "payroll": number or null,
  "grossMargin": number or null,
  "operatingMargin": number or null,
  "currentAssets": number or null,
  "currentLiabilities": number or null,
  "digitalTools": ["tool1", "tool2"],
  "confidence": number from 0 to 100,
  "extractedJustifications": "evidence notes and citations",
  "digitalMaturityLevel": "Low" or "Medium" or "High",
  "recommendations": ["suggestion 1", "suggestion 2"],
  "qualitativeAnalysis": "analysis summary text"
}
`;
      const fullPrompt = `${promptText}\n\n${jsonFormatGuide}\n\nDOCUMENT TEXT CONTENT:\n${docText}`;

      const isThinkingModel = ollamaModel.toLowerCase().includes("gpt-oss") || ollamaModel.toLowerCase().includes("r1") || ollamaModel.toLowerCase().includes("reason");
      const requestBody: any = {
        model: ollamaModel,
        prompt: fullPrompt,
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0.0, seed: 42, top_p: 1.0, num_ctx: 8192 }
      };
      if (!isThinkingModel) {
        requestBody.format = "json";
      }

      const res = await fetchWithTimeout(`${targetUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      }, 120000);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ollama API error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const rawText = (data.response || "{}").trim();
      return extractJSONObject(rawText);
    };

    // Helper: Validate company name candidate
    function isValidCompanyName(candidate: string): boolean {
      if (!candidate || candidate.length < 2 || candidate.length > 80) return false;
      if ((candidate.match(/,/g) || []).length >= 2) return false;
      const digitCount = (candidate.match(/\d/g) || []).length;
      const alphaCount = (candidate.match(/[a-zA-Z]/g) || []).length;
      if (alphaCount > 0 && digitCount / (digitCount + alphaCount) > 0.5) return false;
      if (alphaCount === 0) return false;

      const lower = candidate.toLowerCase().trim();
      const financialKeywords = [
        "revenue", "turnover", "total", "balance", "profit", "loss", "cost",
        "margin", "assets", "liabilities", "equity", "depreciation", "amortisation",
        "operating", "gross", "net", "payroll", "wages", "salaries", "tax", "statement", "notes"
      ];
      for (const kw of financialKeywords) {
        if (lower.startsWith(kw)) return false;
      }
      return true;
    }

    // Deterministic scanner for digital software / systems explicitly mentioned in document text
    function extractKnownDigitalTools(text: string): string[] {
      if (!text) return [];
      const knownPatterns: { name: string; regex: RegExp }[] = [
        { name: "Xero", regex: /\bXero\b/i },
        { name: "QuickBooks", regex: /\b(?:QuickBooks|Quick\s*Books|QB\s*Online)\b/i },
        { name: "Sage 50", regex: /\bSage\s*(?:50|Line\s*50)\b/i },
        { name: "Sage Intacct", regex: /\bSage\s*Intacct\b/i },
        { name: "Sage", regex: /\bSage\b/i },
        { name: "SAP", regex: /\bSAP(?:\s*(?:Business\s*One|ERP|S\/4HANA))?\b/i },
        { name: "Oracle NetSuite", regex: /\b(?:Oracle\s*NetSuite|NetSuite)\b/i },
        { name: "Oracle", regex: /\bOracle\b/i },
        { name: "Microsoft Dynamics", regex: /\b(?:Microsoft\s*Dynamics|Dynamics\s*365|Business\s*Central|Navision)\b/i },
        { name: "Microsoft Excel", regex: /\b(?:Microsoft\s*Excel|MS\s*Excel|Excel\s*spreadsheets?)\b/i },
        { name: "Excel", regex: /\bExcel\b/i },
        { name: "Dext", regex: /\b(?:Dext|Receipt\s*Bank)\b/i },
        { name: "Hubdoc", regex: /\bHubdoc\b/i },
        { name: "AutoEntry", regex: /\bAutoEntry\b/i },
        { name: "FreeAgent", regex: /\bFreeAgent\b/i },
        { name: "KashFlow", regex: /\bKashFlow\b/i },
        { name: "BrightPay", regex: /\bBrightPay\b/i },
        { name: "Zoho Books", regex: /\bZoho\s*Books\b/i },
        { name: "Zoho CRM", regex: /\bZoho\s*CRM\b/i },
        { name: "HubSpot", regex: /\bHubSpot\b/i },
        { name: "Salesforce", regex: /\bSalesforce\b/i },
        { name: "Shopify", regex: /\bShopify\b/i },
        { name: "Stripe", regex: /\bStripe\b/i },
        { name: "Square", regex: /\bSquare\b/i },
        { name: "Monday.com", regex: /\bMonday\.com\b/i },
        { name: "Asana", regex: /\bAsana\b/i },
        { name: "Trello", regex: /\bTrello\b/i },
        { name: "Jira", regex: /\bJira\b/i },
        { name: "Slack", regex: /\bSlack\b/i },
        { name: "Verizon Connect", regex: /\bVerizon\s*Connect\b/i },
        { name: "Fleetio", regex: /\bFleetio\b/i },
        { name: "EPOS Now", regex: /\bEPOS\s*Now\b/i },
        { name: "Lightspeed", regex: /\bLightspeed\b/i },
        { name: "Vend", regex: /\bVend\b/i },
        { name: "Unleashed", regex: /\bUnleashed\b/i },
        { name: "Dear Systems", regex: /\bDear\s*Systems\b/i },
        { name: "Cin7", regex: /\bCin7\b/i },
      ];

      const matched = new Set<string>();
      for (const p of knownPatterns) {
        if (p.regex.test(text)) {
          if (p.name === "Sage" && (matched.has("Sage 50") || matched.has("Sage Intacct"))) continue;
          if (p.name === "Oracle" && matched.has("Oracle NetSuite")) continue;
          if (p.name === "Excel" && matched.has("Microsoft Excel")) continue;
          matched.add(p.name);
        }
      }
      return Array.from(matched);
    }

    // Filter LLM-proposed digital tools against actual document text to eliminate hallucinations
    function sanitizeDigitalTools(llmTools: any, rawDocText: string): string[] {
      const deterministicTools = extractKnownDigitalTools(rawDocText);
      const verifiedTools = new Set<string>(deterministicTools);

      if (Array.isArray(llmTools)) {
        const lowerDoc = rawDocText.toLowerCase();
        for (const tool of llmTools) {
          if (typeof tool === "string") {
            const cleanTool = tool.trim();
            if (cleanTool.length >= 2 && cleanTool.length <= 50) {
              const cleanLower = cleanTool.toLowerCase();
              if (lowerDoc.includes(cleanLower)) {
                verifiedTools.add(cleanTool);
              } else {
                const significantWords = cleanLower.split(/\s+/).filter(w => w.length >= 4 && !["system", "software", "tool", "cloud", "online", "suite"].includes(w));
                if (significantWords.length > 0 && significantWords.every(w => lowerDoc.includes(w))) {
                  verifiedTools.add(cleanTool);
                }
              }
            }
          }
        }
      }

      return Array.from(verifiedTools);
    }

    // Helper: Parse CSV line respecting quoted strings
    function parseCSVLine(line: string): string[] {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    }

    // Pre-parsing helper for deterministic financial extraction
    function preParseUniversalMetrics(text: string, fileName?: string): Partial<FinancialMetrics> {
      const result: Partial<FinancialMetrics> = {};
      if (!text) return result;

      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2 && lines[0].includes(",")) {
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
        const values = parseCSVLine(lines[1]);
        headers.forEach((h, i) => {
          const valStr = values[i];
          if (!valStr) return;
          const num = parseFloat(valStr.replace(/[^0-9.-]/g, ""));
          if (h.includes("company")) {
            const cleaned = valStr.replace(/['"]/g, "");
            if (isValidCompanyName(cleaned)) result.companyName = cleaned;
          }
          if (h.includes("revenue") || h.includes("turnover") || h.includes("sales")) if (!isNaN(num)) result.revenue = num;
          if (h.includes("headcount") || h.includes("employees") || h.includes("staff")) if (!isNaN(num)) result.headcount = Math.round(num);
          if (h.includes("cogs") || h.includes("cost of sales") || h.includes("direct cost")) if (!isNaN(num)) result.cogs = num;
          if (h.includes("payroll") || h.includes("wages") || h.includes("salaries")) if (!isNaN(num)) result.payroll = num;
          if (h.includes("current assets") || h.includes("assets")) if (!isNaN(num)) result.currentAssets = num;
          if (h.includes("current liabilities") || h.includes("liabilities")) if (!isNaN(num)) result.currentLiabilities = num;
        });
      }

      for (const line of lines) {
        const parts = line.split(/[:,\t]/);
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase();
          const valStr = parts.slice(1).join(" ").trim();
          const num = parseFloat(valStr.replace(/[^0-9.-]/g, ""));
          if (!isNaN(num)) {
            const isNarrativeKey = key.includes("growth") || key.includes("grew") || key.includes("concentration") || key.includes("per employee") || key.includes("per payroll") || key.includes("ratio") || key.includes("benchmark") || key.includes("notes") || key.includes("risk") || key.includes("note");
            if (!isNarrativeKey) {
              if (key.includes("revenue") || key.includes("turnover") || key === "total sales") result.revenue = result.revenue ?? num;
              if (key.includes("headcount") || key.includes("employees") || key.includes("staff count")) result.headcount = result.headcount ?? Math.round(num);
              if (key.includes("cogs") || key.includes("cost of goods sold") || key.includes("cost of sales")) result.cogs = result.cogs ?? num;
              if (key.includes("payroll") || key.includes("staff payroll") || key.includes("wages") || key.includes("salaries")) result.payroll = result.payroll ?? num;
            }
            if (key === "gross margin (%)" || key === "gross margin" || key === "gross profit margin (%)") result.grossMargin = result.grossMargin ?? num;
            if (key === "operating margin (%)" || key === "operating margin") result.operatingMargin = result.operatingMargin ?? num;
          }
          if (key.includes("company") || key === "name") {
            if (!result.companyName && isValidCompanyName(valStr.replace(/['"]/g, ""))) {
              result.companyName = valStr.replace(/['"]/g, "");
            }
          }
        }
      }

      if (result.revenue == null) {
        const revMatch = text.match(/(?:total\s+)?(?:revenue|turnover)\s*(?:\(turnover\))?\s*[:\-]?\s*£?\s*([0-9,]+(?:\.[0-9]+)?)/i);
        if (revMatch) result.revenue = parseFloat(revMatch[1].replace(/,/g, ""));
      }
      if (result.headcount == null) {
        const hcMatch = text.match(/(?:headcount|employed|employees|staff)(?: of| around| approx)?\s+(\d+)/i) || text.match(/(\d+)\s+(?:full-time equivalent|employees|staff)/i);
        if (hcMatch) result.headcount = parseInt(hcMatch[1], 10);
      }
      if (result.cogs == null) {
        const cogsMatch = text.match(/(?:cogs|cost of goods sold|cost of sales)\s*(?:\([a-z]+\))?\s*[:\-]?\s*£?\s*([0-9,]+(?:\.[0-9]+)?)/i);
        if (cogsMatch) result.cogs = parseFloat(cogsMatch[1].replace(/,/g, ""));
      }
      if (result.payroll == null) {
        const payMatch = text.match(/(?:payroll|wages|salaries|staff payroll \& employer ni|staff costs)\s*[:\-]?\s*£?\s*([0-9,]+(?:\.[0-9]+)?)/i);
        if (payMatch) result.payroll = parseFloat(payMatch[1].replace(/,/g, ""));
      }
      if (!result.companyName) {
        const nameMatch = text.match(/^([A-Z0-9\s.,&'"-]+(?:LTD|LIMITED|LLP|INC|CORP|PLC|GROUP))/im);
        if (nameMatch) {
          const candidate = nameMatch[1].trim();
          if (isValidCompanyName(candidate)) {
            result.companyName = candidate;
          }
        }
        if (!result.companyName && fileName) {
          result.companyName = fileName.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
        }
      }

      // Detect digital tools deterministically from document text
      const detectedTools = extractKnownDigitalTools(text);
      if (detectedTools.length > 0) {
        result.digitalTools = detectedTools;
      }

      // Detect explicit digital maturity level declarations
      const matMatch = text.match(/digital\s*maturity(?:\s*rating|\s*level|\s*classification)?\s*[:\-]?\s*(HIGH|MEDIUM|LOW)/i);
      if (matMatch) {
        const rawMat = matMatch[1].toUpperCase();
        if (rawMat === "HIGH") result.digitalMaturityLevel = "High";
        else if (rawMat === "MEDIUM") result.digitalMaturityLevel = "Medium";
        else if (rawMat === "LOW") result.digitalMaturityLevel = "Low";
      }

      return result;
    }

    let llmResult: any = {};
    try {
      llmResult = await tryOllama();
    } catch (err: any) {
      console.warn(`[Assessment Engine] Ollama generation failed or timed out (${err.message}). Falling back to universal deterministic extraction.`);
    }

    const docTextForParsing = isPDF ? await extractTextForOllama(file.buffer, file.originalname, true) : file.buffer.toString("utf-8");
    const preParsed = preParseUniversalMetrics(docTextForParsing, file.originalname);

    const rev = preParsed.revenue ?? llmResult.revenue ?? null;
    const hc = preParsed.headcount ?? llmResult.headcount ?? null;
    const cogsVal = preParsed.cogs ?? llmResult.cogs ?? null;
    const pay = preParsed.payroll ?? llmResult.payroll ?? null;
    const ca = preParsed.currentAssets ?? llmResult.currentAssets ?? null;
    const cl = preParsed.currentLiabilities ?? llmResult.currentLiabilities ?? null;

    // Calculate Gross Margin deterministically
    let grossM: number | null = preParsed.grossMargin ?? null;
    if (grossM == null && rev !== null && cogsVal !== null && rev > 0) {
      grossM = Math.round(((rev - cogsVal) / rev) * 100 * 10) / 10;
    } else if (grossM == null && llmResult.grossMargin != null) {
      grossM = Math.round(llmResult.grossMargin * 10) / 10;
    }
    if (grossM !== null) {
      grossM = Math.max(-100, Math.min(100, grossM));
    }

    // Operating Margin: ONLY use explicitly disclosed operating margin/profit.
    // DO NOT calculate as (Revenue - COGS - Payroll) / Revenue.
    let opM: number | null = preParsed.operatingMargin ?? null;
    if (opM == null && llmResult.operatingMargin != null) {
      opM = Math.round(llmResult.operatingMargin * 10) / 10;
    }
    if (opM !== null) {
      opM = Math.max(-100, Math.min(100, opM));
    }

    const companyName = customCompanyName || preParsed.companyName || llmResult.companyName || "SME Enterprise";

    // Strictly verified digital tools (no hallucinations permitted)
    const verifiedDigitalTools = sanitizeDigitalTools(llmResult.digitalTools, docTextForParsing);

    // Resolve digital maturity level grounded in document evidence
    let resolvedDigitalLevel: "Low" | "Medium" | "High";
    if (preParsed.digitalMaturityLevel) {
      resolvedDigitalLevel = preParsed.digitalMaturityLevel;
    } else if (llmResult.digitalMaturityLevel && ["Low", "Medium", "High"].includes(llmResult.digitalMaturityLevel)) {
      if (verifiedDigitalTools.length === 0 && llmResult.digitalMaturityLevel !== "Low") {
        resolvedDigitalLevel = "Low";
      } else {
        resolvedDigitalLevel = llmResult.digitalMaturityLevel;
      }
    } else {
      resolvedDigitalLevel = verifiedDigitalTools.length >= 4 ? "High" : verifiedDigitalTools.length >= 1 ? "Medium" : "Low";
    }

    const metrics: FinancialMetrics = {
      companyName,
      revenue: rev,
      headcount: hc,
      cogs: cogsVal,
      payroll: pay,
      grossMargin: grossM,
      operatingMargin: opM,
      currentAssets: ca,
      currentLiabilities: cl,
      digitalTools: verifiedDigitalTools,
      digitalMaturityLevel: resolvedDigitalLevel,
      confidence: llmResult.confidence || 85,
      extractedJustifications: llmResult.extractedJustifications || "Extracted using deterministic general ledger analysis."
    };

    // ── Recommendation wiring: pass llmResult.recommendations explicitly.
    // Prior to this fix, llmResult.recommendations was never transferred to metrics,
    // causing calculateScores() to always fall back to hardcoded defaults.
    const rawLLMRecs = llmResult.recommendations;
    console.log(`[Recommendations] LLM field present: ${rawLLMRecs !== undefined && rawLLMRecs !== null}`);
    console.log(`[Recommendations] LLM array length: ${Array.isArray(rawLLMRecs) ? rawLLMRecs.length : "n/a (not an array)"}`);

    const { scores, benchmarks } = calculateScores(metrics, sector, rawLLMRecs);
    console.log(`[Recommendations] Source: ${scores.recommendationSource} | Count: ${scores.recommendations.length}`);

    // Cryptographically secure UUID generation
    const id = crypto.randomUUID();
    if (!req.user?.uid) {
      guestDocumentIds.add(id);
    }

    const newRun: AssessmentRun = {
      id,
      date: new Date().toISOString(),
      companyName,
      sector,
      fileName: file.originalname,
      fileType: isPDF ? "PDF" : "CSV",
      metrics,
      scores,
      benchmarks,
    };

    if (req.user?.uid) {
      await db.insert(assessments).values({
        id: newRun.id,
        userUid: req.user.uid,
        date: newRun.date,
        companyName: newRun.companyName,
        sector: newRun.sector,
        fileName: newRun.fileName,
        fileType: newRun.fileType,
        metrics: newRun.metrics,
        scores: newRun.scores,
        benchmarks: newRun.benchmarks,
      });
    }

    // Auto-index document into Python RAG service
    try {
      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      formData.append("doc_id", newRun.id);
      formData.append("file", file.buffer, { filename: file.originalname, contentType: mimeType });

      fetchWithTimeout(`${RAG_SERVICE_URL}/index`, {
        method: "POST",
        body: formData.getBuffer(),
        headers: formData.getHeaders(),
      }, RAG_SERVICE_TIMEOUT).then(r => r.json()).then(resData => {
        console.log("[RAG Auto-Index] Document successfully indexed:", resData);
      }).catch(err => {
        console.warn("[RAG Auto-Index] Non-blocking index error:", err.message);
      });
    } catch (ragErr: any) {
      console.warn("[RAG Auto-Index Warning]:", ragErr.message);
    }

    res.json(newRun);

  } catch (error: any) {
    console.error("Assessment error:", error);
    let errorMsg = error.message || String(error);
    if (errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("429") || errorMsg.includes("quota")) {
      errorMsg = "Cloud API quota limits reached and local Ollama model was unavailable. Please retry in a few moments or start Ollama.";
    }
    res.status(500).json({ error: errorMsg });
  }
});

// --- RAG PYTHON MICROSERVICE PROXY ENDPOINTS WITH AUTH & OWNERSHIP ---

// Check Python RAG service health
app.get("/api/rag/health", optionalAuth, async (req: AuthRequest, res) => {
  try {
    const response = await fetchWithTimeout(`${RAG_SERVICE_URL}/health`, {}, 10000);
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(503).json({ status: "offline", error: "RAG microservice unavailable." });
  }
});

// Query RAG system for document context & vector search QA (Secured & Bounded)
app.post("/api/rag/query", optionalAuth, async (req: AuthRequest, res) => {
  try {
    let { doc_id, question, top_k } = req.body;
    if (!doc_id || typeof doc_id !== "string" || doc_id.trim().length === 0 || doc_id.length > 100) {
      return res.status(400).json({ error: "doc_id parameter is required and must be a string up to 100 characters." });
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ error: "question parameter is required and must be a non-empty string." });
    }

    // Verify document ownership & authorization
    const authCheck = await verifyDocumentOwnership(doc_id, req.user?.uid);
    if (!authCheck.authorized) {
      return res.status(403).json({ error: authCheck.reason || "Forbidden: You do not have permission to query this document." });
    }

    // Validate and cap question length (max 500 chars)
    const sanitizedQuestion = String(question).trim().slice(0, 500);

    // Validate and cap top_k (1 to 10)
    const sanitizedTopK = Math.min(10, Math.max(1, parseInt(String(top_k), 10) || 6));

    const response = await fetchWithTimeout(`${RAG_SERVICE_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_id, question: sanitizedQuestion, top_k: sanitizedTopK }),
    }, RAG_SERVICE_TIMEOUT);

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to communicate with Python RAG engine." });
  }
});

// Manual index document into RAG system (Secured & Validated)
app.post("/api/rag/index", optionalAuth, handleUpload, async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    const docId = req.body.doc_id;

    if (!docId) {
      return res.status(400).json({ error: "doc_id parameter is required." });
    }

    // Verify document ownership
    const authCheck = await verifyDocumentOwnership(docId, req.user?.uid);
    if (!authCheck.authorized) {
      return res.status(403).json({ error: authCheck.reason || "Forbidden: You do not have permission to index this document." });
    }

    // Validate uploaded file signature and format
    const valResult = validateUploadedFile(file);
    if (!valResult.valid || !file) {
      return res.status(400).json({ error: valResult.error || "Invalid file upload." });
    }

    const FormData = (await import("form-data")).default;
    const formData = new FormData();
    formData.append("doc_id", docId);
    formData.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });

    const response = await fetchWithTimeout(`${RAG_SERVICE_URL}/index`, {
      method: "POST",
      body: formData.getBuffer(),
      headers: formData.getHeaders(),
    }, RAG_SERVICE_TIMEOUT);

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to index document in RAG engine." });
  }
});

// Catch-all 404 handler for /api routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Custom error handling middleware for all API routes
app.use("/api", (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[API Error Handler]:", err.message || err);
  res.status(err.status || err.statusCode || 500).json({
    error: "An unexpected error occurred on the server."
  });
});

// Serve frontend application based on environment
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running at http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
