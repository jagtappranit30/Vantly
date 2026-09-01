import os
import io
import re
import math
import json
import logging
import requests
from typing import List, Dict, Any, Optional
import numpy as np
from pypdf import PdfReader

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rag_engine")


class RAGEngine:
    def __init__(self):
        self.ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.ollama_model = os.environ.get("RAG_MODEL") or os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
        self.storage_file = os.environ.get("VECTOR_STORE_FILE", os.path.join(os.path.dirname(__file__), "vector_store.json"))

        # Vector store structure:
        # { doc_id: [{ "id": str, "text": str, "page": int, "embedding": np.ndarray }] }
        self.vector_store: Dict[str, List[Dict[str, Any]]] = {}
        self._fast_embed_model = None
        self._fast_embed_initialized = False

        # Load persisted vector store from disk on startup
        self._load_vector_store()

    def _load_vector_store(self):
        """Loads vector store chunks and embeddings from disk persistence."""
        if not os.path.exists(self.storage_file):
            logger.info(f"No existing vector store file found at '{self.storage_file}'. Starting fresh.")
            return

        try:
            with open(self.storage_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            loaded_count = 0
            for doc_id, chunks in data.items():
                parsed_chunks = []
                for c in chunks:
                    parsed_chunks.append({
                        "chunk_id": c["chunk_id"],
                        "page": c["page"],
                        "text": c["text"],
                        "embedding": np.array(c["embedding"], dtype=np.float32)
                    })
                self.vector_store[doc_id] = parsed_chunks
                loaded_count += len(parsed_chunks)

            logger.info(f"Loaded {len(self.vector_store)} documents ({loaded_count} total chunks) from '{self.storage_file}'.")
        except Exception as e:
            logger.error(f"Failed to load vector store from disk: {e}")

    def _save_vector_store(self):
        """Saves current vector store to disk file for persistence across restarts."""
        try:
            serializable_store = {}
            for doc_id, chunks in self.vector_store.items():
                serializable_store[doc_id] = [
                    {
                        "chunk_id": c["chunk_id"],
                        "page": c["page"],
                        "text": c["text"],
                        "embedding": c["embedding"].tolist()
                    }
                    for c in chunks
                ]

            dir_name = os.path.dirname(os.path.abspath(self.storage_file))
            if dir_name:
                os.makedirs(dir_name, exist_ok=True)

            temp_file = f"{self.storage_file}.tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(serializable_store, f)
            os.replace(temp_file, self.storage_file)
            logger.info(f"Persisted vector store ({len(self.vector_store)} documents) to '{self.storage_file}'.")
        except Exception as e:
            logger.error(f"Failed to save vector store to disk: {e}")

    def _get_fast_embed_model(self):
        """Lazy-loads FastEmbed model for semantic fallback when Ollama is unavailable."""
        if not self._fast_embed_initialized:
            try:
                from fastembed import TextEmbedding
                cache_dir = os.environ.get("FASTEMBED_CACHE_DIR", "/tmp/fastembed")
                self._fast_embed_model = TextEmbedding(
                    model_name="BAAI/bge-small-en-v1.5",
                    cache_dir=cache_dir
                )
                self._fast_embed_initialized = True
                logger.info("FastEmbed bge-small-en-v1.5 model initialized successfully.")
            except Exception as e:
                logger.warning(f"FastEmbed initialization skipped/failed: {e}")
                self._fast_embed_model = None
                self._fast_embed_initialized = True
        return self._fast_embed_model

    def _resolve_ollama_url(self) -> str:
        """Returns the correct Ollama URL, adjusting for Docker vs local host networking."""
        url = self.ollama_url
        is_docker = os.environ.get("SQL_HOST") == "db"
        if is_docker:
            if "localhost" in url or "127.0.0.1" in url:
                url = url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
        else:
            if "host.docker.internal" in url:
                url = url.replace("host.docker.internal", "127.0.0.1")
        return url

    def extract_text(self, file_bytes: bytes, file_name: str) -> List[Dict[str, Any]]:
        """Extracts text page by page from PDF or raw file."""
        pages = []
        is_pdf = file_name.lower().endswith(".pdf") or file_bytes[:4] == b"%PDF"

        if is_pdf:
            try:
                reader = PdfReader(io.BytesIO(file_bytes))
                for idx, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append({"page": idx + 1, "text": text.strip()})
            except Exception as e:
                logger.error(f"Error parsing PDF with pypdf: {e}")
                # Fallback to UTF-8 decoding
                raw_text = file_bytes.decode("utf-8", errors="ignore")
                pages.append({"page": 1, "text": raw_text})
        else:
            raw_text = file_bytes.decode("utf-8", errors="ignore")
            pages.append({"page": 1, "text": raw_text})

        return pages

    def _detect_sections(self, text: str) -> List[str]:
        """Splits text into logical sections using header detection.

        Recognises:
          - Lines of '=' or '-' (separator bars)
          - ALL-CAPS header lines (>= 4 chars, >= 60% uppercase alpha)
          - Lines starting with 'SECTION' or numbered section headers
        """
        lines = text.split("\n")
        section_break_indices: List[int] = []

        for i, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                continue

            # Separator bars: ===== or -----
            if len(stripped) >= 10 and (
                all(c == "=" for c in stripped) or all(c == "-" for c in stripped)
            ):
                section_break_indices.append(i)
                continue

            # ALL-CAPS header lines (at least 4 alpha chars, >=60% uppercase)
            alpha_chars = [c for c in stripped if c.isalpha()]
            if len(alpha_chars) >= 4:
                upper_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
                if upper_ratio >= 0.6 and len(stripped) < 120:
                    # Check next/prev line for separator bar to confirm it's a real header
                    has_adjacent_sep = False
                    for adj in [i - 1, i + 1]:
                        if 0 <= adj < len(lines):
                            adj_stripped = lines[adj].strip()
                            if len(adj_stripped) >= 10 and (
                                all(c == "=" for c in adj_stripped)
                                or all(c == "-" for c in adj_stripped)
                            ):
                                has_adjacent_sep = True
                                break
                    if has_adjacent_sep:
                        section_break_indices.append(i)

        if not section_break_indices:
            return [text]

        # Build sections from break points
        sections: List[str] = []
        # Include content before the first break
        prev_idx = 0
        for brk in section_break_indices:
            section_text = "\n".join(lines[prev_idx:brk]).strip()
            if section_text:
                sections.append(section_text)
            prev_idx = brk

        # Remaining content after last break
        tail = "\n".join(lines[prev_idx:]).strip()
        if tail:
            sections.append(tail)

        # Filter out tiny fragments (< 30 chars) — merge into previous section
        merged: List[str] = []
        for sec in sections:
            if len(sec) < 30 and merged:
                merged[-1] = merged[-1] + "\n" + sec
            else:
                merged.append(sec)

        return merged if merged else [text]

    def create_chunks(
        self,
        pages: List[Dict[str, Any]],
        chunk_size: int = 400,
        overlap: int = 150,
        max_section_chunk: int = 1500,
    ) -> List[Dict[str, Any]]:
        """Chunks page text using section-aware splitting with sliding window fallback.

        Strategy:
          1. Try to split each page into logical sections (by headers/separators).
          2. If a section is <= max_section_chunk chars, keep it as a single chunk
             (preserves complete financial tables).
          3. If a section exceeds max_section_chunk, apply sliding window subdivision.
        """
        chunks = []
        chunk_counter = 0

        for page_data in pages:
            page_num = page_data["page"]
            text = page_data["text"]

            # Attempt section-aware splitting
            sections = self._detect_sections(text)

            for section in sections:
                if len(section) <= max_section_chunk:
                    # Keep the entire section as one chunk
                    chunk_counter += 1
                    chunks.append({
                        "chunk_id": f"p{page_num}_c{chunk_counter}",
                        "page": page_num,
                        "text": section,
                    })
                else:
                    # Sliding window fallback for oversized sections
                    start = 0
                    while start < len(section):
                        end = start + chunk_size
                        chunk_text = section[start:end].strip()
                        if chunk_text:
                            chunk_counter += 1
                            chunks.append({
                                "chunk_id": f"p{page_num}_c{chunk_counter}",
                                "page": page_num,
                                "text": chunk_text,
                            })
                        start += (chunk_size - overlap)

        return chunks

    def _get_embedding(self, text: str) -> np.ndarray:
        """Generates embedding vector using local Ollama embeddings API with FastEmbed semantic fallback."""
        ollama_url = self._resolve_ollama_url()
        try:
            resp = requests.post(
                f"{ollama_url}/api/embeddings",
                json={"model": self.ollama_model, "prompt": text},
                timeout=30
            )
            if resp.status_code == 200:
                data = resp.json()
                values = data.get("embedding")
                if values and len(values) > 0:
                    vec = np.array(values, dtype=np.float32)
                    norm = np.linalg.norm(vec)
                    return vec / (norm + 1e-10)
        except Exception as e:
            logger.warning(f"Ollama embedding request failed ({e}). Attempting FastEmbed fallback.")

        # FastEmbed semantic fallback (BGE Small v1.5)
        try:
            model = self._get_fast_embed_model()
            if model is not None:
                embeddings = list(model.embed([text]))
                if embeddings and len(embeddings) > 0:
                    vec = np.array(embeddings[0], dtype=np.float32)
                    norm = np.linalg.norm(vec)
                    logger.info(f"Generated semantic fallback embedding using FastEmbed for '{text[:40]}...'")
                    return vec / (norm + 1e-10)
        except Exception as fe_err:
            logger.error(f"FastEmbed fallback generation failed: {fe_err}")

        raise RuntimeError(
            "Embedding generation failed: Neither Ollama embedding API nor FastEmbed model are available."
        )

    def index_document(self, doc_id: str, file_bytes: bytes, file_name: str) -> Dict[str, Any]:
        """Indexes a document into the vector store and persists to disk."""
        pages = self.extract_text(file_bytes, file_name)
        chunks = self.create_chunks(pages)

        indexed_chunks = []
        for c in chunks:
            emb = self._get_embedding(c["text"])
            indexed_chunks.append({
                "chunk_id": c["chunk_id"],
                "page": c["page"],
                "text": c["text"],
                "embedding": emb
            })

        self.vector_store[doc_id] = indexed_chunks
        logger.info(f"Indexed document '{doc_id}' with {len(indexed_chunks)} chunks across {len(pages)} pages.")

        # Persist updated vector store to disk
        self._save_vector_store()

        return {
            "doc_id": doc_id,
            "total_pages": len(pages),
            "total_chunks": len(indexed_chunks),
            "status": "indexed"
        }

    def search_similar_chunks(
        self, doc_id: str, query: str, top_k: int = 6, min_similarity: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """Searches vector store for top_k most similar chunks using cosine similarity, filtered by min_similarity threshold."""
        if doc_id not in self.vector_store or not self.vector_store[doc_id]:
            return []

        if min_similarity is None:
            min_similarity = float(os.environ.get("RAG_MIN_SIMILARITY", "0.25"))

        query_emb = self._get_embedding(query)
        chunks = self.vector_store[doc_id]

        results = []
        for c in chunks:
            sim = float(np.dot(query_emb, c["embedding"]))
            if sim >= min_similarity:
                results.append((sim, c))

        results.sort(key=lambda x: x[0], reverse=True)
        top_results = results[:top_k]

        return [
            {
                "chunk_id": item[1]["chunk_id"],
                "page": item[1]["page"],
                "text": item[1]["text"],
                "similarity_score": round(item[0], 4)
            }
            for item in top_results
        ]

    def query(self, doc_id: str, question: str, top_k: int = 6) -> Dict[str, Any]:
        """Queries the vector index using local Ollama Qwen 2.5 (qwen2.5:7b) model."""
        if doc_id not in self.vector_store:
            return {
                "status": 404,
                "answer": f"No indexed content found for document ID '{doc_id}'. Please ensure a financial document has been uploaded.",
                "error": f"No indexed content found for document ID '{doc_id}'.",
                "sources": [],
                "doc_id": doc_id
            }

        relevant_chunks = self.search_similar_chunks(doc_id, question, top_k=top_k)

        if not relevant_chunks:
            return {
                "status": 200,
                "answer": "The requested information could not be found in the uploaded document.",
                "sources": [],
                "doc_id": doc_id
            }

        context_str = "\n\n".join([
            f"--- [SOURCE CHUNK: Page {c['page']} (Relevance: {c['similarity_score']})] ---\n{c['text']}"
            for c in relevant_chunks
        ])

        system_prompt = (
            "You are Productive Point's Financial Document Assistant powered by Qwen 2.5. Your job is to answer user questions about "
            "financial statements using ONLY the provided document context snippets.\n"
            "STRICT RULES:\n"
            "1. Base your answer strictly on the provided context snippets.\n"
            "2. If the answer is not contained in the snippets, state clearly that it is not disclosed in the document.\n"
            "3. Cite page numbers where applicable (e.g., '[Page 2]').\n"
            "4. Be concise, precise, and professional."
        )

        user_prompt = f"Document Context:\n{context_str}\n\nQuestion: {question}"

        ollama_url = self._resolve_ollama_url()
        model_name = self.ollama_model
        logger.info(f"[RAG Query] Provider: OLLAMA | Model: {model_name} (Qwen 2.5) | URL: {ollama_url}")

        answer = ""
        try:
            resp = requests.post(
                f"{ollama_url}/api/generate",
                json={
                    "model": model_name,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "stream": False,
                    "keep_alive": "10m",
                    "options": {"temperature": 0.2, "num_ctx": 8192}
                },
                timeout=120
            )
            if resp.status_code == 200:
                answer = resp.json().get("response", "")
        except Exception as e:
            logger.warning(f"Ollama query failed: {e}")

        if not answer:
            return {
                "status": 500,
                "answer": "RAG context retrieved, but local Qwen 2.5 model generation failed or timed out:\n\n" + "\n".join([f"• Page {c['page']}: {c['text'][:150]}..." for c in relevant_chunks]),
                "error": "LLM generation failed or Ollama unreachable.",
                "sources": relevant_chunks,
                "doc_id": doc_id
            }

        return {
            "status": 200,
            "answer": answer,
            "sources": relevant_chunks,
            "doc_id": doc_id
        }

# Global singleton instance
rag_engine = RAGEngine()

