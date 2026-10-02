import { useState } from "react";
import Icon from "./Icon";

export interface VectorChunk {
  id: string;
  content: string;
  score: number;
  doc_name: string;
  order: number;
}

export interface GraphNodeData {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface GraphEdgeData {
  source: string;
  target: string;
  type: string;
  description: string;
  weight: number;
}

interface RAGComparisonCardProps {
  vectorText: string;
  graphText: string;
  isVectorStreaming: boolean;
  isGraphStreaming: boolean;
  vectorChunks?: VectorChunk[];
  graphNodes?: GraphNodeData[];
  graphEdges?: GraphEdgeData[];
}

export default function RAGComparisonCard({
  vectorText,
  graphText,
  isVectorStreaming,
  isGraphStreaming,
  vectorChunks = [],
  graphNodes = [],
  graphEdges = [],
}: RAGComparisonCardProps) {
  const [activeTab, setActiveTab] = useState<"both" | "vector" | "graph">("both");
  const [showVectorContext, setShowVectorContext] = useState(false);
  const [showGraphContext, setShowGraphContext] = useState(false);

  return (
    <div className="w-full flex flex-col gap-3 font-body">
      {/* View Toggle Bar */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-surface-container-low border border-outline-variant/30">
          <button
            type="button"
            onClick={() => setActiveTab("both")}
            className={`px-3 py-1 rounded-md text-xs font-label font-medium transition-all ${
              activeTab === "both"
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Side-by-Side View
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("vector")}
            className={`px-3 py-1 rounded-md text-xs font-label font-medium transition-all ${
              activeTab === "vector"
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            VectorRAG Only
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("graph")}
            className={`px-3 py-1 rounded-md text-xs font-label font-medium transition-all ${
              activeTab === "graph"
                ? "bg-tertiary text-on-tertiary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            GraphRAG Only
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[11px] text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-primary" /> Vector RAG
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-tertiary" /> Graph RAG (G-Retriever)
          </span>
        </div>
      </div>

      {/* Comparison Grid */}
      <div
        className={`grid gap-4 w-full ${
          activeTab === "both" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {/* ── VectorRAG Card ── */}
        {(activeTab === "both" || activeTab === "vector") && (
          <div className="flex flex-col rounded-2xl border border-primary/20 bg-surface-container/60 backdrop-blur-xl shadow-lg overflow-hidden transition-all duration-300">
            {/* Header */}
            <div className="px-4 py-3 border-b border-primary/15 bg-primary/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/20 text-primary flex items-center justify-center font-bold">
                  <Icon name="storage" size={17} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-headline font-semibold text-on-surface">
                      Vector RAG
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/15 text-primary border border-primary/30">
                      FAISS IP • bge-m3
                    </span>
                  </div>
                  <span className="text-[10px] text-on-surface-variant">
                    Dense passage semantic matching
                  </span>
                </div>
              </div>

              {isVectorStreaming && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-primary animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Streaming...
                </div>
              )}
            </div>

            {/* Answer Content */}
            <div className="p-4 sm:p-5 flex-1 min-h-[120px] text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-normal selection:bg-primary/30 selection:text-on-surface">
              {vectorText || (
                <div className="text-on-surface-variant/70 italic text-xs flex items-center gap-2">
                  <Icon name="hourglass_top" size={15} />
                  Waiting for response generation...
                </div>
              )}
              {isVectorStreaming && (
                <span className="inline-block w-1.5 h-4 ml-1 bg-primary align-middle animate-pulse" />
              )}
            </div>

            {/* Context Inspector */}
            {vectorChunks.length > 0 && (
              <div className="border-t border-outline-variant/20 bg-surface-container-lowest/60">
                <button
                  type="button"
                  onClick={() => setShowVectorContext(!showVectorContext)}
                  className="w-full px-4 py-2 flex items-center justify-between text-xs text-secondary hover:text-primary transition-colors text-left"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon name="source" size={15} />
                    Retrieved Chunks ({vectorChunks.length})
                  </span>
                  <Icon
                    name={showVectorContext ? "expand_less" : "expand_more"}
                    size={16}
                  />
                </button>

                {showVectorContext && (
                  <div className="px-4 pb-3 space-y-2 max-h-56 overflow-y-auto">
                    {vectorChunks.map((chunk, i) => (
                      <div
                        key={chunk.id || i}
                        className="p-2.5 rounded-lg bg-surface-container-high/60 border border-outline-variant/30 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-secondary mb-1">
                          <span>{chunk.doc_name} • Chunk #{chunk.order}</span>
                          <span className="text-primary font-semibold">
                            Similarity: {chunk.score}
                          </span>
                        </div>
                        <p className="text-on-surface-variant line-clamp-3 hover:line-clamp-none transition-all duration-200">
                          {chunk.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── GraphRAG Card ── */}
        {(activeTab === "both" || activeTab === "graph") && (
          <div className="flex flex-col rounded-2xl border border-tertiary/20 bg-surface-container/60 backdrop-blur-xl shadow-lg overflow-hidden transition-all duration-300">
            {/* Header */}
            <div className="px-4 py-3 border-b border-tertiary/15 bg-tertiary/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-tertiary/20 text-tertiary flex items-center justify-center font-bold">
                  <Icon name="hub" size={17} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-headline font-semibold text-on-surface">
                      Graph RAG
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-tertiary/15 text-tertiary border border-tertiary/30">
                      G-Retriever PCST Subgraph
                    </span>
                  </div>
                  <span className="text-[10px] text-on-surface-variant">
                    Entity-relationship structured reasoning
                  </span>
                </div>
              </div>

              {isGraphStreaming && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-tertiary animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                  Streaming...
                </div>
              )}
            </div>

            {/* Answer Content */}
            <div className="p-4 sm:p-5 flex-1 min-h-[120px] text-sm text-on-surface leading-relaxed whitespace-pre-wrap font-normal selection:bg-tertiary/30 selection:text-on-surface">
              {graphText || (
                <div className="text-on-surface-variant/70 italic text-xs flex items-center gap-2">
                  <Icon name="hourglass_top" size={15} />
                  {isVectorStreaming
                    ? "Queued (executes sequentially to prevent GPU OOM)..."
                    : "Waiting for response generation..."}
                </div>
              )}
              {isGraphStreaming && (
                <span className="inline-block w-1.5 h-4 ml-1 bg-tertiary align-middle animate-pulse" />
              )}
            </div>

            {/* Context Inspector */}
            {(graphNodes.length > 0 || graphEdges.length > 0) && (
              <div className="border-t border-outline-variant/20 bg-surface-container-lowest/60">
                <button
                  type="button"
                  onClick={() => setShowGraphContext(!showGraphContext)}
                  className="w-full px-4 py-2 flex items-center justify-between text-xs text-tertiary hover:text-tertiary-fixed transition-colors text-left"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon name="device_hub" size={15} />
                    Retrieved Subgraph ({graphNodes.length} nodes, {graphEdges.length} edges)
                  </span>
                  <Icon
                    name={showGraphContext ? "expand_less" : "expand_more"}
                    size={16}
                  />
                </button>

                {showGraphContext && (
                  <div className="px-4 pb-3 space-y-2 max-h-56 overflow-y-auto">
                    {/* Entities */}
                    {graphNodes.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-secondary">
                          Key Entities
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {graphNodes.map((n) => (
                            <span
                              key={n.id}
                              title={n.description}
                              className="px-2 py-0.5 rounded-md text-[11px] bg-tertiary/10 border border-tertiary/25 text-tertiary-fixed"
                            >
                              {n.name} <span className="opacity-70 text-[10px]">({n.type})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Relationships */}
                    {graphEdges.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-secondary">
                          Graph Relations
                        </div>
                        {graphEdges.map((e, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded bg-surface-container-high/60 border border-outline-variant/30 text-xs"
                          >
                            <div className="font-mono text-[11px] text-tertiary font-semibold flex items-center gap-1">
                              <span>{e.source}</span>
                              <span className="text-secondary text-[10px]">--[{e.type}]--&gt;</span>
                              <span>{e.target}</span>
                            </div>
                            {e.description && (
                              <p className="text-[11px] text-on-surface-variant mt-0.5">
                                {e.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
