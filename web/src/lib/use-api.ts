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
}

export function useApi<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: UseApiOptions = {},
) {
  const { enabled = true } = options;
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
        setState({
          key,
          data: undefined,
          error: errorMessage(error),
          errorCode: isApiError(error) ? error.code : null,
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, requestKey]);

  const settled = enabled && state.key === requestKey ? state : null;
  const loading = enabled && state.key !== requestKey;

  return {
    data: settled?.data,
    error: settled?.error ?? null,
    errorCode: settled?.errorCode ?? null,
    loading,
    reload: () => setReloadKey((key) => key + 1),
  };
}
