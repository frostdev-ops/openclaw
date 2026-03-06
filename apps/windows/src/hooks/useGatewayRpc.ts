import { useCallback, useEffect, useRef, useState } from "react";
import { useGateway } from "../gateway/context";
import type { GatewayRpcResult } from "../gateway/types";
import { getErrorMessage } from "../lib/utils";

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
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetch = useCallback(async () => {
    if (status.state !== "connected") { return; }
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setError(null);
    try {
      const result: GatewayRpcResult<T> = await rpc<T>(method, paramsRef.current);
      if (!mountedRef.current || requestSeq !== requestSeqRef.current) {
        return;
      }
      if (result.ok) {
        setData(result.payload ?? null);
      } else {
        setError(result.error?.message ?? "RPC failed");
      }
    } catch (err: unknown) {
      if (!mountedRef.current || requestSeq !== requestSeqRef.current) {
        return;
      }
      setError(getErrorMessage(err, `Failed to call ${method}`));
    } finally {
      if (mountedRef.current && requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [method, rpc, status.state]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
