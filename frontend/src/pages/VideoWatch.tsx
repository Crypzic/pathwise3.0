import { useParams, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { BrainCircuitIcon } from "../components/icons";
import { ErrorState, SkeletonRows } from "../components/states";

export default function VideoWatch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Note: the backend does not expose a single video detail endpoint so we fetch all shelf/fyp to find it
  const shelf = useApi<any>("/api/videos");
  const fyp = useApi<any>("/api/fyp");

  const { loading, error } = shelf;

  if (loading || fyp.loading) {
     return <AppShell><SkeletonRows rows={4} height={400} /></AppShell>;
  }

  if (error) {
     return <AppShell><ErrorState message={error} onRetry={shelf.reload} /></AppShell>;
  }

  let video = shelf.data?.videos?.find((v: any) => v.id === id);
  if (!video) {
     video = fyp.data?.feed?.find((v: any) => v.id === id);
  }

  if (!video) {
     return <AppShell><ErrorState message="Video not found." onRetry={() => navigate("/videos")} /></AppShell>;
  }

  // Parse embeddable URL
  let embedUrl = video.url;
  if (embedUrl.includes("youtube.com/watch?v=")) {
      embedUrl = embedUrl.replace("youtube.com/watch?v=", "youtube.com/embed/");
      if (embedUrl.includes("&")) {
        embedUrl = embedUrl.split("&")[0];
      }
  } else if (embedUrl.includes("youtu.be/")) {
      embedUrl = embedUrl.replace("youtu.be/", "youtube.com/embed/");
      if (embedUrl.includes("?")) {
        embedUrl = embedUrl.split("?")[0];
      }
  }

  async function engage(kind: "like" | "save") {
    if (user?.isGuest) return;
    try {
      await api.post(`/api/videos/${video.id}/engage`, { kind });
      shelf.reload();
      fyp.reload();
    } catch {}
  }

  return (
    <AppShell>
      <div className="page-head">
         <button onClick={() => navigate("/videos")} className="btn btn-ghost" style={{ marginBottom: 16 }}>← Back</button>
      </div>

      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
         <h1 style={{ fontSize: 20 }}>{video.title}</h1>

         <div style={{ aspectRatio: "16/9", background: "black", borderRadius: 8, overflow: "hidden" }}>
             <iframe
               width="100%"
               height="100%"
               src={embedUrl}
               title={video.title}
               frameBorder="0"
               allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
               allowFullScreen
             />
         </div>

         <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div style={{ color: "var(--ink-soft)", fontSize: 14 }}>
               {video.creator} · {video.subject}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                {!user?.isGuest && (
                  <>
                    <button
                      className={video.likedByMe ? "pill pill-coral" : "pill pill-muted"}
                      style={{ cursor: "pointer", border: "none", fontSize: 12.5 }}
                      onClick={() => engage("like")}
                    >
                      👍 {video.likedByMe ? "Liked" : "Like"}
                    </button>
                    <button
                      className={video.savedByMe ? "pill pill-coral" : "pill pill-muted"}
                      style={{ cursor: "pointer", border: "none", fontSize: 12.5 }}
                      onClick={() => engage("save")}
                    >
                      🔖 {video.savedByMe ? "Saved" : "Save"}
                    </button>

                    <button
                       className="btn btn-primary"
                       style={{ fontSize: 12.5, padding: "4px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
                       onClick={() => navigate("/socratic", { state: { initialQuery: `Can you analyze the video ${video.title} and help me understand it?` }})}
                    >
                       <BrainCircuitIcon cls="icon-sm" /> Analyze with Socratic
                    </button>
                  </>
                )}
            </div>
         </div>
      </div>
    </AppShell>
  );
}
