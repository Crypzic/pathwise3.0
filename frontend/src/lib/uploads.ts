// Upload progress helper (UX overhaul Phase 1.1). Processing happens in a
// backend background job now: POST returns 202 immediately and the frontend
// polls the per-upload status endpoint, showing real pipeline stages.
import { api } from "./api";

/** Human copy for each pipeline stage the backend reports. */
export const STAGE_LABEL: Record<string, string> = {
  pending: "Queued…",
  parsing: "Extracting text…",
  mapping: "Building knowledge map…",
  processed: "Ready",
  failed: "Failed",
  rejected: "Not study material",
};

export function stageLabel(status: string): string {
  return STAGE_LABEL[status] ?? "Processing…";
}

export function isTerminal(status: string): boolean {
  return status === "processed" || status === "failed" || status === "rejected";
}

export interface UploadOutcome {
  status: string;
  error: string | null;
  topicCount: number;
}

/**
 * Poll one upload until it reaches a terminal state, reporting each stage
 * change through onStage. Resolves with the outcome; only rejects on a
 * network-level failure (the caller shows a retry).
 */
export async function waitForUpload(
  courseId: string,
  uploadId: string,
  onStage?: (status: string) => void
): Promise<UploadOutcome> {
  // Documents parse locally in seconds; images + AI extraction can take a
  // couple of minutes on a busy provider. 5 minutes is a generous ceiling.
  const deadline = Date.now() + 5 * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const res = await api.get<{
      upload: { status: string; error: string | null };
      topicCount: number;
    }>(`/api/courses/${courseId}/uploads/${uploadId}`);
    if (res.upload.status !== last) {
      last = res.upload.status;
      onStage?.(last);
    }
    if (isTerminal(res.upload.status)) {
      return {
        status: res.upload.status,
        error: res.upload.error,
        topicCount: res.topicCount,
      };
    }
    await new Promise((r) => setTimeout(r, 1800));
  }
  return {
    status: "failed",
    error: "Processing is taking unusually long — it may still finish. Check back in a minute.",
    topicCount: 0,
  };
}
