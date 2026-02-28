import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Hook that subscribes to a Tauri event (forwarded from the gateway WS).
 * The callback receives the event payload. Cleans up on unmount.
 */
export function useGatewayEvent<T = unknown>(
  eventName: string,
  callback: (payload: T) => void,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<{ event: string; payload: T }>("gateway-event", (event) => {
      if (event.payload.event === eventName) {
        callbackRef.current(event.payload.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [eventName]);
}

/**
 * Hook that subscribes to gateway-connected events.
 */
export function useGatewayConnected(callback: (hello: unknown) => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<unknown>("gateway-connected", (event) => {
      callbackRef.current(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}

/**
 * Hook that subscribes to gateway-disconnected events.
 */
export function useGatewayDisconnected(callback: (error?: string) => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<{ error?: string }>("gateway-disconnected", (event) => {
      callbackRef.current(event.payload?.error);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
