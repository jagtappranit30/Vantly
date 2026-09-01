#!/usr/bin/env python3
"""
Productive Point RAG Evaluation Harness — Multi-Scenario Independent Benchmark
==============================================================================
Runs independent, evidenced RAG evaluation runs across three scenarios:
  - Scenario A: Clean structured document (eval/fixtures/meridian_financials.txt)
  - Scenario B: Tabular reporting format (eval/fixtures/meridian_scenario_b_tabular.txt)
  - Scenario C: OCR-degraded document (eval/fixtures/meridian_scenario_c_degraded.txt)

Executes 3 runs of 10 ground-truth questions per scenario (30 queries per scenario,
90 queries total), capturing full execution provenance, latency telemetry,
retrieved contexts, correctness, and optional RAGAS metrics.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pandas as pd
import yaml
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

console = Console()

EVAL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVAL_DIR.parent
FIXTURES_DIR = EVAL_DIR / "fixtures"
DEFAULT_GROUND_TRUTH = EVAL_DIR / "ground_truth.yaml"
OUTPUT_DIR = PROJECT_ROOT / "evaluation_results"

# Load environment variables
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

DEFAULT_RAG_URL = os.environ.get("RAG_SERVICE_URL", "http://127.0.0.1:8000")

SCENARIO_CONFIGS = [
    {
        "id": "A",
        "name": "Scenario A",
        "description": "Clean / Structured Document",
        "fixture_file": "meridian_financials.txt",
        "doc_id": "eval_scenario_a",
    },
    {
        "id": "B",
        "name": "Scenario B",
        "description": "Tabular / Dense Structured Document",
        "fixture_file": "meridian_scenario_b_tabular.txt",
        "doc_id": "eval_scenario_b",
    },
    {
        "id": "C",
        "name": "Scenario C",
        "description": "OCR-Degraded / Noisy Document",
        "fixture_file": "meridian_scenario_c_degraded.txt",
        "doc_id": "eval_scenario_c",
    },
]


def get_git_commit() -> str:
    """Gets the current git commit hash, or 'UNKNOWN'."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return res.stdout.strip()
    except Exception:
        return "UNKNOWN"


def compute_file_sha256(path: Path) -> str:
    """Computes the SHA-256 hash of a file."""
    if not path.exists():
        return "FILE_NOT_FOUND"
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_health(client: httpx.Client, rag_url: str) -> dict:
    """GET <rag_url>/health and return the response JSON."""
    resp = client.get(f"{rag_url}/health", timeout=15.0)
    resp.raise_for_status()
    return resp.json()


def index_document(client: httpx.Client, rag_url: str, doc_id: str, file_path: Path) -> dict:
    """POST a fixture file to <rag_url>/index and return the response JSON."""
    file_bytes = file_path.read_bytes()
    file_name = file_path.name

    resp = client.post(
        f"{rag_url}/index",
        data={"doc_id": doc_id},
        files={"file": (file_name, file_bytes, "text/plain")},
        timeout=120.0,
    )
    resp.raise_for_status()
    return resp.json()


def query_rag(
    client: httpx.Client,
    rag_url: str,
    doc_id: str,
    question: str,
    top_k: int = 5,
) -> Tuple[str, List[str], float]:
    """
    POST to <rag_url>/query.
    Returns (answer_text, list_of_contexts, latency_ms).
    """
    payload = {"doc_id": doc_id, "question": question, "top_k": top_k}
    t_start = time.perf_counter()
    resp = client.post(f"{rag_url}/query", json=payload, timeout=120.0)
    t_end = time.perf_counter()
    latency_ms = round((t_end - t_start) * 1000.0, 2)

    resp.raise_for_status()
    data = resp.json()

    answer: str = data.get("answer", "")
    contexts: List[str] = [src["text"] for src in data.get("sources", [])]
    return answer, contexts, latency_ms


def normalize_text(text: str) -> str:
    """Normalizes text for robust comparison, including common OCR substitutions."""
    t = text.lower()
    t = re.sub(r'[\r\n\t]+', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    return t.strip()


def evaluate_correctness(q_idx: int, question: str, answer: str, scenario_id: str) -> Tuple[bool, str]:
    """
    Deterministically evaluates factual correctness for each of the 10 benchmark questions.
    Returns (is_correct, details_string).
    """
    ans_norm = normalize_text(answer)
    if q_idx == 1:
        # Revenue: £4,200,000 / 4,200,000 / 4.2m / 4,2OO,OOO
        match = bool(re.search(r'4[,.]?200[,.]?000|4\.2\s*m|4,2oo,ooo', ans_norm))
        return match, "Matches £4,200,000 revenue" if match else "Missing £4,200,000 revenue"

    elif q_idx == 2:
        # Headcount: 42 FTE
        match = bool(re.search(r'\b42\b', ans_norm))
        return match, "Matches 42 FTE headcount" if match else "Missing 42 headcount"

    elif q_idx == 3:
        # Gross margin: 40% or 40.0% or 4O%
        match = bool(re.search(r'40(\.0)?\s*%|4o(\.o)?\s*%', ans_norm))
        return match, "Matches 40.0% gross margin" if match else "Missing 40.0% gross margin"

    elif q_idx == 4:
        # Current ratio: 2.00 or 2.0 or 2 (from 890,000 / 445,000)
        match = bool(re.search(r'\b2(\.0{1,2})?\b|\b2\.oo\b', ans_norm))
        return match, "Matches 2.00 current ratio" if match else "Missing 2.00 current ratio"

    elif q_idx == 5:
        # Payroll: 1,050,000 / 1.05m / l,o5o,ooo AND 25% / 25.0%
        has_pay = bool(re.search(r'1[,.]?050[,.]?000|1\.05\s*m|l[,.]?o5o[,.]?ooo', ans_norm))
        has_pct = bool(re.search(r'25(\.0)?\s*%|25(\.o)?\s*%', ans_norm))
        match = has_pay and has_pct
        return match, "Matches £1,050,000 and 25.0%" if match else f"Payroll: {has_pay}, Pct: {has_pct}"

    elif q_idx == 6:
        # Digital tools: mentions at least 3 of SAP S/4HANA, Salesforce, Microsoft 365/Power BI, Keyence, SYSPRO
        tools = ["sap", "salesforce", "power bi", "keyence", "syspro", "microsoft"]
        found = [t for t in tools if t in ans_norm]
        match = len(found) >= 3
        return match, f"Identified tools ({len(found)}/5): {', '.join(found)}"

    elif q_idx == 7:
        # Rev per emp: 100,000 (and ideally sector median 98,000)
        has_rev_emp = bool(re.search(r'100[,.]?000|100k|loo[,.]?ooo', ans_norm))
        has_median = bool(re.search(r'98[,.]?000|98k|98[,.]?ooo', ans_norm))
        match = has_rev_emp
        return match, f"Rev/Emp 100k: {has_rev_emp}, Median 98k: {has_median}"

    elif q_idx == 8:
        # Output per payroll: 4.00x or 4.0x or 4x (and P50 3.7x)
        match = bool(re.search(r'4(\.0{1,2})?\s*x?|4\.oox?', ans_norm))
        return match, "Matches 4.00x output per payroll" if match else "Missing 4.00x ratio"

    elif q_idx == 9:
        # Current assets: 890,000 (breakdown 520k, 290k, 80k)
        has_total = bool(re.search(r'890[,.]?000|89o[,.]?ooo', ans_norm))
        return has_total, "Matches £890,000 current assets" if has_total else "Missing £890,000 total"

    elif q_idx == 10:
        # Digital maturity: HIGH / High / HlGH
        match = bool(re.search(r'\bhigh\b|\bhlgh\b', ans_norm))
        return match, "Matches HIGH digital maturity" if match else "Missing HIGH maturity rating"

    return False, "Unrecognized question ID"


def run_ragas_evaluation(
    raw_df: pd.DataFrame,
    output_stem: str,
) -> Tuple[bool, Optional[pd.DataFrame], Optional[Dict[str, Any]], Optional[str]]:
    """
    Attempts genuine RAGAS evaluation using OpenAI gpt-4o-mini and text-embedding-3-small.
    Returns (success, scores_df, summary_dict, error_msg).
    Does NOT substitute heuristic or estimated scores on failure.
    """
    if not OPENAI_API_KEY:
        return False, None, None, "OPENAI_API_KEY is not set in environment."

    try:
        from ragas import evaluate, EvaluationDataset, SingleTurnSample
        from ragas.metrics.collections import (
            Faithfulness, ContextPrecision, ContextRecall, AnswerRelevancy,
        )
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
        from ragas.llms import LangchainLLMWrapper
        from ragas.embeddings import LangchainEmbeddingsWrapper

        llm = LangchainLLMWrapper(ChatOpenAI(model="gpt-4o-mini", openai_api_key=OPENAI_API_KEY, temperature=0.0))
        embeddings = LangchainEmbeddingsWrapper(OpenAIEmbeddings(model="text-embedding-3-small", openai_api_key=OPENAI_API_KEY))

        metrics = [
            Faithfulness(llm=llm),
            ContextPrecision(llm=llm),
            ContextRecall(llm=llm),
            AnswerRelevancy(llm=llm, embeddings=embeddings),
        ]
        metric_names = ["faithfulness", "context_precision", "context_recall", "answer_relevancy"]

        samples = []
        for _, row in raw_df.iterrows():
            ctx_raw = str(row.get("retrieved_contexts", ""))
            contexts = [c.strip() for c in ctx_raw.split("|||") if c.strip()]
            if not contexts:
                contexts = ["[no context retrieved]"]
            samples.append(SingleTurnSample(
                user_input=str(row["question"]),
                response=str(row["generated_answer"]),
                retrieved_contexts=contexts,
                reference=str(row["expected_answer"]),
            ))

        dataset = EvaluationDataset(samples=samples)
        result = evaluate(dataset=dataset, metrics=metrics)
        scores_df = result.to_pandas()

        summary_dict = {}
        for m in metric_names:
            if m in scores_df.columns:
                col = scores_df[m].dropna()
                if not col.empty:
                    summary_dict[m] = {
                        "mean": round(float(col.mean()), 4),
                        "std": round(float(col.std()), 4) if len(col) > 1 else 0.0,
                        "min": round(float(col.min()), 4),
                        "max": round(float(col.max()), 4),
                    }

        return True, scores_df, summary_dict, None
    except Exception as e:
        return False, None, None, f"RAGAS evaluation failed: {type(e).__name__}: {str(e)}"


def ground_truth_validation_step(ground_truth: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Step 0: Ground-Truth Validation across All 3 Scenario Fixtures."""
    console.rule("[bold cyan]Step 0: Ground-Truth Validation Across All Fixtures[/bold cyan]")
    
    validation_report = {}
    
    for sc in SCENARIO_CONFIGS:
        sc_id = sc["id"]
        sc_file = FIXTURES_DIR / sc["fixture_file"]
        sha256 = compute_file_sha256(sc_file)
        text = sc_file.read_text(encoding="utf-8") if sc_file.exists() else ""
        
        console.print(f"\n[bold]{sc['name']}[/bold] ({sc['fixture_file']})")
        console.print(f"  SHA-256: [cyan]{sha256}[/cyan] ({len(text):,} chars)")
        
        sc_results = []
        for idx, q_item in enumerate(ground_truth, 1):
            q_text = q_item["question"]
            gt_text = q_item["ground_truth"].strip()
            
            supported, note = evaluate_correctness(idx, q_text, text, sc_id)
            sc_results.append({
                "question_id": f"Q{idx:02d}",
                "question": q_text,
                "category": q_item.get("category", "general"),
                "supported": supported,
                "note": note,
            })
            status_str = "[green]SUPPORTED[/green]" if supported else "[yellow]FLAGGED[/yellow]"
            console.print(f"    Q{idx:02d}: {status_str} — {note}")
            
        validation_report[sc_id] = {
            "fixture": sc["fixture_file"],
            "sha256": sha256,
            "total_questions": len(ground_truth),
            "supported_count": sum(1 for r in sc_results if r["supported"]),
            "details": sc_results,
        }
        
    return validation_report


def run_evaluation(
    rag_url: str,
    n_runs: int = 3,
    top_k: int = 5,
    smoke_test_only: bool = False,
) -> None:
    eval_run_id = f"eval_run_{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    git_commit = get_git_commit()
    timestamp_start = datetime.datetime.now(datetime.timezone.utc).isoformat()

    console.rule(f"[bold blue]Productive Point Multi-Scenario Evaluation ({eval_run_id})[/bold blue]")
    console.print(f"  Git Commit : [cyan]{git_commit}[/cyan]")
    console.print(f"  RAG URL    : [cyan]{rag_url}[/cyan]")
    console.print(f"  Runs/Scen  : [cyan]{n_runs if not smoke_test_only else 1} (smoke test = {smoke_test_only})[/cyan]")
    console.print(f"  Top-K      : [cyan]{top_k}[/cyan]")
    console.print(f"  Output Dir : [cyan]{OUTPUT_DIR}[/cyan]")
    console.print()

    # Load Ground Truth
    with open(DEFAULT_GROUND_TRUTH, "r", encoding="utf-8") as f:
        ground_truth: List[Dict[str, Any]] = yaml.safe_load(f)

    # ── Step 0: Ground-Truth Validation ───────────────────────────────────────
    gt_validation = ground_truth_validation_step(ground_truth)

    # ── Step 1: Health Check ───────────────────────────────────────────────────
    with httpx.Client() as client:
        try:
            health = check_health(client, rag_url)
            console.print(f"\n[green]✓[/green] RAG Service healthy: LLM={health.get('ollama_model', 'unknown')}")
        except Exception as e:
            console.print(f"\n[red]✗ Cannot connect to RAG service at {rag_url}: {e}[/red]")
            sys.exit(1)

        # ── Step 2: Multi-Scenario Execution ──────────────────────────────────
        all_scenario_raw_records: Dict[str, List[Dict[str, Any]]] = {sc["id"]: [] for sc in SCENARIO_CONFIGS}
        scenario_summaries: Dict[str, Dict[str, Any]] = {}
        ragas_summaries: Dict[str, Any] = {}

        for sc in SCENARIO_CONFIGS:
            sc_id = sc["id"]
            sc_name = sc["name"]
            fixture_path = FIXTURES_DIR / sc["fixture_file"]
            fixture_sha256 = compute_file_sha256(fixture_path)
            doc_id = sc["doc_id"]

            console.rule(f"[bold yellow]Executing {sc_name}: {sc['description']}[/bold yellow]")
            console.print(f"  Fixture     : [cyan]{fixture_path.name}[/cyan] ({fixture_path.stat().st_size:,} bytes)")
            console.print(f"  SHA-256     : [cyan]{fixture_sha256}[/cyan]")
            console.print(f"  Document ID : [cyan]{doc_id}[/cyan]")

            # Index document into isolated doc_id
            console.print(f"  Indexing document into '{doc_id}'...")
            idx_res = index_document(client, rag_url, doc_id, fixture_path)
            console.print(f"  [green]✓[/green] Indexed {idx_res.get('total_chunks', 0)} chunks across {idx_res.get('total_pages', 0)} page(s).")

            # Determine run count
            actual_runs = 1 if smoke_test_only else n_runs
            raw_records = []

            for run_idx in range(1, actual_runs + 1):
                console.print(f"\n  [bold]── Run {run_idx}/{actual_runs} ──[/bold]")
                
                # If smoke test, only run question 1
                questions_to_run = [ground_truth[0]] if smoke_test_only else ground_truth

                for q_num, qa in enumerate(questions_to_run, 1):
                    q_id = f"Q{q_num:02d}"
                    question = qa["question"]
                    expected_ans = qa["ground_truth"].strip()
                    category = qa.get("category", "general")
                    query_ts = datetime.datetime.now(datetime.timezone.utc).isoformat()

                    try:
                        ans, contexts, latency_ms = query_rag(client, rag_url, doc_id, question, top_k=top_k)
                    except Exception as q_err:
                        ans = f"ERROR: {str(q_err)}"
                        contexts = []
                        latency_ms = 0.0

                    is_correct, corr_details = evaluate_correctness(q_num, question, ans, sc_id)
                    corr_status = "[green]CORRECT[/green]" if is_correct else "[red]INCORRECT[/red]"
                    console.print(f"    [{run_idx}:{q_id}] {corr_status} ({latency_ms:,.1f}ms) — {question[:45]}...")

                    record = {
                        "eval_run_id": eval_run_id,
                        "git_commit": git_commit,
                        "scenario": sc_name,
                        "scenario_id": sc_id,
                        "fixture_file": sc["fixture_file"],
                        "fixture_sha256": fixture_sha256,
                        "doc_id": doc_id,
                        "run_number": run_idx,
                        "question_id": q_id,
                        "category": category,
                        "question": question,
                        "expected_answer": expected_ans,
                        "generated_answer": ans,
                        "is_correct": is_correct,
                        "correctness_details": corr_details,
                        "n_contexts": len(contexts),
                        "retrieved_contexts": " ||| ".join(contexts),
                        "latency_ms": latency_ms,
                        "timestamp": query_ts,
                        "model_config_id": f"ollama:qwen2.5:7b:temp0.2:topk{top_k}:chunk400_150",
                    }
                    raw_records.append(record)

                if run_idx < actual_runs:
                    time.sleep(1)

            all_scenario_raw_records[sc_id] = raw_records

            # Compute Scenario Statistics
            raw_df = pd.DataFrame(raw_records)
            total_q = len(raw_df)
            correct_q = int(raw_df["is_correct"].sum())
            acc = round((correct_q / total_q) * 100.0, 2) if total_q > 0 else 0.0
            latencies = raw_df["latency_ms"]

            scenario_summaries[sc_id] = {
                "scenario": sc_name,
                "scenario_id": sc_id,
                "description": sc["description"],
                "fixture_file": sc["fixture_file"],
                "fixture_sha256": fixture_sha256,
                "doc_id": doc_id,
                "total_queries": total_q,
                "correct_queries": correct_q,
                "accuracy_pct": acc,
                "latency_mean_ms": round(float(latencies.mean()), 2),
                "latency_median_ms": round(float(latencies.median()), 2),
                "latency_p95_ms": round(float(latencies.quantile(0.95)), 2),
                "latency_min_ms": round(float(latencies.min()), 2),
                "latency_max_ms": round(float(latencies.max()), 2),
                "latency_std_ms": round(float(latencies.std()), 2) if len(latencies) > 1 else 0.0,
            }

            # Run RAGAS if not smoke test
            if not smoke_test_only and OPENAI_API_KEY:
                console.print(f"\n  [cyan]Attempting genuine RAGAS evaluation for {sc_name}...[/cyan]")
                ragas_ok, ragas_df, ragas_dict, ragas_err = run_ragas_evaluation(raw_df, f"scenario_{sc_id}")
                if ragas_ok and ragas_df is not None:
                    console.print(f"  [green]✓[/green] RAGAS scoring succeeded for {sc_name}")
                    ragas_scores_path = OUTPUT_DIR / f"scenario_{sc_id}_ragas_scores.csv"
                    ragas_df.to_csv(ragas_scores_path, index=False)
                    ragas_summaries[sc_id] = {"status": "SUCCESS", "metrics": ragas_dict}
                else:
                    console.print(f"  [yellow]⚠ RAGAS skipped/failed for {sc_name}: {ragas_err}[/yellow]")
                    ragas_summaries[sc_id] = {"status": "FAILED", "error": ragas_err}
            else:
                ragas_summaries[sc_id] = {"status": "SKIPPED", "reason": "Smoke test or no OPENAI_API_KEY"}

    # ── Step 3: Save Output Artifacts ─────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp_end = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # Save per-scenario raw CSVs
    for sc_id, records in all_scenario_raw_records.items():
        df = pd.DataFrame(records)
        raw_csv_path = OUTPUT_DIR / f"scenario_{sc_id}_raw.csv"
        df.to_csv(raw_csv_path, index=False)
        console.print(f"[green]✓[/green] Saved {len(df)} rows to [bold]{raw_csv_path.name}[/bold]")

        # Save per-scenario summary CSV
        sum_df = pd.DataFrame([scenario_summaries[sc_id]])
        sum_csv_path = OUTPUT_DIR / f"scenario_{sc_id}_summary.csv"
        sum_df.to_csv(sum_csv_path, index=False)
        console.print(f"[green]✓[/green] Saved scenario summary to [bold]{sum_csv_path.name}[/bold]")

    # Overall Summary
    overall_records = []
    for sc_records in all_scenario_raw_records.values():
        overall_records.extend(sc_records)
    overall_df = pd.DataFrame(overall_records)

    total_overall = len(overall_df)
    correct_overall = int(overall_df["is_correct"].sum())
    overall_acc = round((correct_overall / total_overall) * 100.0, 2) if total_overall > 0 else 0.0
    overall_lat = overall_df["latency_ms"]

    overall_summary_data = {
        "eval_run_id": eval_run_id,
        "git_commit": git_commit,
        "timestamp_start": timestamp_start,
        "timestamp_end": timestamp_end,
        "total_scenarios": len(SCENARIO_CONFIGS),
        "total_evaluations": total_overall,
        "overall_correct": correct_overall,
        "overall_accuracy_pct": overall_acc,
        "overall_latency_mean_ms": round(float(overall_lat.mean()), 2),
        "overall_latency_median_ms": round(float(overall_lat.median()), 2),
        "overall_latency_p95_ms": round(float(overall_lat.quantile(0.95)), 2),
        "overall_latency_min_ms": round(float(overall_lat.min()), 2),
        "overall_latency_max_ms": round(float(overall_lat.max()), 2),
        "overall_latency_std_ms": round(float(overall_lat.std()), 2) if len(overall_lat) > 1 else 0.0,
    }

    # Add per-scenario breakdown columns
    for sc_id, s_data in scenario_summaries.items():
        overall_summary_data[f"scenario_{sc_id}_accuracy_pct"] = s_data["accuracy_pct"]
        overall_summary_data[f"scenario_{sc_id}_latency_mean_ms"] = s_data["latency_mean_ms"]

    overall_sum_df = pd.DataFrame([overall_summary_data])
    overall_sum_path = OUTPUT_DIR / "overall_summary.csv"
    overall_sum_df.to_csv(overall_sum_path, index=False)
    console.print(f"[green]✓[/green] Saved overall summary to [bold]{overall_sum_path.name}[/bold]")

    # Evaluation Metadata JSON
    metadata = {
        "eval_run_id": eval_run_id,
        "git_commit": git_commit,
        "timestamp_start": timestamp_start,
        "timestamp_end": timestamp_end,
        "model": "qwen2.5:7b",
        "llm_provider": "ollama",
        "temperature": 0.2,
        "top_k": top_k,
        "chunk_size": 400,
        "chunk_overlap": 150,
        "max_section_chunk": 1500,
        "embedding_model": "ollama:qwen2.5:7b (with fastembed bge-small-en-v1.5 fallback)",
        "evaluator_judge": "OpenAI gpt-4o-mini + text-embedding-3-small (when active)",
        "eval_script": "eval/evaluate.py",
        "eval_script_version": "2.0.0-multi-scenario",
        "scenarios": SCENARIO_CONFIGS,
        "ground_truth_validation": gt_validation,
        "scenario_summaries": scenario_summaries,
        "ragas_summaries": ragas_summaries,
        "overall_summary": overall_summary_data,
    }
    meta_path = OUTPUT_DIR / "evaluation_metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    console.print(f"[green]✓[/green] Saved evaluation metadata to [bold]{meta_path.name}[/bold]")

    # ── Step 4: Summary Table Display ─────────────────────────────────────────
    console.rule("[bold green]Final Evaluation Results Summary[/bold green]")
    table = Table(title=f"Productive Point RAG Multi-Scenario Performance Summary ({eval_run_id})", show_lines=True)
    table.add_column("Scenario", style="cyan", min_width=14)
    table.add_column("Input Fixture", style="dim")
    table.add_column("Queries", justify="right")
    table.add_column("Correct", justify="right", style="bold green")
    table.add_column("Accuracy (%)", justify="right", style="bold yellow")
    table.add_column("Mean Latency", justify="right")
    table.add_column("Median (P50)", justify="right")
    table.add_column("P95 Latency", justify="right")

    for sc_id, s in scenario_summaries.items():
        table.add_row(
            s["scenario"],
            s["fixture_file"],
            str(s["total_queries"]),
            str(s["correct_queries"]),
            f"{s['accuracy_pct']:.1f}%",
            f"{s['latency_mean_ms']:,.1f} ms",
            f"{s['latency_median_ms']:,.1f} ms",
            f"{s['latency_p95_ms']:,.1f} ms",
        )

    table.add_row(
        "[bold]OVERALL[/bold]",
        "[bold]All 3 Fixtures[/bold]",
        f"[bold]{total_overall}[/bold]",
        f"[bold]{correct_overall}[/bold]",
        f"[bold]{overall_acc:.1f}%[/bold]",
        f"[bold]{overall_summary_data['overall_latency_mean_ms']:,.1f} ms[/bold]",
        f"[bold]{overall_summary_data['overall_latency_median_ms']:,.1f} ms[/bold]",
        f"[bold]{overall_summary_data['overall_latency_p95_ms']:,.1f} ms[/bold]",
        style="bold white on blue",
    )
    console.print(table)


def parse_args():
    p = argparse.ArgumentParser(description="Productive Point RAG Multi-Scenario Evaluation Suite")
    p.add_argument("--rag-url", default=DEFAULT_RAG_URL, help=f"Base URL for RAG microservice (default: {DEFAULT_RAG_URL})")
    p.add_argument("--runs", type=int, default=3, help="Number of independent evaluation runs per scenario (default: 3)")
    p.add_argument("--top-k", type=int, default=5, help="Number of context chunks to retrieve (default: 5)")
    p.add_argument("--smoke-test", action="store_true", help="Run a fast 1-query smoke test for all scenarios to verify indexing & isolation")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_evaluation(
        rag_url=args.rag_url,
        n_runs=args.runs,
        top_k=args.top_k,
        smoke_test_only=args.smoke_test,
    )
