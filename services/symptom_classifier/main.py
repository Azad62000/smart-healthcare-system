"""Local inference service for the public symptom classification prototype."""
import os
import threading
import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.getenv("SYMPTOM_MODEL_ID", "Zabihin/Symptom_to_Diagnosis")
# Avoid requests hanging indefinitely when a deployment cannot reach Hugging Face.
os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "20")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "120")
app = FastAPI(title="Public BERT Symptom Classifier", version="1.0.0")
logger = logging.getLogger("symptom_classifier")
_classifier: Any = None
_classifier_lock = threading.Lock()


class ClassificationInput(BaseModel):
    symptoms: str = Field(min_length=12, max_length=3000)


def _get_classifier():
    global _classifier
    if _classifier is not None:
        return _classifier
    with _classifier_lock:
        if _classifier is None:
            from transformers import AutoTokenizer, TFAutoModelForSequenceClassification, pipeline

            tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            model = TFAutoModelForSequenceClassification.from_pretrained(MODEL_ID)
            _classifier = pipeline("text-classification", model=model, tokenizer=tokenizer, framework="tf")
    return _classifier


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_ID, "loaded": _classifier is not None}


@app.post("/classify")
def classify(payload: ClassificationInput):
    try:
        classifier = _get_classifier()
        raw = classifier(payload.symptoms, top_k=3, truncation=True, max_length=512)
        predictions = raw[0] if raw and isinstance(raw[0], list) else raw
        matches = [
            {"label": item["label"], "score": float(item["score"])}
            for item in predictions
        ]
        return {
            "model": MODEL_ID,
            "matches": matches,
            "notice": "Experimental text classification only. Not a diagnosis or triage assessment.",
        }
    except Exception as error:
        # Log the model failure for operators, without logging symptom text.
        logger.exception("Local symptom model request failed")
        raise HTTPException(status_code=503, detail="The local symptom model is unavailable.") from error
