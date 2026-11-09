"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, CalendarDays, ChevronRight, Menu, Settings, ShieldAlert, Stethoscope, Wallet, X } from "lucide-react";
import OrganizationSwitcher from "@/components/organization-switcher";
import HubLogout from "@/app/hub/hub-logout";
import type { ModuleName } from "@/lib/navigation";

type MobileLink = { id: ModuleName; href: string; label: string };
const icons = { agenda: CalendarDays, billing: Wallet, denials: ShieldAlert, doctors: Stethoscope, organization: Building2, settings: Settings };
const shortLabels: Record<ModuleName, string> = {
  agenda: "Agenda", billing: "Faturamento", denials: "Glosas", doctors: "Cadastros", organization: "Organização", settings: "Ajustes",
};

export default function MobileNavigation({ links, active, name, role }: {
  links: MobileLink[];
  active?: ModuleName;
  name: string;
  role: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const tabs = links.slice(0, 3);
  const overflowLinks = links.filter(link => !tabs.some(tab => tab.id === link.id));

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  function openMenu() {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setOpen(true);
  }
  function closeMenu() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return <>
    <nav className="mobile-app-tabs no-print" aria-label="Navegação principal do celular">
      {tabs.map(link => {
        const Icon = icons[link.id];
        return <a key={link.id} href={link.href} className="mobile-app-tab" aria-current={active === link.id ? "page" : undefined}>
          <Icon size={21} aria-hidden="true" strokeWidth={active === link.id ? 2.35 : 1.8} />
          <span>{shortLabels[link.id]}</span>
        </a>;
      })}
      <button className="mobile-app-tab mobile-app-more" type="button" onClick={openMenu}
        aria-haspopup="dialog" aria-expanded={open} aria-label="Abrir menu de navegação">
        <Menu size={22} aria-hidden="true" />
        <span>Menu</span>
      </button>
    </nav>

    <dialog ref={dialogRef} className="mobile-app-menu no-print" aria-label="Menu de navegação"
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
        <nav className="mobile-app-menu-links" aria-label="Todas as áreas autorizadas">
          {overflowLinks.map(link => {
            const Icon = icons[link.id];
            return <a key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined}>
              <Icon size={20} aria-hidden="true"/><span>{link.label}</span><ChevronRight size={17} aria-hidden="true"/>
            </a>;
          })}
          {role === "general_manager" && <a href="/organizacao" aria-current={active === "organization" || active === "settings" ? "page" : undefined}><Settings size={20} aria-hidden="true"/><span>Configurações</span><ChevronRight size={17} aria-hidden="true"/></a>}
        </nav>
        <div className="mobile-app-menu-footer"><span>Encerrar sessão</span><HubLogout/></div>
        <p className="mobile-app-legal"><a href="/termos">Termos de uso</a> · <a href="/privacidade">Privacidade</a></p>
      </div>
    </dialog>
  </>;
}
