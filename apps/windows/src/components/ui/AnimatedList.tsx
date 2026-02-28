import { AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

interface AnimatedListProps {
  children: ReactNode;
}

export function AnimatedList({ children }: AnimatedListProps) {
  return <AnimatePresence mode="popLayout">{children}</AnimatePresence>;
}
