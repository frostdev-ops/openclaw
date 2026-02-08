#!/bin/bash
#
# Patch OpenClaw for Continuous Degradation Preprocessor (v10.1)
# Wraps the streamFn to preprocess messages before every API call
#
# This is the PRIMARY context management layer - runs continuously.
# Smart compaction (extensions.js patch) is the SECONDARY layer.
#
# Usage: ./patch-degradation-hook.sh [--check] [--force]
#   --check   Only check if patches are needed (exit 0 if patched, 1 if not)
#   --force   Apply patches even if already applied
#

set -e

PATCH_VERSION="V10"
PATCH_MARKER="// DEGRADATION_PREPROCESSOR_PATCH_${PATCH_VERSION}"

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

WORKSPACE="${CLAWD_WORKSPACE:-$HOME/clawd}"

# Find the file containing the streamFn insertion point
# Supports both unbundled (attempt.js) and bundled (reply-*.js) installs
ATTEMPT_FILE="$OPENCLAW_DIR/dist/agents/pi-embedded-runner/run/attempt.js"
if [[ ! -f "$ATTEMPT_FILE" ]]; then
    # Bundled install: search dist/ for the file with the insertion point
    ATTEMPT_FILE=$(grep -rl 'activeSession\.agent\.streamFn = streamSimple' "$OPENCLAW_DIR/dist/" 2>/dev/null \
        | grep -v 'plugin-sdk' | grep -v 'extensionAPI' | head -1)
fi

if [[ -z "$ATTEMPT_FILE" || ! -f "$ATTEMPT_FILE" ]]; then
    echo "❌ Could not find streamFn insertion point in OpenClaw install at $OPENCLAW_DIR"
    exit 1
fi

echo "   Target file: $ATTEMPT_FILE"

# Check if current version is patched
check_patched() {
    grep -q "$PATCH_MARKER" "$ATTEMPT_FILE" 2>/dev/null
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
        echo "✅ Degradation preprocessor patch ($PATCH_VERSION) is applied"
        exit 0
    else
        echo "❌ Degradation preprocessor patch ($PATCH_VERSION) is NOT applied"
        exit 1
    fi
fi

if check_patched && ! $FORCE; then
    echo "✅ Degradation preprocessor patch ($PATCH_VERSION) already applied"
    exit 0
fi

echo "🔧 Applying Continuous Degradation Preprocessor patch ($PATCH_VERSION)..."
echo "   OpenClaw dir: $OPENCLAW_DIR"
echo "   Workspace: $WORKSPACE"

# Backup original (first time only)
BACKUP_FILE="${ATTEMPT_FILE}.orig"
if [[ ! -f "$BACKUP_FILE" ]]; then
    cp "$ATTEMPT_FILE" "$BACKUP_FILE"
    echo "   📋 Backed up attempt.js"
fi

# Remove any previous patch version first
ATTEMPT_FILE="$ATTEMPT_FILE" WORKSPACE="$WORKSPACE" PATCH_MARKER="$PATCH_MARKER" node << 'NODE_EOF'
const fs = require('fs');

let content = fs.readFileSync(process.env.ATTEMPT_FILE, 'utf8');

// Remove any existing degradation patches (all versions)
const patchStartRegex = /\s*\/\/ DEGRADATION_PREPROCESSOR_PATCH_V\d+[\s\S]*?\/\/ END_DEGRADATION_PATCH\n?/g;
content = content.replace(patchStartRegex, '');

// Also remove old V1 patch format (no end marker)
const oldV1Regex = /\s*\/\/ DEGRADATION_PREPROCESSOR_PATCH_V1[\s\S]*?log\.debug\('\[Degradation\] Preprocessor not available: ' \+ e\.message\);\s*\}\n?/g;
content = content.replace(oldV1Regex, '');

// Find insertion point: after "activeSession.agent.streamFn = streamSimple;"
const insertPoint = 'activeSession.agent.streamFn = streamSimple;';
if (!content.includes(insertPoint)) {
    console.error('   ❌ Could not find insertion point in attempt.js');
    process.exit(1);
}

const workspace = process.env.WORKSPACE;
const patchMarker = process.env.PATCH_MARKER;

// New patch code for v10
const patchCode = `
            ${patchMarker}
            // Wrap streamFn with continuous degradation preprocessor (v10.1)
            // This is the primary context management layer - runs on EVERY API call
            try {
                const degradationWorkspace = process.env.OPENCLAW_WORKSPACE || '${workspace}';
                const modPath = degradationWorkspace + '/extensions/continuous-degradation.js';
                const vectorModPath = degradationWorkspace + '/extensions/vector-memory.js';
                const cacheBuster = '?t=' + Date.now();
                const mod = await import(modPath + cacheBuster);
                const factory = mod.createPreprocessor || mod.default?.createPreprocessor;
                
                // Load vector memory module for semantic recall
                let vectorMemory = null;
                try {
                    const vectorMod = await import(vectorModPath + cacheBuster);
                    if (vectorMod.initVectorDb) {
                        await vectorMod.initVectorDb();
                        vectorMemory = {
                            archiveTurn: vectorMod.archiveTurn,
                            archiveTurns: vectorMod.archiveTurns,
                            searchMemory: vectorMod.searchMemory
                        };
                    }
                } catch (vmErr) {
                    log.debug('[Degradation v10] Vector memory load error (non-fatal): ' + vmErr.message);
                }
                
                if (factory) {
                    // v10.1 config: memory injection only, no decay/pruning
                    const preprocessor = factory({
                        enabled: true,
                        memoryOnlyMode: true,  // Skip decay, only do memory recall
                        usableContext: 120000,
                        pressureTiers: {
                            noAction: 0.70,    // No degradation until ~84k
                            embed: 0.80,
                            lightDecay: 0.90,
                            aggressive: 1.0
                        },
                        useDynamicPreservation: true,
                        targetTokens: 55000,
                        systemOverhead: 60000,
                        vectorMemory: vectorMemory
                    });
                    const originalStreamFn = activeSession.agent.streamFn;
                    activeSession.agent.streamFn = async function(model, context, options) {
                        const processedMessages = await preprocessor(context.messages, runAbortController.signal);
                        const processedContext = { ...context, messages: processedMessages };
                        return originalStreamFn(model, processedContext, options);
                    };
                    log.debug('[Degradation v10] Preprocessor wrapper installed');
                }
            } catch (e) {
                log.debug('[Degradation] Preprocessor load error: ' + e.message);
            }
            // END_DEGRADATION_PATCH`;

content = content.replace(insertPoint, insertPoint + patchCode);

fs.writeFileSync(process.env.ATTEMPT_FILE, content);
console.log('   ✅ Patched attempt.js');
NODE_EOF

# Verify the extension file exists
EXT_FILE="$WORKSPACE/extensions/continuous-degradation.js"
if [[ -f "$EXT_FILE" ]]; then
    # Extract version from file
    VERSION=$(grep -oP "// v\K[0-9.]+" "$EXT_FILE" | head -1 || echo "unknown")
    echo ""
    echo "✅ Continuous degradation extension found (v$VERSION)"
    echo "   Path: $EXT_FILE"
else
    echo ""
    echo "⚠️  Extension file not found at $EXT_FILE"
    echo "   The patch is applied but won't work without the extension"
fi

echo ""
echo "✅ Degradation preprocessor patch ($PATCH_VERSION) applied!"
echo ""
echo "Current settings (hardcoded in patch):"
echo "  - tokenBudget: 55k"
echo "  - pressureTiers.noAction: 0.70 (no action until ~84k context)"
echo "  - useDynamicPreservation: true (importance-based scoring)"
echo "  - systemOverhead: 60k"
echo ""
echo "Restart OpenClaw for changes to take effect:"
echo "  openclaw gateway restart"
