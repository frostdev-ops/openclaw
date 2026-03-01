import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Select";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import type { ExecPolicyConfig, AllowlistEntry } from "../tauri/types";
import {
  getExecPolicy,
  setExecPolicy,
  getExecAllowlist,
  addAllowlistEntry,
  removeAllowlistEntry,
} from "../tauri/commands";

const SECURITY_OPTIONS = [
  { value: "deny", label: "Deny — block all execution" },
  { value: "allowlist", label: "Allowlist — matched patterns only" },
  { value: "full", label: "Full — allow all commands" },
];

const ASK_OPTIONS = [
  { value: "off", label: "Off — never prompt" },
  { value: "on-miss", label: "On miss — prompt for unlisted commands" },
  { value: "always", label: "Always — prompt for every command" },
];

const ASK_FALLBACK_OPTIONS = [
  { value: "deny", label: "Deny" },
  { value: "allowlist", label: "Allowlist" },
  { value: "full", label: "Full" },
];

export function Security() {
  const [policy, setPolicy] = useState<ExecPolicyConfig | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getExecPolicy().then(setPolicy).catch(() => {});
    void getExecAllowlist().then(setAllowlist).catch(() => {});
  }, []);

  async function updatePolicy(updates: Partial<ExecPolicyConfig>) {
    if (!policy) { return; }
    const updated = { ...policy, ...updates };
    setSaving(true);
    try {
      await setExecPolicy(updated.security, updated.ask, updated.askFallback);
      setPolicy(updated);
    } catch { /* silent */ }
    setSaving(false);
  }

  async function handleAdd() {
    const trimmed = newPattern.trim();
    if (!trimmed) { return; }
    try {
      await addAllowlistEntry(trimmed);
      setNewPattern("");
      const updated = await getExecAllowlist();
      setAllowlist(updated);
    } catch { /* silent */ }
  }

  async function handleRemove(pattern: string) {
    try {
      await removeAllowlistEntry(pattern);
      const updated = await getExecAllowlist();
      setAllowlist(updated);
    } catch { /* silent */ }
  }

  if (!policy) {
    return <div style={{ color: "var(--text-muted)", padding: "20px" }}>Loading...</div>;
  }

  const securityMode = policy.security ?? "allowlist";
  const askMode = policy.ask ?? "on-miss";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }}>
      {/* Execution Policy */}
      <Card>
        <SectionLabel>Execution Policy</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Select
            label="Security mode"
            value={securityMode}
            onChange={(v) => void updatePolicy({ security: v })}
            options={SECURITY_OPTIONS}
            disabled={saving}
          />
          <Select
            label="Ask mode"
            value={askMode}
            onChange={(v) => void updatePolicy({ ask: v })}
            options={ASK_OPTIONS}
            disabled={saving}
          />
          <AnimatePresence>
            {askMode !== "off" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}
              >
                <Select
                  label="Ask fallback"
                  value={policy.askFallback ?? "deny"}
                  onChange={(v) => void updatePolicy({ askFallback: v })}
                  options={ASK_FALLBACK_OPTIONS}
                  disabled={saving}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      {/* Command Allowlist */}
      <AnimatePresence>
        {securityMode === "allowlist" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: "hidden" }}
          >
            <Card>
              <SectionLabel>Command Allowlist</SectionLabel>
              {allowlist.length === 0 ? (
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>
                  No patterns configured. Commands matching added patterns will be allowed.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "12px" }}>
                  {allowlist.map((entry) => (
                    <div
                      key={entry.pattern}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "var(--bg-input)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        padding: "6px 10px",
                      }}
                    >
                      <code style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        color: "var(--text-primary)",
                      }}>
                        {entry.pattern}
                      </code>
                      <button
                        onClick={() => void handleRemove(entry.pattern)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: "14px",
                          padding: "0 4px",
                          lineHeight: 1,
                        }}
                        title="Remove pattern"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ flex: 1 }}>
                  <Input
                    value={newPattern}
                    onChange={setNewPattern}
                    placeholder="e.g. npm, git, ls"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleAdd()}
                  disabled={!newPattern.trim()}
                >
                  Add
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info */}
      <Card>
        <SectionLabel>Security Modes</SectionLabel>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <div style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--text-primary)" }}>Deny</strong> — blocks all command execution.
          </div>
          <div style={{ marginBottom: "6px" }}>
            <strong style={{ color: "var(--text-primary)" }}>Allowlist</strong> — only allows commands matching configured patterns.
          </div>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>Full</strong> — allows all commands without restriction.
          </div>
        </div>
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
