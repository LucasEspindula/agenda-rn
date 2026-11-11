"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, ChevronRight, LayoutDashboard, Menu, Settings, ShieldAlert, Stethoscope, Wallet, X } from "lucide-react";
import OrganizationSwitcher from "@/components/organization-switcher";
import AgendaSectionLinks from "@/components/agenda-section-menu";
import BillingSectionLinks from "@/components/billing-section-menu";
import HubLogout from "@/app/hub/hub-logout";
import type { ModuleName } from "@/lib/navigation";
import { attachMenuSwipe } from "@/components/menu-swipe";

type MobileLink = { id: ModuleName; href: string; label: string };
const icons = { hub: LayoutDashboard, agenda: CalendarDays, billing: Wallet, denials: ShieldAlert, doctors: Stethoscope, organization: Building2, settings: Settings };

// Menu único do celular: abre pelo botão do cabeçalho azul e reúne as seções da área atual,
// os demais módulos autorizados, a organização, a conta e a saída.
export default function MobileNavigation({ links, active, name, role }: {
  links: MobileLink[];
  active?: ModuleName;
  name: string;
  role: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const swipeRef = useRef<ReturnType<typeof attachMenuSwipe> | null>(null);
  const [open, setOpen] = useState(false);
  const otherModules = links.filter(link => link.id !== active);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  // Deslizar o dedo: para a esquerda abre o menu em qualquer tela; para a direita fecha.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const phone = window.matchMedia("(max-width:900px)");
    const swipe = attachMenuSwipe(dialog, {
      enabled: () => phone.matches,
      onOpen: () => { if (!dialog.open) dialog.showModal(); setOpen(true); },
      onClose: () => { dialog.close(); setOpen(false); },
    });
    swipeRef.current = swipe;
    return () => { swipe.detach(); swipeRef.current = null; };
  }, []);

  function openMenu() {
    // Pelo botão a gaveta entra com a animação normal, mesmo após um gesto.
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.style.animation = "";
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setOpen(true);
  }
  function closeMenu() {
    if (dialogRef.current?.open && swipeRef.current) { swipeRef.current.slideOut(); return; }
    dialogRef.current?.close();
    setOpen(false);
  }

  return <>
    <button className="mobile-menu-trigger no-print" type="button" onClick={openMenu}
      aria-haspopup="dialog" aria-expanded={open} aria-label="Abrir menu" title="Menu">
      <Menu size={23} aria-hidden="true" />
    </button>

    <dialog ref={dialogRef} className="mobile-app-menu no-print" aria-label="Menu"
      onClose={() => setOpen(false)}
      onClick={event => { if (event.target === dialogRef.current) closeMenu(); }}>
      <div className="mobile-app-menu-panel">
        <header className="mobile-app-menu-head">
          <div><span className="mobile-app-eyebrow">RN INTEGRA</span><h2>Menu</h2></div>
          <button className="mobile-app-menu-close" type="button" onClick={closeMenu} aria-label="Fechar menu"><X size={22}/></button>
        </header>
        <div className="mobile-app-account">
          <span className="mobile-app-account-avatar" aria-hidden="true">{name.replace(/^Dr[.]? */i, "").slice(0, 1).toUpperCase() || "U"}</span>
          <div><strong>{name}</strong><small>{role === "general_manager" ? "Gerente geral" : role === "doctor" ? "Médico" : role === "secretary" ? "Secretaria" : "Usuário"}</small></div>
        </div>
        {open && <div className="mobile-app-org"><OrganizationSwitcher /></div>}
        {active === "agenda" && <AgendaSectionLinks role={role} onNavigate={closeMenu} />}
        {(active === "billing" || active === "denials") && <BillingSectionLinks onNavigate={closeMenu} />}
        {(otherModules.length > 0 || role === "general_manager") && <nav className="mobile-app-menu-links" aria-label="Outras áreas autorizadas">
          <span className="mobile-app-menu-caption">ÁREAS</span>
          {otherModules.map(link => {
            const Icon = icons[link.id];
            return <a key={link.id} href={link.href}>
              <Icon size={20} aria-hidden="true"/><span>{link.label}</span><ChevronRight size={17} aria-hidden="true"/>
            </a>;
          })}
          {role === "general_manager" && <a href="/organizacao" aria-current={active === "organization" || active === "settings" ? "page" : undefined}><Settings size={20} aria-hidden="true"/><span>Configurações</span><ChevronRight size={17} aria-hidden="true"/></a>}
        </nav>}
        <div className="mobile-app-menu-footer"><span>Encerrar sessão</span><HubLogout/></div>
        <p className="mobile-app-legal"><a href="/termos">Termos de uso</a> · <a href="/privacidade">Privacidade</a></p>
      </div>
    </dialog>
  </>;
}
