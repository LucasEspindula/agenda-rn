import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const ui=read("app/billing/monthly-closing.tsx");
const css=read("app/billing/monthly-closing.css");
const print=read("app/api/reports/monthly-closing/print/route.ts");
const closing=read("app/api/billing/closing/route.ts");

test("cabeçalho apresenta Prévia e Fechar Mês, com o fechamento à direita",()=>{
 const head=ui.slice(ui.indexOf('<header className="monthly-heading no-print">'),
  ui.indexOf('<div className="monthly-filters no-print">'));
 assert.match(head,/<PrintIcon\/> Prévia<\/button>/);
 assert.match(head,/>Fechar Mês<\/button>/);
 assert.ok(head.indexOf("Prévia</button>")<head.indexOf("Fechar Mês</button>"));
 assert.match(head,/openPrint\("current"\)/);
 assert.match(head,/openPrint\("closed"\)/);
 assert.match(head,/setShowCloseDialog\(true\)/);
 assert.doesNotMatch(head,/Selecione a entidade recebedora e a competência/);
 assert.match(css,/\.monthly-header-actions\{display:flex/);
});
test("área destacada mantém filtros e remove subtítulos e aviso de cancelados",()=>{
 assert.doesNotMatch(ui,/<div className="monthly-report-heading">/);
 assert.doesNotMatch(ui,/<div className="monthly-attendance-count">/);
 assert.doesNotMatch(ui,/Fechar e bloquear mês/);
 assert.match(ui,/<div className="monthly-summary">/);
 assert.match(ui,/Atendimentos cancelados/);
});
test("somente fechamento confirmado pode ser marcado como registro mensal",()=>{
 assert.match(ui,/if\(!valid\|\|view==="closed"&&!preview\?\.closed\)return/);
 assert.match(ui,/action:"CLOSE"/);
 assert.match(ui,/const finalParams=new URLSearchParams/);
 assert.match(ui,/finalTab\.location\.replace\(/);
 assert.match(closing,/close_billing_month/);
 assert.match(print,/if\(view==="closed"&&!data\.closing\)return/);
 assert.match(print,/view==="closed"\?data\.closing\.snapshot:data\.current/);
});
test("marca d'água diagonal é impressa em todas as folhas, inclusive páginas extras",()=>{
 assert.match(print,/esc\(view==="closed"\?"REGISTRO MENSAL":"PRÉVIA"\)/);
 assert.match(print,/class="print-watermark" aria-hidden="true"/);
 assert.match(print,/\.print-watermark\{display:none\}/);
 assert.match(print,/@media print/);
 assert.match(print,/\.print-watermark\{display:block!important;position:fixed/);
 assert.match(print,/transform:translate\(-50%,-50%\) rotate\(-32deg\)/);
 assert.match(print,/pointer-events:none/);
 assert.match(print,/receiptChartPage/);
});
