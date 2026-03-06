import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { gatewayStatus, gatewayRpc, gatewayDisconnect } from "../tauri/commands";
import { useHealthStore, usePresenceStore } from "../stores/connection";
import { getErrorMessage } from "../lib/utils";
import type { HelloOk, GatewayStatus, GatewayRpcResult } from "./types";

interface GatewayContextValue {
  status: GatewayStatus;
  hello: HelloOk | null;
  rpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<GatewayRpcResult<T>>;
  disconnect: () => void;
}

const GatewayContext = createContext<GatewayContextValue>({
  status: { state: "disconnected" },
  hello: null,
  rpc: async () => ({ ok: false, error: { code: "NOT_CONNECTED", message: "Not connected" } }),
  disconnect: () => undefined,
});

export function useGateway() {
  return useContext(GatewayContext);
}

interface GatewayProviderProps {
  children: ReactNode;
}

export function GatewayProvider({ children }: GatewayProviderProps) {
  const [status, setStatus] = useState<GatewayStatus>({ state: "disconnected" });
  const [hello, setHello] = useState<HelloOk | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollSeqRef = useRef(0);
  const mountedRef = useRef(true);

  const applyHelloSnapshot = useCallback((payload: HelloOk) => {
    if (Array.isArray(payload.snapshot?.presence)) {
      usePresenceStore.getState().set(payload.snapshot.presence);
    }
    if (payload.snapshot?.health) {
      useHealthStore.getState().set(payload.snapshot.health);
    }
  }, []);

  // Poll the Rust-side gateway status
  const pollStatus = useCallback(async () => {
    const seq = pollSeqRef.current + 1;
    pollSeqRef.current = seq;
    try {
      const result = await gatewayStatus();
      if (!mountedRef.current || seq !== pollSeqRef.current) {
        return;
      }
      setStatus(result);
      if (result.state !== "connected") {
        setHello(null);
      }
    } catch (error: unknown) {
      if (!mountedRef.current || seq !== pollSeqRef.current) {
        return;
      }
      setStatus((prev) => ({
        ...prev,
        state: "error",
        error: getErrorMessage(error, "Failed to poll gateway status"),
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    void gatewayDisconnect()
      .then(() => {
        if (!mountedRef.current) {
          return;
        }
        setStatus({ state: "disconnected" });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return;
        }
        setStatus({
          state: "error",
          error: getErrorMessage(error, "Failed to disconnect from gateway"),
        });
      })
      .finally(() => {
        if (!mountedRef.current) {
          return;
        }
        setHello(null);
      });
  }, []);

  const rpc = useCallback(
    async <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<GatewayRpcResult<T>> => {
      if (status.state !== "connected") {
        return { ok: false, error: { code: "NOT_CONNECTED", message: "Gateway not connected" } };
      }
      try {
        return await gatewayRpc<T>(method, params ?? null);
      } catch (error: unknown) {
        return {
          ok: false,
          error: {
            code: "RPC_TRANSPORT",
            message: getErrorMessage(error, `Gateway RPC failed: ${method}`),
          },
        };
      }
    },
    [status.state],
  );

  useEffect(() => {
    mountedRef.current = true;

    // Listen for gateway status events emitted by Rust.
    let disposed = false;
    let unlistenConnected: (() => void) | null = null;
    let unlistenDisconnected: (() => void) | null = null;
    let unlistenPairing: (() => void) | null = null;

    void listen<HelloOk>("gateway-connected", (event) => {
      if (!mountedRef.current) {
        return;
      }
      const payload = event.payload;
      setHello(payload);
      applyHelloSnapshot(payload);
      setStatus({
        state: "connected",
        connId: payload.server?.connId,
        protocol: payload.protocol,
        serverVersion: payload.server?.version,
        connectedAtMs: Date.now(),
      });
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenConnected = fn;
      })
      .catch((error: unknown) => {
        console.error("[gateway-connected] listener registration failed", error);
      });

    void listen<{ error?: string | null }>("gateway-disconnected", (event) => {
      if (!mountedRef.current) {
        return;
      }
      const errorMessage = typeof event.payload?.error === "string"
        ? event.payload.error.trim()
        : "";
      if (errorMessage) {
        setStatus({ state: "error", error: errorMessage });
      } else {
        setStatus({ state: "disconnected" });
      }
      setHello(null);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenDisconnected = fn;
      })
      .catch((error: unknown) => {
        console.error("[gateway-disconnected] listener registration failed", error);
      });

    void listen<{ requestId?: string; deviceId?: string }>("gateway-pairing-required", (event) => {
      if (!mountedRef.current) {
        return;
      }
      setStatus({
        state: "pairing",
        pairingRequestId: event.payload?.requestId,
        deviceId: event.payload?.deviceId,
      });
      setHello(null);
    })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlistenPairing = fn;
      })
      .catch((error: unknown) => {
        console.error("[gateway-pairing-required] listener registration failed", error);
      });

    // Poll status every 8 seconds to keep UI in sync
    pollRef.current = setInterval(() => void pollStatus(), 8_000);
    void pollStatus();

    return () => {
      disposed = true;
      mountedRef.current = false;
      if (pollRef.current) { clearInterval(pollRef.current); }
      unlistenConnected?.();
      unlistenDisconnected?.();
      unlistenPairing?.();
    };
  }, [applyHelloSnapshot, pollStatus]);

  return (
    <GatewayContext.Provider value={{ status, hello, rpc, disconnect }}>
      {children}
    </GatewayContext.Provider>
  );
}
