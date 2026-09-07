# 0003 — Multimodal ingestion: images now, video when processing is async

Date: 2026-09-02
Status: accepted

## Context

PATHWISE 2.0's multimodal phase (roadmap Phases 4/7) calls for PDF, image and
video understanding. The upload pipeline currently runs synchronously inside
the upload request — a deliberate MVP call the blueprint made and the 2.0
roadmap's own acceptance criteria don't overturn for documents. Video
transcoding + transcription cannot fit inside a request/response cycle, and
the roadmap itself requires video processing to be "asynchronous and
resilient to failures".

## Decision

1. **Images ship now.** PNG/JPG/WebP uploads (photos of notes, whiteboards,
   textbook pages, slides, diagrams) are accepted alongside documents,
   validated by magic bytes like every other upload, and transcribed into
   structured text by the AI provider's new `transcribeImage` capability
   (vision on OpenAI/Gemini; deterministic pseudo-notes on mock). The
   transcription re-enters the SAME pipeline as documents — moderation
   screen, topic extraction, knowledge-map merge — so downstream features
   never know the material arrived as pixels. Images are capped at
   `MAX_IMAGE_MB` (default 8) because they travel base64-encoded to the
   provider in one request.
2. **Video is deferred until asynchronous processing exists** — which arrives
   with the hidden creator infrastructure (roadmap Phase 16), where a video
   pipeline (transcode → thumbnail → transcript → analysis) is required
   anyway. Building a second, synchronous video path now would either time
   out or force queue infrastructure the roadmap sequences later.

## Consequences

- A student can photograph handwritten notes and get a knowledge map — the
  highest-value multimodal case — with no new infrastructure.
- The `AIProvider` interface gains one method; the transcription operation is
  metered (`transcribe_image` in AIUsage) and covered by the daily budget
  caps like every other AI call.
- When video lands (Phase 16 infra), course-material video ingestion reuses
  the same "media → text → existing pipeline" shape.
