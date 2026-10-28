import test from 'node:test';
import assert from 'node:assert/strict';
// Values evaluated in node:vm have a different prototype realm; compare their JSON shape.
const assertSameStructure=(actual,expected)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
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
const wanted=new Set(['agendaLogPerson','agendaLogSnapshot','agendaLogContext','agendaLogHasValue','agendaLogSnapshotText','agendaLogTitle','agendaLogBadge','agendaLogValues','agendaLogContent','agendaLogNormalize','agendaLogLocalDay','agendaLogMatchesFilters','agendaLogFilterOptions','agendaLogChangeMarkup','agendaLogCompactValues','renderAgendaLogs','workflowAppointment','workflowRequestTitle','workflowChangeRows','workflowRoleLabel','workflowAuthorship','suggestionReason','roleLabel']);
const code=ast.statements.filter(n=>(ts.isFunctionDeclaration(n)&&wanted.has(n.name.text))||(ts.isVariableStatement(n)&&n.getText(ast).includes('agendaLogFieldLabels'))).map(n=>n.getText(ast)).join('\n');
function agendaFixture(){
 const elements={auditList:{innerHTML:''},auditStart:{value:''},auditEnd:{value:''},auditActor:{value:'',innerHTML:''},auditProfessional:{value:'',innerHTML:''},auditAction:{value:''},auditSearch:{value:''}};
 const context={state:{professionals:[{id:'doctor-uuid',name:'Dra. Rosa'}]},patient:id=>id==='patient-uuid'?{name:'Paciente Lucas'}:null,hospital:()=>({name:'CONS'}),hospitalAcronym:x=>typeof x==='object'?String(x.abbreviation||x.name).toLocaleUpperCase('pt-BR'):x,doctorName:x=>String(x||'Médico'),suggestionReason:a=>a?.cancelReason||'',statusLabel:s=>({scheduled:'Agendado',confirmed:'Confirmado',cancelled:'Cancelado'})[s],parseDate:d=>new Date(d+'T12:00:00'),workflowDate:d=>d,esc:s=>String(s??'').replaceAll('<','&lt;'),$:id=>elements[id],workflowData:{audit:[]}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,elements};
}
const appointment={id:'appointment-uuid',patientId:'patient-uuid',doctorId:'doctor-uuid',date:'2026-09-22',time:'08:00',procedure:'Consulta',duration:60,status:'scheduled'};
const event={actorName:'Roseni Nunes',actorRole:'secretary',createdAt:'2026-09-22T11:00:00Z',action:'appointment_created',description:'Roseni Nunes criou um agendamento.',professionalId:'doctor-uuid',patientId:'patient-uuid',before:null,after:appointment};
test('agenda logs group operational changes, resolve fields and discard technical-only updates',()=>{
 const {context:c,elements}=agendaFixture();
 const updated={...appointment,time:'09:00',insurance:'CESA',forma_cobranca:'CONVENIO',guideExpiry:'2026-10-10',careType:'inpatient',opme:true,reports:false,exams:true,anesthetistId:'doctor-uuid'};
 c.workflowData.audit=[event,{...event,action:'appointment_updated',description:'Roseni alterou um agendamento.',before:appointment,after:updated},{...event,action:'appointment_removed',before:appointment,after:null},{...event,action:'appointment_updated',before:{...appointment},after:{...appointment,rescheduleHistory:[]}}];
 c.renderAgendaLogs();const html=elements.auditList.innerHTML;
 for(const text of ['Adicionou','REMOVIDO','workflow-change-label">DE','workflow-change-label">PARA','Convênio / plano: CESA','Forma de cobrança: Convênio','Validade da guia: 10/10/2026','Tipo de atendimento: Internado','OPME: Sim','Laudos: Não','Exames: Sim','Anestesista: Dra. Rosa','Responsável:','Roseni Nunes','Secretaria','Dra. Rosa'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Novo registro|uuid|scheduled|rescheduleHistory|Roseni Nunes criou/);
 const created=c.agendaLogContent(event);assert.equal(created.lines.length,1);assert.equal(created.lines[0].label,'Adicionou');assert.ok(created.lines[0].values.length>1);
 const partial=c.agendaLogContent({...event,action:'appointment_updated',before:appointment,after:updated});assertSameStructure(partial.lines.map(x=>x.label),['DE','PARA']);assert.ok(partial.lines[0].values.some(v=>v==='Data e horário: 22/09/2026 às 08:00'));assert.ok(partial.lines[1].values.some(v=>v==='Data e horário: 22/09/2026 às 09:00'));assert.ok(partial.lines[1].values.some(v=>v==='Convênio / plano: CESA'));
 const removed=c.agendaLogContent({...event,before:appointment,after:null});assert.equal(removed.lines.length,1);assert.equal(removed.lines[0].label,'REMOVIDO');
 const technical=c.agendaLogContent({...event,action:'appointment_updated',before:{...appointment},after:{...appointment,rescheduleHistory:[]}});assert.equal(technical.lines.length,0);assert.equal(technical.meaningful,false);assert.equal((html.match(/agenda-log-event/g)||[]).length,3);
 const unresolved=c.agendaLogContent({...event,patientId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',professionalId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',before:null,after:{...appointment,patientId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13',doctorId:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13'}});assert.doesNotMatch(unresolved.metadata,/c0a80101/);
 assert.match(c.workflowAppointment(appointment).line,/22\/09\/2026 às 08:00/);
 assert.match(c.workflowRequestTitle({action:'create',proposed:appointment}),/Novo agendamento na agenda de Dra\. Rosa/);assert.doesNotMatch(c.workflowRequestTitle({action:'create',proposed:appointment}),/Solicitação/);assert.match(c.workflowAuthorship({requesterName:'Dr. Heitor',createdAt:'05\/10\/2026',deciderName:'Roseni Nunes',decidedAt:'05\/10\/2026'}),/Solicitante:.*Dr\. Heitor[\s\S]*Decidido por:.*Roseni Nunes/);
});

function workflowPayload({users,audit,role='general_manager',requests=[{id:'request-1',requested_by:1,decided_by:2,professional_id:'doctor-1',appointment_id:'appointment-1',created_at:'2026-10-08T10:00:00Z',decided_at:'2026-10-08T10:05:00Z',decision_note:null,previous_payload:null,proposed_payload:null}]}){
 const result=data=>Promise.resolve({data,error:null});
 const listQuery=data=>{const query={eq:()=>query,in:()=>query,order:()=>({limit:()=>result(data)})};return query};
 const decisionFilters=[];let decisionQueryCount=0;
 const db={from(table){
   if(table==='agenda_requests')return {select:()=>listQuery(requests)};
   if(table==='users')return {select:()=>result(users)};
   if(table==='audit_logs')return {select:fields=>{
     if(fields==='*')return listQuery(audit);
     const query={in:(field,values)=>{decisionFilters.push([field,values]);return query},then:(resolve,reject)=>{decisionQueryCount++;return result(audit).then(resolve,reject)}};
     return query;
   }};
   if(table==='notifications')return {select:()=>({eq:()=>({order:()=>({limit:()=>result([])})})})};
   throw new Error('Unexpected table: '+table);
 }};
 const {GET}=loadTs('app/api/workflow/route.ts',{
   '@/lib/doctor-services':{canUseAgenda:()=>true},
   '@/lib/security/state':{canReadAppointment:()=>true,withoutLegacyFinance:value=>value,validateAppointment:()=>{},validId:()=>true},
   '@/lib/security/rate-limit':{consumeLimit:async()=>{}},
   '@/lib/security/http':{readJson:async()=>({}),secureMutation:fn=>fn},
   '@/app/authz':{getSession:async()=>({account:{id:role==='doctor'?1:99,role},agendaIds:['doctor-1']}),isManager:accountRole=>accountRole==='general_manager'},
   '@/lib/supabase-admin':{dbError:error=>{if(error)throw error},getSupabaseAdmin:()=>db}
 });
 return GET().then(response=>response.json()).then(payload=>({payload,decisionQueryCount,decisionFilters}));
}
test('workflow API keeps historical decision authorship from audit logs',async()=>{
 const users=[{id:1,name:'Dr. Heitor',email:'heitor@example.com',role:'doctor'},{id:2,name:'Roseni atualizada',email:'roseni@example.com',role:'general_manager'}];
 const secretary=await workflowPayload({users,audit:[{action:'request_accepted',actor_name:'Roseni Nunes',actor_role:'secretary',metadata:{requestId:'request-1'}}]});
 assert.equal(secretary.payload.requests[0].deciderName,'Roseni Nunes');
 assert.equal(secretary.payload.requests[0].deciderRole,'secretary');
 const manager=await workflowPayload({users,audit:[{action:'request_denied',actor_name:'Lucas',actor_role:'general_manager',metadata:{requestId:'request-1'}}]});
 assert.equal(manager.payload.requests[0].deciderRole,'general_manager');
 const fallback=await workflowPayload({users,audit:[{action:'appointment_updated',actor_name:'Outra pessoa',actor_role:'secretary',metadata:{requestId:'request-1'}}]});
 assert.equal(fallback.payload.requests[0].deciderName,'Roseni atualizada');
 assert.equal(fallback.payload.requests[0].deciderRole,null);
});
test('doctor receives historical decision authorship without operational audit logs',async()=>{
 const users=[{id:1,name:'Dr. Heitor',email:'heitor@example.com'},{id:2,name:'Roseni atualizada',email:'roseni@example.com'}];
 const result=await workflowPayload({role:'doctor',users,audit:[{action:'request_accepted',actor_name:'Roseni Nunes',actor_role:'secretary',metadata:{requestId:'request-1'}}]});
 assert.equal(result.payload.requests[0].deciderName,'Roseni Nunes');
 assert.equal(result.payload.requests[0].deciderRole,'secretary');
 assertSameStructure(result.payload.audit,[]);
 assert.equal(result.decisionQueryCount,1);
 assertSameStructure(result.decisionFilters,[['action',['request_accepted','request_denied']],['metadata->>requestId',['request-1']],['professional_id',['doctor-1']]]);
});
test('doctor skips the batched decision audit query without visible requests',async()=>{
 const result=await workflowPayload({role:'doctor',users:[],audit:[],requests:[]});
 assert.equal(result.decisionQueryCount,0);
 assertSameStructure(result.payload.audit,[]);
});
test('workflow API resolves decision authorship without users roles or per-request audit queries',()=>{
 const source=readFileSync('app/api/workflow/route.ts','utf8');
 assert.match(source,/db\.from\("users"\)\.select\("id,name,email"\)/);
 assert.doesNotMatch(source,/db\.from\("users"\)\.select\("id,name,email,role"\)/);
 assert.match(source,/let decisionAuditRows: DecisionAudit\[\] = \[\]/);
 assert.match(source,/if \(visibleRequests\.length\)/);
 assert.match(source,/\.in\("metadata->>requestId", visibleRequestIds\)/);
 assert.match(source,/row\.action === "request_accepted" \|\| row\.action === "request_denied"/);
 assert.match(source,/session\.account\.role === "doctor"/);
});
test('workflow authorship labels the actual decision maker role',()=>{
 const {context:c}=agendaFixture();
 const secretary=c.workflowAuthorship({requesterName:'Dr. Heitor',createdAt:'05/10/2026',deciderName:'Roseni Nunes',deciderRole:'secretary',decidedAt:'05/10/2026'});
 assert.match(secretary,/Decidido por:.*Roseni Nunes.*Secretaria/);
 assert.doesNotMatch(secretary,/Roseni Nunes.*Gerência/);
 const manager=c.workflowAuthorship({requesterName:'Dr. Heitor',createdAt:'05/10/2026',deciderName:'Lucas',deciderRole:'general_manager',decidedAt:'05/10/2026'});
 assert.match(manager,/Decidido por:.*Lucas.*Gerência/);
 const unknown=c.workflowAuthorship({requesterName:'Dr. Heitor',createdAt:'05/10/2026',deciderName:'Decisor antigo',decidedAt:'05/10/2026'});
 assert.match(unknown,/Decidido por:.*Decisor antigo/);
 assert.doesNotMatch(unknown,/Decisor antigo.*Gerência/);
});
test('agenda search covers patient, doctor, actor, procedure, action and before/after, never technical IDs',()=>{
 const {context:c,elements}=agendaFixture();c.workflowData.audit=[{...event,before:appointment,after:{...appointment,procedure:'Cirurgia',status:'confirmed'}}];
 for(const query of ['Lucas','Rosa','Roseni','Consulta','Cirurgia','novo','Confirmado','Secretaria']){elements.auditSearch.value=query;c.renderAgendaLogs();assert.match(elements.auditList.innerHTML,/agenda-log-event/,query)}
 for(const query of ['patient-uuid','doctor-uuid','appointment-uuid','scheduled','appointment_created']){elements.auditSearch.value=query;c.renderAgendaLogs();assert.doesNotMatch(elements.auditList.innerHTML,/agenda-log-event/,query)}
});
test('agenda log filters combine date, user, agenda, action and the single general search without exposing technical IDs',()=>{
 const {context:c,elements}=agendaFixture();
 const changed={...event,action:'appointment_updated',createdAt:'2026-09-23T11:00:00Z',before:appointment,after:{...appointment,time:'09:00'}};
 const removed={...event,action:'appointment_removed',actorName:'João Secretário',createdAt:'2026-09-24T11:00:00Z',before:appointment,after:null};
 const request={...event,action:'request_created',actorName:'Mariana',createdAt:'2026-09-25T11:00:00Z',before:null,after:appointment};
 const hidden={...event,action:'appointment_updated',createdAt:'2026-09-26T11:00:00Z',before:appointment,after:{...appointment}};
 c.workflowData.audit=[event,changed,removed,request,hidden];
 const shown=()=>((elements.auditList.innerHTML.match(/agenda-log-event/g)||[]).length);
 c.renderAgendaLogs();assert.equal(shown(),4);assert.equal(elements.auditPatient,undefined);
 elements.auditSearch.value='LÚCAS';c.renderAgendaLogs();assert.equal(shown(),4);
 elements.auditSearch.value='';elements.auditProfessional.value='Dra. Rosa';c.renderAgendaLogs();assert.equal(shown(),4);
 elements.auditActor.value='Roseni Nunes';c.renderAgendaLogs();assert.equal(shown(),2);
 elements.auditActor.value='';elements.auditAction.value='created';c.renderAgendaLogs();assert.equal(shown(),1);
 elements.auditAction.value='changed';c.renderAgendaLogs();assert.equal(shown(),1);
 elements.auditAction.value='removed';c.renderAgendaLogs();assert.equal(shown(),1);
 elements.auditAction.value='request';c.renderAgendaLogs();assert.equal(shown(),1);
 elements.auditAction.value='';elements.auditStart.value='2026-09-23';elements.auditEnd.value='2026-09-24';c.renderAgendaLogs();assert.equal(shown(),2);
 elements.auditSearch.value='appointment_created';c.renderAgendaLogs();assert.equal(shown(),0);
 elements.auditSearch.value='';elements.auditStart.value='';elements.auditEnd.value='';c.renderAgendaLogs();assert.equal(shown(),4);
 assert.equal(c.agendaLogMatchesFilters({a:event,...c.agendaLogContent(event),context:c.agendaLogContext(event,c.agendaLogSnapshot(event.after))},{search:'lucas',action:'created'}),true);
 assert.equal(c.agendaLogMatchesFilters({a:event,...c.agendaLogContent(event),context:c.agendaLogContext(event,c.agendaLogSnapshot(event.after))},{search:'lucas',action:'removed'}),false);
 const source=readFileSync('public/legacy-app.js','utf8');assert.doesNotMatch(source,/auditPatient/);assert.match(source,/<label class="agenda-log-search">Buscar<input id="auditSearch" type="search">/);assert.doesNotMatch(source,/<input id="auditSearch"[^>]*placeholder=/);
});
test('log extenso de agendamento tem resumo, sem repetir identificação do contexto',()=>{
 const {context:c,elements}=agendaFixture();
 c.workflowData.audit=[{...event,before:null,after:{...appointment,insurance:'Particular',forma_cobranca:'PARTICULAR',opme:false,reports:false,exams:true,careType:'outpatient',notes:'Observação do atendimento'}}];
 c.renderAgendaLogs();
 const html=elements.auditList.innerHTML,summary=html.split('<details class="agenda-log-details">')[0];
 assert.match(summary,/agenda-log-summary/);
 assert.match(summary,/Data e horário: 22\/09\/2026 às 08:00/);
 assert.doesNotMatch(summary,/Paciente: Paciente Lucas.*Paciente: Paciente Lucas|\[object Object\]/);
 assert.match(html,/<summary>Ver auditoria completa<\/summary>/);
 assert.match(html,/OPME: Não/);
});
test('agenda and billing logs keep aligned workflow tokens without duplicate billing authorship rules',()=>{
 const agendaCss=readFileSync('public/legacy.css','utf8'),billingCss=readFileSync('app/billing/billing.css','utf8'),billing=readFileSync('app/billing/billing-logs.tsx','utf8');
 assert.match(agendaCss,/\.agenda-log-filters\{display:grid/);
 assert.match(billingCss,/\.billing-logs,.billing-logs :is\(input,select,button\)\{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif\}/);
 for(const token of ['padding:14px','border:1px solid #e4eaf0','border-radius:12px','padding:3px 7px','font-size:9px','font-weight:850','minmax(70px,auto) 18px minmax(0,1fr)'])assert.ok(billingCss.includes(token),token);
 assert.equal((billingCss.match(/\.billing-log-event \.workflow-log-authorship\{/g)||[]).length,1);
 for(const name of ['workflow-card','workflow-heading','workflow-status','workflow-changes','workflow-change','workflow-log-context','workflow-log-authorship'])assert.match(billing,new RegExp(name));
});

function workflowRoute(role,agendaIds,leaky=false){
 const calls=[];
 const audit=[{id:'one',professional_id:'d1',metadata:{before:null,after:{procedure:'Consulta'}}},{id:'two',professional_id:'d2',metadata:{after:{procedure:'Cirurgia'}}},{id:'none',professional_id:null}];
 const db={from(table){const filters=[];const chain={select(){return chain},eq(){return chain},in(key,value){filters.push([key,value]);calls.push([table,'in',key,value]);return chain},order(){calls.push([table,'order']);return chain},limit(){calls.push([table,'limit']);return chain},then(resolve){return Promise.resolve({data:table==='audit_logs'?audit.filter(row=>leaky||filters.every(([key,values])=>values.includes(row[key]))):[],error:null}).then(resolve)}};return chain}};
 const api=loadTs('app/api/workflow/route.ts',{'@/app/authz':{getSession:async()=>({account:{id:1,role,doctorId:role==='doctor'?'d1':null},agendaIds,services:{scheduling_enabled:true}}),isManager:r=>r==='general_manager'},'@/lib/supabase-admin':{getSupabaseAdmin:()=>db,dbError:e=>{if(e)throw e}}});return {api,calls};
}
test('workflow geral não transfere logs operacionais; somente decisões autorizadas são consultadas',async()=>{
 for(const role of ['general_manager','secretary','doctor']){const {api,calls}=workflowRoute(role,['d1','d2']);const body=await(await api.GET()).json();assertSameStructure(body.audit,[]);assert.ok(!calls.some(c=>c[0]==='audit_logs'&&c[1]==='limit'));}
});

test('billing timeline presents add/remove without empty opposite sides or actor email',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const logs=[{id:'l',actor_id:1,actor_name:'Roseni',actor_email:'hidden@example.test',kind:'record',created_at:'2026-09-22',changes:[change(1,null,{origin:'AGENDA',amount:0},'one'),change(2,{origin:'FATURAMENTO_MANUAL'},null,'two'),change(3,{origin:'FISCAL_MANUAL'},{origin:'AGENDA'},'three'),change(4,{payment_status:'PAGO'},{payment_status:'PENDENTE'},'four'),change(5,{payment_status:'PENDENTE'},{payment_status:'PAGO'},'four'),change(6,null,{billing_entity_id:'c0a80101-7e5d-4ee3-8b2b-8a3d5db24f13'},'five')]}];
 let index=0;const Component=loadTs('app/billing/billing-logs.tsx',{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?logs:initial,()=>{}]}}).default;
 const html=renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:'secretary',name:'Roseni'}]}}));
 for(const text of ['Adicionou','REMOVIDO','workflow-change-label">DE</b>','workflow-change-label">PARA</b>','Responsável:','Agenda','Faturamento · cadastro manual','Fiscal · cadastro manual'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/hidden@example|Novo registro|PENDENTE|FATURAMENTO_MANUAL|FISCAL_MANUAL|c0a80101/);
 // An update renders its original and resulting values in separate visual rows.
 assert.equal((html.match(/class="workflow-change /g)||[]).length,6);
});

test('native Agenda issued Particular composition remains read-only',()=>{
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='paintNativeFinance').getText(ast);
 const root={innerHTML:''};const context={nativeFinance:{row:{record:{id:'b'},invoice:{invoice_number:'10',recipient_type:'PARTICULAR',paid_at:'2026-09-22'}},data:{payment_parts:[{billing_record_id:'b',method:'PIX',amount:1000},{billing_record_id:'b',method:'CREDIT_CARD',amount:500,installments:3},{billing_record_id:'other',method:'CASH',amount:99}]}},nativeFinanceRoot:()=>root,captureNativeFinance:()=>{},esc:v=>String(v??''),money:v=>String(v),parseDate:v=>new Date(v+'T12:00:00'),financeProofsMarkup:()=>'',bindNativeProofDeletion:()=>{},window:{RNFinance:{individualReceived:()=>1500,paymentMethods:{PIX:'PIX',CREDIT_CARD:'Cartão de crédito',CASH:'Dinheiro'}}}};
 vm.createContext(context);vm.runInContext(fn+';paintNativeFinance()',context);
 assert.match(root.innerHTML,/native-finance-view-summary/);assert.match(root.innerHTML,/PIX/);assert.match(root.innerHTML,/3 parcelas/);assert.doesNotMatch(root.innerHTML,/<input|<select|Dinheiro/);
});

test('billing log change groups render each field on its own row',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const render=change=>{let index=0;const Component=loadTs('app/billing/billing-logs.tsx',{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?[{id:'multi',actor_id:1,actor_name:'Roseni',kind:'invoice',created_at:'2026-10-06',changes:[change]}]:initial,()=>{}]}}).default;return renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:'secretary',name:'Roseni'}]}}))};
 const inserted=render(change(1,null,{invoice_number:'995',payer:'Lucas Espindula',net_amount:150000,total_amount:150000},'invoice'));
 assert.equal((inserted.match(/Adicionou/g)||[]).length,1);assert.equal((inserted.match(/class="workflow-change to"/g)||[]).length,4);assert.doesNotMatch(inserted,/Número da NF: 995 · Pagador/);
 const deleted=render(change(1,{invoice_number:'995',payer:'Lucas Espindula',total_amount:150000},null,'invoice'));
 assert.equal((deleted.match(/REMOVIDO/g)||[]).length,1);assert.equal((deleted.match(/class="workflow-change from"/g)||[]).length,3);
 const updated=render(change(1,{payer:'Antes',net_amount:100000},{payer:'Depois',net_amount:150000},'invoice'));
 assert.equal((updated.match(/>DE</g)||[]).length,1);assert.equal((updated.match(/>PARA</g)||[]).length,1);assert.equal((updated.match(/class="workflow-change from"/g)||[]).length,2);assert.equal((updated.match(/class="workflow-change to"/g)||[]).length,2);
});

test("semantic log diffs omit empty sides and retain real updates",()=>{const rows=presentLogDifferences([{field:"payer",before:null,after:"CaberGS"},{field:"notes",before:"Antes",after:null},{field:"status",before:"PENDENTE",after:"PAGO"},{field:"empty",before:"",after:null}]);assertSameStructure(rows,[{field:"payer",before:null,after:"CaberGS"},{field:"notes",before:"Antes",after:null},{field:"status",before:"PENDENTE",after:"PAGO"}])});
test("appointment detail saves status with the normal save action",()=>{assert.doesNotMatch(source,/appointmentStatusSaveBtn/);assert.match(source,/statusUpdatedAt:selectedStatus!==a\.status\?new Date\(\)\.toISOString\(\):a\.statusUpdatedAt/)});
test("agenda control positions swap mode and cancelled actions",()=>{assert.match(source,/const modeControl=document\.querySelector\("\.filters \.segmented"\);document\.querySelector\("\.date-wrap"\)\?\.append\(modeControl\)/);assert.match(source,/insertAdjacentElement\("beforeend",\$\("cancelledPageBtn"\)\)/)});

test("agenda log labels follow INSERT UPDATE and DELETE semantics",()=>{const {context:c}=agendaFixture();const insert=c.agendaLogContent(event).lines.map(x=>x.label),deleted=c.agendaLogContent({...event,before:appointment,after:null}).lines.map(x=>x.label),filled=c.agendaLogContent({...event,before:{...appointment,notes:""},after:{...appointment,notes:"Incluída"}}).lines.map(x=>x.label),cleared=c.agendaLogContent({...event,before:{...appointment,notes:"Anterior"},after:{...appointment,notes:""}}).lines.map(x=>x.label),changed=c.agendaLogContent({...event,before:{...appointment,notes:"A"},after:{...appointment,notes:"B"}}).lines.map(x=>x.label);assert.ok(insert.every(x=>x==="Adicionou"));assert.ok(deleted.every(x=>x==="REMOVIDO"));assertSameStructure(filled,["PARA"]);assertSameStructure(cleared,["DE"]);assertSameStructure(changed,["DE","PARA"])});
test("log cards render the request-card composition with directional changes",async()=>{const React=await import("react"),{renderToStaticMarkup}=await import("react-dom/server");let index=0;const Component=loadTs("app/billing/billing-logs.tsx",{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?[{id:"layout",actor_id:1,actor_name:"Roseni",kind:"invoice",created_at:"2026-10-06",changes:[change(1,{notes:"Antes"},{notes:"Depois"})]}]:initial,()=>{}]}}).default;const html=renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:"secretary",name:"Roseni"}]}}));assert.match(html,/workflow-card-main/);assert.match(html,/workflow-heading/);assert.match(html,/workflow-status log-invoice/);assert.match(html,/workflow-changes/);assert.match(html,/workflow-change from/);assert.match(html,/workflow-change to/);assert.match(html,/workflow-arrow/);assert.doesNotMatch(html,/billing-log-line/)});
test("billing log UI labels follow record operations",async()=>{const React=await import("react"),{renderToStaticMarkup}=await import("react-dom/server");const render=changeRow=>{let index=0;const Component=loadTs("app/billing/billing-logs.tsx",{react:{...React,useEffect:()=>{},useState:initial=>[index++===0?[{id:"l",actor_id:1,actor_name:"Roseni",actor_email:"",kind:"record",created_at:"2026-09-22",changes:[changeRow]}]:initial,()=>{}]}}).default;return renderToStaticMarkup(React.createElement(Component,{data:{rows:[],entities:[],doctors:[],links:[],invoices:[],users:[{id:1,role:"secretary",name:"Roseni"}]}}))};const insert=render(change(1,null,{notes:"Novo"})),deleted=render(change(1,{notes:"Anterior"},null)),filled=render({...change(1,null,{notes:"Preenchida"}),action:"UPDATE"}),cleared=render({...change(1,{notes:"Anterior"},null),action:"UPDATE"}),changed=render(change(1,{notes:"A"},{notes:"B"}));assert.match(insert,/<b class="workflow-change-label">Adicionou<\/b>/);assert.doesNotMatch(insert,/<b class="workflow-change-label">DE<\/b>/);assert.match(deleted,/<b class="workflow-change-label">REMOVIDO<\/b>/);assert.match(filled,/<b class="workflow-change-label">PARA<\/b>/);assert.doesNotMatch(filled,/<b class="workflow-change-label">Adicionou<\/b>/);assert.match(cleared,/<b class="workflow-change-label">DE<\/b>/);assert.doesNotMatch(cleared,/<b class="workflow-change-label">REMOVIDO<\/b>/);assert.match(changed,/<b class="workflow-change-label">DE<\/b>/);assert.match(changed,/<b class="workflow-change-label">PARA<\/b>/)});
