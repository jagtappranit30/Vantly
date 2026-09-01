# Productive Point AI

**Intelligent, Offline-First SME Productivity Assessment & Document Intelligence Platform**

[![Node Version](https://img.shields.io/badge/node-v20-blue.svg)](https://nodejs.org)
[![Python Version](https://img.shields.io/badge/python-3.11-brightgreen.svg)](https://python.org)
[![Docker](https://img.shields.io/badge/docker-ready-cyan.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/license-MSc%20Major%20Project-purple.svg)](#academic-provenance--context)

Productive Point AI is a full-stack financial document analysis, productivity benchmarking, and retrieval-augmented question-answering platform designed specifically for Small and Medium-sized Enterprises (SMEs). Operating on routine accounting exports (PDF or CSV), Productive Point extracts core operational signals, computes a normalised two-pillar Productivity Index against sector benchmarks, and provides interactive document Q&A—all running **100% locally and offline** without external cloud API dependencies or recurring operational costs.

Developed as an MSc Major Project in Computer Science at Nottingham Trent University under a Design Science Research (DSR) methodology.

---

## Table of Contents

- [Executive Summary & Core Features](#executive-summary--core-features)
- [System Architecture](#system-architecture)
- [Component Decomposition](#component-decomposition)
  - [1. Assessment Extraction Pipeline](#1-assessment-extraction-pipeline-apiassess)
  - [2. Deterministic Scoring Engine](#2-deterministic-scoring-engine)
  - [3. RAG Question-Answering Microservice](#3-rag-question-answering-microservice-apiragquery)
- [Tech Stack](#tech-stack)
- [Scoring Methodology & Benchmarks](#scoring-methodology--benchmarks)
- [Security, Authorization & Session Isolation](#security-authorization--session-isolation)
- [Evaluation Suite & Empirical Findings](#evaluation-suite--empirical-findings)
  - [90-Query Ground-Truth Benchmark](#layer-1-ground-truth-accuracy-90-query-benchmark)
  - [RAGAS Faithfulness Evaluation](#layer-2-ragas-retrieval-faithfulness-scenario-a)
  - [Post-Fix Recommendation Robustness](#layer-3-recommendation-quality-post-fix-robustness)
  - [System Latency & Trade-Offs](#layer-4-system-latency-profile)
- [Quick Start Guide](#quick-start-guide)
  - [Prerequisites (Ollama)](#prerequisites)
  - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
  - [Option B: Bare-Metal Local Development](#option-b-bare-metal-local-development)
- [Evaluation Reproduction](#evaluation-reproduction)
- [API Reference](#api-reference)
- [Environment Configuration](#environment-configuration)
- [Repository Structure](#repository-structure)
- [Academic Provenance & Research Disclaimers](#academic-provenance--research-disclaimers)
- [License](#license)

---

## Executive Summary & Core Features

- **Multi-Modal Signal Extraction:** Ingests unstandardised SME financial records (PDF/CSV/TXT), executing hybrid deterministic regex pre-parsing coupled with zero-temperature JSON-schema extraction via local Ollama models (`qwen2.5:7b`).
- **Two-Pillar Productivity Index:** Eliminates numerical LLM hallucinations by isolating scoring into a deterministic mathematical engine computing **Labour Efficiency (0–50)** and **Financial Health (0–50)** against empirical sector percentiles.
- **Section-Aware RAG Engine:** A dedicated Python FastAPI microservice provides document Q&A using section-aware sliding-window chunking (400 chars, 150 overlap), dense vector embeddings, exhaustive cosine similarity retrieval, and citation-grounded answer generation.
- **Vector Store Persistence:** Per-document vector stores held in memory for retrieval and persisted atomically to `vector_store.json` for recovery across microservice and container restarts.
- **Dual-Mode Access Control:** Seamless Google OAuth (Firebase Authentication) with PostgreSQL persistence, alongside rate-limited (10 req/15 min) unauthenticated guest sessions tracked in memory.
- **Audited Report Export:** Generates client-side formatted PDF summaries (via jsPDF) and server-side synchronized Google Docs reports through OAuth 2.0 Drive/Docs API integration.
- **Zero-Cloud Data Sovereignty:** 100% on-premises execution ensures confidential enterprise balance sheets and payroll records never transit third-party cloud LLM endpoints.

---

## System Architecture

The platform separates responsibilities across three decoupled layers: a React 19 Single Page Application, a Node.js Express API gateway/scoring server, and a Python FastAPI RAG microservice.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   Client Tier: React 19 SPA (Vite + Tailwind)            │
│                                                                          │
│  [ UploadForm ]  ──→  [ ResultsDashboard ]  ──→  [ RAGChat Assistant ]  │
│         │                     │                         │                │
│    POST /api/assess       GET /api/history          POST /api/rag/query  │
└─────────┬─────────────────────┬─────────────────────────┬────────────────┘
          │                     │                         │
          └─────────────────────┼─────────────────────────┘
                                │ HTTP / REST (Port 3000)
┌───────────────────────────────▼──────────────────────────────────────────┐
│                    Gateway & Scoring Tier: Node.js / Express             │
│                                                                          │
│  • Memory-Buffered Multer Upload (Max 15MB, Magic Byte %PDF Validation)  │
│  • Deterministic Pre-Parser (Regex extraction of revenue, COGS, payroll) │
│  • LLM Schema Extraction via Local Ollama (qwen2.5:7b, temp=0, seed=42)  │
│  • Deterministic Scoring Engine (Labour Efficiency + Financial Health)   │
│  • Dual-Mode Auth Middleware (requireAuth / optionalAuth + Ownership)    │
│  • Auto-Index Dispatch to RAG Microservice                               │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │                                          │
    Internal SQL│(Port 5432)                    HTTP Proxy│(Port 8000)
                ▼                                          ▼
┌───────────────────────────────┐          ┌───────────────────────────────┐
│     PostgreSQL 15 Container   │          │   Python 3.11 RAG Service     │
│                               │          │                               │
│  • users                      │          │  • /extract (pypdf parsing)   │
│  • assessments (Drizzle ORM)  │          │  • /index   (chunk & embed)   │
│  • JSONB metrics & benchmarks │          │  • /query   (vector search)   │
└───────────────────────────────┘          │  • vector_store.json persist  │
                                           └───────────────┬───────────────┘
                                                           │
                                                Local HTTP │ (Port 11434)
                                                           ▼
                                           ┌───────────────────────────────┐
                                           │   Ollama Local LLM Runtime    │
                                           │                               │
                                           │  • qwen2.5:7b (Inference)     │
                                           │  • bge-small-en-v1.5 Fallback │
                                           └───────────────────────────────┘
```

---

## Component Decomposition

### 1. Assessment Extraction Pipeline (`/api/assess`)
1. **File Ingestion & Safety:** Multer receives the uploaded buffer in memory. `validateUploadedFile()` verifies `%PDF` magic bytes or scans CSV headers for binary byte injection.
2. **Text Extraction:** Native digital streams are parsed via `pypdf.PdfReader` in the RAG microservice. If unreachable, a regex scanner extracts text blocks (`Tj`/`TJ` operators) in `server.ts`.
3. **Deterministic Pre-Parsing:** `preParseUniversalMetrics()` extracts explicit financial figures using strict regex patterns (`Turnover: £X`, `Headcount: N`).
4. **LLM Extraction:** Unstructured text is formatted into a strict JSON-schema prompt and passed to Ollama (`temperature: 0.0`, `seed: 42`).
5. **Null-Coalescing Merge:** Pre-parsed deterministic figures take absolute precedence over LLM extractions (`preParsed.revenue ?? llmResult.revenue ?? null`), preventing hallucination.

### 2. Deterministic Scoring Engine
- Implemented in `calculateScores()` in `server.ts`.
- Compares extracted metrics against configured sector percentiles (P25, P50, P75).
- Applies deterministic clamp functions to compute sub-scores.
- **Derivation Integrity:** Gross Margin is derived when Revenue and COGS are present; Operating Margin is strictly derived only when explicitly stated to prevent faulty operational assumptions.

### 3. RAG Question-Answering Microservice (`/api/rag/query`)
- **Section-Aware Chunking:** Segments documents by headers/separators into coherent table sections (max 1500 chars) or applies a sliding window (400 chars, 150 overlap).
- **Embedding Generation:** Uses Ollama embeddings with automatic fallback to FastEmbed (`BAAI/bge-small-en-v1.5`).
- **Retrieval & QA Synthesis:** Computes exhaustive cosine similarity across stored vectors, filters chunks below `RAG_MIN_SIMILARITY` (0.25), and prompts Qwen 2.5 7B with strict citation instructions.

---

## Tech Stack

| Layer | Technology | Version / Specification | Rationale & Responsibility |
| :--- | :--- | :--- | :--- |
| **Frontend SPA** | React, TypeScript, Vite | React 19, Vite 6, TS 5.8 | Reactive dashboard, interactive charts, dynamic tabs. |
| **Styling & UI** | Tailwind CSS, Framer Motion | Tailwind v4, Lucide Icons | Responsive layout, dark theme, smooth micro-interactions. |
| **Visualisation** | Recharts | Recharts 2.x | Benchmark bar comparisons and pillar score distribution. |
| **API Gateway** | Express.js, Node.js | Node 20 (Bookworm-slim) | REST routing, file validation, rate limiting, RAG proxy. |
| **ORM & Database** | PostgreSQL, Drizzle ORM | PostgreSQL 15-alpine, Drizzle 0.45 | Type-safe persistence for user profiles and assessment JSONB. |
| **Authentication** | Firebase Admin / Client SDK | Firebase 12.x | Google OAuth 2.0 token issuance and server-side verification. |
| **RAG Microservice** | FastAPI, Uvicorn | Python 3.11, FastAPI 0.115+ | Document chunking, vector embeddings, and search retrieval. |
| **PDF Extraction** | `pypdf` | pypdf 6.x | Native digital PDF glyph and text stream extraction. |
| **Local LLM Engine**| Ollama | Qwen 2.5 (7B parameters) | Zero-cloud on-premises reasoning, extraction, and QA synthesis. |
| **Containerisation**| Docker, Docker Compose | Multi-stage Dockerfile | Unified container orchestration with health checks. |

---

## Scoring Methodology & Benchmarks

The composite **Productivity Index (0–100)** is calculated as the sum of two equal 50-point pillars:

$$\text{Productivity Index} = \text{Labour Efficiency Score} + \text{Financial Health Score}$$

```
                                    ┌── Revenue per Employee (Max 25 pts)
        ┌── Labour Efficiency (50) ─┤
        │                           └── Output per Payroll   (Max 25 pts)
Index ──┤
(0-100) │                           ┌── Profit Margin Score  (Max 25 pts)
        └── Financial Health  (50) ─┤
                                    └── Liquidity / Current  (Max 25 pts)

[ Separate Diagnostic: Digital Maturity Score (0–100) — Not in Index ]
```

### Configured Prototype Benchmarks (`config/sector_benchmarks.json`)

| Metric | Manufacturing | Services | Retail | Other | Formula / Baseline |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Revenue / Employee (P50)** | £98,000 | £145,000 | £190,000 | £160,000 | $(\text{Actual} / \text{P50}) \times 12.5$ (clamped 3–25) |
| **Output / Payroll (P50)** | 3.7x | 3.8x | 5.3x | 4.0x | $(\text{Actual} / \text{P50}) \times 12.5$ (clamped 3–25) |
| **Gross Margin (P50)** | 35.0% | 55.0% | 28.0% | 38.0% | Margin Sub-score: $(\text{Actual} / \text{P50}) \times 6.25$ |
| **Operating Margin (P50)** | 12.0% | 18.0% | 6.0% | 10.0% | Margin Sub-score: $(\text{Actual} / \text{P50}) \times 6.25$ |
| **Current Ratio (Healthy)** | $\ge 1.50$ | $\ge 1.50$ | $\ge 1.50$ | $\ge 1.50$ | 25 pts if $\ge 1.5$; $15 + 20(\text{CR}-1)$ if $1.0\le\text{CR}<1.5$ |

*Note on Missing Data:* When UK micro-entity filings omit headcount or payroll, missing sub-metrics assign an unpenalised baseline score (25.0 points) rather than zero.

---

## Security, Authorization & Session Isolation

| Security Layer | Implementation Mechanism | Defensive Behavior |
| :--- | :--- | :--- |
| **Authentication** | Firebase Admin SDK (`verifyIdToken`) | Rejects forged bearer tokens with HTTP 401 Unauthorized. |
| **Authorization** | `verifyDocumentOwnership()` in `server.ts` | Authenticated records verify `assessments.userUid == req.user.uid`. Cross-user access returns HTTP 403. |
| **Guest Isolation** | In-Memory `guestDocumentIds` Set | Unauthenticated guest assessments are scoped strictly to session IDs generated during active upload. |
| **Upload Validation** | Magic-Byte Inspection (`validateUploadedFile`) | Rejects disguised binaries or malicious scripts missing `%PDF` header with HTTP 400. |
| **Rate Limiting** | IP-Keyed Sliding Window | Limits unauthenticated requests to 10 calls per 15 minutes per IP. |
| **Prompt Hardening** | JSON-Schema Constraints & Cleaners | Strips reasoning fences (`<think>...</think>`), control characters, and ignores prompt injection. |

---

## Evaluation Suite & Empirical Findings

The platform was formally benchmarked across four evaluation layers under controlled Design Science Research conditions using three structural variants of a synthetic UK SME (*Meridian Manufacturing Ltd*).

### Layer 1: Ground-Truth Accuracy (90-Query Benchmark)

Ten ground-truth financial questions were queried across 3 independent runs per scenario (30 queries per scenario, 90 queries total) using local Qwen 2.5 7B.

| Evaluation Condition | Fixture Description | Evaluated Queries | Correct | Refusals / Errors | Accuracy (%) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Scenario A** | Clean structured prose (`meridian_financials.txt`) | 30 | 30 | 0 | **100.0%** |
| **Scenario B** | Dense tabular layout (`meridian_scenario_b_tabular.txt`) | 30 | 30 | 0 | **100.0%** |
| **Scenario C** | Simulated OCR character noise (`meridian_scenario_c_degraded.txt`) | 30 | 27 | 3 | **90.0%** |
| **Total / Overall** | **Multi-Scenario Benchmark** | **90** | **87** | **3** | **96.7%** |

*Findings:* Zero numerical hallucinations occurred across all 90 queries. The 3 errors in Scenario C occurred exclusively in software inventory classification under heavy character degradation (`l↔1`, `O↔0`).

### Layer 2: RAGAS Retrieval Faithfulness (Scenario A)

Evaluated on Scenario A using `gpt-4o-mini` as evaluation judge and `text-embedding-3-small` for semantic context alignment:
- **Context Precision:** `0.983` (Retrieved chunks contained minimal irrelevant noise)
- **Context Recall:** `0.908` (Retrieved context successfully covered ground-truth facts)
- **Faithfulness:** `0.801` (Generated claims were mathematically grounded in retrieved text)
- **Answer Relevancy:** `0.777` (Answers directly addressed user inquiries)

### Layer 3: Recommendation Quality (Post-Fix Robustness)

Following post-evaluation wiring remediation, nine LLM-generated recommendations were evaluated against a 4-dimension rubric (Evidence-Grounded, Score-Consistent, Specific, Actionable; 8 pts max per rec, 72 pts total):

| Condition | Recommendations Evaluated | Total Points Scored | Max Points | Quality Score (%) | Source Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Scenario A (Clean)** | 3 | 18 | 24 | **75.0%** | 100% LLM Generated |
| **Scenario B (Tabular)** | 3 | 17 | 24 | **70.8%** | 100% LLM Generated |
| **Scenario C (OCR Noise)**| 3 | 20 | 24 | **83.3%** | 100% LLM Generated |
| **Total / Overall** | **9** | **55** | **72** | **76.4%** | **9 / 9 (100% LLM)** |

*Notable finding:* In Scenario C, the LLM successfully extracted quantitative evidence from corrupted text (e.g., extracting `9.1% YoY inflation` from `+9.l%` and `68% customer concentration`).

### Layer 4: System Latency Profile

Measured across 20 scripted queries on consumer Apple Silicon hardware:
- **Median Latency (p50):** `7.14 seconds`
- **95th Percentile (p95):** `8.85 seconds` (Min: 5.89s, Max: 9.35s, Mean: 7.24s)
- *Conclusion:* Exceeded the original cloud-based proposal target ($<8.0\text{s}$), reflecting the privacy and quota-immunity trade-off of local CPU/unified-memory inference.

---

## Quick Start Guide

### Prerequisites
1. Install [Docker](https://docs.docker.com/get-docker/) & Docker Compose.
2. Install and launch [Ollama](https://ollama.ai/):
   ```bash
   ollama pull qwen2.5:7b
   ```

---

### Option A: Docker Compose (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/jagtappranit30/productive-point.git
cd productive-point

# 2. Configure environment file
cp .env.example .env

# 3. Launch database, backend gateway, and Python RAG service
docker compose up --build -d

# 4. Follow application startup logs
docker compose logs -f app

# 5. Access web application in browser
open http://localhost:3000
```

---

### Option B: Bare-Metal Local Development

```bash
# 1. Start PostgreSQL instance
docker run -d --name productive-point-db \
  -e POSTGRES_DB=productive_point \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine

# 2. Install Node.js dependencies
npm install

# 3. Setup Python RAG virtual environment
cd rag_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# 4. Setup environment variables
cp .env.example .env
# Ensure SQL_HOST="localhost" in .env for non-docker execution

# 5. Apply PostgreSQL schemas via Drizzle Kit
npx drizzle-kit push --config=src/db/drizzle.config.ts

# 6. Start full-stack development environment (Vite HMR + Express Gateway + RAG Service)
npm run dev

# 7. Access in browser
open http://localhost:3000
```

---

## Evaluation Reproduction

To independently reproduce the evaluation results reported in Chapter 5:

```bash
# Activate Python evaluation environment
cd eval
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 1. Run the Multi-Scenario 90-Query Benchmark Harness
python evaluate.py --rag-url http://127.0.0.1:8000 --runs 3 --top-k 5

# 2. Run Deterministic Scoring Verification (Offline arithmetic checks)
python evaluate_scoring.py

# 3. Run End-to-End Live API Assessment Verification
python assess_e2e.py

# 4. Run Post-Fix Recommendation Quality Test
python test_recommendation_quality_post_fix.py
```

---

## API Reference

### Core Endpoints

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/health` | None | API Gateway heartbeat verification. |
| `GET` | `/api/benchmarks` | None | Returns configured sector percentile distributions. |
| `POST` | `/api/assess` | Optional | Ingests document (multipart), extracts metrics, computes scores. |
| `GET` | `/api/history` | Required | Retrieves authenticated user's historic assessments. |
| `GET` | `/api/history/:id` | Required | Fetches detailed assessment run by UUID. |
| `DELETE`| `/api/history/:id`| Required | Removes assessment record (ownership validated). |
| `POST` | `/api/export-docs` | Required | Synchronises assessment into formatted Google Doc. |

### RAG Microservice Endpoints (Proxied via Express)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/rag/health` | Optional | Microservice health check & vector store document count. |
| `POST` | `/api/rag/index` | Optional | Chunks, embeds, and indexes document into vector store. |
| `POST` | `/api/rag/query` | Optional | Vector similarity search and grounded natural-language QA. |

---

## Environment Configuration

Key configuration parameters defined in `.env.example`:

```bash
# ── LLM Runtime (Ollama Local) ───────────────────────────
LLM_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434" # Docker: http://host.docker.internal:11434
OLLAMA_MODEL="qwen2.5:7b"

# ── Task Routing Overrides (Optional) ────────────────────
ASSESSMENT_MODEL="qwen2.5:7b"
RAG_MODEL="qwen2.5:7b"
STRATEGY_MODEL="qwen2.5:7b"

# ── PostgreSQL Persistence ───────────────────────────────
SQL_HOST="db"                            # Local: "localhost"
SQL_PORT=5432
SQL_USER="postgres"
SQL_PASSWORD="your_password_here"
SQL_DB_NAME="productive_point"

# ── RAG Microservice Configuration ───────────────────────
RAG_SERVICE_URL="http://127.0.0.1:8000"
VECTOR_STORE_FILE="/app/rag_service/data/vector_store.json"
RAG_MIN_SIMILARITY=0.25
```

---

## Repository Structure

```
productive-point/
├── .github/workflows/ci-cd.yml    # GitHub Actions CI workflow (typecheck, lint, build)
├── config/
│   └── sector_benchmarks.json     # Hardcoded sector percentile tables
├── eval/                          # Research evaluation framework
│   ├── fixtures/                  # Controlled test documents (A: Clean, B: Tabular, C: OCR-noise)
│   ├── results/                   # Raw CSV/JSON evaluation runs and summary reports
│   ├── assess_e2e.py              # End-to-end API pipeline validation
│   ├── evaluate.py                # Multi-scenario 90-query benchmark suite
│   ├── evaluate_scoring.py        # Isolated scoring arithmetic test harness
│   ├── evaluation_config.json     # Formal evaluation configuration snapshot
│   ├── ground_truth.yaml          # Ground-truth QA pairs and expected metrics
│   └── latency_log.txt            # Raw latency telemetry log
├── rag_service/                   # Python FastAPI RAG microservice
│   ├── main.py                    # REST endpoints (/extract, /index, /query, /health)
│   ├── rag_engine.py              # Section-aware chunker, vector store & retrieval engine
│   └── requirements.txt           # Python dependencies
├── src/                           # React frontend & shared helpers
│   ├── components/                # UI components (UploadForm, ResultsDashboard, RAGChat)
│   ├── context/AuthContext.tsx    # Firebase authentication context
│   ├── db/                        # Drizzle ORM schema and PostgreSQL connection pool
│   ├── lib/                       # Firebase client and Admin SDK initialization
│   ├── middleware/auth.ts         # Dual-mode authorization guards
│   ├── utils/pdfGenerator.ts      # Client-side PDF export generator
│   ├── App.tsx                    # Root UI router and state orchestrator
│   └── types.ts                   # TypeScript domain interfaces
├── Dockerfile                     # Multi-stage production container manifest
├── docker-compose.yml             # Service orchestration (PostgreSQL + App)
├── entrypoint.sh                  # Database migration & service bootstrapper
├── package.json                   # Node.js dependencies and lifecycle scripts
├── server.ts                      # Express API gateway, deterministic parser & scoring engine
└── vite.config.ts                 # Vite bundle configuration
```

---

## Academic Provenance & Research Disclaimers

1. **Design Science Research (DSR):** This software is a research prototype developed to evaluate the technical feasibility and boundaries of offline RAG and deterministic scoring under commodity resource constraints.
2. **Benchmark Validity:** Configured benchmark values are illustrative prototype percentiles; they do not represent validated national statistical distributions (such as official ONS or OECD micro-datasets). Sourcing validated percentile distributions remains future work.
3. **OCR Terminology Clarification:** The ingestion pipeline performs native stream parsing via `pypdf`. The application does not contain an Optical Character Recognition (OCR) vision engine. Scenario C tests downstream LLM resilience against *simulated OCR-style character corruption* (`l↔1`, `O↔0`, `f↔£`).
4. **Evaluation Versioning:** The principal 90-query evaluation in Chapter 5 was conducted on the evaluated baseline configuration. Post-evaluation codebase enhancements (disk persistence, FastEmbed fallback, similarity filtering, recommendation wiring) are documented as supporting engineering hardening.

---

## License

This project is submitted as an academic dissertation artefact. All rights reserved.
