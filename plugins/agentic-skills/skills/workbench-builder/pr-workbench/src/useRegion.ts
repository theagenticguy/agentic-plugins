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
    // Re-sample on subscribe. The module-level EventSource connects while the
    // React tree is still rendering, so `open` and `hello` can both fire
    // BEFORE this effect attaches its listeners (measured: connect t=98ms,
    // open t=137ms, effect t=139ms). Without this the LED latches "down" for
    // the life of the page even though the stream is healthy — every region
    // updates live while the header claims the connection is dead.
    if (es.readyState === EventSource.OPEN) setStatus("live");
    es.addEventListener("open", up);
    es.addEventListener("hello", up);
    es.addEventListener("error", down);
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
