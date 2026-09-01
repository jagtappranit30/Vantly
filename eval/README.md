# Productive Point RAG Evaluation Harness

A proper RAGAS evaluation of the Productive Point Python RAG microservice using a hand-written
ground-truth QA set and a synthetic financial fixture document.

## What this measures

| RAGAS Metric | What it checks |
|---|---|
| **Faithfulness** | Is every claim in the answer supported by the retrieved chunks? (NLI-based) |
| **Context Precision** | Are the most relevant chunks ranked highest in the retrieved list? |
| **Context Recall** | Did retrieval surface all chunks needed to answer the question? |
| **Answer Relevancy** | Is the answer actually answering what was asked? (embedding similarity) |

All four metrics are scored 0–1. The script runs **3 independent passes** by default
and reports **mean ± std dev** so you can see variance across runs.

## File layout

```
eval/
├── evaluate.py                 # Main harness script
├── ground_truth.yaml           # 10 hand-written QA pairs
├── requirements.txt            # Python dependencies
├── fixtures/
│   └── meridian_financials.txt # Synthetic financial document (the "corpus")
└── results/                    # Created on first run
    ├── ragas_results.csv       # Per-question RAGAS scores (all runs)
    ├── ragas_results_summary.csv  # Per-run aggregated scores
    ├── ragas_results_raw.csv   # Raw Q&A records (answers + context previews)
    └── ragas_results.json      # Machine-readable summary (CI-friendly)
```

## Prerequisites

- Python 3.11+
- The Productive Point application running at `http://localhost:3000` (Node.js server proxying to Python RAG engine)
  - **With Docker**: `docker compose up` from the project root
  - **Without Docker**: `npm start` and `cd rag_service && python main.py`
- Local Ollama running Qwen 2.5 (`qwen2.5:7b`) for generation
- A valid `OPENAI_API_KEY` in the project `.env` file (used by RAGAS as evaluation judge via `gpt-4o-mini` and `text-embedding-3-small`)

## Setup

```bash
# From the project root
cd eval

# Create an isolated virtualenv (do NOT use the rag_service venv)
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install evaluation dependencies
pip install -r requirements.txt
```

## Running the evaluation

```bash
# Default: 3 runs, top_k=5 — routes through the Node.js proxy at localhost:3000/api/rag
python evaluate.py

# Equivalent explicit form (Docker stack running):
python evaluate.py --rag-url http://localhost:3000/api/rag --runs 3

# Custom number of runs
python evaluate.py --runs 5

# Custom output path
python evaluate.py --output results/v2_after_rerank.csv
```

> **Note on architecture:** The Node.js server at `http://localhost:3000` handles authentication and input validation before proxying RAG calls to the Python microservice (`/api/rag/health`, `/api/rag/index`, and `/api/rag/query`). The evaluation script defaults to `http://localhost:3000/api/rag`.

## Illustrative Example Output

```
─────────────── Productive Point RAG Evaluation Harness ───────────────
  RAG service : http://localhost:3000/api/rag
  Runs        : 3
  top_k       : 5
  Output      : results/ragas_results.csv

✓ Loaded 10 QA pairs from ground_truth.yaml
✓ Fixture document: meridian_financials.txt (4,312 bytes)
✓ Service healthy | OpenAI API: configured | Docs already indexed: 0
✓ Indexed 14 chunks across 1 pages

── Run 1 / 3 ──
  Querying (1/3)... ████████████████████ 10/10

── Run 2 / 3 ──
  Querying (2/3)... ████████████████████ 10/10

── Run 3 / 3 ──
  Querying (3/3)... ████████████████████ 10/10

─────────────── RAGAS Evaluation ────────────────────────────
Building RAGAS evaluator with OpenAI gpt-4o-mini + text-embedding-3-small...
Scoring run 1 (10 samples)...
Scoring run 2 (10 samples)...
Scoring run 3 (10 samples)...

─────────────── Illustrative Results (Example Only) ────────────────
RAGAS Aggregate Scores (mean ± std over 3 runs)
┌──────────────────────┬────────┬─────────┬────────┬────────┐
│ Metric               │   Mean │ Std Dev │    Min │    Max │
├──────────────────────┼────────┼─────────┼────────┼────────┤
│ faithfulness         │ 0.8910 │  0.0214 │ 0.8620 │ 0.9050 │
│ context_precision    │ 0.7340 │  0.0312 │ 0.7020 │ 0.7590 │
│ context_recall       │ 0.8200 │  0.0187 │ 0.8010 │ 0.8350 │
│ answer_relevancy     │ 0.9120 │  0.0098 │ 0.9030 │ 0.9210 │
└──────────────────────┴────────┴─────────┴────────┴────────┘
```
*(Illustrative output only. Actual scores are computed dynamically based on your evaluation run and stored in `eval/results/`.)*

## Interpreting results

| Score range | Interpretation |
|---|---|
| ≥ 0.80 | Strong — suitable for production use |
| 0.60–0.79 | Moderate — investigate weak questions |
| < 0.60 | Poor — retrieval or generation needs improvement |

**Common fixes by metric:**
- Low `context_recall` → Increase `top_k`, reduce chunk size in `rag_engine.py`
- Low `context_precision` → Improve embedding model or add re-ranking
- Low `faithfulness` → Tighten the system prompt to disallow hallucination
- Low `answer_relevancy` → Improve question understanding in the prompt

## Adding more questions

Edit `ground_truth.yaml`. Each entry requires:

```yaml
- question: "Your question here?"
  ground_truth: >
    The precise reference answer that RAGAS uses to judge recall.
  category: income_statement   # any label you want for breakdown reporting
```

Questions must be answerable from `fixtures/meridian_financials.txt` — or replace
the fixture with your own financial document and update the ground truth accordingly.
