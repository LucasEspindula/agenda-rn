"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import "./organization-area.css";

type Status = { doctors: number; appointments: number; members: number; invites: number };

// Primeiros passos da organização nova (gerência). Some quando tudo estiver feito
// ou quando a pessoa ocultar (preferência só deste navegador).
export default function SetupSteps({ organizationId }: { organizationId: string }) {
  const key = `rn-setup-hidden:${organizationId}`;
  const [status, setStatus] = useState<Status | null>(null), [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true, dismissed = false;
    try { dismissed = window.localStorage.getItem(key) === "1"; } catch { /* armazenamento bloqueado: mostra */ }
    if (dismissed) return;
    fetch("/api/organizations/team?setup=1", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => { if (alive && d) setStatus(d); }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  if (hidden || !status) return null;
  const steps = [
    { done: status.doctors > 0, title: "Cadastre o primeiro médico", text: "Cada médico tem a própria agenda e horário de atendimento.", href: "/organizacao?aba=medicos", link: "Ir para Médicos" },
    { done: status.appointments > 0, title: "Crie o primeiro agendamento", text: "Use o botão “Novo agendamento” na agenda abaixo.", href: null, link: null },
    { done: status.members > 1 || status.invites > 0, title: "Convide sua equipe", text: "Secretárias, médicos e outros gerentes recebem o convite por e-mail.", href: "/organizacao?aba=equipe", link: "Convidar" },
  ];
  if (steps.every(s => s.done)) return null;
  const hide = () => { try { window.localStorage.setItem(key, "1"); } catch { /* sem armazenamento: só nesta tela */ } setHidden(true); };
  return <section className="setup-steps no-print" aria-labelledby="setup-title">
    <div className="setup-steps-box">
      <button type="button" className="setup-steps-hide" onClick={hide} aria-label="Ocultar primeiros passos" title="Ocultar"><X size={18} aria-hidden="true" /></button>
      <h2 id="setup-title">Primeiros passos</h2>
      <p>{steps.filter(s => s.done).length} de {steps.length} concluídos</p>
      <ol>{steps.map((s, i) => <li key={s.title} className={s.done ? "done" : undefined}>
        <span className="setup-step-mark" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
        <div><strong>{s.title}{s.done && <span className="sr-only"> (concluído)</span>}</strong><span className="org-muted">{s.text}</span>{!s.done && s.href && <> <a href={s.href}>{s.link}</a></>}</div>
      </li>)}</ol>
    </div>
  </section>;
}
