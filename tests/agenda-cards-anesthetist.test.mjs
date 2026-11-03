import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Cartões da agenda adaptados à duração e fluxo do anestesista no formulário.
const source=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/legacy.css',import.meta.url),'utf8');
const ast=ts.createSourceFile('legacy.js',source,ts.ScriptTarget.Latest,true);
const names=new Set(['appointmentCard','appointmentCardContent','appointmentPartner','doctorName','anesthetistOverlapWarnings','detailRelatedOptions','canAccessProfessional','overlap']);
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name.text)).map(n=>n.getText(ast)).join('\n');

function fixture({role='general_manager',agendaIds=[]}={}){
 const surgeon={id:'s',name:'Dra. Ana Teste',specialty:'Cardiologia'},other={id:'o',name:'Bruno Teste',specialty:'Ortopedia e Traumatologia'};
 const carlos={id:'c',name:'Dr. Carlos',specialty:'Anestesiologia'},lia={id:'l',name:'Dra. Lia',specialty:'Anestesiologia'};
 const base={id:'a1',doctorId:'s',anesthetistId:'c',patientId:'p',hospitalId:'h',date:'2026-11-10',time:'10:00',duration:60,status:'confirmed',procedure:'Cateterismo'};
 const busy={...base,id:'a2',doctorId:'o',time:'10:30',procedure:'Redução de fratura'};
 const context={
  state:{professionals:[surgeon,other,carlos,lia],appointments:[base,busy]},
  owner:surgeon,calendarMode:'week',window:{AgendaAuth:{role,agendaIds}},
  selectedProf:()=>context.owner,prof:id=>({s:surgeon,o:other,c:carlos,l:lia})[id],
  isAnesthesiologist:p=>p?.specialty==='Anestesiologia',
  patient:()=>({name:'Paciente teste',insurance:'Unimed'}),hospital:()=>({name:'Hospital teste'}),hospitalAcronym:h=>h?.name==='Hospital teste'?'HT':'H',
  appointmentInsurance:a=>a.insurance??'Unimed',statusLabel:()=>'Confirmado',
  esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  mins:v=>Number(v.slice(0,2))*60+Number(v.slice(3)),hhmm:v=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`,
  $:id=>id==='appointmentId'?{value:''}:null,
 };
 vm.createContext(context);vm.runInContext(functions,context);
 return {c:context,base,busy};
}
const card=(c,a,extra='')=>c.appointmentCard(a,7*60,extra,false);

test('card size follows the appointment duration and keeps the full summary in the title',()=>{
 const {c,base}=fixture();
 for(const [duration,size] of [[30,'size-xs'],[45,'size-s'],[60,'size-m'],[90,'size-l'],[120,'size-l']])
  assert.match(card(c,{...base,duration}),new RegExp(`class="appointment confirmed ${size} `),String(duration));
 const html=card(c,base);
 assert.match(html,/title="10:00 – 11:00 · Paciente teste · Cateterismo · Hospital teste · Dr\. Carlos · Unimed · Confirmado"/);
 assert.match(html,/aria-label="10:00 – 11:00 · Paciente teste/);
 assert.match(card(c,base,'left:calc(0% + 3px);right:auto;width:calc(50% - 6px);'),/ is-split /);
 c.calendarMode='day';assert.match(card(c,base),/ is-wide /);
});

test('card content names the team role and never duplicates the doctor prefix',()=>{
 const {c,base}=fixture();
 assert.equal(c.doctorName('Dra. Ana Teste'),'Dra. Ana Teste');
 assert.equal(c.doctorName('Bruno Teste'),'Dr. Bruno Teste');
 let html=c.appointmentCardContent(base);
 assert.match(html,/<strong class="appointment-head"><b>10:00 – 11:00<\/b><span class="appointment-hospital">HT<\/span><\/strong>/);
 assert.match(html,/class="appointment-surgeon">Anestesista: Dr\. Carlos</);
 c.owner=c.prof('c');html=c.appointmentCardContent(base);
 assert.match(html,/class="appointment-surgeon">Cirurgião: Dra\. Ana Teste</);
 assert.doesNotMatch(html,/Dr\. Dra\./);
 c.owner=c.prof('s');html=c.appointmentCardContent({...base,anesthetistId:null});
 assert.match(html,/class="appointment-surgeon is-empty">Sem anestesista</);
 assert(html.indexOf('appointment-insurance')<html.indexOf('appointment-status-badge'));
});

test('form warns when the chosen anesthetist is already in another surgery at that time',()=>{
 const {c,base}=fixture();
 const draft={...base,id:'',doctorId:'o',time:'10:45',duration:30};
 const warnings=c.anesthetistOverlapWarnings(draft);
 assert.equal(warnings.length,2);
 assert.equal(warnings[0].severity,'warning');
 assert.match(warnings[0].text,/Dr\. Carlos já está em Cateterismo das 10:00 às 11:00 com Dra\. Ana Teste\./);
 assert.equal(c.anesthetistOverlapWarnings({...draft,time:'11:30'}).length,0);
 assert.equal(c.anesthetistOverlapWarnings({...draft,anesthetistId:'l'}).length,0);
 // Editar a própria cirurgia não gera aviso contra ela mesma.
 assert.equal(c.anesthetistOverlapWarnings({...base}).filter(w=>/Cateterismo/.test(w.text)).length,0);
});

test('anesthetist options follow agenda access but keep the current anesthetist when editing',()=>{
 const manager=fixture();
 assert.match(manager.c.detailRelatedOptions(manager.base,manager.c.prof('s')),/Dra\. Lia/);
 const secretary=fixture({role:'secretary',agendaIds:['s','o']});
 const options=secretary.c.detailRelatedOptions(secretary.base,secretary.c.prof('s'));
 assert.match(options,/<option value="c" selected>Dr\. Carlos/);
 assert.doesNotMatch(options,/Dra\. Lia/);
 const fresh=secretary.c.detailRelatedOptions({...secretary.base,anesthetistId:null},secretary.c.prof('s'));
 assert.equal(fresh,'<option value="">Sem anestesista</option>');
 assert.match(source,/isAnesthesiologist\(p\)&&canAccessProfessional\(p\.id\)\)\.map/);
});

test('agenda appears in the anesthetist calendar and card styles are scoped per size',()=>{
 assert.match(source,/isAnesthesiologist\(owner\)\?a\.anesthetistId===owner\.id:a\.doctorId===owner\.id/);
 for(const rule of ['#calendar .appointment.size-xs .appointment-procedure','#calendar .appointment.size-s .appointment-card-footer,#calendar .appointment.size-m .appointment-card-footer{position:absolute!important;top:4px!important',
  '#calendar .appointment.is-split .appointment-hospital','#calendar .appointment.is-wide{display:grid!important','#calendar .appointment.anesthesia-conflict{--appt-accent:#d64556'])
  assert(css.includes(rule),rule);
});
