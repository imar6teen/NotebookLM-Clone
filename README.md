# Glacier AI — NotebookLM Clone

A fully local, agentic **Retrieval-Augmented Generation** document assistant that indexes
your documents **twice** — once as dense vectors and once as a knowledge graph — then answers
every question **twice** so you can compare the two retrieval paradigms side by side.

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS 4 (dark "glacier" theme)
- **Backend:** FastAPI + LangChain + FAISS + NetworkX, streaming over SSE
- **LLM + embeddings:** 100% local via [Ollama](https://ollama.com) (`gemma4:latest`) and
  `BAAI/bge-m3`
- **Fine-tuning:** QLoRA (NF4 + LoRA via PEFT/TRL) experiments on `google/gemma-4-E4B-it`

---

## Table of Contents

- [What Makes This Different](#what-makes-this-different)
- [Architecture at a Glance](#architecture-at-a-glance)
- [The 8-Step Agentic Pipeline](#the-8-step-agentic-pipeline)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Repository Layout](#repository-layout)
- [Design Documents](#design-documents)
- [Current Limitations](#current-limitations)
- [Further Reading](#further-reading)

---

## What Makes This Different

Most RAG demos answer one question with one retrieval strategy. This project answers with
**two independent strategies over the same document set**, and shows its work:

| | VectorRAG | GraphRAG |
|---|---|---|
| **Index** | `faiss.IndexFlatIP` over 1024-d `bge-m3` chunk embeddings | `networkx.DiGraph` of entities & relationships |
| **Retrieval** | Cosine top-k dense chunk match | **Prize-Collecting Steiner Tree** subgraph (G-Retriever / PCST) |
| **Best at** | Semantic passage lookup, "what does the doc say about X" | Multi-hop relational questions, "how is A connected to B" |
| **Context sent to LLM** | Top-5 chunks with source doc + chunk order | Retrieved subgraph serialized as entity/relationship text |
| **Card colour** | Cyan (primary) | Violet (tertiary) |

Additionally, an **8-step agentic loop** runs before any answer is generated:

- an LLM decides whether retrieval is even needed (so "hi" doesn't trigger a search),
- the query is rewritten/expanded into a better search query,
- both retrievers run, then a **relevance judge** scores the retrieved context,
- if the context is insufficient, a **second query with a different expansion strategy** is
  issued — this is the self-correcting retry loop.

Every stage emits an SSE event, so the UI renders a live **"Agent Reasoning Pipeline"**
stepper: tool decision → enhanced queries → Useful / Not Useful verdicts → generation phase.

### OOM-safe by design

Two answers are streamed from one local model. Generating them concurrently would spike VRAM,
so generation is **strictly sequential**: the VectorRAG answer streams to completion, *then*
the GraphRAG answer starts. The UI reflects this — the Graph card reads
*"Queued (executes sequentially to prevent GPU OOM)…"* while the Vector card is still typing.

---

## Architecture at a Glance

```
┌──────────────────────────────┐         ┌───────────────────────────────────────────┐
│  frontend/  (Vite :5173)    │  /api   │  backend/  (FastAPI :8000)                │
│                              │ ──────► │                                           │
│  UploadPage ── polling ──────┼─────────┼─► POST /api/upload   → async indexing      │
│  ChatPage  ── SSE reader ────┼─────────┼─► POST /api/chat     → run_agentic_pipeline│
│  AgentStepper                │         │                                           │
│  RAGComparisonCard           │         │  KnowledgeStore (singleton)                │
│  GraphModal                  │         │    ├─ VectorRAG  (FAISS + bge-m3)          │
└──────────────────────────────┘         │    └─ GraphRAG   (KG + PCST retrieval)     │
                                         │                                           │
                                         │  Ollama (gemma4:latest) — local inference  │
                                         └───────────────────────────────────────────┘
```

Indexing path: `upload → Docling/plain extraction → RecursiveCharacterTextSplitter (500/100)
→ bge-m3 embeddings → FAISS IndexFlatIP` and, in parallel,
`→ LLM entity/relation extraction → entity resolution → networkx DiGraph + node/edge indexes`.

Query path: `question → tool decision → query expansion → VectorRAG top-5 + GraphRAG PCST
subgraph → relevance evaluation → (retry once) → sequential answer generation (Vector, then Graph)`.

Full diagrams live in this repo — see [Design Documents](#design-documents).

---

## The 8-Step Agentic Pipeline

| Step | Title | What happens |
|---|---|---|
| 1–3 | *(indexing)* | Upload, extraction, chunking, vector + graph index build |
| 4 | Intent Analysis & Tool Decision | LLM returns `query_knowledge_base` or `none` (structured output) |
| 5 | Query Enhancement & Dual Retrieval | Query rewritten; VectorRAG `top_k=5` and GraphRAG `topk=8, topk_e=8` run |
| 6 | Context Relevance Evaluation | Judge marks each pipeline Useful / Not Useful; if either fails, reformulate with a *different* strategy and re-retrieve once |
| 7 | Sequential Answer Generation | VectorRAG streams first, then GraphRAG — never concurrently |
| 8 | Comparison Ready | Both answers plus retrieved contexts are on screen |

The retrieved evidence (`contexts_payload`) is also shipped to the client so you can expand
and read exactly which chunks and which subgraph nodes/edges backed each answer.

---

## Tech Stack

### Frontend

| Layer | Choice |
|---|---|
| UI | React 19.2, React DOM 19.2 |
| Language | TypeScript ~6.0 |
| Build | Vite 8 + `@vitejs/plugin-react` |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite`, Material Symbols Outlined icons |
| Lint | ESLint 10 (flat config) + typescript-eslint + react-hooks + react-refresh |
| Networking | `fetch` + `ReadableStream` reader for manual SSE parsing (no SSE library) |

### Backend

| Layer | Choice |
|---|---|
| API | FastAPI 0.141 (`fastapi[standard]`), Pydantic 2.13 |
| Orchestration | LangChain 1.4, LangGraph 1.2, LangChain-Ollama 1.1 |
| Document parsing | Docling 2.130 (`langchain-docling`) |
| Vector store | FAISS (CPU) 1.15 |
| Graph store | NetworkX 3.6 |
| ML | PyTorch 2.14 (CUDA 13.0 wheels on Linux/Windows), sentence-transformers 6.1, transformers 5.17 |
| Fine-tuning | PEFT 0.21, TRL 1.14, bitsandbytes 0.50, datasets 5.0 |
| ML math | scikit-learn 1.9, numpy, matplotlib |
| Packaging | uv (`uv_build`), Python 3.11 |

---

## Quick Start

### Prerequisites

- [uv](https://docs.astral.sh/uv/) (Python 3.11)
- [Node.js](https://nodejs.org/) `^20.19.0` or `>=22.12.0` (required by Vite 8)
- [Ollama](https://ollama.com/download) running locally
- Optional but recommended: a CUDA GPU (works on CPU, just slowly)

### 1. Pull the local model

```bash
ollama serve                 # if not already running
ollama pull gemma4:latest    # the LLM used for every pipeline stage
```

The embedding model `BAAI/bge-m3` (~2.2 GB) is downloaded automatically by
sentence-transformers on the first indexing request. A Hugging Face token is only needed if
you hit a gated-model rate limit.

### 2. Start the backend

```bash
cd backend
uv sync
uv run fastapi dev --reload src/notebooklm_clone/main.py     # http://127.0.0.1:8000
```

Interactive API docs: <http://127.0.0.1:8000/docs>

> The first request is slow: model + embedding weights load into VRAM and the sample PDFs get
> parsed. Check progress at `GET /api/health` and `GET /api/indexing-status`.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev                                                   # http://localhost:5173
```

Vite proxies `/api/*` to `http://127.0.0.1:8000`, so no CORS or env configuration is needed
in development. Open the app, click one of the three **sample documents**, and ask a question.

### 4. (Optional) Fine-tune the model

The `notebook/` folder holds the QLoRA experiment — see
[backend/README.md](backend/README.md#notebooks--fine-tuning-experiments).

---

## Repository Layout

```
.
├── README.md                  ← you are here
├── SysArc.png                 system architecture diagram
├── App DB.png                 application data / DB diagram
├── UserFlow.png               end-user flow diagram
│
├── backend/                   FastAPI service + RAG engine   → backend/README.md
│   ├── pyproject.toml         uv project, deps, CUDA torch index
│   ├── uv.lock                locked resolution (228 packages)
│   ├── .python-version        3.11
│   └── src/notebooklm_clone/
│       ├── main.py            FastAPI app: upload, index, chat (SSE), graph, reset
│       ├── rag/
│       │   ├── types.py       Pydantic schemas (Chunk, ExtractorOutput, IndexingProgress…)
│       │   ├── store.py       KnowledgeStore singleton + background indexing thread
│       │   ├── extraction.py  Docling/plain readers + text splitter
│       │   ├── embeddings.py  bge-m3 encoder + FAISS index factory
│       │   ├── vector_rag.py  VectorRAG: add_chunks / search / clear
│       │   ├── graph_rag.py   GraphRAG: extraction, entity resolution, PCST retrieval
│       │   ├── agent.py       8-step agentic pipeline + SSE event emission
│       │   └── __init__.py    early scratch BaseRAG sketch (unused by the app)
│       ├── assets/            example1-3.pdf sample documents (git-ignored)
│       └── notebook/          rag_example.ipynb, QLoRA.ipynb, post_QLoRA.ipynb
│
└── frontend/                  React SPA                    → frontend/README.md
    ├── package.json
    ├── vite.config.ts         React + Tailwind plugins, /api proxy
    ├── index.html             dark shell, Inter + Material Symbols
    └── src/
        ├── api.ts             typed API client + SSE stream reader
        ├── App.tsx            upload ⇄ chat view switch, workspace reset
        ├── index.css          Tailwind @theme glacier palette
        ├── pages/             UploadPage, ChatPage
        └── components/        Header, Footer, GlacierLogo, Icon, AgentStepper,
                               RAGComparisonCard, GraphModal
```

---

## Design Documents

Diagrams committed at the repository root:

| File | Contents |
|---|---|
| `SysArc.png` | System architecture — services, retrieval layers, model runtime |
| `App DB.png` | Application data model / persistence layout |
| `UserFlow.png` | End-user flow — upload, indexing progress, chat, comparison |

---

## Current Limitations

Worth knowing before you build on this:

- **Single workspace, in-memory.** Every upload calls `store.reset()`, so there is no
  multi-document accumulation and nothing survives a backend restart. `POST /api/reset` is
  wired to the *New Chat* button.
- **State is a process-wide singleton.** `store` is a module-level `KnowledgeStore`; scaling to
  multiple workers or users would require per-session isolation.
- **CORS is fully open** (`allow_origins=["*"]`). Fine for local dev, must be locked down for
  deployment.
- **Graph indexing is LLM-bound.** Every graph-extraction call is a local LLM round-trip over up
  to `max_graph_chunks` chunks, which dominates indexing time. Tune via the
  `max_graph_chunks` form field on `/api/upload`.
- **The PCST solver prefers `pcst_fast`**, a native extension that is *not* declared in
  `pyproject.toml`. Without it the code silently falls back to a pure-Python GW primal-dual
  implementation (`_solve_pcst`) — correct, but slower.
- **Fallback PDF reader is incomplete.** `extraction.py` falls back to `pypdf`, which is not a
  declared dependency; if Docling fails you will get an import error instead of a graceful
  fallback.
- **Chat history is not persisted.** `ChatRequest.conversation_history` exists in the schema
  but the frontend sends only `{ message }` and the pipeline does not read history.
- **No tests and no CI** are configured yet.

---

## Further Reading

- [backend/README.md](backend/README.md) — API reference, RAG internals, pipeline details,
  notebooks, troubleshooting
- [frontend/README.md](frontend/README.md) — component map, SSE contract consumption,
  theming, build & lint commands
- LangGraph: <https://langchain-ai.github.io/langgraph/>
- FAISS: <https://faiss.ai/>
- sentence-transformers `BAAI/bge-m3`: <https://huggingface.co/BAAI/bge-m3>
- QLoRA paper: <https://arxiv.org/abs/2305.14314>