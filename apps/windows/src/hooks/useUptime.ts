import { useState, useEffect, useRef } from "react";

export function useUptime(running: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      if (!startRef.current) {
        startRef.current = Date.now();
      }
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startRef.current = null;
      setElapsed(0);
    }
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); }
    };
  }, [running]);

  if (!running || elapsed === 0) { return ""; }
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const parts: string[] = [];
  if (h > 0) { parts.push(`${h}h`); }
  if (m > 0 || h > 0) { parts.push(`${m}m`); }
  parts.push(`${s}s`);
  return parts.join(" ");
}
