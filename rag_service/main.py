import os
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from rag_engine import rag_engine

app = FastAPI(title="Productive Point AI - Python RAG Microservice", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    doc_id: str
    question: str
    top_k: Optional[int] = 6

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Productive Point AI Python RAG Engine",
        "llm_provider": "ollama",
        "ollama_model": rag_engine.ollama_model,
        "indexed_documents_count": len(rag_engine.vector_store)
    }

@app.post("/index")
async def index_document(
    doc_id: str = Form(...),
    file: UploadFile = File(...)
):
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        res = rag_engine.index_document(
            doc_id=doc_id,
            file_bytes=content,
            file_name=file.filename or "document.pdf"
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to index document: {str(e)}")

@app.post("/extract")
async def extract_document_text(file: UploadFile = File(...)):
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        pages = rag_engine.extract_text(file_bytes=content, file_name=file.filename or "document.pdf")
        full_text = "\n\n".join([f"[PAGE {p['page']}]\n{p['text']}" for p in pages if p['text'].strip()])
        return {"text": full_text or "No text extracted from document."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text extraction failed: {str(e)}")

from fastapi.responses import JSONResponse

@app.post("/query")
def query_document(req: QueryRequest):
    try:
        if not req.doc_id or not req.question:
            return JSONResponse(
                content={"error": "Missing required parameters: doc_id and question."},
                status_code=400
            )

        result = rag_engine.query(
            doc_id=req.doc_id,
            question=req.question,
            top_k=req.top_k or 4
        )
        status_code = result.pop("status", 200)
        return JSONResponse(content=result, status_code=status_code)
    except Exception as e:
        return JSONResponse(
            content={"error": f"RAG query execution failed: {str(e)}"},
            status_code=500
        )

if __name__ == "__main__":
    port = int(os.environ.get("RAG_PORT", 8000))
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
