import PerseusMark from "@/components/perseus-mark";
import { NavIcon } from "@/components/billing-icons";

export type BillingNavigationView =
  | "records"
  | "invoices"
  | "insurance"
  | "expenses"
  | "entities"
  | "logs"
  | "perseu";

const items: [Exclude<BillingNavigationView, "perseu">, string, string][] = [
  ["records", "Atendimentos", "/billing"],
  ["invoices", "Notas Fiscais", "/billing?view=invoices"],
  ["insurance", "Convênios", "/billing?view=insurance"],
  ["expenses", "Despesas", "/billing?view=expenses"],
  ["entities", "Entidades recebedoras", "/billing?view=entities"],
  ["logs", "Logs Faturamento", "/billing?view=logs"],
];

export default function BillingSubnav({
  active,
  pendingCount = 0,
  insurancePendingCount = 0,
}: {
  active: BillingNavigationView;
  pendingCount?: number;
  insurancePendingCount?: number;
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
        </div>
        <a
          className="billing-subnav-perseus"
          href="/perseu"
          aria-current={active === "perseu" ? "page" : undefined}
        >
          <PerseusMark size={22} />
          <span>Perseu</span>
        </a>
      </nav>
    </div>
  );
}
