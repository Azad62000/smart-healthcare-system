# Public BERT Symptom Classifier

This local FastAPI service runs `Zabihin/Symptom_to_Diagnosis` using TensorFlow. Install it with `npm run setup:symptom-classifier`, then start the workspace with `npm run dev`. The first classification downloads the model weights from Hugging Face (about 434 MB); subsequent calls use the local cache.

The Express API calls this service at `http://127.0.0.1:8002` by default. Set `SYMPTOM_CLASSIFIER_SERVICE_URL` only to a private service inside infrastructure you control. Symptom text is sent from the API to that local service and is not sent to Hugging Face for inference; Hugging Face is used only to download the public model files.

The model card says the English classifier was trained on 1,065 examples and returns one of 22 labels. It is an experimental text classifier, not a diagnostic or triage system. Its model scores are not calibrated probabilities, and the labels may be wrong or incomplete.
