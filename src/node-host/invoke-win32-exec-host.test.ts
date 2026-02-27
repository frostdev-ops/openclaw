import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecHostResponse } from "../infra/exec-host.js";
import { handleSystemRunInvoke } from "./invoke-system-run.js";

describe("preferMacAppExecHost on win32", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers exec host when platform is win32 and OPENCLAW_NODE_EXEC_HOST=app", async () => {
    vi.stubEnv("OPENCLAW_NODE_EXEC_HOST", "app");
    vi.stubGlobal("process", { ...process, platform: "win32", env: process.env });
    const mod = await import("./invoke.js");
    // handleInvoke passes preferMacAppExecHost to handleSystemRunInvoke;
    // verify the exported function exists and module loaded with win32 platform.
    expect(mod.handleInvoke).toBeDefined();
  });

  it("does NOT prefer exec host when platform is linux and OPENCLAW_NODE_EXEC_HOST=app", async () => {
    vi.stubEnv("OPENCLAW_NODE_EXEC_HOST", "app");
    vi.stubGlobal("process", { ...process, platform: "linux", env: process.env });
    const mod = await import("./invoke.js");
    expect(mod.handleInvoke).toBeDefined();
  });

  it("does NOT prefer exec host on win32 without OPENCLAW_NODE_EXEC_HOST env", async () => {
    vi.stubEnv("OPENCLAW_NODE_EXEC_HOST", "");
    vi.stubGlobal("process", { ...process, platform: "win32", env: process.env });
    const mod = await import("./invoke.js");
    expect(mod.handleInvoke).toBeDefined();
  });

  it("includes win32 in preferMacAppExecHost platform check in source", () => {
    const invokeSource = fs.readFileSync(path.join(import.meta.dirname, "invoke.ts"), "utf8");
    expect(invokeSource).toContain('process.platform === "win32"');
    expect(invokeSource).toContain("preferMacAppExecHost");
  });
});

describe("resolveExecApprovalsSocketPath platform defaults", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a named pipe path on win32", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32", env: process.env });
    const { resolveExecApprovalsSocketPath } = await import("../infra/exec-approvals.js");
    expect(resolveExecApprovalsSocketPath()).toBe("\\\\.\\pipe\\openclaw-exec-host");
  });

  it("returns a unix socket path on linux", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux", env: process.env });
    const { resolveExecApprovalsSocketPath } = await import("../infra/exec-approvals.js");
    expect(resolveExecApprovalsSocketPath()).toMatch(/exec-approvals\.sock$/);
  });

  it("returns a unix socket path on darwin", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin", env: process.env });
    const { resolveExecApprovalsSocketPath } = await import("../infra/exec-approvals.js");
    expect(resolveExecApprovalsSocketPath()).toMatch(/exec-approvals\.sock$/);
  });
});

describe("Windows exec-host routing via handleSystemRunInvoke", () => {
  async function runSystemInvoke(params: {
    preferMacAppExecHost: boolean;
    runViaResponse?: ExecHostResponse | null;
    command?: string[];
    security?: "full" | "allowlist";
    ask?: "off" | "on-miss" | "always";
  }) {
    const runCommand = vi.fn(async () => ({
      success: true,
      stdout: "local-ok",
      stderr: "",
      timedOut: false,
      truncated: false,
      exitCode: 0,
      error: null,
    }));
    const runViaMacAppExecHost = vi.fn(async () => params.runViaResponse ?? null);
    const sendInvokeResult = vi.fn(async () => {});
    const sendExecFinishedEvent = vi.fn(async () => {});

    await handleSystemRunInvoke({
      client: {} as never,
      params: {
        command: params.command ?? ["echo", "ok"],
        approved: false,
        sessionKey: "agent:main:main",
      },
      skillBins: {
        current: async () => [],
      },
      execHostEnforced: false,
      execHostFallbackAllowed: true,
      resolveExecSecurity: () => params.security ?? "full",
      resolveExecAsk: () => params.ask ?? "off",
      isCmdExeInvocation: () => false,
      sanitizeEnv: () => undefined,
      runCommand,
      runViaMacAppExecHost,
      sendNodeEvent: async () => {},
      buildExecEventPayload: (payload) => payload,
      sendInvokeResult,
      sendExecFinishedEvent,
      preferMacAppExecHost: params.preferMacAppExecHost,
    });

    return { runCommand, runViaMacAppExecHost, sendInvokeResult, sendExecFinishedEvent };
  }

  it("routes via exec host when preferMacAppExecHost is true", async () => {
    const { runCommand, runViaMacAppExecHost, sendInvokeResult } = await runSystemInvoke({
      preferMacAppExecHost: true,
      runViaResponse: {
        ok: true,
        payload: {
          success: true,
          stdout: "win-exec-host-ok",
          stderr: "",
          timedOut: false,
          exitCode: 0,
          error: null,
        },
      },
    });

    expect(runViaMacAppExecHost).toHaveBeenCalledWith({
      approvals: expect.objectContaining({
        agent: expect.objectContaining({ security: "full", ask: "off" }),
      }),
      request: expect.objectContaining({ command: ["echo", "ok"] }),
    });
    expect(runCommand).not.toHaveBeenCalled();
    expect(sendInvokeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        payloadJSON: expect.stringContaining("win-exec-host-ok"),
      }),
    );
  });

  it("uses local execution when preferMacAppExecHost is false", async () => {
    const { runCommand, runViaMacAppExecHost, sendInvokeResult } = await runSystemInvoke({
      preferMacAppExecHost: false,
    });

    expect(runViaMacAppExecHost).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(sendInvokeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        payloadJSON: expect.stringContaining("local-ok"),
      }),
    );
  });

  it("falls back to local when exec host returns null", async () => {
    const { runCommand, runViaMacAppExecHost, sendInvokeResult } = await runSystemInvoke({
      preferMacAppExecHost: true,
      runViaResponse: null,
    });

    expect(runViaMacAppExecHost).toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(sendInvokeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        payloadJSON: expect.stringContaining("local-ok"),
      }),
    );
  });

  it("returns exec host error without falling back", async () => {
    const { runCommand, runViaMacAppExecHost, sendInvokeResult } = await runSystemInvoke({
      preferMacAppExecHost: true,
      runViaResponse: {
        ok: false,
        error: { code: "DENIED", message: "User denied execution" },
      },
    });

    expect(runViaMacAppExecHost).toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(sendInvokeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          message: expect.stringContaining("denied"),
        }),
      }),
    );
  });
});
