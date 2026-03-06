import { useState, useEffect, useCallback, useRef } from 'react';
import { useGateway } from '../gateway/context';
import { getErrorMessage } from '../lib/utils';

interface UsePollingRpcResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  pause: () => void;
  resume: () => void;
}

export function usePollingRpc<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  intervalMs = 5000,
): UsePollingRpcResult<T> {
  const { rpc, status } = useGateway();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorRef = useRef<unknown>(undefined);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (status.state !== 'connected') {
      if (mountedRef.current) {
        setLoading(false);
      }
      return;
    }
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    const rpcParams: Record<string, unknown> = { ...params };
    if (cursorRef.current !== undefined) {
      rpcParams.cursor = cursorRef.current;
    }

    try {
      const res = await rpc<T>(method, rpcParams);
      if (!mountedRef.current || requestSeq !== requestSeqRef.current) {
        return;
      }
      if (res.ok && res.payload !== undefined) {
        setData(res.payload);
        setError(null);
        // Extract cursor if present for log tailing
        const p = res.payload as Record<string, unknown>;
        if (p && typeof p === 'object' && 'cursor' in p) {
          cursorRef.current = p.cursor;
        }
      } else if (res.error) {
        setError(res.error.message);
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
  }, [rpc, method, params, status.state]);

  const refresh = useCallback(() => {
    setLoading(true);
    void fetchData();
  }, [fetchData]);

  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  useEffect(() => {
    if (status.state !== 'connected' || paused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    void fetchData();
    intervalRef.current = setInterval(() => void fetchData(), intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchData, intervalMs, status.state, paused]);

  return { data, loading, error, refresh, pause, resume };
}
