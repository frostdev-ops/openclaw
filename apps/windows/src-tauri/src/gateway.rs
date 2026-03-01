// Gateway WebSocket client for the OpenClaw control surface.
//
// Connects to the gateway using the standard OpenClaw operator protocol,
// performs the connect handshake, and exposes RPC + event forwarding.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message};

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct ReqFrame {
    #[serde(rename = "type")]
    frame_type: String,
    id: String,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

// ---------------------------------------------------------------------------
// Public status types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConnectionStatus {
    pub state: String, // "disconnected" | "connecting" | "connected" | "pairing" | "error"
    pub conn_id: Option<String>,
    pub protocol: Option<u32>,
    pub server_version: Option<String>,
    pub error: Option<String>,
    pub connected_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
}

impl Default for GatewayConnectionStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".to_string(),
            conn_id: None,
            protocol: None,
            server_version: None,
            error: None,
            connected_at_ms: None,
            pairing_request_id: None,
            device_id: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Internal command channel
// ---------------------------------------------------------------------------

struct RpcRequest {
    id: String,
    method: String,
    params: Option<Value>,
    reply: oneshot::Sender<Result<Value, String>>,
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayTokenEntry {
    token: String,
    role: String,
    issued_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    version: u32,
    pub device_id: String,
    public_key_bytes: String,  // base64url
    private_key_bytes: String, // base64url (seed)
    created_at_ms: u64,
    #[serde(default)]
    gateway_tokens: std::collections::HashMap<String, GatewayTokenEntry>,
}

// ---------------------------------------------------------------------------
// Managed gateway state
// ---------------------------------------------------------------------------

pub struct GatewayState {
    status: Mutex<GatewayConnectionStatus>,
    // Sender to the background WS task for outgoing RPC calls
    tx: Mutex<Option<mpsc::UnboundedSender<RpcRequest>>>,
    // Counter for generating unique RPC request IDs
    seq: Mutex<u64>,
}

impl GatewayState {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(GatewayConnectionStatus::default()),
            tx: Mutex::new(None),
            seq: Mutex::new(0),
        }
    }

    fn next_id(&self) -> String {
        let mut seq = self.seq.lock().unwrap();
        *seq += 1;
        format!("ctrl-{}", *seq)
    }

    pub fn get_status(&self) -> GatewayConnectionStatus {
        self.status.lock().unwrap().clone()
    }

    fn set_status(&self, status: GatewayConnectionStatus) {
        *self.status.lock().unwrap() = status;
    }

    fn set_tx(&self, tx: Option<mpsc::UnboundedSender<RpcRequest>>) {
        *self.tx.lock().unwrap() = tx;
    }
}

// ---------------------------------------------------------------------------
// Device identity persistence
// ---------------------------------------------------------------------------

pub fn load_or_create_device_identity(data_dir: &Path) -> Result<DeviceIdentity, String> {
    let identity_dir = data_dir.join("identity");
    let identity_path = identity_dir.join("node-client-device.json");

    if identity_path.exists() {
        let json = std::fs::read_to_string(&identity_path)
            .map_err(|e| format!("failed to read identity: {}", e))?;
        if let Ok(identity) = serde_json::from_str::<DeviceIdentity>(&json) {
            return Ok(identity);
        }
    }

    // Generate fresh keypair
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let public_bytes = signing_key.verifying_key().to_bytes();
    let private_bytes = signing_key.to_bytes(); // 32-byte seed

    // DeviceId = SHA256(raw public key bytes) as hex
    let mut hasher = Sha256::new();
    hasher.update(public_bytes);
    let device_id = hex::encode(hasher.finalize());

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let identity = DeviceIdentity {
        version: 1,
        device_id,
        public_key_bytes: URL_SAFE_NO_PAD.encode(public_bytes),
        private_key_bytes: URL_SAFE_NO_PAD.encode(private_bytes),
        created_at_ms: now_ms,
        gateway_tokens: std::collections::HashMap::new(),
    };

    // Persist
    std::fs::create_dir_all(&identity_dir)
        .map_err(|e| format!("failed to create identity dir: {}", e))?;
    let json = serde_json::to_string_pretty(&identity)
        .map_err(|e| format!("failed to serialize identity: {}", e))?;
    std::fs::write(&identity_path, &json)
        .map_err(|e| format!("failed to write identity: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&identity_path)
            .map_err(|e| format!("failed to get perms: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&identity_path, perms)
            .map_err(|e| format!("failed to set perms: {}", e))?;
    }

    Ok(identity)
}

fn save_device_identity(data_dir: &Path, identity: &DeviceIdentity) {
    let identity_dir = data_dir.join("identity");
    let identity_path = identity_dir.join("node-client-device.json");
    if let Ok(json) = serde_json::to_string_pretty(identity) {
        let _ = std::fs::write(&identity_path, json);
    }
}

// ---------------------------------------------------------------------------
// Connection task
// ---------------------------------------------------------------------------

pub async fn run_gateway_connection(
    app: AppHandle,
    state: Arc<GatewayState>,
    url: String,
    token: Option<String>,
    password: Option<String>,
    _node_id: Option<String>,
    display_name: Option<String>,
    data_dir: PathBuf,
) {
    let (rpc_tx, mut rpc_rx) = mpsc::unbounded_channel::<RpcRequest>();

    // Pending RPC callbacks keyed by request ID
    let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Try to connect
    let ws_result = tokio::time::timeout(
        Duration::from_secs(15),
        connect_async(url.as_str()),
    )
    .await;

    let ws_stream = match ws_result {
        Ok(Ok((stream, _))) => stream,
        Ok(Err(e)) => {
            let msg = format!("WS connect failed: {}", e);
            state.set_status(GatewayConnectionStatus {
                state: "error".to_string(),
                error: Some(msg.clone()),
                ..Default::default()
            });
            let _ = app.emit(
                "gateway-disconnected",
                serde_json::json!({ "error": msg }),
            );
            return;
        }
        Err(_) => {
            let msg = "Connection timed out".to_string();
            state.set_status(GatewayConnectionStatus {
                state: "error".to_string(),
                error: Some(msg.clone()),
                ..Default::default()
            });
            let _ = app.emit(
                "gateway-disconnected",
                serde_json::json!({ "error": msg }),
            );
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // Load device identity
    let mut identity = load_or_create_device_identity(&data_dir).unwrap_or_else(|_| {
        // Fallback: generate in-memory identity without persistence
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let public_bytes = signing_key.verifying_key().to_bytes();
        let private_bytes = signing_key.to_bytes();
        let mut hasher = Sha256::new();
        hasher.update(public_bytes);
        let device_id = hex::encode(hasher.finalize());
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        DeviceIdentity {
            version: 1,
            device_id,
            public_key_bytes: URL_SAFE_NO_PAD.encode(public_bytes),
            private_key_bytes: URL_SAFE_NO_PAD.encode(private_bytes),
            created_at_ms: now_ms,
            gateway_tokens: std::collections::HashMap::new(),
        }
    });

    // Wait up to 5s for connect.challenge event
    let mut nonce: Option<String> = None;
    {
        match tokio::time::timeout(Duration::from_secs(5), read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                    if parsed.get("type").and_then(|t| t.as_str()) == Some("event")
                        && parsed.get("event").and_then(|e| e.as_str()) == Some("connect.challenge")
                    {
                        nonce = parsed
                            .get("payload")
                            .and_then(|p| p.get("nonce"))
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string());
                    }
                }
            }
            _ => {} // No challenge received — proceed without
        }
    }

    // Build device signature if we have a nonce
    let device_obj: Option<Value> = if let Some(ref nonce_val) = nonce {
        // Reconstruct signing key from stored seed
        if let Ok(seed_bytes) = URL_SAFE_NO_PAD.decode(&identity.private_key_bytes) {
            if seed_bytes.len() == 32 {
                let seed_arr: [u8; 32] = seed_bytes.try_into().unwrap_or([0u8; 32]);
                let signing_key = SigningKey::from_bytes(&seed_arr);
                let signed_at_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let token_part = token.as_deref().unwrap_or("");
                let platform = std::env::consts::OS;
                // v3 payload: v3|{deviceId}|{clientId}|{mode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|
                let scopes = "operator.read,operator.write,operator.admin,operator.approvals";
                let payload_str = format!(
                    "v3|{}|openclaw-control-surface|ui|operator|{}|{}|{}|{}|{}|",
                    identity.device_id,
                    scopes,
                    signed_at_ms,
                    token_part,
                    nonce_val,
                    platform
                );
                let signature = signing_key.sign(payload_str.as_bytes());
                let sig_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());
                Some(serde_json::json!({
                    "id": identity.device_id,
                    "publicKey": identity.public_key_bytes,
                    "signature": sig_b64,
                    "signedAt": signed_at_ms,
                    "nonce": nonce_val,
                }))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // Send connect handshake
    let connect_id = state.next_id();
    let client_id = "openclaw-control-surface";

    // Build auth object conditionally — the schema's Type.Optional(Type.Object(...)) only
    // accepts an auth object or absent field; null is not valid, so omit auth entirely when
    // no credentials are configured.
    let mut auth_obj = serde_json::Map::new();
    if let Some(ref t) = token {
        auth_obj.insert("token".into(), Value::String(t.clone()));
    }
    if let Some(ref p) = password {
        auth_obj.insert("password".into(), Value::String(p.clone()));
    }

    // Include stored device token if available
    if let Some(stored_token_entry) = identity.gateway_tokens.get(&url) {
        if auth_obj.is_empty() {
            auth_obj.insert("token".into(), Value::String(stored_token_entry.token.clone()));
        }
    }

    // Build params as a map so auth can be conditionally included without serializing as null.
    let mut params_map = serde_json::Map::new();
    params_map.insert("minProtocol".into(), serde_json::json!(3));
    params_map.insert("maxProtocol".into(), serde_json::json!(5));
    params_map.insert(
        "client".into(),
        serde_json::json!({
            "id": client_id,
            "displayName": display_name.as_deref().unwrap_or("OpenClaw Control Surface"),
            "version": "1.0.0",
            "platform": std::env::consts::OS,
            "mode": "ui",
        }),
    );
    params_map.insert("role".into(), serde_json::json!("operator"));
    params_map.insert(
        "scopes".into(),
        serde_json::json!(["operator.read", "operator.write", "operator.admin", "operator.approvals"]),
    );
    if let Some(ref device) = device_obj {
        params_map.insert("device".into(), device.clone());
    }
    if !auth_obj.is_empty() {
        params_map.insert("auth".into(), Value::Object(auth_obj));
    }

    let connect_payload = serde_json::json!({
        "type": "req",
        "id": connect_id,
        "method": "connect",
        "params": Value::Object(params_map),
    });

    let msg_str = serde_json::to_string(&connect_payload).unwrap_or_default();
    if let Err(e) = write.send(Message::Text(msg_str.into())).await {
        let err_msg = format!("Failed to send connect: {}", e);
        state.set_status(GatewayConnectionStatus {
            state: "error".to_string(),
            error: Some(err_msg.clone()),
            ..Default::default()
        });
        let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": err_msg }));
        return;
    }

    // Wait for hello-ok response
    let hello_ok = loop {
        match tokio::time::timeout(Duration::from_secs(15), read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let parsed: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // Check if this is the response to our connect request
                if parsed.get("type").and_then(|t| t.as_str()) == Some("res")
                    && parsed.get("id").and_then(|i| i.as_str()) == Some(&connect_id)
                {
                    if parsed.get("ok").and_then(|o| o.as_bool()) == Some(true) {
                        break parsed.get("payload").cloned().unwrap_or(Value::Null);
                    } else {
                        let err_code = parsed
                            .get("error")
                            .and_then(|e| e.get("code"))
                            .and_then(|c| c.as_str())
                            .unwrap_or("")
                            .to_string();
                        let err = parsed
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("handshake rejected")
                            .to_string();

                        if err_code == "PAIRING_REQUIRED" || err_code == "1008" {
                            // Extract requestId from error payload
                            let request_id = parsed
                                .get("error")
                                .and_then(|e| e.get("requestId"))
                                .and_then(|r| r.as_str())
                                .map(|s| s.to_string());
                            state.set_status(GatewayConnectionStatus {
                                state: "pairing".to_string(),
                                pairing_request_id: request_id.clone(),
                                device_id: Some(identity.device_id.clone()),
                                error: None,
                                ..Default::default()
                            });
                            let _ = app.emit(
                                "gateway-pairing-required",
                                serde_json::json!({
                                    "requestId": request_id,
                                    "deviceId": identity.device_id,
                                }),
                            );
                            return;
                        }

                        state.set_status(GatewayConnectionStatus {
                            state: "error".to_string(),
                            error: Some(err.clone()),
                            ..Default::default()
                        });
                        let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": err }));
                        return;
                    }
                }
            }
            Ok(Some(Ok(Message::Close(frame)))) => {
                // Check if close frame carries a pairing-related code
                let err = if let Some(ref cf) = frame {
                    if cf.code == tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Policy {
                        let reason = cf.reason.to_string();
                        if reason.contains("PAIRING_REQUIRED") || reason.contains("1008") {
                            state.set_status(GatewayConnectionStatus {
                                state: "pairing".to_string(),
                                device_id: Some(identity.device_id.clone()),
                                error: None,
                                ..Default::default()
                            });
                            let _ = app.emit(
                                "gateway-pairing-required",
                                serde_json::json!({
                                    "deviceId": identity.device_id,
                                }),
                            );
                            return;
                        }
                        format!("Connection closed: {}", reason)
                    } else {
                        "Connection closed during handshake".to_string()
                    }
                } else {
                    "Connection closed during handshake".to_string()
                };
                state.set_status(GatewayConnectionStatus {
                    state: "error".to_string(),
                    error: Some(err.clone()),
                    ..Default::default()
                });
                let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": err }));
                return;
            }
            Ok(None) => {
                let err = "Connection closed during handshake".to_string();
                state.set_status(GatewayConnectionStatus {
                    state: "error".to_string(),
                    error: Some(err.clone()),
                    ..Default::default()
                });
                let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": err }));
                return;
            }
            Err(_) => {
                let err = "Handshake timed out".to_string();
                state.set_status(GatewayConnectionStatus {
                    state: "error".to_string(),
                    error: Some(err.clone()),
                    ..Default::default()
                });
                let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": err }));
                return;
            }
            _ => continue,
        }
    };

    // Extract hello-ok fields
    let conn_id = hello_ok
        .get("server")
        .and_then(|s| s.get("connId"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    let protocol = hello_ok
        .get("protocol")
        .and_then(|p| p.as_u64())
        .map(|p| p as u32);
    let server_version = hello_ok
        .get("server")
        .and_then(|s| s.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Store device token if provided in hello-ok
    if let Some(device_token) = hello_ok
        .get("auth")
        .and_then(|a| a.get("deviceToken"))
        .and_then(|t| t.as_str())
    {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        identity.gateway_tokens.insert(
            url.clone(),
            GatewayTokenEntry {
                token: device_token.to_string(),
                role: "operator".to_string(),
                issued_at_ms: now_ms,
            },
        );
        save_device_identity(&data_dir, &identity);
    }

    let connected_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    state.set_status(GatewayConnectionStatus {
        state: "connected".to_string(),
        conn_id: conn_id.clone(),
        protocol,
        server_version,
        error: None,
        connected_at_ms: Some(connected_at_ms),
        device_id: Some(identity.device_id.clone()),
        pairing_request_id: None,
    });

    state.set_tx(Some(rpc_tx));

    let _ = app.emit("gateway-connected", &hello_ok);

    // Main loop: handle inbound messages and outbound RPC requests
    let pending_clone = pending.clone();

    loop {
        tokio::select! {
            // Outbound RPC request from a Tauri command
            rpc_req = rpc_rx.recv() => {
                match rpc_req {
                    None => break, // channel closed = disconnect requested
                    Some(req) => {
                        let frame = ReqFrame {
                            frame_type: "req".to_string(),
                            id: req.id.clone(),
                            method: req.method,
                            params: req.params,
                        };
                        let json = serde_json::to_string(&frame).unwrap_or_default();
                        if let Err(e) = write.send(Message::Text(json.into())).await {
                            let _ = req.reply.send(Err(format!("send failed: {}", e)));
                        } else {
                            pending_clone.lock().unwrap().insert(req.id, req.reply);
                        }
                    }
                }
            }

            // Inbound message from the gateway
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let parsed: Value = match serde_json::from_str(&text) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        let frame_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("").to_string();

                        match frame_type.as_str() {
                            "res" => {
                                let id = parsed.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
                                let ok = parsed.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
                                if let Some(reply) = pending_clone.lock().unwrap().remove(&id) {
                                    let result = if ok {
                                        Ok(parsed.get("payload").cloned().unwrap_or(Value::Null))
                                    } else {
                                        let msg = parsed
                                            .get("error")
                                            .and_then(|e| e.get("message"))
                                            .and_then(|m| m.as_str())
                                            .unwrap_or("RPC error")
                                            .to_string();
                                        Err(msg)
                                    };
                                    let _ = reply.send(result);
                                }
                            }
                            "event" => {
                                let event_name = parsed.get("event").and_then(|e| e.as_str()).unwrap_or("").to_string();
                                let event_payload = parsed.get("payload").cloned().unwrap_or(Value::Null);
                                let _ = app.emit(
                                    "gateway-event",
                                    serde_json::json!({
                                        "event": event_name,
                                        "payload": event_payload
                                    }),
                                );
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = write.send(Message::Pong(data)).await;
                    }
                    _ => {}
                }
            }
        }
    }

    // Connection closed
    state.set_tx(None);
    state.set_status(GatewayConnectionStatus {
        state: "disconnected".to_string(),
        ..Default::default()
    });

    // Fail all pending RPC requests
    let mut pending_map = pending.lock().unwrap();
    for (_, reply) in pending_map.drain() {
        let _ = reply.send(Err("Connection closed".to_string()));
    }

    let _ = app.emit("gateway-disconnected", serde_json::json!({ "error": null }));
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn gateway_connect(
    host: String,
    port: u16,
    tls: bool,
    token: Option<String>,
    password: Option<String>,
    node_id: Option<String>,
    display_name: Option<String>,
    state: tauri::State<'_, Arc<GatewayState>>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let scheme = if tls { "wss" } else { "ws" };
    let url = format!("{}://{}:{}", scheme, host, port);

    state.set_status(GatewayConnectionStatus {
        state: "connecting".to_string(),
        ..Default::default()
    });

    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("failed to get data dir: {}", e))?;

    let state_clone = Arc::clone(&state);
    tauri::async_runtime::spawn(run_gateway_connection(
        app,
        state_clone,
        url,
        token,
        password,
        node_id,
        display_name,
        data_dir,
    ));

    // Give the background task a moment to connect
    tokio::time::sleep(Duration::from_millis(3000)).await;

    let current = state.get_status();
    if current.state == "connected" {
        Ok(serde_json::json!({ "ok": true }))
    } else if current.state == "pairing" {
        Ok(serde_json::json!({
            "ok": false,
            "error": "PAIRING_REQUIRED",
            "pairingRequestId": current.pairing_request_id,
            "deviceId": current.device_id,
        }))
    } else if current.state == "error" {
        Ok(serde_json::json!({ "ok": false, "error": current.error }))
    } else {
        Ok(serde_json::json!({ "ok": false, "error": "Connection in progress" }))
    }
}

#[tauri::command]
pub fn gateway_disconnect(state: tauri::State<'_, Arc<GatewayState>>) {
    // Drop the sender, which causes the background task to break its loop
    state.set_tx(None);
    state.set_status(GatewayConnectionStatus::default());
}

#[tauri::command]
pub fn gateway_status(state: tauri::State<'_, Arc<GatewayState>>) -> GatewayConnectionStatus {
    state.get_status()
}

#[tauri::command]
pub async fn gateway_rpc(
    method: String,
    params: Option<Value>,
    state: tauri::State<'_, Arc<GatewayState>>,
) -> Result<serde_json::Value, String> {
    let tx = {
        let lock = state.tx.lock().unwrap();
        lock.clone()
    };

    let tx = tx.ok_or_else(|| "Gateway not connected".to_string())?;

    let id = state.next_id();
    let (reply_tx, reply_rx) = oneshot::channel::<Result<Value, String>>();

    let req = RpcRequest {
        id,
        method,
        params,
        reply: reply_tx,
    };

    tx.send(req).map_err(|_| "Gateway connection dropped".to_string())?;

    tokio::time::timeout(Duration::from_secs(30), reply_rx)
        .await
        .map_err(|_| "RPC timed out".to_string())?
        .map_err(|_| "Reply channel closed".to_string())?
        .map(|v| serde_json::json!({ "ok": true, "payload": v }))
        .map_err(|e| e)
        .or_else(|e| Ok(serde_json::json!({ "ok": false, "error": { "code": "RPC_ERROR", "message": e } })))
}
