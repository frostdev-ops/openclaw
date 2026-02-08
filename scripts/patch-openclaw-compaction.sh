#!/bin/bash
#
# Patch OpenClaw for smart compaction support (v2)
# Run this after any OpenClaw update to re-apply our custom compaction mode
#
# Supports both:
#   mode: "tiered"  (legacy, uses tiered-compaction.js)
#   mode: "smart"   (v2, uses smart-compaction.js)
#
# Usage: ./patch-openclaw-compaction.sh [--check] [--force]
#   --check   Only check if patches are needed (exit 0 if patched, 1 if not)
#   --force   Apply patches even if already applied
#

set -e

# Source nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" 2>/dev/null

# Find OpenClaw installation
OPENCLAW_DIR=""

# Try which first
if command -v openclaw &>/dev/null; then
    OPENCLAW_BIN=$(which openclaw)
    OPENCLAW_DIR=$(dirname "$(dirname "$OPENCLAW_BIN")")/lib/node_modules/openclaw
fi

# Try common locations if not found
if [[ ! -d "$OPENCLAW_DIR" ]]; then
    for dir in \
        "$HOME/.nvm/versions/node/"*/lib/node_modules/openclaw \
        "/usr/local/lib/node_modules/openclaw" \
        "/usr/lib/node_modules/openclaw"; do
        # Use glob to find any node version
        for d in $dir; do
            if [[ -d "$d" ]]; then
                OPENCLAW_DIR="$d"
                break 2
            fi
        done
    done
fi

if [[ ! -d "$OPENCLAW_DIR" ]]; then
    echo "❌ Could not find OpenClaw installation"
    exit 1
fi

EXTENSIONS_FILE="$OPENCLAW_DIR/dist/agents/pi-embedded-runner/extensions.js"
SCHEMA_FILE="$OPENCLAW_DIR/dist/config/zod-schema.agent-defaults.js"
WORKSPACE="${CLAWD_WORKSPACE:-$HOME/clawd}"

# Check if patches are already applied (look for smart mode support)
check_patched() {
    if grep -q '"smart"' "$EXTENSIONS_FILE" 2>/dev/null && \
       grep -q 'z.literal("smart")' "$SCHEMA_FILE" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Parse args
CHECK_ONLY=false
FORCE=false
for arg in "$@"; do
    case $arg in
        --check) CHECK_ONLY=true ;;
        --force) FORCE=true ;;
    esac
done

if $CHECK_ONLY; then
    if check_patched; then
        echo "✅ Smart compaction patches are applied"
        exit 0
    else
        echo "❌ Smart compaction patches are NOT applied"
        exit 1
    fi
fi

if check_patched && ! $FORCE; then
    echo "✅ Smart compaction patches already applied (use --force to reapply)"
    exit 0
fi

echo "🔧 Applying smart compaction patches to OpenClaw..."
echo "   OpenClaw dir: $OPENCLAW_DIR"

# Backup originals (first time only)
if [[ ! -f "$EXTENSIONS_FILE.orig" ]]; then
    cp "$EXTENSIONS_FILE" "$EXTENSIONS_FILE.orig"
    echo "   📋 Backed up extensions.js"
fi
if [[ ! -f "$SCHEMA_FILE.orig" ]]; then
    cp "$SCHEMA_FILE" "$SCHEMA_FILE.orig"
    echo "   📋 Backed up zod-schema.agent-defaults.js"
fi

# Patch extensions.js using node for reliable replacement
EXTENSIONS_FILE="$EXTENSIONS_FILE" WORKSPACE="$WORKSPACE" node << 'NODE_EOF'
const fs = require('fs');
const path = require('path');

let content = fs.readFileSync(process.env.EXTENSIONS_FILE, 'utf8');

// Check if already patched with smart mode
if (content.includes('"smart"')) {
    console.log('   ⏭️  extensions.js already patched');
    process.exit(0);
}

// Patterns to match - handle various states (original, tiered-patched, etc.)
// Pattern 1: Original unpatched (old format without contextWindowInfo)
const oldResolve1 = `function resolveCompactionMode(cfg) {
    return cfg?.agents?.defaults?.compaction?.mode === "safeguard" ? "safeguard" : "default";
}`;

// Pattern 2: Tiered-patched
const oldResolve2 = `function resolveCompactionMode(cfg) {
    const mode = cfg?.agents?.defaults?.compaction?.mode;
    if (mode === "safeguard") return "safeguard";
    if (mode === "tiered") return "tiered";
    return "default";
}`;

const newResolve = `function resolveCompactionMode(cfg) {
    const mode = cfg?.agents?.defaults?.compaction?.mode;
    if (mode === "safeguard") return "safeguard";
    if (mode === "tiered") return "tiered";
    if (mode === "smart") return "smart";
    return "default";
}`;

content = content.replace(oldResolve1, newResolve);
content = content.replace(oldResolve2, newResolve);

// NEW FORMAT (2026.1.x): buildEmbeddedExtensionPaths with contextWindowInfo
const newFormatBuildRegex = /export function buildEmbeddedExtensionPaths\(params\) \{[\s\S]*?if \(resolveCompactionMode\(params\.cfg\) === "safeguard"\) \{[\s\S]*?contextWindowTokens: contextWindowInfo\.tokens,[\s\S]*?\}[\s\S]*?return paths;\s*\}/;

// Pattern for old format (without contextWindowInfo)
const oldFormatBuildRegex = /export function buildEmbeddedExtensionPaths\(params\) \{[\s\S]*?if \(resolveCompactionMode\(params\.cfg\) === "safeguard"\) \{[\s\S]*?maxHistoryShare: compactionCfg\?\.maxHistoryShare,[\s\S]*?\}[\s\S]*?return paths;\s*\}/;

// Pattern for already tiered-patched
const tieredBuildRegex = /export function buildEmbeddedExtensionPaths\(params\) \{[\s\S]*?const compactionMode = resolveCompactionMode[\s\S]*?return paths;\s*\}/;

// New build function that works with 2026.1.x contextWindowInfo
const newBuildWithContext = `export function buildEmbeddedExtensionPaths(params) {
    const paths = [];
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
        // Legacy tiered mode - use tiered-compaction.js
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
            tieredCompaction: compactionCfg?.tieredCompaction,
        });
    } else if (compactionMode === "smart") {
        // Smart compaction v2 - use smart-compaction.js
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
            smartCompaction: compactionCfg?.smartCompaction,
            tieredCompaction: compactionCfg?.tieredCompaction, // Backwards compat
        });
    }
    const pruning = buildContextPruningExtension(params);
    if (pruning.additionalExtensionPaths) {
        paths.push(...pruning.additionalExtensionPaths);
    }
    return paths;
}`;

// Try new format first (2026.1.x with contextWindowInfo)
if (newFormatBuildRegex.test(content)) {
    content = content.replace(newFormatBuildRegex, newBuildWithContext);
} else if (oldFormatBuildRegex.test(content)) {
    content = content.replace(oldFormatBuildRegex, newBuildWithContext);
} else if (tieredBuildRegex.test(content)) {
    content = content.replace(tieredBuildRegex, newBuildWithContext);
} else {
    console.error('   ❌ Could not find buildEmbeddedExtensionPaths to patch');
    console.error('   Current content snippet:', content.slice(content.indexOf('buildEmbeddedExtensionPaths'), content.indexOf('buildEmbeddedExtensionPaths') + 500));
    process.exit(1);
}

fs.writeFileSync(process.env.EXTENSIONS_FILE, content);
console.log('   ✅ Patched extensions.js');
NODE_EOF

# Patch zod-schema.agent-defaults.js
SCHEMA_FILE="$SCHEMA_FILE" node << 'NODE_EOF'
const fs = require('fs');

let content = fs.readFileSync(process.env.SCHEMA_FILE, 'utf8');

// Check if already patched with smart mode
if (content.includes('z.literal("smart")')) {
    console.log('   ⏭️  zod-schema already patched');
    process.exit(0);
}

// Patch mode enum - handle various states
// Original: z.union([z.literal("default"), z.literal("safeguard")])
// Target: z.union([z.literal("default"), z.literal("safeguard"), z.literal("tiered"), z.literal("smart")])

content = content.replace(
    /mode: z\.union\(\[z\.literal\("default"\), z\.literal\("safeguard"\)\]\)\.optional\(\)/,
    'mode: z.union([z.literal("default"), z.literal("safeguard"), z.literal("tiered"), z.literal("smart")]).optional()'
);

content = content.replace(
    /mode: z\.union\(\[z\.literal\("default"\), z\.literal\("safeguard"\), z\.literal\("tiered"\)\]\)\.optional\(\)/,
    'mode: z.union([z.literal("default"), z.literal("safeguard"), z.literal("tiered"), z.literal("smart")]).optional()'
);

// New approach for 2026.1.x: Insert custom fields before the final .strict() on the compaction object
// The structure is now:
//   compaction: z.object({ ... memoryFlush: ... }).strict().optional()
// We need to add our fields inside the object before .strict()

if (!content.includes('smartPath:')) {
    // Find the memoryFlush block end and insert after it, before .strict()
    // Pattern: memoryFlush: z.object({...}).strict().optional(), followed by }) and .strict()
    const memoryFlushPattern = /(memoryFlush:\s*z\s*\.object\(\{[\s\S]*?\}\)\s*\.strict\(\)\s*\.optional\(\),?\s*\})\s*\.strict\(\)/;

    if (memoryFlushPattern.test(content)) {
        content = content.replace(memoryFlushPattern, (match, beforeStrict) => {
            // Remove trailing } from beforeStrict, add our fields, then close
            const withoutClose = beforeStrict.replace(/\}\s*$/, '');
            return `${withoutClose}
    tieredPath: z.string().optional(),
    tieredCompaction: z
        .object({
        keepLastMessages: z.number().int().positive().optional(),
        actionBulletPrompt: z.string().optional(),
    })
        .strict()
        .optional(),
    smartPath: z.string().optional(),
    smartCompaction: z
        .object({
        keepLastMessages: z.number().int().positive().optional(),
        actionBulletPrompt: z.string().optional(),
        enableBoundaryDetection: z.boolean().optional(),
        enableVectorArchive: z.boolean().optional(),
        blurbMaxTokens: z.number().int().positive().optional(),
        includeRecoveryInstructions: z.boolean().optional(),
    })
        .strict()
        .optional(),
})
    .strict()`;
        });
    } else {
        // Fallback: try to find maxHistoryShare and insert after
        const maxHistoryLine = /maxHistoryShare: z\.number\(\)\.min\(0\.1\)\.max\(0\.9\)\.optional\(\),/;
        if (maxHistoryLine.test(content)) {
            content = content.replace(maxHistoryLine, (match) => {
                return match + `
    tieredPath: z.string().optional(),
    tieredCompaction: z
        .object({
        keepLastMessages: z.number().int().positive().optional(),
        actionBulletPrompt: z.string().optional(),
    })
        .strict()
        .optional(),
    smartPath: z.string().optional(),
    smartCompaction: z
        .object({
        keepLastMessages: z.number().int().positive().optional(),
        actionBulletPrompt: z.string().optional(),
        enableBoundaryDetection: z.boolean().optional(),
        enableVectorArchive: z.boolean().optional(),
        blurbMaxTokens: z.number().int().positive().optional(),
        includeRecoveryInstructions: z.boolean().optional(),
    })
        .strict()
        .optional(),`;
            });
        }
    }
}

fs.writeFileSync(process.env.SCHEMA_FILE, content);
console.log('   ✅ Patched zod-schema.agent-defaults.js');
NODE_EOF

# Verify extension files exist
SMART_EXT="$WORKSPACE/extensions/smart-compaction.js"
TIERED_EXT="$WORKSPACE/extensions/tiered-compaction.js"

echo ""
if [[ -f "$SMART_EXT" ]]; then
    echo "✅ Smart compaction extension found: $SMART_EXT"
else
    echo "⚠️  Smart compaction extension not found at $SMART_EXT"
    echo "   Create it or set smartPath in config"
fi

if [[ -f "$TIERED_EXT" ]]; then
    echo "✅ Tiered compaction extension found: $TIERED_EXT (legacy)"
fi

echo ""
echo "✅ Smart compaction patches applied!"
echo ""
echo "To enable Smart Compaction v2, add to your config:"
echo '  compaction: {'
echo '    mode: "smart",'
echo '    smartCompaction: {'
echo '      keepLastMessages: 10,'
echo '      enableBoundaryDetection: true,'
echo '      enableVectorArchive: true,'
echo '      includeRecoveryInstructions: true'
echo '    }'
echo '  }'
echo ""
echo "Legacy tiered mode still works:"
echo '  compaction: {'
echo '    mode: "tiered",'
echo '    tieredCompaction: {'
echo '      keepLastMessages: 10'
echo '    }'
echo '  }'
echo ""
echo "Then restart: openclaw gateway restart"
