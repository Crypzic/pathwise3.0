import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
}

export function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  error,
  autoComplete = "current-password",
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          style={{ paddingRight: 42 }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-faint)",
            display: "flex",
            padding: 4,
          }}
        >
          {visible ? <EyeOffIcon cls="icon-sm" /> : <EyeIcon cls="icon-sm" />}
        </button>
      </div>
      {error && (
        <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>
      )}
    </div>
  );
}
