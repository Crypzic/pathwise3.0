// The one avatar renderer: profile picture (or initial) inside the user's
// chosen frame. Frame visuals live in index.css as .frame-* classes so the
// picker can show LIVE previews with the same code path.
interface AvatarProps {
  name: string;
  url?: string | null;
  frame?: string | null;
  size?: number;
}

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function Avatar({ name, url, frame, size = 40 }: AvatarProps) {
  const initial = name?.charAt(0)?.toUpperCase() || "?";
  return (
    <span
      className={`avatar-frame frame-${frame || "classic"}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {url ? (
        <img
          src={`${API_BASE}${url}`}
          alt=""
          className="avatar-img"
          onError={(e) => {
            // A broken image falls back to the initial silently.
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <span className="avatar-initial" style={{ fontSize: size * 0.38 }}>
        {initial}
      </span>
    </span>
  );
}
