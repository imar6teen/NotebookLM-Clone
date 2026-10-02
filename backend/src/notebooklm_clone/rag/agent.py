import json
import logging
from typing import AsyncGenerator
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langchain_ollama import ChatOllama

from notebooklm_clone.rag.types import (
    AgentToolDecision,
    QueryEnhancerOutput,
    RelevanceEvaluationOutput,
    Chunk,
)
from notebooklm_clone.rag.vector_rag import VectorRAG
from notebooklm_clone.rag.graph_rag import GraphRAG, subgraph_to_text

logger = logging.getLogger(__name__)


def get_llm(temperature: float = 0.1) -> ChatOllama:
    return ChatOllama(model="gemma4:latest", temperature=temperature, num_ctx=4096)


def decide_tool_call(query: str, llm: ChatOllama) -> AgentToolDecision:
    """Step 4: Pass user query to LLM to determine whether to call query_knowledge_base or answer directly."""
    sys_prompt = """You are an intelligent document research assistant.
Decide whether the user's question requires searching the indexed documents or if it is a general greeting/conversation.
- If the question asks about concepts, facts, data, research, summaries, or content from the documents: tool_name MUST be 'query_knowledge_base'.
- If the user says 'hello', 'hi', 'thank you', or asks casual chit-chat: tool_name can be 'none'.

Respond with JSON:
{
  "tool_name": "query_knowledge_base" or "none",
  "query": "the search query",
  "reason": "short explanation"
}
"""
    try:
        st_llm = llm.with_structured_output(AgentToolDecision)
        decision = st_llm.invoke([
            SystemMessage(sys_prompt),
            HumanMessage(query)
        ])
        if isinstance(decision, AgentToolDecision):
            return decision
        elif isinstance(decision, dict):
            return AgentToolDecision(**decision)
    except Exception as e:
        logger.warning(f"Tool decision structured output failed: {e}. Defaulting to query_knowledge_base.")

    # Fallback default: search knowledge base
    return AgentToolDecision(
        tool_name="query_knowledge_base",
        query=query,
        reason="Defaulted to querying knowledge base for comprehensive coverage."
    )


def enhance_query(query: str, llm: ChatOllama, attempt: int = 1, previous_query: str = "") -> str:
    """Step 5 & 6: Enhance user query into an optimized search query.
    If attempt > 1, applies distinct alternate expansion strategy.
    """
    if attempt == 1:
        sys_msg = """You are an advanced query-expansion and query-rewriting engine for a RAG system.
Your job is to take a raw user query and transform it into an optimized search query.
Rules:
1. Identify the core intent, entities, and implicit context of the question.
2. Add relevant synonyms, domain-specific terminology, and clarifying keywords.
3. Output ONLY the enhanced query in the JSON schema with field 'query'.
"""
    else:
        sys_msg = f"""You are an advanced query reformulation engine for a RAG system.
The previous search query '{previous_query}' yielded insufficient or low-relevance results.
Your goal is to reformulate the query with a DIFFERENT strategy:
1. Broaden the concepts, use alternative synonyms, high-level terminology, or decompose complex phrases into simpler key concepts.
2. Think about what background topics or related terminology would appear in the source documents.
3. Output ONLY the reformed search query in the JSON schema with field 'query'.
"""
    try:
        qe_llm = llm.with_structured_output(QueryEnhancerOutput)
        res = qe_llm.invoke([
            SystemMessage(sys_msg),
            HumanMessage(query)
        ])
        if isinstance(res, QueryEnhancerOutput) and res.query.strip():
            return res.query.strip()
        elif isinstance(res, dict) and res.get("query"):
            return res["query"].strip()
    except Exception as e:
        logger.warning(f"Query enhancement failed: {e}")

    return query


def evaluate_relevance(query: str, context_text: str, llm: ChatOllama) -> tuple[bool, str]:
    """Step 6: Evaluate if the retrieved context is useful for answering the query."""
    if not context_text or context_text.strip() == "No relevant graph entities or relationships found." or len(context_text.strip()) < 15:
        return False, "Empty or minimal context retrieved."

    prompt = f"""Evaluate strictly whether the provided context contains useful or relevant information to answer the question.
Question: {query}

Context:
{context_text[:2000]}

Reply in this exact format:
DECISION: [USEFUL or NOT_USEFUL]
REASON: [One concise sentence explaining why]
"""
    try:
        res = llm.invoke(prompt)
        text = res.content if hasattr(res, "content") else str(res)
        is_useful = "USEFUL" in text.upper() and "NOT_USEFUL" not in text.upper()
        reason = text.strip()
        return is_useful, reason
    except Exception as e:
        logger.warning(f"Relevance evaluation failed: {e}")
        # If evaluation fails, consider useful if text is reasonably long
        return len(context_text.strip()) > 30, "Fallback relevance evaluation."


async def run_agentic_pipeline(
    user_query: str,
    vector_rag: VectorRAG,
    graph_rag: GraphRAG,
) -> AsyncGenerator[str, None]:
    """Executes the 8-step pipeline with sequential local model inference to prevent OOM."""
    llm = get_llm(temperature=0.1)

    # ─────────────────────────────────────────────────────────────
    # Step 3 & 4: Pass to LLM first and let LLM call required tool
    # ─────────────────────────────────────────────────────────────
    yield json.dumps({
        "event": "step",
        "data": {
            "step": 4,
            "title": "Intent Analysis & Tool Decision",
            "detail": "Analyzing user query and determining tool invocation..."
        }
    }) + "\n"

    decision = decide_tool_call(user_query, llm)
    yield json.dumps({
        "event": "tool_decision",
        "data": {
            "tool_name": decision.tool_name,
            "query": decision.query,
            "reason": decision.reason
        }
    }) + "\n"

    # If casual conversation / no retrieval needed:
    if decision.tool_name != "query_knowledge_base" and vector_rag.total_chunks() == 0:
        yield json.dumps({
            "event": "step",
            "data": {
                "step": 7,
                "title": "Direct Conversational Response",
                "detail": "Responding directly without document retrieval."
            }
        }) + "\n"

        # Stream direct response
        yield json.dumps({"event": "vector_start", "data": {}}) + "\n"
        full_text = ""
        for chunk in llm.stream([HumanMessage(user_query)]):
            tok = chunk.content if hasattr(chunk, "content") else str(chunk)
            full_text += tok
            yield json.dumps({"event": "vector_token", "data": tok}) + "\n"
        yield json.dumps({"event": "vector_done", "data": {"text": full_text}}) + "\n"

        yield json.dumps({"event": "graph_start", "data": {}}) + "\n"
        yield json.dumps({"event": "graph_token", "data": full_text}) + "\n"
        yield json.dumps({"event": "graph_done", "data": {"text": full_text}}) + "\n"

        yield json.dumps({"event": "step", "data": {"step": 8, "title": "Completed", "detail": "Turn ended."}}) + "\n"
        yield json.dumps({"event": "done", "data": {}}) + "\n"
        return

    # ─────────────────────────────────────────────────────────────
    # Step 5: Enhance user query and retrieve from vectorRAG & graphRAG
    # ─────────────────────────────────────────────────────────────
    yield json.dumps({
        "event": "step",
        "data": {
            "step": 5,
            "title": "Query Enhancement & Dual Retrieval",
            "detail": "Generating enhanced search query and retrieving from VectorRAG & GraphRAG..."
        }
    }) + "\n"

    enhanced_query_1 = enhance_query(user_query, llm, attempt=1)
    yield json.dumps({
        "event": "query_enhanced",
        "data": {
            "attempt": 1,
            "original_query": user_query,
            "enhanced_query": enhanced_query_1
        }
    }) + "\n"

    # Retrieve Initial Candidates
    vector_results_1 = vector_rag.search(enhanced_query_1, top_k=5)
    vector_context_1 = "\n\n".join([f"[{c.metadata.doc_name} - Chunk {c.metadata.order}]:\n{c.content}" for c, _ in vector_results_1])

    subgraph_1, graph_context_1 = graph_rag.search(enhanced_query_1, topk=8, topk_e=8)

    # ─────────────────────────────────────────────────────────────
    # Step 6: Relevance Check & Retry if not useful
    # ─────────────────────────────────────────────────────────────
    yield json.dumps({
        "event": "step",
        "data": {
            "step": 6,
            "title": "Context Relevance Evaluation",
            "detail": "Assessing if retrieved information is sufficient to answer..."
        }
    }) + "\n"

    v_useful_1, v_reason_1 = evaluate_relevance(user_query, vector_context_1, llm)
    g_useful_1, g_reason_1 = evaluate_relevance(user_query, graph_context_1, llm)

    yield json.dumps({
        "event": "evaluation_result",
        "data": {
            "attempt": 1,
            "vector_useful": v_useful_1,
            "vector_reason": v_reason_1,
            "graph_useful": g_useful_1,
            "graph_reason": g_reason_1
        }
    }) + "\n"

    # If context is not useful on either pipeline, trigger Step 6 retry
    final_vector_results = vector_results_1
    final_vector_context = vector_context_1
    final_v_useful = v_useful_1

    final_subgraph = subgraph_1
    final_graph_context = graph_context_1
    final_g_useful = g_useful_1

    if not v_useful_1 or not g_useful_1:
        yield json.dumps({
            "event": "retry_notice",
            "data": {
                "attempt": 2,
                "message": "Context insufficient. Formulating alternative enhanced query..."
            }
        }) + "\n"

        enhanced_query_2 = enhance_query(user_query, llm, attempt=2, previous_query=enhanced_query_1)
        yield json.dumps({
            "event": "query_enhanced",
            "data": {
                "attempt": 2,
                "original_query": user_query,
                "enhanced_query": enhanced_query_2
            }
        }) + "\n"

        if not v_useful_1:
            vector_results_2 = vector_rag.search(enhanced_query_2, top_k=5)
            vector_context_2 = "\n\n".join([f"[{c.metadata.doc_name} - Chunk {c.metadata.order}]:\n{c.content}" for c, _ in vector_results_2])
            v_useful_2, v_reason_2 = evaluate_relevance(user_query, vector_context_2, llm)
            final_vector_results = vector_results_2
            final_vector_context = vector_context_2
            final_v_useful = v_useful_2

        if not g_useful_1:
            subgraph_2, graph_context_2 = graph_rag.search(enhanced_query_2, topk=8, topk_e=8)
            g_useful_2, g_reason_2 = evaluate_relevance(user_query, graph_context_2, llm)
            final_subgraph = subgraph_2
            final_graph_context = graph_context_2
            final_g_useful = g_useful_2

        yield json.dumps({
            "event": "evaluation_result",
            "data": {
                "attempt": 2,
                "vector_useful": final_v_useful,
                "graph_useful": final_g_useful
            }
        }) + "\n"

    # Send retrieved contexts to client for inspection
    yield json.dumps({
        "event": "contexts_payload",
        "data": {
            "vector_chunks": [
                {
                    "id": c.id,
                    "content": c.content,
                    "score": round(score, 4),
                    "doc_name": c.metadata.doc_name,
                    "order": c.metadata.order
                }
                for c, score in final_vector_results
            ],
            "graph_nodes": [
                {
                    "id": str(n),
                    "name": final_subgraph.nodes[n].get("name", str(n)),
                    "type": final_subgraph.nodes[n].get("type", "CONCEPT"),
                    "description": final_subgraph.nodes[n].get("description", "")
                }
                for n in final_subgraph.nodes()
            ],
            "graph_edges": [
                {
                    "source": str(u),
                    "target": str(v),
                    "type": d.get("type", "RELATED_TO"),
                    "description": d.get("description", ""),
                    "weight": d.get("weight", 1)
                }
                for u, v, d in final_subgraph.edges(data=True)
            ]
        }
    }) + "\n"

    # ─────────────────────────────────────────────────────────────
    # Step 7 & NOTE: Sequential Answer Generation (VectorRAG then GraphRAG)
    # ─────────────────────────────────────────────────────────────
    yield json.dumps({
        "event": "step",
        "data": {
            "step": 7,
            "title": "Sequential Answer Generation",
            "detail": "Streaming VectorRAG answer first, then GraphRAG answer to prevent GPU OOM..."
        }
    }) + "\n"

    # ── Phase 1: VectorRAG Answer ──
    yield json.dumps({"event": "vector_start", "data": {}}) + "\n"
    if not final_v_useful:
        v_dont_know = "I don't know based on the provided documents. The information retrieved from VectorRAG was not sufficient to answer your question."
        yield json.dumps({"event": "vector_token", "data": v_dont_know}) + "\n"
        yield json.dumps({"event": "vector_done", "data": {"text": v_dont_know}}) + "\n"
    else:
        v_messages = [
            SystemMessage(
                "You are an expert document assistant. Answer the user question based strictly on the provided Knowledge chunks. "
                "If you cannot find the answer in the knowledge, say 'I don't know'. Be thorough, clear, and concise."
            ),
            SystemMessage(f"Knowledge Chunks:\n{final_vector_context}"),
            HumanMessage(user_query)
        ]
        full_v_text = ""
        try:
            for chunk in llm.stream(v_messages):
                tok = chunk.content if hasattr(chunk, "content") else str(chunk)
                full_v_text += tok
                yield json.dumps({"event": "vector_token", "data": tok}) + "\n"
        except Exception as e:
            full_v_text = f"Error generating VectorRAG response: {e}"
            yield json.dumps({"event": "vector_token", "data": full_v_text}) + "\n"
        yield json.dumps({"event": "vector_done", "data": {"text": full_v_text}}) + "\n"

    # ── Phase 2: GraphRAG Answer (Executed AFTER VectorRAG completely finishes) ──
    yield json.dumps({"event": "graph_start", "data": {}}) + "\n"
    if not final_g_useful:
        g_dont_know = "I don't know based on the provided documents. The knowledge graph relationships retrieved from GraphRAG did not contain sufficient evidence."
        yield json.dumps({"event": "graph_token", "data": g_dont_know}) + "\n"
        yield json.dumps({"event": "graph_done", "data": {"text": g_dont_know}}) + "\n"
    else:
        g_messages = [
            SystemMessage(
                "You are an expert document assistant. Answer the user question based strictly on the provided Knowledge Graph context (entities, relationships, and descriptions). "
                "Highlight the relationships between entities where helpful. If you cannot find the answer in the context, say 'I don't know'. Be concise."
            ),
            AIMessage(f"Context from Knowledge Graph:\n{final_graph_context}"),
            HumanMessage(user_query)
        ]
        full_g_text = ""
        try:
            for chunk in llm.stream(g_messages):
                tok = chunk.content if hasattr(chunk, "content") else str(chunk)
                full_g_text += tok
                yield json.dumps({"event": "graph_token", "data": tok}) + "\n"
        except Exception as e:
            full_g_text = f"Error generating GraphRAG response: {e}"
            yield json.dumps({"event": "graph_token", "data": full_g_text}) + "\n"
        yield json.dumps({"event": "graph_done", "data": {"text": full_g_text}}) + "\n"

    # ─────────────────────────────────────────────────────────────
    # Step 8: END
    # ─────────────────────────────────────────────────────────────
    yield json.dumps({
        "event": "step",
        "data": {
            "step": 8,
            "title": "Comparison Ready",
            "detail": "VectorRAG and GraphRAG answers generated."
        }
    }) + "\n"
    yield json.dumps({"event": "done", "data": {}}) + "\n"
