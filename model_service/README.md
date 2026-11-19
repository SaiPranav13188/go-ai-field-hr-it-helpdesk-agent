---
title: Go AI Field BGE Service
emoji: 🔎
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: BGE-M3 embeddings + bge-reranker-v2-m3 for the helpdesk demo
---

Model service for the Go AI Field HR & IT Helpdesk prototype (fictional demo data).
Serves `BAAI/bge-m3` dense embeddings and `BAAI/bge-reranker-v2-m3` scores on CPU.
Endpoints require a bearer key (Space secret `MODEL_SERVICE_KEY`).
