#!/bin/bash
# Patch OpenClaw to add resolve_model hook for auto-router
# This adds a modifying hook that fires after model resolution but before agent start
# Allows plugins to override provider/model selection synchronously

set -e

# Source nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh" 2>/dev/null

# Find OpenClaw installation
OPENCLAW_DIR=""
if command -v openclaw &>/dev/null; then
    OPENCLAW_BIN=$(which openclaw)
    OPENCLAW_DIR=$(dirname "$(dirname "$OPENCLAW_BIN")")/lib/node_modules/openclaw
fi
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
    echo "ERROR: Could not find OpenClaw installation"
    exit 1
fi

REPLY_FILE="$OPENCLAW_DIR/dist/reply-DpTyb3Hh.js"

if [ ! -f "$REPLY_FILE" ]; then
    echo "ERROR: OpenClaw reply file not found at $REPLY_FILE"
    exit 1
fi

# Check if already patched
if grep -q "runResolveModel" "$REPLY_FILE"; then
    echo "✅ Already patched (resolve_model hook found)"
    exit 0
fi

# Create backup
cp "$REPLY_FILE" "${REPLY_FILE}.backup-resolve-model"
echo "📦 Backed up to ${REPLY_FILE}.backup-resolve-model"

# Patch 1: Add runResolveModel function after runBeforeAgentStart
# We insert it right after the runBeforeAgentStart function definition
REPLY_FILE_FOR_PY="$REPLY_FILE" python3 << 'PYEOF'
import re
import os

file_path = os.environ["REPLY_FILE_FOR_PY"]

with open(file_path, 'r') as f:
    content = f.read()

# === PATCH 1: Add runResolveModel function ===
# Insert after the runBeforeAgentStart function block
old_1 = '''	/**
	* Run agent_end hook.
	* Allows plugins to analyze completed conversations.
	* Runs in parallel (fire-and-forget).
	*/
	async function runAgentEnd(event, ctx) {
		return runVoidHook("agent_end", event, ctx);
	}'''

new_1 = '''	/**
	* Run resolve_model hook.
	* Allows plugins to override model selection before agent starts.
	* Runs sequentially, last non-null provider/model wins.
	*/
	async function runResolveModel(event, ctx) {
		return runModifyingHook("resolve_model", event, ctx, (acc, next) => ({
			provider: next.provider ?? acc?.provider,
			model: next.model ?? acc?.model
		}));
	}
	/**
	* Run agent_end hook.
	* Allows plugins to analyze completed conversations.
	* Runs in parallel (fire-and-forget).
	*/
	async function runAgentEnd(event, ctx) {
		return runVoidHook("agent_end", event, ctx);
	}'''

if old_1 not in content:
    print("ERROR: Could not find agent_end hook definition for Patch 1")
    exit(1)

content = content.replace(old_1, new_1, 1)
print("✅ Patch 1: Added runResolveModel function")

# === PATCH 2: Export runResolveModel from the hook runner return ===
old_2 = '''		runBeforeAgentStart,
		runAgentEnd,'''

new_2 = '''		runBeforeAgentStart,
		runResolveModel,
		runAgentEnd,'''

if old_2 not in content:
    print("ERROR: Could not find hook runner exports for Patch 2")
    exit(1)

content = content.replace(old_2, new_2, 1)
print("✅ Patch 2: Exported runResolveModel from hook runner")

# === PATCH 3: Call resolve_model hook in dispatch after model resolution ===
# Right after: provider = resolvedProvider; model = resolvedModel;
# And before: const inlineActionResult = await handleInlineActions
old_3 = '''	provider = resolvedProvider;
	model = resolvedModel;
	const inlineActionResult = await handleInlineActions({'''

new_3 = '''	provider = resolvedProvider;
	model = resolvedModel;
	if (hookRunner?.hasHooks("resolve_model")) {
		try {
			const modelHookResult = await hookRunner.runResolveModel({
				provider,
				model,
				content: typeof ctx.Body === "string" ? ctx.Body : ""
			}, {
				agentId,
				sessionKey: sessionEntry?.sessionId,
				channelId: (ctx.OriginatingChannel ?? ctx.Surface ?? ctx.Provider ?? "").toLowerCase(),
				conversationId: ctx.OriginatingTo ?? ctx.To ?? ctx.From ?? void 0
			});
			if (modelHookResult?.provider) provider = modelHookResult.provider;
			if (modelHookResult?.model) model = modelHookResult.model;
		} catch (hookErr) {
			logVerbose(`dispatch: resolve_model hook failed: ${String(hookErr)}`);
		}
	}
	const inlineActionResult = await handleInlineActions({'''

if old_3 not in content:
    print("ERROR: Could not find model resolution site for Patch 3")
    exit(1)

content = content.replace(old_3, new_3, 1)
print("✅ Patch 3: Added resolve_model hook call in dispatch")

with open(file_path, 'w') as f:
    f.write(content)

print("\n✅ All patches applied successfully!")
PYEOF

echo ""
echo "🔧 Patch complete! Restart OpenClaw for changes to take effect."
echo "   The resolve_model hook is now available for plugins."
echo ""
echo "   Plugin usage:"
echo "     api.on('resolve_model', async (event, ctx) => {"
echo "       // event: { provider, model, content }"  
echo "       // ctx: { agentId, sessionKey, channelId, conversationId }"
echo "       return { provider: 'anthropic', model: 'claude-sonnet-4-5' };"
echo "     });"
