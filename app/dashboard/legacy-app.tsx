"use client";

import { useEffect, useRef, useState } from "react";
import {MEDICAL_SPECIALTIES,isAnesthesiologist} from "@/lib/medical-specialties";
import {formatBRL,parseBRL} from '@/lib/money';
import {directPayment,allowedEntities} from '@/lib/billing-finance';
import {paymentMethods} from '@/lib/fiscal-money';
import {individualReceived} from '@/lib/billing-reports';
import {notifyFinancialChange} from '@/lib/financial-events';
import {confirmFiscalPayment} from '@/components/confirm-fiscal-payment';
import {formatCPF,normalizeCPF,validCPF} from '@/lib/cpf';
import {uploadFinancialAttachment} from '@/lib/financial-attachments-client';
import { legacyBody } from "./legacy-body";

type Session = { user: { email: string; name: string; role: string; agendaIds: string[] } };
async function uploadPaymentProof(billingRecordId:string,file:File,replacesId?:string|null){
 await uploadFinancialAttachment(file,{billingRecordId,replacesId});
 notifyFinancialChange();
}

export function LegacyApp({initialView="agenda",adminSection="access",doctorId}:{initialView?:"agenda"|"settings";adminSection?:"access"|"hospitals"|"rules";doctorId?:string}) {
  const [ready, setReady] = useState(false);
  const [cssReady, setCssReady] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [error, setError] = useState("");
  const stylesheetRef = useRef<HTMLLinkElement>(null);
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
      (window as Window & { AgendaInitialView?: string }).AgendaInitialView = initialView;
      if (cancelled) return;
      (window as Window & {MedicalDirectory?:unknown}).MedicalDirectory={specialties:MEDICAL_SPECIALTIES,isAnesthesiologist};
      Object.assign(window,{RNMoney:{formatBRL,parseBRL},RNFinance:{paymentMethods,directPayment,allowedEntities,individualReceived,confirmFiscalPayment,notifyFinancialChange,uploadPaymentProof},RNCPF:{formatCPF,normalizeCPF,validCPF},AgendaAdminSection:adminSection,AgendaDoctorId:doctorId});
      setReady(true);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar."));
    return () => { cancelled = true; };
  }, [initialView,adminSection,doctorId]);
  useEffect(() => {
    if (ready && stylesheetRef.current?.sheet) setCssReady(true);
  }, [ready]);
  useEffect(() => {
    if (!ready || !cssReady) return;
    let cancelled = false;
    const script = document.createElement("script");
    script.src = "/legacy-app.js?v=logs-status-history-20261006";
    script.dataset.agendaRuntime = "true";
    script.onload = () => { if (!cancelled) setRuntimeReady(true); };
    script.onerror = () => { if (!cancelled) setError("Não foi possível carregar sua agenda."); };
    document.body.appendChild(script);
    return () => { cancelled = true; script.remove(); };
  }, [ready,cssReady]);
  if (error) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl bg-white p-8 shadow-lg"><h1 className="text-xl font-semibold">Agenda indisponível</h1><p className="mt-2 text-slate-600">{error}</p></div></main>;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-slate-50"><p className="text-slate-600">Carregando RN Integra…</p></main>;
  return <><link ref={stylesheetRef} rel="stylesheet" href="/legacy.css?v=agenda-operational-logs-20261005" onLoad={() => setCssReady(true)} onError={() => setError("Não foi possível carregar sua agenda.")}/><div aria-busy={!runtimeReady} style={{visibility:runtimeReady?'visible':'hidden'}} className={initialView==='settings'?'admin-section admin-'+adminSection:undefined} dangerouslySetInnerHTML={{ __html: legacyBody }} />{!runtimeReady&&<main role="status" className="grid min-h-screen place-items-center bg-slate-50" style={{position:'fixed',inset:'var(--global-header-height,82px) 0 0',zIndex:1}}><p className="text-slate-600">Carregando RN Integra…</p></main>}</>;
}
