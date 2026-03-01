import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { Input } from "../components/ui/Input";
import { Checkbox } from "../components/ui/Checkbox";
import { PageTransition } from "../components/motion/PageTransition";
import { FadeIn } from "../components/motion/FadeIn";
import type { NodeClientConfig } from "../tauri/types";
import {
  getConfig, setConfig, importOpenclawConfig,
  enableAutostart, disableAutostart, isAutostartEnabled,
  getInstallPath, setInstallPath, detectInstallPath,
  getDeviceId,
} from "../tauri/commands";
import { onInstallPathDetected } from "../tauri/events";
import { isWindows, isLinux } from "../utils/platform";
import {
  Network,
  User,
  KeyRound,
  MonitorPlay,
  Terminal,
  FolderSearch,
  Check,
  AlertCircle,
  Download,
  Fingerprint,
} from "lucide-react";

const DEFAULT_CONFIG: NodeClientConfig = {
  host: "127.0.0.1",
  port: 18789,
  tls: false,
  tlsFingerprint: null,
  nodeId: null,
  displayName: null,
  autoStartNode: false,
  useExecHost: false,
  execHostFallback: true,
  gatewayToken: null,
  gatewayPassword: null,
  installPath: null,
  useBundledRuntime: true,
};

function autostartLabel(): string {
  if (isWindows()) {return "Start app on Windows login";}
  if (isLinux()) {return "Start app on login (XDG autostart)";}
  return "Start app on login";
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={15} className="text-primary-400 shrink-0" />
      <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400">{title}</h2>
    </div>
  );
}

export function Config() {
  const [form, setForm] = useState<NodeClientConfig>(DEFAULT_CONFIG);
  const [autostartLogin, setAutostartLogin] = useState(false);
  const [installPath, setInstallPathState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    void getConfig().then((c) => setForm(c)).catch(() => {});
    void isAutostartEnabled().then((v) => setAutostartLogin(Boolean(v))).catch(() => {});
    void getInstallPath().then((p) => setInstallPathState(p)).catch(() => {});
    void getDeviceId().then(setDeviceId).catch(() => {});
    const unlisten = onInstallPathDetected((path) => setInstallPathState(path));
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  function set<K extends keyof NodeClientConfig>(key: K, value: NodeClientConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function savePartial(updates: Partial<NodeClientConfig>) {
    const updated = { ...form, ...updates };
    setForm(updated);
    try {
      await setConfig(updated);
    } catch { /* silent — full save will surface errors */ }
  }

  async function handleAutostartLoginChange(checked: boolean) {
    setAutostartLogin(checked);
    try {
      if (checked) { await enableAutostart(); }
      else { await disableAutostart(); }
    } catch { setAutostartLogin(!checked); }
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const imported = await importOpenclawConfig();
      if (imported) {
        setForm((prev) => ({ ...prev, ...imported }));
      } else {
        setError("No gateway config found in openclaw.json");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await setConfig(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false, title: "Select OpenClaw install directory" });
    if (selected && typeof selected === "string") {
      setInstallPathState(selected);
      await setInstallPath(selected);
    }
  }

  async function handleAutoDetect() {
    setDetecting(true);
    setDetectStatus(null);
    try {
      const result = await detectInstallPath();
      if (result) {
        setInstallPathState(result.binDir);
        await setInstallPath(result.binDir);
        setDetectStatus(`Found via ${result.method}: ${result.binPath}`);
      } else {
        setDetectStatus("Not found. Install with: npm install -g openclaw");
      }
    } catch {
      setDetectStatus("Detection failed.");
    }
    setDetecting(false);
  }

  async function handleResetInstallPath() {
    setInstallPathState(null);
    setDetectStatus(null);
    await setInstallPath(null);
  }

  return (
    <PageTransition>
      <div className="max-w-2xl space-y-5">
        {/* Header */}
        <FadeIn>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-neutral-100">Configuration</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Gateway connection, identity, startup behavior, and install settings.
            </p>
          </div>
        </FadeIn>

        {/* ── Connection ─────────────────────────────────── */}
        <Card>
          <SectionHeader icon={Network} title="Connection" />
          <div className="grid grid-cols-[1fr_120px] gap-3 mb-3">
            <Input
              label="Host"
              value={form.host}
              onChange={(v) => set("host", v)}
              placeholder="127.0.0.1"
            />
            <Input
              label="Port"
              type="number"
              value={String(form.port)}
              onChange={(v) => set("port", Number(v) || 18789)}
              placeholder="18789"
            />
          </div>
          <Checkbox
            checked={form.tls}
            onChange={(v) => set("tls", v)}
            label="Use TLS"
          />
          <AnimatePresence>
            {form.tls && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-3"
              >
                <Input
                  label="TLS Fingerprint (optional)"
                  value={form.tlsFingerprint ?? ""}
                  onChange={(v) => set("tlsFingerprint", v || null)}
                  placeholder="sha256:..."
                />
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* ── Identity ───────────────────────────────────── */}
        <Card>
          <SectionHeader icon={User} title="Identity" />
          <div className="flex flex-col gap-3">
            <Input
              label="Node ID (optional)"
              value={form.nodeId ?? ""}
              onChange={(v) => set("nodeId", v || null)}
              placeholder="my-node"
            />
            <Input
              label="Display Name (optional)"
              value={form.displayName ?? ""}
              onChange={(v) => set("displayName", v || null)}
              placeholder="My Desktop"
            />
          </div>
        </Card>

        {/* ── Authentication ─────────────────────────────── */}
        <Card>
          <SectionHeader icon={KeyRound} title="Authentication" />
          <div className="flex flex-col gap-3">
            <Input
              label="Gateway Token (optional)"
              type="password"
              value={form.gatewayToken ?? ""}
              onChange={(v) => set("gatewayToken", v || null)}
            />
            <Input
              label="Gateway Password (optional)"
              type="password"
              value={form.gatewayPassword ?? ""}
              onChange={(v) => set("gatewayPassword", v || null)}
            />
          </div>
        </Card>

        {/* ── Startup ────────────────────────────────────── */}
        <Card>
          <SectionHeader icon={MonitorPlay} title="Startup" />
          <div className="flex flex-col gap-3">
            <Checkbox
              checked={form.autoStartNode}
              onChange={(v) => void savePartial({ autoStartNode: v })}
              label="Auto-start node when app launches"
            />
            <Checkbox
              checked={autostartLogin}
              onChange={(v) => void handleAutostartLoginChange(v)}
              label={autostartLabel()}
            />
          </div>
          <p className="text-xs text-neutral-600 mt-3">
            {isWindows()
              ? "Login autostart adds a registry entry under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run."
              : isLinux()
              ? "Login autostart writes a .desktop file to ~/.config/autostart/."
              : "Login autostart uses the platform-native launch mechanism."}
          </p>
        </Card>

        {/* ── Exec Host ──────────────────────────────────── */}
        <Card>
          <SectionHeader icon={Terminal} title="Exec Host" />
          <div className="flex flex-col gap-2">
            <Checkbox
              checked={form.useExecHost}
              onChange={(v) => void savePartial({ useExecHost: v })}
              label="Enable exec-host (command approval bridge)"
            />
            <AnimatePresence>
              {form.useExecHost && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden pl-1"
                >
                  <Checkbox
                    checked={form.execHostFallback}
                    onChange={(v) => void savePartial({ execHostFallback: v })}
                    label="Fall back to direct execution if exec-host is unavailable"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* ── Install Location ───────────────────────────── */}
        <Card>
          <SectionHeader icon={FolderSearch} title="Install Location" />
          <div className="mb-3">
            <Checkbox
              checked={form.useBundledRuntime ?? true}
              onChange={(v) => void savePartial({ useBundledRuntime: v })}
              label="Prefer bundled Node.js runtime (if available)"
            />
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Override the directory where the{" "}
            <code className="font-mono text-primary-300 bg-neutral-800 px-1 rounded">openclaw</code>{" "}
            binary is located. Leave as default to use system PATH.
          </p>

          {/* Current path display */}
          <div className="rounded-md bg-neutral-900 border border-neutral-700/60 px-3 py-2 text-xs font-mono mb-3 min-h-[32px]">
            <span className={installPath ? "text-neutral-200" : "text-neutral-600"}>
              {installPath ?? "System PATH (default)"}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleBrowse}>
              Browse…
            </Button>
            <Button variant="secondary" onClick={handleAutoDetect} loading={detecting}>
              <Download size={13} />
              {detecting ? "Detecting…" : "Auto-detect"}
            </Button>
            {installPath && (
              <Button variant="danger" onClick={handleResetInstallPath}>
                Reset to Default
              </Button>
            )}
          </div>

          <AnimatePresence>
            {detectStatus && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-xs font-mono mt-2 ${
                  detectStatus.startsWith("Found") ? "text-success-400" : "text-neutral-500"
                }`}
              >
                {detectStatus}
              </motion.p>
            )}
          </AnimatePresence>
        </Card>

        {/* ── Device Identity ──────────────────────────────── */}
        <FadeIn delay={0.4}>
          <Card>
            <SectionHeader icon={Fingerprint} title="Device Identity" />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500" style={{ minWidth: "80px" }}>Device ID</span>
                {deviceId ? (
                  <code className="text-xs font-mono text-neutral-200 bg-neutral-800 px-1.5 py-0.5 rounded">
                    {deviceId.slice(0, 24)}...
                  </code>
                ) : (
                  <span className="text-xs text-neutral-500">Loading...</span>
                )}
              </div>
            </div>
          </Card>
        </FadeIn>

        {/* ── Save / Import ──────────────────────────────── */}
        <div className="flex items-center gap-3 pb-4">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {saving ? "Saving…" : "Save Configuration"}
          </Button>
          <Button variant="ghost" onClick={handleImport} loading={importing}>
            {importing ? "Importing…" : "Import from OpenClaw"}
          </Button>

          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1 text-sm text-success-400"
              >
                <Check size={14} />
                Saved
              </motion.span>
            )}
          </AnimatePresence>

          {error && (
            <span className="flex items-center gap-1 text-sm text-error-400">
              <AlertCircle size={14} />
              {error}
            </span>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
