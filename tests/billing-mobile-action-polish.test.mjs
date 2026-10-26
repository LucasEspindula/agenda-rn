import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("native mobile action dialogs are pinned to screen bottom, never centered",()=>{
 const css=read("app/billing/billing.css");
 assert.match(css,/dialog\.billing-modal\.billing-mobile-actions-dialog\{[\s\S]*?position:fixed;[\s\S]*?inset:auto 0 0;[\s\S]*?margin:0 auto;[\s\S]*?border-radius:20px 20px 0 0;/);
 assert.match(css,/dialog\.billing-mobile-actions-dialog::backdrop\{background:/);
 assert.match(read("components/mobile-row-actions.tsx"),/className="billing-mobile-actions-dialog"/);
});

test("mobile action buttons align right and show a task icon instead of three dots",()=>{
 const css=read("app/billing/billing.css");
 const component=read("components/mobile-row-actions.tsx");
 assert.match(css,/td\.billing-mobile-actions-cell\{[\s\S]*?align-items:flex-end;/);
 assert.match(css,/\.billing-mobile-row-actions\{[\s\S]*?justify-content:flex-end;/);
 assert.match(css,/td\.billing-mobile-actions-cell>button\{[\s\S]*?margin-left:auto;/);
 assert.match(component,/import \{ListChecks\} from "lucide-react"/);
 assert.match(component,/<ListChecks size=\{18\} aria-hidden="true"\/> Ações/);
 assert.doesNotMatch(component,/Ellipsis/);
 const denial=read("app/billing/denial-manager.tsx");
 assert.match(denial,/<MobileRowActions label=\{"Ações de glosa para "\+c\.patient\}>/);
 assert.match(denial,/setExpanded\(x=>x===c\.id\?null:c\.id\)/);
});

test("invoice submenu name strips the pending count badge without losing link labels",()=>{
 const menu=read("components/billing-section-menu.tsx");
 assert.match(menu,/el\.childNodes/);
 assert.match(menu,/node\.nodeType===Node\.TEXT_NODE/);
 assert.doesNotMatch(menu,/label:\(el\.textContent\|\|""\)/);
 assert.match(read("app/billing/billing-subnav.tsx"),/className="fiscal-count"/);
});

test("insurance tab labels are concise and still retain their old handlers and icons",()=>{
 const s=read("app/billing/billing-client.tsx");
 assert.match(s,/setInsuranceView\("payments"\)\}><NavIcon kind="requests" \/> Pendências<\/button>/);
 assert.match(s,/setInsuranceView\("portal"\)\}><NavIcon kind="insurance" \/> Registro de Guias<\/button>/);
 assert.match(s,/aria-label="Convênios"/);
});

test("expense table uses independent headers and cells on desktop and mobile",()=>{
 const s=read("app/billing/company-finance.tsx");
 for(const heading of ["Categoria","Competência","Valor","Vencimento","Pagamento","Pago por"])
  assert.ok(s.includes("<th>"+heading+"</th>"),"missing heading "+heading);
 assert.doesNotMatch(s,/<th>Categoria \/ competência<\/th>|<th>Valor \/ vencimento<\/th>|<th>Pagamento \/ pago por<\/th>/);
 assert.match(s,/<td>\{e\.category\|\|"—"\}<\/td><td>\{formatDateBR\(e\.competence_date\)\}<\/td><td>\{currency\(e\.amount\)\}<\/td><td>\{formatDateBR\(e\.due_date\)\}<\/td><td>\{formatDateBR\(e\.paid_at\)\}<\/td><td>\{expensePayer\(data,e\)\}<\/td>/);
});

test("mobile floating additions reuse real actions for expenses, denials and recipients",()=>{
 const css=read("app/billing/billing.css");
 const expense=read("app/billing/company-finance.tsx");
 const denial=read("app/billing/denial-manager.tsx");
 const billing=read("app/billing/billing-client.tsx");
 assert.match(css,/button\.billing-mobile-fab\{[\s\S]*?position:fixed;[\s\S]*?right:16px;[\s\S]*?bottom:calc\(86px \+ env\(safe-area-inset-bottom,0px\)\);[\s\S]*?border-radius:50%;/);
 assert.match(expense,/className="billing-icon-action billing-mobile-fab" aria-label="Nova despesa"/);
 assert.match(expense,/onClick=\{\(\)=>open\(\)\}>\+/);
 assert.match(denial,/className="billing-primary billing-mobile-fab" aria-label="Registrar glosa"/);
 assert.match(denial,/onClick=\{\(\)=>open\("OPEN_CASE"\)\}/);
 assert.match(billing,/className="billing-primary billing-mobile-fab"/);
 assert.match(billing,/aria-label="Cadastrar entidade recebedora"/);
});

test("new notes plus is mobile-only and doesn't create notes until workflow is defined",()=>{
 const s=read("app/billing/billing-client.tsx");
 const css=read("app/billing/billing.css");
 assert.match(s,/className="billing-mobile-fab billing-invoice-future-add"/);
 assert.match(s,/onClick=\{\(\)=>setMobileInvoiceAddInfo\(true\)\}/);
 assert.match(s,/Nenhuma nota foi criada ou alterada/);
 assert.match(css,/@media screen and \(min-width:901px\)\{\s*\.rn-hub \.billing-invoice-future-add\{display:none!important\}/);
 assert.match(css,/\.billing-filter-action \.billing-existing-invoice-add\{display:none!important\}/);
 assert.match(s,/editInvoice\(\)/); // existing desktop creation flow remains intact
});

test("Logs Faturamento and monthly closing operations remain unchanged",()=>{
 const s=read("app/billing/billing-client.tsx");
 assert.match(s,/tab === "logs" \? " billing-mobile-no-cards" : ""/);
 assert.match(s,/data-billing-mobile-skip><BillingLogs data=\{data\}/);
 assert.match(read("app/billing/monthly-closing.tsx"),/className="billing-primary monthly-final-button"/);
});
