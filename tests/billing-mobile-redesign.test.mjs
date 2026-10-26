import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('billing mobile section dropdown reuses authorized page navigation, same shell as Agenda',()=>{
 const site=read('components/site-header.tsx');
 const menu=read('components/billing-section-menu.tsx');
 const css=read('app/hub/hub.css');
 assert.match(site,/active==='billing'\|\|active==='denials'/);
 assert.match(site,/<BillingSectionMenu\/>/);
 assert.match(menu,/className="agenda-header-sections billing-header-sections"/);
 assert.match(menu,/\.billing-subnav \.billing-subnav-nav/);
 assert.match(menu,/aria-current/);
 assert.match(menu,/item\.button\?\.click\(\)/);
 assert.match(menu,/onKeyDown=\{e=>\{if\(e\.key==="Escape"/);
 assert.match(css,/\.billing-header-sections \.billing-header-link/);
 assert.match(read('app/billing/billing.css'),/\.rn-hub \.billing-subnav\{display:none!important\}/);
});

test('mobile billing records are labeled cards, without mutating React-owned content',()=>{
 const enhancer=read('components/billing-mobile-tables.tsx');
 const css=read('app/billing/billing.css');
 assert.match(enhancer,/MutationObserver\(schedule\)/);
 assert.match(enhancer,/table\.tHead\?\.rows\[0\]\?\.cells/);
 assert.match(enhancer,/setAttribute\("data-mobile-label",label\)/);
 assert.match(enhancer,/billing-main:not\(\.billing-mobile-no-cards\) table\.billing-table/);
 assert.match(enhancer,/table\.closest\("dialog, \[data-billing-mobile-skip\]"\)/);
 assert.match(css,/table\.billing-mobile-card-table>tbody>tr\{[\s\S]*?border-radius:13px/);
 assert.match(css,/content:attr\(data-mobile-label\)/);
 assert.match(css,/table\.billing-mobile-card-table>tbody>tr>td:first-child/);
 assert.match(css,/@media screen and \(max-width:900px\)/);
});

test('all requested billing modules keep their data tables while becoming card eligible',()=>{
 for(const path of ['app/billing/billing-client.tsx','app/billing/invoice-requests.tsx','app/billing/insurance-pending.tsx','app/billing/company-finance.tsx','app/billing/denial-manager.tsx','app/billing/monthly-closing.tsx','app/billing/portal-submissions.tsx','app/billing/doctor-billing.tsx']){
  assert.match(read(path),/className="billing-table|className=\{'billing-table |className="billing-table [^"]*|className=\{"billing-table/,path);
 }
});

test('fiscal request, invoice, attendance and recipient actions retain handlers inside mobile dialog',()=>{
 const client=read('app/billing/billing-client.tsx');
 const request=read('app/billing/invoice-requests.tsx');
 const dialog=read('components/mobile-row-actions.tsx');
 assert.match(dialog,/AppDialog label=\{label\}/);
 assert.match(dialog,/onClick=\{\(\)=>setOpen\(true\)\}/);
 assert.match(dialog,/onClick=\{event=>/);
 assert.match(client,/<MobileRowActions label=\{"Ações da NF " \+ i\.invoice_number\}>/);
 assert.match(client,/<MobileRowActions label=\{"Ações de " \+ e\.name\}>/);
 assert.match(client,/<MobileRowActions label=\{"Ações de "\+r\.patient\}>/);
 assert.match(request,/<MobileRowActions label=\{"Ações da solicitação de "\+r\.patient_name_snapshot\}>/);
 for(const action of ['editInvoice(i)','setHistoryInvoice(i)','askFiscal(','askDelete("entity", e, e.name)','onIssue(r)','onEdit(r)'])assert.ok(client.includes(action)||request.includes(action),action);
});

test('insurance tabs share invoice navigation layout and display icons',()=>{
 const client=read('app/billing/billing-client.tsx');
 const css=read('app/billing/billing.css');
 assert.match(client,/aria-label="Notas Fiscais"/);
 assert.match(client,/aria-label="Convênios"/);
 assert.match(client,/setInsuranceView\("payments"\)\}><NavIcon kind="requests" \/>/);
 assert.match(client,/setInsuranceView\("portal"\)\}><NavIcon kind="insurance" \/>/);
 assert.match(css,/\.rn-hub \.billing-tabs\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('monthly closing buttons align to the right; Logs remains unmodified',()=>{
 const css=read('app/billing/billing.css');
 const monthly=read('app/billing/monthly-closing.tsx');
 const main=read('app/billing/billing-client.tsx');
 assert.match(css,/\.rn-hub \.monthly-header-actions\{[\s\S]*?justify-content:flex-end;[\s\S]*?margin-left:auto;/);
 assert.match(monthly,/className="billing-secondary monthly-preview-button"/);
 assert.match(monthly,/className="billing-primary monthly-final-button"/);
 assert.match(main,/tab === "logs" \? " billing-mobile-no-cards" : ""/);
 assert.match(main,/data-billing-mobile-skip><BillingLogs/);
 assert.doesNotMatch(read('components/billing-mobile-tables.tsx'),/\.billing-logs table/);
});
