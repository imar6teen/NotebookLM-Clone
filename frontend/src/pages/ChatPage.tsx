import { useState, useEffect, useRef } from "react";
import Icon from "../components/Icon";
import AgentStepper from "../components/AgentStepper";
import type { StepperState } from "../components/AgentStepper";
import RAGComparisonCard from "../components/RAGComparisonCard";
import type {
  VectorChunk,
  GraphNodeData,
  GraphEdgeData,
} from "../components/RAGComparisonCard";
import GraphModal from "../components/GraphModal";
import {
  streamChat,
  getDocuments,
  getHealth,
} from "../api";
import type { DocumentInfo, SSEEvent } from "../api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  vectorText?: string;
  graphText?: string;
  isVectorStreaming?: boolean;
  isGraphStreaming?: boolean;
  stepperState?: StepperState;
  vectorChunks?: VectorChunk[];
  graphNodes?: GraphNodeData[];
  graphEdges?: GraphEdgeData[];
}

interface ChatPageProps {
  onNewUpload: () => void;
  initialFileName?: string;
}

export default function ChatPage({ onNewUpload, initialFileName }: ChatPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [healthStats, setHealthStats] = useState<{
    total_chunks?: number;
    total_nodes?: number;
    total_edges?: number;
    device?: string;
  }>({});
  const [isGraphModalOpen, setIsGraphModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDocuments().then(setDocuments).catch(console.error);
    getHealth().then(setHealthStats).catch(console.error);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(promptText?: string) {
    const textToSend = promptText || input.trim();
    if (!textToSend || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    const userMsgId = `user_${Date.now()}`;
    const assistantMsgId = `asst_${Date.now()}`;

    const userMessage: Message = {
      id: userMsgId,
      role: "user",
      content: textToSend,
    };

    const initialStepper: StepperState = {
      currentStep: 4,
      queryAttempts: [],
      phase: "idle",
    };

    const assistantMessage: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      vectorText: "",
      graphText: "",
      isVectorStreaming: false,
      isGraphStreaming: false,
      stepperState: initialStepper,
      vectorChunks: [],
      graphNodes: [],
      graphEdges: [],
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    await streamChat(
      textToSend,
      (event: SSEEvent) => {
        handleSSEEvent(assistantMsgId, event);
      },
      (err: any) => {
        console.error("Chat error:", err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  vectorText: `Error: ${err.message || "Failed to reach backend."}`,
                  graphText: `Error: ${err.message || "Failed to reach backend."}`,
                  isVectorStreaming: false,
                  isGraphStreaming: false,
                }
              : msg
          )
        );
        setIsStreaming(false);
      }
    );
  }

  function handleSSEEvent(msgId: string, event: SSEEvent) {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== msgId) return msg;

        const currentStepper: StepperState = msg.stepperState || {
          currentStep: 4,
          queryAttempts: [],
        };

        switch (event.event) {
          case "step": {
            return {
              ...msg,
              stepperState: {
                ...currentStepper,
                currentStep: event.data.step,
              },
            };
          }

          case "tool_decision": {
            return {
              ...msg,
              stepperState: {
                ...currentStepper,
                toolDecision: event.data,
              },
            };
          }

          case "query_enhanced": {
            const existing = currentStepper.queryAttempts || [];
            return {
              ...msg,
              stepperState: {
                ...currentStepper,
                queryAttempts: [...existing, event.data],
              },
            };
          }

          case "evaluation_result": {
            return {
              ...msg,
              stepperState: {
                ...currentStepper,
                evaluation: event.data,
              },
            };
          }

          case "retry_notice": {
            return {
              ...msg,
              stepperState: {
                ...currentStepper,
                retryNotice: event.data.message,
              },
            };
          }

          case "contexts_payload": {
            return {
              ...msg,
              vectorChunks: event.data.vector_chunks || [],
              graphNodes: event.data.graph_nodes || [],
              graphEdges: event.data.graph_edges || [],
            };
          }

          case "vector_start": {
            return {
              ...msg,
              isVectorStreaming: true,
              isGraphStreaming: false,
              stepperState: {
                ...currentStepper,
                phase: "vector",
              },
            };
          }

          case "vector_token": {
            return {
              ...msg,
              vectorText: (msg.vectorText || "") + event.data,
            };
          }

          case "vector_done": {
            return {
              ...msg,
              isVectorStreaming: false,
              vectorText: event.data.text || msg.vectorText,
            };
          }

          case "graph_start": {
            return {
              ...msg,
              isVectorStreaming: false,
              isGraphStreaming: true,
              stepperState: {
                ...currentStepper,
                phase: "graph",
              },
            };
          }

          case "graph_token": {
            return {
              ...msg,
              graphText: (msg.graphText || "") + event.data,
            };
          }

          case "graph_done": {
            return {
              ...msg,
              isGraphStreaming: false,
              graphText: event.data.text || msg.graphText,
            };
          }

          case "done": {
            setIsStreaming(false);
            return {
              ...msg,
              isVectorStreaming: false,
              isGraphStreaming: false,
              stepperState: {
                ...currentStepper,
                currentStep: 8,
                phase: "done",
              },
            };
          }

          default:
            return msg;
        }
      })
    );
  }

  const sampleQuestions = [
    "What is the main contribution of this document?",
    "Explain how FAISS handles vector indexing and distance metrics.",
    "What entities and relationships are highlighted in the knowledge graph?",
    "Compare the trade-offs discussed between quantization and graph search.",
  ];

  const primaryDocName =
    documents.length > 0
      ? documents[0].name
      : initialFileName || "Uploaded Document";

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-background text-on-surface font-body">
      {/* ── Left Sidebar ── */}
      <aside
        className={`${
          sidebarOpen ? "w-80" : "w-0"
        } transition-all duration-300 border-r border-outline-variant/20 bg-surface-container-lowest/70 backdrop-blur-xl flex flex-col shrink-0 overflow-hidden`}
      >
        <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center">
              <Icon name="description" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-headline font-semibold text-on-surface truncate">
                Active Sources
              </h2>
              <p className="text-[11px] text-on-surface-variant font-mono">
                {documents.length || 1} Document(s)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNewUpload}
            title="Upload another document"
            className="p-1.5 rounded-lg bg-surface-container-high/80 hover:bg-surface-container-highest text-secondary hover:text-on-surface text-xs transition-colors flex items-center gap-1 font-label"
          >
            <Icon name="upload" size={16} />
            <span className="hidden sm:inline">Change</span>
          </button>
        </div>

        {/* Source Documents List */}
        <div className="p-3 border-b border-outline-variant/20 space-y-2">
          <div className="p-3 rounded-xl bg-surface-container/60 border border-primary/20">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-headline font-medium text-on-surface truncate">
                {primaryDocName}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Indexed
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
              <div className="p-1.5 rounded bg-surface-container-high/70">
                <div className="text-primary font-bold">
                  {healthStats.total_chunks || documents[0]?.num_chunks || 0}
                </div>
                <div className="text-on-surface-variant text-[9px]">Chunks</div>
              </div>
              <div className="p-1.5 rounded bg-surface-container-high/70">
                <div className="text-tertiary font-bold">
                  {healthStats.total_nodes || 0}
                </div>
                <div className="text-on-surface-variant text-[9px]">Nodes</div>
              </div>
              <div className="p-1.5 rounded bg-surface-container-high/70">
                <div className="text-secondary font-bold">
                  {healthStats.total_edges || 0}
                </div>
                <div className="text-on-surface-variant text-[9px]">Edges</div>
              </div>
            </div>
          </div>

          {/* Graph Explorer Trigger Button */}
          <button
            type="button"
            onClick={() => setIsGraphModalOpen(true)}
            className="w-full py-2 px-3 rounded-xl bg-tertiary/15 hover:bg-tertiary/25 border border-tertiary/30 text-tertiary-fixed text-xs font-label font-medium transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <Icon name="hub" size={16} />
            <span>Inspect Knowledge Graph</span>
          </button>
        </div>

        {/* Suggested Queries */}
        <div className="flex-1 overflow-y-auto p-3">
          <span className="text-[11px] font-label uppercase tracking-widest text-secondary font-semibold">
            Suggested Inquiries
          </span>
          <div className="mt-2.5 space-y-2">
            {sampleQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(q)}
                disabled={isStreaming}
                className="w-full text-left p-2.5 rounded-xl bg-surface-container-low/60 hover:bg-surface-container-high/70 border border-outline-variant/20 hover:border-primary/30 text-xs text-on-surface-variant hover:text-on-surface transition-all text-left flex items-start gap-2 group"
              >
                <Icon
                  name="chat_bubble_outline"
                  size={14}
                  className="mt-0.5 text-primary shrink-0 group-hover:scale-110 transition-transform"
                />
                <span className="leading-snug">{q}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-outline-variant/20 text-[11px] font-mono text-on-surface-variant/80 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            OOM-Safe Mode
          </span>
          <span>{healthStats.device || "GPU"}</span>
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Mini Bar with Sidebar Toggle */}
        <div className="h-10 px-4 border-b border-outline-variant/20 bg-surface/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 rounded text-on-surface-variant hover:text-on-surface transition-colors"
              title="Toggle sidebar"
            >
              <Icon name={sidebarOpen ? "menu_open" : "menu"} size={18} />
            </button>
            <span className="text-on-surface-variant font-headline font-medium truncate max-w-sm">
              Source: <strong className="text-on-surface">{primaryDocName}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-secondary font-mono">
              <Icon name="bolt" size={14} className="text-primary" />
              Dual Sequential RAG
            </span>
          </div>
        </div>

        {/* Messages Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary/20 via-tertiary/20 to-primary/10 border border-primary/30 flex items-center justify-center text-primary shadow-xl mb-6">
                <Icon name="auto_awesome" size={32} />
              </div>
              <h2 className="text-2xl font-headline font-semibold text-on-surface">
                Compare VectorRAG & GraphRAG
              </h2>
              <p className="mt-2 text-sm text-on-surface-variant max-w-md leading-relaxed">
                Ask any question about <strong>{primaryDocName}</strong>. The
                agent will query both pipelines sequentially and render both
                answers for direct comparison.
              </p>

              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                {sampleQuestions.slice(0, 3).map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(q)}
                    className="px-3.5 py-1.5 rounded-full bg-surface-container-high/60 hover:bg-surface-container-highest border border-outline-variant/30 text-xs text-secondary hover:text-primary transition-all shadow-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="w-full max-w-4xl mx-auto flex flex-col">
                {msg.role === "user" ? (
                  <div className="flex items-start justify-end gap-3 mb-2">
                    <div className="max-w-2xl px-4 py-3 rounded-2xl rounded-tr-sm bg-primary/15 border border-primary/30 text-on-surface text-sm font-body shadow-sm">
                      {msg.content}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
                      U
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 w-full">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary via-tertiary to-primary-container text-on-primary flex items-center justify-center shrink-0 shadow-md">
                      <Icon name="psychology" size={17} />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Step Reasoning Pipeline Stepper */}
                      {msg.stepperState && (
                        <AgentStepper
                          state={msg.stepperState}
                          isStreaming={!!(msg.isVectorStreaming || msg.isGraphStreaming)}
                        />
                      )}

                      {/* Dual RAG Comparison Card */}
                      <RAGComparisonCard
                        vectorText={msg.vectorText || ""}
                        graphText={msg.graphText || ""}
                        isVectorStreaming={!!msg.isVectorStreaming}
                        isGraphStreaming={!!msg.isGraphStreaming}
                        vectorChunks={msg.vectorChunks}
                        graphNodes={msg.graphNodes}
                        graphEdges={msg.graphEdges}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-outline-variant/20 bg-surface/70 backdrop-blur-xl">
          <div className="max-w-4xl mx-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="relative flex items-center rounded-2xl bg-surface-container/90 border border-outline-variant/40 focus-within:border-primary/60 transition-all shadow-lg overflow-hidden"
            >
              <input
                type="text"
                placeholder={
                  isStreaming
                    ? "Generating answers sequentially (OOM-Safe)..."
                    : `Ask anything about ${primaryDocName}...`
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isStreaming}
                className="w-full px-5 py-3.5 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none disabled:opacity-50"
              />

              <div className="pr-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  className="p-2 rounded-xl bg-primary hover:bg-primary-fixed text-on-primary disabled:opacity-30 disabled:pointer-events-none transition-all shadow-md flex items-center justify-center"
                >
                  <Icon name="arrow_upward" size={18} />
                </button>
              </div>
            </form>

            <div className="mt-2 flex items-center justify-between text-[11px] text-on-surface-variant px-1 font-mono">
              <span>Steps: Tool Routing ➔ Enhance ➔ VectorRAG ➔ GraphRAG</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                Local Gemma 4
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Knowledge Graph Explorer Modal */}
      <GraphModal
        isOpen={isGraphModalOpen}
        onClose={() => setIsGraphModalOpen(false)}
      />
    </div>
  );
}
