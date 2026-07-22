from fastapi import FastAPI

app = FastAPI(title="Divvit AI & Ingestion API")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Divvit AI Backend"}
