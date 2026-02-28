interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: "13px",
        color: "var(--text-primary)",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{
          width: 15,
          height: 15,
          accentColor: "var(--accent)",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      />
      {label}
    </label>
  );
}
