import React, { useState, useRef } from "react";
import { Upload, FileText, AlertCircle, RefreshCw, Check, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../context/AuthContext.tsx";

interface UploadFormProps {
  onStartAssessment: (file: File, sector: string, companyName: string) => void;
  isLoading: boolean;
  error: string | null;
  setError: (val: string | null) => void;
}

const SECTORS = [
  { id: "Manufacturing", name: "Manufacturing", icon: "🏭", desc: "Production, assembly, and industrial operations" },
  { id: "Services", name: "Professional Services", icon: "💼", desc: "Consulting, B2B services, and client delivery" },
  { id: "Retail", name: "Retail & Commerce", icon: "🛒", desc: "Brick-and-mortar, e-commerce, and logistics" },
  { id: "Other", name: "Other / General", icon: "📦", desc: "General SME operations across other sectors" },
];

export default function UploadForm({ onStartAssessment, isLoading, error, setError }: UploadFormProps) {
  const { idToken } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [sector, setSector] = useState("Manufacturing");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndSetFile = (selectedFile: File) => {
    setError(null);
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "csv") {
      setError("Unsupported format. Please upload a PDF or CSV document.");
      return;
    }
    if (selectedFile.size > 15 * 1024 * 1024) {
      setError("File exceeds 15MB limit. Please upload a smaller document.");
      return;
    }
    setFile(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please upload a financial document to continue.");
      return;
    }
    onStartAssessment(file, sector, companyName);
  };

  return (
    <div id="upload-form-container" className="w-full">
      <AnimatePresence mode="wait">
        <motion.form
          key="form-state"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          onSubmit={handleSubmit}
          className="space-y-8 bg-white border border-zinc-200 rounded-[2rem] p-8 md:p-10 shadow-[0_12px_40px_rgba(0,0,0,0.03)] transition-colors duration-300"
        >
          {/* Form Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-100 pb-6">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-650 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100/50 ">
                Financial Analyzer
              </span>
              <h2 className="text-2xl md:text-3xl font-display font-bold text-zinc-900 mt-3 tracking-tight">
                New Productivity Assessment
              </h2>
              <p className="text-zinc-500 font-medium text-xs md:text-sm mt-1 leading-relaxed">
                Provide basic company details and upload accounts to benchmark performance against UK sectors.
              </p>
            </div>
            <div className="hidden md:flex items-center gap-1 text-zinc-450 text-[11px] font-semibold bg-zinc-50 px-3 py-1.5 rounded-xl border border-zinc-200/50 ">
              <Info className="w-3.5 h-3.5 text-indigo-500" />
              Automated Analysis
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-rose-50 border border-rose-100 text-rose-850 rounded-2xl flex items-start gap-3 text-xs md:text-sm shadow-2xs"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-650 mt-0.5" />
              <div>
                <span className="font-bold">Analysis Blocked: </span>
                {error}
              </div>
            </motion.div>
          )}

          {/* General Information Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="company-name" className="block text-[11px] font-bold text-zinc-450 uppercase tracking-wider mb-2">
                Company Name <span className="text-zinc-400 font-light lowercase">(optional)</span>
              </label>
              <input
                id="company-name"
                type="text"
                placeholder="e.g. Sterling Manufacturing Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white text-zinc-800 placeholder:text-zinc-400/80 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm shadow-2xs"
              />
            </div>

            <div>
              <label htmlFor="sector-select" className="block text-[11px] font-bold text-zinc-450 uppercase tracking-wider mb-2">
                Business Sector
              </label>
              <div className="relative">
                <select
                  id="sector-select"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="w-full appearance-none px-4 py-3 rounded-xl border border-zinc-200 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-sm shadow-2xs cursor-pointer"
                >
                  {SECTORS.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.icon} {sec.name}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-400">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Sector Visual Selector Cards */}
          <div className="space-y-3">
            <span className="block text-[11px] font-bold text-zinc-450 uppercase tracking-wider">
              Selected Sector Context
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {SECTORS.map((sec) => {
                const isSelected = sector === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setSector(sec.id)}
                    className={`text-left p-5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group hover:scale-[1.01] ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/20 ring-1 ring-indigo-650/10"
                        : "border-zinc-200/80 hover:border-zinc-300 bg-white shadow-2xs"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-3xl filter drop-shadow-sm">{sec.icon}</span>
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center scale-90">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <span className={`block font-bold text-xs ${isSelected ? "text-indigo-650 font-extrabold" : "text-zinc-800 "}`}>
                      {sec.name}
                    </span>
                    <span className="block text-[11px] text-zinc-400 mt-1 leading-snug font-medium">
                      {sec.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Document Upload Area */}
          <div className="space-y-3">
            <label className="block text-[11px] font-bold text-zinc-450 uppercase tracking-wider">
              Financial Document Upload
            </label>
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
              className={`border-2 border-dashed rounded-[2rem] p-8 md:p-12 text-center cursor-pointer transition-all relative overflow-hidden group ${
                dragActive
                  ? "border-indigo-600 bg-indigo-50/10 shadow-indigo-100/10 "
                  : file
                  ? "border-zinc-300 bg-zinc-55/30 hover:bg-zinc-50/40 "
                  : "border-zinc-200 hover:border-indigo-500/80 hover:bg-indigo-50/5 "
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.csv"
                onChange={handleFileChange}
                className="hidden"
              />

              {file ? (
                <div className="flex flex-col items-center max-w-sm mx-auto">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 shadow-sm border border-indigo-100 ">
                    <FileText className="w-6 h-6 animate-pulse" />
                  </div>
                  <span className="block font-bold text-zinc-800 text-sm truncate max-w-full mb-1 px-2">
                    {file.name}
                  </span>
                  <span className="block text-[11px] font-mono font-medium text-zinc-400 mb-5 bg-zinc-100 px-2.5 py-1 rounded-full">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.name.split(".").pop()?.toUpperCase()} Document
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer transition-colors px-3 py-1.5 rounded-lg hover:bg-rose-50 "
                  >
                    Remove Document
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-50 border border-zinc-150 flex items-center justify-center text-zinc-400 group-hover:text-indigo-500 group-hover:border-indigo-500/30 transition-all mb-4 shadow-3xs">
                    <Upload className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  </div>
                  <span className="block font-bold text-zinc-800 text-sm mb-1 tracking-tight">
                    Drag & drop your financial statements here
                  </span>
                  <span className="block text-xs text-zinc-400 mb-5 font-medium max-w-md mx-auto leading-relaxed">
                    Supports standard PDF or CSV accounting statements (e.g. P&L, Balance Sheets) up to 15MB
                  </span>
                  <button
                    type="button"
                    className="px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-850 rounded-xl text-xs font-bold transition-all cursor-pointer border border-transparent shadow-3xs group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-[1.02]"
                  >
                    Select Document
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end pt-5 border-t border-zinc-100 ">
            <button
              type="submit"
              disabled={!file || isLoading}
              className={`px-6 py-3.5 rounded-xl font-bold text-sm shadow-md flex items-center gap-2 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99] ${
                file && !isLoading
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 hover:shadow-lg"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none border border-transparent "
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Analyzing Document...
                </>
              ) : (
                <>
                  🚀 Calculate Productivity Index
                </>
              )}
            </button>
          </div>
        </motion.form>
      </AnimatePresence>
    </div>
  );
}
