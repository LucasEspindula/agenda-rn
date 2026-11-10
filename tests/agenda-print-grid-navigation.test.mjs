import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("blue mobile Agenda header exposes its own section menu with no duplicate white submenu",()=>{
 const header=source("components/site-header.tsx");
 const menu=source("components/agenda-section-menu.tsx");
 const hubCss=source("app/hub/hub.css");
 const legacyCss=source("public/legacy.css");
 const mobile=source("components/mobile-navigation.tsx");
 assert.match(header,/<MobileNavigation links=\{moduleLinks\(session\)\}[^>]*\/>\s*<\/header>/,"single menu trigger lives in the blue header");
 assert.doesNotMatch(header,/AgendaSectionMenu|BillingSectionMenu/);
 assert.match(mobile,/active === "agenda" && <AgendaSectionLinks role=\{role\} onNavigate=\{closeMenu\} \/>/);
 assert.match(menu,/<nav className="mobile-app-menu-links mobile-app-sections" aria-label="Seções da Agenda">/);
 assert.match(hubCss,/\.mobile-menu-trigger\{[\s\S]*?margin-left:auto/);
 assert.doesNotMatch(hubCss,/\.mobile-app-tabs/,"no second menu in a bottom tab bar");
 assert.match(legacyCss,/@media screen and \(max-width:900px\)\{\s*\.rn-agenda \.agenda-shell>\.agenda-subnav\{display:none!important\}/);
 assert.match(source("app/dashboard/legacy-body.ts"),/class="agenda-nav"/);
});

test("Agenda hamburger reuses real view handlers and respects role-specific sections",()=>{
 const menu=source("components/agenda-section-menu.tsx");
 const app=source("public/legacy-app.js");
 assert.match(menu,/role==="general_manager"\|\|role==="secretary"/);
 assert.match(menu,/view==="notifications"\)return role==="doctor"/);
 assert.match(menu,/!el\.classList\.contains\("hidden"\)/);
 assert.match(menu,/source\.click\(\)/);
 assert.match(menu,/new MutationObserver\(sync\)/);
 assert.match(menu,/document\.getElementById\("cancelledPageBtn"\)/,"Cancelados reuses the real button");
 assert.match(menu,/cancelled: "Cancelados"/);
 assert.match(app,/qsa\("\.agenda-nav-item"\)\.forEach\(b=>b\.onclick=\(\)=>showView\(b\.dataset\.view\)\)/);
 assert.match(app,/function showView\(view\)\{/);
});

test("Agenda PDF uses one chronological table per date, interleaving appointments and blocks",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 const pdf=source("lib/reports/pdf.ts");
 assert.match(report,/agendaTimeline\(appointments,blocks\)/);
 assert.match(report,/for\(const \[date,entries\] of groupByDay\(timeline\)\)/);
 assert.equal((report.match(/pdf\.dayHeading\(agendaDateLabel\(date\)\)/g)||[]).length,1);
 assert.equal((report.match(/pdf\.gridTable\(/g)||[]).length,1);
 assert.match(report,/if\(entry\.kind==='block'\)return \[/);
 assert.match(report,/entry\.block\.start\+' - '\+entry\.block\.end/);
 assert.match(report,/HORÁRIO BLOQUEADO/);
 assert.match(report,/Motivo: /);
 assert.match(report,/rowTints=entries\.map\(entry=>entry\.kind==='block'\?'blocked' as const:null\)/);
 assert.match(report,/pdf\.gridTable\(\[\s*\{label:'Horário',width:69\}/);
 assert.match(report,/\],rows,rowTints\)/);
 assert.doesNotMatch(report,/pdf\.section\('Horários bloqueados'/);
 assert.doesNotMatch(report,/\{label:'Data',width:/);
 assert.doesNotMatch(report,/pdf\.table\(/);
 assert.match(pdf,/dayHeading\(value:string\)/);
 assert.match(pdf,/rowTints:readonly \("replaced"\|"cancelled"\|"blocked"\|null\)\[\]/);
 assert.match(pdf,/tint==="blocked"\?rgb\(/);
 assert.match(pdf,/const factor=this\.contentWidth\/sum/);
 assert.match(pdf,/this\.addPage\(\);\s*drawHeader\(\)/);
});

test("Agenda PDF displays date, time and authenticated generator in the upper right",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 const pdf=source("lib/reports/pdf.ts");
 assert.match(report,/Gerado em: '\+brDateTime\(new Date\(\)\.toISOString\(\)\)/);
 assert.match(report,/Gerado por: '\+session\.account\.name/);
 assert.match(pdf,/rightDetails:string\[\]=\[\]/);
 assert.match(pdf,/this\.width-this\.margin-labelWidth/);
});

test("Agenda PDF center heading matches day, week and month selection",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 const pdf=source("lib/reports/pdf.ts");
 assert.match(report,/mode==='week'\?'Agenda da semana':mode==='month'\?'Agenda do mês':'Agenda do dia'/);
 assert.match(report,/\],centerTitle\);/);
 assert.match(pdf,/centerTitle\?:string/);
 assert.match(pdf,/this\.text\(centerTitle,\(this\.width-labelWidth\)\/2,this\.y-1,size,true\)/);
 assert.match(pdf,/centerTitle\?'RN Integra':'RN Integra · '\+title/);
});

test("Agenda printable data, period filters and permissions remain unchanged",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 const agenda=source("public/legacy-app.js");
 assert.match(report,/!session\.agendaIds\.includes\(professionalId\)/);
 assert.match(report,/appointmentInsurance\(item,patients\.get\(item\.patientId\)\)/);
 assert.match(report,/appointmentStatusLabel\(item\.status\)/);
 assert.match(report,/item\.status!=='cancelled'/);
 assert.match(report,/\['day','week','month'\]/);
 assert.match(agenda,/window\.open\("\/api\/reports\/agenda\?"/);
 assert.match(agenda,/function renderMobileCalendar\(\)/);
 assert.match(agenda,/class="mobile-day-list"/);
});

test("Agenda PDF shows the recorded amount to staff, without exposing it to doctors or blocked slots",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 assert.match(report,/individualReceived\(row\)/);
 assert.match(report,/session\.account\.role!=='doctor'/);
 assert.match(report,/row\.record\.professional_id!==professionalId/);
 assert.match(report,/countedRecords\.has\(row\.record\.id\)/);
 assert.match(report,/brl\(valuesByAppointment\.get\(item\.id\)\)/);
 assert.match(report,/\{label:'Valor',width:69,align:'right'\}/);
 assert.match(report,/if\(entry\.kind==='block'\)return \[/);
 assert.doesNotMatch(report,/item\.payment/);
});
