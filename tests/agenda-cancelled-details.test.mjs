import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync("public/legacy-app.js","utf8");
const start=source.indexOf("function cancelledBillingLabel(");
const end=source.indexOf("\nfunction money(",start);
assert.ok(start>=0&&end>start,"O renderizador de cancelamentos deve existir");
const renderer=source.slice(start,end);

function render(role,billingMethod,notes="<observação>"){
 const container={innerHTML:"",insertAdjacentHTML(_,html){this.innerHTML+=html}};
 const appointment={
  id:"cancel-1",patientId:"patient-1",doctorId:"doctor-1",date:"2026-10-20",time:"09:30",
  forma_cobranca:billingMethod,insurance:"UNIMED",cancelledAt:"2026-10-22T11:00:00Z",
  cancelReason:"Desistência",payment:170,invoiceNumber:"NF-42",notes,rescheduleHistory:[{reason:"Remarcado"}]
 };
 const context={
  window:{AgendaAuth:{role}},state:{cancelledAppointments:[appointment]},
  $:()=>container,selectedProf:()=>({id:"doctor-1"}),isAnesthesiologist:()=>false,
  patient:()=>({name:"Paciente Exemplo"}),hospital:()=>({name:"Hospital Central"}),
  parseDate:value=>new Date(value+"T12:00:00"),workflowDate:()=>"22/10/2026 08:00",
  money:()=> "R$ 170,00",renderCancelledOwner:()=>{},agendaWindowNote:()=>"",bindAgendaWindowButtons:()=>{},renderRescheduleHistory:()=>'<section class="appointment-reschedule-history">Histórico</section>',
  agendaLogSnapshot:a=>({
   procedure:"Cirurgia",place:"HC",insurance:a.insurance,doctor:"Dra. Teste",anesthetist:"Dr. Anestesista",
   status:"Confirmado",duration:"60 min",guideExpiry:"25/10/2026",careType:"Ambulatorial",
   opme:"Não",reports:"Sim",exams:"Não",notes:a.notes
  }),
  esc:value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]))
 };
 runInNewContext(renderer+"\nrenderCancelled();",context);
 return container.innerHTML;
}

test("Cancelados apresenta forma de cobrança sem confundi-la com o plano",()=>{
 const convenio=render("secretary","CONVENIO");
 assert.match(convenio,/<th>Forma de cobrança<\/th>/);
 assert.match(convenio,/>Convênio<\/span>/);
 assert.match(convenio,/>UNIMED<\/dd>/);
 const particular=render("secretary","PARTICULAR");
 assert.match(particular,/>Particular<\/span>/);
 assert.match(particular,/NF-42/);
 const unknown=render("secretary",null);
 assert.match(unknown,/>Não informado<\/span>/);
 assert.doesNotMatch(unknown,/>Convênio<\/span>/);
});

test("Cancelados disponibiliza informações clínicas e histórico em detalhes acessíveis",()=>{
 const html=render("general_manager","CONVENIO");
 for(const label of ["Procedimento","Hospital","Médico","Anestesista","Duração","Validade da guia","Tipo de atendimento","OPME","Laudos","Exames","Observações","Status antes do cancelamento"]){
  assert.ok(html.includes(label),`Campo ausente: ${label}`);
 }
 assert.match(html,/<details class="cancel-details"><summary>Ver detalhes<\/summary>/);
 assert.match(html,/Histórico<\/section>/);
 assert.match(html,/&lt;observação&gt;/);
 assert.doesNotMatch(html,/<observação>/);
});

test("Cancelados não apresenta valores e NF para o perfil médico",()=>{
 const html=render("doctor","PARTICULAR");
 assert.match(html,/<th>Forma de cobrança<\/th>/);
 assert.doesNotMatch(html,/<th>Valor<\/th>/);
 assert.doesNotMatch(html,/<th>NF<\/th>/);
 assert.doesNotMatch(html,/NF-42|R\$ 170,00/);
});

test("Cancelados oferece layout de cartões no mobile",()=>{
 const css=readFileSync("public/legacy.css","utf8");
 assert.match(css,/@media\(max-width:720px\)[\s\S]*?#cancelledList \.cancel-table thead\{display:none\}/);
 assert.match(css,/#cancelledList \.cancel-table td::before\{content:attr\(data-label\)/);
});
