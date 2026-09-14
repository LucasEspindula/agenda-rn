"use client";

import { useEffect, useState } from "react";
import { legacyBody } from "./legacy-body";

type Session = { user: { email: string; name: string; role: string; agendaIds: string[] } };

export function LegacyApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/session"), fetch("/api/state")]).then(async ([sessionResponse, stateResponse]) => {
      if (!sessionResponse.ok || !stateResponse.ok) throw new Error("Não foi possível carregar sua agenda.");
      const session = await sessionResponse.json() as Session;
      const state = await stateResponse.json() as { state: unknown; revision: string | null };
      (window as Window & { AgendaRevision?: string | null }).AgendaRevision = state.revision;
      (window as Window & { AgendaInitialState?: unknown }).AgendaInitialState = state.state;
      for (const key of ["agendaRNData_v5", "agendaRNData_v4", "agendaRNData_v3", "agendaRNData_v2", "agendaClinicaData_v1"]) {
        try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
      }
      (window as Window & { AgendaAuth?: unknown }).AgendaAuth = session.user;
      if (cancelled) return;
      setReady(true);
      requestAnimationFrame(() => {
        const script = document.createElement("script");
        script.src = "/legacy-app.js?v=security-20260914";
        script.dataset.agendaRuntime = "true";
        document.body.appendChild(script);
      });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar."));
    return () => { cancelled = true; document.querySelector('[data-agenda-runtime="true"]')?.remove(); };
  }, []);
  if (error) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl bg-white p-8 shadow-lg"><h1 className="text-xl font-semibold">Agenda indisponível</h1><p className="mt-2 text-slate-600">{error}</p></div></main>;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-slate-50"><p className="text-slate-600">Carregando Agenda RN…</p></main>;
  return <div dangerouslySetInnerHTML={{ __html: legacyBody }} />;
}

