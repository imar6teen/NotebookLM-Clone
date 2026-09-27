from pydantic import BaseModel
from typing import Any


class ChunkMetadata(BaseModel):
    doc_size : int # byte
    doc_id : str

class Chunk(BaseModel):
    content : str
    metadata : ChunkMetadata