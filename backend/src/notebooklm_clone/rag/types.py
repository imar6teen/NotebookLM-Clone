from pydantic import BaseModel, Field
from typing import Any, Optional


class ChunkMetadata(BaseModel):
    doc_id: str
    doc_name: str
    order: int = 0
    doc_size: int = 0


class Chunk(BaseModel):
    id: str
    content: str
    metadata: ChunkMetadata


class EntityItem(BaseModel):
    id: str = Field(default="", description="Unique identifier for entity, e.g. E1")
    name: str = Field(description="Canonical or surface name of the entity")
    type: str = Field(default="CONCEPT", description="Entity type: PERSON, ORGANIZATION, LOCATION, OBJECT, EVENT, CONCEPT")
    description: str = Field(default="", description="Concise description of the entity based on text")


class RelationshipItem(BaseModel):
    source: str = Field(description="Name or ID of source entity")
    type: str = Field(default="RELATED_TO", description="Relationship type, e.g. WORKS_AT, PART_OF, LOCATED_IN, DEPENDS_ON, CREATED_BY, OWNS")
    target: str = Field(description="Name or ID of target entity")
    description: str = Field(default="", description="Concise description of the relationship context")
    weight: int = Field(default=1, description="Frequency/evidence weight")


class ExtractorOutput(BaseModel):
    entities: list[EntityItem] = Field(default_factory=list)
    relationships: list[RelationshipItem] = Field(default_factory=list)


class QueryEnhancerOutput(BaseModel):
    query: str = Field(default="", description="Enhanced, rewritten, or expanded search query")


class AgentToolDecision(BaseModel):
    tool_name: str = Field(description="Tool to invoke: 'query_knowledge_base' to search indexed documents, or 'none' for direct casual conversation.")
    query: str = Field(default="", description="Search query string if calling query_knowledge_base.")
    reason: str = Field(default="", description="Reason for calling the tool or answering directly.")


class RelevanceEvaluationOutput(BaseModel):
    is_useful: bool = Field(description="True if the retrieved context is useful to answer the user query, False otherwise.")
    reason: str = Field(default="", description="Reasoning for usefulness decision.")


class DocumentInfo(BaseModel):
    id: str
    name: str
    size: int
    num_chunks: int
    status: str = "indexed"


class IndexingProgress(BaseModel):
    is_indexing: bool = False
    progress_percent: int = 0
    stage: str = "idle"
    message: str = "Ready"
    doc_count: int = 0
    chunk_count: int = 0
    node_count: int = 0
    edge_count: int = 0
    error: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[dict[str, str]] = Field(default_factory=list)