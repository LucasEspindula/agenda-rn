import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const js=readFileSync("public/legacy-app.js","utf8");
const css=readFileSync("public/legacy.css","utf8");
const begin=js.indexOf("function appointmentPendingFlags(a){");
const end=js.indexOf("function renderGuideAlerts(){",begin);
assert.ok(begin>=0&&end>begin,"O cálculo compartilhado de pendências deve existir");
const helpers=js.slice(begin,end);

function evaluate(appointment,{role="secretary",invoices={}}={}){
 const context={
  window:{AgendaAuth:{role}},
  financialInvoices:invoices,
  ds:()=>"2026-10-27",
  daysUntil:date=>date?Math.round((Date.parse(date+"T12:00:00Z")-Date.parse("2026-10-27T12:00:00Z"))/86400000):null,
  esc:value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))
 };
 return runInNewContext(helpers+"\n({flags:appointmentPendingFlags(appointment),badge:appointmentPendingBadge(appointment),reasons:appointmentPendingReasons(appointment)})",{...context,appointment});
}

const base={id:"appointment-1",date:"2026-10-28",time:"09:00",status:"scheduled",guideExpiry:"2026-11-20",invoiceNumber:""};

test("indicadores herdam precisamente as quatro categorias do sino",()=>{
 const near=evaluate({...base,guideExpiry:"2026-10-29"});
 assert.equal(near.flags.guide,true);
 assert.equal(near.flags.confirmation,true);
 assert.equal(near.flags.missingGuide,false);
 assert.equal(near.flags.invoice,false);
 const missing=evaluate({...base,guideExpiry:""});
 assert.equal(missing.flags.missingGuide,true);
 assert.equal(missing.flags.guide,false);
 const invoice=evaluate({...base,date:"2026-10-24",status:"realized",guideExpiry:""});
 assert.equal(invoice.flags.invoice,true);
 assert.equal(evaluate({...base,date:"2026-10-24",status:"realized"},{invoices:{"appointment-1":"NF-123"}}).flags.invoice,false);
});

test("médicos não recebem o indicador visual, mesmo com pendências operacionais",()=>{
 const secretary=evaluate({...base,guideExpiry:""});
 assert.match(secretary.badge,/card-pending-mark/);
 assert.match(secretary.badge,/role="img"/);
 assert.match(secretary.badge,/>!<\/span>/);
 const doctor=evaluate({...base,guideExpiry:""},{role:"doctor"});
 assert.equal(doctor.badge,"");
 const clear=evaluate({...base,date:"2026-11-20",status:"confirmed",guideExpiry:"2026-12-15"});
 assert.equal(clear.badge,"");
});

test("desktop, mobile e detalhes posicionam a marca no campo correspondente",()=>{
 const card=js.slice(js.indexOf("function appointmentCard(a,hour"),js.indexOf("function renderPatients("));
 const mobile=js.slice(js.indexOf("function mobileCalendarCard("),js.indexOf("function renderMobileCalendar("));
 const detail=js.slice(js.indexOf("function renderAppointmentDetail(a){"),js.indexOf("function setAppointmentViewMode(",js.indexOf("function renderAppointmentDetail(a){")));
 assert.match(card,/appointmentPendingBadge\(a\)/);
 assert.match(mobile,/appointmentPendingBadge\(a\)/);
 assert.match(detail,/detailGuideExpiry/);
 assert.match(detail,/pending\?\.missingGuide\|\|pending\?\.guide/);
 assert.match(detail,/pending\?\.confirmation/);
 assert.match(detail,/pending\?\.invoice/);
 assert.match(detail,/const pending=isDoctor\?null:appointmentPendingFlags\(a\)/);
 assert.match(css,/\.appointment \.card-pending-mark\{/);
 assert.match(css,/\.mobile-appointment \.card-pending-mark\{/);
 assert.match(css,/\.detail-pending-target \.detail-pending-mark\{/);
 assert.match(css,/\.native-finance\.pending-finance::after\{content:"!"/);
});

test("sino e marcas compartilham critérios sem consultas extras nos cartões",()=>{
 const alerts=js.slice(js.indexOf("function renderGuideAlerts(){"),js.indexOf("function updateNotificationCenter(){"));
 for(const key of ["invoice","missingGuide","confirmation","guide"]){
  assert.match(alerts,new RegExp("appointmentPendingFlags\\(a\\)\\."+key));
 }
 const renderer=js.slice(js.indexOf("function appointmentCardContent("),js.indexOf("function renderPatients("));
 assert.doesNotMatch(renderer,/fetch\(|\/api\/billing|\/api\/state/);
});


test("selo de pendência pode ultrapassar discretamente o canto superior dos cartões",()=>{
 assert.match(css,/\.appointment\.has-pending\{overflow:visible;z-index:5\}/);
 assert.match(css,/\.appointment \.card-pending-mark\{[^}]*top:-7px;right:-7px;/);
 assert.match(css,/\.mobile-appointment\.has-pending\{position:relative;z-index:1;overflow:visible\}/);
 assert.match(css,/\.mobile-appointment \.card-pending-mark\{[^}]*top:-6px;right:-6px;/);
});
