// Data-fetching hook. Every screen that reads from the backend uses this, so
// loading, error and empty states are consistent rather than reinvented per
// page (Step 16 item 1).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Status code, so callers can special-case 402/404. */
  status: number | null;
  reload: () => void;
  /** Silent refetch: updates data WITHOUT flipping `loading` — for polling
   *  (chat threads, badges) where a skeleton flash every tick would be worse
   *  than slightly stale data. */
  refresh: () => Promise<void>;
  /** Replace the data locally after a mutation, avoiding a refetch. */
  setData: (next: T) => void;
}

export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // The latest path, so a long-lived refresh callback never re-fetches a
  // stale URL after navigation.
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const res = await api.get<T>(p);
      if (pathRef.current === p) setData(res);
    } catch {
      // A failed silent poll keeps the last good data on screen.
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }

    // Guards against a slow response for a previous path overwriting a newer
    // one when the user navigates quickly.
    let active = true;
    setLoading(true);
    setError(null);
    setStatus(null);

    api
      .get<T>(path)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError) {
          setError(err.message);
          setStatus(err.status);
        } else {
          setError("Something went wrong. Please try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, loading, error, status, reload, refresh, setData };
}
