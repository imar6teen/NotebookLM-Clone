import { useState, useEffect } from "react";
import Icon from "./Icon";
import { getGraphData } from "../api";
import type { GraphData, GraphNode } from "../api";

interface GraphModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GraphModal({ isOpen, onClose }: GraphModalProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      getGraphData()
        .then((data) => {
          setGraphData(data);
          if (data.nodes.length > 0) setSelectedNode(data.nodes[0]);
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const entityTypes = ["ALL", ...Array.from(new Set(graphData.nodes.map((n) => n.type)))];

  const filteredNodes = graphData.nodes.filter((n) => {
    const matchesSearch =
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.description.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === "ALL" || n.type === selectedType;
    return matchesSearch && matchesType;
  });

  const connectedLinks = selectedNode
    ? graphData.links.filter(
        (l) => l.source === selectedNode.id || l.target === selectedNode.id
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md animate-fade-in font-body">
      <div className="w-full max-w-5xl h-[85vh] bg-surface rounded-2xl border border-primary/20 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-outline-variant/30 flex items-center justify-between bg-surface-container-high/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-tertiary/20 text-tertiary flex items-center justify-center font-bold">
              <Icon name="hub" size={22} />
            </div>
            <div>
              <h2 className="text-base font-headline font-semibold text-on-surface">
                Knowledge Graph Explorer
              </h2>
              <p className="text-xs text-on-surface-variant">
                G-Retriever Structured Entities & Relational Schema
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs font-mono text-secondary">
              <span>{graphData.nodes.length} Nodes</span>
              <span>•</span>
              <span>{graphData.links.length} Relations</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left: Entities List & Filter */}
          <div className="w-full md:w-80 border-r border-outline-variant/20 flex flex-col bg-surface-container-lowest/40">
            {/* Search Input */}
            <div className="p-3 border-b border-outline-variant/20">
              <div className="relative">
                <Icon
                  name="search"
                  size={16}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant"
                />
                <input
                  type="text"
                  placeholder="Search entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-container-high/70 border border-outline-variant/30 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:border-primary/50"
                />
              </div>

              {/* Type Filter Pills */}
              <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 no-scrollbar">
                {entityTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
                      selectedType === type
                        ? "bg-tertiary text-on-tertiary font-semibold"
                        : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="p-4 text-center text-xs text-on-surface-variant animate-pulse">
                  Loading Knowledge Graph...
                </div>
              ) : filteredNodes.length === 0 ? (
                <div className="p-4 text-center text-xs text-on-surface-variant">
                  No entities found
                </div>
              ) : (
                filteredNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNode(node)}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition-all flex flex-col gap-0.5 ${
                      selectedNode?.id === node.id
                        ? "bg-tertiary/15 border border-tertiary/40 text-on-surface"
                        : "hover:bg-surface-container-high/60 text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-headline font-medium truncate text-on-surface">
                        {node.name}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-container-highest text-secondary">
                        {node.type}
                      </span>
                    </div>
                    {node.description && (
                      <p className="text-[11px] line-clamp-1 text-on-surface-variant">
                        {node.description}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: Selected Node Details & Connected Edges */}
          <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-surface-container/20">
            {selectedNode ? (
              <div className="max-w-2xl space-y-6">
                {/* Node Title Card */}
                <div className="p-5 rounded-xl bg-surface-container-low/70 border border-outline-variant/30 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-tertiary/15 text-tertiary border border-tertiary/30">
                      {selectedNode.type}
                    </span>
                    <span className="text-xs font-mono text-secondary">
                      ID: {selectedNode.id}
                    </span>
                  </div>
                  <h3 className="text-xl font-headline font-semibold text-on-surface">
                    {selectedNode.name}
                  </h3>
                  <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                    {selectedNode.description || "No specific description available."}
                  </p>
                </div>

                {/* Connected Relationships */}
                <div>
                  <h4 className="text-xs font-label uppercase tracking-widest text-secondary font-semibold mb-3 flex items-center gap-1.5">
                    <Icon name="device_hub" size={16} />
                    Connected Graph Relationships ({connectedLinks.length})
                  </h4>

                  {connectedLinks.length === 0 ? (
                    <div className="p-4 rounded-xl bg-surface-container-low/40 border border-outline-variant/20 text-xs text-on-surface-variant italic">
                      No direct relationships connected to this entity.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {connectedLinks.map((link, idx) => {
                        const isOutgoing = link.source === selectedNode.id;
                        const otherNodeId = isOutgoing ? link.target : link.source;
                        const otherNode = graphData.nodes.find((n) => n.id === otherNodeId);

                        return (
                          <div
                            key={idx}
                            className="p-3.5 rounded-xl bg-surface-container-low/60 border border-outline-variant/30 flex flex-col gap-1 text-xs"
                          >
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="text-primary font-semibold">
                                {isOutgoing ? selectedNode.name : otherNode?.name || link.source}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-tertiary/20 text-tertiary border border-tertiary/30">
                                {link.type}
                              </span>
                              <span className="text-primary font-semibold">
                                {isOutgoing ? otherNode?.name || link.target : selectedNode.name}
                              </span>
                              <span className="ml-auto text-[10px] text-secondary">
                                Weight: {link.weight}
                              </span>
                            </div>
                            {link.description && (
                              <p className="text-on-surface-variant text-[11px] mt-1 pl-1 border-l-2 border-primary/30">
                                {link.description}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-on-surface-variant">
                <Icon name="touch_app" size={32} className="mb-2 opacity-50" />
                <p className="text-sm">Select an entity from the list to inspect its graph connections</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
