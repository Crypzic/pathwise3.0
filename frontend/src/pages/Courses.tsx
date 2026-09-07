// Courses home (Step 3) — real data, with the free-tier cap enforced here.
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useApi } from "../lib/useApi";
import { BookIcon, PlusIcon, FlameIcon, AlertIcon } from "../components/icons";
import { EmptyState, ErrorState, SkeletonGrid } from "../components/states";

interface CourseCard {
  id: string;
  name: string;
  icon: string;
  mastery: number;
  topicCount: number;
  dueCount: number;
  streak: number;
}

interface CoursesResponse {
  courses: CourseCard[];
  meta: {
    count: number;
    cap: number | null;
    isPremium: boolean;
    atCap: boolean;
  };
}

function masteryPillClass(mastery: number): string {
  if (mastery >= 70) return "pill pill-mint";
  if (mastery >= 40) return "pill pill-green";
  return "pill pill-muted";
}

export default function Courses() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<CoursesResponse>("/api/courses");

  function openCourse(id: string) {
    // Remembered so the drawer's Study plan / Progress links have a target.
    localStorage.setItem("pathwise_last_course", id);
    navigate(`/courses/${id}`);
  }

  function addCourse() {
    if (data?.meta.atCap) {
      navigate("/upgrade");
      return;
    }
    navigate("/courses/new");
  }

  return (
    <AppShell>
      <div className="eyebrow">Your courses</div>
      <h1 className="section-title" style={{ marginBottom: 6 }}>
        What are we studying?
      </h1>

      {loading && (
        <div style={{ marginTop: 20 }}>
          <SkeletonGrid cards={3} />
        </div>
      )}

      {!loading && error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          <p style={{ color: "var(--ink-faint)", fontSize: 12.5, marginBottom: 14 }}>
            {data.meta.isPremium
              ? `${data.meta.count} ${data.meta.count === 1 ? "course" : "courses"} · Pathwise Pro`
              : `${data.meta.count} of ${data.meta.cap} courses used on the free plan`}
          </p>

          {data.courses.length === 0 ? (
            <EmptyState
              icon={<BookIcon cls="icon-lg" />}
              title="No courses yet"
              body="Add your first course and upload its syllabus or slides — Pathwise builds the study map from your own material."
              action={
                <button className="btn btn-primary" onClick={addCourse}>
                  <PlusIcon cls="icon-sm" /> Add a course
                </button>
              }
            />
          ) : (
            <div className="courses-grid">
              {data.courses.map((c) => (
                <button
                  key={c.id}
                  className="course-card"
                  onClick={() => openCourse(c.id)}
                  style={{ cursor: "pointer", textAlign: "left" }}
                >
                  <div className="course-icon">
                    <BookIcon cls="icon" />
                  </div>
                  <div className="course-name">{c.name}</div>
                  <div className="course-stats-row">
                    <span className={masteryPillClass(c.mastery)}>
                      {c.mastery}% mastery
                    </span>
                    <span
                      className="streak-badge"
                      style={{ color: "var(--accent)" }}
                      title={`${c.streak} day streak`}
                    >
                      <FlameIcon cls="icon-sm" /> {c.streak}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                    {c.topicCount === 0
                      ? "No material yet — add a file"
                      : `${c.topicCount} topics${c.dueCount > 0 ? ` · ${c.dueCount} due` : ""}`}
                  </div>
                </button>
              ))}

              <button className="add-course-card" onClick={addCourse}>
                {data.meta.atCap ? (
                  <>
                    <AlertIcon cls="icon-lg" />
                    Free plan limit reached
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-faint)" }}>
                      See Pathwise Pro
                    </span>
                  </>
                ) : (
                  <>
                    <PlusIcon cls="icon-lg" />
                    Add a course
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
