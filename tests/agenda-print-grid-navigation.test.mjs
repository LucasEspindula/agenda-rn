import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("blue mobile Agenda header exposes its own section menu with no duplicate white submenu",()=>{
 const header=source("components/site-header.tsx");
 const menu=source("components/agenda-section-menu.tsx");
 const hubCss=source("app/hub/hub.css");
 const legacyCss=source("public/legacy.css");
 assert.match(header,/active==='agenda'&&<AgendaSectionMenu role=\{account\.role\}\/>/);
 assert.match(menu,/<details className="agenda-header-sections"/);
 assert.match(menu,/<summary title="Áreas da Agenda" aria-label="Abrir menu de seções da Agenda">/);
 assert.match(hubCss,/\.hub-header \.agenda-header-sections\{[\s\S]*?margin-left:auto/);
 assert.match(hubCss,/\.agenda-header-sections:not\(\[open\]\)>\.agenda-header-sections-list\{display:none\}/);
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
 assert.match(menu,/event\.key==="Escape"/);
 assert.match(app,/qsa\("\.agenda-nav-item"\)\.forEach\(b=>b\.onclick=\(\)=>showView\(b\.dataset\.view\)\)/);
 assert.match(app,/function showView\(view\)\{/);
});

test("Agenda PDF uses edge-to-edge landscape grid tables with repeated headers",()=>{
 const report=source("app/api/reports/agenda/route.ts");
 const pdf=source("lib/reports/pdf.ts");
 assert.match(report,/pdf\.section\('Atendimentos'\);pdf\.gridTable\(/);
 assert.match(report,/pdf\.section\('Horários bloqueados'/);
 assert.match(report,/pdf\.gridTable\(\[\{label:'Data',width:110\}/);
 assert.doesNotMatch(report,/pdf\.table\(/);
 assert.match(pdf,/const factor=this\.contentWidth\/sum/);
 assert.match(pdf,/const widths=columns\.map\(c=>c\.width\*factor\)/);
 assert.match(pdf,/width:this\.contentWidth,height:headerHeight/);
 assert.match(pdf,/drawHeader\(\);\s*for\(const \[rowIndex,values\] of rows\.entries\(\)\)/);
 assert.match(pdf,/this\.addPage\(\);\s*drawHeader\(\)/);
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
