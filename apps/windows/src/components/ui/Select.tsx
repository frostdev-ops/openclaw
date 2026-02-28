import { useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  label?: string;
}

export function Select({ value, onChange, options, disabled, label }: SelectProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {label && (
        <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
            }}
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
