import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "../gateway/context";
import type { GatewayRpcResult } from "../gateway/types";

export interface UseGatewayRpcState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook that calls a gateway RPC method and returns { data, loading, error, refetch }.
 * Automatically re-fetches when the gateway connects.
 */
export function useGatewayRpc<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
): UseGatewayRpcState<T> {
  const { rpc, status } = useGateway();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const fetch = useCallback(async () => {
    if (status.state !== "connected") { return; }
    setLoading(true);
    setError(null);
    try {
      const result: GatewayRpcResult<T> = await rpc<T>(method, paramsRef.current);
      if (result.ok) {
        setData(result.payload ?? null);
      } else {
        setError(result.error?.message ?? "RPC failed");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [method, rpc, status.state]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
