import { useState } from "react";

interface InputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export function Input({ value, onChange, placeholder, type = "text", disabled, className, label }: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {label && (
        <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background: "var(--bg-input)",
          border: `1px solid ${focused ? "var(--border-focus)" : "var(--border-subtle)"}`,
          borderRadius: "var(--radius-sm)",
          color: "var(--text-primary)",
          padding: "7px 10px",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          outline: "none",
          width: "100%",
          transition: "border-color var(--transition-fast)",
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </div>
  );
}
