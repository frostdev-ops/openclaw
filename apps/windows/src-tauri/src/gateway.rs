// Gateway WebSocket client for the OpenClaw control surface.
//
// Connects to the gateway using the standard OpenClaw operator protocol,
// performs the connect handshake, and exposes RPC + event forwarding.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
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
    pub state: String, // "disconnected" | "connecting" | "connected" | "error"
    pub conn_id: Option<String>,
    pub protocol: Option<u32>,
    pub server_version: Option<String>,
    pub error: Option<String>,
    pub connected_at_ms: Option<u64>,
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
                        let err = parsed
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("handshake rejected")
                            .to_string();
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
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
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

    let state_clone = Arc::clone(&state);
    tauri::async_runtime::spawn(run_gateway_connection(
        app,
        state_clone,
        url,
        token,
        password,
        node_id,
        display_name,
    ));

    // Give the background task a moment to connect
    tokio::time::sleep(Duration::from_millis(3000)).await;

    let current = state.get_status();
    if current.state == "connected" {
        Ok(serde_json::json!({ "ok": true }))
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
