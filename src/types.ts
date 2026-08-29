export interface FinancialMetrics {
  companyName: string | null;
  revenue: number | null;
  headcount: number | null;
  cogs: number | null;
  payroll: number | null;
  grossMargin: number | null; // 0-100 percentage
  operatingMargin: number | null; // 0-100 percentage
  currentAssets: number | null;
  currentLiabilities: number | null;
  digitalTools: string[];
  confidence: number;
  extractedJustifications: string;
}

export interface SectorBenchmarks {
  sector: string;
  revenue_per_employee: { p25: number; p50: number; p75: number };
  output_per_payroll: { p25: number; p50: number; p75: number };
  gross_margin: { p25: number; p50: number; p75: number };
  operating_margin: { p25: number; p50: number; p75: number };
}

export interface AssessmentScores {
  labourEfficiencyScore: number; // 0-50
  labourDetails: {
    revenuePerEmployee: number;
    outputPerPayroll: number;
    revenuePerEmployeeBenchmark: number;
    outputPerPayrollBenchmark: number;
  };
  financialHealthScore: number; // 0-50
  financialDetails: {
    grossMargin: number | null;
    operatingMargin: number | null;
    currentRatio: number;
    grossMarginBenchmark: number;
    operatingMarginBenchmark: number;
  };
  productivityIndex: number; // 0-100
  digitalMaturityScore: number; // 0-100
  digitalMaturityLevel: "Low" | "Medium" | "High";
  qualitativeAnalysis: string;
  recommendations: string[];
  /** Provenance field: indicates whether recommendations came from the LLM or the hardcoded fallback. */
  recommendationSource: "llm" | "fallback";
}

export interface AssessmentRun {
  id: string;
  date: string;
  companyName: string;
  sector: string;
  fileName: string;
  fileType: "PDF" | "CSV";
  metrics: FinancialMetrics;
  scores: AssessmentScores;
  benchmarks: SectorBenchmarks;
}
