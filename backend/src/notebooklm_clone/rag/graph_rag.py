import json
import logging
from collections import defaultdict, Counter
import numpy as np
import torch
import networkx as nx
import faiss
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_ollama import ChatOllama

from notebooklm_clone.rag.types import (
    Chunk,
    ExtractorOutput,
    EntityItem,
    RelationshipItem,
)
from notebooklm_clone.rag.embeddings import create_faiss_index, embedding_fn, EMBEDDING_DIM

logger = logging.getLogger(__name__)


def _solve_pcst(edges, prizes, costs, root=-1, num_clusters=1, pruning="gw"):
    """Prize-Collecting Steiner Tree solver.
    Tries native pcst_fast first; falls back to GW primal-dual solver if unavailable or on error.
    """
    try:
        from pcst_fast import pcst_fast
        v, e = pcst_fast(edges, prizes, costs, root, num_clusters, pruning, 0)
        if len(v) <= 1 or len(set(v.tolist())) > 1:
            return v, e
    except Exception:
        pass

    num_nodes = len(prizes)
    num_edges = len(edges)
    if num_nodes == 0 or num_edges == 0:
        return np.array([], dtype=int), np.array([], dtype=int)

    prizes = np.array(prizes, dtype=float)
    costs = np.array(costs, dtype=float)

    parent = list(range(num_nodes))
    cluster_prize = list(prizes)
    cluster_moat = [0.0] * num_nodes
    active = [p > 0 for p in prizes]
    if 0 <= root < num_nodes:
        active[root] = False

    def find(i):
        path = []
        while parent[i] != i:
            path.append(i)
            i = parent[i]
        for node in path:
            parent[node] = i
        return i

    edge_rem = list(costs)
    tree_edges = []
    active_clusters = set(i for i in range(num_nodes) if active[i])

    while len(active_clusters) > (1 if root < 0 else 0):
        min_dt = float("inf")
        event = None

        for e_idx, (u, v) in enumerate(edges):
            cu, cv = find(u), find(v)
            if cu == cv:
                continue
            rate = (1 if cu in active_clusters else 0) + (1 if cv in active_clusters else 0)
            if rate > 0:
                dt = edge_rem[e_idx] / rate
                if dt < min_dt:
                    min_dt = dt
                    event = ("edge", e_idx, cu, cv)

        for c in active_clusters:
            dt = cluster_prize[c] - cluster_moat[c]
            if dt < min_dt:
                min_dt = dt
                event = ("deactivate", c)

        if min_dt == float("inf") or event is None:
            break

        for c in active_clusters:
            cluster_moat[c] += min_dt

        for e_idx, (u, v) in enumerate(edges):
            cu, cv = find(u), find(v)
            if cu != cv:
                rate = (1 if cu in active_clusters else 0) + (1 if cv in active_clusters else 0)
                edge_rem[e_idx] -= rate * min_dt
                if edge_rem[e_idx] < 1e-12:
                    edge_rem[e_idx] = 0.0

        if event[0] == "deactivate":
            c = event[1]
            active_clusters.remove(c)
        elif event[0] == "edge":
            e_idx, cu, cv = event[1], event[2], event[3]
            cu, cv = find(cu), find(cv)
            if cu != cv:
                tree_edges.append(e_idx)
                parent[cv] = cu
                cluster_prize[cu] += cluster_prize[cv]
                cluster_moat[cu] += cluster_moat[cv]
                was_active = (cu in active_clusters) or (cv in active_clusters)
                if cu in active_clusters:
                    active_clusters.remove(cu)
                if cv in active_clusters:
                    active_clusters.remove(cv)
                if was_active and cluster_moat[cu] < cluster_prize[cu]:
                    active_clusters.add(cu)

    selected_edges = set(tree_edges)
    changed = True
    while changed:
        changed = False
        degree = {}
        for e in selected_edges:
            u, v = edges[e]
            degree[u] = degree.get(u, 0) + 1
            degree[v] = degree.get(v, 0) + 1
        for u, deg in list(degree.items()):
            if deg == 1 and prizes[u] <= 0:
                for e in list(selected_edges):
                    if edges[e][0] == u or edges[e][1] == u:
                        selected_edges.remove(e)
                        changed = True
                        break

    selected_nodes = set()
    for e in selected_edges:
        selected_nodes.add(edges[e][0])
        selected_nodes.add(edges[e][1])
    if not selected_nodes and len(prizes) > 0:
        best_node = int(np.argmax(prizes))
        if prizes[best_node] > 0:
            selected_nodes.add(best_node)

    return np.array(sorted(selected_nodes), dtype=int), np.array(sorted(selected_edges), dtype=int)


def extract_entities_relationships(chunks: list[Chunk], llm: ChatOllama, max_chunks: int = 15, progress_callback=None) -> list[ExtractorOutput]:
    """Extract entities, relationships, and descriptions from chunks using structured output LLM."""
    sys_prompt = """You are an information extraction system. Your task is to extract key entities and their relationships according to the schema:
1. Entity Types: PERSON, ORGANIZATION, LOCATION, OBJECT, EVENT, CONCEPT
2. Relationship Types: WORKS_AT, PART_OF, LOCATED_IN, DEPENDS_ON, CREATED_BY, OWNS, BOUGHT, FOLLOWS, RELATED_TO
3. Return valid JSON only with 'entities' and 'relationships' arrays.
Every entity must have 'name', 'type', and a concise 'description'.
Every relationship must have 'source', 'type', 'target', and a concise 'description'.
"""
    structured_llm = llm.with_structured_output(ExtractorOutput)

    results: list[ExtractorOutput] = []
    valid_chunks = [c for c in chunks if len(c.content.strip()) >= 60]
    total = min(len(valid_chunks), max_chunks)

    for i in range(total):
        chunk = valid_chunks[i]
        if progress_callback:
            progress_callback(i + 1, total, f"Extracting entities & relations (chunk {i + 1}/{total})...")
        try:
            messages = [
                SystemMessage(sys_prompt),
                HumanMessage(f"Text to extract from:\n{chunk.content}")
            ]
            res = structured_llm.invoke(messages)
            if isinstance(res, ExtractorOutput):
                results.append(res)
            elif isinstance(res, dict):
                results.append(ExtractorOutput(**res))
        except Exception as e:
            logger.warning(f"Failed extraction on chunk {i}: {e}")
            continue

    return results


def entity_resolution(ent_rel_collection: list[ExtractorOutput], similarity_threshold: float = 0.82) -> ExtractorOutput:
    """Resolve and deduplicate entities across chunks using blocking, KMeans sub-clustering, and Union-Find."""
    if not ent_rel_collection:
        return ExtractorOutput(entities=[], relationships=[])

    node_records = []
    chunk_local_to_key = {}
    chunk_name_to_key = {}

    for chunk_idx, item in enumerate(ent_rel_collection):
        entities = item.entities
        chunk_local_to_key[chunk_idx] = {}
        chunk_name_to_key[chunk_idx] = {}

        for ent_idx, ent in enumerate(entities):
            ent_dict = ent if isinstance(ent, dict) else ent.model_dump()
            local_id = str(ent_dict.get('id', f'E{ent_idx + 1}')).strip() or f'E{ent_idx + 1}'
            name = str(ent_dict.get('name', '')).strip()
            ent_type = str(ent_dict.get('type', 'CONCEPT')).strip().upper() or 'CONCEPT'

            if not name:
                continue

            node_key = f"c{chunk_idx}_{local_id}"
            node_records.append({
                'key': node_key,
                'chunk_idx': chunk_idx,
                'local_id': local_id,
                'name': name,
                'type': ent_type,
                'raw': ent_dict
            })
            chunk_local_to_key[chunk_idx][local_id] = node_key
            chunk_name_to_key[chunk_idx][name.lower()] = node_key

    if not node_records:
        return ExtractorOutput(entities=[], relationships=[])

    key_to_record = {r['key']: r for r in node_records}
    all_keys = [r['key'] for r in node_records]

    # Precompute embeddings for all entity mentions
    texts = [f"Entity: {r['name']}. Type: {r['type']}" for r in node_records]
    embeddings = embedding_fn(texts)
    key_to_embedding = {r['key']: emb for r, emb in zip(node_records, embeddings)}

    # Blocking by entity type
    type_blocks = defaultdict(list)
    for r in node_records:
        type_blocks[r['type']].append(r['key'])

    candidate_blocks = []
    min_cluster_size_kmeans = 15

    for etype, keys in type_blocks.items():
        if len(keys) <= 1:
            candidate_blocks.append(keys)
            continue

        if len(keys) >= min_cluster_size_kmeans and key_to_embedding:
            k = max(2, min(len(keys) // 5, 8))
            sub_embs = np.array([key_to_embedding[k_id] for k_id in keys])
            try:
                kmeans = KMeans(n_clusters=k, random_state=42, n_init='auto')
                labels = kmeans.fit_predict(sub_embs)
                sub_clusters = defaultdict(list)
                for k_id, label in zip(keys, labels):
                    sub_clusters[label].append(k_id)
                candidate_blocks.extend(sub_clusters.values())
            except Exception:
                candidate_blocks.append(keys)
        else:
            candidate_blocks.append(keys)

    # Disjoint Set Union (Union-Find)
    parent = {k: k for k in all_keys}

    def find_set(v):
        if parent[v] != v:
            parent[v] = find_set(parent[v])
        return parent[v]

    def unite_sets(a, b):
        ra, rb = find_set(a), find_set(b)
        if ra != rb:
            parent[rb] = ra

    # 1. Exact normalized name matching across chunks
    name_to_keys = defaultdict(list)
    for r in node_records:
        norm_name = r['name'].lower().strip()
        name_to_keys[norm_name].append(r['key'])

    for same_name_keys in name_to_keys.values():
        if len(same_name_keys) > 1:
            for k_other in same_name_keys[1:]:
                unite_sets(same_name_keys[0], k_other)

    # 2. Pairwise cosine similarity inside candidate blocks
    for block in candidate_blocks:
        if len(block) < 2:
            continue
        for i in range(len(block)):
            key1 = block[i]
            for j in range(i + 1, len(block)):
                key2 = block[j]
                if find_set(key1) == find_set(key2):
                    continue
                if key1 in key_to_embedding and key2 in key_to_embedding:
                    sim = float(np.dot(key_to_embedding[key1], key_to_embedding[key2]))
                    if sim >= similarity_threshold:
                        unite_sets(key1, key2)

    cluster_groups = defaultdict(list)
    for k in all_keys:
        root = find_set(k)
        cluster_groups[root].append(key_to_record[k])

    canonical_entities: list[EntityItem] = []
    key_to_canonical_id = {}

    for new_idx, (root, members) in enumerate(cluster_groups.items(), start=1):
        canonical_id = f"E{new_idx}"

        name_counts = Counter(m['name'] for m in members)
        sorted_names = sorted(name_counts.keys(), key=lambda x: (name_counts[x], len(x)), reverse=True)
        canonical_name = sorted_names[0]

        desc_counts = Counter(m["raw"].get("description", "") for m in members if m["raw"].get("description"))
        if desc_counts:
            sorted_desc = sorted(desc_counts.keys(), key=lambda x: (desc_counts[x], len(x)), reverse=True)
            canonical_desc = sorted_desc[0]
        else:
            canonical_desc = ""

        type_counts = Counter(m['type'] for m in members)
        canonical_type = type_counts.most_common(1)[0][0]

        for m in members:
            key_to_canonical_id[m['key']] = canonical_id

        canonical_entities.append(EntityItem(
            id=canonical_id,
            name=canonical_name,
            type=canonical_type,
            description=canonical_desc
        ))

    # Relink and merge relationships
    rel_map = {}

    for chunk_idx, item in enumerate(ent_rel_collection):
        relationships = item.relationships
        for rel in relationships:
            rel_dict = rel if isinstance(rel, dict) else rel.model_dump()
            src_raw = str(rel_dict.get('source', '')).strip()
            rel_type = str(rel_dict.get('type', 'RELATED_TO')).strip().upper() or 'RELATED_TO'
            tgt_raw = str(rel_dict.get('target', '')).strip()
            evidence = str(rel_dict.get('description', '')).strip()

            src_key = chunk_local_to_key.get(chunk_idx, {}).get(src_raw) or chunk_name_to_key.get(chunk_idx, {}).get(src_raw.lower())
            tgt_key = chunk_local_to_key.get(chunk_idx, {}).get(tgt_raw) or chunk_name_to_key.get(chunk_idx, {}).get(tgt_raw.lower())

            if not src_key or not tgt_key:
                continue

            src_canonical = key_to_canonical_id.get(src_key)
            tgt_canonical = key_to_canonical_id.get(tgt_key)

            if not src_canonical or not tgt_canonical or src_canonical == tgt_canonical:
                continue

            edge_key = (src_canonical, rel_type, tgt_canonical)
            if edge_key not in rel_map:
                rel_map[edge_key] = {
                    'source': src_canonical,
                    'type': rel_type,
                    'target': tgt_canonical,
                    'description': set([evidence]) if evidence else set(),
                    'weight': 1
                }
            else:
                if evidence:
                    rel_map[edge_key]['description'].add(evidence)
                rel_map[edge_key]['weight'] += 1

    canonical_relationships: list[RelationshipItem] = []
    for edge in rel_map.values():
        ev_list = sorted(list(edge['description']))
        canonical_relationships.append(RelationshipItem(
            source=edge['source'],
            type=edge['type'],
            target=edge['target'],
            description=' ; '.join(ev_list) if ev_list else '',
            weight=edge['weight']
        ))

    return ExtractorOutput(
        entities=canonical_entities,
        relationships=canonical_relationships
    )


def build_kg(ent_rel: ExtractorOutput) -> nx.DiGraph:
    """Build NetworkX directed graph from canonical entities and relationships."""
    G = nx.DiGraph()
    for ent in ent_rel.entities:
        G.add_node(ent.id, name=ent.name, type=ent.type, description=ent.description)
    for idx, rel in enumerate(ent_rel.relationships):
        G.add_edge(rel.source, rel.target, type=rel.type, description=rel.description, weight=rel.weight, edge_idx=idx)
    return G


def subgraph_construction(
    graph: nx.DiGraph,
    query: str,
    index_nodes: faiss.IndexFlatIP,
    index_edges: faiss.IndexFlatIP,
    topk: int = 5,
    topk_e: int = 5,
    cost_e: float = 0.5
) -> nx.DiGraph:
    """Retrieve optimal subgraph via Prize-Collecting Steiner Tree (PCST) based on G-Retriever."""
    if graph.number_of_nodes() == 0 or graph.number_of_edges() == 0:
        return graph.copy()

    emb_q = embedding_fn([query])
    if emb_q.ndim == 1:
        emb_q = emb_q.reshape(1, -1)

    node_vectors = index_nodes.reconstruct_n(0, index_nodes.ntotal)
    edge_vectors = index_edges.reconstruct_n(0, index_edges.ntotal)

    c = 0.01
    root = -1
    num_clusters = 1
    pruning = "gw"

    # 1. Node prizes (cosine similarity with query)
    if topk > 0 and index_nodes.ntotal > 0:
        sim_nodes = cosine_similarity(emb_q, node_vectors)[0]
        actual_topk = min(topk, index_nodes.ntotal)
        _, topk_n_indices = torch.topk(torch.from_numpy(sim_nodes), actual_topk, largest=True)
        n_prizes = np.zeros_like(sim_nodes)
        n_prizes[topk_n_indices.numpy()] = np.arange(actual_topk, 0, -1).astype(float)
    else:
        n_prizes = np.zeros(index_nodes.ntotal)

    # 2. Edge prizes
    if topk_e > 0 and index_edges.ntotal > 0:
        sim_edges = cosine_similarity(emb_q, edge_vectors)[0]
        unique_sims = np.unique(sim_edges)
        actual_topk_e = min(topk_e, len(unique_sims))
        topk_e_values, _ = torch.topk(torch.from_numpy(unique_sims), actual_topk_e, largest=True)
        topk_e_values = topk_e_values.numpy()

        e_prizes = sim_edges.copy()
        e_prizes[e_prizes < topk_e_values[-1]] = 0.0
        last_topk_e_value = float(actual_topk_e)

        for k in range(actual_topk_e):
            indices = (e_prizes == topk_e_values[k])
            cnt = np.sum(indices)
            if cnt > 0:
                value = min((actual_topk_e - k) / cnt, last_topk_e_value)
                e_prizes[indices] = value
                last_topk_e_value = value * (1 - c)

        cost_e = min(cost_e, float(e_prizes.max() * (1 - c / 2)))
    else:
        e_prizes = np.zeros(index_edges.ntotal)

    # 3. Virtual nodes & edges for PCST formulation
    node_list = list(graph.nodes())
    num_nodes = len(node_list)
    node_to_idx = {n: i for i, n in enumerate(node_list)}
    idx_to_node = {i: n for i, n in enumerate(node_list)}

    costs, edges = [], []
    virtual_n_prizes, virtual_edges, virtual_costs = [], [], []
    mapping_n, mapping_e = {}, {}

    for i, (src, dst, data) in enumerate(graph.edges(data=True)):
        if src not in node_to_idx or dst not in node_to_idx:
            continue
        src_idx = node_to_idx[src]
        dst_idx = node_to_idx[dst]
        edge_orig_idx = data.get("edge_idx", i)
        prize_e = float(e_prizes[edge_orig_idx]) if edge_orig_idx < len(e_prizes) else 0.0

        if prize_e <= cost_e:
            mapping_e[len(edges)] = (src, dst)
            edges.append((src_idx, dst_idx))
            costs.append(cost_e - prize_e)
        else:
            virtual_node_id = num_nodes + len(virtual_n_prizes)
            mapping_n[virtual_node_id] = (src, dst)
            virtual_edges.append((src_idx, virtual_node_id))
            virtual_edges.append((virtual_node_id, dst_idx))
            virtual_costs.append(0.0)
            virtual_costs.append(0.0)
            virtual_n_prizes.append(prize_e - cost_e)

    prizes = np.concatenate([n_prizes, np.array(virtual_n_prizes, dtype=np.float64)])
    num_edges_real = len(edges)
    if len(virtual_costs) > 0:
        all_costs = np.array(costs + virtual_costs, dtype=np.float64)
        all_edges = np.array(edges + virtual_edges, dtype=np.int64)
    else:
        all_costs = np.array(costs, dtype=np.float64)
        all_edges = np.array(edges, dtype=np.int64) if len(edges) > 0 else np.empty((0, 2), dtype=np.int64)

    # 4. Run PCST solver
    vertices, sel_edges = _solve_pcst(all_edges, prizes, all_costs, root, num_clusters, pruning)

    # 5. Extract selected nodes and edges
    selected_nodes = [idx_to_node[v] for v in vertices if v < num_nodes]
    selected_edges = [mapping_e[e] for e in sel_edges if e < num_edges_real]

    virtual_vertices = [v for v in vertices if v >= num_nodes]
    if len(virtual_vertices) > 0:
        virtual_edges_mapped = [mapping_n[v] for v in virtual_vertices if v in mapping_n]
        selected_edges.extend(virtual_edges_mapped)

    for src, dst in selected_edges:
        selected_nodes.append(src)
        selected_nodes.append(dst)

    selected_nodes = list(dict.fromkeys(selected_nodes))

    subgraph = graph.subgraph(selected_nodes).copy()
    selected_edge_set = set(selected_edges)
    edges_to_remove = [
        (u, v) for u, v in subgraph.edges()
        if (u, v) not in selected_edge_set and (v, u) not in selected_edge_set
    ]
    subgraph.remove_edges_from(edges_to_remove)
    return subgraph


def subgraph_to_text(subgraph: nx.DiGraph) -> str:
    """Format a retrieved subgraph as structured text for LLM knowledge context."""
    if subgraph.number_of_nodes() == 0:
        return "No relevant graph entities or relationships found."

    lines = ["=== Relevant Knowledge Graph Entities ==="]
    for node_id in subgraph.nodes():
        data = subgraph.nodes[node_id]
        name = data.get("name", node_id)
        etype = data.get("type", "UNKNOWN")
        desc = data.get("description", "")
        lines.append(f"- Entity: {name} (Type: {etype})")
        if desc:
            lines.append(f"  Description: {desc}")

    lines.append("\n=== Relevant Relationships ===")
    for src, dst, data in subgraph.edges(data=True):
        src_name = subgraph.nodes[src].get("name", src) if src in subgraph.nodes else src
        dst_name = subgraph.nodes[dst].get("name", dst) if dst in subgraph.nodes else dst
        rel_type = data.get("type", "RELATED_TO")
        description = data.get("description", "")
        lines.append(f"- {src_name} --[{rel_type}]--> {dst_name}")
        if description:
            lines.append(f"  Evidence: {description}")

    return "\n".join(lines)


class GraphRAG:
    """Graph-based Retrieval-Augmented Generation module utilizing G-Retriever PCST."""

    def __init__(self, dimension: int = EMBEDDING_DIM):
        self.dimension = dimension
        self.kg: nx.DiGraph = nx.DiGraph()
        self.er: ExtractorOutput = ExtractorOutput(entities=[], relationships=[])
        self.index_nodes: faiss.IndexFlatIP = create_faiss_index(dimension)
        self.index_edges: faiss.IndexFlatIP = create_faiss_index(dimension)

    def build(self, chunks: list[Chunk], llm: ChatOllama, max_chunks: int = 15, progress_callback=None):
        """Build the full GraphRAG knowledge graph and vector indexes."""
        if not chunks:
            return

        # 1. Information extraction
        raw_extractions = extract_entities_relationships(
            chunks, llm, max_chunks=max_chunks, progress_callback=progress_callback
        )

        if progress_callback:
            progress_callback(max_chunks, max_chunks, "Resolving entity mentions & merging relationships...")

        # 2. Entity resolution
        self.er = entity_resolution(raw_extractions)

        # 3. Knowledge Graph construction
        self.kg = build_kg(self.er)

        # 4. Embed nodes & edges
        if self.er.entities:
            node_texts = [f"name: {i.name}, type: {i.type}, description: {i.description}" for i in self.er.entities]
            emb_nodes = embedding_fn(node_texts)
            self.index_nodes.add(emb_nodes)

        if self.er.relationships:
            edge_texts = [f"type: {i.type}, weight: {i.weight}, description: {i.description}" for i in self.er.relationships]
            emb_edges = embedding_fn(edge_texts)
            self.index_edges.add(emb_edges)

    def search(self, query: str, topk: int = 8, topk_e: int = 8, cost_e: float = 0.5) -> tuple[nx.DiGraph, str]:
        """Search and extract subgraph for query. Returns (subgraph, textual_context)."""
        subgraph = subgraph_construction(
            graph=self.kg,
            query=query,
            index_nodes=self.index_nodes,
            index_edges=self.index_edges,
            topk=topk,
            topk_e=topk_e,
            cost_e=cost_e
        )
        context_text = subgraph_to_text(subgraph)
        return subgraph, context_text

    def to_dict(self) -> dict:
        """Export full graph for frontend visualization."""
        nodes = []
        for n, d in self.kg.nodes(data=True):
            nodes.append({
                "id": str(n),
                "name": d.get("name", str(n)),
                "type": d.get("type", "CONCEPT"),
                "description": d.get("description", "")
            })

        links = []
        for u, v, d in self.kg.edges(data=True):
            links.append({
                "source": str(u),
                "target": str(v),
                "type": d.get("type", "RELATED_TO"),
                "description": d.get("description", ""),
                "weight": d.get("weight", 1)
            })

        return {"nodes": nodes, "links": links}

    def clear(self):
        self.kg = nx.DiGraph()
        self.er = ExtractorOutput(entities=[], relationships=[])
        self.index_nodes = create_faiss_index(self.dimension)
        self.index_edges = create_faiss_index(self.dimension)
