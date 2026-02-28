import { useState, useEffect } from "react";
import { isWindows } from "../utils/platform";
import { open } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "../components/ui/Card";
import { Checkbox } from "../components/ui/Checkbox";
import { Button } from "../components/ui/Button";
import type { NodeClientConfig } from "../tauri/types";
import {
  getConfig, setConfig,
  enableAutostart, disableAutostart, isAutostartEnabled,
  getInstallPath, setInstallPath, detectInstallPath,
} from "../tauri/commands";
import { onInstallPathDetected } from "../tauri/events";

export function Settings() {
  const [config, setConfigState] = useState<NodeClientConfig | null>(null);
  const [autostartLogin, setAutostartLogin] = useState(false);
  const [installPath, setInstallPathState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);

  useEffect(() => {
    void getConfig().then((c) => setConfigState(c)).catch(() => {});
    void isAutostartEnabled().then((v) => setAutostartLogin(Boolean(v))).catch(() => {});
    void getInstallPath().then((p) => setInstallPathState(p)).catch(() => {});
    // Listen for auto-detection fired during node start
    const unlisten = onInstallPathDetected((path) => {
      setInstallPathState(path);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  async function saveConfig(updates: Partial<NodeClientConfig>) {
    if (!config) { return; }
    const updated = { ...config, ...updates };
    setSaving(true);
    try {
      await setConfig(updated);
      setConfigState(updated);
    } catch { /* silent */ }
    setSaving(false);
  }

  async function handleAutostartLoginChange(checked: boolean) {
    setAutostartLogin(checked);
    try {
      if (checked) { await enableAutostart(); }
      else { await disableAutostart(); }
    } catch { setAutostartLogin(!checked); }
  }

  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false, title: "Select OpenClaw install directory" });
    if (selected && typeof selected === "string") {
      setInstallPathState(selected);
      await setInstallPath(selected);
    }
  }

  async function handleResetInstallPath() {
    setInstallPathState(null);
    setDetectStatus(null);
    await setInstallPath(null);
  }

  async function handleAutoDetect() {
    setDetecting(true);
    setDetectStatus(null);
    try {
      const result = await detectInstallPath();
      if (result) {
        setInstallPathState(result.binDir);
        setDetectStatus(`Found via ${result.method}: ${result.binPath}`);
      } else {
        setDetectStatus("Not found. Install with: npm install -g openclaw");
      }
    } catch {
      setDetectStatus("Detection failed.");
    }
    setDetecting(false);
  }

  if (!config) {
    return <div style={{ color: "var(--text-muted)", padding: "20px" }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }}>
      {/* Startup */}
      <Card>
        <SectionLabel>Startup</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Checkbox
            checked={config.autoStartNode}
            onChange={(v) => void saveConfig({ autoStartNode: v })}
            disabled={saving}
            label="Auto-start node when app launches"
          />
          <Checkbox
            checked={autostartLogin}
            onChange={handleAutostartLoginChange}
            label={isWindows() ? "Start app on Windows login" : "Start app on login"}
          />
        </div>
      </Card>

      {/* Exec host */}
      <Card>
        <SectionLabel>Exec Host</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Checkbox
            checked={config.useExecHost}
            onChange={(v) => void saveConfig({ useExecHost: v })}
            disabled={saving}
            label="Enable exec-host (command approval bridge)"
          />
          <AnimatePresence>
            {config.useExecHost && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}
              >
                <Checkbox
                  checked={config.execHostFallback}
                  onChange={(v) => void saveConfig({ execHostFallback: v })}
                  disabled={saving}
                  label="Fall back to direct execution if exec-host is unavailable"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* Install location */}
      <Card>
        <SectionLabel>Install Location</SectionLabel>
        <div style={{ marginBottom: "12px" }}>
          <Checkbox
            checked={config.useBundledRuntime ?? true}
            onChange={(v) => void saveConfig({ useBundledRuntime: v })}
            disabled={saving}
            label="Prefer bundled Node.js runtime (if available)"
          />
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "10px" }}>
          Override the directory where the <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent-light)" }}>openclaw</code> binary is located. Leave as default to use system PATH.
        </div>
        <div
          style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            padding: "7px 10px",
            fontSize: "12px",
            fontFamily: "var(--font-mono)",
            color: installPath ? "var(--text-primary)" : "var(--text-muted)",
            marginBottom: "10px",
            minHeight: "32px",
          }}
        >
          {installPath ?? "System PATH (default)"}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={handleBrowse}>
            Browse…
          </Button>
          <Button variant="ghost" size="sm" onClick={handleAutoDetect} disabled={detecting}>
            {detecting ? "Detecting…" : "Auto-detect"}
          </Button>
          {installPath && (
            <Button variant="danger" size="sm" onClick={handleResetInstallPath}>
              Reset to Default
            </Button>
          )}
        </div>
        {detectStatus && (
          <div style={{
            marginTop: "8px",
            fontSize: "11px",
            color: detectStatus.startsWith("Found") ? "var(--accent-light)" : "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}>
            {detectStatus}
          </div>
        )}
      </Card>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "1px",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      marginBottom: "12px",
    }}>
      {children}
    </div>
  );
}
