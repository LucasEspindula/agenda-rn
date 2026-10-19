import { NavIcon } from "@/components/billing-icons";

export type BillingNavigationView =
  | "records"
  | "invoices"
  | "insurance"
  | "denials"
  | "closing"
  | "expenses"
  | "entities"
  | "logs"
  | "perseu";

const items: [Exclude<BillingNavigationView, "perseu">, string, string][] = [
  ["records", "Atendimentos", "/billing"],
  ["invoices", "Notas Fiscais", "/billing?view=invoices"],
  ["insurance", "Convênios", "/billing?view=insurance"],
  ["expenses", "Despesas", "/billing?view=expenses"],
];

export default function BillingSubnav({
  active,
  pendingCount = 0,
  insurancePendingCount = 0,
  perseusEnabled = false,
  denialsEnabled = false,
  closingEnabled = false,
}: {
  active: BillingNavigationView;
  pendingCount?: number;
  insurancePendingCount?: number;
  perseusEnabled?: boolean;
  denialsEnabled?: boolean;
  closingEnabled?: boolean;
}) {
  return (
    <div className="billing-subnav no-print">
      <nav className="billing-subnav-nav" aria-label="Visões de faturamento">
        <div className="billing-subnav-financial">
          {items.map(([id, label, href]) => (
            <a
              key={id}
              href={href}
              aria-current={active === id ? "page" : undefined}
            >
              <NavIcon kind={id} />
              {label}
              {id === "invoices" && pendingCount > 0 && (
                <span className="fiscal-count">{pendingCount}</span>
              )}
              {id === "insurance" && insurancePendingCount > 0 && (
                <span className="fiscal-count">{insurancePendingCount}</span>
              )}
            </a>
          ))}
          {denialsEnabled && (
            <a href="/billing/glosas" aria-current={active === "denials" ? "page" : undefined}>
              <NavIcon kind="insurance" />Glosas
            </a>
          )}
          <a href="/billing?view=entities" aria-current={active === "entities" ? "page" : undefined}>
            <NavIcon kind="entities" />Entidades recebedoras
          </a>
        </div>
        <div className="billing-subnav-fixed">
          {closingEnabled && (
            <a href="/billing/fechamento" aria-current={active === "closing" ? "page" : undefined}>
              <NavIcon kind="billing" />Fechamento mensal
            </a>
          )}
          <a href="/billing?view=logs" aria-current={active === "logs" ? "page" : undefined}>
            <NavIcon kind="logs" />Logs Faturamento
          </a>
        </div>
      </nav>
    </div>
  );
}
