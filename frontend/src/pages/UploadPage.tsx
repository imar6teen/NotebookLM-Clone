import { useState, useRef } from "react";
import Icon from "../components/Icon";

interface UploadPageProps {
  onFileUploaded: (fileName: string) => void;
}

export default function UploadPage({ onFileUploaded }: UploadPageProps) {
  const [uploadState, setUploadState] = useState<{
    visible: boolean;
    fileName: string;
    progress: number;
    status: string;
  }>({ visible: false, fileName: "", progress: 0, status: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleUpload(name: string) {
    setUploadState({ visible: true, fileName: name, progress: 0, status: "0%" });

    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 18) + 8;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setUploadState((s) => ({
          ...s,
          progress: 100,
          status: "Ready",
          fileName: name + " (Vectorized)",
        }));
        setTimeout(() => {
          onFileUploaded(name);
        }, 600);
      } else {
        setUploadState((s) => ({
          ...s,
          progress,
          status: progress + "%",
        }));
      }
    }, 120);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleUpload(files[0].name);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files[0].name);
    }
  }

  const sampleDocs = [
    {
      name: "2024 Tech Strategy.pdf",
      desc: "Enterprise Architecture • 48 pgs",
      icon: "picture_as_pdf",
      color: "primary",
    },
    {
      name: "Q3 Financial Report.pdf",
      desc: "Earnings, Margins • 26 pgs",
      icon: "query_stats",
      color: "primary",
    },
    {
      name: "API Specification.docx",
      desc: "RESTful Schemas • 14 pgs",
      icon: "description",
      color: "tertiary",
    },
  ];

  const capabilities = [
    {
      icon: "bolt",
      title: "Instant Summarization",
      desc: "Multi-page synthesize in <2s",
      color: "primary",
    },
    {
      icon: "format_quote",
      title: "Contextual Citations",
      desc: "Direct jump to source line",
      color: "primary",
    },
    {
      icon: "manage_search",
      title: "Semantic Search",
      desc: "Vectorized multi-modal QA",
      color: "primary",
    },
    {
      icon: "lock",
      title: "Encrypted & Private",
      desc: "Zero persistence guarantee",
      color: "tertiary",
    },
  ];

  return (
    <div className="relative w-full overflow-hidden flex flex-col items-center justify-center px-4 py-8 sm:py-14">
      {/* Ambient Glow Orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[340px] bg-primary/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 left-1/3 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[260px] bg-tertiary/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Centered Stage Container */}
      <div className="w-full max-w-4xl flex flex-col items-center">
        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container/70 backdrop-blur-xl mb-6 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-label uppercase tracking-widest text-secondary font-medium">
            Neural Context Engine • Ready
          </span>
        </div>

        {/* Core Heading */}
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-headline font-semibold text-center text-on-surface tracking-tight leading-[1.15]">
          Upload your document <br className="hidden sm:inline" />
          to chat
        </h1>
        <p className="mt-4 text-center text-on-surface-variant max-w-2xl text-sm sm:text-base font-normal leading-relaxed">
          Drop research papers, financial reports, legal contracts, or technical
          PDFs (up to 50MB) to analyze with Glacier AI.
        </p>

        {/* Drag & Drop Zone */}
        <div className="w-full mt-10 relative group">
          {/* Ambient outer glow */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 via-tertiary/15 to-primary/20 rounded-xl blur-lg opacity-40 group-hover:opacity-85 transition-opacity duration-500" />

          <div
            id="dropzone"
            className={`relative w-full rounded-xl bg-surface/70 backdrop-blur-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 ${
              isDragOver ? "bg-surface-container-high/90" : "hover:bg-surface-bright/70"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {/* Inner dashed outline */}
            <div
              className="absolute inset-3 sm:inset-4 rounded-lg pointer-events-none transition-colors duration-300 shadow-[inset_0_0_20px_rgba(125,211,252,0.03)]"
              style={{
                boxShadow: "inset 0 0 0 1.5px rgba(125, 211, 252, 0.25)",
              }}
            />

            {/* Icon Disc */}
            <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-surface-container-high/90 shadow-xl mb-6 group-hover:scale-105 transition-transform duration-300">
              <Icon
                name="cloud_upload"
                size={36}
                className="text-primary drop-shadow-[0_0_12px_rgba(125,211,252,0.6)]"
              />
              <div className="absolute -inset-1.5 rounded-full bg-primary/10 animate-ping pointer-events-none opacity-40" />
            </div>

            {/* Call to Action */}
            <h2 className="text-lg sm:text-xl font-headline font-medium text-on-surface">
              Drag & drop your file here, or
              <span className="text-primary font-semibold underline-offset-4 hover:underline ml-1">
                browse files
              </span>
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-on-surface-variant max-w-md">
              All files are processed locally within encrypted enclave
              partitions. Instant OCR enabled.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.csv,.md"
              className="hidden"
              id="file-input"
              onChange={handleFileChange}
            />

            {/* Supported Formats */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {["PDF", "DOCX", "TXT", "CSV", "MD"].map((fmt) => (
                <span
                  key={fmt}
                  className="px-2.5 py-1 rounded-md text-[11px] font-label font-medium bg-surface-container-low/90 text-secondary"
                >
                  {fmt}
                </span>
              ))}
              <span className="text-[11px] text-on-surface-variant/80 ml-2 font-body">
                • Max 50 MB
              </span>
            </div>

            {/* Upload Progress */}
            {uploadState.visible && (
              <div className="mt-6 w-full max-w-sm flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-label text-on-surface">
                  <span className="truncate font-medium text-primary">
                    {uploadState.fileName}
                  </span>
                  <span className="text-secondary font-mono">
                    {uploadState.status}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${uploadState.progress}%` }}
                  />
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
              Try with a sample document
            </span>
            <span className="w-8 h-[1px] bg-outline-variant/50" />
          </div>

          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {sampleDocs.map((doc) => (
              <button
                key={doc.name}
                type="button"
                onClick={() => handleUpload(doc.name)}
                className="text-left p-4 rounded-xl bg-surface-container-low/60 backdrop-blur-md hover:bg-surface-container-high/70 transition-all duration-200 group flex items-start gap-3.5 shadow-sm hover:shadow-md"
              >
                <div
                  className={`p-2.5 rounded-lg bg-surface-container-highest text-${doc.color} group-hover:bg-${doc.color}/20 transition-colors shrink-0`}
                >
                  <Icon name={doc.icon} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`font-headline text-xs font-semibold text-on-surface truncate group-hover:text-${doc.color} transition-colors`}
                  >
                    {doc.name}
                  </div>
                  <div className="text-[11px] text-on-surface-variant mt-0.5">
                    {doc.desc}
                  </div>
                  <div className="mt-2 inline-flex items-center text-[10px] text-secondary font-medium tracking-wide">
                    <span>Click to analyze</span>
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
        <div className="w-full mt-12 grid grid-cols-2 md:grid-cols-4 gap-3">
          {capabilities.map((cap) => (
            <div
              key={cap.title}
              className="p-4 rounded-xl bg-surface-container-lowest/70 backdrop-blur-lg flex flex-col items-center text-center group hover:bg-surface-container-low/80 transition-colors"
            >
              <div
                className={`w-9 h-9 rounded-lg bg-${cap.color}/10 flex items-center justify-center text-${cap.color} mb-2.5`}
              >
                <Icon name={cap.icon} size={20} />
              </div>
              <span className="font-headline text-xs font-medium text-on-surface">
                {cap.title}
              </span>
              <span className="text-[11px] text-on-surface-variant mt-1">
                {cap.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
