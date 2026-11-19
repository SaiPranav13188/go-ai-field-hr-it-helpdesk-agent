"""Deploy the BGE model service on Modal (serverless, scales to zero).

    modal secret create bge-service-key MODEL_SERVICE_KEY=<random key>
    modal deploy model_service/modal_app.py

Same code (app.py) and same weights as local: BAAI/bge-m3 + BAAI/bge-reranker-v2-m3, CPU.
Weights are baked into the image at build time so cold starts don't re-download 4.5 GB.
"""

from pathlib import Path

import modal

HERE = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.5.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("sentence-transformers==3.4.1", "transformers==4.48.3", "fastapi==0.115.8")
    .env({"HF_HOME": "/models", "TOKENIZERS_PARALLELISM": "false"})
    .run_commands(
        "python -c \"from sentence_transformers import SentenceTransformer, CrossEncoder; "
        "SentenceTransformer('BAAI/bge-m3'); CrossEncoder('BAAI/bge-reranker-v2-m3')\""
    )
    .add_local_file(HERE / "app.py", "/root/service/app.py")
)

app = modal.App("go-ai-field-bge-service")


@app.function(
    image=image,
    cpu=2.0,
    memory=6144,
    secrets=[modal.Secret.from_name("bge-service-key")],
    scaledown_window=120,  # stay warm 2 min after the last request, then scale to zero (no cost)
    timeout=120,
)
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def web():
    import sys

    sys.path.insert(0, "/root/service")
    from app import app as fastapi_app  # noqa: PLC0415

    return fastapi_app
