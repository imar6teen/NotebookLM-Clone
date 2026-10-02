import numpy as np
import faiss
from notebooklm_clone.rag.types import Chunk
from notebooklm_clone.rag.embeddings import create_faiss_index, embedding_fn, EMBEDDING_DIM


class VectorRAG:
    """Vector-based Retrieval-Augmented Generation module."""

    def __init__(self, dimension: int = EMBEDDING_DIM):
        self.dimension = dimension
        self.chunks: list[Chunk] = []
        self.index: faiss.IndexFlatIP = create_faiss_index(dimension)

    def add_chunks(self, chunks: list[Chunk]):
        if not chunks:
            return

        texts = [c.content for c in chunks]
        embeddings = embedding_fn(texts)

        # Store in FAISS
        self.index.add(embeddings)
        self.chunks.extend(chunks)

    def search(self, query: str, top_k: int = 5) -> list[tuple[Chunk, float]]:
        """Search nearest chunks for query. Returns tuples of (Chunk, similarity_score)."""
        if self.index.ntotal == 0 or not self.chunks:
            return []

        emb_q = embedding_fn([query])
        k = min(top_k, self.index.ntotal)
        distances, indices = self.index.search(emb_q, k)

        results: list[tuple[Chunk, float]] = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx >= 0 and idx < len(self.chunks):
                results.append((self.chunks[idx], float(dist)))
        return results

    def clear(self):
        self.chunks = []
        self.index = create_faiss_index(self.dimension)

    def total_chunks(self) -> int:
        return len(self.chunks)
