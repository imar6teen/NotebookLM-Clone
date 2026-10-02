import os
import uuid
from typing import List, Tuple
from pathlib import Path
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from notebooklm_clone.rag.types import Chunk, ChunkMetadata


def extract_document(file_path: str, doc_name: str | None = None) -> list[Document]:
    """Extract content from file_path into LangChain Document objects.
    Uses Docling for PDF files (with markdown output) and native reader for text files.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    filename = doc_name or path.name
    file_size = path.stat().st_size
    suffix = path.suffix.lower()

    docs: list[Document] = []

    if suffix in [".txt", ".md", ".markdown", ".csv", ".json", ".log"]:
        # Direct high-speed text read
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            docs.append(Document(page_content=content, metadata={"source": filename, "file_size": file_size}))
        except Exception as e:
            print(f"Error reading text file {filename}: {e}")
            raise
    elif suffix in [".pdf", ".docx", ".pptx", ".html"]:
        # Use DoclingLoader as in notebook
        try:
            from langchain_docling.loader import DoclingLoader, ExportType
            loader = DoclingLoader(
                file_path=str(path),
                export_type=ExportType.MARKDOWN
            )
            raw_docs = loader.load()
            for d in raw_docs:
                d.metadata["source"] = filename
                d.metadata["file_size"] = file_size
            docs.extend(raw_docs)
        except Exception as e:
            print(f"Docling extraction failed for {filename}, attempting fallback: {e}")
            # If Docling fails, try basic fallback
            try:
                import pypdf
                reader = pypdf.PdfReader(str(path))
                text = "\n\n".join([page.extract_text() or "" for page in reader.pages])
                docs.append(Document(page_content=text, metadata={"source": filename, "file_size": file_size}))
            except Exception as fallback_err:
                raise RuntimeError(f"Failed to extract document {filename}: {fallback_err}") from e
    else:
        # Fallback to UTF-8 text read
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        docs.append(Document(page_content=content, metadata={"source": filename, "file_size": file_size}))

    return docs


def chunk_documents(docs: list[Document], doc_id: str, doc_name: str, chunk_size: int = 500, chunk_overlap: int = 100) -> list[Chunk]:
    """Split documents using RecursiveCharacterTextSplitter and return Chunk objects."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""]
    )
    raw_chunks = splitter.split_documents(docs)

    chunks: list[Chunk] = []
    for i, rc in enumerate(raw_chunks):
        cid = str(uuid.uuid4())
        doc_size = rc.metadata.get("file_size", 0)
        chunks.append(Chunk(
            id=cid,
            content=rc.page_content,
            metadata=ChunkMetadata(
                doc_id=doc_id,
                doc_name=doc_name,
                order=i,
                doc_size=doc_size
            )
        ))
    return chunks
