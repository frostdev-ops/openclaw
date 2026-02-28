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
  const [status, setStatus] = useState<GatewayStatus>({ state: "connecting" });
  const [hello, setHello] = useState<HelloOk | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the Rust-side gateway status
  const pollStatus = useCallback(async () => {
    try {
      const result = await gatewayStatus();
      setStatus(result);
    } catch {
      // command not available yet - swallow silently
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await gatewayDisconnect();
    } catch {
      // ignore
    }
    setStatus({ state: "disconnected" });
    setHello(null);
  }, []);

  const rpc = useCallback(
    async <T = unknown>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<GatewayRpcResult<T>> => {
      if (status.state !== "connected") {
        return { ok: false, error: { code: "NOT_CONNECTED", message: "Gateway not connected" } };
      }
      return gatewayRpc<T>(method, params ?? null);
    },
    [status.state],
  );

  useEffect(() => {
    // Listen for gateway-connected event (emitted by Rust after hello-ok)
    let unlistenConnected: (() => void) | null = null;
    let unlistenDisconnected: (() => void) | null = null;

    void listen<HelloOk>("gateway-connected", (event) => {
      setHello(event.payload);
      setStatus((s) => ({
        ...s,
        state: "connected",
        connId: event.payload.server?.connId,
        protocol: event.payload.protocol,
        serverVersion: event.payload.server?.version,
        connectedAtMs: Date.now(),
      }));
    }).then((fn) => { unlistenConnected = fn; });

    void listen<{ error?: string }>("gateway-disconnected", () => {
      setStatus({ state: "disconnected" });
      setHello(null);
    }).then((fn) => { unlistenDisconnected = fn; });

    // Poll status every 8 seconds to keep UI in sync
    pollRef.current = setInterval(() => void pollStatus(), 8_000);
    void pollStatus();

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); }
      unlistenConnected?.();
      unlistenDisconnected?.();
    };
  }, [pollStatus]);

  return (
    <GatewayContext.Provider value={{ status, hello, rpc, disconnect }}>
      {children}
    </GatewayContext.Provider>
  );
}
