import { jsPDF } from "jspdf";
import { AssessmentRun } from "../types";

export function generateAssessmentPDF(assessment: AssessmentRun) {
  const { metrics, scores, benchmarks, companyName, sector, date, fileName } = assessment;

  // Initialize jsPDF (A4 page size: 210mm x 297mm)
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 20;
  let pageCount = 1;

  // Formatting helpers
  const formatCurrency = (val: number | null) => {
    if (val === null) return "N/A";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(val);
  };

  // Helper: Draw header and footer on each page
  const drawPageChrome = (pageNum: number) => {
    // Top banner border
    doc.setFillColor(79, 70, 229); // indigo-600
    doc.rect(0, 0, pageWidth, 5, "F");

    // Header text
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(113, 113, 122); // zinc-500
    doc.text("VANLYTICS • CORPORATE PRODUCTIVITY REPORT", marginX, 12);
    doc.text(`ID: ${assessment.id.toUpperCase()}`, pageWidth - marginX, 12, { align: "right" });

    // Header divider line
    doc.setDrawColor(228, 228, 231); // zinc-200
    doc.setLineWidth(0.3);
    doc.line(marginX, 15, pageWidth - marginX, 15);

    // Footer
    doc.line(marginX, pageHeight - 15, pageWidth - marginX, pageHeight - 15);
    doc.text(`CONFIDENTIAL • GENERATED ON ${new Date(date).toLocaleDateString("en-GB").toUpperCase()}`, marginX, pageHeight - 10);
    doc.text(`Page ${pageNum}`, pageWidth - marginX, pageHeight - 10, { align: "right" });
  };

  // Initial page chrome
  drawPageChrome(pageCount);

  let y = 25;

  // Check page overflow
  const checkPageOverflow = (heightNeeded: number) => {
    if (y + heightNeeded > pageHeight - 20) {
      doc.addPage();
      pageCount++;
      drawPageChrome(pageCount);
      y = 25; // Reset to top
    }
  };

  // 1. Title Block
  y += 5;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text(companyName.toUpperCase(), marginX, y);
  
  y += 8;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text(`${sector.toUpperCase()} SECTOR PERFORMANCE EVALUATION`, marginX, y);

  // Source document tag
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(113, 113, 122); // zinc-500
  y += 5;
  doc.text(`Source Document: ${fileName}`, marginX, y);

  y += 10;

  // 2. Composite Benchmark Index Box (High Contrast)
  checkPageOverflow(45);
  doc.setFillColor(15, 23, 42); // slate-900 / zinc-900
  doc.rect(marginX, y, pageWidth - 2 * marginX, 36, "F");

  // Glowing status accent strip on left
  let statusColor = [245, 158, 11]; // amber-500
  let statusLabel = "MEDIAN COMPETITOR";
  if (scores.productivityIndex >= 67) {
    statusColor = [16, 185, 129]; // emerald-500
    statusLabel = "MARKET LEADER";
  } else if (scores.productivityIndex < 34) {
    statusColor = [239, 68, 68]; // rose-500
    statusLabel = "UNDERPERFORMING";
  }

  doc.setFillColor(statusColor[0], statusColor[1], statusColor[2]);
  doc.rect(marginX, y, 4, 36, "F");

  // Title inside box
  doc.setTextColor(165, 180, 252); // indigo-300
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9);
  doc.text("COMPOSITE BENCHMARK PRODUCTIVITY INDEX", marginX + 8, y + 8);

  // Score big text
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.text(`${scores.productivityIndex}`, marginX + 8, y + 22);
  doc.setFontSize(11);
  doc.setTextColor(156, 163, 175); // gray-400
  doc.text("/100", marginX + 25, y + 20);

  // Status tag background
  doc.setFillColor(31, 41, 55); // gray-800
  doc.rect(pageWidth - marginX - 60, y + 6, 52, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8);
  doc.text(statusLabel, pageWidth - marginX - 34, y + 11, { align: "center" });

  // Index description wrap
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(229, 231, 235); // gray-200
  
  const statusDescText = scores.productivityIndex >= 67
    ? "Operating significantly above the sector median. Highly optimized workflows, healthy margins, and efficient labour leverage."
    : scores.productivityIndex >= 34
    ? "Performing at par with typical sector operations. Solid foundation but substantial headroom exists to raise payroll leverage and digitize."
    : "Currently running below sector median. Urgent strategic adjustments are recommended to address labour output leakages or thin margins.";

  const wrappedStatusDesc = doc.splitTextToSize(statusDescText, pageWidth - 2 * marginX - 20);
  doc.text(wrappedStatusDesc, marginX + 8, y + 29);

  y += 42;

  // 3. Three Pillars Score Cards
  checkPageOverflow(30);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("PRIMARY DIAGNOSTIC PILLARS", marginX, y);
  y += 4;

  const cardWidth = (pageWidth - 2 * marginX - 8) / 3;
  const cardHeight = 20;

  // Pillar 1: Labour Efficiency
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.rect(marginX, y, cardWidth, cardHeight, "FD");
  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("LABOUR EFFICIENCY", marginX + 4, y + 5);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(14);
  doc.text(`${scores.labourEfficiencyScore}`, marginX + 4, y + 12);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(8);
  doc.text("/50", marginX + 11, y + 11);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text("Payroll & headcount leverage", marginX + 4, y + 16);

  // Pillar 2: Financial Health
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(marginX + cardWidth + 4, y, cardWidth, cardHeight, "FD");
  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("FINANCIAL HEALTH", marginX + cardWidth + 8, y + 5);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(14);
  doc.text(`${scores.financialHealthScore}`, marginX + cardWidth + 8, y + 12);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(8);
  doc.text("/50", marginX + cardWidth + 15, y + 11);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text("Margins & capital coverage", marginX + cardWidth + 8, y + 16);

  // Pillar 3: Digital Maturity
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(marginX + 2 * cardWidth + 8, y, cardWidth, cardHeight, "FD");
  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("DIGITAL MATURITY", marginX + 2 * cardWidth + 12, y + 5);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(14);
  doc.text(`${scores.digitalMaturityScore}`, marginX + 2 * cardWidth + 12, y + 12);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(8);
  doc.text("/100", marginX + 2 * cardWidth + 21, y + 11);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Level: ${scores.digitalMaturityLevel}`, marginX + 2 * cardWidth + 12, y + 16);

  y += cardHeight + 8;

  // 4. Comparative Metrics Table
  checkPageOverflow(65);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("FINANCIAL RATIOS & BENCHMARK COMPARISONS", marginX, y);
  y += 4;

  // Draw Table Header
  const colWidths = [50, 30, 30, 30, 30]; // Description, Actual, P25, Median (P50), P75
  const tableX = marginX;
  
  doc.setFillColor(79, 70, 229); // Indigo Header
  doc.rect(tableX, y, pageWidth - 2 * marginX, 7, "F");

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("EVALUATION METRIC", tableX + 3, y + 5);
  doc.text("ACTUAL", tableX + 55, y + 5);
  doc.text("SECTOR P25", tableX + 85, y + 5);
  doc.text("MEDIAN (P50)", tableX + 115, y + 5);
  doc.text("SECTOR P75", tableX + 145, y + 5);

  y += 7;

  // Table rows
  const rows = [
    {
      label: "Revenue per Employee",
      actual: scores.labourDetails.revenuePerEmployee > 0 ? formatCurrency(scores.labourDetails.revenuePerEmployee) : "N/A",
      p25: formatCurrency(benchmarks.revenue_per_employee.p25),
      p50: formatCurrency(benchmarks.revenue_per_employee.p50),
      p75: formatCurrency(benchmarks.revenue_per_employee.p75),
    },
    {
      label: "Output per Payroll £",
      actual: scores.labourDetails.outputPerPayroll > 0 ? `£${scores.labourDetails.outputPerPayroll}` : "N/A",
      p25: `£${benchmarks.output_per_payroll.p25}`,
      p50: `£${benchmarks.output_per_payroll.p50}`,
      p75: `£${benchmarks.output_per_payroll.p75}`,
    },
    {
      label: "Gross Profit Margin %",
      actual: `${scores.financialDetails.grossMargin}%`,
      p25: `${benchmarks.gross_margin.p25}%`,
      p50: `${benchmarks.gross_margin.p50}%`,
      p75: `${benchmarks.gross_margin.p75}%`,
    },
    {
      label: "Operating Profit Margin %",
      actual: `${scores.financialDetails.operatingMargin}%`,
      p25: `${benchmarks.operating_margin.p25}%`,
      p50: `${benchmarks.operating_margin.p50}%`,
      p75: `${benchmarks.operating_margin.p75}%`,
    },
    {
      label: "Current Ratio (Liquidity)",
      actual: `${scores.financialDetails.currentRatio}x`,
      p25: "—",
      p50: "1.50x (Target)",
      p75: "—",
    }
  ];

  rows.forEach((row, idx) => {
    // Alternating background
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252); // slate-50
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(tableX, y, pageWidth - 2 * marginX, 7, "F");

    // Grid border line
    doc.setDrawColor(241, 245, 249); // slate-100
    doc.line(tableX, y + 7, pageWidth - marginX, y + 7);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85); // slate-700
    doc.text(row.label, tableX + 3, y + 5);

    // Make actual bold
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(row.actual, tableX + 55, y + 5);

    doc.setFont("Helvetica", "normal");
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(row.p25, tableX + 85, y + 5);
    doc.text(row.p50, tableX + 115, y + 5);
    doc.text(row.p75, tableX + 145, y + 5);

    y += 7;
  });

  y += 5;

  // 5. Tech Stack Information
  checkPageOverflow(25);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("DIGITAL BOOKKEEPING SYSTEMS & PROCESS SIGNALS", marginX, y);
  y += 4;

  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.rect(marginX, y, pageWidth - 2 * marginX, 15, "FD");

  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // slate-600
  doc.text("Detected Tech Stack Signals:", marginX + 4, y + 5);

  const toolsStr = metrics.digitalTools.length > 0 
    ? metrics.digitalTools.join(" • ") 
    : "No explicit digital bookkeeping system or ERP tools identified in financial statement.";

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42); // slate-900
  const wrappedTools = doc.splitTextToSize(toolsStr, pageWidth - 2 * marginX - 12);
  doc.text(wrappedTools, marginX + 4, y + 10);

  y += 22;

  // PAGE BREAK & SECOND PAGE: QUALITATIVE & PERFORMANCE RECOMMENDATIONS
  doc.addPage();
  pageCount++;
  drawPageChrome(pageCount);
  y = 25;

  // 6. Qualitative Analysis
  y += 5;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text("QUALITATIVE SME PERFORMANCE ANALYSIS", marginX, y);
  y += 5;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85); // slate-700
  
  const qualitativeText = scores.qualitativeAnalysis || "No performance analysis text generated.";
  const wrappedQualitative = doc.splitTextToSize(qualitativeText, pageWidth - 2 * marginX);
  
  // Calculate text height
  const lineHeight = 4.2;
  wrappedQualitative.forEach((line: string) => {
    checkPageOverflow(lineHeight + 5);
    doc.text(line, marginX, y);
    y += lineHeight;
  });

  y += 8;

  // 7. Actionable Recommendations
  checkPageOverflow(30);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text("ACTIONABLE BUSINESS RECOMMENDATIONS", marginX, y);
  y += 5;

  const recList = scores.recommendations && scores.recommendations.length > 0 
    ? scores.recommendations 
    : ["No specific business recommendations generated for this sector."];

  recList.forEach((rec, idx) => {
    const bullet = `${idx + 1}. `;
    const bulletText = rec;
    
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(bullet, marginX, y);

    doc.setFont("Helvetica", "normal");
    doc.setTextColor(51, 65, 85); // slate-700
    const wrappedRec = doc.splitTextToSize(bulletText, pageWidth - 2 * marginX - 8);
    
    // We render multiple lines if needed
    wrappedRec.forEach((line: string, lineIdx: number) => {
      checkPageOverflow(lineHeight + 3);
      doc.text(line, marginX + 6, y);
      if (lineIdx < wrappedRec.length - 1) {
        y += lineHeight;
      }
    });

    y += lineHeight + 3;
  });

  y += 5;

  // PAGE BREAK & THIRD PAGE: AUDIT EVIDENCE TRAIL
  doc.addPage();
  pageCount++;
  drawPageChrome(pageCount);
  y = 25;

  // 8. Audit Evidence & Traceability
  y += 5;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text("AUDIT TRAIL & TRACEABILITY LOG", marginX, y);
  y += 3;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text("Verification and justification log indicating the context extracted from files by the engine.", marginX, y);
  y += 6;

  // Verification metrics
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(marginX, y, pageWidth - 2 * marginX, 10, "F");
  
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("Extraction Confidence:", marginX + 4, y + 6);
  doc.setTextColor(79, 70, 229); // indigo-600
  doc.text(`${metrics.confidence}%`, marginX + 54, y + 6);

  doc.setFont("Helvetica", "bold");
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("Trace Logging Source:", marginX + 100, y + 6);
  doc.setFont("Helvetica", "normal");
  doc.setTextColor(51, 65, 85); // slate-700
  doc.text("Vantly Analysis Core", marginX + 134, y + 6);

  y += 15;

  // Justifications Text Log
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("Justification Logs & Extraction Sources:", marginX, y);
  y += 5;

  doc.setFont("Courier", "normal"); // Code-style monospaced font for logs
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105); // slate-600

  const traceLog = metrics.extractedJustifications || "No automated audit logs provided.";
  const wrappedTraceLog = doc.splitTextToSize(traceLog, pageWidth - 2 * marginX);

  wrappedTraceLog.forEach((line: string) => {
    checkPageOverflow(4.0 + 3);
    doc.text(line, marginX, y);
    y += 4.0;
  });

  // Save the PDF
  const safeCompanyName = companyName.toLowerCase().replace(/[^a-z0-9]/g, "_") || "sme_assessment";
  doc.save(`Vantly_Productivity_Report_${safeCompanyName}.pdf`);
}
