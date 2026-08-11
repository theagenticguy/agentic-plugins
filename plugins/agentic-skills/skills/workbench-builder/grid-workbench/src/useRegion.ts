import { useEffect, useState } from "react";

// ONE EventSource per page, module-level. Every useRegion call shares it;
// opening one per component multiplies server subscribers and reconnect storms.
const es = new EventSource("/events");

/**
 * Couples a named SSE invalidation event to a JSON fetch.
 *
 * The region name must match the server in three places: publish("<name>"),
 * the SSE `event:` field, and this hook's argument. The server owns the data;
 * this hook owns nothing but the latest snapshot.
 *
 * Refetches on the stream's `open` event too — after a disconnect, any
 * invalidation that fired while the tab was offline is healed by the
 * reconnect fetch.
 */
export function useRegion<T>(name: string, params?: Record<string, string>): T | null {
  const [data, setData] = useState<T | null>(null);
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";

  useEffect(() => {
    let alive = true;
    const refetch = () =>
      fetch(`/api/regions/${name}${qs}`)
        .then((r) => r.json())
        .then((d) => {
          if (alive) setData(d as T);
        })
        .catch(() => {
          /* server restarting under --hot; the next event refetches */
        });
    refetch();
    es.addEventListener(name, refetch);
    es.addEventListener("open", refetch);
    return () => {
      alive = false;
      es.removeEventListener(name, refetch);
      es.removeEventListener("open", refetch);
    };
  }, [name, qs]);

  return data;
}

/** Live-connection LED: "live" while the SSE stream is open, "down" otherwise. */
export function useSseStatus(): "live" | "down" {
  const [status, setStatus] = useState<"live" | "down">(
    es.readyState === EventSource.OPEN ? "live" : "down",
  );
  useEffect(() => {
    const up = () => setStatus("live");
    const down = () => setStatus("down");
    es.addEventListener("open", up);
    es.addEventListener("hello", up);
    es.addEventListener("error", down);
    // Subscribe, THEN sync: the module-level EventSource starts connecting on
    // import, so `open` and `hello` both fire before React commits this effect
    // (measured on loopback: stream opens ~11ms before the effect runs). Reading
    // readyState only in the useState initializer latches "down" forever on a
    // stream that is in fact live. Re-reading here closes that window.
    if (es.readyState === EventSource.OPEN) setStatus("live");
    return () => {
      es.removeEventListener("open", up);
      es.removeEventListener("hello", up);
      es.removeEventListener("error", down);
    };
  }, []);
  return status;
}

/** POST JSON to a mutation endpoint. No optimistic state: the SSE round-trip
 *  re-renders the region, so the UI always shows what SQLite holds. */
export async function post(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
}
