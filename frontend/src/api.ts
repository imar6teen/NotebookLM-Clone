export interface IndexingStatus {
  is_indexing: boolean;
  progress_percent: number;
  stage: string;
  message: string;
  doc_count: number;
  chunk_count: number;
  node_count: number;
  edge_count: number;
  error?: string | null;
}

export interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  num_chunks: number;
  status: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  description: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SSEEvent {
  event: string;
  data: any;
}

const API_BASE = "";

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  return res.json();
}
export const getHealth = checkHealth;

export async function uploadFiles(files: File[], maxGraphChunks: number = 12) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  formData.append("max_graph_chunks", maxGraphChunks.toString());

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function indexSampleDocument(sampleName: string, maxGraphChunks: number = 12) {
  const res = await fetch(`${API_BASE}/api/index-sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample_name: sampleName, max_graph_chunks: maxGraphChunks }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Sample indexing failed" }));
    throw new Error(err.detail || "Sample indexing failed");
  }
  return res.json();
}

export async function getIndexingStatus(): Promise<IndexingStatus> {
  const res = await fetch(`${API_BASE}/api/indexing-status`);
  return res.json();
}

export async function getDocuments(): Promise<DocumentInfo[]> {
  const res = await fetch(`${API_BASE}/api/documents`);
  return res.json();
}

export async function getGraphData(): Promise<GraphData> {
  const res = await fetch(`${API_BASE}/api/graph-data`);
  return res.json();
}

export async function resetWorkspace() {
  const res = await fetch(`${API_BASE}/api/reset`, { method: "POST" });
  return res.json();
}

export async function streamChat(
  message: string,
  onEvent: (event: SSEEvent) => void,
  onError: (err: any) => void
) {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body received.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          onEvent(parsed);
        } catch {
          // Ignore partial or non-json lines
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        onEvent(parsed);
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    onError(err);
  }
}
