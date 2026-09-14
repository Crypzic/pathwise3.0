// Course knowledge map (Step 2) — real topics, weights and per-topic mastery,
// plus adding more material to an existing course (Step 2 item 6).
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  FileIcon,
  CheckIcon,
  UploadIcon,
  SparklesIcon,
  PuzzleIcon,
  ChartIcon,
  AlertIcon,
} from "../components/icons";
import { Collapsible } from "../components/Collapsible";
import { StaggerContainer, StaggerItem } from "../components/motion";
import { stageLabel, waitForUpload } from "../lib/uploads";
import {
  EmptyState,
  ErrorState,
  InlineError,
  SkeletonRows,
  Spinner,
} from "../components/states";

interface Topic {
  id: string;
  name: string;
  summary: string | null;
  weight: number;
  mastery: number;
  due: boolean;
  attempted: boolean;
  // Knowledge Layer 2.0 concept structure (Phase 6).
  difficulty: number | null;
  objectives: string[];
  misconceptions: string[];
  prerequisites: string[];
  sourceRef: string | null;
}

interface Upload {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  error: string | null;
}

interface CourseResponse {
  course: {
    id: string;
    name: string;
    icon: string;
    mastery: number;
    topics: Topic[];
    uploads: Upload[];
  };
}

function emphasisLabel(weight: number): string {
  if (weight >= 0.75) return "High emphasis";
  if (weight >= 0.5) return "Medium";
  return "Light";
}

function difficultyLabel(d: number): string {
  if (d < 0.34) return "Intro";
  if (d < 0.67) return "Intermediate";
  return "Advanced";
}

/** True when the topic carries any Knowledge Layer detail worth expanding. */
function hasConceptDetail(t: Topic): boolean {
  return (
    t.objectives.length > 0 ||
    t.misconceptions.length > 0 ||
    t.prerequisites.length > 0 ||
    t.sourceRef !== null
  );
}

/** Expandable concept detail under a topic row (Knowledge Layer 2.0). */
function ConceptDetail({ t }: { t: Topic }) {
  return (
    <div style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 6, paddingTop: 8 }}>
      {t.objectives.length > 0 && (
        <div>
          <strong>You'll be able to:</strong>{" "}
          {t.objectives.join(" · ")}
        </div>
      )}
      {t.misconceptions.length > 0 && (
        <div>
          <strong>Watch out for:</strong> {t.misconceptions.join(" · ")}
        </div>
      )}
      {t.prerequisites.length > 0 && (
        <div>
          <strong>Builds on:</strong> {t.prerequisites.join(", ")}
        </div>
      )}
      {t.sourceRef && (
        <div style={{ color: "var(--ink-faint)" }}>From {t.sourceRef}</div>
      )}
    </div>
  );
}

function masteryDotColor(t: Topic): string {
  if (!t.attempted) return "var(--ink-faint)";
  if (t.mastery >= 70) return "var(--success)";
  if (t.mastery >= 40) return "var(--warning)";
  return "var(--danger)";
}

export default function CourseView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Which start action is in flight — every launch button shows a spinner
  // the moment it's tapped (UX overhaul 1.2).
  const [starting, setStarting] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<CourseResponse>(
    id ? `/api/courses/${id}` : null
  );

  async function addMaterial(file: File | undefined) {
    if (!file || !id) return;
    setUploading(true);
    setUploadStage("pending");
    setUploadError(null);
    try {
      // Upload returns immediately (202); processing happens server-side in
      // the background and we poll for staged progress.
      const res = await api.upload<{ upload: { id: string } }>(
        `/api/courses/${id}/uploads`,
        file
      );
      reload();
      const done = await waitForUpload(id, res.upload.id, setUploadStage);
      if (done.status !== "processed") {
        setUploadError(done.error ?? "Processing failed — try again.");
      }
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Couldn't add that file."
      );
    } finally {
      setUploading(false);
      setUploadStage(null);
      reload();
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeUpload(u: Upload) {
    if (!id) return;
    if (!window.confirm(`Remove ${u.filename}? Topics it contributed stay on your map.`)) {
      return;
    }
    setUploadError(null);
    try {
      await api.del(`/api/courses/${id}/uploads/${u.id}`);
      reload();
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Couldn't remove that file."
      );
    }
  }

  async function startQuiz(topicId?: string) {
    if (!id || starting) return;
    setStarting(topicId ? `quiz-${topicId}` : "quiz");
    try {
      const res = await api.post<{ sessionId: string }>("/api/quiz/sessions", {
        courseId: id,
        kind: topicId ? "practice" : "practice",
        topicId,
      });
      navigate(`/quiz/${res.sessionId}`);
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Couldn't start a quiz."
      );
      setStarting(null);
    }
  }

  async function startSocratic(topicId?: string) {
    if (!id || starting) return;
    setStarting("socratic");
    try {
      const res = await api.post<{ session: { id: string } }>(
        "/api/socratic/sessions",
        { courseId: id, topicId, origin: "course" }
      );
      navigate(`/socratic/chat/${res.session.id}`);
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Couldn't start Socratic mode."
      );
      setStarting(null);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 22, width: 180, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 24 }} />
        <SkeletonRows rows={5} />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Course not found."} onRetry={reload} />
      </AppShell>
    );
  }

  const course = data.course;

  return (
    <AppShell>
      <div className="eyebrow">{course.name}</div>
      <h1 className="section-title" style={{ marginBottom: 4 }}>
        Knowledge map
      </h1>
      <p className="section-sub">
        {course.topics.length === 0
          ? "No topics yet."
          : `${course.topics.length} topics · ${course.mastery}% mastery`}
      </p>

      <InlineError message={uploadError} />
      {uploading && uploadStage && (
        <div className="form-notice" role="status" aria-live="polite">
          {stageLabel(uploadStage)} — you can keep using Pathwise, this runs in
          the background.
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={() => navigate(`/study-plan/${course.id}`)}
        >
          Study plan
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => startQuiz()}
          disabled={course.topics.length === 0 || starting !== null}
        >
          {starting === "quiz" ? <Spinner /> : <PuzzleIcon cls="icon-sm" />}
          {starting === "quiz" ? "Starting…" : "Quiz"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => startSocratic()}
          disabled={course.topics.length === 0 || starting !== null}
        >
          {starting === "socratic" ? <Spinner /> : <SparklesIcon cls="icon-sm" />}
          {starting === "socratic" ? "Starting…" : "Socratic mode"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => navigate(`/progress/${course.id}`)}
        >
          <ChartIcon cls="icon-sm" /> Progress
        </button>
      </div>

      <Collapsible
        title={`Uploaded materials (${course.uploads.length})`}
        defaultOpen={course.topics.length === 0}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {course.uploads.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Nothing uploaded yet.
            </p>
          )}
          {course.uploads.map((u) => (
            <div
              key={u.id}
              className="card"
              style={{ display: "flex", alignItems: "center", gap: 14 }}
            >
              <FileIcon cls="icon-lg" style={{ color: "var(--primary-dark)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.filename}</div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {u.error ?? `${(u.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                </div>
              </div>
              {u.status === "processed" ? (
                <span className="pill pill-mint">
                  <CheckIcon cls="icon-sm" /> Ready
                </span>
              ) : u.status === "rejected" ? (
                <span className="pill pill-coral">Not course material</span>
              ) : u.status === "failed" ? (
                <span className="pill pill-coral">
                  <AlertIcon cls="icon-sm" /> Failed
                </span>
              ) : (
                <span className="pill pill-muted">{stageLabel(u.status)}</span>
              )}
              <button
                className="icon-btn"
                aria-label={`Remove ${u.filename}`}
                title="Remove this file"
                onClick={() => removeUpload(u)}
                style={{ width: 32, height: 32 }}
              >
                ✕
              </button>
            </div>
          ))}

          <button
            className="btn btn-ghost"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <UploadIcon cls="icon-sm" />
            {uploading ? stageLabel(uploadStage ?? "pending") : "Add more materials"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => addMaterial(e.target.files?.[0])}
            aria-label="Add another course material file"
          />
          <p style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            PDF, DOCX, PPTX — or a photo of your notes, a whiteboard or a
            slide. Adding material expands your existing map — it doesn't
            start over.
          </p>
        </div>
      </Collapsible>

      <h2 style={{ fontSize: 15, margin: "22px 0 14px 0" }}>Topics found</h2>

      {course.topics.length === 0 ? (
        <EmptyState
          icon={<UploadIcon cls="icon-lg" />}
          title="No topics yet"
          body="Upload a syllabus or slide deck and Pathwise will pull out the topics and weight them by how heavily your material emphasises each one."
          action={
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              <UploadIcon cls="icon-sm" /> Add material
            </button>
          }
        />
      ) : (
        <StaggerContainer style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {course.topics.map((t) => (
            <StaggerItem key={t.id} className="topic-row" style={{ flexWrap: "wrap" }}>
              <span
                className="heat-dot"
                style={{ background: masteryDotColor(t) }}
                aria-hidden="true"
              />
              <div className="t-main">
                <div className="t-name">
                  <Link
                    to={`/topics/${t.id}`}
                    style={{ color: "var(--ink)", textDecoration: "underline", textDecorationColor: "var(--ink-faint)", textUnderlineOffset: 3 }}
                    title="Open the full breakdown of this topic"
                  >
                    {t.name}
                  </Link>
                  {t.difficulty !== null && (
                    <span
                      className="pill pill-muted"
                      style={{ marginLeft: 8, fontSize: 10.5 }}
                    >
                      {difficultyLabel(t.difficulty)}
                    </span>
                  )}
                  <Link
                    to={`/topics/${t.id}`}
                    className="pill pill-coral"
                    style={{ marginLeft: 8, fontSize: 10.5 }}
                  >
                    Learn
                  </Link>
                </div>
                {t.summary && (
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
                    {t.summary}
                  </div>
                )}
                <div className="topic-weight" aria-hidden="true">
                  <span style={{ width: `${Math.round(t.weight * 100)}%` }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {t.due && <span className="pill pill-coral">Due</span>}
                <span className="topic-emphasis">
                  {t.attempted ? `${t.mastery}%` : emphasisLabel(t.weight)}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => startQuiz(t.id)}
                  disabled={starting !== null}
                >
                  {starting === `quiz-${t.id}` ? <Spinner size={13} /> : null}
                  {starting === `quiz-${t.id}` ? "Starting…" : "Quiz"}
                </button>
              </div>
              {hasConceptDetail(t) && (
                <div style={{ flexBasis: "100%" }}>
                  <Collapsible title="Details">
                    <ConceptDetail t={t} />
                  </Collapsible>
                </div>
              )}
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </AppShell>
  );
}
