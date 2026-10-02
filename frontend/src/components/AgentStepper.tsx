import { useState } from "react";
import Icon from "./Icon";

export interface StepperState {
  currentStep: number;
  toolDecision?: {
    tool_name: string;
    query: string;
    reason: string;
  };
  queryAttempts: Array<{
    attempt: number;
    original_query: string;
    enhanced_query: string;
  }>;
  evaluation?: {
    attempt: number;
    vector_useful?: boolean;
    vector_reason?: string;
    graph_useful?: boolean;
    graph_reason?: string;
  };
  retryNotice?: string;
  phase?: "idle" | "vector" | "graph" | "done";
}

interface AgentStepperProps {
  state: StepperState;
  isStreaming: boolean;
}

export default function AgentStepper({ state, isStreaming }: AgentStepperProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (state.currentStep < 4) return null;

  return (
    <div className="w-full mb-4 rounded-xl border border-outline-variant/40 bg-surface-container-low/70 backdrop-blur-md overflow-hidden transition-all duration-300 shadow-sm">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-surface-container-high/40 hover:bg-surface-container-high/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Icon name="psychology" size={16} />
          </div>
          <span className="text-xs font-label font-semibold text-on-surface">
            Agent Reasoning Pipeline
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-container-highest font-mono text-secondary">
            Step {Math.min(state.currentStep, 8)} / 8
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 text-[11px] text-primary font-medium animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Processing
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Icon
            name={isOpen ? "expand_less" : "expand_more"}
            size={18}
            className="text-on-surface-variant"
          />
        </div>
      </button>

      {/* Stepper Details */}
      {isOpen && (
        <div className="p-3.5 space-y-3 text-xs border-t border-outline-variant/20 font-body">
          {/* Step 4: Tool Decision */}
          <div className="flex items-start gap-2.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-mono mt-0.5 ${
                state.currentStep >= 4
                  ? "bg-primary text-on-primary font-bold"
                  : "bg-surface-container-highest text-on-surface-variant"
              }`}
            >
              4
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-headline font-medium text-on-surface">
                  LLM Tool Routing
                </span>
                {state.toolDecision && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
                    {state.toolDecision.tool_name}
                  </span>
                )}
              </div>
              {state.toolDecision?.reason && (
                <p className="text-on-surface-variant mt-0.5 text-[11px] italic">
                  "{state.toolDecision.reason}"
                </p>
              )}
            </div>
          </div>

          {/* Step 5: Query Enhancement */}
          {state.currentStep >= 5 && (
            <div className="flex items-start gap-2.5">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-mono mt-0.5 ${
                  state.currentStep >= 5
                    ? "bg-primary text-on-primary font-bold"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                5
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-headline font-medium text-on-surface">
                  Query Expansion & Retrieval
                </span>
                {state.queryAttempts.map((q, idx) => (
                  <div
                    key={idx}
                    className="mt-1.5 p-2 rounded-lg bg-surface-container-lowest/80 border border-outline-variant/30 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 text-secondary font-mono text-[10px] uppercase">
                      <Icon name="auto_awesome" size={13} className="text-primary" />
                      <span>Attempt #{q.attempt} Enhanced Query:</span>
                    </div>
                    <div className="text-on-surface mt-0.5 font-mono text-[11px] text-primary">
                      {q.enhanced_query}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 6: Relevance Evaluation */}
          {state.currentStep >= 6 && state.evaluation && (
            <div className="flex items-start gap-2.5">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-mono mt-0.5 ${
                  state.currentStep >= 6
                    ? "bg-primary text-on-primary font-bold"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                6
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-headline font-medium text-on-surface">
                    Context Utility & Verification
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        state.evaluation.vector_useful
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      Vector: {state.evaluation.vector_useful ? "Useful" : "Not Useful"}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                        state.evaluation.graph_useful
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      Graph: {state.evaluation.graph_useful ? "Useful" : "Not Useful"}
                    </span>
                  </div>
                </div>
                {state.retryNotice && (
                  <p className="mt-1 text-[11px] text-amber-300/90 flex items-center gap-1">
                    <Icon name="refresh" size={13} className="animate-spin" />
                    <span>{state.retryNotice}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 7: Sequential Inference */}
          {state.currentStep >= 7 && (
            <div className="flex items-start gap-2.5">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-mono mt-0.5 ${
                  state.currentStep >= 7
                    ? "bg-primary text-on-primary font-bold"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                7
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-headline font-medium text-on-surface">
                    Sequential Generation (OOM Safe)
                  </span>
                  <span className="text-[10px] text-on-surface-variant font-mono">
                    {state.phase === "vector"
                      ? "Generating VectorRAG..."
                      : state.phase === "graph"
                      ? "Generating GraphRAG..."
                      : "Complete"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${
                      state.phase === "vector"
                        ? "bg-primary/20 text-primary border border-primary/40 animate-pulse"
                        : "bg-surface-container-highest text-on-surface-variant"
                    }`}
                  >
                    1. VectorRAG
                  </span>
                  <span className="text-on-surface-variant text-[10px]">➔</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${
                      state.phase === "graph"
                        ? "bg-tertiary/20 text-tertiary border border-tertiary/40 animate-pulse"
                        : "bg-surface-container-highest text-on-surface-variant"
                    }`}
                  >
                    2. GraphRAG
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
