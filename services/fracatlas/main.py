"""FracAtlas YOLOv8 fracture localization inference service."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile
import threading
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException, Request
from PIL import Image, UnidentifiedImageError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("fracatlas")

MODEL_NAME = "FracAtlas YOLOv8s segmentation"
MODEL_URL = "https://raw.githubusercontent.com/XLR8-07/FracAtlas/master/weights/yolov8_segmentation_fractureAtlas.pt"
MODEL_SHA256 = "2f1dc81f2214e94e59398c8ead22bd1939601a735870faaec44452b01385fb35"
MODEL_PATH = Path(os.getenv("FRACATLAS_MODEL_PATH", Path(__file__).parent / "models/yolov8_segmentation_fractureAtlas.pt"))
MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

app = FastAPI(title="FracAtlas Fracture Check", version="1.0.0", docs_url=None, redoc_url=None)
_model = None
_model_lock = threading.Lock()
_model_error: str | None = None


def _ensure_weights() -> None:
    if MODEL_PATH.exists():
        digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
        if digest != MODEL_SHA256:
            raise RuntimeError("FracAtlas model weights failed checksum verification.")
        return

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=MODEL_PATH.parent, prefix="fracatlas-", suffix=".download", delete=False) as tmp:
        temp_path = Path(tmp.name)
        digest = hashlib.sha256()
        try:
            with urlopen(MODEL_URL, timeout=90) as response:
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    tmp.write(chunk)
            if digest.hexdigest() != MODEL_SHA256:
                raise RuntimeError("Downloaded FracAtlas model weights failed checksum verification.")
            tmp.flush()
            os.fsync(tmp.fileno())
            temp_path.replace(MODEL_PATH)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise


def _get_model():
    global _model, _model_error
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        _ensure_weights()
        from ultralytics import YOLO

        _model = YOLO(str(MODEL_PATH), task="segment")
        _model_error = None
        return _model


@app.on_event("startup")
def warm_model() -> None:
    global _model_error
    try:
        _get_model()
    except Exception as exc:  # service remains up so health reports setup errors clearly
        _model_error = str(exc)
        logger.exception("FracAtlas model could not be loaded")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "ready": _model is not None,
        "model": MODEL_NAME,
        "message": "Model ready." if _model is not None else "Model runtime is not ready.",
    }


def _predict(image_bytes: bytes):
    model = _get_model()
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    confidence_threshold = 0.10
    prediction = model.predict(source=image, conf=confidence_threshold, imgsz=640, device="cpu", verbose=False)[0]
    detections = []
    if prediction.boxes is not None:
        coordinates = prediction.boxes.xyxy.cpu().tolist()
        confidences = prediction.boxes.conf.cpu().tolist()
        classes = prediction.boxes.cls.cpu().tolist()
        for box, confidence, class_id in zip(coordinates, confidences, classes):
            label = prediction.names.get(int(class_id), "fracture") if isinstance(prediction.names, dict) else "fracture"
            x1, y1, x2, y2 = (max(0.0, float(v)) for v in box)
            detections.append({
                "label": str(label),
                "confidence": round(float(confidence), 4),
                "box": {
                    "x1": round(min(x1, width), 2),
                    "y1": round(min(y1, height), 2),
                    "x2": round(min(x2, width), 2),
                    "y2": round(min(y2, height), 2),
                },
            })
    return {
        "model": MODEL_NAME,
        "imageWidth": width,
        "imageHeight": height,
        "confidenceThreshold": confidence_threshold,
        "candidateRegions": detections,
        "candidateCount": len(detections),
        "interpretation": "candidate_regions_highlighted" if detections else "no_candidate_highlighted",
        "warning": "Experimental research model; this output is not a diagnosis. Obtain qualified radiology review.",
    }


@app.post("/predict")
async def predict(request: Request):
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media_type not in {"image/jpeg", "image/png"}:
        raise HTTPException(status_code=415, detail="Upload an X-ray as a JPEG or PNG image.")
    try:
        image_bytes = await request.body()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="The uploaded image is empty.")
        if len(image_bytes) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Images must be 10 MB or smaller.")
        signature_ok = image_bytes.startswith(b"\xff\xd8\xff") if media_type == "image/jpeg" else image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        if not signature_ok:
            raise HTTPException(status_code=415, detail="The image contents do not match the selected format.")
        try:
            with Image.open(BytesIO(image_bytes)) as image:
                if image.format not in {"JPEG", "PNG"}:
                    raise HTTPException(status_code=415, detail="Upload an X-ray as a JPEG or PNG image.")
                image.verify()
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
            raise HTTPException(status_code=400, detail="The uploaded image could not be read.") from exc
        return await asyncio.to_thread(_predict, image_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        if _model is None:
            logger.exception("FracAtlas inference service is unavailable")
            raise HTTPException(status_code=503, detail="The FracAtlas model is not ready. Check its Python runtime and model setup.") from exc
        logger.exception("FracAtlas inference failed")
        raise HTTPException(status_code=503, detail="Fracture analysis is temporarily unavailable.") from exc
