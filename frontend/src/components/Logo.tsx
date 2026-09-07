// The Pathwise logo — a winding path glyph ending in a bead, tying directly
// into the quest-path motif used throughout the app. Keep this component as
// the single source of truth; don't recreate the path elsewhere.

import type { CSSProperties } from "react";

interface LogoMarkProps {
  size?: number;
  /** "light" = white glyph on the green square (default, for colored backgrounds
   *  like the sidebar mark or auth mascot). "mono" = just the glyph, no
   *  background box, colored via currentColor (for places you supply your own
   *  background, e.g. favicons handled separately). */
  variant?: "light" | "mono";
  className?: string;
  style?: CSSProperties;
}

export function LogoMark({
  size = 32,
  variant = "light",
  className,
  style,
}: LogoMarkProps) {
  if (variant === "mono") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
      >
        <path d="M7.2 17.25 L7.2 6.75 Q7.2 3.75 10.2 3.75 Q13.2 3.75 13.2 6.75 Q13.2 9.3 10.5 9.75 L7.8 10.2" />
        <circle cx="7.8" cy="10.2" r="1.1" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={{ borderRadius: size * 0.28, display: "block", ...style }}
    >
      <rect width="32" height="32" rx={size * 0.28} fill="#0E7A55" />
      <path
        d="M9.6 23 L9.6 9 Q9.6 5 13.6 5 Q17.6 5 17.6 9 Q17.6 12.4 14 13.5 L10.4 14.3"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10.4" cy="14.3" r="1.4" fill="#34D399" />
    </svg>
  );
}

interface LogoFullProps {
  height?: number;
  /** "dark" text for light backgrounds (default), "white" for dark backgrounds
   *  (e.g. the Socratic Mode header). */
  textColor?: "dark" | "white";
  className?: string;
  /** Plays a soft one-time fade+rise entrance — used on auth screens. */
  animated?: boolean;
}

export function LogoFull({
  height = 32,
  textColor = "dark",
  className,
  animated = false,
}: LogoFullProps) {
  return (
    <div
      className={`${className ?? ""} ${animated ? "logo-entrance" : ""}`.trim()}
      style={{ display: "flex", alignItems: "center", gap: 10, height }}
    >
      <LogoMark size={height} />
      <span
        style={{
          fontFamily: "'Fredoka', sans-serif",
          fontWeight: 700,
          fontSize: height * 0.6,
          color: textColor === "white" ? "#FFFFFF" : "#10201A",
        }}
      >
        Pathwise
      </span>
    </div>
  );
}
