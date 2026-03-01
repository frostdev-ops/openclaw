import { motion } from "motion/react";
import type { ReactNode, CSSProperties } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: string;
}

export function Card({ children, className, style, padding = "16px" }: CardProps) {
  return (
    <motion.div
      whileHover={{ borderColor: "rgba(15,118,110,0.4)" }}
      transition={{ duration: 0.15 }}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding,
        ...style,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
