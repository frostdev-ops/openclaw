import type { Api, Model } from "@mariozechner/pi-ai";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveContextWindowInfo } from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { setCompactionSafeguardRuntime } from "../pi-extensions/compaction-safeguard-runtime.js";
import { setContextPruningRuntime } from "../pi-extensions/context-pruning/runtime.js";
import { computeEffectiveSettings } from "../pi-extensions/context-pruning/settings.js";
import { makeToolPrunablePredicate } from "../pi-extensions/context-pruning/tools.js";
import { ensurePiCompactionReserveTokens } from "../pi-settings.js";
import { isCacheTtlEligibleProvider, readLastCacheTtlTimestamp } from "./cache-ttl.js";

function resolvePiExtensionPath(id: string): string {
  const self = fileURLToPath(import.meta.url);
  const dir = path.dirname(self);
  // In dev this file is `.ts` (tsx), in production it's `.js`.
  const ext = path.extname(self) === ".ts" ? "ts" : "js";
  return path.join(dir, "..", "pi-extensions", `${id}.${ext}`);
}

function resolveContextWindowTokens(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
}): number {
  return resolveContextWindowInfo({
    cfg: params.cfg,
    provider: params.provider,
    modelId: params.modelId,
    modelContextWindow: params.model?.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  }).tokens;
}

function buildContextPruningExtension(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
}): { additionalExtensionPaths?: string[] } {
  const raw = params.cfg?.agents?.defaults?.contextPruning;
  if (raw?.mode !== "cache-ttl") {
    return {};
  }
  if (!isCacheTtlEligibleProvider(params.provider, params.modelId)) {
    return {};
  }

  const settings = computeEffectiveSettings(raw);
  if (!settings) {
    return {};
  }

  setContextPruningRuntime(params.sessionManager, {
    settings,
    contextWindowTokens: resolveContextWindowTokens(params),
    isToolPrunable: makeToolPrunablePredicate(settings.tools),
    lastCacheTouchAt: readLastCacheTtlTimestamp(params.sessionManager),
  });

  return {
    additionalExtensionPaths: [resolvePiExtensionPath("context-pruning")],
  };
}

function resolveCompactionMode(cfg?: OpenClawConfig): "default" | "safeguard" | "tiered" | "smart" {
  const mode = cfg?.agents?.defaults?.compaction?.mode;
  if (mode === "safeguard") return "safeguard";
  if (mode === "tiered") return "tiered";
  if (mode === "smart") return "smart";
  return "default";
}

export function buildEmbeddedExtensionPaths(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: Model<Api> | undefined;
}): string[] {
  const paths: string[] = [];
  const compactionMode = resolveCompactionMode(params.cfg);
  const compactionCfg = params.cfg?.agents?.defaults?.compaction;
  const contextWindowInfo = resolveContextWindowInfo({
    cfg: params.cfg,
    provider: params.provider,
    modelId: params.modelId,
    modelContextWindow: params.model?.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  });

  if (compactionMode === "safeguard") {
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
    });
    paths.push(resolvePiExtensionPath("compaction-safeguard"));
  } else if (compactionMode === "tiered") {
    const tieredPath = compactionCfg?.tieredPath;
    if (tieredPath) {
      const resolvedPath = path.isAbsolute(tieredPath)
        ? tieredPath
        : path.join(params.cfg?.agents?.defaults?.workspace || process.cwd(), tieredPath);
      paths.push(resolvedPath);
    } else {
      const workspace = params.cfg?.agents?.defaults?.workspace || process.cwd();
      paths.push(path.join(workspace, "extensions", "tiered-compaction.js"));
    }
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
      tieredCompaction: compactionCfg?.tieredCompaction as Record<string, unknown>,
    });
  } else if (compactionMode === "smart") {
    const smartPath = compactionCfg?.smartPath;
    if (smartPath) {
      const resolvedPath = path.isAbsolute(smartPath)
        ? smartPath
        : path.join(params.cfg?.agents?.defaults?.workspace || process.cwd(), smartPath);
      paths.push(resolvedPath);
    } else {
      const workspace = params.cfg?.agents?.defaults?.workspace || process.cwd();
      paths.push(path.join(workspace, "extensions", "smart-compaction.js"));
    }
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
      smartCompaction: compactionCfg?.smartCompaction as Record<string, unknown>,
      tieredCompaction: compactionCfg?.tieredCompaction as Record<string, unknown>,
    });
  }

  const pruning = buildContextPruningExtension(params);
  if (pruning.additionalExtensionPaths) {
    paths.push(...pruning.additionalExtensionPaths);
  }
  return paths;
}

export { ensurePiCompactionReserveTokens };
