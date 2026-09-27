import faiss
import numpy as np
from notebooklm_clone.rag.types import Chunk

class BaseRAG:
    def __init__(self, dimension):
        self.chunks : list[Chunk] = []
        self.index : faiss.IndexFlatIP = faiss.IndexFlatIP(dimension)
    
    # Maybe using DocLing
    def _extract(self):
        pass

    def _chunks(self, full_text : str, chunk_size : int, overlap_length : int):
        assert chunk_size > overlap_length, "Chunk size is smaller than overlap length"
        assert chunk_size - overlap_length > overlap_length, "Chunk size is not optimal"
    
    def _embedding(self, chunks : str):
        pass

    def _store(self, embeddings : np.ndarray, chunks : list[Chunk]):
        assert embeddings.shape[0] == len(chunks), "Embeddings and chunks have different size on axis = 0"

        self.index.add(embeddings)
        self.chunks.extend(chunks)
        pass

    # matching length between self.chunks and self.index
    def _is_length_match(self):
        return self.index.ntotal() == len(self.chunks)

class VectorRAG(BaseRAG):
    def __init__(self):
        pass

class GraphRAG(BaseRAG):
    pass