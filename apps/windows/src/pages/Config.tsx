import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Checkbox } from "../components/ui/Checkbox";
import { Button } from "../components/ui/Button";
import type { NodeClientConfig } from "../tauri/types";
import { getConfig, setConfig, importOpenclawConfig } from "../tauri/commands";

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

export function Config() {
  const [form, setForm] = useState<NodeClientConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void getConfig().then((c) => setForm(c)).catch(() => {});
  }, []);

  function set<K extends keyof NodeClientConfig>(key: K, value: NodeClientConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }}>
      <Card>
        <SectionLabel>Connection</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "10px", marginBottom: "10px" }}>
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
              style={{ overflow: "hidden", marginTop: "10px" }}
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

      <Card>
        <SectionLabel>Identity</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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

      <Card>
        <SectionLabel>Authentication</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
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

      {/* Save */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Configuration"}
        </Button>
        <Button variant="ghost" onClick={handleImport} disabled={importing}>
          {importing ? "Importing…" : "Import from OpenClaw"}
        </Button>
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: "13px", color: "var(--status-running)" }}
            >
              ✓ Saved
            </motion.span>
          )}
        </AnimatePresence>
        {error && <span style={{ fontSize: "13px", color: "var(--deny)" }}>{error}</span>}
      </div>
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
