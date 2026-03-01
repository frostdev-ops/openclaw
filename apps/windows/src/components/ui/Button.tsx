import { motion } from "motion/react";
import type { ReactNode } from "react";

type ButtonVariant = "primary" | "danger" | "warning" | "success" | "ghost";

interface ButtonProps {
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
  size?: "sm" | "md";
}

const VARIANT_STYLES: Record<ButtonVariant, { bg: string; hover: string; color: string }> = {
  primary:  { bg: "var(--accent)",     hover: "var(--accent-light)",  color: "#fff" },
  danger:   { bg: "#ef4444",           hover: "#f87171",              color: "#fff" },
  warning:  { bg: "#f59e0b",           hover: "#fbbf24",              color: "#000" },
  success:  { bg: "#22c55e",           hover: "#4ade80",              color: "#000" },
  ghost:    { bg: "transparent",       hover: "var(--bg-card-hover)", color: "var(--text-secondary)" },
};

export function Button({
  variant = "primary",
  onClick,
  disabled = false,
  children,
  type = "button",
  size = "md",
}: ButtonProps) {
  const v = VARIANT_STYLES[variant];
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { backgroundColor: v.hover }}
      whileTap={disabled ? {} : { scale: 0.97 }}
      transition={{ duration: 0.15 }}
      style={{
        background: v.bg,
        color: v.color,
        border: variant === "ghost" ? "1px solid var(--border-subtle)" : "none",
        borderRadius: "var(--radius-md)",
        padding: size === "sm" ? "4px 10px" : "7px 14px",
        fontSize: size === "sm" ? "12px" : "13px",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.button>
  );
}
