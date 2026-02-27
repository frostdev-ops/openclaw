use directories::BaseDirs;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

type HmacSha256 = Hmac<Sha256>;

const LOG_CAP: usize = 300;
const HMAC_MAX_DRIFT_MS: u64 = 60_000;
const APPROVAL_TIMEOUT_MS: u64 = 120_000;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeClientConfig {
    host: String,
    port: u16,
    tls: bool,
    tls_fingerprint: Option<String>,
    node_id: Option<String>,
    display_name: Option<String>,
    auto_start_node: bool,
    #[serde(default)]
    use_exec_host: bool,
    gateway_token: Option<String>,
    gateway_password: Option<String>,
}

impl Default for NodeClientConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 18789,
            tls: false,
            tls_fingerprint: None,
            node_id: None,
            display_name: None,
            auto_start_node: true,
            use_exec_host: false,
            gateway_token: None,
            gateway_password: None,
        }
    }
}

impl NodeClientConfig {
    fn gateway_url(&self) -> String {
        let scheme = if self.tls { "wss" } else { "ws" };
        format!("{}://{}:{}", scheme, self.host, self.port)
    }
}

// ---------------------------------------------------------------------------
// Node status
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum NodeStatus {
    Stopped,
    Starting,
    Running,
    Reconnecting,
    Disconnected,
    Error,
}

impl NodeStatus {
    fn as_str(&self) -> &'static str {
        match self {
            NodeStatus::Stopped => "stopped",
            NodeStatus::Starting => "starting",
            NodeStatus::Running => "running",
            NodeStatus::Reconnecting => "reconnecting",
            NodeStatus::Disconnected => "disconnected",
            NodeStatus::Error => "error",
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

#[derive(Default)]
struct RuntimeState {
    child: Option<Child>,
    logs: VecDeque<String>,
    last_error: Option<String>,
    node_status: Option<NodeStatus>,
}

// ---------------------------------------------------------------------------
// Approval types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalPreview {
    id: String,
    raw_command: Option<String>,
    argv: Vec<String>,
    cwd: Option<String>,
    env_keys: Vec<String>,
    agent_id: Option<String>,
    session_key: Option<String>,
    expires_at_ms: u64,
}

struct PendingApproval {
    id: String,
    preview: ApprovalPreview,
    #[allow(dead_code)]
    expires_at_ms: u64,
    tx: std::sync::mpsc::SyncSender<String>,
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

struct AppState {
    config: Mutex<NodeClientConfig>,
    runtime: Mutex<RuntimeState>,
    approval_token: Mutex<String>,
    pending_approvals: Mutex<Vec<PendingApproval>>,
}

// ---------------------------------------------------------------------------
// Status response
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeClientStatus {
    running: bool,
    status: String,
    gateway_url: String,
    last_error: Option<String>,
    logs: Vec<String>,
}

// ---------------------------------------------------------------------------
// Exec host wire types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
    #[allow(dead_code)]
    id: Option<String>,
    nonce: Option<String>,
    ts: Option<u64>,
    hmac: Option<String>,
    request_json: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecHostRequest {
    command: Vec<String>,
    raw_command: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<i64>,
    agent_id: Option<String>,
    session_key: Option<String>,
    approval_decision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecHostRunResult {
    exit_code: Option<i32>,
    timed_out: bool,
    success: bool,
    stdout: String,
    stderr: String,
    error: Option<String>,
}

#[derive(Serialize)]
struct ExecResponse {
    #[serde(rename = "type")]
    msg_type: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<ExecHostRunResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ExecErrorPayload>,
}

#[derive(Serialize)]
struct ExecErrorPayload {
    code: String,
    message: String,
}

// ---------------------------------------------------------------------------
// Approval request wire type (from node gateway)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ApprovalRequestEnvelope {
    #[serde(rename = "type")]
    msg_type: String,
    #[allow(dead_code)]
    token: Option<String>,
    id: Option<String>,
    request: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// exec-approvals.json types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct ExecApprovalsSocket {
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ExecApprovalsFile {
    version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    socket: Option<ExecApprovalsSocket>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn openclaw_dir() -> Result<PathBuf, String> {
    let base = BaseDirs::new().ok_or("unable to resolve user directories")?;
    Ok(base.home_dir().join(".openclaw"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(openclaw_dir()?.join("windows-node-client.json"))
}

fn exec_approvals_path() -> Result<PathBuf, String> {
    Ok(openclaw_dir()?.join("exec-approvals.json"))
}

fn exec_host_socket_path() -> String {
    #[cfg(target_os = "windows")]
    {
        r"\\.\pipe\openclaw-exec-host".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let base = BaseDirs::new().map(|b| b.home_dir().to_path_buf());
        match base {
            Some(home) => home
                .join(".openclaw")
                .join("exec-approvals.sock")
                .to_string_lossy()
                .to_string(),
            None => "/tmp/openclaw-exec-approvals.sock".to_string(),
        }
    }
}

fn load_config() -> NodeClientConfig {
    let path = match config_path() {
        Ok(path) => path,
        Err(_) => return NodeClientConfig::default(),
    };
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return NodeClientConfig::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_config(config: &NodeClientConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let payload = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, format!("{}\n", payload)).map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// exec-approvals.json helpers
// ---------------------------------------------------------------------------

fn merge_exec_approvals_socket(
    file_path: &Path,
    socket_path: &str,
    token: &str,
) -> Result<(), String> {
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file: ExecApprovalsFile = if file_path.exists() {
        let raw = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(ExecApprovalsFile {
            version: 1,
            socket: None,
            extra: HashMap::new(),
        })
    } else {
        ExecApprovalsFile {
            version: 1,
            socket: None,
            extra: HashMap::new(),
        }
    };

    file.socket = Some(ExecApprovalsSocket {
        path: Some(socket_path.to_string()),
        token: Some(token.to_string()),
    });

    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;

    // Atomic write: temp file + rename
    let tmp_path = file_path.with_extension("json.tmp");
    fs::write(&tmp_path, format!("{}\n", json)).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, file_path).map_err(|e| e.to_string())?;

    Ok(())
}

fn clear_exec_approvals_socket(file_path: &Path) -> Result<(), String> {
    if !file_path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let mut file: ExecApprovalsFile =
        serde_json::from_str(&raw).unwrap_or(ExecApprovalsFile {
            version: 1,
            socket: None,
            extra: HashMap::new(),
        });

    file.socket = Some(ExecApprovalsSocket {
        path: None,
        token: None,
    });

    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    let tmp_path = file_path.with_extension("json.tmp");
    fs::write(&tmp_path, format!("{}\n", json)).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, file_path).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HMAC validation
// ---------------------------------------------------------------------------

fn validate_hmac(token: &str, nonce: &str, ts: u64, request_json: &str, expected: &str) -> bool {
    let Ok(mut mac) = HmacSha256::new_from_slice(token.as_bytes()) else {
        return false;
    };
    mac.update(format!("{}:{}:{}", nonce, ts, request_json).as_bytes());
    let computed = hex::encode(mac.finalize().into_bytes());
    // Constant-time comparison via hmac crate not directly available on hex strings;
    // use a simple byte-wise check. The token is random so timing leaks are acceptable.
    computed == expected
}

// ---------------------------------------------------------------------------
// Logging / process state
// ---------------------------------------------------------------------------

fn push_log_line(app: &AppHandle, line: impl Into<String>) {
    let text = line.into();
    {
        let state = app.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            if runtime.logs.len() >= LOG_CAP {
                runtime.logs.pop_front();
            }
            runtime.logs.push_back(text.clone());
        }
    }
    let _ = app.emit("node-log", text);
}

fn spawn_log_reader<R>(app: AppHandle, reader: R, stream_name: &'static str)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines() {
            match line {
                Ok(text) => {
                    // Parse node status from log lines
                    update_node_status_from_log(&app, &text);
                    push_log_line(&app, format!("[{}] {}", stream_name, text));
                }
                Err(_) => break,
            }
        }
    });
}

fn update_node_status_from_log(app: &AppHandle, line: &str) {
    let lower = line.to_lowercase();
    let new_status = if lower.contains("connected to gateway") || lower.contains("node is running")
    {
        Some(NodeStatus::Running)
    } else if lower.contains("reconnecting") {
        Some(NodeStatus::Reconnecting)
    } else if lower.contains("disconnected") {
        Some(NodeStatus::Disconnected)
    } else if lower.contains("error") || lower.contains("fatal") {
        Some(NodeStatus::Error)
    } else {
        None
    };

    if let Some(status) = new_status {
        let state = app.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.node_status = Some(status.clone());
        }
        let _ = app.emit("node-status-changed", status.as_str());
    }
}

fn refresh_process_state(runtime: &mut RuntimeState) -> (bool, Option<String>) {
    let Some(child) = runtime.child.as_mut() else {
        return (false, None);
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            runtime.child = None;
            runtime.node_status = Some(NodeStatus::Stopped);
            if status.success() {
                runtime.last_error = None;
                (false, Some("node host exited cleanly".to_string()))
            } else {
                let msg = format!("node host exited with status {}", status);
                runtime.last_error = Some(msg.clone());
                runtime.node_status = Some(NodeStatus::Error);
                (false, Some(msg))
            }
        }
        Ok(None) => (true, None),
        Err(err) => {
            let msg = format!("failed to inspect node host process: {}", err);
            runtime.child = None;
            runtime.last_error = Some(msg.clone());
            runtime.node_status = Some(NodeStatus::Error);
            (false, Some(msg))
        }
    }
}

// ---------------------------------------------------------------------------
// Node process management
// ---------------------------------------------------------------------------

fn start_node_internal(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
        let (running, maybe_exit_log) = refresh_process_state(&mut runtime);
        if let Some(exit_log) = maybe_exit_log {
            drop(runtime);
            push_log_line(app, exit_log);
            let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
            if runtime.child.is_some() {
                return Ok(());
            }
            let (running_again, _) = refresh_process_state(&mut runtime);
            if running_again {
                return Ok(());
            }
        } else if running {
            return Ok(());
        }
    }

    // Set status to starting
    {
        let state = app.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.node_status = Some(NodeStatus::Starting);
        }
    }
    let _ = app.emit("node-status-changed", NodeStatus::Starting.as_str());

    let config = {
        let state = app.state::<AppState>();
        state.config.lock().map_err(|err| err.to_string())?.clone()
    };

    let mut command = Command::new("openclaw");
    command
        .arg("node")
        .arg("run")
        .arg("--host")
        .arg(config.host.clone())
        .arg("--port")
        .arg(config.port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if config.tls {
        command.arg("--tls");
    }
    if let Some(fp) = config.tls_fingerprint.as_ref() {
        let trimmed = fp.trim();
        if !trimmed.is_empty() {
            command.arg("--tls-fingerprint").arg(trimmed);
        }
    }
    if let Some(node_id) = config.node_id.as_ref() {
        let trimmed = node_id.trim();
        if !trimmed.is_empty() {
            command.arg("--node-id").arg(trimmed);
        }
    }
    if let Some(display_name) = config.display_name.as_ref() {
        let trimmed = display_name.trim();
        if !trimmed.is_empty() {
            command.arg("--display-name").arg(trimmed);
        }
    }

    // Inject exec-host env var if configured
    if config.use_exec_host {
        command.env("OPENCLAW_NODE_EXEC_HOST", "app");
    }
    if let Some(ref token) = config.gateway_token {
        if !token.is_empty() {
            command.env("OPENCLAW_GATEWAY_TOKEN", token);
        }
    }
    if let Some(ref password) = config.gateway_password {
        if !password.is_empty() {
            command.env("OPENCLAW_GATEWAY_PASSWORD", password);
        }
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("failed to start `openclaw node run`: {}", err))?;

    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(app.clone(), stdout, "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(app.clone(), stderr, "stderr");
    }

    {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
        runtime.child = Some(child);
        runtime.last_error = None;
    }

    push_log_line(
        app,
        format!("started node host for gateway {}", config.gateway_url()),
    );
    Ok(())
}

fn stop_node_internal(app: &AppHandle) -> Result<(), String> {
    let mut maybe_child = {
        let state = app.state::<AppState>();
        let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
        let (running, maybe_exit_log) = refresh_process_state(&mut runtime);
        if let Some(exit_log) = maybe_exit_log {
            drop(runtime);
            push_log_line(app, exit_log);
            let state = app.state::<AppState>();
            let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
            let (running_again, _) = refresh_process_state(&mut runtime);
            if !running_again {
                None
            } else {
                runtime.child.take()
            }
        } else if !running {
            None
        } else {
            runtime.child.take()
        }
    };

    if let Some(child) = maybe_child.as_mut() {
        child
            .kill()
            .map_err(|err| format!("failed to stop node host: {}", err))?;
        let _ = child.wait();
        push_log_line(app, "stopped node host process");
    }

    {
        let state = app.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.node_status = Some(NodeStatus::Stopped);
        }
    }
    let _ = app.emit("node-status-changed", NodeStatus::Stopped.as_str());
    Ok(())
}

fn restart_node_internal(app: &AppHandle) -> Result<(), String> {
    stop_node_internal(app)?;
    start_node_internal(app)
}

// ---------------------------------------------------------------------------
// Command execution (for exec-host)
// ---------------------------------------------------------------------------

async fn run_exec_command(
    argv: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    timeout_ms: Option<i64>,
) -> ExecHostRunResult {
    if argv.is_empty() {
        return ExecHostRunResult {
            exit_code: None,
            timed_out: false,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some("empty command".to_string()),
        };
    }

    let mut cmd = tokio::process::Command::new(&argv[0]);
    if argv.len() > 1 {
        cmd.args(&argv[1..]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(ref env_map) = env {
        for (key, value) in env_map {
            cmd.env(key, value);
        }
    }

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ExecHostRunResult {
                exit_code: None,
                timed_out: false,
                success: false,
                stdout: String::new(),
                stderr: String::new(),
                error: Some(format!("spawn error: {}", e)),
            };
        }
    };

    let timeout = std::time::Duration::from_millis(
        timeout_ms
            .and_then(|ms| if ms > 0 { Some(ms as u64) } else { None })
            .unwrap_or(120_000),
    );

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let code = output.status.code();
            ExecHostRunResult {
                exit_code: code,
                timed_out: false,
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                error: None,
            }
        }
        Ok(Err(e)) => ExecHostRunResult {
            exit_code: None,
            timed_out: false,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(format!("wait error: {}", e)),
        },
        Err(_) => ExecHostRunResult {
            exit_code: None,
            timed_out: true,
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            error: Some("command timed out".to_string()),
        },
    }
}

fn make_error_response(code: &str, message: &str) -> String {
    let resp = ExecResponse {
        msg_type: "exec-res".to_string(),
        ok: false,
        payload: None,
        error: Some(ExecErrorPayload {
            code: code.to_string(),
            message: message.to_string(),
        }),
    };
    serde_json::to_string(&resp).unwrap_or_default()
}

fn make_success_response(result: ExecHostRunResult) -> String {
    let resp = ExecResponse {
        msg_type: "exec-res".to_string(),
        ok: true,
        payload: Some(result),
        error: None,
    };
    serde_json::to_string(&resp).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Socket handler — processes a single connection
// ---------------------------------------------------------------------------

async fn handle_socket_connection<S>(stream: S, app: AppHandle, token: String)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = tokio::io::BufReader::new(reader).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }

        let response = process_socket_line(&trimmed, &app, &token).await;
        let out = format!("{}\n", response);
        if writer.write_all(out.as_bytes()).await.is_err() {
            break;
        }
    }
}

async fn process_socket_line(line: &str, app: &AppHandle, token: &str) -> String {
    // Try parsing as exec envelope first
    if let Ok(envelope) = serde_json::from_str::<ExecEnvelope>(line) {
        if envelope.msg_type == "exec" {
            return handle_exec_message(envelope, app, token).await;
        }
    }

    // Try parsing as approval request envelope
    if let Ok(envelope) = serde_json::from_str::<ApprovalRequestEnvelope>(line) {
        if envelope.msg_type == "request" {
            return handle_approval_request(envelope, app).await;
        }
    }

    make_error_response("unknown-type", "unrecognized message type")
}

async fn handle_exec_message(envelope: ExecEnvelope, app: &AppHandle, token: &str) -> String {
    // Validate required fields
    let nonce = match envelope.nonce {
        Some(ref n) if !n.is_empty() => n.as_str(),
        _ => return make_error_response("missing-nonce", "nonce is required"),
    };
    let ts = match envelope.ts {
        Some(t) => t,
        None => return make_error_response("missing-ts", "ts is required"),
    };
    let hmac_hex = match envelope.hmac {
        Some(ref h) if !h.is_empty() => h.as_str(),
        _ => return make_error_response("missing-hmac", "hmac is required"),
    };
    let request_json = match envelope.request_json {
        Some(ref rj) if !rj.is_empty() => rj.as_str(),
        _ => return make_error_response("missing-request", "requestJson is required"),
    };

    // Validate timestamp drift
    let current = now_ms();
    let drift = if current > ts {
        current - ts
    } else {
        ts - current
    };
    if drift > HMAC_MAX_DRIFT_MS {
        return make_error_response("expired", "timestamp drift exceeds 60s");
    }

    // Validate HMAC
    if !validate_hmac(token, nonce, ts, request_json, hmac_hex) {
        return make_error_response("hmac-mismatch", "HMAC validation failed");
    }

    // Parse the inner request
    let request: ExecHostRequest = match serde_json::from_str(request_json) {
        Ok(r) => r,
        Err(e) => return make_error_response("bad-request", &format!("invalid requestJson: {}", e)),
    };

    // If approval_decision is provided, run directly
    if let Some(ref decision) = request.approval_decision {
        if decision == "allow-once" || decision == "allow-always" {
            let result = run_exec_command(
                request.command,
                request.cwd,
                request.env,
                request.timeout_ms,
            )
            .await;
            return make_success_response(result);
        }
    }

    // Otherwise, go through approval flow
    let approval_id = uuid_v4();
    let expires = now_ms() + APPROVAL_TIMEOUT_MS;

    let preview = ApprovalPreview {
        id: approval_id.clone(),
        raw_command: request.raw_command.clone(),
        argv: request.command.clone(),
        cwd: request.cwd.clone(),
        env_keys: request
            .env
            .as_ref()
            .map(|e| e.keys().cloned().collect())
            .unwrap_or_default(),
        agent_id: request.agent_id.clone(),
        session_key: request.session_key.clone(),
        expires_at_ms: expires,
    };

    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(1);

    let pending = PendingApproval {
        id: approval_id.clone(),
        preview: preview.clone(),
        expires_at_ms: expires,
        tx,
    };

    // Add to pending and emit event
    {
        let state = app.state::<AppState>();
        if let Ok(mut approvals) = state.pending_approvals.lock() {
            approvals.push(pending);
        }
    }
    let _ = app.emit("approval-pending", &preview);

    // Wait for decision with timeout
    let timeout_duration = std::time::Duration::from_millis(APPROVAL_TIMEOUT_MS);
    let decision = match rx.recv_timeout(timeout_duration) {
        Ok(d) => d,
        Err(_) => "deny".to_string(),
    };

    // Remove from pending
    {
        let state = app.state::<AppState>();
        if let Ok(mut approvals) = state.pending_approvals.lock() {
            approvals.retain(|a| a.id != approval_id);
        }
    }

    // Emit resolved event
    let _ = app.emit(
        "approval-resolved",
        serde_json::json!({
            "id": approval_id,
            "decision": decision,
        }),
    );

    if decision == "deny" {
        return make_error_response("denied", "execution denied by user");
    }

    // Run the command
    let result = run_exec_command(
        request.command,
        request.cwd,
        request.env,
        request.timeout_ms,
    )
    .await;
    make_success_response(result)
}

async fn handle_approval_request(envelope: ApprovalRequestEnvelope, app: &AppHandle) -> String {
    let req_id = envelope.id.unwrap_or_else(uuid_v4);
    let request = envelope.request.unwrap_or(serde_json::Value::Null);

    let command = request
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let command_argv: Vec<String> = request
        .get("commandArgv")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let cwd = request
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let agent_id = request
        .get("agentId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let session_key = request
        .get("sessionKey")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let env_keys: Vec<String> = request
        .get("envKeys")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let expires = now_ms() + APPROVAL_TIMEOUT_MS;
    let preview = ApprovalPreview {
        id: req_id.clone(),
        raw_command: Some(command),
        argv: command_argv,
        cwd,
        env_keys,
        agent_id,
        session_key,
        expires_at_ms: expires,
    };

    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(1);

    let pending = PendingApproval {
        id: req_id.clone(),
        preview: preview.clone(),
        expires_at_ms: expires,
        tx,
    };

    {
        let state = app.state::<AppState>();
        if let Ok(mut approvals) = state.pending_approvals.lock() {
            approvals.push(pending);
        }
    }
    let _ = app.emit("approval-pending", &preview);

    let timeout_duration = std::time::Duration::from_millis(APPROVAL_TIMEOUT_MS);
    let decision = match rx.recv_timeout(timeout_duration) {
        Ok(d) => d,
        Err(_) => "deny".to_string(),
    };

    {
        let state = app.state::<AppState>();
        if let Ok(mut approvals) = state.pending_approvals.lock() {
            approvals.retain(|a| a.id != req_id);
        }
    }

    let _ = app.emit(
        "approval-resolved",
        serde_json::json!({
            "id": req_id,
            "decision": decision,
        }),
    );

    serde_json::to_string(&serde_json::json!({
        "type": "decision",
        "decision": decision,
    }))
    .unwrap_or_default()
}

fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    // Set version 4 and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        u16::from_be_bytes([bytes[4], bytes[5]]),
        u16::from_be_bytes([bytes[6], bytes[7]]),
        u16::from_be_bytes([bytes[8], bytes[9]]),
        // last 6 bytes as a single hex number
        ((bytes[10] as u64) << 40)
            | ((bytes[11] as u64) << 32)
            | ((bytes[12] as u64) << 24)
            | ((bytes[13] as u64) << 16)
            | ((bytes[14] as u64) << 8)
            | (bytes[15] as u64)
    )
}

// ---------------------------------------------------------------------------
// Exec-host socket server
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
async fn start_exec_host_server(app: AppHandle, token: String) {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = r"\\.\pipe\openclaw-exec-host";

    loop {
        let server = match ServerOptions::new()
            .first_pipe_instance(false)
            .create(pipe_name)
        {
            Ok(s) => s,
            Err(e) => {
                eprintln!("failed to create named pipe: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };

        if let Err(e) = server.connect().await {
            eprintln!("named pipe connect error: {}", e);
            continue;
        }

        let app_clone = app.clone();
        let token_clone = token.clone();
        tokio::spawn(async move {
            handle_socket_connection(server, app_clone, token_clone).await;
        });
    }
}

#[cfg(not(target_os = "windows"))]
async fn start_exec_host_server(app: AppHandle, token: String) {
    let sock_path = exec_host_socket_path();

    // Remove stale socket file
    let _ = std::fs::remove_file(&sock_path);

    let listener = match tokio::net::UnixListener::bind(&sock_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("failed to bind unix socket at {}: {}", sock_path, e);
            return;
        }
    };

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let app_clone = app.clone();
                let token_clone = token.clone();
                tokio::spawn(async move {
                    handle_socket_connection(stream, app_clone, token_clone).await;
                });
            }
            Err(e) => {
                eprintln!("unix socket accept error: {}", e);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> Result<NodeClientConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.clone())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn set_config(state: State<'_, AppState>, config: NodeClientConfig) -> Result<(), String> {
    save_config(&config)?;
    let mut current = state.config.lock().map_err(|err| err.to_string())?;
    *current = config;
    Ok(())
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<'_, AppState>) -> Result<NodeClientStatus, String> {
    let (running, node_status) = {
        let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
        let (running, maybe_exit_log) = refresh_process_state(&mut runtime);
        if let Some(exit_log) = maybe_exit_log {
            let current_status = runtime.node_status.clone();
            drop(runtime);
            push_log_line(&app, exit_log);
            let mut runtime = state.runtime.lock().map_err(|err| err.to_string())?;
            let (running_again, _) = refresh_process_state(&mut runtime);
            (
                running_again,
                runtime
                    .node_status
                    .clone()
                    .or(current_status)
                    .unwrap_or(NodeStatus::Stopped),
            )
        } else {
            (
                running,
                runtime
                    .node_status
                    .clone()
                    .unwrap_or(if running {
                        NodeStatus::Running
                    } else {
                        NodeStatus::Stopped
                    }),
            )
        }
    };

    let config = state.config.lock().map_err(|err| err.to_string())?.clone();
    let runtime = state.runtime.lock().map_err(|err| err.to_string())?;

    Ok(NodeClientStatus {
        running,
        status: node_status.as_str().to_string(),
        gateway_url: config.gateway_url(),
        last_error: runtime.last_error.clone(),
        logs: runtime.logs.iter().cloned().collect(),
    })
}

#[tauri::command]
fn start_node(app: AppHandle) -> Result<(), String> {
    start_node_internal(&app)
}

#[tauri::command]
fn stop_node(app: AppHandle) -> Result<(), String> {
    stop_node_internal(&app)
}

#[tauri::command]
fn restart_node(app: AppHandle) -> Result<(), String> {
    restart_node_internal(&app)
}

#[tauri::command]
fn get_pending_approvals(state: State<'_, AppState>) -> Result<Vec<ApprovalPreview>, String> {
    let approvals = state
        .pending_approvals
        .lock()
        .map_err(|err| err.to_string())?;
    Ok(approvals.iter().map(|a| a.preview.clone()).collect())
}

#[tauri::command]
fn decide_approval(
    _app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    decision: String,
) -> Result<(), String> {
    if decision != "deny" && decision != "allow-once" && decision != "allow-always" {
        return Err(format!("invalid decision: {}", decision));
    }

    let approvals = state
        .pending_approvals
        .lock()
        .map_err(|err| err.to_string())?;

    let pending = approvals
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("no pending approval with id {}", id))?;

    pending
        .tx
        .try_send(decision)
        .map_err(|err| format!("failed to send decision: {}", err))?;

    Ok(())
}

#[tauri::command]
fn enable_autostart(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .enable()
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn disable_autostart(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .disable()
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|err| err.to_string())
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn setup_tray(app: &tauri::App) -> Result<(), String> {
    let show = MenuItemBuilder::new("Open")
        .id("show")
        .build(app)
        .map_err(|err| err.to_string())?;
    let start = MenuItemBuilder::new("Start Node Host")
        .id("start")
        .build(app)
        .map_err(|err| err.to_string())?;
    let stop = MenuItemBuilder::new("Stop Node Host")
        .id("stop")
        .build(app)
        .map_err(|err| err.to_string())?;
    let restart = MenuItemBuilder::new("Restart Node Host")
        .id("restart")
        .build(app)
        .map_err(|err| err.to_string())?;
    let quit = MenuItemBuilder::new("Quit")
        .id("quit")
        .build(app)
        .map_err(|err| err.to_string())?;

    let menu = MenuBuilder::new(app)
        .items(&[&show, &start, &stop, &restart, &quit])
        .build()
        .map_err(|err| err.to_string())?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "start" => {
                let _ = start_node_internal(app);
            }
            "stop" => {
                let _ = stop_node_internal(app);
            }
            "restart" => {
                let _ = restart_node_internal(app);
            }
            "quit" => {
                // Clean up exec-approvals socket registration
                if let Ok(path) = exec_approvals_path() {
                    let _ = clear_exec_approvals_socket(&path);
                }
                let _ = stop_node_internal(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)
        .map_err(|err| err.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let config = load_config();
    let approval_token = generate_token();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState {
            config: Mutex::new(config.clone()),
            runtime: Mutex::new(RuntimeState::default()),
            approval_token: Mutex::new(approval_token.clone()),
            pending_approvals: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            get_status,
            start_node,
            stop_node,
            restart_node,
            get_pending_approvals,
            decide_approval,
            enable_autostart,
            disable_autostart,
            is_autostart_enabled
        ])
        .setup(move |app| {
            setup_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_handle = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_handle.hide();
                    }
                });
            }

            // Register socket in exec-approvals.json
            let socket_path = exec_host_socket_path();
            let token_for_socket = approval_token.clone();
            if let Ok(approvals_path) = exec_approvals_path() {
                if let Err(e) =
                    merge_exec_approvals_socket(&approvals_path, &socket_path, &token_for_socket)
                {
                    eprintln!("failed to register exec-approvals socket: {}", e);
                }
            }

            // Start exec-host socket server
            let app_handle = app.handle().clone();
            let token_for_server = approval_token.clone();
            // Use tauri's async runtime to spawn the server
            tauri::async_runtime::spawn(async move {
                start_exec_host_server(app_handle, token_for_server).await;
            });

            // Auto-start node if configured
            if config.auto_start_node {
                if let Err(err) = start_node_internal(&app.handle()) {
                    push_log_line(&app.handle(), format!("auto-start failed: {}", err));
                }
            }

            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running OpenClaw Windows Node Client");
}
