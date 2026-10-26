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
 assert.match(expense,/onClick=\{\(\)=>open\(\)\}><span className="billing-fab-icon"/);
 assert.match(denial,/className="billing-primary billing-mobile-fab" aria-label="Registrar glosa"/);
 assert.match(denial,/onClick=\{\(\)=>open\("OPEN_CASE"\)\}/);
 assert.match(billing,/className="billing-primary billing-mobile-fab"/);
 assert.match(billing,/aria-label="Cadastrar entidade recebedora"/);
});

test("new notes plus is mobile-only and doesn't create notes until workflow is defined",()=>{
 const s=read("app/billing/billing-client.tsx");
 const css=read("app/billing/billing.css");
 assert.match(s,/className="billing-mobile-fab billing-invoice-future-add"/);
 assert.match(s,/onClick=\{\(\)\s*=>\s*setMobileInvoiceAddInfo\(true\)\}/);
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


test("all floating billing create buttons use real Plus vector icons instead of pseudo text",()=>{
 const css=read("app/billing/billing.css");
 const paths=["app/billing/company-finance.tsx","app/billing/denial-manager.tsx","app/billing/billing-client.tsx"];
 for(const path of paths){
  const source=read(path);
  assert.match(source,/import \{[^}]*Plus[^}]*\} from ['"]lucide-react['"]/,path);
  assert.match(source,/<Plus size=\{27\}\/>/,path);
  assert.match(source,/className="billing-fab-icon"/,path);
  assert.match(source,/className="billing-fab-label"/,path);
 }
 const count=paths.reduce((total,path)=>total+(read(path).match(/<Plus size=\{27\}\/>/g)||[]).length,0);
 assert.equal(count,5,"plus icons for expenses, denials, entities, attendance and fiscal additions");
 assert.match(css,/\.rn-hub button\.billing-mobile-fab \.billing-fab-icon\{[\s\S]*?display:grid!important;/);
 assert.match(css,/\.rn-hub button\.billing-mobile-fab \.billing-fab-label\{display:none!important\}/);
 assert.doesNotMatch(css,/button\.billing-mobile-fab:not\(\.billing-invoice-future-add\)::before/);
});

test("billing mobile screens with floating add reserve space below the final card",()=>{
 const css=read("app/billing/billing.css");
 assert.match(css,/main\.billing-main:has\(button\.billing-mobile-fab\)\{\s*padding-bottom:calc\(178px \+ env\(safe-area-inset-bottom,0px\)\)!important;/);
 assert.match(css,/bottom:calc\(86px \+ env\(safe-area-inset-bottom,0px\)\)/);
 assert.match(read("app/hub/hub.css"),/padding-bottom:calc\(76px \+ env\(safe-area-inset-bottom,0px\)\)/);
});

test("mobile invoice placeholder reuses the native bottom-anchored action sheet",()=>{
 const client=read("app/billing/billing-client.tsx");
 const css=read("app/billing/billing.css");
 assert.match(client,/AppDialog label="Nova operação de Nota Fiscal" compact className="billing-mobile-actions-dialog billing-invoice-info-dialog"/);
 assert.match(client,/Nenhuma nota foi criada ou alterada/);
 assert.match(css,/dialog\.billing-modal\.billing-mobile-actions-dialog\{[\s\S]*?position:fixed;[\s\S]*?inset:auto 0 0;/);
 assert.match(client,/onClick=\{\(\)\s*=>\s*setMobileInvoiceAddInfo\(true\)\}/);
});


test("Atendimentos uses the shared bottom-right Plus only on the mobile records tab",()=>{
 const source=read("app/billing/billing-client.tsx");
 const css=read("app/billing/billing.css");
 assert.match(source,/className=\{"billing-icon-action billing-add"\+\(tab === "invoices" \? " billing-existing-invoice-add" : ""\)\+\(tab === "records" \? " billing-mobile-fab" : ""\)\}/);
 assert.match(source,/title=\{tab === "invoices" \? "Nova NF \/ lote" : "Novo atendimento"\}/);
 assert.match(source,/tab === "invoices" \? editInvoice\(\) : setManual\(true\)/);
 assert.match(source,/<span className="billing-fab-icon" aria-hidden="true"><Plus size=\{27\}\/><\/span>/);
 assert.match(source,/<span className="billing-fab-label">\+<\/span>/);
 assert.match(css,/\.rn-hub \.billing-main button\.billing-mobile-fab,[\s\S]*?position:fixed;[\s\S]*?right:16px;[\s\S]*?bottom:calc\(86px \+ env\(safe-area-inset-bottom,0px\)\)/);
});

test("Cadastros doctor and hospital create buttons float on mobile without changing their handlers",()=>{
 const doctors=read("app/doctors/doctor-directory.tsx");
 const hospitals=read("app/doctors/hospital-directory.tsx");
 const css=read("app/billing/billing.css");
 assert.match(doctors,/className="billing-primary billing-mobile-fab" aria-label="Cadastrar médico"/);
 assert.match(doctors,/onClick=\{\(\)=>open\('doctor',\{name:''/);
 assert.match(doctors,/className="billing-fab-label">Cadastrar médico<\/span>/);
 assert.match(hospitals,/className="billing-primary billing-mobile-fab" aria-label="Cadastrar hospital"/);
 assert.match(hospitals,/disabled=\{loading\|\|busy\} onClick=\{\(\)=>open\(\)\}/);
 assert.match(hospitals,/className="billing-fab-label">\+ Cadastrar hospital<\/span>/);
 for(const source of [doctors,hospitals]){
  assert.match(source,/import \{[^}]*Plus[^}]*\} from ['"]lucide-react['"]/);
  assert.match(source,/<Plus size=\{27\}\/>/);
  assert.match(source,/<main className="billing-main">/);
 }
 assert.match(css,/main\.billing-main:has\(button\.billing-mobile-fab\)\{\s*padding-bottom:calc\(178px \+ env\(safe-area-inset-bottom,0px\)\)!important;/);
 assert.match(css,/\.rn-hub button\.billing-mobile-fab \.billing-fab-label\{display:none!important\}/);
 assert.match(css,/\.rn-hub \.billing-fab-icon\{display:none\}/);
});
