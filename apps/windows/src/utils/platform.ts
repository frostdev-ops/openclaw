import { platform } from "@tauri-apps/plugin-os";

let cached: string | null = null;

export function getPlatform(): string {
  if (!cached) {
    try { cached = platform(); } catch { cached = "unknown"; }
  }
  return cached;
}

export function isWindows(): boolean { return getPlatform() === "windows"; }
export function isLinux(): boolean { return getPlatform() === "linux"; }
