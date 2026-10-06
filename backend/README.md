# Backend — Glacier AI (NotebookLM Clone)

The FastAPI service and RAG engine behind [Glacier AI](../README.md). It ingests documents,
builds **both** a vector index and a knowledge graph, then streams an 8-step agentic pipeline
over Server-Sent Events so the frontend can render each reasoning stage live.

- **Framework:** FastAPI 0.141 + Pydantic 2.13
- **Runtime:** Python 3.11 (`.python-version`), managed with [uv](https://docs.astral.sh/uv/)
- **LLM:** local `gemma4:latest` via Ollama (`num_ctx=4096`)
- **Embeddings:** `BAAI/bge-m3`, 1024-d, L2-normalized (dot product == cosine)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Project Layout](#project-layout)
- [API Reference](#api-reference)
- [Indexing Pipeline](#indexing-pipeline)
- [Agentic Query Pipeline](#agentic-query-pipeline)
- [SSE Event Contract](#sse-event-contract)
- [Module Reference](#module-reference)
- [Data Models](#data-models)
- [Notebooks & Fine-Tuning Experiments](#notebooks--fine-tuning-experiments)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Known Gaps](#known-gaps)

---

## Quick Start

### Prerequisites

- [uv](https://docs.astral.sh/uv/)
- [Ollama](https://ollama.com/download) running, with the LLM pulled:

```bash
ollama serve
ollama pull gemma4:latest
```

- Optional: NVIDIA GPU + CUDA 13.0 drivers. `pyproject.toml` points `torch` and `torchvision`
  at the `pytorch-cu130` wheel index on Linux/Windows. Without a GPU everything falls back to
  CPU automatically (`torch.cuda.is_available()` is checked at startup and in the embedder).

### Install & run

```bash
cd backend
uv sync
uv run fastapi dev --reload src/notebooklm_clone/main.py
```

The API listens on <http://127.0.0.1:8000>. Interactive docs: <http://127.0.0.1:8000/docs>,
OpenAPI schema: `/openapi.json`.

For a non-reloading production-style run:

```bash
uv run uvicorn notebooklm_clone.main:app --host 0.0.0.0 --port 8000
```

> **Note on the packaged script.** `uv run notebooklm-clone` resolves to
> `notebooklm_clone:main`, which is a small FAISS sanity-check demo in
> `src/notebooklm_clone/__init__.py` (random vectors, `IndexFlatL2`, cosine matrix). It does
> **not** start the API — use `fastapi dev` / `uvicorn` for the service.

### First-run warm-up

The very first indexing call pays for:

1. downloading `BAAI/bge-m3` (~2.2 GB) from Hugging Face,
2. loading `gemma4:latest` into VRAM,
3. Docling model files for PDF parsing.

Later requests reuse cached weights. Watch progress with `GET /api/indexing-status`.

---

## Project Layout

```
backend/
├── pyproject.toml            project metadata, deps, CUDA torch index, uv_build backend
├── uv.lock                   pinned resolution (228 packages)
├── .python-version           3.11
└── src/notebooklm_clone/
    ├── __init__.py           `main()` — standalone FAISS demo (console entry point)
    ├── main.py               FastAPI app: all HTTP routes
    ├── utils.py              empty placeholder
    ├── assets/               example1.pdf, example2.pdf, example3.pdf  (git-ignored)
    ├── notebook/             rag_example.ipynb, QLoRA.ipynb, post_QLoRA.ipynb
    │   ├── qlora_gemma_4_e4b/checkpoint-450/      LoRA adapter + optimizer state
    │   └── qlora_gemma_4_e4b_model/                merged, pushable model
    └── rag/
        ├── types.py          all Pydantic schemas
        ├── store.py          KnowledgeStore singleton, background indexing
        ├── extraction.py     Docling / plain readers + chunk splitter
        ├── embeddings.py     bge-m3 encoder + FAISS index factory
        ├── vector_rag.py     VectorRAG
        ├── graph_rag.py      GraphRAG + entity resolution + PCST retrieval
        ├── agent.py          8-step pipeline, SSE emission, LLM helpers
        └── __init__.py       early BaseRAG sketch — superseded, unused by the app
```

> `rag/__init__.py` contains stub `BaseRAG` / `VectorRAG` / `GraphRAG` classes with empty
> method bodies. They are **not** the classes the app uses — the live implementations live in
> `rag/vector_rag.py` and `rag/graph_rag.py`. Import from those modules directly.

---

## API Reference

Base URL `http://127.0.0.1:8000`. CORS is wide open (`allow_origins=["*"]`) for local dev.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Liveness banner: status, service name, `cuda_available`, `is_indexed` |
| `GET` | `/api/health` | Full stats: device name, chunks, graph nodes, graph edges |
| `GET` | `/api/indexing-status` | Current `IndexingProgress` (polled by the UI every 700 ms) |
| `GET` | `/api/documents` | List of indexed `DocumentInfo` records |
| `GET` | `/api/graph-data` | Whole KG as `{ nodes, links }` for the graph explorer modal |
| `POST` | `/api/reset` | Clear documents, chunks, vector index, graph, progress |
| `POST` | `/api/upload` | Multipart upload → background indexing |
| `POST` | `/api/index-sample` | Index a PDF already in `src/notebooklm_clone/assets/` |
| `POST` | `/api/chat` | SSE stream of the 8-step agentic pipeline |

### `POST /api/upload`

`multipart/form-data`

| Field | Type | Default | Notes |
|---|---|---|---|
| `files` | `List[UploadFile]` | required | Multiple files; folder drops arrive as many parts |
| `max_graph_chunks` | `int` (form) | `8` | Upper bound of chunks sent to LLM graph extraction |

Each upload is written to a fresh `tempfile.mkdtemp()` directory and then `store.reset()` is
called, so **each upload replaces the previous knowledge base**. Indexing runs in the
background; the response returns immediately.

```bash
curl -X POST http://127.0.0.1:8000/api/upload \
  -F "files=@src/notebooklm_clone/assets/example3.pdf" \
  -F "max_graph_chunks=12"
```

```json
{ "message": "Uploaded 1 file(s). Indexing started.", "files": ["example3.pdf"] }
```

### `POST /api/index-sample`

JSON body `{"sample_name": "example1.pdf"}`, plus an optional query param `max_graph_chunks`
(default `8`). Resolution falls back to a substring glob over `assets/` so `"example1"` also
works; a miss returns `404`.

```bash
curl -X POST "http://127.0.0.1:8000/api/index-sample?max_graph_chunks=12" \
  -H "Content-Type: application/json" \
  -d '{"sample_name": "example1.pdf"}'
```

### `POST /api/chat`

JSON body:

```json
{ "message": "What is the main contribution of this document?", "conversation_history": [] }
```

Returns `text/event-stream`. Each line is a JSON object `{ "event": <name>, "data": <payload> }`
terminated by `\n`. If nothing is indexed yet, the stream emits a single `error` event
followed by `done`. See [SSE Event Contract](#sse-event-contract).

### `GET /api/health`

```json
{
  "status": "healthy",
  "cuda": true,
  "device": "NVIDIA GeForce RTX 4070",
  "is_indexed": true,
  "total_chunks": 137,
  "total_nodes": 64,
  "total_edges": 91
}
```

---

## Indexing Pipeline

`KnowledgeStore.index_files()` runs on a single-worker `ThreadPoolExecutor` so long indexing
jobs never block the event loop. It publishes `IndexingProgress` throughout:

| Percent | `stage` | Action |
|---|---|---|
| 5 | `extraction` | Docling / plain extraction per file, then chunking |
| 25 | `vector_indexing` | `bge-m3` embeddings for all new chunks → FAISS |
| 40–92 | `graph_indexing` | Per-chunk LLM entity/relation extraction (progress callback scales 40→92) |
| 100 | `complete` | Node/edge counts published, `is_indexing=false` |
| — | `error` | Exception message stored in `progress.error` |

Extraction routing in `rag/extraction.py`:

- `.txt .md .markdown .csv .json .log` → direct UTF-8 read
- `.pdf .docx .pptx .html` → `DoclingLoader` with `ExportType.MARKDOWN`
- anything else → best-effort UTF-8 read

Chunking uses `RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)` with
separators `["\n\n", "\n", ". ", " ", ""]`. Each `Chunk` gets a UUID, plus metadata carrying
`doc_id` (8-char UUID), `doc_name`, chunk `order`, and `doc_size`.

---

## Agentic Query Pipeline

`run_agentic_pipeline()` in `rag/agent.py` is an async generator yielding newline-delimited JSON
SSE payloads.

**Step 4 — Intent analysis & tool decision.** `decide_tool_call()` asks the LLM for a
structured `AgentToolDecision`. Document questions → `query_knowledge_base`; greetings and
chit-chat → `none`. If the LLM is unreachable it **defaults to retrieval** (fail-open toward
more coverage). When the decision is `none` *and* nothing is indexed, the pipeline streams a
direct conversational answer and short-circuits to `done`.

**Step 5 — Query enhancement & dual retrieval.** `enhance_query()` produces a rewritten
search query via structured `QueryEnhancerOutput`. Then:

- `vector_rag.search(enhanced_query, top_k=5)`
- `graph_rag.search(enhanced_query, topk=8, topk_e=8)` → `(subgraph, context_text)`

**Step 6 — Relevance evaluation & retry.** `evaluate_relevance()` scores each context
independently (`USEFUL` / `NOT_USEFUL`). Empty or near-empty context short-circuits to *not
useful* without an LLM call. If **either** pipeline is judged not useful, the pipeline issues a
**second** expansion using a deliberately different strategy (`attempt=2` prompt broadens and
decomposes instead of adding synonyms) and re-retrieves only the failing pipeline.

**Step 7 — Sequential answer generation (OOM-safe).** VectorRAG answer streams to completion
first, then GraphRAG. If a pipeline's context was judged useless, it emits a short
"I don't know…" message instead of calling the LLM. All LLM stages use `temperature=0.1`,
`num_ctx=4096`.

**Step 8 — Comparison ready.** Both answers and the retrieved evidence are on the wire.

---

## SSE Event Contract

Every line: `{"event": "<name>", "data": <payload>}\n`.

| Event | `data` | Emitted at |
|---|---|---|
| `step` | `{ step: 4..8, title, detail }` | Phase markers for the UI stepper |
| `tool_decision` | `{ tool_name, query, reason }` | After step 4 |
| `query_enhanced` | `{ attempt, original_query, enhanced_query }` | Once per expansion attempt |
| `evaluation_result` | `{ attempt, vector_useful, vector_reason, graph_useful, graph_reason }` | After each relevance check |
| `retry_notice` | `{ attempt: 2, message }` | Before the second expansion |
| `contexts_payload` | `{ vector_chunks[], graph_nodes[], graph_edges[] }` | Before generation |
| `vector_start` | `{}` | Beginning of VectorRAG generation |
| `vector_token` | `string` (raw token text) | Per streamed token |
| `vector_done` | `{ text }` | Full accumulated VectorRAG answer |
| `graph_start` | `{}` | Beginning of GraphRAG generation |
| `graph_token` | `string` | Per streamed token |
| `graph_done` | `{ text }` | Full accumulated GraphRAG answer |
| `error` | `string` | No documents indexed (only case today) |
| `done` | `{}` | Terminal event; always last |

`vector_chunks[]` entries carry `{ id, content, score, doc_name, order }`;
`graph_nodes[]` carry `{ id, name, type, description }`;
`graph_edges[]` carry `{ source, target, type, description, weight }`.

Example transcript:

```
{"event": "step", "data": {"step": 4, "title": "Intent Analysis & Tool Decision", "detail": "..."}}
{"event": "tool_decision", "data": {"tool_name": "query_knowledge_base", "query": "...", "reason": "..."}}
{"event": "step", "data": {"step": 5, "title": "Query Enhancement & Dual Retrieval", "detail": "..."}}
{"event": "query_enhanced", "data": {"attempt": 1, "original_query": "...", "enhanced_query": "..."}}
{"event": "evaluation_result", "data": {"attempt": 1, "vector_useful": false, "vector_reason": "...", "graph_useful": true, "graph_reason": "..."}}
{"event": "retry_notice", "data": {"attempt": 2, "message": "Context insufficient. Formulating alternative enhanced query..."}}
{"event": "contexts_payload", "data": {"vector_chunks": [...], "graph_nodes": [...], "graph_edges": [...]}}
{"event": "vector_start", "data": {}}
{"event": "vector_token", "data": "FAISS"}
...
{"event": "graph_done", "data": {"text": "..."}}
{"event": "step", "data": {"step": 8, "title": "Comparison Ready", "detail": "..."}}
{"event": "done", "data": {}}
```

---

## Module Reference

### `rag/embeddings.py`

Lazily loads one shared `SentenceTransformer("BAAI/bge-m3")` on `cuda` when available, else
`cpu`. `embedding_fn(texts)` returns L2-normalized `float32` `(n, 1024)` arrays, so FAISS inner
product equals cosine similarity. `create_faiss_index(dim)` returns `faiss.IndexFlatIP`.

### `rag/vector_rag.py`

`VectorRAG` holds a parallel list of `Chunk` objects and the `IndexFlatIP` index. `add_chunks`
embeds and appends; `search(query, top_k=5)` returns `list[tuple[Chunk, float]]` sorted by
similarity; `clear()` reallocates the index; `total_chunks()` reports the chunk count. An empty
index short-circuits to `[]`.

### `rag/graph_rag.py`

The heaviest module. Pipeline inside `GraphRAG.build()`:

1. **`extract_entities_relationships(chunks, llm, max_chunks)`** — structured-output extraction
   per chunk (chunks under 60 chars are skipped). Entity types: `PERSON`, `ORGANIZATION`,
   `LOCATION`, `OBJECT`, `EVENT`, `CONCEPT`. Relationship types: `WORKS_AT`, `PART_OF`,
   `LOCATED_IN`, `DEPENDS_ON`, `CREATED_BY`, `OWNS`, `BOUGHT`, `FOLLOWS`, `RELATED_TO`.
2. **`entity_resolution(...)`** — the interesting part:
   - embeds every entity mention,
   - **blocks** candidates by entity type, then sub-clusters large blocks (≥15 mentions) with
     KMeans (`k = clamp(n // 5, 2, 8)`) to avoid O(n²) pairwise comparison,
   - merges via **exact normalized-name match**, then **cosine similarity ≥ 0.82** inside each
     block, using **Union-Find (DSU)**,
   - picks a canonical name/type/description per cluster by frequency (`Counter`),
   - relinks relationships to canonical IDs and merges duplicate edges, accumulating
     `weight` and joining evidence strings with `" ; "`.
3. **`build_kg(...)`** — a `networkx.DiGraph`; nodes carry `name`/`type`/`description`, edges
   carry `type`/`description`/`weight`/`edge_idx`.
4. Node and edge text embeddings are added to two `IndexFlatIP` indexes.

Retrieval is `subgraph_construction(...)`, a **G-Retriever Prize-Collecting Steiner Tree**
implementation:

- node prizes = top-`k` cosine similarity to the query, decayed `k…1`,
- edge prizes = top-`k_e` similarity values, distributed across ties,
- an edge is a *cost* edge when `prize_e <= cost_e`, otherwise it is split by a **virtual node**
  whose prize is `prize_e - cost_e` (this is the standard PCST trick for rewarded edges),
- `_solve_pcst()` prefers the native `pcst_fast` extension and **falls back to a pure-Python
  Goemans-Williamson primal-dual implementation** (union-find clustering, moat growth,
  degree-1 pruning) when the extension is missing,
- the selected vertex/edge sets are mapped back to real nodes and pruned to the chosen edges.

`subgraph_to_text(subgraph)` serializes the result into an
`=== Relevant Knowledge Graph Entities ===` / `=== Relevant Relationships ===` block for the
LLM. `to_dict()` exports `{ nodes, links }` for the UI explorer.

### `rag/extraction.py`

`extract_document(file_path, doc_name)` → `list[Document]`;
`chunk_documents(docs, doc_id, doc_name, chunk_size=500, chunk_overlap=100)` → `list[Chunk]`.
If Docling fails on a PDF it attempts a `pypdf` fallback (see [Known Gaps](#known-gaps)).

### `rag/store.py`

`KnowledgeStore` is the coordination layer: `documents`, `chunks`, `vector_rag`, `graph_rag`,
`progress`, and a `ThreadPoolExecutor(max_workers=1)`. `start_indexing_async()` wraps
`index_files()` via `loop.run_in_executor`, so uploads return instantly. A module-level
`store = KnowledgeStore()` singleton is imported by `main.py`. Exceptions are caught, logged,
and surfaced through `progress.error` / `progress.stage = "error"` rather than crashing the app.

### `rag/agent.py`

LLM helpers plus the pipeline: `get_llm(temperature=0.1)` returns
`ChatOllama(model="gemma4:latest", num_ctx=4096)`; `decide_tool_call`, `enhance_query`,
`evaluate_relevance`, and the async `run_agentic_pipeline`.

---

## Data Models

All in `rag/types.py` (Pydantic v2).

| Model | Purpose / key fields |
|---|---|
| `ChunkMetadata` | `doc_id`, `doc_name`, `order`, `doc_size` |
| `Chunk` | `id` (UUID), `content`, `metadata` |
| `EntityItem` | `id`, `name`, `type` (default `CONCEPT`), `description` |
| `RelationshipItem` | `source`, `type` (default `RELATED_TO`), `target`, `description`, `weight` |
| `ExtractorOutput` | `entities[]`, `relationships[]` — the LLM extraction schema |
| `QueryEnhancerOutput` | `query` |
| `AgentToolDecision` | `tool_name`, `query`, `reason` |
| `RelevanceEvaluationOutput` | `is_useful`, `reason` |
| `DocumentInfo` | `id`, `name`, `size`, `num_chunks`, `status` |
| `IndexingProgress` | `is_indexing`, `progress_percent`, `stage`, `message`, `doc_count`, `chunk_count`, `node_count`, `edge_count`, `error` |
| `ChatRequest` | `message`, `conversation_history` |

`ChunkMetadata` and the document models are the persisted/transport contracts between the API
and the frontend; the remaining models exist to give the LLM a strict structured-output schema.

---

## Notebooks & Fine-Tuning Experiments

`src/notebooklm_clone/notebook/` contains the exploratory notebooks behind the project.
Open them with the project kernel:

```bash
cd backend
uv run jupyter lab src/notebooklm_clone/notebook
```

> The notebooks have their kernelspec pinned to `.venv`, so launch Jupyter **from `backend/`**.

### `rag_example.ipynb` — the RAG prototype

The notebook the production modules were distilled from. Walks through VectorRAG
(extraction → chunking → embedding → indexing → query enhancement → retrieval → answering)
and then GraphRAG (entity/relation extraction → entity resolution → KG build → node/edge
embedding → PCST subgraph construction → subgraph-to-text → answering) against
`../assets/example1.pdf` and `../assets/example3.pdf`. Uses `pcst_fast` directly, which is
why the service ships a pure-Python fallback.

### `QLoRA.ipynb` — quantized LoRA fine-tuning of `google/gemma-4-E4B-it`

1. Load the multimodal base model and run a chat-template inference sanity check.
2. Quantize with `BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
   bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.float32)` and report the
   memory footprint before/after.
3. `prepare_model_for_kbit_training`, then attach LoRA:
   `r=8`, `lora_alpha=16`, `bias="none"`, `lora_dropout=0.05`, `task_type="CAUSAL_LM"`,
   targeting
   `.*language_model.*(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)`.
   Prints trainable vs total parameters.
4. SFT with TRL `SFTTrainer` + `SFTConfig`: `gradient_checkpointing=True` (reentrant),
   `gradient_accumulation_steps=2`, `per_device_train_batch_size=8` with `auto_find_batch_size=True`,
   `max_length=128`, `packing=False`. Dataset: `dvgodoy/yoda_sentences` reshaped into chat
   `messages`.
5. Result: `notebook/qlora_gemma_4_e4b/checkpoint-450/` (adapter, optimizer, scheduler, RNG
   state, trainer state, tokenizer, chat template).

### `post_QLoRA.ipynb` — reload, merge, publish

Loads the base model in 4-bit, attaches the checkpoint as a `PeftModel`, runs inference,
then `model.merge_and_unload()` and `save_pretrained` into
`notebook/qlora_gemma_4_e4b_model/`, finally pushing processor + model to the Hugging Face Hub.

**Security note:** `QLoRA.ipynb` and `post_QLoRA.ipynb` hardcode a `HF_TOKEN` value in a cell.
Rotate that token if it is real, and switch to `os.environ["HF_TOKEN"]` sourced from your
shell or a `.env` file (already git-ignored at the repo root) before sharing this repository.

Trained artefact metadata (`qlora_gemma_4_e4b/README.md`): TRL 1.14.1, Transformers 5.17.0,
PyTorch 2.11.0+cu130.

---

## Configuration

There is **no settings file** — configuration is intentionally hardcoded:

| Knob | Value | Where |
|---|---|---|
| LLM model | `gemma4:latest` | `rag/agent.py` → `get_llm()` |
| LLM context | `num_ctx=4096` | `rag/agent.py` |
| Embedding model | `BAAI/bge-m3` | `rag/embeddings.py` |
| Embedding dim | `1024` | `rag/embeddings.py` → `EMBEDDING_DIM` |
| Chunk size / overlap | `500 / 100` | `rag/extraction.py` → `chunk_documents()` |
| Vector `top_k` | `5` | `rag/agent.py` |
| Graph `topk` / `topk_e` | `8 / 8` | `rag/agent.py` |
| PCST edge cost `cost_e` | `0.5` | `rag/graph_rag.py` |
| Entity merge threshold | `0.82` | `rag/graph_rag.py` → `entity_resolution()` |
| Default `max_graph_chunks` | `8` on both routes; `12` in `start_indexing_async` and in the frontend | `main.py`, `store.py`, `api.ts` |
| Bind host/port | `127.0.0.1:8000` | how you launch it |

Environment variables consumed indirectly: `HF_TOKEN` (model downloads), `OLLAMA_HOST`
(default `http://localhost:11434` via the `ollama` client), `CUDA_VISIBLE_DEVICES`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ConnectionError` to Ollama, or `model 'gemma4:latest' not found` | `ollama serve` is not running, or `ollama pull gemma4:latest` was skipped. Confirm with `ollama list`. |
| `GET /api/health` shows `"cuda": false` | No NVIDIA GPU/driver, or torch resolved to a CPU build. The app still works, just slowly. |
| First upload hangs for minutes | Normal — `bge-m3` download plus Docling model fetch. Poll `/api/indexing-status`. |
| `IndexingProgress.stage == "error"` | Read `progress.error`. Most common causes: Docling parse failure, empty document text, or an unavailable Ollama model. |
| Graph has 0 nodes | No chunks produced entities. Raise `max_graph_chunks` and confirm the document has descriptive prose rather than pure tables/figures. |
| Very slow graph indexing | Each extracted chunk is one LLM round-trip. Lower `max_graph_chunks`. |
| `GET /api/chat` emits an `error` event | Nothing indexed. Upload or index a sample first. |
| Stream returns nothing after `vector_done` | Graph generation is queued behind the vector answer by design — wait; it is OOM mitigation, not a hang. |
| `pcst_fast` import warning in logs | Expected. The native extension is not a declared dependency; `_solve_pcst` transparently uses the Python GW solver. |
| Frontend shows "Please check backend connection" | Backend is not on `127.0.0.1:8000`, or Vite's `/api` proxy target is wrong (`frontend/vite.config.ts`). |
| `Docling extraction failed … attempting fallback` then `ModuleNotFoundError: pypdf` | Known gap — `pypdf` is not a declared dependency. See [Known Gaps](#known-gaps). |

---

## Known Gaps

- **`pypdf` is not declared** in `pyproject.toml`, so the PDF fallback in
  `rag/extraction.py` raises `ModuleNotFoundError` instead of degrading gracefully. Add
  `pypdf` to the dependencies (or drop the fallback).
- **`pcst_fast` is not declared** either. It is imported opportunistically inside
  `_solve_pcst` with a broad `except`, so behaviour is correct without it — only slower.
- **`rag/__init__.py` contains dead code** — stub `BaseRAG`/`VectorRAG`/`GraphRAG` classes
  that shadow nothing but invite confusion. Safe to delete.
- **`utils.py` is empty.**
- **No tests, no linter/formatter config, no CI** for the Python side.
- **Single-tenant singleton** — `store` is process-global; uvicorn multi-worker or concurrent
  users would corrupt each other's knowledge base.
- **No persistence** — vectors and graph live in RAM only; a restart requires re-indexing.
- **`ChatRequest.conversation_history` is unused**; the agent is stateless across turns.
- **Hardcoded token in notebooks** — see the security note above.