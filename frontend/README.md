# Frontend — Glacier AI

React SPA for the [Glacier AI](../README.md) document assistant. Upload documents, watch
dual (vector + graph) indexing progress, then chat and compare **VectorRAG** and **GraphRAG**
answers side by side with full visibility into the agent's reasoning and the evidence it
retrieved.

- **React 19.2** + **TypeScript ~6.0** + **Vite 8**
- **Tailwind CSS 4** via `@tailwindcss/vite`, no CSS framework lock-in
- **Material Symbols Outlined** for all iconography
- **Zero runtime dependencies** beyond React — the SSE stream is parsed by hand with
  `fetch` + `ReadableStream`, no client library
- **No router** — `App.tsx` switches between two views with local state

---

## Table of Contents

- [Quick Start](#quick-start)
- [Project Layout](#project-layout)
- [Architecture](#architecture)
- [API Layer](#api-layer)
- [SSE Consumption](#sse-consumption)
- [Component Reference](#component-reference)
- [Styling & Theming](#styling--theming)
- [Scripts](#scripts)
- [TypeScript & ESLint Configuration](#typescript--eslint-configuration)
- [Known Gaps](#known-gaps)

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) `^20.19.0` or `>=22.12.0` (required by Vite 8)
- The backend running on `http://127.0.0.1:8000` (see [backend/README.md](../backend/README.md))

### Install & run

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### How the API is reached

There is **no base URL and no `.env` file**. `src/api.ts` sets `API_BASE = ""` and every call
uses a relative `/api/...` path. In development, Vite proxies those paths to the backend:

```ts
// vite.config.ts
server: {
  proxy: {
    "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
  },
}
```

So changing the backend port means editing `vite.config.ts`, not the source. The backend also
sends `allow_origins=["*"]`, so a direct cross-origin setup would work too.

---

## Project Layout

```
frontend/
├── index.html                 dark shell, Inter + Material Symbols preconnect/preload
├── package.json               scripts + deps
├── vite.config.ts             React + Tailwind plugins, /api dev proxy
├── eslint.config.js           flat config (js + tseslint + react-hooks + react-refresh)
├── tsconfig.json              solution file referencing app/node projects
├── tsconfig.app.json          src/ — bundler mode, strict
├── tsconfig.node.json         vite.config.ts — bundler mode
├── public/
│   ├── favicon.svg
│   └── icons.svg
└── src/
    ├── main.tsx               React 19 createRoot + StrictMode, imports index.css
    ├── App.tsx                view switch: UploadPage ⇄ ChatPage, workspace reset
    ├── api.ts                 typed client + SSE stream reader  ← the only network layer
    ├── index.css              Tailwind @theme glacier design tokens
    ├── App.css                legacy Vite template styles (currently unused)
    ├── assets/                hero.png, react.svg, vite.svg (currently unused)
    ├── pages/
    │   ├── UploadPage.tsx     drag & drop, folder upload, sample docs, progress bar
    │   └── ChatPage.tsx       chat thread, SSE state machine, sidebar, graph modal
    └── components/
        ├── Header.tsx         fixed top bar, logo, New Chat
        ├── Footer.tsx         upload-view footer
        ├── GlacierLogo.tsx    inline SVG mark (gradient ice triangle)
        ├── Icon.tsx           thin wrapper over material-symbols-outlined
        ├── AgentStepper.tsx   collapsible 8-step reasoning trace
        ├── RAGComparisonCard.tsx  side-by-side / single-pipeline answer cards
        └── GraphModal.tsx     knowledge graph explorer (search, filter, inspect)
```

---

## Architecture

Two views, one shared state machine, no router:

```
App.tsx
 ├── view === "upload"  → <UploadPage onFileUploaded={…} />   + <Footer />
 └── view === "chat"    → <ChatPage onNewUpload={…} initialFileName={…} />
```

- On mount, `App` calls `getIndexingStatus()`. If `stage === "complete"` **and**
  `chunk_count > 0`, it fetches the document list and jumps straight to the chat view — so a
  backend that is already indexed does not force a re-upload.
- `handleFileUploaded()` switches to chat after indexing completes.
- `handleNewChat()` calls `resetWorkspace()`, clears the filename, and returns to upload. This
  is what the header's **New Chat** button and the sidebar's **Change** button both do.

Note the asymmetry: indexing is tracked by **polling**, chat is **streamed**.

---

## API Layer

`src/api.ts` is the single place that talks to the backend. Every function returns parsed JSON
and throws on a non-2xx response (upload helpers surface FastAPI's `detail` field).

| Function | Endpoint | Notes |
|---|---|---|
| `checkHealth()` / `getHealth()` | `GET /api/health` | alias export; used for device + graph stats |
| `uploadFiles(files, maxGraphChunks = 12)` | `POST /api/upload` | `FormData`; appends one `files` part per file plus `max_graph_chunks` |
| `indexSampleDocument(sampleName, maxGraphChunks = 12)` | `POST /api/index-sample` | JSON `{ sample_name, max_graph_chunks }` |
| `getIndexingStatus()` | `GET /api/indexing-status` | polled every 700 ms while indexing |
| `getDocuments()` | `GET /api/documents` | active-source list + chunk count |
| `getGraphData()` | `GET /api/graph-data` | whole KG for the explorer modal |
| `resetWorkspace()` | `POST /api/reset` | wipes the backend knowledge base |
| `streamChat(message, onEvent, onError)` | `POST /api/chat` | SSE via manual parsing |

Shared types (`IndexingStatus`, `DocumentInfo`, `GraphNode`, `GraphLink`, `GraphData`,
`SSEEvent`) mirror the backend Pydantic models. `SSEEvent.data` is typed `any`.

---

## SSE Consumption

The backend emits **newline-delimited JSON** objects (`{"event": …, "data": …}\n`), not
spec-compliant `event:`-field SSE frames — so `EventSource` would not work (it also cannot POST
a JSON body). `streamChat` therefore does the parsing manually:

1. `POST /api/chat` with `{ message }`.
2. Throw if `!res.ok`, or if `!res.body`.
3. `response.body.getReader()` → `TextDecoder` → accumulate into `buffer`.
4. Split on `"\n"`, hold the trailing partial segment back in `buffer`.
5. `JSON.parse` each complete line; dispatch to `onEvent`. Unparsable lines (partial frames,
   keep-alives) are silently ignored.
6. Flush any remaining `buffer` after the stream closes.
7. Any thrown error goes to `onError`.

`ChatPage.handleSSEEvent()` then folds each event into message state:

| Event | Effect |
|---|---|
| `step` | `stepperState.currentStep = data.step` |
| `tool_decision` | records tool name + reason |
| `query_enhanced` | **appends** to `queryAttempts[]` (both attempts appear) |
| `evaluation_result` | records Useful / Not Useful per pipeline |
| `retry_notice` | shows the "formulating alternative query" note |
| `contexts_payload` | stores `vectorChunks`, `graphNodes`, `graphEdges` |
| `vector_start` / `vector_token` / `vector_done` | `isVectorStreaming` flag + `vectorText` accumulation, then the final `text` |
| `graph_start` / `graph_token` / `graph_done` | same for `graphText` |
| `done` | clears both streaming flags, sets step 8 |

Note `vector_token` **appends** while `vector_done` **replaces** with `data.text`. That is
intentional: it keeps token-by-token typing smooth while still trusting the authoritative
server-side accumulation. The `error` event is not handled by `handleSSEEvent` — it falls into
the `default: return msg` branch, so the backend's "no documents indexed" message is currently
not surfaced in the UI.

---

## Component Reference

### `App.tsx`

Owns `view` and `activeFileName`. Performs the resume-if-already-indexed check on mount.

### `pages/UploadPage.tsx`

- **Drag & drop zone** with hover glow, drag-over highlight, and a spinning hourglass while
  indexing. Click opens the file picker; a nested "Upload Folder" button stops propagation and
  opens a `webkitdirectory` input.
- Accepts `.pdf .docx .txt .csv .md`.
- `startPollingStatus()` sets a 700 ms `setInterval` that calls `getIndexingStatus()`,
  updates the progress bar, and:
  - clears the interval and shows `error` if `status.error` is set,
  - otherwise, on `!is_indexing && stage === "complete"`, waits 800 ms then calls
    `onFileUploaded()` and hands off to the chat view.
  The interval ref is cleared on unmount.
- **Three sample documents** mapped to backend assets: `example1.pdf` (FAISS library paper,
  *Vector Similarity Search & ANNS*, 12 pgs), `example2.pdf` (*Enterprise Knowledge Base*,
  technical specs, 8 pgs), `example3.pdf` (*Multi-Entity Relational Doc*, entities & systems,
  6 pgs). One click indexes them — no upload needed.
- **Live progress**: `stage` label + message, percentage, gradient bar, and counters for
  chunks / graph nodes / relations.
- A four-cell capability grid (Dual RAG Comparison, G-Retriever PCST, Agentic Tool Router,
  OOM-Safe Local Model) and dismissible error alert.

Multi-file uploads display as `first.pdf + N more`.

### `pages/ChatPage.tsx`

- **Left sidebar** (collapsible, `w-80` ↔ `w-0`): active source card with an *Indexed* badge
  and a 3-cell chunk/node/edge stat grid from `getHealth()`, an **Inspect Knowledge Graph**
  button, four **Suggested Inquiries** shortcuts that send immediately, and a footer showing
  `OOM-Safe Mode` plus the detected device.
- **Top mini bar**: sidebar toggle, current source name, `Dual Sequential RAG` label.
- **Thread**: user bubbles right-aligned with a `U` avatar; assistant blocks left-aligned with
  a psychology icon and then `AgentStepper` + `RAGComparisonCard`.
- **Empty state**: hero icon, "Compare VectorRAG & GraphRAG", and the first three suggested
  questions as pill buttons.
- **Input**: disabled and relabelled *"Generating answers sequentially (OOM-Safe)…"* while
  `isStreaming`. Footer hint `Steps: Tool Routing ➔ Enhance ➔ VectorRAG ➔ GraphRAG` and a
  "Local Gemma 4" indicator.
- Autoscrolls to the newest message on every `messages` change.
- `Message` shape: `{ id, role, content, vectorText, graphText, isVectorStreaming,
  isGraphStreaming, stepperState, vectorChunks, graphNodes, graphEdges }`.

### `components/AgentStepper.tsx`

Collapsible **"Agent Reasoning Pipeline"** panel with a `Step N / 8` pill and a pulsing
*Processing* indicator while streaming. Returns `null` below step 4. Renders:

- **4 — LLM Tool Routing**: chosen tool badge + the model's reason in italics.
- **5 — Query Expansion & Retrieval**: one block per attempt with the enhanced query.
- **6 — Context Utility & Verification**: green *Useful* / amber *Not Useful* chips for
  Vector and Graph, plus the retry notice when present.
- **7 — Sequential Generation (OOM Safe)**: current phase label and two pills,
  `1. VectorRAG` and `2. GraphRAG`, with the active one pulsing.

### `components/RAGComparisonCard.tsx`

Exports the `VectorChunk` / `GraphNodeData` / `GraphEdgeData` types consumed by `ChatPage`.

- **View toggle**: *Side-by-Side* (`grid-cols-1 lg:grid-cols-2`), *VectorRAG Only*,
  *GraphRAG Only*.
- **Vector card** (cyan): badge `FAISS IP • bge-m3`, subtitle *Dense passage semantic matching*,
  a blinking block caret while streaming, and a *Retrieved Chunks (n)* expander listing
  `doc_name • Chunk #order`, the similarity score, and clamped chunk text that expands on hover.
- **Graph card** (violet): badge `G-Retriever PCST Subgraph`, subtitle *Entity-relationship
  structured reasoning*. While the vector phase runs it shows
  *"Queued (executes sequentially to prevent GPU OOM)…"* — the visible manifestation of the
  sequential-generation strategy. A *Retrieved Subgraph (n nodes, m edges)* expander shows
  entity chips with types and typed relationships (`source --[TYPE]--> target`).

### `components/GraphModal.tsx`

Full-screen modal (`max-w-5xl`, `85vh`) knowledge-graph explorer backed by `getGraphData()`:

- **Left panel**: entity search (matches name *and* description), type filter pills derived
  dynamically from the nodes (`ALL` + every distinct type), and the filtered entity list with
  type badges.
- **Right panel**: selected entity card (type badge, id, name, description) plus every
  connected relationship with direction, type badge, `Weight: n`, and evidence text.
- Empty graph shows *"No entities found"*; the no-selection state prompts
  *"Select an entity from the list…"*.

This is an **inspector, not a rendered graph** — there is no node-link canvas or layout
library; relationships are presented as a readable list.

### `components/Header.tsx` / `Footer.tsx` / `GlacierLogo.tsx` / `Icon.tsx`

- `Header`: fixed, blurred `backdrop-blur-xl`, `GlacierLogo` + "Glacier AI" +
  `Doc Assistant / v1.0` chip + *Engine Ready* pulse, and the **New Chat** button.
- `Footer`: upload-view only — brand line plus placeholder links (`#`).
- `GlacierLogo`: inline SVG, 40×40 rounded square with a gradient ice triangle.
- `Icon`: `<span class="material-symbols-outlined" style={{ fontSize }}>{name}</span>`. Every
  icon is passed as a literal name string — no imports, no bundle cost.

---

## Styling & Theming

Tailwind 4's CSS-first config: no `tailwind.config.js`. All tokens live in the `@theme` block in
`src/index.css`, which generates utilities such as `bg-surface-container`, `text-on-surface`,
`text-primary`, `border-outline-variant`.

**Palette** — a cool "glacier" dark theme:

| Role | Value |
|---|---|
| `background` | `#0a0e1a` (near-black navy) |
| `surface` / `surface-dim` | `#0f1524` |
| `surface-container-lowest` → `-highest` | `#0a0e1a` → `#111828` → `#141c2e` → `#1a2438` → `#202c42` |
| `primary` | `#7dd3fc` (ice blue) — VectorRAG accent |
| `secondary` | `#88b4cc` (muted steel) |
| `tertiary` | `#c8a0f0` (violet) — GraphRAG accent |
| `error` | `#ff6b6b` |
| `outline` / `outline-variant` | `#4a6070` / `#2a3a48` |

**Type scale**: `font-headline`, `font-display`, `font-body`, and `font-label` all map to
Inter; `font-mono` falls back through `ui-monospace`, Cascadia Code, Fira Code, Consolas.
Inter and Material Symbols are loaded from Google Fonts in `index.html`, with `preconnect`
hints.

**Shape**: `--radius-DEFAULT: 0.5rem`, `lg: 1rem`, `xl: 1.5rem`, `full: 9999px`.

Dark mode is **not toggled** — `<html class="dark">` is set statically in `index.html` and the
palette only defines dark values.

Also in `index.css`: base resets, `-webkit-font-smoothing: antialiased`, custom 6 px scrollbars,
and an `animate-pulse-glow` keyframe utility.

Component styling leans on Tailwind v4 features: `backdrop-blur-xl` glass surfaces, gradient
borders and blurred gradient halos behind the dropzone, `animate-pulse` status dots, and the
`pulse-glow` animation.

---

## Scripts

| Command | Action |
|---|---|
| `npm run dev` | Vite dev server with HMR at <http://localhost:5173> and the `/api` proxy |
| `npm run build` | `tsc -b` (project references) then `vite build` into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | `eslint .` over all TS/TSX |

`build` runs type-checking first, so `tsc` errors block the bundle. `npm run preview` will not
proxy `/api`, so point it at a running backend differently if you need to test a production
build locally.

---

## TypeScript & ESLint Configuration

`tsconfig.json` is a solution file (`files: []`) with `references` to two projects, both of
which are `noEmit` type-check-only configs driven by `tsc -b`:

- `tsconfig.app.json` — covers `src/`. `target: es2023`, `lib: ["ES2023", "DOM"]`,
  `types: ["vite/client"]`, `moduleResolution: bundler`, `jsx: react-jsx`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly`, plus `noUnusedLocals`,
  `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
- `tsconfig.node.json` — covers `vite.config.ts`. Same linting flags but `lib: ["ES2023"]`
  (no DOM), `types: ["node"]`, and `module: nodenext`.

Note that `strict` is **not** explicitly enabled in either project.

`eslint.config.js` uses the flat config with `globalIgnores(['dist'])` and applies
`js.configs.recommended`, `tseslint.configs.recommended`,
`reactHooks.configs.flat.recommended`, and `reactRefresh.configs.vite` to `**/*.{ts,tsx}` with
browser globals.

To tighten the rules, swap `tseslint.configs.recommended` for
`recommendedTypeChecked` (or `strictTypeChecked`) / `stylisticTypeChecked` and add
`parserOptions.project` pointing at both tsconfigs. React-specific rules
(`eslint-plugin-react-x`, `eslint-plugin-react-dom`) can be layered on the same `extends` array.

---

## Known Gaps

- **No tests and no test runner** — no Vitest/Jest/Testing Library configured.
- **`npm run lint` currently fails** with 12 errors out of the box:
  - 4× `@typescript-eslint/no-explicit-any` — `catch (err: any)` blocks in `ChatPage.tsx`
    and `UploadPage.tsx`, plus `SSEEvent.data: any` in `api.ts` and `onError: (err: any)`.
  - 2× `@typescript-eslint/ban-ts-comment` — `@ts-ignore` on the `webkitdirectory` /
    `directory` inputs in `UploadPage.tsx`; ESLint wants `@ts-expect-error`.
  - React Hooks purity warnings from the `Date.now()`-keyed message IDs in
    `ChatPage.handleSend()`.

  These are template-era rules meeting app code, not new regressions.
- **No CI** configured for the frontend.
- **Dead scaffold files**: `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`,
  `src/assets/vite.svg` are Vite-template leftovers and are not imported anywhere.
- **No router** — a page reload on the chat view falls back to upload; only server-side
  indexing state is used to restore context.
- **`maxGraphChunks` default differs from the API** — `api.ts` defaults to `12` while the FastAPI
  routes and `store.index_files` default to `8`. The frontend always sends an explicit value, so
  this is currently invisible.
- **The `error` SSE event is ignored** by `handleSSEEvent`, so the backend's
  "No documents are currently indexed" message never reaches the user.
- **`GraphModal` is a list, not a visualisation** — no force layout or node-link rendering.
- **`Footer` links are dead** (`href="#"`), including the "API Specs" link that should point at
  `http://127.0.0.1:8000/docs`.
- **Google Fonts are a hard runtime dependency** — offline or restricted-network environments
  lose Inter and every Material Symbol.
- **No accessibility layer** — icon-only buttons rely on `title` at best, and the modal has no
  focus trap or `Escape` handler.
- **`getHealth`/`checkHealth` duplication** — two names for one request.