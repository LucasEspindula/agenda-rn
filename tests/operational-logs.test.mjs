import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
const {collapseChanges,presentLogDifferences}=loadTs('lib/billing-logs.ts');
const change=(id,before,after,record='record')=>({id,record_type:'billing_records',record_id:record,action:!before?'INSERT':!after?'DELETE':'UPDATE',before_data:before,after_data:after});
test('financial logs collapse net-zero subevents and transient insert/delete without dropping real changes',()=>{
 const changes=collapseChanges([change(1,{payment_status:'PAGO'},{payment_status:'PENDENTE'}),change(2,{payment_status:'PENDENTE'},{payment_status:'PAGO'}),change(3,{notes:'Antes'},{notes:'Depois'},'invoice')]);
 assert.equal(changes.length,1);assert.equal(changes[0].record_id,'invoice');assert.equal(changes[0].differences[0].field,'notes');
 assert.equal(collapseChanges([change(1,null,{amount:1500}),change(2,{amount:1500},null)]).length,0);
 assert.equal(collapseChanges([change(1,{amount:1500,updated_at:'old'},{amount:1500,updated_at:'new'})]).length,0);
 for(const [before,after,action] of [[null,{amount:0},'INSERT'],[{amount:1500},null,'DELETE'],[{amount:1500},{amount:1400},'UPDATE']])assert.equal(collapseChanges([change(1,before,after)])[0].action,action);
});
const source=readFileSync('public/legacy-app.js','utf8');
const ast=ts.createSourceFile('legacy.js',source,ts.ScriptTarget.Latest,true);
const wanted=new Set(['agendaLogSnapshot','agendaLogContext','agendaLogHasValue','agendaLogSnapshotText','agendaLogTitle','agendaLogContent','renderAgendaLogs','workflowAppointment','workflowRequestTitle','workflowChangeRows','suggestionReason','roleLabel']);
const code=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&wanted.has(n.name.text))||(ts.isVariableStatement(n)&&n.getText(ast).includes('agendaLogFieldLabels'))).map(n=>n.getText(ast)).join('\n');
function agendaFixture(){
 const elements={auditList:{innerHTML:''},auditSearch:{value:''}};
 const context={state:{professionals:[{id:'doctor-uuid',name:'Dra. Rosa'}]},patient:id=>id==='patient-uuid'?{name:'Paciente Lucas'}:null,hospital:()=>({name:'CONS'}),hospitalAcronym:x=>x,suggestionReason:a=>a?.cancelReason||'',statusLabel:s=>({scheduled:'Agendado',confirmed:'Confirmado',cancelled:'Cancelado'})[s],parseDate:d=>new Date(d+'T12:00:00'),workflowDate:d=>d,esc:s=>String(s??'').replaceAll('<','&lt;'),$:id=>elements[id],workflowData:{audit:[]}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,elements};
}
const appointment={id:'appointment-uuid',patientId:'patient-uuid',doctorId:'doctor-uuid',date:'2026-09-22',time:'08:00',procedure:'Consulta',duration:60,status:'scheduled'};
const event={actorName:'Roseni Nunes',actorRole:'secretary',createdAt:'2026-09-22T11:00:00Z',action:'appointment_created',description:'Roseni Nunes criou um agendamento.',professionalId:'doctor-uuid',patientId:'patient-uuid',before:null,after:appointment};
test('agenda timeline renders INSERT, UPDATE and DELETE with meaningful nonempty differences',()=>{
 const {context:c,elements}=agendaFixture();
 c.workflowData.audit=[event,{...event,action:'appointment_updated',description:'Roseni alterou um agendamento.',before:appointment,after:{...appointment,time:'09:00'}},{...event,action:'appointment_removed',before:appointment,after:null}];
 c.renderAgendaLogs();const html=elements.auditList.innerHTML;
 for(const text of ['Adicionar:','REMOVIDO','<b>DE</b>','<b>PARA</b>','Data e horário: 22/09/2026 às 08:00','Roseni Nunes','Secretaria','Dra. Rosa','Duração:'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Novo registro|uuid|scheduled|Roseni Nunes criou/);
 assert.equal(c.agendaLogContent({...event,before:appointment,after:{...appointment}}).lines.length,0);
 assert.equal(c.agendaLogContent({...event,before:appointment,after:{...appointment,updatedAt:'ignored'}}).lines.length,0);
 const partial=c.agendaLogContent({...event,action:'appointment_updated',before:appointment,after:{...appointment,duration:90}});assert.equal(partial.lines[0].label,'DE');assert.match(partial.lines[0].text,/Duração: 60 min/);assert.equal(partial.lines[1].label,'PARA');assert.match(partial.lines[1].text,/Duração: 90 min/);
 const unresolved=c.agendaLogContent({...event,patientId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',professionalId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',before:null,after:{...appointment,patientId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',doctorId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13'}});assert.doesNotMatch(unresolved.metadata,/c0a80101/);
 assert.match(c.workflowRequestTitle({action:'create',proposed:appointment}),/Solicitação de novo agendamento para Paciente Lucas/);
});
test('agenda search covers patient, doctor, actor, procedure, action and before/after, never technical IDs',()=>{
 const {context:c,elements}=agendaFixture();c.workflowData.audit=[{...event,before:appointment,after:{...appointment,procedure:'Cirurgia',status:'confirmed'}}];
 for(const query of ['Lucas','Rosa','Roseni','Consulta','Cirurgia','criado','Confirmado','Secretaria']){elements.auditSearch.value=query;c.renderAgendaLogs();assert.match(elements.auditList.innerHTML,/agenda-log-event/,query)}
 for(const query of ['patient-uuid','doctor-uuid','appointment-uuid','scheduled','appointment_created']){elements.auditSearch.value=query;c.renderAgendaLogs();assert.doesNotMatch(elements.auditList.innerHTML,/agenda-log-event/,query)}
});
function workflowRoute(role,agendaIds,leaky=false){
 const calls=[];
 const audit=[{id:'one',professional_id:'d1',metadata:{before:null,after:{procedure:'Consulta'}}},{id:'two',professional_id:'d2',metadata:{after:{procedure:'Cirurgia'}}},{id:'none',professional_id:null}];
 const db={from(table){const filters=[];const chain={select(){return chain},eq(){return chain},in(key,value){filters.push([key,value]);calls.push([table,'in',key,value]);return chain},order(){calls.push([table,'order']);return chain},limit(){calls.push([table,'limit']);return chain},then(resolve){return Promise.resolve({data:table==='audit_logs'?audit.filter(row=>leaky||filters.every(([key,values])=>values.includes(row[key]))):[],error:null}).then(resolve)}};return chain}};
 const api=loadTs('app/api/workflow/route.ts',{'@/app/authz':{getSession:async()=>({account:{id:1,role,doctorId:role==='doctor'?'d1':null},agendaIds,services:{scheduling_enabled:true}}),isManager:r=>r==='general_manager'},'@/lib/supabase-admin':{getSupabaseAdmin:()=>db,dbError:e=>{if(e)throw e}}});return {api,calls};
}
test('workflow manager reads all agendas; secretary query and response both enforce agenda scope',async()=>{
 const manager=workflowRoute('general_manager',[]);assert.equal((await(await manager.api.GET()).json()).audit.length,3);
 for(const leaky of [false,true])for(const ids of [['d1'],['d2'],[]]){const {api,calls}=workflowRoute('secretary',ids,leaky);const body=await(await api.GET()).json();assert.deepEqual(body.audit.map(r=>r.professional_id),ids);const filter=calls.findIndex(c=>c[0]==='audit_logs'&&c[1]==='in'),limit=calls.findIndex(c=>c[0]==='audit_logs'&&c[1]==='limit');assert.ok(filter>=0&&filter<limit);}
 const doctor=workflowRoute('doctor',['d1','d2'],true);assert.equal((await(await doctor.api.GET()).json()).audit.length,0);assert.ok(!doctor.calls.some(c=>c[0]==='audit_logs'&&c[1]==='limit'));
});

test('billing timeline presents add/remove without empty opposite sides or actor email',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const logs=[{id:'l',actor_id:1,actor_name:'Roseni',actor_email:'hidden@example.test',kind:'record',created_at:'2026-09-22',changes:[change(1,null,{origin:'AGENDA',amount:0},'one'),change(2,{origin:'FATURAMENTO_MANUAL'},null,'two'),change(3,{origin:'FISCAL_MANUAL'},{origin:'AGENDA'},'three'),change(4,{payment_status:'PAGO'},{payment_status:'PENDENTE'},'four'),change(5,{payment_status:'PENDENTE'},{payment_status:'PAGO'},'four'),change(6,null,{billing_entity_id:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13'},'five')]}];
 let index=0;const Component=loadTs('app/billing/billing-logs.tsx',{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?logs:initial,()=>{}]}}).default;
 const html=renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:'secretary',name:'Roseni'}]}}));
 for(const text of ['Adicionar:','REMOVIDO','workflow-change-label">DE</b>','workflow-change-label">PARA</b>','Agenda','Faturamento · cadastro manual','Fiscal · cadastro manual'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/hidden@example|Novo registro|PENDENTE|FATURAMENTO_MANUAL|FISCAL_MANUAL|c0a80101/);
 assert.equal((html.match(/class="workflow-change /g)||[]).length,5);
});

test('native Agenda issued Particular composition remains read-only',()=>{
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='paintNativeFinance').getText(ast);
 const root={innerHTML:''};const context={nativeFinance:{row:{record:{id:'b'},invoice:{invoice_number:'10',recipient_type:'PARTICULAR',paid_at:'2026-09-22'}},data:{payment_parts:[{billing_record_id:'b',method:'PIX',amount:1000},{billing_record_id:'b',method:'CREDIT_CARD',amount:500,installments:3},{billing_record_id:'other',method:'CASH',amount:99}]}},nativeFinanceRoot:()=>root,captureNativeFinance:()=>{},esc:v=>String(v??''),money:v=>String(v),window:{RNFinance:{individualReceived:()=>1500,paymentMethods:{PIX:'PIX',CREDIT_CARD:'Cartão de crédito',CASH:'Dinheiro'}}}};
 vm.createContext(context);vm.runInContext(fn+';paintNativeFinance()',context);
 assert.match(root.innerHTML,/somente leitura/);assert.match(root.innerHTML,/PIX/);assert.match(root.innerHTML,/3 parcelas/);assert.doesNotMatch(root.innerHTML,/<input|<select|Dinheiro/);
});

test("semantic log diffs omit empty sides and retain real updates",()=>{const rows=presentLogDifferences([{field:"payer",before:null,after:"CaberGS"},{field:"notes",before:"Antes",after:null},{field:"status",before:"PENDENTE",after:"PAGO"},{field:"empty",before:"",after:null}]);assert.deepEqual(rows,[{field:"payer",before:null,after:"CaberGS"},{field:"notes",before:"Antes",after:null},{field:"status",before:"PENDENTE",after:"PAGO"}])});
test("appointment detail saves status with the normal save action",()=>{assert.doesNotMatch(source,/appointmentStatusSaveBtn/);assert.match(source,/statusUpdatedAt:selectedStatus!==a\.status\?new Date\(\)\.toISOString\(\):a\.statusUpdatedAt/)});
test("agenda control positions swap mode and cancelled actions",()=>{assert.match(source,/const modeControl=document\.querySelector\("\.filters \.segmented"\);document\.querySelector\("\.date-wrap"\)\?\.append\(modeControl\)/);assert.match(source,/insertAdjacentElement\("beforeend",\$\("cancelledPageBtn"\)\)/)});

test("agenda log labels follow INSERT UPDATE and DELETE semantics",()=>{const {context:c}=agendaFixture();const insert=c.agendaLogContent(event).lines.map(x=>x.label),deleted=c.agendaLogContent({...event,before:appointment,after:null}).lines.map(x=>x.label),filled=c.agendaLogContent({...event,before:{...appointment,notes:""},after:{...appointment,notes:"Incluída"}}).lines.map(x=>x.label),cleared=c.agendaLogContent({...event,before:{...appointment,notes:"Anterior"},after:{...appointment,notes:""}}).lines.map(x=>x.label),changed=c.agendaLogContent({...event,before:{...appointment,notes:"A"},after:{...appointment,notes:"B"}}).lines.map(x=>x.label);assert.ok(insert.every(x=>x==="Adicionar:"));assert.ok(deleted.every(x=>x==="REMOVIDO"));assert.deepEqual(filled,["PARA"]);assert.deepEqual(cleared,["DE"]);assert.deepEqual(changed,["DE","PARA"])});
test("log cards render the request-card composition with directional changes",async()=>{const React=await import("react"),{renderToStaticMarkup}=await import("react-dom/server");let index=0;const Component=loadTs("app/billing/billing-logs.tsx",{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?[{id:"layout",actor_id:1,actor_name:"Roseni",kind:"invoice",created_at:"2026-10-06",changes:[change(1,{notes:"Antes"},{notes:"Depois"})]}]:initial,()=>{}]}}).default;const html=renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:"secretary",name:"Roseni"}]}}));assert.match(html,/workflow-card-main/);assert.match(html,/workflow-heading/);assert.match(html,/workflow-status log-invoice/);assert.match(html,/workflow-changes/);assert.match(html,/workflow-change from/);assert.match(html,/workflow-change to/);assert.match(html,/workflow-arrow/);assert.doesNotMatch(html,/billing-log-line/)});
test("billing log UI labels follow record operations",async()=>{const React=await import("react"),{renderToStaticMarkup}=await import("react-dom/server");const render=changeRow=>{let index=0;const Component=loadTs("app/billing/billing-logs.tsx",{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?[{id:"l",actor_id:1,actor_name:"Roseni",actor_email:"",kind:"record",created_at:"2026-09-22",changes:[changeRow]}]:initial,()=>{}]}}).default;return renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:"secretary",name:"Roseni"}]}}))};const insert=render(change(1,null,{notes:"Novo"})),deleted=render(change(1,{notes:"Anterior"},null)),filled=render({...change(1,null,{notes:"Preenchida"}),action:"UPDATE"}),cleared=render({...change(1,{notes:"Anterior"},null),action:"UPDATE"}),changed=render(change(1,{notes:"A"},{notes:"B"}));assert.match(insert,/<b>Adicionar:<\/b>/);assert.doesNotMatch(insert,/<b>DE<\/b>/);assert.match(deleted,/<b>REMOVIDO<\/b>/);assert.match(filled,/<b>PARA<\/b>/);assert.doesNotMatch(filled,/<b>Adicionar:<\/b>/);assert.match(cleared,/<b>DE<\/b>/);assert.doesNotMatch(cleared,/<b>REMOVIDO<\/b>/);assert.match(changed,/<b>DE<\/b>/);assert.match(changed,/<b>PARA<\/b>/)});
