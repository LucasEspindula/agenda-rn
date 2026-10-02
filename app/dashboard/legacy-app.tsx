"use client";

import { useEffect, useState } from "react";
import {MEDICAL_SPECIALTIES,isAnesthesiologist} from "@/lib/medical-specialties";
import {formatBRL,parseBRL} from '@/lib/money';
import {directPayment,allowedEntities} from '@/lib/billing-finance';
import {paymentMethods} from '@/lib/fiscal-money';
import {individualReceived} from '@/lib/billing-reports';
import {notifyFinancialChange} from '@/lib/financial-events';
import {confirmFiscalPayment} from '@/components/confirm-fiscal-payment';
import {formatCPF,normalizeCPF,validCPF} from '@/lib/cpf';
import { legacyBody } from "./legacy-body";

type Session = { user: { email: string; name: string; role: string; agendaIds: string[] } };
async function uploadPaymentProof(billingRecordId:string,file:File){
 const startResponse=await fetch('/api/financial-attachments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({billingRecordId,name:file.name,mimeType:file.type,size:file.size})}),start=await startResponse.json();
 if(!startResponse.ok)throw Error(start.error||'O pagamento foi mantido, mas o comprovante não foi enviado.');
 const upload=await fetch(start.url,{method:'PUT',headers:{'content-type':file.type},body:file});
 if(!upload.ok)throw Error('O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');
 const finishResponse=await fetch('/api/financial-attachments',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:start.id})}),finish=await finishResponse.json();
 if(!finishResponse.ok)throw Error(finish.error||'O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');
 notifyFinancialChange();
}

export function LegacyApp({initialView="agenda",adminSection="access",doctorId}:{initialView?:"agenda"|"settings";adminSection?:"access"|"hospitals"|"rules";doctorId?:string}) {
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
      (window as Window & { AgendaInitialView?: string }).AgendaInitialView = initialView;
      if (cancelled) return;
      (window as Window & {MedicalDirectory?:unknown}).MedicalDirectory={specialties:MEDICAL_SPECIALTIES,isAnesthesiologist};
      Object.assign(window,{RNMoney:{formatBRL,parseBRL},RNFinance:{paymentMethods,directPayment,allowedEntities,individualReceived,confirmFiscalPayment,notifyFinancialChange,uploadPaymentProof},RNCPF:{formatCPF,normalizeCPF,validCPF},AgendaAdminSection:adminSection,AgendaDoctorId:doctorId});
      setReady(true);
      requestAnimationFrame(() => {
        const script = document.createElement("script");
        script.src = "/legacy-app.js?v=agenda-nav-cleanup-20261002";
        script.dataset.agendaRuntime = "true";
        document.body.appendChild(script);
      });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar."));
    return () => { cancelled = true; document.querySelector('[data-agenda-runtime="true"]')?.remove(); };
  }, [initialView,adminSection,doctorId]);
  if (error) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="rounded-2xl bg-white p-8 shadow-lg"><h1 className="text-xl font-semibold">Agenda indisponível</h1><p className="mt-2 text-slate-600">{error}</p></div></main>;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-slate-50"><p className="text-slate-600">Carregando RN Integra…</p></main>;
  return <><link rel="stylesheet" href="/legacy.css?v=agenda-nav-cleanup-20261002"/><div className={initialView==='settings'?'admin-section admin-'+adminSection:undefined} dangerouslySetInnerHTML={{ __html: legacyBody }} /></>;
}

