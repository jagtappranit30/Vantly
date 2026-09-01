import React, { useState } from "react";
import { Award, TrendingUp, DollarSign, Users, ShieldAlert, Cpu, Lightbulb, CheckCircle, FileText, Download, Trash2, Calendar, RefreshCw, ExternalLink, Activity, Sparkles, Building, Layers } from "lucide-react";
import { motion } from "motion/react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { AssessmentRun } from "../types";
import { useAuth } from "../context/AuthContext.tsx";
import { generateAssessmentPDF } from "../utils/pdfGenerator";
import { RAGChat } from "./RAGChat.tsx";

interface ResultsDashboardProps {
  assessment: AssessmentRun | null;
  onBack: () => void;
  onDelete?: (id: string) => void;
  isLoading?: boolean;
  loadingCompanyName?: string;
  loadingSector?: string;
}

// Custom Premium Tooltip Component
const CustomTooltip = ({ active, payload, label, formatter }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-zinc-150 p-3.5 rounded-xl shadow-xl font-sans text-2xs md:text-xs space-y-1.5 transition-all">
        <p className="font-bold text-zinc-900">{label}</p>
        {payload.map((p: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.fill || p.color || "#4f46e5" }} />
            <span className="text-zinc-450 font-bold uppercase tracking-wider">{p.name || p.dataKey}:</span>
            <span className="font-mono font-bold text-zinc-900">{formatter ? formatter(p.value) : p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Loading phase messages (stable reference outside component)
const LOADING_STEPS = ["Uploading financial statement to workspace server...", "Parsing financial statements and ledger structure...", "Scanning Balance Sheet & Profit & Loss statements...", "Extracting Revenue, COGS, and liquidity figures...", "Measuring labour productivity & payroll leverage...", "Synthesizing customized performance recommendations...", "Finalizing sector percentile benchmarks..."];

export default function ResultsDashboard({ assessment, onBack, onDelete, isLoading = false, loadingCompanyName = "Your Company", loadingSector = "Manufacturing" }: ResultsDashboardProps) {
  const { idToken, googleAccessToken, signInWithGoogle } = useAuth();
  const [activeTab, setActiveTab] = useState<"overview" | "labour" | "financial" | "digital" | "justification" | "rag">("overview");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);

  const [loadingStep, setLoadingStep] = useState(0);

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  if (isLoading || !assessment) {
    const displayCompany = loadingCompanyName || "Your Company";
    const displaySector = loadingSector || "Manufacturing";
    return (
      <div id="results-skeleton-root" className="space-y-8 max-w-5xl mx-auto">
        {/* Header Actions Skeleton */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-zinc-200">
          <div className="space-y-2">
            <button onClick={onBack} className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 transition-colors uppercase tracking-wider mb-2 cursor-pointer">
              ← Cancel and Return
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-display font-black text-zinc-900 truncate">{displayCompany}</h1>
              <span className="px-2.5 py-1 rounded-full text-2xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-150">{displaySector} Sector</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1">
              <div className="w-24 h-4 bg-zinc-200 rounded animate-pulse"></div>
              <div className="w-32 h-4 bg-zinc-200 rounded animate-pulse"></div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <div className="w-36 h-9 bg-zinc-200 rounded-xl animate-pulse"></div>
            <div className="w-28 h-9 bg-zinc-100 rounded-xl animate-pulse"></div>
          </div>
        </div>

        {/* Main Stats Bento Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Productivity Index Card Skeleton */}
          <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 text-white rounded-[2rem] p-8 shadow-2xl relative overflow-hidden flex flex-col justify-between min-h-[220px]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-[80px] opacity-25 -mr-16 -mt-16 animate-pulse"></div>

            <div className="relative z-10">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-450">Productive Point Productivity Index</span>
              <div className="flex items-baseline gap-4 mt-3">
                <div className="h-16 w-32 bg-zinc-800 rounded-2xl animate-pulse"></div>
                <div className="w-24 h-6 bg-indigo-600/30 rounded-full animate-pulse"></div>
              </div>
            </div>

            {/* Status Step Monitor integrated directly into skeleton */}
            <div className="relative z-10 border-t border-zinc-800/60 pt-5 mt-4 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
              <div className="flex-1">
                <span className="text-[10px] text-indigo-400 font-bold block uppercase tracking-wider">Analysis Phase</span>
                <span className="text-xs font-bold text-zinc-100 block truncate mt-0.5 animate-pulse">{LOADING_STEPS[loadingStep]}</span>
              </div>
              <span className="text-4xs text-zinc-400 font-bold font-mono">{Math.round(((loadingStep + 1) / LOADING_STEPS.length) * 100)}%</span>
            </div>
          </div>

          {/* Pillar Breakdown Stats Card Skeleton */}
          <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Pillar Breakouts</span>
              <div className="space-y-5 mt-5">
                {/* Labour Efficiency Pillar */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <div className="w-24 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                    <div className="w-10 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                  </div>
                  <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-zinc-300 h-full rounded-full w-1/2"></div>
                  </div>
                </div>

                {/* Financial Health Pillar */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <div className="w-24 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                    <div className="w-10 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                  </div>
                  <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-zinc-300 h-full rounded-full w-[45%]"></div>
                  </div>
                </div>

                {/* Digital Maturity Pillar */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <div className="w-24 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                    <div className="w-10 h-3.5 bg-zinc-200 rounded animate-pulse"></div>
                  </div>
                  <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-zinc-200 h-full rounded-full w-[60%]"></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="w-48 h-3.5 bg-zinc-200 rounded mt-4 animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  const { metrics, scores, benchmarks, companyName, sector, date, fileName, fileType } = assessment;

  const handleExportGoogleDoc = async () => {
    setIsExporting(true);
    setExportError(null);
    setDocUrl(null);
    try {
      if (!googleAccessToken) {
        throw new Error("Google access authorization missing. Click'Authorize Google Docs'to connect.");
      }

      const response = await fetch("/api/export-docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          assessmentId: assessment.id,
          googleAccessToken,
        }),
      });

      let data: any = null;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        if (text.includes("<!doctype") || text.includes("<!DOCTYPE") || text.includes("<html")) {
          throw new Error(`Server returned HTML error (Status ${response.status}). The server might be restarting or there is a configuration issue.`);
        }
        throw new Error(text || `Server returned error status ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(data?.error || "Failed to export report to Google Docs.");
      }

      setDocUrl(data.docUrl);
    } catch (err: unknown) {
      console.error("Export failed:", err);
      setExportError(err instanceof Error ? err.message : "Failed to export report.");
    } finally {
      setIsExporting(false);
    }
  };

  // Format currency
  const formatCurrency = (val: number | null) => {
    if (val === null) return "N/A";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(val);
  };

  // Get index status details
  const getIndexStatus = (index: number) => {
    if (index >= 67) {
      return {
        label: "Market Leader",
        colorBg: "bg-emerald-500",
        colorText: "text-emerald-700",
        colorBorder: "border-emerald-200",
        colorLightBg: "bg-emerald-50",
        desc: "Operating significantly above the sector median. Highly optimized workflows, healthy margins, and efficient labour leverage.",
        emoji: "🟢",
      };
    } else if (index >= 34) {
      return {
        label: "Median Competitor",
        colorBg: "bg-amber-500",
        colorText: "text-amber-700",
        colorBorder: "border-amber-200",
        colorLightBg: "bg-amber-50",
        desc: "Performing at par with typical sector operations. Solid foundation but substantial headroom exists to raise payroll leverage and digitize.",
        emoji: "🟡",
      };
    } else {
      return {
        label: "Underperforming",
        colorBg: "bg-rose-500",
        colorText: "text-rose-700",
        colorBorder: "border-rose-200",
        colorLightBg: "bg-rose-50",
        desc: "Currently running below sector median. Urgent strategic adjustments are recommended to address labour output leakages or thin margins.",
        emoji: "🔴",
      };
    }
  };

  const status = getIndexStatus(scores.productivityIndex);

  // Setup comparative data for charts
  const revPerEmpData = [
    { name: companyName || "SME Actual", value: scores.labourDetails.revenuePerEmployee, fill: "#4f46e5" },
    { name: `${sector} P25`, value: benchmarks.revenue_per_employee.p25, fill: "#94a3b8" },
    { name: `${sector} Median (P50)`, value: benchmarks.revenue_per_employee.p50, fill: "#64748b" },
    { name: `${sector} P75`, value: benchmarks.revenue_per_employee.p75, fill: "#334155" },
  ];

  const safeMargin = (val: number | null | undefined) => {
    if (val == null || isNaN(val)) return null;
    return Math.max(-100, Math.min(100, Math.round(val * 10) / 10));
  };

  const marginData = [
    { name: "Gross Margin %", Actual: safeMargin(scores.financialDetails.grossMargin), Median: benchmarks.gross_margin.p50 },
    { name: "Operating Margin %", Actual: safeMargin(scores.financialDetails.operatingMargin), Median: benchmarks.operating_margin.p50 },
  ];

  return (
    <div id="results-dashboard-root" className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-zinc-200">
        <div>
          <button onClick={onBack} className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 transition-colors cursor-pointer mb-2 uppercase tracking-wider">
            ← Back to Assessment Dashboard
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-display font-bold text-zinc-900 tracking-tight">{companyName}</h1>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-150/40">{sector} Sector</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-450 mt-1.5 font-medium">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              {new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              {fileName} ({fileType})
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          {exportError && <span className="text-[10px] text-rose-700 font-bold bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 max-w-xs truncate">⚠️ {exportError}</span>}

          {docUrl ? (
            <a href={docUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-750 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm hover:shadow-md">
              <ExternalLink className="w-4 h-4" />
              Open Google Doc ↗
            </a>
          ) : !googleAccessToken ? (
            <button onClick={signInWithGoogle} className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer">
              <FileText className="w-4 h-4" />
              Authorize Google Docs
            </button>
          ) : (
            <button onClick={handleExportGoogleDoc} disabled={isExporting} className="px-4 py-2.5 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:bg-zinc-100 disabled:text-zinc-400">
              {isExporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  Export to Google Doc
                </>
              )}
            </button>
          )}

          <button onClick={() => generateAssessmentPDF(assessment)} className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-transparent shadow-sm">
            <Download className="w-4 h-4" />
            Download PDF Report
          </button>

          {onDelete && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to delete this assessment?")) {
                  onDelete(assessment.id);
                }
              }}
              className="px-4 py-2.5 text-rose-600 hover:bg-rose-50 border border-rose-200/80 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Stats Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Core Productivity Index Card (High Contrast Dark Bento block) */}
        <div className="md:col-span-2 bg-zinc-900 border border-zinc-850 text-white rounded-[2rem] p-8 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[240px]">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-72 h-72 bg-indigo-500 rounded-full blur-[90px] opacity-[0.18] -mr-16 -mt-16 pointer-events-none"></div>

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Composite Benchmark Index</span>
            </div>
            <div className="flex items-baseline gap-4 mt-2">
              <h1 className="text-5xl md:text-6xl font-display font-black tracking-tight text-white leading-none">
                {scores.productivityIndex}
                <span className="text-lg text-zinc-500 font-light ml-1">/100</span>
              </h1>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${status.colorBorder} ${status.colorLightBg} ${status.colorText}`}>
                {status.emoji} {status.label}
              </span>
            </div>
            <p className="text-zinc-350 text-xs md:text-sm leading-relaxed max-w-xl font-medium">{status.desc}</p>
          </div>

          <div className="relative z-10 pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-[10px] font-mono text-zinc-500 uppercase tracking-wider mt-4">
            <span>Formula: Avg(Labour Efficiency, Financial Health)</span>
            <span>Ref: Productive Point SME Analytics Framework</span>
          </div>
        </div>

        {/* Pillar Breakdown Stats Card (White Bento block with custom shadows) */}
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm flex flex-col justify-between transition-colors duration-300">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Pillar Breakouts</span>
            <div className="space-y-6 mt-5">
              <div>
                <div className="flex justify-between text-xs font-bold text-zinc-700 mb-1.5">
                  <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                    <Users className="w-3.5 h-3.5 text-indigo-500" />
                    Labour Efficiency
                  </span>
                  <span className="font-mono text-zinc-900 font-extrabold">{scores.labourEfficiencyScore}/50</span>
                </div>
                <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${(scores.labourEfficiencyScore / 50) * 100}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold text-zinc-700 mb-1.5">
                  <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                    <DollarSign className="w-3.5 h-3.5 text-indigo-500" />
                    Financial Health
                  </span>
                  <span className="font-mono text-zinc-900 font-extrabold">{scores.financialHealthScore}/50</span>
                </div>
                <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${(scores.financialHealthScore / 50) * 100}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-bold text-zinc-700 mb-1.5">
                  <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                    Digital Maturity
                  </span>
                  <span className="font-mono text-zinc-900 font-extrabold">{scores.digitalMaturityScore}/100</span>
                </div>
                <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-zinc-900 h-full rounded-full transition-all duration-500" style={{ width: `${scores.digitalMaturityScore}%` }}></div>
                </div>
              </div>
            </div>
          </div>
          <div className="text-[9px] font-semibold uppercase text-zinc-400 border-t border-zinc-100 pt-3 mt-5">*Diagnostic metric • separated from core index</div>
        </div>
      </div>

      {/* Segmented Control Switcher Tabs */}
      <div className="bg-zinc-100 p-1.5 rounded-2xl flex border border-zinc-200/50 overflow-x-auto gap-1 scrollbar-none">
        {[
          { id: "overview", label: "Executive Overview", icon: Lightbulb },
          { id: "labour", label: "Labour Efficiency", icon: Users },
          { id: "financial", label: "Financial Health", icon: DollarSign },
          { id: "digital", label: "Digitalization", icon: Cpu },
          { id: "justification", label: "Audit Traceability", icon: FileText },
          { id: "rag", label: "Document Q&A", icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 min-w-[120px] px-3 py-2.5 rounded-xl font-bold text-2xs md:text-xs flex items-center justify-center gap-2 shrink-0 transition-all cursor-pointer ${isSelected ? "bg-white text-indigo-650 shadow-xs border border-zinc-200/30" : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/50"}`}>
              <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-indigo-600" : "text-zinc-400"}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Panels with animations */}
      <div id="results-tab-panel" className="bg-white border border-zinc-200 rounded-[2rem] p-8 shadow-sm transition-colors duration-300">
        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Executive Summary</span>
              </div>
              <h3 className="text-xl font-display font-bold text-zinc-900 tracking-tight">Qualitative SME Performance Analysis</h3>
              <p className="text-zinc-650 text-xs md:text-sm leading-relaxed whitespace-pre-line bg-zinc-50/50 p-6 rounded-2xl border border-zinc-150 font-medium">{scores.qualitativeAnalysis}</p>
            </div>

            {/* SME Vital Health Cards Layout */}
            <div className="space-y-4 pt-4 border-t border-zinc-100">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">SME Vital Account Indicators</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-zinc-50 border border-zinc-200/60 rounded-2xl">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Annual Revenue</span>
                  <span className="block font-mono text-xs md:text-sm font-extrabold text-zinc-900 mt-1">{formatCurrency(metrics.revenue)}</span>
                </div>
                <div className="p-4 bg-zinc-50 border border-zinc-200/60 rounded-2xl">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Average Headcount</span>
                  <span className="block font-mono text-xs md:text-sm font-extrabold text-zinc-900 mt-1">{metrics.headcount !== null ? `${metrics.headcount} Staff` : "N/A"}</span>
                </div>
                <div className="p-4 bg-zinc-50 border border-zinc-200/60 rounded-2xl">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Total Payroll</span>
                  <span className="block font-mono text-xs md:text-sm font-extrabold text-zinc-900 mt-1">{formatCurrency(metrics.payroll)}</span>
                </div>
                <div className="p-4 bg-zinc-50 border border-zinc-200/60 rounded-2xl">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase">Gross Profit Margin</span>
                  <span className="block font-mono text-xs md:text-sm font-extrabold text-zinc-900 mt-1">{scores.financialDetails.grossMargin}%</span>
                </div>
              </div>
            </div>

            {/* Recommendations Section */}
            <div className="pt-6 border-t border-zinc-100">
              <h3 className="text-lg font-display font-bold text-zinc-900 mb-5 flex items-center gap-2 tracking-tight">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Actionable Strategic SME Recommendations
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scores.recommendations.map((rec, idx) => (
                  <div key={idx} className="p-5 rounded-2xl border border-zinc-150 bg-white hover:border-indigo-500/25 shadow-2xs hover:shadow-sm transition-all flex gap-3.5 group">
                    <div className="w-6 h-6 rounded-full bg-indigo-50 shrink-0 text-indigo-650 flex items-center justify-center font-bold text-xs group-hover:scale-105 transition-transform">{idx + 1}</div>
                    <p className="text-zinc-600 text-xs leading-relaxed font-semibold">{rec}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "labour" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-center">
              <div className="lg:col-span-2 space-y-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-650">Pillar 1 Analysis</span>
                <h3 className="text-xl font-display font-bold text-zinc-900 tracking-tight">Labour Efficiency Analysis</h3>
                <p className="text-zinc-500 text-xs md:text-sm leading-relaxed font-medium">Labour efficiency evaluates the leverage generated from personnel capital. High efficiency signifies streamlined processes, task automation, and maximum output per employee.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150">
                    <span className="text-[10px] font-bold text-zinc-400 block uppercase tracking-wider">Revenue / Employee</span>
                    <span className="text-xl md:text-2xl font-black text-zinc-900 block mt-1 font-mono">{scores.labourDetails.revenuePerEmployee > 0 ? formatCurrency(scores.labourDetails.revenuePerEmployee) : "N/A"}</span>
                    <span className="text-[10px] font-bold text-zinc-450 block mt-1 uppercase leading-none">Sector Median: {formatCurrency(scores.labourDetails.revenuePerEmployeeBenchmark)}</span>
                  </div>

                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150">
                    <span className="text-[10px] font-bold text-zinc-400 block uppercase tracking-wider">Output / Payroll £</span>
                    <span className="text-xl md:text-2xl font-black text-zinc-900 block mt-1 font-mono">{scores.labourDetails.outputPerPayroll > 0 ? `£${scores.labourDetails.outputPerPayroll}` : "N/A"}</span>
                    <span className="text-[10px] font-bold text-zinc-450 block mt-1 uppercase leading-none">Sector Median: £{scores.labourDetails.outputPerPayrollBenchmark}</span>
                  </div>
                </div>
              </div>

              {/* Chart Visualizing Rev per Emp */}
              <div className="lg:col-span-3 bg-zinc-50/50 p-6 rounded-2xl border border-zinc-150 shadow-3xs">
                <h4 className="text-[11px] font-bold text-zinc-450 uppercase tracking-wider mb-6 text-center">Revenue per Employee Benchmark comparison</h4>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={revPerEmpData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#888888", fontWeight: 600 }} interval={0} stroke="#e4e4e7" />
                      <YAxis tickFormatter={(val) => `£${val / 1000}k`} tick={{ fontSize: 10, fill: "#888888" }} stroke="#e4e4e7" />
                      <Tooltip content={<CustomTooltip formatter={(value: any) => `£${Number(value).toLocaleString()}`} />} cursor={{ fill: "#94a3b8", fillOpacity: 0.08 }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={45}>
                        {revPerEmpData.map((entry, index) => {
                          const isActual = entry.name === (companyName || "SME Actual");
                          return <Cell key={`cell-${index}`} fill={isActual ? "#4f46e5" : "#18181b"} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "financial" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-center">
              <div className="lg:col-span-2 space-y-4">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-650">Pillar 2 Analysis</span>
                <h3 className="text-xl font-display font-bold text-zinc-900 tracking-tight">Financial Health & Liquidity breakout</h3>
                <p className="text-zinc-500 text-xs md:text-sm leading-relaxed font-medium">While productivity indices track volume, financial health ensures solvency. True corporate resilience balances high margins with deep current liquidity cushions.</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150">
                    <span className="text-[10px] font-bold text-zinc-400 block uppercase tracking-wider">Gross Margin %</span>
                    <span className="text-xl md:text-2xl font-black text-zinc-900 block mt-1 font-mono">{scores.financialDetails.grossMargin !== null ? `${scores.financialDetails.grossMargin}%` : "N/A"}</span>
                    <span className="text-[10px] font-bold text-zinc-450 block mt-1 uppercase leading-none">Sector Median: {scores.financialDetails.grossMarginBenchmark}%</span>
                  </div>

                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150">
                    <span className="text-[10px] font-bold text-zinc-400 block uppercase tracking-wider">Operating Margin %</span>
                    <span className="text-xl md:text-2xl font-black text-zinc-900 block mt-1 font-mono">{scores.financialDetails.operatingMargin !== null ? `${scores.financialDetails.operatingMargin}%` : "N/A"}</span>
                    <span className="text-[10px] font-bold text-zinc-450 block mt-1 uppercase leading-none">Sector Median: {scores.financialDetails.operatingMarginBenchmark}%</span>
                  </div>

                  <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150 sm:col-span-2">
                    <span className="text-[10px] font-bold text-zinc-400 block uppercase tracking-wider">Liquidity (Current Ratio)</span>
                    <span className="text-xl md:text-2xl font-black text-zinc-900 block mt-1 font-mono">{scores.financialDetails.currentRatio}x</span>
                    <p className="text-[11px] font-bold mt-2 leading-tight">{scores.financialDetails.currentRatio >= 1.5 ? "🟢 Healthy capital runway (Ratio >= 1.5)" : scores.financialDetails.currentRatio >= 1.0 ? "🟡 Marginal flow. Short-term obligations match assets closely." : "🔴 Squeeze risk. Cash flow assets are below short liabilities."}</p>
                  </div>
                </div>
              </div>

              {/* Comparative margins */}
              <div className="lg:col-span-3 bg-zinc-50/50 p-6 rounded-2xl border border-zinc-150 shadow-3xs">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-4">
                  <h4 className="text-[11px] font-bold text-zinc-450 uppercase tracking-wider text-center sm:text-left">Margin Benchmark Comparison (%)</h4>
                  <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider">
                    <span className="flex items-center gap-1 text-indigo-600">
                      <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600 inline-block" /> Actual
                    </span>
                    <span className="flex items-center gap-1 text-zinc-600">
                      <span className="w-2.5 h-2.5 rounded-sm bg-zinc-800 inline-block" /> Sector Median
                    </span>
                  </div>
                </div>

                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marginData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a", fontWeight: 600 }} stroke="#e4e4e7" />
                      <YAxis domain={[-100, 100]} tickFormatter={(val) => `${val}%`} tick={{ fontSize: 10, fill: "#71717a" }} stroke="#e4e4e7" />
                      <Tooltip content={<CustomTooltip formatter={(value: any) => `${value}%`} />} cursor={{ fill: "#94a3b8", fillOpacity: 0.08 }} />
                      <Bar dataKey="Actual" fill="#4f46e5" radius={[4, 4, 4, 4]} maxBarSize={40} name="Actual Performance" />
                      <Bar dataKey="Median" fill="#18181b" radius={[4, 4, 4, 4]} maxBarSize={40} name="Sector Median (P50)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "digital" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-zinc-50 rounded-2xl border border-zinc-150 flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-bold text-zinc-450 uppercase tracking-wider mb-2">Digital Maturity Diagnosis</h4>
                  <p className="text-zinc-500 text-xs leading-relaxed mb-4 font-medium">Evaluated by looking at mentions of software systems, cloud accounting tools, automated general ledgers, or payment pipelines mentioned in statements.</p>

                  <div className="flex items-center gap-3 mt-4 bg-white p-4 rounded-xl border border-zinc-150">
                    <span className="text-3xl">{scores.digitalMaturityLevel === "High" ? "⚡" : scores.digitalMaturityLevel === "Medium" ? "⚙️" : "📁"}</span>
                    <div>
                      <span className="block font-bold text-zinc-900 text-base">{scores.digitalMaturityLevel} Maturity Level</span>
                      <span className="text-[10px] text-zinc-450 font-bold font-mono uppercase">Diagnostic Score: {scores.digitalMaturityScore}/100</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-zinc-200 pt-4 mt-6">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">Detected Technology Signals:</span>
                  <div className="flex flex-wrap gap-2">
                    {metrics.digitalTools.length > 0 ? (
                      metrics.digitalTools.map((tool, idx) => (
                        <span key={idx} className="px-3 py-1.5 bg-white border border-zinc-200/80 rounded-xl text-2xs font-bold text-zinc-700 shadow-2xs">
                          🛠️ {tool}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-zinc-450 italic font-semibold">No explicit software or ERP packages detected in report.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-white border border-zinc-200 rounded-2xl flex flex-col justify-between shadow-2xs">
                <div>
                  <h4 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">Operational Leverage Pathways</h4>
                  <p className="text-zinc-600 text-xs leading-relaxed font-medium">
                    {scores.digitalPathwayAnalysis || (
                      scores.digitalMaturityLevel === "High"
                        ? `${companyName} displays advanced digital readiness in ${sector} (${metrics.digitalTools.join(", ") || "integrated software"}). This infrastructure provides high operational leverage against sector benchmarks.`
                        : scores.digitalMaturityLevel === "Medium"
                        ? `${companyName} exhibits foundational digital capabilities in ${sector} (${metrics.digitalTools.join(", ") || "core tools"}). Bridging operational workflows can accelerate labour output toward upper benchmark tiers.`
                        : `${companyName} operates with undisclosed or legacy software in ${sector}. Migrating core workflows to modern cloud systems offers immediate operational leverage.`
                    )}
                  </p>
                </div>

                <div className="pt-5 border-t border-zinc-150 mt-6 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/70">
                  <span className="text-[10px] text-indigo-700 font-bold block mb-1.5 uppercase tracking-wider">💡 Automation Recommendation:</span>
                  <p className="text-zinc-700 text-xs leading-relaxed italic font-medium">
                    {scores.digitalRecommendation || (
                      scores.digitalMaturityLevel === "Low"
                        ? `Deploy a unified cloud accounting platform (e.g. Xero or QuickBooks) to replace manual processes and automate bookkeeping in ${sector}.`
                        : scores.digitalMaturityLevel === "Medium"
                        ? `Connect automated receipt capture and bank feed sync to ${metrics.digitalTools[0] || "existing accounting software"} to shorten invoice-to-cash latency.`
                        : `Integrate real-time API webhooks between client management, operations, and general ledgers to maximise enterprise efficiency.`
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "justification" && (
          <div className="space-y-6">
            <div className="flex items-start gap-4 p-5 bg-zinc-50 border border-zinc-150 rounded-2xl">
              <FileText className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-zinc-900">Audit & Document Traceability</h4>
                <p className="text-xs text-zinc-500 leading-relaxed mt-0.5 font-medium">To assure strict audit traceability required in commercial reports, the system indexes the exact audit traces for each processed field.</p>
              </div>
            </div>

            {/* Data Verification Guard */}
            <div className="p-6 bg-amber-500/5 border border-amber-500/20 rounded-2xl space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                  <ShieldAlert className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-xs font-bold text-zinc-900">Direct Data Verification Guard</h4>
                  <p className="text-[10px] text-zinc-450 font-bold uppercase tracking-wider">Passive Document Verification Protocol</p>
                </div>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed font-semibold">
                To maintain analytical precision and rigor, Productive Point operates on a strict <strong className="text-indigo-600 font-extrabold">Direct-Evidence constraint</strong>. If a financial metric is not explicitly stated in your uploaded accounts or mathematically derivable with absolute certainty, the system returns <code className="px-1 py-0.5 rounded bg-zinc-100 font-mono font-bold text-[10px]">null (N/A)</code> rather than guessing or interpolating.
              </p>

              {/* Checkbox status checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                {[
                  { name: "Annual Gross Revenue", found: metrics.revenue !== null },
                  { name: "Average Employee Headcount", found: metrics.headcount !== null },
                  { name: "Cost of Goods Sold (COGS)", found: metrics.cogs !== null },
                  { name: "Annual Wages & Payroll", found: metrics.payroll !== null },
                  { name: "Balance Sheet Assets", found: metrics.currentAssets !== null },
                  { name: "Balance Sheet Liabilities", found: metrics.currentLiabilities !== null },
                ].map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-zinc-150 shadow-2xs">
                    <span className="text-xs font-bold text-zinc-700">{m.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${m.found ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-amber-50 text-amber-700 border border-amber-100"}`}>{m.found ? "✓ Verified Source" : "∅ N/A (No Guessing)"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-zinc-150 rounded-2xl overflow-hidden shadow-2xs">
              <div className="grid grid-cols-2 bg-zinc-50 p-3.5 border-b border-zinc-150 text-[10px] font-bold text-zinc-450 uppercase tracking-wider">
                <span>financial field</span>
                <span>extracted value</span>
              </div>
              <div className="divide-y divide-zinc-100 text-sm">
                {[
                  { label: "Annual Gross Revenue", value: formatCurrency(metrics.revenue) },
                  { label: "Reported Average Headcount", value: metrics.headcount !== null ? `${metrics.headcount} employees` : "N/A" },
                  { label: "Cost of Goods Sold (COGS)", value: formatCurrency(metrics.cogs) },
                  { label: "Annual Wage Payroll Cost", value: formatCurrency(metrics.payroll) },
                  { label: "Reported Gross Profit Margin", value: metrics.grossMargin !== null ? `${metrics.grossMargin}%` : "N/A" },
                  { label: "Reported Operating Profit Margin", value: metrics.operatingMargin !== null ? `${metrics.operatingMargin}%` : "N/A" },
                  { label: "Balance Sheet Current Assets", value: formatCurrency(metrics.currentAssets) },
                  { label: "Balance Sheet Current Liabilities", value: formatCurrency(metrics.currentLiabilities) },
                ].map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 p-3.5 hover:bg-zinc-50/20 transition-all">
                    <span className="font-bold text-zinc-800 text-xs">{item.label}</span>
                    <span className="font-mono text-xs text-zinc-950 font-black">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 bg-zinc-50 rounded-2xl border border-zinc-150">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">Audit Trace Log:</span>
              <p className="text-xs text-zinc-650 font-mono leading-relaxed whitespace-pre-wrap bg-white p-4 rounded-xl border border-zinc-200 font-semibold shadow-2xs">{metrics.extractedJustifications}</p>
              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-zinc-400 mt-3.5">
                <span>Extraction Engine: Productive Point Core</span>
                <span>Trace Confidence: {metrics.confidence}%</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "rag" && <RAGChat docId={assessment.id} companyName={companyName} fileName={fileName} />}
      </div>
    </div>
  );
}
