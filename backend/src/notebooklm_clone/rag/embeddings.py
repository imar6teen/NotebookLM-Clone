import faiss
import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from typing import Optional

_EMBEDDING_MODEL: Optional[SentenceTransformer] = None
EMBEDDING_DIM = 1024  # BAAI/bge-m3 dimension


def get_embedding_model() -> SentenceTransformer:
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _EMBEDDING_MODEL = SentenceTransformer("BAAI/bge-m3", device=device)
    return _EMBEDDING_MODEL


def embedding_fn(texts: list[str]) -> np.ndarray:
    """Embed texts into normalized 1024-d float32 vectors using BAAI/bge-m3."""
    if not texts:
        return np.empty((0, EMBEDDING_DIM), dtype=np.float32)
    model = get_embedding_model()
    # normalize_embeddings ensures dot product equals cosine similarity
    embs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    if isinstance(embs, list):
        embs = np.array(embs, dtype=np.float32)
    elif embs.dtype != np.float32:
        embs = embs.astype(np.float32)
    return embs


def create_faiss_index(dimension: int = EMBEDDING_DIM) -> faiss.IndexFlatIP:
    """Create a FAISS Inner Product index."""
    return faiss.IndexFlatIP(dimension)
