const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;

// --- DOM refs ---
const statusBadge = document.querySelector("#statusBadge");
const uptimeText = document.querySelector("#uptimeText");
const gatewayUrlDisplay = document.querySelector("#gatewayUrlDisplay");
const copyGatewayUrlBtn = document.querySelector("#copyGatewayUrlBtn");
const lastErrorRow = document.querySelector("#lastErrorRow");
const lastErrorText = document.querySelector("#lastErrorText");
const dismissErrorBtn = document.querySelector("#dismissErrorBtn");
const logsEl = document.querySelector("#logs");
const autoScrollEl = document.querySelector("#autoScroll");

const hostEl = document.querySelector("#host");
const portEl = document.querySelector("#port");
const tlsEl = document.querySelector("#tls");
const tlsFingerprintEl = document.querySelector("#tlsFingerprint");
const nodeIdEl = document.querySelector("#nodeId");
const displayNameEl = document.querySelector("#displayName");
const autoStartNodeEl = document.querySelector("#autoStartNode");
const autoStartLoginEl = document.querySelector("#autoStartLogin");
const useExecHostEl = document.querySelector("#useExecHost");
const execHostFallbackEl = document.querySelector("#execHostFallback");
const gatewayTokenEl = document.querySelector("#gatewayToken");
const gatewayPasswordEl = document.querySelector("#gatewayPassword");

const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const restartBtn = document.querySelector("#restartBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const saveConfigBtn = document.querySelector("#saveConfigBtn");
const clearLogsBtn = document.querySelector("#clearLogsBtn");

const approvalSection = document.querySelector("#approvalSection");
const approvalList = document.querySelector("#approvalList");

const pairingCallout = document.querySelector("#pairingCallout");
const dismissPairingBtn = document.querySelector("#dismissPairingBtn");

// --- State ---
let logLines = [];
let uptimeStart = null;
let uptimeInterval = null;
let pairingDismissed = false;

// Map of approval id -> { card element, timer interval }
const pendingApprovals = new Map();

// --- Status badge ---
const STATUS_LABELS = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  error: "Error",
};

function setStatusBadge(status) {
  const s = status || "stopped";
  statusBadge.textContent = STATUS_LABELS[s] || s;
  statusBadge.className = "status-badge " + s;
}

// --- Uptime ---
function startUptime() {
  if (uptimeInterval) { return; }
  uptimeStart = Date.now();
  uptimeInterval = setInterval(renderUptime, 1000);
  renderUptime();
}

function stopUptime() {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
  uptimeStart = null;
  uptimeText.textContent = "";
}

function renderUptime() {
  if (!uptimeStart) { return; }
  const elapsed = Math.floor((Date.now() - uptimeStart) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const sec = elapsed % 60;
  const parts = [];
  if (h > 0) { parts.push(h + "h"); }
  if (m > 0 || h > 0) { parts.push(m + "m"); }
  parts.push(sec + "s");
  uptimeText.textContent = "Uptime: " + parts.join(" ");
}

// --- Last error ---
function showLastError(errText) {
  if (errText) {
    lastErrorText.textContent = errText;
    lastErrorRow.hidden = false;
  } else {
    lastErrorRow.hidden = true;
  }
}

dismissErrorBtn.addEventListener("click", () => {
  lastErrorRow.hidden = true;
});

// --- Gateway URL copy ---
copyGatewayUrlBtn.addEventListener("click", () => {
  const url = gatewayUrlDisplay.value;
  if (url) {
    navigator.clipboard.writeText(url).catch(() => {});
  }
});

// --- Log rendering with color coding ---
function renderLogs() {
  logsEl.innerHTML = "";
  for (const line of logLines) {
    const span = document.createElement("span");
    if (line.startsWith("[stdout]")) {
      span.className = "log-stdout";
    } else if (line.startsWith("[stderr]")) {
      span.className = "log-stderr";
    } else if (line.startsWith("[ui]")) {
      span.className = "log-ui";
    }
    span.textContent = line;
    logsEl.appendChild(span);
    logsEl.appendChild(document.createTextNode("\n"));
  }
  if (autoScrollEl.checked) {
    logsEl.scrollTop = logsEl.scrollHeight;
  }
}

// --- Pairing detection ---
function checkPairingLine(line) {
  if (pairingDismissed) { return; }
  const lower = line.toLowerCase();
  if (lower.includes("pending") && lower.includes("pair")) {
    pairingCallout.hidden = false;
  }
}

dismissPairingBtn.addEventListener("click", () => {
  pairingDismissed = true;
  pairingCallout.hidden = true;
});

// --- Config form ---
function setConfigForm(config) {
  hostEl.value = config.host || "127.0.0.1";
  portEl.value = String(config.port || 18789);
  tlsEl.checked = Boolean(config.tls);
  tlsFingerprintEl.value = config.tlsFingerprint || "";
  nodeIdEl.value = config.nodeId || "";
  displayNameEl.value = config.displayName || "";
  autoStartNodeEl.checked = Boolean(config.autoStartNode);
  useExecHostEl.checked = Boolean(config.useExecHost);
  execHostFallbackEl.checked = Boolean(config.execHostFallback);
  gatewayTokenEl.value = config.gatewayToken || "";
  gatewayPasswordEl.value = config.gatewayPassword || "";
}

function readConfigForm() {
  return {
    host: hostEl.value.trim() || "127.0.0.1",
    port: Number.parseInt(portEl.value, 10) || 18789,
    tls: tlsEl.checked,
    tlsFingerprint: tlsFingerprintEl.value.trim() || null,
    nodeId: nodeIdEl.value.trim() || null,
    displayName: displayNameEl.value.trim() || null,
    autoStartNode: autoStartNodeEl.checked,
    useExecHost: useExecHostEl.checked,
    execHostFallback: execHostFallbackEl.checked,
    gatewayToken: gatewayTokenEl.value.trim() || null,
    gatewayPassword: gatewayPasswordEl.value.trim() || null,
  };
}

async function refreshConfig() {
  if (!invoke) { return; }
  const config = await invoke("get_config");
  setConfigForm(config);
}

// --- Status refresh ---
async function refreshStatus() {
  if (!invoke) {
    setStatusBadge("error");
    return;
  }
  const status = await invoke("get_status");
  const s = status.status || (status.running ? "running" : "stopped");
  setStatusBadge(s);
  gatewayUrlDisplay.value = status.gatewayUrl || "";
  showLastError(status.lastError || null);

  // Uptime management
  if (s === "running") {
    if (!uptimeInterval) { startUptime(); }
  } else {
    stopUptime();
  }

  logLines = status.logs || [];
  renderLogs();
}

// --- Commands ---
async function runCommand(command) {
  if (!invoke) { return; }
  try {
    await invoke(command);
  } catch (err) {
    logLines.push("[ui] command failed: " + String(err));
    logLines = logLines.slice(-300);
    renderLogs();
  }
  await refreshStatus();
}

startBtn.addEventListener("click", () => runCommand("start_node"));
stopBtn.addEventListener("click", () => runCommand("stop_node"));
restartBtn.addEventListener("click", () => runCommand("restart_node"));
refreshBtn.addEventListener("click", () => refreshStatus());

saveConfigBtn.addEventListener("click", async () => {
  if (!invoke) { return; }
  const config = readConfigForm();
  await invoke("set_config", { config });
  await refreshConfig();
  await refreshStatus();
});

clearLogsBtn.addEventListener("click", () => {
  logLines = [];
  renderLogs();
});

// --- Autostart login toggle ---
autoStartLoginEl.addEventListener("change", async () => {
  if (!invoke) { return; }
  if (autoStartLoginEl.checked) {
    await invoke("enable_autostart");
  } else {
    await invoke("disable_autostart");
  }
});

// --- Approval queue ---
function truncateText(text, max) {
  if (text.length <= max) { return { truncated: text, isTruncated: false }; }
  return { truncated: text.slice(0, max), isTruncated: true };
}

function addApprovalCard(approval) {
  if (pendingApprovals.has(approval.id)) { return; }

  const card = document.createElement("div");
  card.className = "approval-card";

  // Command text
  const rawCmd =
    approval.rawCommand ||
    (Array.isArray(approval.argv) ? approval.argv.join(" ") : "") ||
    "";
  const { truncated, isTruncated } = truncateText(rawCmd, 400);

  const cmdDiv = document.createElement("div");
  cmdDiv.className = "approval-command";
  const cmdText = document.createElement("span");
  cmdText.textContent = isTruncated ? truncated : rawCmd;
  cmdDiv.appendChild(cmdText);

  if (isTruncated) {
    const toggle = document.createElement("button");
    toggle.className = "show-more-toggle";
    toggle.textContent = "[Show more]";
    let expanded = false;
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      cmdText.textContent = expanded ? rawCmd : truncated;
      toggle.textContent = expanded ? "[Show less]" : "[Show more]";
      cmdDiv.classList.toggle("expanded", expanded);
    });
    cmdDiv.appendChild(toggle);
  }
  card.appendChild(cmdDiv);

  // Meta info
  const metaDiv = document.createElement("div");
  metaDiv.className = "approval-meta";
  if (approval.cwd) {
    metaDiv.innerHTML +=
      '<span><span class="meta-label">cwd:</span> ' +
      escapeHtml(approval.cwd) +
      "</span>";
  }
  if (approval.envKeys && approval.envKeys.length > 0) {
    metaDiv.innerHTML +=
      '<span><span class="meta-label">env:</span> ' +
      escapeHtml(approval.envKeys.join(", ")) +
      "</span>";
  }
  if (approval.agentId) {
    metaDiv.innerHTML +=
      '<span><span class="meta-label">agent:</span> ' +
      escapeHtml(approval.agentId) +
      "</span>";
  }
  if (approval.sessionKey) {
    metaDiv.innerHTML +=
      '<span><span class="meta-label">session:</span> ' +
      escapeHtml(approval.sessionKey) +
      "</span>";
  }
  if (metaDiv.children.length > 0) { card.appendChild(metaDiv); }

  // Countdown
  const countdownSpan = document.createElement("div");
  countdownSpan.className = "approval-countdown";
  card.appendChild(countdownSpan);

  const expiresAt = approval.expiresAtMs || 0;
  const timerId = setInterval(() => {
    const remaining = Math.max(
      0,
      Math.floor((expiresAt - Date.now()) / 1000),
    );
    countdownSpan.textContent = remaining + "s remaining";
    countdownSpan.classList.toggle("urgent", remaining < 10);
    if (remaining <= 0) {
      removeApprovalCard(approval.id);
    }
  }, 1000);

  // Buttons
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "approval-actions";

  const denyBtn = document.createElement("button");
  denyBtn.className = "btn-deny";
  denyBtn.textContent = "Deny";
  denyBtn.addEventListener("click", () =>
    decideApproval(approval.id, "deny"),
  );

  const allowOnceBtn = document.createElement("button");
  allowOnceBtn.className = "btn-allow-once";
  allowOnceBtn.textContent = "Allow Once";
  allowOnceBtn.addEventListener("click", () =>
    decideApproval(approval.id, "allow-once"),
  );

  const allowAlwaysBtn = document.createElement("button");
  allowAlwaysBtn.className = "btn-allow-always";
  allowAlwaysBtn.textContent = "Allow Always";
  allowAlwaysBtn.addEventListener("click", () =>
    decideApproval(approval.id, "allow-always"),
  );

  actionsDiv.appendChild(denyBtn);
  actionsDiv.appendChild(allowOnceBtn);
  actionsDiv.appendChild(allowAlwaysBtn);
  card.appendChild(actionsDiv);

  approvalList.appendChild(card);
  pendingApprovals.set(approval.id, { card, timerId });
  approvalSection.hidden = false;
}

function removeApprovalCard(id) {
  const entry = pendingApprovals.get(id);
  if (!entry) { return; }
  clearInterval(entry.timerId);
  entry.card.remove();
  pendingApprovals.delete(id);
  if (pendingApprovals.size === 0) {
    approvalSection.hidden = true;
  }
}

async function decideApproval(id, decision) {
  if (!invoke) { return; }
  try {
    await invoke("decide_approval", { id, decision });
  } catch (err) {
    logLines.push("[ui] approval decision failed: " + String(err));
    logLines = logLines.slice(-300);
    renderLogs();
  }
  // Card will be removed by the approval-resolved event or next refresh
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Bootstrap ---
async function bootstrap() {
  await refreshConfig();
  await refreshStatus();

  // Load autostart state
  if (invoke) {
    try {
      const autostart = await invoke("is_autostart_enabled");
      autoStartLoginEl.checked = Boolean(autostart);
    } catch {
      // command may not exist yet
    }
  }

  // Load pending approvals
  if (invoke) {
    try {
      const pending = await invoke("get_pending_approvals");
      if (Array.isArray(pending)) {
        for (const a of pending) { addApprovalCard(a); }
      }
    } catch {
      // command may not exist yet
    }
  }

  if (listen) {
    await listen("node-log", (event) => {
      const line = String(event.payload);
      logLines.push(line);
      logLines = logLines.slice(-300);
      checkPairingLine(line);
      renderLogs();
    });

    await listen("approval-pending", (event) => {
      addApprovalCard(event.payload);
    });

    await listen("approval-resolved", (event) => {
      removeApprovalCard(event.payload?.id || event.payload);
    });
  }

  setInterval(() => {
    void refreshStatus();
  }, 7000);
}

void bootstrap();
