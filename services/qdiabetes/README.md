# QDiabetes-2018 Model C service

This FastAPI service ports the upstream R implementation of the original QDiabetes-2018 Model C, preserving its sex-specific coefficients, centering, transformations, interactions, baseline survival and supported ranges. The upstream QDR2018C.R source is retained in this directory for audit. Full AGPL-3.0 terms and the required ClinRisk disclaimer are in [LICENSE](LICENSE) and [COPYRIGHTS](COPYRIGHTS).

Run locally with `python -m venv .venv`, `. .venv/bin/activate`, `pip install -r requirements.txt`, then `uvicorn main:app --host 0.0.0.0 --port 8001`. The Express API forwards authenticated requests to `QDIABETES_SERVICE_URL` (default `http://127.0.0.1:8001`).

Run equivalence regression cases with `pytest -q`. Cases use exact published QDR2018C examples in the upstream README; outputs are rounded to the precision published there. The disclaimer requires checking outputs against the original calculator before clinical use. The project has not performed that live calculator comparison. The original source endpoint is no longer available, so the upstream AGPL implementation is the available calculation reference.

This algorithm is designed for UK populations and has not been validated for Indian patients. The output is a 10-year risk estimate, not a diabetes diagnosis, and must not replace clinical assessment. Townsend score refers to UK deprivation data; the model does not provide a corresponding India-specific measure.
