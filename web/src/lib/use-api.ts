"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, isApiError } from "./api-error";

interface ApiState<T> {
  /** Identifies the request that produced this result. */
  key: string;
  data: T | undefined;
  error: string | null;
  errorCode: string | null;
}

interface UseApiOptions {
  enabled?: boolean;
  /** Re-runs the request on an interval while the hook is enabled. */
  refreshIntervalMs?: number;
  /**
   * Keeps the last successful result visible while a refresh is in flight or
   * after a failed poll, so live views do not blank out every interval.
   */
  keepPreviousData?: boolean;
}

export function useApi<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: UseApiOptions = {},
) {
  const { enabled = true, refreshIntervalMs = 0, keepPreviousData = false } = options;
  const factoryRef = useRef(factory);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ApiState<T>>({
    key: "",
    data: undefined,
    error: null,
    errorCode: null,
  });

  // A request is derived from its dependencies, so loading is computed instead
  // of being synchronously written inside the effect.
  const requestKey = JSON.stringify([...deps, enabled, reloadKey]);

  useEffect(() => {
    factoryRef.current = factory;
  }, [factory]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();
    const key = requestKey;

    Promise.resolve()
      .then(() => factoryRef.current(controller.signal))
      .then((data) => {
        if (active) setState({ key, data, error: null, errorCode: null });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState((previous) => ({
          key,
          data: keepPreviousData ? previous.data : undefined,
          error: errorMessage(error),
          errorCode: isApiError(error) ? error.code : null,
        }));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, requestKey, keepPreviousData]);

  useEffect(() => {
    if (!enabled || refreshIntervalMs <= 0) return;
    const timer = setInterval(() => setReloadKey((key) => key + 1), refreshIntervalMs);
    return () => clearInterval(timer);
  }, [enabled, refreshIntervalMs, requestKey]);

  const settled = enabled && state.key === requestKey ? state : null;
  const data = settled ? settled.data : keepPreviousData ? state.data : undefined;
  const loading = enabled && state.key !== requestKey && data === undefined;

  return {
    data,
    error: settled?.error ?? null,
    errorCode: settled?.errorCode ?? null,
    loading,
    refreshing: enabled && state.key !== requestKey && data !== undefined,
    reload: () => setReloadKey((key) => key + 1),
  };
}
