// The one avatar renderer: profile picture (or initial) inside the user's
// chosen frame. Frame visuals live in index.css as .frame-* classes so the
// picker can show LIVE previews with the same code path.
import { useEffect, useState } from "react";

interface AvatarProps {
  name: string;
  url?: string | null;
  frame?: string | null;
  size?: number;
}

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function Avatar({ name, url, frame, size = 40 }: AvatarProps) {
  const initial = name?.charAt(0)?.toUpperCase() || "?";
  // A failed image falls back to the initial — but only for THIS url. The
  // old approach set display:none on the DOM node, which stuck forever: one
  // transient fetch failure (server restarting, flaky network) hid the photo
  // until a full remount, which read as "my picture disappeared".
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <span
      className={`avatar-frame frame-${frame || "classic"}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {url && !failed ? (
        <img
          src={`${API_BASE}${url}`}
          alt=""
          className="avatar-img"
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="avatar-initial" style={{ fontSize: size * 0.38 }}>
        {initial}
      </span>
    </span>
  );
}
