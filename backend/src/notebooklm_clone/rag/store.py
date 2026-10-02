import asyncio
import os
import uuid
import logging
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor

from notebooklm_clone.rag.types import DocumentInfo, IndexingProgress, Chunk
from notebooklm_clone.rag.vector_rag import VectorRAG
from notebooklm_clone.rag.graph_rag import GraphRAG
from notebooklm_clone.rag.extraction import extract_document, chunk_documents
from notebooklm_clone.rag.agent import get_llm

logger = logging.getLogger(__name__)


class KnowledgeStore:
    """Manages indexed documents, VectorRAG, GraphRAG, and indexing progress."""

    def __init__(self):
        self.documents: list[DocumentInfo] = []
        self.chunks: list[Chunk] = []
        self.vector_rag: VectorRAG = VectorRAG()
        self.graph_rag: GraphRAG = GraphRAG()
        self.progress: IndexingProgress = IndexingProgress()
        self._executor = ThreadPoolExecutor(max_workers=1)

    def get_progress(self) -> IndexingProgress:
        return self.progress

    def is_indexed(self) -> bool:
        return len(self.chunks) > 0 and self.vector_rag.total_chunks() > 0

    def reset(self):
        self.documents.clear()
        self.chunks.clear()
        self.vector_rag.clear()
        self.graph_rag.clear()
        self.progress = IndexingProgress()

    def index_files(self, file_paths: list[tuple[str, str]], max_graph_chunks: int = 8):
        """Runs the indexing pipeline synchronously in a worker thread.
        file_paths: list of (temp_file_path, original_file_name)
        """
        try:
            self.progress.is_indexing = True
            self.progress.progress_percent = 5
            self.progress.stage = "extraction"
            self.progress.message = f"Extracting {len(file_paths)} document(s)..."
            self.progress.error = None

            all_new_chunks: list[Chunk] = []

            for i, (fpath, fname) in enumerate(file_paths):
                doc_id = str(uuid.uuid4())[:8]
                doc_size = os.path.getsize(fpath) if os.path.exists(fpath) else 0

                raw_docs = extract_document(fpath, doc_name=fname)
                chunks = chunk_documents(raw_docs, doc_id=doc_id, doc_name=fname)
                all_new_chunks.extend(chunks)

                self.documents.append(DocumentInfo(
                    id=doc_id,
                    name=fname,
                    size=doc_size,
                    num_chunks=len(chunks),
                    status="indexed"
                ))

            self.chunks.extend(all_new_chunks)
            self.progress.chunk_count = len(self.chunks)
            self.progress.doc_count = len(self.documents)
            self.progress.progress_percent = 25
            self.progress.stage = "vector_indexing"
            self.progress.message = f"Generating vector embeddings for {len(all_new_chunks)} chunks..."

            # ── Vector Indexing ──
            self.vector_rag.add_chunks(all_new_chunks)

            self.progress.progress_percent = 40
            self.progress.stage = "graph_indexing"
            self.progress.message = "Extracting knowledge graph entities & relationships..."

            # ── Graph Indexing ──
            llm = get_llm(temperature=0.0)

            def graph_progress_cb(current: int, total: int, msg: str):
                pct = 40 + int((current / total) * 50)
                self.progress.progress_percent = min(pct, 92)
                self.progress.message = msg

            self.graph_rag.build(
                all_new_chunks,
                llm,
                max_chunks=max_graph_chunks,
                progress_callback=graph_progress_cb
            )

            self.progress.node_count = self.graph_rag.kg.number_of_nodes()
            self.progress.edge_count = self.graph_rag.kg.number_of_edges()
            self.progress.progress_percent = 100
            self.progress.stage = "complete"
            self.progress.message = (
                f"Indexing complete! {len(self.chunks)} chunks, "
                f"{self.progress.node_count} graph nodes, {self.progress.edge_count} relationships."
            )
            self.progress.is_indexing = False

        except Exception as e:
            logger.exception("Indexing failed")
            self.progress.is_indexing = False
            self.progress.error = str(e)
            self.progress.stage = "error"
            self.progress.message = f"Indexing failed: {e}"

    async def start_indexing_async(self, file_paths: list[tuple[str, str]], max_graph_chunks: int = 12):
        loop = asyncio.get_running_loop()
        return loop.run_in_executor(self._executor, self.index_files, file_paths, max_graph_chunks)


# Global singleton instance
store = KnowledgeStore()
