#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod gateway;

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
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(not(target_os = "windows"))]
use std::os::unix::process::CommandExt as UnixCommandExt;

type HmacSha256 = Hmac<Sha256>;

const LOG_CAP: usize = 300;
const HMAC_MAX_DRIFT_MS: u64 = 60_000;
const APPROVAL_TIMEOUT_MS: u64 = 120_000;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
const OPENCLAW_BIN_NAMES: &[&str] = &["openclaw.cmd", "openclaw.ps1", "openclaw.exe"];
#[cfg(not(target_os = "windows"))]
const OPENCLAW_BIN_NAMES: &[&str] = &["openclaw"];

#[cfg(target_os = "windows")]
const PATH_SEP: &str = ";";
#[cfg(not(target_os = "windows"))]
const PATH_SEP: &str = ":";

// ---------------------------------------------------------------------------
// AppImage environment sanitization (Linux only)
// ---------------------------------------------------------------------------

/// Path-list env vars that AppImage runtimes may inject with SquashFS mount
/// entries. Each entry pointing into `$APPDIR` must be filtered out so child
/// processes don't inherit stale/broken library paths.
#[cfg(target_os = "linux")]
const APPIMAGE_PATH_LIST_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "PATH",
    "XDG_DATA_DIRS",
    "QT_PLUGIN_PATH",
    "GIO_MODULE_DIR",
    "GTK_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
];

/// Point (single-value) env vars that AppImage runtimes may set to paths
/// inside the SquashFS mount. If the value contains `$APPDIR`, the var is
/// either restored from the `APPIMAGE_ORIGINAL_*` backup or removed entirely.
#[cfg(target_os = "linux")]
const APPIMAGE_POINT_VARS: &[&str] = &[
    "PYTHONPATH",
    "PYTHONHOME",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GSETTINGS_SCHEMA_DIR",
    "PERLLIB",
];

/// Identity vars set by the AppImage runtime itself — always remove so child
/// processes don't think they're running inside an AppImage.
#[cfg(target_os = "linux")]
const APPIMAGE_IDENTITY_VARS: &[&str] = &["APPDIR", "APPIMAGE", "OWD", "ARGV0"];

/// Detect if we're running inside an AppImage and apply env sanitization to
/// the given `Command` so child processes don't inherit stale SquashFS paths.
#[cfg(target_os = "linux")]
fn sanitize_appimage_env(cmd: &mut std::process::Command) {
    let appdir = match std::env::var("APPDIR") {
        Ok(d) if !d.is_empty() => d,
        _ => return, // not running as AppImage
    };

    // Path-list vars: filter out entries that start with $APPDIR
    for &var in APPIMAGE_PATH_LIST_VARS {
        if let Ok(val) = std::env::var(var) {
            let filtered: Vec<&str> = val
                .split(':')
                .filter(|entry| !entry.starts_with(&appdir))
                .collect();
            if filtered.is_empty() {
                // All entries were AppDir-scoped; check for backup
                let backup_key = format!("APPIMAGE_ORIGINAL_{}", var);
                if let Ok(orig) = std::env::var(&backup_key) {
                    cmd.env(var, orig);
                } else {
                    cmd.env_remove(var);
                }
            } else {
                cmd.env(var, filtered.join(":"));
            }
        }
    }

    // Point vars: remove if value contains $APPDIR
    for &var in APPIMAGE_POINT_VARS {
        if let Ok(val) = std::env::var(var) {
            if val.contains(&appdir) {
                let backup_key = format!("APPIMAGE_ORIGINAL_{}", var);
                if let Ok(orig) = std::env::var(&backup_key) {
                    cmd.env(var, orig);
                } else {
                    cmd.env_remove(var);
                }
            }
        }
    }

    // Identity vars: always remove
    for &var in APPIMAGE_IDENTITY_VARS {
        cmd.env_remove(var);
    }
}

/// Async (tokio) version for `run_exec_command`.
#[cfg(target_os = "linux")]
fn sanitize_appimage_env_tokio(cmd: &mut tokio::process::Command) {
    let appdir = match std::env::var("APPDIR") {
        Ok(d) if !d.is_empty() => d,
        _ => return,
    };

    for &var in APPIMAGE_PATH_LIST_VARS {
        if let Ok(val) = std::env::var(var) {
            let filtered: Vec<&str> = val
                .split(':')
                .filter(|entry| !entry.starts_with(&appdir))
                .collect();
            if filtered.is_empty() {
                let backup_key = format!("APPIMAGE_ORIGINAL_{}", var);
                if let Ok(orig) = std::env::var(&backup_key) {
                    cmd.env(var, orig);
                } else {
                    cmd.env_remove(var);
                }
            } else {
                cmd.env(var, filtered.join(":"));
            }
        }
    }

    for &var in APPIMAGE_POINT_VARS {
        if let Ok(val) = std::env::var(var) {
            if val.contains(&appdir) {
                let backup_key = format!("APPIMAGE_ORIGINAL_{}", var);
                if let Ok(orig) = std::env::var(&backup_key) {
                    cmd.env(var, orig);
                } else {
                    cmd.env_remove(var);
                }
            }
        }
    }

    for &var in APPIMAGE_IDENTITY_VARS {
        cmd.env_remove(var);
    }
}

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
    #[serde(default = "default_true")]
    exec_host_fallback: bool,
    gateway_token: Option<String>,
    gateway_password: Option<String>,
    #[serde(default)]
    install_path: Option<String>,
    #[serde(default = "default_true")]
    use_bundled_runtime: bool,
}

fn default_true() -> bool {
    true
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
            exec_host_fallback: true,
            gateway_token: None,
            gateway_password: None,
            install_path: None,
            use_bundled_runtime: true,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExecApprovalsDefaults {
    #[serde(skip_serializing_if = "Option::is_none")]
    security: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask_fallback: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExecApprovalsAgent {
    #[serde(skip_serializing_if = "Option::is_none")]
    security: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask_fallback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowlist: Option<Vec<AllowlistEntry>>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AllowlistEntry {
    pattern: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_used_at: Option<u64>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExecPolicyConfig {
    security: Option<String>,
    ask: Option<String>,
    ask_fallback: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ExecApprovalsFile {
    version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    socket: Option<ExecApprovalsSocket>,
    #[serde(skip_serializing_if = "Option::is_none")]
    defaults: Option<ExecApprovalsDefaults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agents: Option<HashMap<String, ExecApprovalsAgent>>,
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
    let dir = openclaw_dir()?;
    let new_path = dir.join("node-client.json");
    if !new_path.exists() {
        let legacy = dir.join("windows-node-client.json");
        if legacy.exists() {
            let _ = fs::rename(&legacy, &new_path);
        }
    }
    Ok(new_path)
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

// ---------------------------------------------------------------------------
// OpenClaw config import
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Default)]
struct OpenClawConfig {
    gateway: Option<OpenClawGateway>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenClawGateway {
    port: Option<u16>,
    auth: Option<OpenClawAuth>,
    tls: Option<OpenClawTls>,
    remote: Option<OpenClawRemote>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenClawAuth {
    token: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenClawTls {
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OpenClawRemote {
    tls_fingerprint: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OpenClawNodeJson {
    node_id: Option<String>,
    display_name: Option<String>,
    gateway: Option<OpenClawNodeGateway>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenClawNodeGateway {
    host: Option<String>,
    port: Option<u16>,
    tls: Option<bool>,
}

/// Try to import gateway fields from the existing openclaw CLI config.
/// Returns `None` if the file is missing, has no gateway section, or fails to parse.
fn try_import_from_openclaw_config() -> Option<NodeClientConfig> {
    let dir = openclaw_dir().ok()?;
    let path = dir.join("openclaw.json");
    let raw = fs::read_to_string(&path).ok()?;
    let oc: OpenClawConfig = serde_json5::from_str(&raw).ok()?;
    let gw = oc.gateway?;

    let mut cfg = NodeClientConfig::default();
    if let Some(port) = gw.port {
        cfg.port = port;
    }
    if let Some(auth) = &gw.auth {
        cfg.gateway_token = auth.token.clone();
        cfg.gateway_password = auth.password.clone();
    }
    if let Some(tls) = &gw.tls {
        cfg.tls = tls.enabled.unwrap_or(false);
    }
    if let Some(remote) = &gw.remote {
        cfg.tls_fingerprint = remote.tls_fingerprint.clone();
    }

    // Also import node identity + gateway details from node.json
    let node_path = dir.join("node.json");
    if let Ok(node_raw) = fs::read_to_string(&node_path) {
        if let Ok(node_cfg) = serde_json::from_str::<OpenClawNodeJson>(&node_raw) {
            if node_cfg.node_id.is_some() {
                cfg.node_id = node_cfg.node_id;
            }
            if node_cfg.display_name.is_some() {
                cfg.display_name = node_cfg.display_name;
            }
            // node.json gateway overrides openclaw.json gateway when present
            if let Some(gw) = node_cfg.gateway {
                if let Some(host) = gw.host {
                    cfg.host = host;
                }
                if let Some(port) = gw.port {
                    cfg.port = port;
                }
                if let Some(tls) = gw.tls {
                    cfg.tls = tls;
                }
            }
        }
    }

    Some(cfg)
}

fn load_config() -> NodeClientConfig {
    let path = match config_path() {
        Ok(path) => path,
        Err(_) => return try_import_from_openclaw_config().unwrap_or_default(),
    };
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => try_import_from_openclaw_config().unwrap_or_default(),
    }
}

fn save_config(config: &NodeClientConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let payload = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;

    // Atomic write: temp file + rename (matches exec-approvals pattern)
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, format!("{}\n", payload)).map_err(|err| err.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|err| err.to_string())?;

    restrict_file_permissions(&path);
    Ok(())
}

/// Restrict a file to owner-only access (contains secrets).
fn restrict_file_permissions(path: &Path) {
    #[cfg(target_os = "windows")]
    {
        // Windows: files in %USERPROFILE%\.openclaw\ inherit user-private ACLs
        // from the profile directory. Explicit ACL manipulation via icacls is
        // fragile (domain-join, empty USERNAME, console flash). Parent directory
        // inheritance provides sufficient protection.
        let _ = path;
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

/// Recover files whose ACLs were corrupted by the old `restrict_file_permissions`
/// implementation (which stripped all inherited ACEs and then failed the grant).
/// Resets the file's ACL to inherit from the parent directory.
#[cfg(target_os = "windows")]
fn try_recover_file_acls(path: &Path) {
    if !path.exists() {
        return;
    }
    if fs::read(path).is_ok() {
        return; // File readable, no recovery needed
    }
    // File exists but is unreadable — reset ACLs to inherit from parent
    let path_str = path.to_string_lossy();
    let _ = Command::new("icacls")
        .args([path_str.as_ref(), "/reset"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .status();
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
            defaults: None,
            agents: None,
            extra: HashMap::new(),
        })
    } else {
        ExecApprovalsFile {
            version: 1,
            socket: None,
            defaults: None,
            agents: None,
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

    // Restrict to owner-only; file contains the shared exec-host token
    restrict_file_permissions(file_path);

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
            defaults: None,
            agents: None,
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
// Exec-approvals policy commands
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_ID: &str = "defaults";

fn read_exec_approvals_file() -> Result<ExecApprovalsFile, String> {
    let path = exec_approvals_path()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())
    } else {
        Ok(ExecApprovalsFile {
            version: 1,
            socket: None,
            defaults: None,
            agents: None,
            extra: HashMap::new(),
        })
    }
}

fn write_exec_approvals_file(file: &ExecApprovalsFile) -> Result<(), String> {
    let path = exec_approvals_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, format!("{}\n", json)).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    restrict_file_permissions(&path);
    Ok(())
}

#[tauri::command]
fn get_exec_policy() -> Result<ExecPolicyConfig, String> {
    let file = read_exec_approvals_file()?;
    let defaults = file.defaults.unwrap_or_default();
    Ok(ExecPolicyConfig {
        security: defaults.security,
        ask: defaults.ask,
        ask_fallback: defaults.ask_fallback,
    })
}

#[tauri::command]
fn set_exec_policy(
    security: Option<String>,
    ask: Option<String>,
    ask_fallback: Option<String>,
) -> Result<(), String> {
    let mut file = read_exec_approvals_file()?;
    let mut defaults = file.defaults.unwrap_or_default();
    defaults.security = security;
    defaults.ask = ask;
    defaults.ask_fallback = ask_fallback;
    file.defaults = Some(defaults);
    write_exec_approvals_file(&file)
}

#[tauri::command]
fn get_exec_allowlist() -> Result<Vec<AllowlistEntry>, String> {
    let file = read_exec_approvals_file()?;
    let agents = file.agents.unwrap_or_default();
    let agent = agents.get(DEFAULT_AGENT_ID).cloned().unwrap_or_default();
    Ok(agent.allowlist.unwrap_or_default())
}

#[tauri::command]
fn add_allowlist_entry(pattern: String) -> Result<(), String> {
    let trimmed = pattern.trim().to_string();
    if trimmed.is_empty() {
        return Err("pattern cannot be empty".to_string());
    }
    let mut file = read_exec_approvals_file()?;
    let mut agents = file.agents.unwrap_or_default();
    let mut agent = agents.remove(DEFAULT_AGENT_ID).unwrap_or_default();
    let mut allowlist = agent.allowlist.unwrap_or_default();

    // Don't add duplicates
    if allowlist.iter().any(|e| e.pattern == trimmed) {
        return Ok(());
    }

    allowlist.push(AllowlistEntry {
        pattern: trimmed,
        last_used_at: None,
        extra: HashMap::new(),
    });
    agent.allowlist = Some(allowlist);
    agents.insert(DEFAULT_AGENT_ID.to_string(), agent);
    file.agents = Some(agents);
    write_exec_approvals_file(&file)
}

#[tauri::command]
fn remove_allowlist_entry(pattern: String) -> Result<(), String> {
    let mut file = read_exec_approvals_file()?;
    let mut agents = file.agents.unwrap_or_default();
    let mut agent = match agents.remove(DEFAULT_AGENT_ID) {
        Some(a) => a,
        None => return Ok(()),
    };
    let allowlist = agent.allowlist.unwrap_or_default();
    let filtered: Vec<AllowlistEntry> = allowlist
        .into_iter()
        .filter(|e| e.pattern != pattern)
        .collect();
    agent.allowlist = if filtered.is_empty() { None } else { Some(filtered) };
    agents.insert(DEFAULT_AGENT_ID.to_string(), agent);
    file.agents = Some(agents);
    write_exec_approvals_file(&file)
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
        };
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
        // Pipe closed — child likely exited; detect exit and emit status change
        check_and_emit_child_exit(&app);
    });
}

/// Called when a log reader reaches EOF (child likely exited).
/// Detects exit via refresh_process_state and emits the updated status event.
fn check_and_emit_child_exit(app: &AppHandle) {
    let (exit_log, status_str) = {
        let state = app.state::<AppState>();
        let Ok(mut runtime) = state.runtime.lock() else {
            return;
        };
        let (running, maybe_exit_log) = refresh_process_state(&mut runtime);
        if running {
            return;
        }
        let status_str = runtime.node_status.as_ref().map(|s| s.as_str().to_string());
        (maybe_exit_log, status_str)
    };
    // Push log outside the lock (push_log_line re-locks)
    if let Some(exit_log) = exit_log {
        push_log_line(app, exit_log);
    }
    if let Some(status) = status_str {
        let _ = app.emit("node-status-changed", &status);
    }
}

fn update_node_status_from_log(app: &AppHandle, line: &str) {
    let lower = line.to_lowercase();

    // Surface a user-friendly hint when the gateway rejects connect params
    // (typically means the running gateway is an older version).
    if lower.contains("invalid connect params") {
        push_log_line(
            app,
            "Warning: Gateway rejected connect params — the running gateway may be an older \
             version. Update with: npm install -g openclaw@latest"
                .to_string(),
        );
    }

    let new_status = if lower.contains("connected to gateway") || lower.contains("node is running")
    {
        Some(NodeStatus::Running)
    } else if lower.contains("reconnecting") {
        Some(NodeStatus::Reconnecting)
    } else if lower.contains("disconnected") {
        Some(NodeStatus::Disconnected)
    } else if lower.contains("error") || lower.contains("fatal") || lower.contains("failed") {
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
// Binary discovery
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryResult {
    bin_dir: String,
    bin_path: String,
    bin_name: String,
    method: String,
}

fn search_path_string(path_str: &str, method: &str) -> Option<DiscoveryResult> {
    for dir in path_str.split(PATH_SEP) {
        let dir = dir.trim();
        if dir.is_empty() {
            continue;
        }
        let dir_path = std::path::Path::new(dir);
        for &name in OPENCLAW_BIN_NAMES {
            let candidate = dir_path.join(name);
            if candidate.is_file() {
                return Some(DiscoveryResult {
                    bin_dir: dir.to_string(),
                    bin_path: candidate.to_string_lossy().to_string(),
                    bin_name: name.to_string(),
                    method: method.to_string(),
                });
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_nvm_bin(home: &std::path::Path) -> Option<std::path::PathBuf> {
    // Try reading the default alias file (e.g. "v20.11.0" or "lts/iron")
    let alias_path = home.join(".nvm").join("alias").join("default");
    if let Ok(version) = fs::read_to_string(&alias_path) {
        let version = version.trim().to_string();
        let bin = home
            .join(".nvm")
            .join("versions")
            .join("node")
            .join(&version)
            .join("bin");
        if bin.is_dir() {
            return Some(bin);
        }
        // Resolve one level of indirection (e.g. "lts/iron" -> another alias file)
        let resolved_path = home.join(".nvm").join("alias").join(&version);
        if let Ok(resolved) = fs::read_to_string(&resolved_path) {
            let resolved = resolved.trim().to_string();
            let bin = home
                .join(".nvm")
                .join("versions")
                .join("node")
                .join(&resolved)
                .join("bin");
            if bin.is_dir() {
                return Some(bin);
            }
        }
    }
    // Fallback: scan and pick the lexicographically latest version
    let versions_dir = home.join(".nvm").join("versions").join("node");
    let mut entries: Vec<_> = fs::read_dir(&versions_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    for entry in entries {
        let bin = entry.path().join("bin");
        if bin.is_dir() {
            return Some(bin);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn find_nvm_windows_bin(nvm_root: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(nvm_root)
        .ok()?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    for entry in entries {
        if entry.path().is_dir() {
            return Some(entry.path());
        }
    }
    None
}

fn discover_via_well_known_dirs() -> Option<DiscoveryResult> {
    let home = BaseDirs::new().map(|b| b.home_dir().to_path_buf());

    #[cfg(not(target_os = "windows"))]
    let candidates: Vec<std::path::PathBuf> = {
        let mut dirs = vec![
            std::path::PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
            std::path::PathBuf::from("/opt/homebrew/bin"),
        ];
        if let Some(ref h) = home {
            if let Some(nvm_bin) = find_nvm_bin(h) {
                dirs.push(nvm_bin);
            }
            dirs.push(h.join(".volta").join("bin"));
            dirs.push(
                h.join(".local")
                    .join("share")
                    .join("fnm")
                    .join("aliases")
                    .join("default")
                    .join("bin"),
            );
            dirs.push(h.join(".local").join("share").join("pnpm"));
            dirs.push(h.join(".bun").join("bin"));
            dirs.push(h.join(".local").join("bin"));
        }
        dirs.push(std::path::PathBuf::from("/usr/local/bin"));
        dirs.push(std::path::PathBuf::from("/usr/bin"));
        dirs
    };

    #[cfg(target_os = "windows")]
    let candidates: Vec<std::path::PathBuf> = {
        let mut dirs: Vec<std::path::PathBuf> = vec![];

        // npm global
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(std::path::PathBuf::from(&appdata).join("npm"));
        }

        // fnm: active multishell path first, then scan multishells dir, then alias fallback
        if let Ok(multishell) = std::env::var("FNM_MULTISHELL_PATH") {
            dirs.push(std::path::PathBuf::from(multishell));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            let multishells_dir =
                std::path::PathBuf::from(&localappdata).join("fnm_multishells");
            if multishells_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&multishells_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            dirs.push(p);
                        }
                    }
                }
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(
                std::path::PathBuf::from(&appdata)
                    .join("fnm")
                    .join("aliases")
                    .join("default"),
            );
        }

        // nvm-windows: NVM_SYMLINK first, then NVM_HOME, then APPDATA fallback
        if let Ok(symlink) = std::env::var("NVM_SYMLINK") {
            dirs.push(std::path::PathBuf::from(symlink));
        }
        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            let nvm_root = std::path::PathBuf::from(nvm_home);
            if let Some(nvm_bin) = find_nvm_windows_bin(&nvm_root) {
                dirs.push(nvm_bin);
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let nvm_root = std::path::PathBuf::from(&appdata).join("nvm");
            if let Some(nvm_bin) = find_nvm_windows_bin(&nvm_root) {
                dirs.push(nvm_bin);
            }
        }

        // Volta: VOLTA_HOME env var first, then LOCALAPPDATA fallback
        if let Ok(volta_home) = std::env::var("VOLTA_HOME") {
            dirs.push(std::path::PathBuf::from(volta_home).join("bin"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            dirs.push(
                std::path::PathBuf::from(&localappdata)
                    .join("Volta")
                    .join("bin"),
            );
        }

        // Scoop: SCOOP env var first, then home fallback
        if let Ok(scoop) = std::env::var("SCOOP") {
            dirs.push(std::path::PathBuf::from(scoop).join("shims"));
        }
        if let Some(ref h) = home {
            dirs.push(h.join("scoop").join("shims"));
        }

        // pnpm global
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            dirs.push(std::path::PathBuf::from(&localappdata).join("pnpm"));
        }

        // Chocolatey
        if let Ok(allusers) = std::env::var("ALLUSERSPROFILE") {
            dirs.push(
                std::path::PathBuf::from(&allusers)
                    .join("chocolatey")
                    .join("bin"),
            );
        }

        // Direct Node.js install
        dirs.push(std::path::PathBuf::from(r"C:\Program Files\nodejs"));
        dirs
    };

    for dir in &candidates {
        if dir.is_dir() {
            for &name in OPENCLAW_BIN_NAMES {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(DiscoveryResult {
                        bin_dir: dir.to_string_lossy().to_string(),
                        bin_path: candidate.to_string_lossy().to_string(),
                        bin_name: name.to_string(),
                        method: "well-known-dirs".to_string(),
                    });
                }
            }
        }
    }
    None
}

fn discover_via_login_shell_path() -> Option<DiscoveryResult> {
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let output = Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .output()
            .ok()?;
        let path_str = String::from_utf8_lossy(&output.stdout);
        let path_str = path_str.trim();
        if path_str.is_empty() {
            return None;
        }
        search_path_string(path_str, "login-shell")
    }
    #[cfg(target_os = "windows")]
    {
        fn extract_reg_path(output: &std::process::Output) -> String {
            let s = String::from_utf8_lossy(&output.stdout);
            for line in s.lines() {
                // REG_EXPAND_SZ must be checked before REG_SZ (it's a prefix)
                if let Some(pos) = line.find("REG_EXPAND_SZ") {
                    return line[pos + "REG_EXPAND_SZ".len()..].trim().to_string();
                }
                if let Some(pos) = line.find("REG_SZ") {
                    return line[pos + "REG_SZ".len()..].trim().to_string();
                }
            }
            String::new()
        }
        let user_path = Command::new("reg")
            .args(["query", r"HKCU\Environment", "/v", "Path"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| extract_reg_path(&o))
            .unwrap_or_default();
        let sys_path = Command::new("reg")
            .args([
                "query",
                r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                "/v",
                "Path",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| extract_reg_path(&o))
            .unwrap_or_default();
        let combined = format!("{};{}", user_path, sys_path);
        if combined == ";" {
            return None;
        }
        search_path_string(&combined, "registry-path")
    }
}

fn discover_via_process_path() -> Option<DiscoveryResult> {
    let path_str = std::env::var("PATH").unwrap_or_default();
    if path_str.is_empty() {
        return None;
    }
    search_path_string(&path_str, "process-path")
}

fn discover_openclaw_binary() -> Option<DiscoveryResult> {
    discover_via_login_shell_path()
        .or_else(|| discover_via_well_known_dirs())
        .or_else(|| discover_via_process_path())
}

/// Resolve the openclaw binary path and its parent directory.
/// Returns (bin_path, bin_dir). bin_dir is empty when falling back to bare "openclaw".
fn resolve_openclaw_bin(config: &NodeClientConfig, app: &AppHandle) -> Result<(String, String), String> {
    // Tier 0: bundled CLI code in app resources + system node
    if config.use_bundled_runtime {
        if let Ok(res_dir) = app.path().resource_dir() {
            let mjs = res_dir.join("openclaw").join("openclaw.mjs");
            if mjs.is_file() {
                // Find system node binary via which/where
                let node_name = if cfg!(windows) { "node.exe" } else { "node" };
                let which_cmd = if cfg!(windows) { "where" } else { "which" };
                if let Ok(output) = std::process::Command::new(which_cmd)
                    .arg(node_name)
                    .output()
                {
                    let node_path = String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if !node_path.is_empty() && Path::new(&node_path).is_file() {
                        let sentinel = format!("{}::{}", node_path, mjs.display());
                        return Ok((sentinel, res_dir.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }
    // 1. Explicit install_path takes priority; verify binary exists there
    if let Some(dir) = &config.install_path {
        if !dir.is_empty() {
            let dir_path = std::path::Path::new(dir.as_str());
            for &name in OPENCLAW_BIN_NAMES {
                let candidate = dir_path.join(name);
                if candidate.is_file() {
                    return Ok((candidate.to_string_lossy().to_string(), dir.clone()));
                }
            }
            // install_path set but binary missing there — fall through to discovery
        }
    }
    // 2. Auto-discover via login shell PATH, well-known dirs, or process PATH
    if let Some(result) = discover_openclaw_binary() {
        return Ok((result.bin_path, result.bin_dir));
    }
    // 3. Last resort: bare name (relies on the child process PATH)
    Ok(("openclaw".to_string(), String::new()))
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
        };
    }
    let _ = app.emit("node-status-changed", NodeStatus::Starting.as_str());

    let config = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|err| err.to_string())?.clone();
        cfg
    };

    let (openclaw_bin, bin_dir) = resolve_openclaw_bin(&config, app)?;
    push_log_line(app, format!("using openclaw binary: {}", openclaw_bin));
    // Sentinel "node_path::mjs_path" means bundled runtime: run `node openclaw.mjs ...`
    let mut command = if openclaw_bin.contains("::") {
        let mut parts = openclaw_bin.splitn(2, "::");
        let node = parts.next().unwrap();
        let mjs = parts.next().unwrap();
        let mut c = Command::new(node);
        c.arg(mjs);
        c
    } else {
        Command::new(&openclaw_bin)
    };

    // Sanitize AppImage env vars before any other env modifications
    #[cfg(target_os = "linux")]
    sanitize_appimage_env(&mut command);

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
        if !config.exec_host_fallback {
            command.env("OPENCLAW_NODE_EXEC_FALLBACK", "0");
        }
    }
    if let Some(ref token) = config.gateway_token {
        if !token.is_empty() {
            command.env("OPENCLAW_GATEWAY_TOKEN", token);
        }
    }
    if let Some(ref password) = config.gateway_password {
        if !password.is_empty() {
            command.arg("--password").arg(password);
        }
    }

    // Suppress Node.js DEP0040 punycode deprecation warning (from transitive deps)
    {
        let existing = std::env::var("NODE_OPTIONS").unwrap_or_default();
        let flag = "--disable-warning=DEP0040";
        let node_opts = if existing.is_empty() {
            flag.to_string()
        } else {
            format!("{} {}", existing, flag)
        };
        command.env("NODE_OPTIONS", node_opts);
    }

    // Prepend discovered bin_dir to child PATH so co-located `node` is findable
    if !bin_dir.is_empty() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        command.env("PATH", format!("{}{}{}", bin_dir, PATH_SEP, current_path));
    }

    // Auto-save the discovered install path when it differs from the stored one
    // Skip when using bundled runtime (bin_dir is the resources dir, not a user install)
    if !bin_dir.is_empty() && !openclaw_bin.contains("::") {
        let current = config.install_path.clone().unwrap_or_default();
        if current != bin_dir {
            let state = app.state::<AppState>();
            if let Ok(mut cfg) = state.config.lock() {
                cfg.install_path = Some(bin_dir.clone());
                let _ = save_config(&cfg);
            }
            let _ = app.emit("install-path-detected", bin_dir.clone());
        }
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    // Auto-SIGTERM child when parent dies (crash, OOM kill, etc.)
    #[cfg(target_os = "linux")]
    unsafe {
        command.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
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

    // Fallback: if the child is still alive after 5 s and status is still
    // "Starting", the process likely connected (older CLI builds don't emit a
    // "connected to gateway" log line). Transition to Running so the UI isn't
    // stuck on "Starting" indefinitely.
    {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let state = app_clone.state::<AppState>();
            let should_emit = {
                let Ok(mut runtime) = state.runtime.lock() else {
                    return;
                };
                let (running, _) = refresh_process_state(&mut runtime);
                if running && runtime.node_status == Some(NodeStatus::Starting) {
                    runtime.node_status = Some(NodeStatus::Running);
                    true
                } else {
                    false
                }
            };
            if should_emit {
                let _ = app_clone.emit("node-status-changed", NodeStatus::Running.as_str());
            }
        });
    }

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
        #[cfg(not(target_os = "windows"))]
        {
            // Graceful shutdown: SIGTERM first, escalate to SIGKILL after 5s
            let pid = child.id() as i32;
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
        #[cfg(target_os = "windows")]
        {
            child
                .kill()
                .map_err(|err| format!("failed to stop node host: {}", err))?;
            let _ = child.wait();
        }
        push_log_line(app, "stopped node host process");
    }

    {
        let state = app.state::<AppState>();
        if let Ok(mut runtime) = state.runtime.lock() {
            runtime.node_status = Some(NodeStatus::Stopped);
        };
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

    // Sanitize AppImage env vars
    #[cfg(target_os = "linux")]
    sanitize_appimage_env_tokio(&mut cmd);

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

    // Auto-SIGTERM child when parent dies
    #[cfg(target_os = "linux")]
    unsafe {
        cmd.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }

    let mut child = match cmd.spawn() {
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

    // Take stdout/stderr handles before waiting so we can read them on timeout
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let timeout = std::time::Duration::from_millis(
        timeout_ms
            .and_then(|ms| if ms > 0 { Some(ms as u64) } else { None })
            .unwrap_or(120_000),
    );

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => {
            let stdout = if let Some(mut h) = stdout_handle {
                let mut buf = Vec::new();
                let _ = h.read_to_end(&mut buf).await;
                String::from_utf8_lossy(&buf).to_string()
            } else {
                String::new()
            };
            let stderr = if let Some(mut h) = stderr_handle {
                let mut buf = Vec::new();
                let _ = h.read_to_end(&mut buf).await;
                String::from_utf8_lossy(&buf).to_string()
            } else {
                String::new()
            };
            ExecHostRunResult {
                exit_code: status.code(),
                timed_out: false,
                success: status.success(),
                stdout,
                stderr,
                error: None,
            }
        }
        Ok(Err(e)) => {
            // wait() failed — kill defensively
            let _ = child.kill().await;
            let _ = child.wait().await;
            ExecHostRunResult {
                exit_code: None,
                timed_out: false,
                success: false,
                stdout: String::new(),
                stderr: String::new(),
                error: Some(format!("wait error: {}", e)),
            }
        }
        Err(_) => {
            // Timeout — explicitly kill the process so it doesn't run forever
            let _ = child.kill().await;
            let _ = child.wait().await;
            ExecHostRunResult {
                exit_code: None,
                timed_out: true,
                success: false,
                stdout: String::new(),
                stderr: String::new(),
                error: Some("command timed out".to_string()),
            }
        }
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
            return handle_approval_request(envelope, app, token).await;
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
        };
    }
    let _ = app.emit("approval-pending", &preview);

    // Surface the window so the user sees the approval prompt
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

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
        };
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

async fn handle_approval_request(
    envelope: ApprovalRequestEnvelope,
    app: &AppHandle,
    token: &str,
) -> String {
    // Validate the shared token to prevent unauthorized approval injection
    if envelope.token.as_deref() != Some(token) {
        return make_error_response("auth-failed", "invalid token");
    }

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
        };
    }
    let _ = app.emit("approval-pending", &preview);

    // Surface the window so the user sees the approval prompt
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    let timeout_duration = std::time::Duration::from_millis(APPROVAL_TIMEOUT_MS);
    let decision = match rx.recv_timeout(timeout_duration) {
        Ok(d) => d,
        Err(_) => "deny".to_string(),
    };

    {
        let state = app.state::<AppState>();
        if let Ok(mut approvals) = state.pending_approvals.lock() {
            approvals.retain(|a| a.id != req_id);
        };
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

#[tauri::command]
fn get_install_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let config = state.config.lock().map_err(|err| err.to_string())?;
    Ok(config.install_path.clone())
}

#[tauri::command]
fn set_install_path(state: State<'_, AppState>, path: Option<String>) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|err| err.to_string())?;
    config.install_path = path;
    save_config(&config)?;
    Ok(())
}

#[tauri::command]
fn import_openclaw_config() -> Option<NodeClientConfig> {
    try_import_from_openclaw_config()
}

#[tauri::command]
fn detect_install_path(state: State<'_, AppState>) -> Result<Option<DiscoveryResult>, String> {
    let result = discover_openclaw_binary();
    if let Some(ref discovery) = result {
        let mut config = state.config.lock().map_err(|err| err.to_string())?;
        config.install_path = Some(discovery.bin_dir.clone());
        save_config(&config)?;
    }
    Ok(result)
}

#[tauri::command]
fn get_device_id(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("failed to get data dir: {}", e))?;
    let identity = gateway::load_or_create_device_identity(&data_dir)?;
    Ok(identity.device_id)
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
    // Disable WebKit DMABUF renderer before any GTK/WebKit initialization.
    // The bundled `strip` in older linuxdeploy AppImages cannot handle modern
    // ELF .relr.dyn sections (Arch Linux), and some Wayland compositors have
    // broken DMA-BUF fencing. Setting this here propagates to all WebKit
    // subprocesses via environment inheritance.
    // Safety: called at program start, before any threads are spawned.
    unsafe {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Recover config files whose ACLs were corrupted by a previous version's
    // broken icacls invocation (stripped all ACEs, then failed the grant).
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = config_path() {
            try_recover_file_acls(&p);
        }
        if let Ok(p) = exec_approvals_path() {
            try_recover_file_acls(&p);
        }
    }

    let config = load_config();
    let approval_token = generate_token();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState {
            config: Mutex::new(config.clone()),
            runtime: Mutex::new(RuntimeState::default()),
            pending_approvals: Mutex::new(Vec::new()),
        })
        .manage(Arc::new(gateway::GatewayState::new()))
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
            is_autostart_enabled,
            get_install_path,
            set_install_path,
            import_openclaw_config,
            detect_install_path,
            get_exec_policy,
            set_exec_policy,
            get_exec_allowlist,
            add_allowlist_entry,
            remove_allowlist_entry,
            gateway::gateway_connect,
            gateway::gateway_disconnect,
            gateway::gateway_status,
            gateway::gateway_rpc,
            get_device_id
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

            // Auto-connect to gateway WebSocket
            {
                let gw_state: Arc<gateway::GatewayState> = Arc::clone(&app.state::<Arc<gateway::GatewayState>>());
                let gw_app = app.handle().clone();
                let gw_host = config.host.clone();
                let gw_port = config.port;
                let gw_tls = config.tls;
                let gw_token = config.gateway_token.clone();
                let gw_password = config.gateway_password.clone();
                let gw_node_id = config.node_id.clone();
                let gw_display_name = config.display_name.clone();
                let gw_data_dir = app.path().app_data_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));
                tauri::async_runtime::spawn(async move {
                    // Short delay to let the node process start first
                    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
                    gateway::run_gateway_connection(
                        gw_app,
                        gw_state,
                        format!("{}://{}:{}", if gw_tls { "wss" } else { "ws" }, gw_host, gw_port),
                        gw_token,
                        gw_password,
                        gw_node_id,
                        gw_display_name,
                        gw_data_dir,
                    ).await;
                });
            }

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building OpenClaw Node Client");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Safety-net cleanup: ensure child process and socket registration
            // are cleaned up regardless of how the app exits (WM force-close,
            // SIGTERM, runtime panic, etc.). Both functions are idempotent.
            let _ = stop_node_internal(app_handle);
            if let Ok(path) = exec_approvals_path() {
                let _ = clear_exec_approvals_socket(&path);
            }
        }
    });
}
