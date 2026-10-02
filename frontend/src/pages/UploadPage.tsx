import { useState, useRef, useEffect } from "react";
import Icon from "../components/Icon";
import { uploadFiles, indexSampleDocument, getIndexingStatus } from "../api";
import type { IndexingStatus } from "../api";

interface UploadPageProps {
  onFileUploaded: (fileName: string) => void;
}

export default function UploadPage({ onFileUploaded }: UploadPageProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [activeFileName, setActiveFileName] = useState("");
  const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
    is_indexing: false,
    progress_percent: 0,
    stage: "idle",
    message: "Ready",
    doc_count: 0,
    chunk_count: 0,
    node_count: 0,
    edge_count: 0,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  function startPollingStatus(uploadedName: string) {
    setIsIndexing(true);
    setActiveFileName(uploadedName);
    setErrorMsg(null);

    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = window.setInterval(async () => {
      try {
        const status = await getIndexingStatus();
        setIndexingStatus(status);

        if (status.error) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setIsIndexing(false);
          setErrorMsg(status.error);
        } else if (!status.is_indexing && status.stage === "complete") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setTimeout(() => {
            setIsIndexing(false);
            onFileUploaded(uploadedName);
          }, 800);
        }
      } catch (err: any) {
        console.error("Status polling error:", err);
      }
    }, 700);
  }

  async function handleFilesSelected(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    const displayName =
      fileArray.length === 1
        ? fileArray[0].name
        : `${fileArray[0].name} + ${fileArray.length - 1} more`;

    try {
      setIsIndexing(true);
      setActiveFileName(displayName);
      setErrorMsg(null);
      await uploadFiles(fileArray);
      startPollingStatus(displayName);
    } catch (err: any) {
      setIsIndexing(false);
      setErrorMsg(err.message || "Upload failed. Please check backend connection.");
    }
  }

  async function handleSampleSelect(sampleFile: string, label: string) {
    try {
      setIsIndexing(true);
      setActiveFileName(label);
      setErrorMsg(null);
      await indexSampleDocument(sampleFile);
      startPollingStatus(label);
    } catch (err: any) {
      setIsIndexing(false);
      setErrorMsg(err.message || "Failed to load sample document.");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  }

  const sampleDocs = [
    {
      name: "The FAISS Library (Meta AI).pdf",
      file: "example1.pdf",
      desc: "Vector Similarity Search & ANNS • 12 pgs",
      icon: "menu_book",
      color: "primary",
    },
    {
      name: "Enterprise Knowledge Base.pdf",
      file: "example2.pdf",
      desc: "Technical Specifications & Arch • 8 pgs",
      icon: "account_tree",
      color: "tertiary",
    },
    {
      name: "Multi-Entity Relational Doc.pdf",
      file: "example3.pdf",
      desc: "Entities, Roles & Systems • 6 pgs",
      icon: "hub",
      color: "secondary",
    },
  ];

  const capabilities = [
    {
      icon: "bolt",
      title: "Dual RAG Comparison",
      desc: "Simultaneous Vector & Graph pipelines",
      color: "primary",
    },
    {
      icon: "hub",
      title: "G-Retriever PCST",
      desc: "Steiner Tree Subgraph reasoning",
      color: "tertiary",
    },
    {
      icon: "psychology",
      title: "Agentic Tool Router",
      desc: "Self-correcting query expansion",
      color: "primary",
    },
    {
      icon: "memory",
      title: "OOM-Safe Local Model",
      desc: "Sequential GPU-safe generation",
      color: "secondary",
    },
  ];

  return (
    <div className="relative w-full overflow-hidden flex flex-col items-center justify-center px-4 py-8 sm:py-12 font-body">
      {/* Ambient Glow Orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[340px] bg-primary/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[260px] bg-tertiary/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Centered Stage Container */}
      <div className="w-full max-w-4xl flex flex-col items-center">
        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container/70 backdrop-blur-xl mb-6 shadow-sm border border-outline-variant/30">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-label uppercase tracking-widest text-secondary font-medium">
            VectorRAG + GraphRAG Neural Engine • Ready
          </span>
        </div>

        {/* Core Heading */}
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-headline font-semibold text-center text-on-surface tracking-tight leading-[1.15]">
          Upload your folder or files <br className="hidden sm:inline" />
          to start RAG comparison
        </h1>
        <p className="mt-4 text-center text-on-surface-variant max-w-2xl text-sm sm:text-base font-normal leading-relaxed">
          Drop PDF research papers, technical docs, or entire folders. The system
          indexes both <strong>VectorRAG (FAISS + bge-m3)</strong> and{" "}
          <strong>GraphRAG (G-Retriever PCST)</strong> side-by-side.
        </p>

        {/* Error Alert */}
        {errorMsg && (
          <div className="w-full mt-6 p-4 rounded-xl bg-error/15 border border-error/40 text-on-surface flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <Icon name="error" size={20} className="text-error" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Drag & Drop Zone */}
        <div className="w-full mt-8 relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 via-tertiary/20 to-primary/20 rounded-2xl blur-lg opacity-40 group-hover:opacity-85 transition-opacity duration-500" />

          <div
            id="dropzone"
            className={`relative w-full rounded-2xl bg-surface/80 backdrop-blur-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 border border-outline-variant/30 ${
              isDragOver
                ? "bg-surface-container-high/90 border-primary"
                : "hover:bg-surface-bright/70"
            }`}
            onClick={() => !isIndexing && fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
          >
            {/* Icon Disc */}
            <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-surface-container-high/90 shadow-xl mb-5 group-hover:scale-105 transition-transform duration-300">
              <Icon
                name={isIndexing ? "hourglass_top" : "cloud_upload"}
                size={36}
                className={`${
                  isIndexing ? "text-tertiary animate-spin" : "text-primary"
                } drop-shadow-[0_0_12px_rgba(125,211,252,0.6)]`}
              />
            </div>

            {/* Call to Action */}
            <h2 className="text-lg sm:text-xl font-headline font-medium text-on-surface">
              {isIndexing ? (
                <span>Indexing "{activeFileName}"...</span>
              ) : (
                <>
                  Drag & drop files or folder here, or{" "}
                  <span className="text-primary font-semibold underline-offset-4 hover:underline">
                    browse files
                  </span>
                </>
              )}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-on-surface-variant max-w-md">
              {isIndexing
                ? indexingStatus.message
                : "Supports PDF, DOCX, TXT, MD, CSV. Multi-file batch and folder uploads supported."}
            </p>

            {/* Folder Upload Button */}
            {!isIndexing && (
              <div className="mt-4 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-surface-container-high/80 hover:bg-surface-container-highest border border-primary/30 text-xs font-label font-medium text-primary hover:text-primary-fixed transition-all flex items-center gap-2 shadow-sm"
                >
                  <Icon name="drive_folder_upload" size={17} />
                  <span>Upload Folder</span>
                </button>
              </div>
            )}

            {/* Hidden Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.md"
              className="hidden"
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-ignore
              webkitdirectory=""
              // @ts-ignore
              directory=""
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
            />

            {/* Real-Time Progress Bar */}
            {isIndexing && (
              <div className="mt-6 w-full max-w-md flex flex-col gap-2.5 p-4 rounded-xl bg-surface-container-lowest/80 border border-outline-variant/30">
                <div className="flex items-center justify-between text-xs font-label text-on-surface">
                  <span className="truncate font-medium text-primary flex items-center gap-1.5">
                    <Icon name="sync" size={14} className="animate-spin" />
                    {indexingStatus.stage.toUpperCase()}: {indexingStatus.message}
                  </span>
                  <span className="text-secondary font-mono font-bold">
                    {indexingStatus.progress_percent}%
                  </span>
                </div>

                <div className="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary via-tertiary to-primary-fixed rounded-full transition-all duration-300"
                    style={{ width: `${indexingStatus.progress_percent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-on-surface-variant">
                  <span>Chunks: {indexingStatus.chunk_count}</span>
                  <span>Graph Nodes: {indexingStatus.node_count}</span>
                  <span>Relations: {indexingStatus.edge_count}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sample Documents Strip */}
        <div className="w-full mt-10 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-8 h-[1px] bg-outline-variant/50" />
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant font-medium">
              Or analyze with a sample document
            </span>
            <span className="w-8 h-[1px] bg-outline-variant/50" />
          </div>

          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {sampleDocs.map((doc) => (
              <button
                key={doc.file}
                type="button"
                disabled={isIndexing}
                onClick={() => handleSampleSelect(doc.file, doc.name)}
                className="text-left p-4 rounded-xl bg-surface-container-low/60 backdrop-blur-md hover:bg-surface-container-high/80 transition-all duration-200 group flex items-start gap-3.5 border border-outline-variant/20 hover:border-primary/30 shadow-sm hover:shadow-md disabled:opacity-50"
              >
                <div
                  className="p-2.5 rounded-lg bg-surface-container-highest text-primary group-hover:bg-primary/20 transition-colors shrink-0"
                >
                  <Icon name={doc.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-headline text-xs font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
                    {doc.name}
                  </div>
                  <div className="text-[11px] text-on-surface-variant mt-0.5">
                    {doc.desc}
                  </div>
                  <div className="mt-2 inline-flex items-center text-[10px] text-secondary font-medium tracking-wide">
                    <span>Click to index &amp; compare</span>
                    <Icon
                      name="arrow_forward"
                      size={13}
                      className="ml-1 group-hover:translate-x-0.5 transition-transform"
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Capabilities Grid */}
        <div className="w-full mt-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="p-4 rounded-xl bg-surface-container-lowest/70 backdrop-blur-lg flex flex-col items-center text-center border border-outline-variant/20 group hover:bg-surface-container-low/80 transition-colors"
            >
              <div
                className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-2.5"
              >
                <Icon name={cap.icon} size={20} />
              </div>
              <span className="font-headline text-xs font-medium text-on-surface">
                {cap.title}
              </span>
              <span className="text-[11px] text-on-surface-variant mt-1 leading-snug">
                {cap.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
