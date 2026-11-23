# FracAtlas Fracture Check

This optional inference service runs the original FracAtlas YOLOv8s segmentation weights on JPEG or PNG radiographs. It does not train or substitute a model. The weight file is downloaded from the authors' repository on first service start and checked against a pinned SHA-256 digest. Uploaded images are processed in memory and are not saved by this service.

## Local setup

From the repository root:

```sh
npm run setup:fracatlas
npm run dev:fracatlas
```

The first start downloads the 23.8 MB model checkpoint. The API proxies authenticated Patient requests to `http://127.0.0.1:8003` by default. Set `FRACATLAS_SERVICE_URL` in the API environment to the internal service URL when deploying separately.

## Output and limitations

The service reports model-highlighted candidate boxes and confidence values using a 10% minimum confidence cutoff to surface more candidate regions. Lower cutoffs can increase false alarms. It does not diagnose or rule out fractures. The FracAtlas paper reported 60.7% box recall for its baseline segmentation model on its validation set, so a negative result can still miss fractures. Use only for research/education and always obtain qualified radiology review. It accepts JPEG and PNG files up to 10 MB at the model service; the authenticated API caps uploads at 10 MB. DICOM and other formats are not accepted.

## Attribution and licenses

Model weights and prediction code are from [XLR8-07/FracAtlas](https://github.com/XLR8-07/FracAtlas) (MIT-licensed repository). The [FracAtlas dataset paper](https://doi.org/10.1038/s41597-023-02432-4) asks users to cite: Abedeen et al., “FracAtlas: A Dataset for Fracture Classification, Localization and Segmentation of Musculoskeletal Radiographs,” *Scientific Data* 10, 2023. The dataset is licensed CC BY 4.0. Runtime inference uses [Ultralytics](https://github.com/ultralytics/ultralytics), distributed under AGPL-3.0; review dependency and deployment obligations before redistribution or public hosting.
