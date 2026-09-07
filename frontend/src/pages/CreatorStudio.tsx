// Creator Studio (PATHWISE 2.0 Phase 16) — DARK by default.
//
// This page renders only behind FeatureGate flag="userVideoPosting", and
// every endpoint it calls is server-gated on the same flag, so while the
// flag is off this whole surface is unreachable no matter what a client
// does. Upload → automatic analysis → review → publish.
import { useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { UploadIcon } from "../components/icons";
import {
  EmptyState,
  ErrorState,
  InlineError,
  InlineNotice,
  SkeletonRows,
} from "../components/states";

interface CreatorVideoRow {
  id: string;
  title: string;
  caption: string;
  subject: string | null;
  topics: string[];
  status: string;
  moderationStatus: string;
  visibility: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  processing: "Processing",
  pending_review: "Ready to review",
  published: "Published",
  rejected: "Rejected",
};

export default function CreatorStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, loading, error: loadError, reload } = useApi<{
    videos: CreatorVideoRow[];
  }>("/api/creator/videos");

  async function upload(file: File | undefined) {
    if (!file) return;
    if (title.trim().length < 3) {
      setError("Give the video a title first (3+ characters).");
      return;
    }
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("caption", caption);
      form.append("file", file);
      const token = localStorage.getItem("pathwise_token");
      const res = await fetch("/api/creator/videos", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new ApiError(res.status, body?.error ?? "Upload failed", body);
      }
      setTitle("");
      setCaption("");
      setNotice("Uploaded — analysis ran; review it below before publishing.");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function publish(v: CreatorVideoRow) {
    setBusy(v.id);
    setError(null);
    try {
      await api.post(`/api/creator/videos/${v.id}/publish`, {});
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(v: CreatorVideoRow) {
    if (!window.confirm("Delete this video? The file is removed too.")) return;
    setBusy(v.id);
    try {
      await api.del(`/api/creator/videos/${v.id}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Creator Studio</h1>
          <p className="page-sub">
            Share short educational videos. Everything is analyzed and
            reviewed before it can go public.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        <label className="sr-only" htmlFor="cv-title">Title</label>
        <input
          id="cv-title"
          className="input"
          placeholder="Title — what does this explain?"
          value={title}
          maxLength={140}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label className="sr-only" htmlFor="cv-caption">Caption</label>
        <textarea
          id="cv-caption"
          className="input"
          rows={2}
          placeholder="Caption — subject, topics, who it's for (helps analysis)"
          value={caption}
          maxLength={1000}
          onChange={(e) => setCaption(e.target.value)}
        />
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm"
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            className="btn btn-primary"
            disabled={busy === "upload"}
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon cls="icon" /> {busy === "upload" ? "Uploading…" : "Choose video (MP4/WebM, 25MB max)"}
          </button>
        </div>
        <InlineError message={error} />
        <InlineNotice message={notice} />
      </div>

      {loading ? (
        <SkeletonRows rows={3} height={80} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : (data?.videos.length ?? 0) === 0 ? (
        <EmptyState
          icon={<UploadIcon cls="icon-lg" />}
          title="Nothing uploaded yet"
          body="Your videos appear here with their analysis and review status."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data!.videos.map((v) => (
            <div key={v.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{v.title}</div>
                  {v.caption && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 3 }}>
                      {v.caption}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <span className="pill pill-muted" style={{ fontSize: 10.5 }}>
                      {STATUS_LABEL[v.status] ?? v.status}
                    </span>
                    <span
                      className={v.moderationStatus === "approved" ? "pill pill-coral" : "pill pill-muted"}
                      style={{ fontSize: 10.5 }}
                    >
                      Moderation: {v.moderationStatus}
                    </span>
                    {v.topics.map((t) => (
                      <span key={t} className="pill pill-muted" style={{ fontSize: 10.5 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {v.status === "pending_review" && v.moderationStatus === "approved" && (
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 12.5 }}
                      disabled={busy === v.id}
                      onClick={() => publish(v)}
                    >
                      Publish
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12.5, color: "var(--danger)" }}
                    disabled={busy === v.id}
                    onClick={() => remove(v)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
