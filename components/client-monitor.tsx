"use client";

import { useEffect } from "react";

// Olhos do monitor no navegador: erros de JavaScript do próprio sistema são enviados ao
// servidor (no máximo 5 por página, sem repetir). Erros de extensões e de outros sites ficam de fora.
// Autocorreção: se o navegador estiver com a versão antiga após uma publicação, recarrega uma vez.
export const STALE_BUNDLE = /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;
const IGNORE = /ResizeObserver loop|^Script error\.?$|AbortError|The user aborted|Failed to fetch|NetworkError|Load failed/i;

export default function ClientMonitor() {
  useEffect(() => {
    const seen = new Set<string>();
    let sent = 0;
    const report = (name: string, message: string, stack: string) => {
      const key = `${name}:${message}`;
      if (sent >= 5 || seen.has(key)) return;
      seen.add(key); sent++;
      fetch("/api/monitor/client-error", {
        method: "POST", keepalive: true, credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.slice(0, 80), message: message.slice(0, 500), stack: stack.slice(0, 2000), page: location.pathname }),
      }).catch(() => {});
    };
    const handle = (error: unknown, fallback: string) => {
      const err = error instanceof Error ? error : null;
      const message = err?.message || fallback;
      if (!message || IGNORE.test(message) || IGNORE.test(err?.name || "")) return;
      if (STALE_BUNDLE.test(`${err?.name} ${message}`)) {
        let last = 0;
        try { last = Number(sessionStorage.getItem("rn-stale-reload") || 0); } catch {}
        if (Date.now() - last > 60_000) {
          try { sessionStorage.setItem("rn-stale-reload", String(Date.now())); } catch {}
          report(err?.name || "ChunkLoadError", message, err?.stack || "");
          location.reload();
          return;
        }
      }
      report(err?.name || "Error", message, err?.stack || "");
    };
    const onError = (event: ErrorEvent) => {
      if (event.filename) {
        try { if (new URL(event.filename, location.href).origin !== location.origin) return; } catch { return; }
      }
      handle(event.error, event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => { if (event.reason instanceof Error) handle(event.reason, ""); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
