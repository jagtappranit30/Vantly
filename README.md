# Vantly

**See your business clearly.** Vantly is a full-stack productivity assessment platform for Small-to-Medium Enterprises (SMEs). Upload a financial document (PDF or CSV), and Vantly uses a local LLM to extract key metrics, score your business against sector benchmarks, and deliver actionable recommendations — all running 100% offline on your own hardware.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [How the Assessment Works (End-to-End Flow)](#how-the-assessment-works-end-to-end-flow)
- [Frontend (React SPA)](#frontend-react-spa)
- [Backend (Express.js Server)](#backend-expressjs-server)
- [Scoring Engine — How Scores Are Calculated](#scoring-engine--how-scores-are-calculated)
- [RAG Microservice (Python FastAPI)](#rag-microservice-python-fastapi)
- [Database Layer (PostgreSQL + Drizzle ORM)](#database-layer-postgresql--drizzle-orm)
- [Authentication & Security](#authentication--security)
- [Report Export (PDF & Google Docs)](#report-export-pdf--google-docs)
- [Docker & Deployment](#docker--deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Evaluation Harness (RAGAS)](#evaluation-harness-ragas)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
- [License](#license)

---

## Features

- **AI-Powered Financial Analysis** — Upload income statements, balance sheets, or general ledgers. Vantly uses Ollama (Qwen 2.5 7B by default) to extract revenue, headcount, COGS, payroll, margins, and liquidity figures with anti-hallucination guardrails.
- **Sector Benchmarking** — Scores are computed against industry-specific percentile benchmarks (Manufacturing, Services, Retail, Other) across labour efficiency and financial health dimensions.
- **Productivity Index** — A composite 0–100 score combining labour efficiency (revenue per employee, output per payroll) and financial health (gross/operating margins, current ratio).
- **RAG Document Q&A** — After assessment, ask follow-up questions about your uploaded document. A Python FastAPI microservice chunks, embeds, and retrieves relevant context using cosine similarity, then answers with the LLM.
- **Google Sign-In & Guest Mode** — Authenticated users get persistent assessment history stored in PostgreSQL. Guest users can run assessments immediately with rate limiting (10 per 15 minutes per IP).
- **Export Reports** — Download a detailed PDF report locally (via jsPDF) or export directly to Google Docs using the Google Docs API.
- **Digital Maturity Scoring** — Detects mentions of software tools, ERPs, and bookkeeping platforms in your documents and assigns a digital maturity level (Low / Medium / High).
- **100% Offline** — All LLM inference runs locally through Ollama. No data leaves your machine.

---

## Tech Stack

| Layer | Technology | Why We Chose It |
|---|---|---|
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Recharts, Lucide Icons | Modern SPA with animated transitions and interactive charts |
| Backend | Express.js, TypeScript, esbuild | Lightweight Node server with type safety; esbuild compiles server.ts for production |
| Database | PostgreSQL 15 (via Drizzle ORM) | Relational storage for users and assessment history with type-safe queries |
| Auth | Firebase Authentication (Google OAuth) | Managed auth with ID token verification on the server |
| RAG Service | Python FastAPI, pypdf, NumPy | Separate microservice for document parsing, chunking, embedding, and vector search |
| LLM | Ollama (Qwen 2.5:7B) | Runs fully offline on local hardware, no API keys required |
| Build | Vite (frontend), esbuild (server), Docker Compose | Fast HMR in dev, optimised production bundles |
| CI/CD | GitHub Actions | Automated typecheck, build verification, and Docker image validation |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (React SPA)                    │
│                                                          │
│  UploadForm  →  ResultsDashboard  →  RAGChat             │
│       ↓              ↓                  ↓                │
│  POST /api/assess  GET /api/history  POST /api/rag/query │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (port 3000)
┌──────────────────────▼───────────────────────────────────┐
│               Express.js Server (server.ts)              │
│                                                          │
│  • Receives file upload via multer (in-memory, max 15MB) │
│  • Validates file signature (magic bytes for PDF)        │
│  • Extracts text (CSV direct / PDF via RAG /extract)     │
│  • Deterministic pre-parser for financial metrics        │
│  • Sends text to Ollama LLM for AI extraction            │
│  • Merges pre-parsed + LLM results (pre-parsed wins)     │
│  • Calculates scores against sector benchmarks           │
│  • Stores results in PostgreSQL (authenticated users)    │
│  • Auto-indexes document into RAG service                │
│  • Proxies RAG queries with ownership verification       │
└────┬──────────────────────────────────┬──────────────────┘
     │                                  │
     ▼                                  ▼
┌─────────────┐              ┌────────────────────┐
│ PostgreSQL  │              │ Python RAG Service  │
│   (:5432)   │              │      (:8000)        │
│             │              │                     │
│  users      │              │  /extract – text    │
│  assessments│              │  /index   – chunk   │
│             │              │             & embed │
└─────────────┘              │  /query   – vector  │
                             │             search  │
                             │  /health            │
                             └────────┬────────────┘
                                      │
                                      ▼
                             ┌─────────────────┐
                             │  Ollama (:11434) │
                             │  qwen2.5:7b      │
                             └─────────────────┘
```

**Key design decision:** The Express server acts as the single entry point (port 3000). The Python RAG service runs internally on port 8000 and is *not* exposed to the browser. All RAG requests are proxied through Express, which adds authentication and document ownership checks before forwarding.

---

## How the Assessment Works (End-to-End Flow)

This is the full journey when a user uploads a document:

### Step 1 — Upload & Validation (Frontend → Server)
The `UploadForm` component collects a file (PDF or CSV), a sector selection (Manufacturing, Services, Retail, Other), and an optional company name. It sends a `multipart/form-data` POST to `/api/assess`.

On the server (`server.ts`), the file goes through validation:
- **Extension check**: Only `.pdf`, `.csv`, or `.txt` are accepted
- **Magic byte inspection**: For PDFs, the first 5 bytes must start with `%PDF`
- **Binary detection for CSVs**: Scans the first 2048 bytes for null bytes to reject binary files disguised as CSV
- **Size limit**: 15MB enforced by multer

### Step 2 — Text Extraction
- **CSV files**: Read directly as UTF-8 text
- **PDF files**: Sent to the Python RAG service's `/extract` endpoint, which uses `pypdf` (`PdfReader`) to extract text page-by-page. If the Python service is unavailable, the server falls back to a regex-based PDF text extractor that looks for `Tj` and `TJ` operators in the raw PDF binary

### Step 3 — Deterministic Pre-Parsing (`preParseUniversalMetrics`)
Before sending anything to the LLM, the server runs a purely deterministic parser on the extracted text. This parser:
1. Tries CSV header matching first (e.g., columns named "revenue", "headcount", "cogs")
2. Then scans line-by-line for `key: value` patterns using keyword matching
3. Then applies regex patterns for common financial document formats (e.g., `Turnover: £450,000`)
4. Extracts: revenue, headcount, COGS, payroll, gross margin, operating margin, current assets, current liabilities, company name

**Why?** The deterministic parser always produces the same results for the same input. LLMs can hallucinate numbers, so pre-parsed values always take priority over LLM values.

### Step 4 — LLM Analysis via Ollama
The document text (capped at 50,000 characters) is sent to Ollama's local API (`/api/generate`) with:
- **Temperature 0.0** and **seed 42** — makes output deterministic
- **JSON format mode** — forces the model to return valid JSON
- **A detailed prompt** with anti-hallucination instructions: "NEVER guess, approximate, estimate, or extrapolate"
- The prompt asks for: financial metrics, digital tools detected, maturity level, recommendations, and qualitative analysis

The response is parsed using `extractJSONObject()` which handles messy LLM output:
1. Strips `<think>` tags (from reasoning models)
2. Removes markdown code fences
3. Tries `JSON.parse()` directly
4. Falls back to extracting content between first `{` and last `}`
5. Sanitises trailing commas and control characters

### Step 5 — Metric Merging
Pre-parsed values and LLM values are merged using the **null coalescing operator** (`??`):
```
revenue = preParsed.revenue ?? llmResult.revenue ?? null
```
This means: use the deterministic value if available, fall back to LLM, fall back to null.

Gross margin is calculated deterministically if revenue and COGS are known:
```
grossMargin = ((revenue - cogs) / revenue) * 100
```
Operating margin is ONLY used if explicitly disclosed — it is never calculated from other values to prevent inaccurate derivations.

### Step 6 — Scoring
The merged metrics are scored against sector-specific benchmarks (explained in detail below).

### Step 7 — Storage & Indexing
- **Authenticated users**: The full assessment (metrics + scores + benchmarks) is stored in PostgreSQL via Drizzle ORM
- **Guest users**: The assessment ID is tracked in an in-memory `Set` for document ownership verification; history is stored client-side in `localStorage`
- **RAG indexing**: The document is asynchronously sent to the Python RAG service's `/index` endpoint for chunking and embedding (non-blocking — assessment result is returned immediately)

### Step 8 — Response
The full `AssessmentRun` object is returned to the frontend, which renders the `ResultsDashboard`.

---

## Frontend (React SPA)

The frontend is a single-page React 19 app built with Vite and styled with Tailwind CSS v4.

### Components

| Component | File | Purpose |
|---|---|---|
| **App** | `src/App.tsx` | Root component. Manages auth state, assessment history, routing between upload/results views. Contains the landing page with sign-in / guest mode. |
| **UploadForm** | `src/components/UploadForm.tsx` | Three-step form: company name input → sector card selector (4 sectors with emoji icons) → drag-and-drop file upload zone. Client-side validation for file type and size. |
| **ResultsDashboard** | `src/components/ResultsDashboard.tsx` | Tabbed dashboard with 6 tabs: Overview, Labour, Financial, Digital, Justification, RAG Q&A. Contains animated score cards, Recharts bar charts, and action buttons for PDF/Google Docs export. Shows a skeleton loading state with cycling progress messages while the LLM processes. |
| **RAGChat** | `src/components/RAGChat.tsx` | Chat interface for document Q&A. Shows suggested quick-ask questions, user/bot message bubbles, expandable source citations with page numbers and similarity scores. Communicates with `/api/rag/query`. |
| **HistoryList** | `src/components/HistoryList.tsx` | Sidebar listing past assessments with company name, date, sector, and productivity score. Supports deletion with confirmation. |
| **VantlyLogo** | `src/components/VantlyLogo.tsx` | SVG brand logo component with gradient styling. |

### Auth Context (`src/context/AuthContext.tsx`)
Wraps the app in a Firebase Auth provider. Manages:
- `onAuthStateChanged` listener for login state
- `signInWithPopup` for Google OAuth
- Automatic `getIdToken()` refresh for API calls
- Stores both the Firebase ID token (for our API) and the Google OAuth access token (for Google Docs export)
- Google Drive and Google Docs scopes are requested during sign-in

### State Management
No external state library — React's `useState` and `useCallback` hooks handle all state. Assessment history is fetched from the API on mount (authenticated) or loaded from `localStorage` (guest mode).

---

## Backend (Express.js Server)

The entire backend is in a single file: `server.ts` (1092 lines). It handles:

### File Upload
- Uses `multer` with in-memory storage (`multer.memoryStorage()`)
- Files are never written to disk — processed entirely in memory
- Custom error handler wraps multer to return JSON errors for oversized files

### Guest Rate Limiting
- In-memory `Map` keyed by IP address
- 10 requests per 15-minute sliding window per IP
- Resets automatically when the window expires
- Only applied to unauthenticated requests

### Multi-LLM Router (`resolveTaskLLM`)
The server supports per-task model overrides via environment variables:
- `ASSESSMENT_MODEL` — model for financial analysis
- `RAG_MODEL` — model for RAG Q&A
- `STRATEGY_MODEL` — model for strategy recommendations

All default to `OLLAMA_MODEL` (which defaults to `qwen2.5:7b`). The router also adjusts the Ollama URL for Docker networking (replacing `localhost` with `host.docker.internal` when running inside a container).

### RAG Proxy Endpoints
The Express server proxies all RAG calls (`/api/rag/*`) to the Python service at `http://127.0.0.1:8000`. Before forwarding, it:
1. Validates the request parameters
2. Verifies document ownership (checks if the user owns the document in PostgreSQL)
3. Sanitises inputs (question capped at 500 chars, `top_k` capped at 10)
4. Forwards to the Python service with a 60-second timeout

### Document Ownership Security
The `verifyDocumentOwnership()` function implements a two-tier check:
- **Authenticated users**: Looks up the document in PostgreSQL and verifies `userUid` matches
- **Guest users**: Checks the in-memory `guestDocumentIds` Set
- **Cross-access prevention**: Authenticated documents cannot be accessed by guests, and vice versa

---

## Scoring Engine — How Scores Are Calculated

The scoring logic is in `calculateScores()` in `server.ts`.

### Sector Benchmarks
Four sectors are defined, each with P25/P50/P75 percentile values:

| Metric | Manufacturing | Services | Retail | Other |
|---|---|---|---|---|
| Revenue per Employee (P50) | £175,000 | £145,000 | £190,000 | £160,000 |
| Output per Payroll (P50) | 4.2x | 3.8x | 5.3x | 4.0x |
| Gross Margin (P50) | 35% | 55% | 28% | 38% |
| Operating Margin (P50) | 12% | 18% | 6% | 10% |

### Productivity Index (0–100) = Labour Efficiency (0–50) + Financial Health (0–50)

#### Labour Efficiency (0–50 points)
Two sub-metrics, each worth 25 points max:

1. **Revenue per Employee** = `revenue / headcount`
   - Score = `(actual / benchmark_P50) × 12.5`, clamped between 3 and 25
   
2. **Output per Payroll** = `revenue / payroll`
   - Score = `(actual / benchmark_P50) × 12.5`, clamped between 3 and 25

If only one sub-metric is available, it is doubled to fill the full 50-point range. If neither is available (common in UK micro-entity accounts), a baseline score of 25 is assigned.

#### Financial Health (0–50 points)
Two components:

1. **Margin Score (0–25 points)**: Average of gross margin score and operating margin score, each scored as `(actual / benchmark_P50) × 6.25`, clamped between 1.5 and 12.5

2. **Liquidity Score (0–25 points)**: Based on current ratio (`current assets / current liabilities`):
   - ≥ 1.5 → 25 points (full marks)
   - 1.0–1.5 → scaled between 15–25
   - < 1.0 → `max(3, ratio × 15)` (penalised)

#### Digital Maturity Score (0–100, separate)
Not part of the Productivity Index — reported separately:
- Base score: 30
- +12 per digital tool detected
- +25 for "High" maturity level, +10 for "Medium"
- Clamped between 10 and 100

### Handling Missing Data
The system is designed for UK micro-entity accounts that often omit data. Missing metrics default to **baseline scores** (midpoint), not zero. This prevents unfairly penalising companies that simply don't disclose certain figures.

---

## RAG Microservice (Python FastAPI)

Located in `rag_service/`, this is a separate Python application that handles document indexing and Q&A.

### How It Works

#### Text Extraction (`extract_text`)
- PDFs: Uses `pypdf.PdfReader` to extract text page-by-page
- CSVs: Decoded as UTF-8 directly
- Returns a list of `{page, text}` objects

#### Section-Aware Chunking (`create_chunks`)
The chunker is smarter than a simple sliding window:
1. **Detects section boundaries** using:
   - Separator bars (`====` or `----`, 10+ chars)
   - ALL-CAPS header lines (≥4 alpha chars, ≥60% uppercase)
   - Checks for adjacent separator bars to confirm real headers
2. **Keeps sections intact** if they're under 1500 characters (preserves complete financial tables)
3. **Falls back to sliding window** for oversized sections: 400-character chunks with 150-character overlap
4. **Merges tiny fragments** (< 30 chars) into the previous section

#### Embedding Generation (`_get_embedding`)
- Primary: Calls Ollama's `/api/embeddings` endpoint to generate a dense vector
- The vector is L2-normalised for cosine similarity
- Fallback: If Ollama is unavailable, generates a 128-dimensional hash-based vector (deterministic, based on word hashing)

#### Vector Search (`search_similar_chunks`)
- Computes cosine similarity (dot product of normalised vectors) between the query embedding and all chunk embeddings for a given document
- Returns top-K results sorted by similarity score

#### Query Answering (`query`)
1. Retrieves top-K similar chunks
2. Constructs a prompt with the chunks as context
3. Sends to Ollama with a system prompt that enforces: "Base your answer strictly on the provided context snippets"
4. Returns the answer with source citations (page numbers and similarity scores)

### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Service health + document count |
| `/index` | POST | Index a document (multipart: doc_id + file) |
| `/extract` | POST | Extract text from a file (multipart: file) |
| `/query` | POST | Query indexed document (JSON: doc_id, question, top_k) |

### Vector Store Persistence & Semantic Fallbacks
- **Disk Persistence:** Embeddings and chunk metadata are persisted to disk (`vector_store.json`), ensuring indexed documents survive service and container restarts.
- **Semantic Fallback:** Uses Ollama embeddings by default, with automatic fallback to FastEmbed (`BAAI/bge-small-en-v1.5`) when Ollama is unavailable.
- **Qwen 2.5 Model Enforcement:** All chat reasoning and document Q&A use Qwen 2.5 (`qwen2.5:7b`).
- **Environment Configurable:** Node proxy connects to Python RAG service via `RAG_SERVICE_URL` (default `http://127.0.0.1:8000`).

---

## Database Layer (PostgreSQL + Drizzle ORM)

### Schema (`src/db/schema.ts`)

Two tables:

```
users
├── id          (serial, primary key)
├── uid         (text, unique — Firebase Auth UID)
├── email       (text)
└── created_at  (timestamp, default now)

assessments
├── id          (text, primary key — crypto.randomUUID())
├── user_uid    (text, foreign key → users.uid)
├── date        (text — ISO string)
├── company_name (text)
├── sector      (text)
├── file_name   (text)
├── file_type   (text — "PDF" or "CSV")
├── metrics     (jsonb — full FinancialMetrics object)
├── scores      (jsonb — full AssessmentScores object)
├── benchmarks  (jsonb — full SectorBenchmarks object)
└── created_at  (timestamp, default now)
```

### User Sync (`src/db/users.ts`)
The `getOrCreateUser()` function uses an **upsert** (`INSERT ... ON CONFLICT DO UPDATE`) to synchronise Firebase Auth users into PostgreSQL. This runs automatically on every authenticated request through the auth middleware.

### Connection (`src/db/index.ts`)
Creates a `pg.Pool` connection pool with a 15-second connection timeout. The pool handles connection reuse and error recovery automatically.

### Migrations
Drizzle Kit's `push` command is used (not SQL migration files). It reads the TypeScript schema and applies changes directly to the database. This runs automatically at container startup via `entrypoint.sh`.

---

## Authentication & Security

### Two Auth Modes

1. **Google Sign-In** (Firebase Authentication)
   - User clicks "Sign in with Google" → Firebase popup → Google OAuth consent
   - Frontend receives a Firebase ID token + Google access token
   - ID token is sent as `Authorization: Bearer <token>` on every API call
   - Server verifies the token using Firebase Admin SDK (`adminAuth.verifyIdToken`)

2. **Guest Mode**
   - User clicks "Direct Access (Guest Mode)"
   - No token is sent — server applies rate limiting instead
   - Assessment history stored in browser `localStorage`
   - Rate limit: 10 requests per 15 minutes per IP address

### Auth Middleware (`src/middleware/auth.ts`)

Two middleware functions:
- **`requireAuth`**: Returns 401 if no valid token. Used for `/api/history` CRUD operations.
- **`optionalAuth`**: Tries to verify token but proceeds as guest if missing. Used for `/api/assess` and `/api/rag/*`.

Both middleware functions automatically call `getOrCreateUser()` to sync the Firebase user into PostgreSQL.

### Firestore Security Rules (`firestore.rules`)
Defence-in-depth rules for the Firestore database (used alongside PostgreSQL):
- Global deny-all default (`allow read, write: if false`)
- Users can only read/write their own profile (`request.auth.uid == userId`)
- Assessments are **immutable** — updates are blocked (`allow update: if false`)
- Document IDs are validated against a regex pattern
- Field-level validation on creates (required fields, string length limits)

### Server-Side Security
- **File signature validation**: Magic byte checking prevents uploading executables disguised as PDFs
- **Input sanitisation**: Question length capped at 500 chars, top_k capped at 10
- **Document ownership**: Every RAG query verifies the requesting user owns the document
- **No disk writes**: Files are processed entirely in memory via multer
- **Timeout protection**: All external calls use `AbortController` with configurable timeouts (default 120s for LLM, 60s for RAG)

---

## Report Export (PDF & Google Docs)

### PDF Export (Client-Side)
`src/utils/pdfGenerator.ts` uses **jsPDF** to generate a multi-page A4 report entirely in the browser:
- Indigo-branded header with company name and assessment ID
- Executive summary with all scores
- Labour efficiency metrics with benchmarks
- Financial health metrics with benchmarks
- Digital maturity section with detected tools
- Numbered recommendations list
- Professional footer with page numbers

### Google Docs Export (Server-Side)
The `/api/export-docs` endpoint:
1. Verifies the user owns the assessment
2. Uses the Google OAuth access token (obtained during sign-in) to create a new Google Doc via the Google Docs API
3. Populates the document with a formatted text report
4. Returns the Google Docs URL to the frontend

This requires the Google Docs and Drive scopes, which are requested during sign-in:
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive.file`

---

## Docker & Deployment

### Dockerfile
Single-stage build based on `node:20-bookworm-slim`:
1. Installs system dependencies (Python 3, pip, venv, netcat)
2. Copies and installs Node dependencies (`npm install`)
3. Creates Python virtualenv and installs RAG dependencies
4. Copies application code
5. Builds frontend (Vite) and compiles server (esbuild)
6. Entrypoint: `entrypoint.sh`

### Docker Compose (`docker-compose.yml`)
Two services:
- **db**: PostgreSQL 15 Alpine with health check (`pg_isready`)
- **app**: The Vantly application, depends on `db` being healthy

The app service passes through LLM configuration from the host `.env` file and maps `host.docker.internal` to allow the container to reach Ollama running on the host machine.

### Entrypoint Script (`entrypoint.sh`)
1. Waits for PostgreSQL to accept connections (polls with `netcat`)
2. Runs Drizzle Kit migrations (`npx drizzle-kit push`)
3. Starts the production server (`npm start`)

---

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci-cd.yml`) runs on every push/PR to `main`:

| Job | What It Does |
|---|---|
| **node-check** | Installs Node 20, runs TypeScript typecheck (`tsc --noEmit`), builds production bundle |
| **python-check** | Installs Python 3.11, installs RAG dependencies, verifies syntax compilation of both `.py` files |
| **docker-build** | Builds the full Docker image (depends on both checks passing), uses GitHub Actions cache |
| **deploy** | Triggers a Render deploy hook (only on push to `main`, only if the secret is configured) |

---

## Evaluation Harness (RAGAS)

The `eval/` directory contains a comprehensive evaluation framework:

### Files
| File | Purpose |
|---|---|
| `evaluate.py` | Main RAGAS harness — indexes fixture document, runs N query passes, scores with RAGAS metrics |
| `score_only.py` | Lightweight scorer — runs queries and computes heuristic scores without RAGAS dependencies |
| `assess_e2e.py` | End-to-end assessment test — uploads a fixture file via the full `/api/assess` endpoint |
| `test_security_and_correctness.py` | Security tests — validates file rejection, rate limiting, ownership checks |
| `ground_truth.yaml` | 10 hand-written QA pairs against the fixture document |
| `fixtures/meridian_financials.txt` | Synthetic financial document (the test corpus) |
| `fixtures/meridian_scenario_c_degraded.txt` | Degraded version for testing robustness |

### RAGAS Metrics
| Metric | What It Measures |
|---|---|
| **Faithfulness** | Is every claim in the answer supported by retrieved chunks? |
| **Context Precision** | Are the most relevant chunks ranked highest? |
| **Context Recall** | Did retrieval surface all needed chunks? |
| **Answer Relevancy** | Does the answer actually address the question? |

See [eval/README.md](eval/README.md) for full setup and usage instructions.

---

## Project Structure

```
vantly/
├── src/
│   ├── App.tsx                     # Root component (auth, routing, state)
│   ├── main.tsx                    # React DOM entry point
│   ├── types.ts                    # TypeScript interfaces (FinancialMetrics, AssessmentScores, etc.)
│   ├── index.css                   # Global Tailwind CSS styles
│   ├── components/
│   │   ├── UploadForm.tsx          # File upload form with sector selector
│   │   ├── ResultsDashboard.tsx    # Score dashboard with charts (734 lines)
│   │   ├── RAGChat.tsx             # Document Q&A chat interface
│   │   ├── HistoryList.tsx         # Past assessment sidebar
│   │   └── VantlyLogo.tsx          # SVG logo component
│   ├── context/
│   │   └── AuthContext.tsx         # Firebase Auth React context provider
│   ├── db/
│   │   ├── schema.ts              # Drizzle ORM schema (users + assessments tables)
│   │   ├── drizzle.config.ts      # Drizzle Kit migration config
│   │   ├── index.ts               # PostgreSQL connection pool
│   │   └── users.ts               # User upsert helper (getOrCreateUser)
│   ├── lib/
│   │   ├── firebase.ts            # Firebase client SDK init (auth, firestore, Google provider)
│   │   ├── firebase-admin.ts      # Firebase Admin SDK init (server-side token verification)
│   │   └── firebaseConfig.json    # Firebase project configuration
│   ├── middleware/
│   │   └── auth.ts                # Express middleware (requireAuth, optionalAuth)
│   └── utils/
│       └── pdfGenerator.ts        # Client-side PDF report generation (jsPDF, 473 lines)
├── server.ts                       # Express API server — assessment engine, scoring, RAG proxy (1092 lines)
├── rag_service/
│   ├── main.py                    # FastAPI app with /health, /index, /extract, /query endpoints
│   ├── rag_engine.py              # RAGEngine class: text extraction, chunking, embedding, vector search
│   └── requirements.txt           # Python dependencies (fastapi, uvicorn, pypdf, numpy, requests)
├── eval/                           # RAGAS evaluation harness (see eval/README.md)
│   ├── evaluate.py                # Full RAGAS evaluation runner
│   ├── score_only.py              # Heuristic scoring without RAGAS
│   ├── assess_e2e.py              # End-to-end assessment tests
│   ├── test_security_and_correctness.py  # Security and validation tests
│   ├── ground_truth.yaml          # 10 QA pairs for evaluation
│   ├── fixtures/                  # Synthetic financial documents
│   └── requirements.txt           # Eval-specific Python dependencies
├── Dockerfile                      # Production image (Node 20 + Python 3)
├── docker-compose.yml              # PostgreSQL + app orchestration
├── entrypoint.sh                   # Container startup (wait for DB → migrate → serve)
├── firestore.rules                 # Firestore security rules
├── .github/workflows/ci-cd.yml    # CI/CD pipeline (4 jobs)
├── index.html                      # Vite HTML entry point
├── vite.config.ts                  # Vite + React + Tailwind plugin config
├── tsconfig.json                   # TypeScript compiler config
└── package.json                    # Node dependencies and npm scripts
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Server health check (`{"status":"ok"}`) |
| `GET` | `/api/benchmarks` | None | Returns all sector benchmark data |
| `POST` | `/api/assess` | Optional | Upload document for assessment (multipart: file, sector, companyName) |
| `GET` | `/api/history` | Required | List user's assessment history (newest first) |
| `GET` | `/api/history/:id` | Required | Get a specific assessment by ID |
| `DELETE` | `/api/history/:id` | Required | Delete an assessment (ownership verified) |
| `POST` | `/api/export-docs` | Required | Export assessment to Google Docs (body: assessmentId, googleAccessToken) |
| `GET` | `/api/rag/health` | Optional | Python RAG microservice health check |
| `POST` | `/api/rag/index` | Optional | Index a document into the vector store (multipart: doc_id, file) |
| `POST` | `/api/rag/query` | Optional | Query an indexed document (body: doc_id, question, top_k) |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | LLM provider (only `ollama` is supported) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` (Docker: `http://host.docker.internal:11434`) | Ollama API endpoint |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Default model for all tasks |
| `ASSESSMENT_MODEL` | (inherits `OLLAMA_MODEL`) | Override model for financial assessment |
| `RAG_MODEL` | (inherits `OLLAMA_MODEL`) | Override model for RAG queries |
| `STRATEGY_MODEL` | (inherits `OLLAMA_MODEL`) | Override model for strategy tasks |
| `SQL_HOST` | `db` (Docker) / `localhost` | PostgreSQL host |
| `SQL_PORT` | `5432` | PostgreSQL port |
| `SQL_USER` | `postgres` | PostgreSQL username |
| `SQL_PASSWORD` | `postgres` | PostgreSQL password |
| `SQL_DB_NAME` | `vantly` | PostgreSQL database name |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8000` | Python FastAPI RAG microservice URL |
| `VECTOR_STORE_FILE` | `/app/rag_service/data/vector_store.json` | Path to persisted JSON vector store |
| `RAG_MIN_SIMILARITY`| `0.25` | Minimum cosine similarity threshold for retrieval |
| `OPENAI_API_KEY` | — | Optional, only needed for RAGAS evaluation |

---

## Quick Start

### With Docker (Recommended)

```bash
# 1. Clone
git clone https://github.com/jagtappranit30/vantly.git
cd vantly

# 2. Make sure Ollama is running on host with Qwen 2.5
ollama pull qwen2.5:7b

# 3. Configure environment
cp .env.example .env

# 4. Start everything (PostgreSQL + Express + Python RAG)
docker compose up --build -d

# 5. Check logs & verify
docker compose logs -f app

# 6. Open http://localhost:3000
```

### Local Development

```bash
# Start PostgreSQL (via Docker or locally)
docker run -d --name vantly-db -e POSTGRES_DB=vantly -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:15-alpine

# Install Node dependencies
npm install

# Setup Python virtualenv for RAG service
cd rag_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Set SQL_HOST=localhost in .env
cp .env.example .env
# Edit .env: SQL_HOST="localhost"

# Run database migrations
npx drizzle-kit push --config=src/db/drizzle.config.ts

# Start dev server (Express + Vite HMR + Python RAG microservice)
npm run dev

# Open http://localhost:3000
```

---

## License

This project is proprietary. All rights reserved.
