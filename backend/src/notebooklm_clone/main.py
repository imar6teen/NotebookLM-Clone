import os
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from notebooklm_clone.rag.types import ChatRequest, IndexingProgress, DocumentInfo
from notebooklm_clone.rag.store import store
from notebooklm_clone.rag.agent import run_agentic_pipeline

app = FastAPI(
    title="NotebookLM Clone API",
    description="VectorRAG and GraphRAG (G-Retriever) Document Assistant",
    version="0.1.0"
)

# Enable CORS for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ASSETS_DIR = Path(__file__).resolve().parent / "assets"


class SampleIndexRequest(BaseModel):
    sample_name: str


@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "NotebookLM Clone API",
        "cuda_available": torch.cuda.is_available(),
        "is_indexed": store.is_indexed(),
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "cuda": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "is_indexed": store.is_indexed(),
        "total_chunks": store.vector_rag.total_chunks(),
        "total_nodes": store.graph_rag.kg.number_of_nodes(),
        "total_edges": store.graph_rag.kg.number_of_edges(),
    }


@app.get("/api/indexing-status", response_model=IndexingProgress)
def get_indexing_status():
    return store.get_progress()


@app.get("/api/documents", response_model=List[DocumentInfo])
def get_documents():
    return store.documents


@app.get("/api/graph-data")
def get_graph_data():
    return store.graph_rag.to_dict()


@app.post("/api/reset")
def reset_workspace():
    store.reset()
    return {"message": "Knowledge base reset successfully."}


@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    max_graph_chunks: int = Form(8)
):
    """Upload one or more files (or folder drop) and index for VectorRAG & GraphRAG."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    temp_dir = tempfile.mkdtemp(prefix="notebooklm_upload_")
    file_records: list[tuple[str, str]] = []

    for file in files:
        filename = os.path.basename(file.filename or "uploaded_file")
        temp_file_path = os.path.join(temp_dir, filename)
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        file_records.append((temp_file_path, filename))

    # Reset existing store before new indexing session
    store.reset()

    # Trigger indexing in background executor
    await store.start_indexing_async(file_records, max_graph_chunks=max_graph_chunks)

    return {
        "message": f"Uploaded {len(file_records)} file(s). Indexing started.",
        "files": [r[1] for r in file_records]
    }


@app.post("/api/index-sample")
async def index_sample_file(req: SampleIndexRequest, max_graph_chunks: int = 8):
    """Index an existing sample PDF from backend assets."""
    target_path = ASSETS_DIR / req.sample_name
    if not target_path.exists():
        # Try matching without exact extension
        candidates = list(ASSETS_DIR.glob(f"*{req.sample_name}*"))
        if candidates:
            target_path = candidates[0]
        else:
            raise HTTPException(status_code=404, detail=f"Sample file '{req.sample_name}' not found in assets.")

    store.reset()
    file_records = [(str(target_path), target_path.name)]
    await store.start_indexing_async(file_records, max_graph_chunks=max_graph_chunks)

    return {
        "message": f"Sample document '{target_path.name}' loaded. Indexing started.",
        "sample_name": target_path.name
    }


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """Server-Sent Events streaming endpoint executing the 8-step agentic RAG pipeline."""
    if not store.is_indexed() and store.vector_rag.total_chunks() == 0:
        # If not indexed, return error event
        async def unindexed_generator():
            yield '{"event": "error", "data": "No documents are currently indexed. Please upload a document first."}\n'
            yield '{"event": "done", "data": {}}\n'
        return StreamingResponse(unindexed_generator(), media_type="text/event-stream")

    return StreamingResponse(
        run_agentic_pipeline(
            user_query=request.message,
            vector_rag=store.vector_rag,
            graph_rag=store.graph_rag,
        ),
        media_type="text/event-stream"
    )