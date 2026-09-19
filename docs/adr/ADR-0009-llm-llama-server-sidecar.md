# ADR-0009: LLM: llama.cpp llama-server sidecar; small model; planner / database / UI split

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-05, D-11, D-16), §4.10, §4.11, §5, §9

## Context
Plain-English questions must work locally at ₹0 on 8–16 GB machines. The AI is read-only in the MVP (D-11), and
nothing may be fabricated.

## Decision
- **llama.cpp `llama-server`** sidecar (pinned release) on 127.0.0.1: OpenAI-compatible chat,
  JSON-schema constrained output, prompt-prefix KV caching. CPU (AVX2) build by default; Vulkan/CUDA
  optional, chosen by a first-run micro-benchmark.
- An LLM supervisor in the backend: lazy start, memory guard (free RAM ≥ model + 1 GB), idle unload
  (10 min, or 5 min under 12 GB), health checks, crash isolation.
- Model class: 2–4B instruct, permissive licence, GGUF Q4_K_M, thinking off. Tiered by hardware. Chosen from
  WP-26 benchmark data. Downloaded with checksum verification, or side-loaded.
- **The model plans, the database answers, the UI renders.** Deterministic pre-parser → constrained
  planner emitting exactly one read-only tool call or `clarify` → zod validation → execution under the user's
  permissions → "Interpreted as" chips + DB-row cards + a templated summary. Free-text output only on
  explicit Summarize/Explain, grounding-checked. Deterministic fallback when the LLM is unavailable.
- Eval gates: ≥ 90% intent accuracy and ≥ 80% exact arguments on the pilot host before the LLM is on by default.

## Consequences
- An LLM crash never affects scraping or the API. AI is off by default below 12 GB RAM.
- Upstream moves fast, and the Windows binaries are unsigned (ADR-0014). It adds one more process.

## Alternatives considered
- node-llama-cpp in-process: a native crash or OOM kills the backend.
- Ollama: separate install and service, less control.
- ONNX Runtime GenAI / Foundry Local: attractive for NPUs but a narrower catalogue; revisit in Phase 2.
- 7–9B models: GPU tier only.
