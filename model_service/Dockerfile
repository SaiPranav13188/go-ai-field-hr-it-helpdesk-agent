FROM python:3.12-slim
RUN useradd -m -u 1000 user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH HF_HOME=/home/user/hf PYTHONUNBUFFERED=1
WORKDIR /home/user/app
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir "sentence-transformers==3.4.1" "transformers==4.48.3" "fastapi==0.115.8" "uvicorn==0.34.0"
USER user
# Bake both models into the image so a sleeping Space wakes without re-downloading 4.5 GB.
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('BAAI/bge-m3'); CrossEncoder('BAAI/bge-reranker-v2-m3')"
COPY --chown=user app.py .
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
