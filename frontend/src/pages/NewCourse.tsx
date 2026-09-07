// Add-a-course flow (Steps 2/3) — real upload and knowledge-map build.
//
// Files upload one at a time and each shows its own outcome. That matters
// because a single bad file (a scan with no text layer, or something that isn't
// course material) shouldn't fail the whole course — the rest still build a map.
import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { UploadIcon, FileIcon, CheckIcon, AlertIcon } from "../components/icons";
import { InlineError } from "../components/states";

type FileStatus = "queued" | "uploading" | "processed" | "rejected" | "failed";

interface QueuedFile {
  file: File;
  status: FileStatus;
  message?: string;
}

const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
// Documents parse server-side; images are transcribed by the vision provider
// (2.0 Phase 5) — a photo of notes or a whiteboard works too.
const ACCEPTED = [".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"];

function extensionOk(name: string): boolean {
  return ACCEPTED.some((ext) => name.toLowerCase().endsWith(ext));
}

export default function NewCourse() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicCount, setTopicCount] = useState<number | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);

    const incoming: QueuedFile[] = [];
    for (const file of Array.from(list)) {
      // Reject client-side for the obvious cases so the student gets an instant
      // answer instead of a round trip.
      if (!extensionOk(file.name)) {
        incoming.push({
          file,
          status: "failed",
          message:
            "Only PDF, DOCX, PPTX or an image (PNG, JPG, WebP) is supported.",
        });
        continue;
      }
      if (file.size > MAX_BYTES) {
        incoming.push({
          file,
          status: "failed",
          message: "That file is over the 25 MB limit.",
        });
        continue;
      }
      incoming.push({ file, status: "queued" });
    }

    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_FILES));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFile(index: number, patch: Partial<QueuedFile>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  async function build() {
    if (!name.trim()) {
      setError("Give your course a name first.");
      return;
    }
    const uploadable = files.filter((f) => f.status === "queued");
    if (uploadable.length === 0) {
      setError("Add at least one file — a PDF, DOCX, PPTX, or a photo of your notes.");
      return;
    }

    setBusy(true);
    setError(null);

    let courseId: string;
    try {
      const res = await api.post<{ course: { id: string } }>("/api/courses", {
        name: name.trim(),
      });
      courseId = res.course.id;
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.isCourseCap) {
        navigate("/upgrade");
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "Couldn't create the course."
      );
      return;
    }

    // Sequential rather than parallel: each upload runs a parse plus an AI call,
    // and firing ten at once is how you hit the rate limit and the cost cap at
    // the same time.
    let lastTopicCount = 0;
    let anyProcessed = false;

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "queued") continue;
      updateFile(i, { status: "uploading" });
      try {
        const res = await api.upload<{
          upload: { status: string; error: string | null };
          topicCount: number;
        }>(`/api/courses/${courseId}/uploads`, files[i].file);
        lastTopicCount = res.topicCount;
        anyProcessed = true;
        updateFile(i, {
          status: "processed",
          message: `${res.topicCount} topics in the map so far`,
        });
      } catch (err) {
        const apiErr = err instanceof ApiError ? err : null;
        // 422 = the file was readable but isn't course material (Step 15).
        updateFile(i, {
          status: apiErr?.status === 422 ? "rejected" : "failed",
          message: apiErr?.message ?? "Upload failed.",
        });
      }
    }

    setBusy(false);
    setTopicCount(lastTopicCount);

    if (anyProcessed) {
      localStorage.setItem("pathwise_last_course", courseId);
      navigate(`/courses/${courseId}`);
    } else {
      setError(
        "None of those files could be turned into a study map. The course was created — try adding different material."
      );
    }
  }

  const statusPill = (f: QueuedFile) => {
    switch (f.status) {
      case "processed":
        return (
          <span className="pill pill-mint">
            <CheckIcon cls="icon-sm" /> Ready
          </span>
        );
      case "uploading":
        return <span className="pill pill-muted">Processing…</span>;
      case "rejected":
        return <span className="pill pill-coral">Not course material</span>;
      case "failed":
        return (
          <span className="pill pill-coral">
            <AlertIcon cls="icon-sm" /> Failed
          </span>
        );
      default:
        return <span className="pill pill-muted">Queued</span>;
    }
  };

  return (
    <AppShell>
      <div className="eyebrow">Add a course</div>
      <h1 className="section-title">Upload your course materials</h1>
      <p className="section-sub">
        Upload the syllabus and slides — we'll build your study map from them.
      </p>

      <InlineError message={error} />

      <div className="field">
        <label htmlFor="course-name">Course name</label>
        <input
          id="course-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. BIO 201 — Cell Biology"
          disabled={busy}
        />
      </div>

      <div
        className={`upload-zone ${dragging ? "drag" : ""}`}
        style={{ margin: "20px 0" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="icon-circle">
          <UploadIcon cls="icon-lg" />
        </div>
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14.5 }}>
          Drop your syllabus, slides or note photos here
        </div>
        <div style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 18 }}>
          PDF, PPTX, DOCX or images (PNG, JPG, WebP) — up to {MAX_FILES} files,
          25 MB each
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => addFiles(e.target.files)}
          aria-label="Choose course material files"
        />
      </div>

      {files.map((f, i) => (
        <div
          key={`${f.file.name}-${i}`}
          className="card"
          style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}
        >
          <FileIcon cls="icon-lg" style={{ color: "var(--primary-dark)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.file.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {f.message ?? `${(f.file.size / 1024 / 1024).toFixed(1)} MB`}
            </div>
          </div>
          {statusPill(f)}
          {!busy && f.status !== "processed" && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => removeFile(i)}
              aria-label={`Remove ${f.file.name}`}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      <button
        className="btn btn-primary btn-block"
        onClick={build}
        disabled={busy}
        style={{ marginTop: 12 }}
      >
        {busy ? "Building your study map…" : "Build my study plan"}
      </button>

      {topicCount !== null && topicCount > 0 && (
        <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--ink-soft)", marginTop: 12 }}>
          Found {topicCount} topics.
        </p>
      )}
    </AppShell>
  );
}
