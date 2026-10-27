const isAnesthesiologist=window.MedicalDirectory.isAnesthesiologist;
function appointmentInsurance(a){return a.insurance!=null?String(a.insurance):patient(a.patientId)?.insurance||""}
const Storage={
 key:"agendaRNData_v5",
 defaultData(){
  return {schemaVersion:7,
   patients:[], professionals:[], hospitals:[],
   settings:{workStart:"07:00",workEnd:"19:00"},appointments:[],cancelledAppointments:[],patientHistory:[],schedulingRules:[],scheduleBlocks:[]
  }
 },
 migrate(d){
  const f=this.defaultData();if(!d||typeof d!=="object")return f;
  const x={...f,...d,schemaVersion:7};
  x.patients=(d.patients||f.patients).map(p=>({...p,insurance:p.insurance||"",cardNumber:p.cardNumber||"",doctorId:p.doctorId||(d.appointments||[]).find(a=>a.patientId===p.id)?.doctorId||""}));
  x.professionals=(d.professionals||f.professionals).map(p=>({...p,crm:p.crm||"",specialty:p.specialty||""}));
  x.hospitals=Array.isArray(d.hospitals)?d.hospitals:[];
  x.patientHistory=Array.isArray(d.patientHistory)?d.patientHistory:[];x.schedulingRules=Array.isArray(d.schedulingRules)?d.schedulingRules.map(r=>({...r,blockAllDay:!!r.blockAllDay})):[];x.scheduleBlocks=Array.isArray(d.scheduleBlocks)?d.scheduleBlocks.map(b=>({...b,hospitalId:null})):[];
  const normalizeAppointment=a=>{const allowed=["scheduled","confirmed","authorized","analysis","realized"],legacy=a.status==="attended"||a.status==="completed"?"realized":a.status==="provisional"||a.status==="rescheduled"?"scheduled":a.status;return {...a,procedure:a.procedure||"Procedimento",guideExpiry:a.guideExpiry||"",payment:Number(a.payment||0),invoiceNumber:a.invoiceNumber||"",careType:a.careType||"outpatient",opme:!!a.opme,reports:!!a.reports,exams:!!a.exams,status:allowed.includes(legacy)?legacy:"scheduled",rescheduleHistory:Array.isArray(a.rescheduleHistory)?a.rescheduleHistory:[],rescheduleReason:a.rescheduleReason||""}};
  const legacyCancelled=(d.appointments||[]).filter(a=>a.status==="cancelled").map(a=>({...normalizeAppointment(a),cancelledAt:a.cancelledAt||new Date().toISOString(),cancelReason:a.cancelReason||"Não informado"}));
  const archived=[...(Array.isArray(d.cancelledAppointments)?d.cancelledAppointments:[]),...legacyCancelled];
  x.cancelledAppointments=[...new Map(archived.map(a=>[a.id,{...normalizeAppointment(a),cancelledAt:a.cancelledAt||"",cancelReason:a.cancelReason||"Não informado"}])).values()];
  x.appointments=(d.appointments||[]).filter(a=>a.status!=="cancelled").map(normalizeAppointment);
  return x
 },
 load(){
  const data=this.migrate(window.AgendaInitialState);delete window.AgendaInitialState;return data;
 },
 save(d){this.pending=JSON.stringify(d);if(!this.saving)this.inFlight=this.flush();return this.inFlight},
 async flush(){
  this.saving=true;
  try{while(this.pending){const body=this.pending;this.pending=null;const response=await fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json","if-match":window.AgendaRevision||"new"},body}),result=await response.json();if(!response.ok)throw Error(result.error||"Não foi possível salvar no servidor.");if(result.revision)window.AgendaRevision=result.revision;}return true}
  catch(error){this.pending=null;await appNotice("Alteração não salva",error.message+" A agenda será recarregada. Confira os dados antes de repetir a alteração.");const response=await fetch("/api/state",{cache:"no-store"});if(response.ok){const snapshot=await response.json();window.AgendaRevision=snapshot.revision;state=Storage.migrate(snapshot.state);closeModals();renderAll()}return false}
  finally{this.saving=false;window.AgendaSyncAfterSave?.()}
 }

};
let state=Storage.load(),calendarMode="week",currentDate=startOfWeek(new Date()),detailPatientId=null,workflowData={requests:[],notifications:[],audit:[]};
const $=id=>document.getElementById(id),qsa=s=>[...document.querySelectorAll(s)];
let remoteAgendaUpdatePending=false,remoteAgendaRevision=null,agendaSyncInFlight=false,agendaSyncTimer=null,agendaSyncDelay=3000;
function agendaRevisionIsNewer(serverRevision,currentRevision){if(!serverRevision)return false;if(!currentRevision)return true;const serverTime=Date.parse(serverRevision),currentTime=Date.parse(currentRevision);return Number.isFinite(serverTime)&&Number.isFinite(currentTime)?serverTime>currentTime:false}
function agendaSyncDecision({serverRevision,currentRevision,editorOpen=false,saving=false,pending=false}={}){if(!agendaRevisionIsNewer(serverRevision,currentRevision))return "ignore";return editorOpen||saving||pending?"pending":"apply"}
function agendaEditorOpen(){return !!document.querySelector(".modal:not(.hidden),dialog[open]")}
function remoteAgendaNotice(show){let notice=$("remoteAgendaUpdateNotice");if(show&&!agendaEditorOpen()&&!notice){notice=document.createElement("div");notice.id="remoteAgendaUpdateNotice";notice.className="remote-agenda-update-notice";notice.setAttribute("role","status");notice.textContent="A agenda foi atualizada por outra pessoa. Conclua ou feche esta edição para carregar as alterações.";document.body.appendChild(notice)}if(notice)notice.hidden=!show||agendaEditorOpen()}
function clearRemoteAgendaUpdate(){remoteAgendaUpdatePending=false;remoteAgendaRevision=null;remoteAgendaNotice(false)}
function agendaRemotePendingDecision(remoteRevision,currentRevision){return agendaRevisionIsNewer(remoteRevision,currentRevision)?"keep":"clear"}
function reconcileRemoteAgendaUpdate(){if(!remoteAgendaUpdatePending)return true;if(agendaRemotePendingDecision(remoteAgendaRevision,window.AgendaRevision)==="clear"){clearRemoteAgendaUpdate();return true}return false}
function agendaRemoteNoticeMode({saving=false,pending=false}={}){return saving||pending?"silent":"show"}
function agendaRemoteUpdateAfterSave({remoteRevision,currentRevision,editorOpen=false}={}){return agendaRemotePendingDecision(remoteRevision,currentRevision)==="clear"?"clear":editorOpen?"notice":"apply"}
function rememberRemoteAgendaUpdate(revision,{silent=false}={}){if(!agendaRevisionIsNewer(revision,window.AgendaRevision)){reconcileRemoteAgendaUpdate();return}remoteAgendaUpdatePending=true;remoteAgendaRevision=revision||remoteAgendaRevision;if(silent)remoteAgendaNotice(false);else remoteAgendaNotice(true)}
function calendarScrollPosition(){const card=document.querySelector(".agenda-card");return card&&card.offsetParent!==null?{left:card.scrollLeft,top:card.scrollTop,pageX:window.scrollX,pageY:window.scrollY}:null}
function restoreCalendarScroll(position){if(!position)return;const card=document.querySelector(".agenda-card");if(card){card.scrollLeft=position.left;card.scrollTop=position.top}window.scrollTo(position.pageX,position.pageY)}
async function refreshWorkflowRevision(workflowRevision){if(Object.prototype.hasOwnProperty.call(window,"AgendaWorkflowRevision")&&window.AgendaWorkflowRevision===workflowRevision)return false;const refreshed=await refreshWorkflow();if(refreshed)window.AgendaWorkflowRevision=workflowRevision;return refreshed}
async function applyRemoteAgendaUpdate(expectedRevision,workflowRevision,workflowRefreshed=false){
 if(agendaSyncInFlight)return;agendaSyncInFlight=true;
 try{const response=await fetch("/api/state",{cache:"no-store"});if(!response.ok)return;const snapshot=await response.json(),decision=agendaSyncDecision({serverRevision:snapshot.revision,currentRevision:window.AgendaRevision,editorOpen:agendaEditorOpen(),saving:Storage.saving,pending:Storage.pending});
  if(decision==="ignore"){reconcileRemoteAgendaUpdate();return}
  if(decision==="pending"){rememberRemoteAgendaUpdate(snapshot.revision||expectedRevision,{silent:agendaRemoteNoticeMode({saving:Storage.saving,pending:Storage.pending})==="silent"});return}
  const scroll=calendarScrollPosition();window.AgendaRevision=snapshot.revision;state=Storage.migrate(snapshot.state);clearRemoteAgendaUpdate();renderAll();restoreCalendarScroll(scroll);if(!workflowRefreshed)await refreshWorkflowRevision(workflowRevision);
 }catch{/* A próxima verificação recupera falhas temporárias sem tocar no estado local. */}finally{agendaSyncInFlight=false}
}
async function checkAgendaRevision(){
 if(agendaSyncInFlight||document.visibilityState!=="visible")return;
 agendaSyncInFlight=true;
 try{const response=await fetch("/api/state/revision",{cache:"no-store"});if(!response.ok)throw Error("revision");const signal=await response.json(),revision=signal.revision,workflowRevision=signal.workflowRevision;
  const workflowRefreshed=await refreshWorkflowRevision(workflowRevision);
  const decision=agendaSyncDecision({serverRevision:revision,currentRevision:window.AgendaRevision,editorOpen:agendaEditorOpen(),saving:Storage.saving,pending:Storage.pending});
  if(decision==="pending")rememberRemoteAgendaUpdate(revision,{silent:agendaRemoteNoticeMode({saving:Storage.saving,pending:Storage.pending})==="silent"});else if(decision==="apply"){agendaSyncInFlight=false;await applyRemoteAgendaUpdate(revision,workflowRevision,workflowRefreshed);return}else reconcileRemoteAgendaUpdate();
  agendaSyncDelay=3000;
 }catch{agendaSyncDelay=Math.min(30000,Math.max(3000,agendaSyncDelay*2))}finally{agendaSyncInFlight=false}
}
function startAgendaSync(){
 window.AgendaSyncCleanup?.();let stopped=false;
 const schedule=delay=>{clearTimeout(agendaSyncTimer);if(!stopped)agendaSyncTimer=setTimeout(async()=>{await checkAgendaRevision();schedule(agendaSyncDelay)},delay)};
 const wake=()=>{if(document.visibilityState==="visible"){void checkAgendaRevision();schedule(agendaSyncDelay)}};
 const onVisibility=()=>{if(document.visibilityState==="visible")wake()};
 document.addEventListener("visibilitychange",onVisibility);window.addEventListener("focus",wake);window.addEventListener("online",wake);
 window.AgendaSyncAfterModalClose=()=>{if(remoteAgendaUpdatePending&&!reconcileRemoteAgendaUpdate())wake()};window.AgendaSyncAfterSave=()=>{if(!remoteAgendaUpdatePending)return;const next=agendaRemoteUpdateAfterSave({remoteRevision:remoteAgendaRevision,currentRevision:window.AgendaRevision,editorOpen:agendaEditorOpen()});if(next==="clear"){clearRemoteAgendaUpdate();return}if(next==="notice"){remoteAgendaNotice(true);return}void applyRemoteAgendaUpdate(remoteAgendaRevision)};
 window.AgendaSyncCleanup=()=>{stopped=true;clearTimeout(agendaSyncTimer);document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("focus",wake);window.removeEventListener("online",wake);clearRemoteAgendaUpdate();$("remoteAgendaUpdateNotice")?.remove();delete window.AgendaSyncAfterModalClose;delete window.AgendaSyncAfterSave};
 schedule(3000);
}
function pad(n){return String(n).padStart(2,"0")}function ds(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function parseDate(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}function startOfWeek(x){const d=new Date(x),day=d.getDay();d.setDate(d.getDate()-day);d.setHours(0,0,0,0);return d}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}function sameDay(a,b){return ds(a)===ds(b)}function mins(t){const[h,m]=t.split(":").map(Number);return h*60+m}function hhmm(v){return `${pad(Math.floor(v/60))}:${pad(v%60)}`}
function hospitalAcronym(value=""){
 const abbreviation=typeof value==="object"&&value?String(value.abbreviation||"").trim():"";
 if(abbreviation)return abbreviation.toLocaleUpperCase("pt-BR");
 const name=typeof value==="object"&&value?value.name||"":value;
 if(String(name).trim().toLowerCase()==="hospital blanc")return "BLANC";
 const words=String(name).trim().split(/\s+/).filter(w=>w&&!/^(de|da|do|das|dos)$/i.test(w));
 if(!words.length)return "H";
 if(words.length===1)return words[0].slice(0,4).toUpperCase();
 return words.map(w=>w[0]).join("").slice(0,4).toUpperCase();
}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function prof(id){return state.professionals.find(x=>x.id===id)}function patient(id){return state.patients.find(x=>x.id===id)}function hospital(id){return state.hospitals.find(x=>x.id===id)}function selectedProf(){return prof($("professionalFilter").value)}
function statusLabel(s){return({scheduled:"Agendado",confirmed:"Confirmado",authorized:"Autorizado",analysis:"Análise",realized:"Atendido",rescheduled:"Agendado",provisional:"Agendado",attended:"Atendido"})[s]||s}
function occurrenceInMonth(date){
 const d=new Date(date),day=d.getDay(),dayNum=d.getDate();
 const occurrence=Math.ceil(dayNum/7);
 const nextSame=new Date(d);nextSame.setDate(dayNum+7);
 return {occurrence,isLast:nextSame.getMonth()!==d.getMonth(),weekday:day}
}
function csvTimes(value){return String(value||"").split(",").map(x=>x.trim()).filter(Boolean)}
function overlap(startA,endA,startB,endB){return startA<endB&&endA>startB}
function assignCalendarLanes(entries=[]){
 const sorted=[...entries].filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).sort((a,b)=>a.start-b.start||a.end-b.end||String(a.key).localeCompare(String(b.key))),assignments=new Map();let group=[],groupEnd=-Infinity;
 const commit=()=>{if(!group.length)return;const laneEnds=[];for(const entry of group){let lane=laneEnds.findIndex(end=>end<=entry.start);if(lane<0){lane=laneEnds.length;laneEnds.push(entry.end)}else laneEnds[lane]=entry.end;assignments.set(entry.key,{lane,total:0})}for(const entry of group)assignments.get(entry.key).total=laneEnds.length;group=[];groupEnd=-Infinity};
 for(const entry of sorted){if(group.length&&entry.start>=groupEnd)commit();group.push(entry);groupEnd=Math.max(groupEnd,entry.end)}commit();return assignments
}
function blockAppliesToAppointment(block,a){
 if(block.date!==a.date)return false;
 const s=mins(a.time),e=s+Number(a.duration||0);
 return overlap(s,e,mins(block.start),mins(block.end))
}
function blocksForProfessional(professionalId,date){
 return state.scheduleBlocks.filter(b=>b.professionalId===professionalId&&b.date===date)
}
function evaluateSchedulingRules(a){
 const messages=[];
 const appointmentDate=parseDate(a.date),occ=occurrenceInMonth(appointmentDate);
 const rules=state.schedulingRules.filter(r=>r.enabled!==false&&r.professionalId===a.doctorId);
 for(const r of rules){
   if(r.hospitalId&&r.hospitalId!==a.hospitalId)continue;
   if(r.weekday!==""&&r.weekday!==null&&r.weekday!==undefined&&Number(r.weekday)!==occ.weekday)continue;
   if(r.occurrence){
     if(r.occurrence==="last"&&!occ.isLast)continue;
     if(r.occurrence!=="last"&&Number(r.occurrence)!==occ.occurrence)continue;
   }
   if(r.procedureContains&& !String(a.procedure||"").toLowerCase().includes(String(r.procedureContains).toLowerCase()))continue;
   const issues=[];
   const t=mins(a.time),end=t+Number(a.duration||0);
   if(r.blockAllDay)issues.push("dia inteiro bloqueado");
   if(r.start&&t<mins(r.start))issues.push(`antes de ${r.start}`);
   if(r.end&&end>mins(r.end))issues.push(`termina após ${r.end}`);
   const forbidden=csvTimes(r.forbiddenTimes);
   if(forbidden.includes(a.time))issues.push(`horário ${a.time} é proibido`);
   const preferred=csvTimes(r.preferredTimes);
   if(preferred.length&&!preferred.includes(a.time))issues.push(`horários preferenciais: ${preferred.join(", ")}`);
   if(r.maxPatients){
     const count=state.appointments.filter(x=>x.id!==a.id&&x.doctorId===a.doctorId&&x.date===a.date&&x.status!=="cancelled"&&(!r.hospitalId||x.hospitalId===r.hospitalId)).length;
     if(count>=Number(r.maxPatients))issues.push(`limite de ${r.maxPatients} paciente(s) no dia atingido`);
   }
   if(issues.length)messages.push({severity:r.blockAllDay?"block":r.severity||"warning",name:r.name||"Regra",text:issues.join(" · ")});
 }
 return messages
}
function evaluateManualBlocksAbsolute(a){
 const issues=[];
 if(!a||!a.date||!a.time)return issues;
 const ids=[a.doctorId,a.anesthetistId].filter(Boolean);
 const start=mins(a.time),end=start+Number(a.duration||0);
 for(const pid of ids){
   for(const b of state.scheduleBlocks){
     if(b.professionalId!==pid||b.date!==a.date)continue;
     const bs=mins(b.start),be=mins(b.end);
     if(overlap(start,end,bs,be)){
       issues.push({
         professionalId:pid,
         block:b,
         severity:"block",
         name:"BLOQUEIO MANUAL",
         text:`${prof(pid)?.name||"Profissional"} · ${b.start} - ${b.end} · ${b.reason}`
       });
     }
   }
 }
 return issues;
}

function manualBlockForSlot(owner,date,time,duration=60){
 if(!owner)return null;
 const draft={
   date,
   time,
   duration,
   doctorId:(owner&&!isAnesthesiologist(owner))?owner.id:null,
   anesthetistId:isAnesthesiologist(owner)?owner.id:null
 };
 return evaluateManualBlocksAbsolute(draft)[0]||null;
}

function formatRuleSummary(r){
 const parts=[];
 if(r.hospitalId)parts.push(hospital(r.hospitalId)?.name||"Hospital");
 if(r.weekday!=="")parts.push(["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][Number(r.weekday)]);
 if(r.occurrence)parts.push(r.occurrence==="last"?"última ocorrência":`${r.occurrence}ª ocorrência`);
 if(r.start||r.end)parts.push(`${r.start||"…"}–${r.end||"…"}`);
 if(r.maxPatients)parts.push(`máx. ${r.maxPatients}/dia`);
 if(r.preferredTimes)parts.push(`preferência: ${r.preferredTimes}`);
 if(r.forbiddenTimes)parts.push(`proibidos: ${r.forbiddenTimes}`);
 if(r.procedureContains)parts.push(`procedimento: ${r.procedureContains}`);
 if(r.blockAllDay)parts.push("dia inteiro bloqueado");
 return parts.join(" · ")||"Sem filtros adicionais";
}
function ruleMatchesDate(r,dateString){
 if(r.enabled===false)return false;
 const d=parseDate(dateString),occ=occurrenceInMonth(d);
 if(r.weekday!==""&&r.weekday!==null&&r.weekday!==undefined&&Number(r.weekday)!==occ.weekday)return false;
 if(r.occurrence){
   if(r.occurrence==="last"&&!occ.isLast)return false;
   if(r.occurrence!=="last"&&Number(r.occurrence)!==occ.occurrence)return false;
 }
 return true;
}
function activeRulesForDate(owner,dateString){
 if(!owner||isAnesthesiologist(owner))return [];
 return state.schedulingRules.filter(r=>r.professionalId===owner.id&&ruleMatchesDate(r,dateString));
}
function hardRuleIntervalsForDate(owner,dateString){
 if(!owner||isAnesthesiologist(owner))return [];
 // Same local-clock rule projection used by mobile and server checks.
 return window.RNAvailability.availabilityIntervals(state,owner.id,dateString)
  .filter(interval=>interval.kind==="rule")
  .map(interval=>({...interval,label:interval.rule?.blockAllDay
    ?`Dia bloqueado: ${interval.reason}`:`Fora da regra: ${interval.reason}`}));
}

function evaluateVisibleHardRuleBlocks(a){
 const surgeon=prof(a.doctorId);
 if(!surgeon||isAnesthesiologist(surgeon)||!a.date||!a.time)return [];
 const s=mins(a.time),e=s+Number(a.duration||0);
 return hardRuleIntervalsForDate(surgeon,a.date)
   .filter(x=>overlap(s,e,x.start,x.end))
   .map(x=>({
     severity:"block",
     name:x.rule?.name||"Regra de bloqueio",
     text:`intervalo indisponível ${hhmm(x.start)} - ${hhmm(x.end)}`
   }));
}
function getAbsoluteSchedulingBlocks(a){
 const issues=[];
 if(!a||!a.date||!a.time)return issues;

 // 1) Bloqueios manuais são absolutos por profissional + data + intervalo.
 for(const item of evaluateManualBlocksAbsolute(a)){
   issues.push({
     severity:"block",
     name:item.name,
     text:item.text
   });
 }

 // 2) Regras absolutas do cirurgião.
 const surgeon=prof(a.doctorId);
 if((surgeon&&!isAnesthesiologist(surgeon))){
   const dateRules=activeRulesForDate(surgeon,a.date).filter(r=>r.severity==="block"||r.blockAllDay);

   // Dia inteiro é absoluto. Não pode ser furado mudando hospital/procedimento.
   for(const r of dateRules.filter(r=>r.blockAllDay)){
     issues.push({
       severity:"block",
       name:"DIA BLOQUEADO",
       text:r.name||"Regra de bloqueio"
     });
   }

   // Qualquer faixa cinza mostrada na agenda também é absoluta.
   for(const x of evaluateVisibleHardRuleBlocks(a)){
     if(!issues.some(i=>i.name===x.name&&i.text===x.text))issues.push(x);
   }
 }

 return issues;
}




function persist(){const saved=Storage.save(state);renderAll();return saved}function toast(s){$("toast").textContent=s;$("toast").classList.remove("hidden");clearTimeout(window.tt);window.tt=setTimeout(()=>$("toast").classList.add("hidden"),1800)}
let systemDialogResolve=null;
function appDialog({title="Aviso",message="",confirmText="Entendi",cancelText="",danger=false}={}){
 return new Promise(resolve=>{
  systemDialogResolve=resolve;$("systemDialogTitle").textContent=title;$("systemDialogMessage").textContent=message;
  $("systemDialogConfirm").textContent=confirmText;$("systemDialogConfirm").className=danger?"danger-btn":"primary-btn";
  $("systemDialogCancel").textContent=cancelText||"Cancelar";$("systemDialogCancel").classList.toggle("hidden",!cancelText);openModal("systemDialog")
 })
}
function finishAppDialog(value){if(!systemDialogResolve)return;const done=systemDialogResolve;systemDialogResolve=null;closeModals();done(value)}
function appNotice(title,message){return appDialog({title,message,confirmText:"Entendi"})}
function appConfirm(title,message,confirmText="Continuar",danger=false){return appDialog({title,message,confirmText,cancelText:"Voltar",danger})}
function hist(pid,type,text,aid=null){if(!pid)return;state.patientHistory.push({id:crypto.randomUUID(),patientId:pid,type,text,appointmentId:aid,at:new Date().toISOString()})}
function renderProfessionalOptions(){
 const sel=$("professionalFilter"),old=sel.value;
 const auth=window.AgendaAuth||{},enabled=state.professionals.filter(p=>p.agendaEnabled!==false&&p.active!==false),allowed=auth.role==="general_manager"?enabled:enabled.filter(p=>(auth.agendaIds||[]).includes(p.id));
 sel.innerHTML=[["doctor","Cirurgiões"],["anesthetist","Anestesistas"]].map(([category,label])=>{const rows=allowed.filter(p=>(category==="anesthetist"?isAnesthesiologist(p):!isAnesthesiologist(p))).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));return rows.length?`<optgroup label="${label}">${rows.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.crm?` — CRM ${esc(p.crm)}`:""}</option>`).join("")}</optgroup>`:""}).join("");
 sel.disabled=!allowed.length;sel.setAttribute("aria-label",allowed.length?"Agenda do profissional":"Nenhuma agenda disponível");
 if([...sel.options].some(o=>o.value===old))sel.value=old;else if(sel.options[0])sel.value=sel.options[0].value
}
function openAgendaPrint(){
 const owner=selectedProf();if(!owner)return;
 document.getElementById("agendaPrintDialog")?.remove();
 const dialog=document.createElement("dialog");dialog.id="agendaPrintDialog";dialog.className="agenda-print-dialog";
 dialog.innerHTML=`<form method="dialog" class="print-dialog-content"><span class="print-dialog-eyebrow">Agenda</span><h3>Visualizar agenda</h3><p>${esc(owner.name)}</p><div class="print-dialog-fields"><label>Período<select id="agendaPrintPeriod"><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label><label>Data de referência<input id="agendaPrintDate" type="date" required value="${ds(currentDate)}"></label></div><div class="print-dialog-actions"><button value="cancel" class="secondary-btn">Cancelar</button><button type="button" id="confirmAgendaPrint" class="primary-btn">Visualizar PDF</button></div></form>`;
 document.body.appendChild(dialog);dialog.showModal();
 $("confirmAgendaPrint").onclick=()=>{
  const input=$("agendaPrintDate");if(!input.reportValidity())return;
  const params=new URLSearchParams({professional_id:owner.id,period:$("agendaPrintPeriod").value,date:input.value});
  window.open("/api/reports/agenda?"+params.toString(),"_blank","noopener,noreferrer");
  dialog.close();
 };
}

function mountAgendaOwnerSelector(owner){
 const display=$("agendaOwnerDisplay"),sel=$("professionalFilter");if(!display||!sel)return;
 document.querySelector(".agenda-owner")?.classList.add("agenda-owner-hidden");
 display.classList.add("agenda-owner-select-card");
 display.innerHTML=`<div class="agenda-owner-card-copy"><strong>${esc(owner.name)}${owner.crm?` <span class="crm">- CRM: ${esc(owner.crm)}</span>`:""}</strong><span class="agenda-specialty">${esc(owner.specialty||"Sem especialidade")}</span></div><span class="agenda-owner-arrow">⌄</span>`;
 display.appendChild(sel);
 const print=document.createElement("button");print.type="button";print.className="agenda-print-btn";print.title="Imprimir agenda";print.setAttribute("aria-label","Imprimir agenda");print.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6z"/></svg>';print.onclick=openAgendaPrint;display.appendChild(print);
}
function renderAppointmentOptions(){
 const owner=selectedProf(),doctorId=(owner&&!isAnesthesiologist(owner))?owner.id:($("relatedProfessional")?.value||"");
 const ps=$("appointmentPatient"),op=ps.value,available=state.patients.filter(p=>!doctorId||p.doctorId===doctorId),optional=isAnesthesiologist(owner);ps.required=!optional;ps.innerHTML=(optional?'<option value="">Paciente ainda não informado</option>':"")+available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");if([...ps.options].some(o=>o.value===op))ps.value=op;else ps.value=optional?"":(available[0]?.id||"");
 const insuranceOptions=[...new Set(state.patients.map(p=>p.insurance?.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));$("appointmentInsuranceOptions").innerHTML=insuranceOptions.map(name=>`<option value="${esc(name)}"></option>`).join("");updateStandaloneInsuranceField();
 const hs=$("appointmentHospital"),oh=hs.value;hs.innerHTML=state.hospitals.map(h=>`<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");if([...hs.options].some(o=>o.value===oh))hs.value=oh;
}
function updateStandaloneInsuranceField(){const input=$("appointmentInsurance");$("appointmentInsuranceLabel").classList.remove("hidden");input.required=$("appointmentBillingMethod").value==="CONVENIO"}
function daysUntil(dateString){
 if(!dateString)return null;const today=parseDate(ds(new Date())),target=parseDate(dateString);return Math.ceil((target-today)/86400000)
}
function appointmentPendingFlags(a){
 const day=daysUntil(a.date),guideDays=daysUntil(a.guideExpiry),today=ds(new Date());
 return {
  invoice:a.status==="realized"&&!(Object.hasOwn(financialInvoices,a.id)?financialInvoices[a.id]:a.invoiceNumber)&&day!==null&&day<=-1,
  missingGuide:a.date>=today&&!a.guideExpiry,
  confirmation:day!==null&&day>=0&&day<=2&&!["confirmed","authorized","realized"].includes(a.status),
  guide:guideDays!==null&&guideDays>=0&&guideDays<=5
 };
}
function appointmentPendingReasons(a){
 const flags=appointmentPendingFlags(a);
 return [flags.invoice&&"NF não informada",flags.missingGuide&&"Validade da guia não informada",flags.confirmation&&"Atendimento aguardando confirmação",flags.guide&&"Guia próxima do vencimento"].filter(Boolean);
}
function pendingMark(reason,place=""){
 return `<span class="appointment-pending-mark ${place}" role="img" aria-label="Pendência: ${esc(reason)}" title="${esc(reason)}">!</span>`;
}
function appointmentPendingBadge(a){
 if((window.AgendaAuth||{}).role==="doctor")return "";
 const reasons=appointmentPendingReasons(a);
 return reasons.length?pendingMark(reasons.join(" · "),"card-pending-mark"):"";
}
function renderGuideAlerts(){
 const owner=selectedProf();if(!owner){$("guideAlert").dataset.count="0";$("guideAlert").classList.add("hidden");return}
 const relevant=state.appointments.filter(a=>(isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner.id)&&a.status!=="cancelled"&&appointmentPendingFlags(a).guide)
  .map(a=>({a,days:daysUntil(a.guideExpiry)})).sort((x,y)=>x.days-y.days);
 $("guideAlert").dataset.count=String(relevant.length);if(!relevant.length){$("guideAlert").classList.add("hidden");return}
 $("guideAlertList").innerHTML=relevant.map(({a,days})=>`<button type="button" class="notification-item" data-alert-appointment="${esc(a.id)}">Guia do paciente <strong>${esc(patient(a.patientId)?.name||"Paciente")}</strong> — ${days===0?"vence hoje":`vence em ${days} dia(s)`} (${parseDate(a.guideExpiry).toLocaleDateString("pt-BR")}) · ${esc(a.procedure||"Procedimento")}</button>`).join("");
 $("guideAlert").classList.remove("hidden")
}
let financialInvoices={},financialIssuedAppointments=new Set(),financialRefreshAt=0;
function syncAppointmentPendingBadges(){
 if((window.AgendaAuth||{}).role==="doctor")return;
 const byId=new Map((state.appointments||[]).map(a=>[a.id,a]));
 qsa(".appointment[data-id],.mobile-appointment[data-mobile-appointment]").forEach(button=>{
  const a=byId.get(button.dataset.id||button.dataset.mobileAppointment);
  if(!a)return;
  button.querySelector(".card-pending-mark")?.remove();
  const badge=typeof appointmentPendingBadge==="function"?appointmentPendingBadge(a):"";
  if(badge)button.insertAdjacentHTML("afterbegin",badge);
  button.classList.toggle("has-pending",!!badge);
 });
 const finance=$("nativeFinance"),a=byId.get($("appointmentId")?.value);
 if(finance&&a){
  const pending=appointmentPendingFlags(a).invoice;
  finance.classList.toggle("pending-finance",pending);
  finance.title=pending?"Pendência: NF não informada":"";
 }
}
async function refreshFinancialAlerts(){if((window.AgendaAuth||{}).role==="doctor"||Date.now()-financialRefreshAt<15000)return;financialRefreshAt=Date.now();try{const response=await fetch('/api/billing?summary=1',{cache:'no-store'});if(!response.ok)return;const result=await response.json();financialInvoices=Object.fromEntries(result.rows.map(r=>[r.appointment_id,r.invoice_number]));financialIssuedAppointments=new Set(result.rows.filter(r=>r.issued_invoice).map(r=>r.appointment_id));renderOperationalAlerts();updateNotificationCenter();syncAppointmentPendingBadges()}catch{}}
window.addEventListener('focus',refreshFinancialAlerts);
function renderOperationalAlerts(){
 refreshFinancialAlerts();
 const owner=selectedProf();
 if(!owner){["invoiceAlert","missingGuideAlert","confirmationAlert"].forEach(id=>$(id).classList.add("hidden"));return}
 const belongs=a=>isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner.id;
 const rows=state.appointments.filter(belongs),name=a=>patient(a.patientId)?.name||prof(a.doctorId)?.name||"Agendamento",summary=a=>`<strong>${esc(name(a))}</strong> — ${parseDate(a.date).toLocaleDateString("pt-BR")} às ${esc(a.time)} · ${esc(a.procedure||"Procedimento")}`;
 const show=(boxId,listId,items,detail)=>{const box=$(boxId);box.dataset.count=String(items.length);if(!items.length){box.classList.add("hidden");return}$(listId).innerHTML=items.map(a=>`<button type="button" class="notification-item" data-alert-appointment="${esc(a.id)}">${summary(a)}${detail(a)}</button>`).join("");box.classList.remove("hidden")};
 show("invoiceAlert","invoiceAlertList",rows.filter(a=>appointmentPendingFlags(a).invoice),()=>" · NF não informada");
 show("missingGuideAlert","missingGuideAlertList",rows.filter(a=>appointmentPendingFlags(a).missingGuide),()=>" · informe o vencimento da guia");
 show("confirmationAlert","confirmationAlertList",rows.filter(a=>appointmentPendingFlags(a).confirmation),a=>` · atendimento em ${daysUntil(a.date)===0?"hoje":daysUntil(a.date)===1?"1 dia":"2 dias"}`);
}
function updateNotificationCenter(){
 if((window.AgendaAuth||{}).role==="doctor"){$("agendaNotifications").classList.add("hidden");closeNotificationPanel();return}
 const alerts=["invoiceAlert","missingGuideAlert","confirmationAlert","guideAlert"],total=alerts.reduce((sum,id)=>sum+Number($(id).dataset.count||0),0),badge=$("notificationCount");badge.textContent=total>99?"99+":String(total);badge.classList.toggle("hidden",!total);$("notificationSummary").textContent=total?`${total} pendência${total===1?"":"s"}`:"Nenhuma pendência";$("notificationEmpty").classList.toggle("hidden",!!total);qsa("[data-alert-appointment]").forEach(button=>button.onclick=()=>{closeNotificationPanel();openAppointment(button.dataset.alertAppointment)})
}
function closeNotificationPanel(){$("notificationPanel").classList.add("hidden");$("notificationBell").setAttribute("aria-expanded","false")}
function toggleNotificationPanel(){if((window.AgendaAuth||{}).role==="doctor")return;const opening=$("notificationPanel").classList.contains("hidden");$("notificationPanel").classList.toggle("hidden",!opening);$("notificationBell").setAttribute("aria-expanded",String(opening))}
function dayConflictCount(day,appointments){
 const apps=appointments.filter(a=>a.date===day&&a.status!=="cancelled"),ids=new Set();
 apps.forEach(a=>apps.forEach(b=>{if(a.id!==b.id&&mins(a.time)<mins(b.time)+Number(b.duration||0)&&mins(a.time)+Number(a.duration||0)>mins(b.time)){ids.add(a.id);ids.add(b.id)}}));
 return ids.size;
}
function surgeonColor(id){const palette=["#dff4ef","#e8efff","#fff0d9","#f2e8ff","#ffe6ec","#e4f4ff","#edf4dc"];let n=0;for(const c of String(id||""))n=(n*31+c.charCodeAt(0))>>>0;return palette[n%palette.length]}
function setAgendaOwnerState(owner){
 const shell=document.querySelector(".agenda-shell"),empty=$("agendaEmptyState"),agendaContext=(window.AgendaInitialView||"agenda")==="agenda",hasOwner=Boolean(owner);
 shell?.classList.toggle("agenda-has-no-owner",agendaContext&&!hasOwner);empty?.classList.toggle("hidden",!agendaContext||hasOwner);
}
function renderCalendar(){
 const owner=selectedProf();setAgendaOwnerState(owner);if(!owner)return;
 renderMobileCalendar();
 mountAgendaOwnerSelector(owner);
 renderGuideAlerts();renderOperationalAlerts();updateNotificationCenter();
 const days=calendarMode==="week"?Array.from({length:7},(_,i)=>addDays(currentDate,i)):[new Date(currentDate)];
 $("periodLabel").textContent=calendarMode==="week"?currentDate.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}):currentDate.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
 $("periodRange").textContent=calendarMode==="week"?`${days[0].toLocaleDateString("pt-BR")} — ${days.at(-1).toLocaleDateString("pt-BR")}`:currentDate.toLocaleDateString("pt-BR");
 let start=mins(selectedProf()?.agendaSettings?.workStart||state.settings.workStart),end=mins(selectedProf()?.agendaSettings?.workEnd||state.settings.workEnd);
 const visible=state.appointments.filter(a=>isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner.id);
 const visibleDays=new Set(days.map(d=>ds(d)));
 const relevantAppointments=state.appointments.filter(a=>visibleDays.has(a.date)&&(isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner.id));
 const relevantBlocks=state.scheduleBlocks.filter(b=>visibleDays.has(b.date)&&b.professionalId===owner.id);
 const dayAppointments=new Map(days.map(d=>{const day=ds(d);return [day,visible.filter(a=>a.date===day&&a.status!=="cancelled")]}));
 const dayLaneAssignments=new Map(days.map(d=>{const day=ds(d),entries=[...(dayAppointments.get(day)||[]).map(a=>({key:"appointment:"+a.id,start:mins(a.time),end:mins(a.time)+Number(a.duration||0)})),...blocksForProfessional(owner.id,day).map(b=>({key:"block:"+b.id,start:mins(b.start),end:mins(b.end)}))];return [day,assignCalendarLanes(entries)]}));
 const timesToShow=[];
 relevantAppointments.forEach(a=>{timesToShow.push(mins(a.time));timesToShow.push(mins(a.time)+Number(a.duration||0))});
 relevantBlocks.forEach(b=>{timesToShow.push(mins(b.start));timesToShow.push(mins(b.end))});
 if(visibleDays.has(ds(new Date()))){
   const now=new Date(),nowMins=now.getHours()*60+now.getMinutes();
   timesToShow.push(nowMins);
 }
 if(timesToShow.length){
   const earliest=Math.min(...timesToShow),latest=Math.max(...timesToShow);
   start=Math.min(start,Math.floor(earliest/60)*60);
   end=Math.max(end,Math.ceil(latest/60)*60);
 }
 const hours=[];for(let m=start;m<end;m+=60)hours.push(m);
 const conflictDays=new Map(days.map(d=>[ds(d),isAnesthesiologist(owner)?dayConflictCount(ds(d),visible):0]));
 let conflicts=0,html=`<div class="calendar-grid ${calendarMode==="day"?"day-mode":""}"><div class="corner"></div>`;
 days.forEach(d=>{
  const rulesToday=activeRulesForDate(owner,ds(d));
  const dayConflicts=conflictDays.get(ds(d))||0;
  html+=`<div class="day-head ${sameDay(d,new Date())?"today":""}"><div class="dow">${d.toLocaleDateString("pt-BR",{weekday:"short"})}</div><div class="dom">${d.getDate()}</div>${dayConflicts?`<span class="day-conflict-label">Conflito</span>`:""}${rulesToday.length?`<span class="day-rule-badge" title="${esc(rulesToday.map(r=>r.name).join(", "))}">Regra ativa</span>`:""}</div>`
 });
 for(const hour of hours){
  html+=`<div class="time-cell">${hhmm(hour)}</div>`;
  for(const d of days){
   const day=ds(d),apps=visible.filter(a=>a.date===day&&mins(a.time)>=hour&&mins(a.time)<hour+60).sort((a,b)=>a.time.localeCompare(b.time));html+=`<div class="slot" data-date="${day}" data-hour="${hour}">`;
   const now=new Date(),nowMins=now.getHours()*60+now.getMinutes();
   if(day===ds(now)&&nowMins>=hour&&nowMins<hour+60){
     const nowTop=((nowMins-hour)/60)*64;
     html+=`<div class="now-line" style="top:${nowTop}px"><span class="now-time-label">${pad(now.getHours())}:${pad(now.getMinutes())}</span></div>`;
   }
   const ruleIntervals=hardRuleIntervalsForDate(owner,day).filter(x=>x.start>=hour&&x.start<hour+60);
   ruleIntervals.forEach(x=>{
     const top=Math.max(1,((x.start-hour)/60)*64+1);
     const height=Math.max(18,((x.end-x.start)/60)*64-2);
     const hosp=x.rule.hospitalId?` · ${hospital(x.rule.hospitalId)?.name||"Hospital"}`:"";
     html+=`<div class="rule-calendar-block continuous-rule-block" style="top:${top}px;height:${height}px" title="${esc(x.label+hosp)}">
       <div class="rule-block-center">
         <strong>${esc(x.rule.blockAllDay?"Dia bloqueado":x.label)}</strong>
         ${hosp?`<span>${esc(hosp.replace(" · ",""))}</span>`:""}
       </div>
     </div>`;
   });
   const ownerBlocks=blocksForProfessional(owner.id,day).filter(b=>mins(b.start)>=hour&&mins(b.start)<hour+60),lanes=dayLaneAssignments.get(day)||new Map(),dayApps=dayAppointments.get(day)||[];
   const laneStyle=key=>{const assignment=lanes.get(key);return !assignment||assignment.total<2?"":`left:calc(${(100/assignment.total)*assignment.lane}% + 3px);right:auto;width:calc(${100/assignment.total}% - 6px);`};
   ownerBlocks.forEach(b=>{
     const top=Math.max(2,((mins(b.start)-hour)/60)*64+2),height=Math.max(28,((mins(b.end)-mins(b.start))/60)*64-4);
     html+=`<button class="schedule-block" data-block-id="${esc(b.id)}" style="top:${top}px;height:${height}px;${laneStyle("block:"+b.id)}"><strong>${esc(b.start)} - ${esc(b.end)}</strong><span>${esc(b.reason)}</span></button>`;
   });
   if(isAnesthesiologist(owner)&&apps.length){
    apps.forEach(a=>{
     const overlaps=dayApps.filter(b=>a.id!==b.id&&overlap(mins(a.time),mins(a.time)+Number(a.duration||0),mins(b.time),mins(b.time)+Number(b.duration||0)));if(overlaps.length)conflicts++;
     html+=appointmentCard(a,hour,laneStyle("appointment:"+a.id),overlaps.length>0)
    })
   }else apps.forEach(a=>html+=appointmentCard(a,hour,laneStyle("appointment:"+a.id),false));
   html+="</div>"
  }
 }html+="</div>";$("calendar").innerHTML=html;
 const c=$("conflictSummary"),alert=$("anesthesiaConflictAlert");c.classList.add("hidden");if(isAnesthesiologist(owner)&&conflicts){$("anesthesiaConflictList").innerHTML=[...conflictDays].filter(([,count])=>count).map(([day,count])=>`<p><strong>${parseDate(day).toLocaleDateString("pt-BR")}</strong> — ${count} atendimento(s) em conflito. Revise os horários antes de confirmar a agenda.</p>`).join("");alert.classList.remove("hidden")}else{alert?.classList.add("hidden")}
 qsa(".appointment").forEach(b=>b.onclick=e=>{e.stopPropagation();openAppointment(b.dataset.id)});qsa(".schedule-block").forEach(b=>{
   b.onclick=e=>{e.stopPropagation();openBlock(b.dataset.blockId)};
   b.ondblclick=e=>{e.preventDefault();e.stopPropagation()};
 });
 qsa(".slot").forEach(s=>{
   s.ondblclick=async e=>{
     const owner=selectedProf(),time=hhmm(Number(s.dataset.hour));
     const issue=manualBlockForSlot(owner,s.dataset.date,time,60);
     if(issue){
       e.preventDefault();
       const who=prof(issue.professionalId)?.name||"Profissional";
       await appNotice("Horário bloqueado",`${who}: ${issue.block.start} - ${issue.block.end}\nMotivo: ${issue.block.reason}`);
       return;
     }
     if((owner&&!isAnesthesiologist(owner))){
       const draft={doctorId:owner.id,date:s.dataset.date,time,duration:60};
       const hard=evaluateVisibleHardRuleBlocks(draft);
       if(hard.length){
         e.preventDefault();
         await appNotice("Horário bloqueado por regra",hard.map(x=>`${x.name}: ${x.text}`).join("\n"));
         return;
       }
     }
     openAppointment(null,{date:s.dataset.date,time});
   };
 })
}
function phoneControl(value){return value?`<button type="button" class="phone-action" data-phone="${esc(value)}">${esc(value)}</button>`:"Sem telefone"}
function phoneNumber(value){const raw=String(value||"").trim(),international=raw.startsWith("+")||raw.startsWith("00");let number=raw.replace(/\D/g,"");if(number.startsWith("00"))number=number.slice(2);if(!international&&(number.length===10||number.length===11))number="55"+number;return number}
document.addEventListener("click",e=>{
 const target=e.target.closest("[data-phone]");if(!target)return;
 const number=phoneNumber(target.dataset.phone);if(number.length<10||number.length>15)return appNotice("Telefone inválido","Informe o número com DDD e código do país.");
 const dialog=document.createElement("dialog");dialog.className="agenda-print-dialog phone-dialog";
 dialog.innerHTML=`<div class="phone-dialog-head"><h3>Contato do paciente</h3><form method="dialog"><button class="phone-close" aria-label="Fechar" title="Fechar">×</button></form></div><p>${esc(target.dataset.phone)}</p><div class="phone-options"><a href="tel:+${number}" class="secondary-btn">Ligar</a><a href="https://wa.me/${number}" class="primary-btn" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>`;
 dialog.addEventListener("close",()=>dialog.remove());document.body.appendChild(dialog);dialog.showModal();
});
function hasAnesthesiaConflict(a,appointments,owner=selectedProf()){
 return isAnesthesiologist(owner)&&appointments.some(b=>b.id!==a.id&&b.anesthetistId===a.anesthetistId&&b.date===a.date&&b.status!=="cancelled"&&mins(a.time)<mins(b.time)+Number(b.duration||0)&&mins(b.time)<mins(a.time)+Number(a.duration||0));
}
function appointmentPartner(a,owner=selectedProf()){
 const partner=prof(isAnesthesiologist(owner)?a.doctorId:a.anesthetistId);
 return partner?doctorName(partner.name):(isAnesthesiologist(owner)?"Médico não informado":"Sem anestesista");
}
function appointmentCardContent(a,owner=selectedProf()){
 const p=patient(a.patientId),h=hospital(a.hospitalId);
 return `<strong>${esc(hospitalAcronym(h||"Hospital"))}: <b>${esc(a.time)} - ${esc(hhmm(mins(a.time)+Number(a.duration||0)))}</b></strong>
 <span class="appointment-patient">${esc(p?.name||"Paciente não informado")}</span>
 <span class="appointment-procedure">${esc(a.procedure||"Procedimento")}</span>
 <span class="appointment-surgeon">${esc(appointmentPartner(a,owner))}</span>
 <span class="appointment-card-footer"><span class="appointment-insurance">${esc(appointmentInsurance(a)||"Sem convênio")}</span><span class="appointment-status-badge ${esc(a.status)}">${esc(statusLabel(a.status))}</span></span>`;
}
function appointmentCard(a,hour,extra,conflict){
 const top=Math.max(3,((mins(a.time)-hour)/60)*64+3),height=Math.max(36,(a.duration/60)*64-6);
 const badge=typeof appointmentPendingBadge==="function"?appointmentPendingBadge(a):"";
 return `<button class="appointment ${a.status} ${conflict?"anesthesia-conflict":""} ${badge?"has-pending":""}" data-id="${esc(a.id)}" style="top:${top}px;height:${height}px;background:${isAnesthesiologist(selectedProf())?surgeonColor(a.doctorId):""};${extra}">${badge}${appointmentCardContent(a)}</button>`;
}
function renderPatients(){
 const auth=window.AgendaAuth||{},owner=selectedProf(),t=$("patientSearch").value.toLowerCase().trim(),allowed=auth.role==="doctor"?state.patients.filter(p=>(auth.agendaIds||[]).includes(p.doctorId)):(owner&&!isAnesthesiologist(owner))?state.patients.filter(p=>p.doctorId===owner.id):state.patients;
 const rows=allowed.filter(p=>`${p.name} ${p.phone} ${p.email} ${p.insurance} ${p.cardNumber}`.toLowerCase().includes(t));
 $("patientsTableWrap").innerHTML=rows.length?`<table class="table"><thead><tr><th>Nome</th><th>Médico</th><th>Convênio</th><th>Carteirinha</th><th>Telefone</th><th>Histórico</th>${auth.role==="doctor"?"":"<th></th>"}</tr></thead><tbody>${rows.map(p=>`<tr><td><button class="patient-name-btn" data-detail="${esc(p.id)}">${esc(p.name)}</button></td><td>${esc(prof(p.doctorId)?.name||"—")}</td><td>${esc(p.insurance||"—")}</td><td>${esc(p.cardNumber||"—")}</td><td>${phoneControl(p.phone)}</td><td>${state.patientHistory.filter(h=>h.patientId===p.id).length} evento(s)</td>${auth.role==="doctor"?"":`<td><button class="link-btn" data-patient="${esc(p.id)}">Editar</button></td>`}</tr>`).join("")}</tbody></table>`:'<div class="empty">Nenhum paciente encontrado.</div>';
 qsa("[data-patient]").forEach(b=>b.onclick=()=>openPatient(b.dataset.patient));qsa("[data-detail]").forEach(b=>b.onclick=()=>openPatientDetail(b.dataset.detail))
}
function renderSettings(){
 $("hospitalsList").innerHTML=state.hospitals.map(h=>`<div class="hospital-card"><div class="prof-left"><div class="hospital-icon">H</div><div class="prof-meta"><strong>${esc(h.name)}</strong><span>Disponível para todos</span></div></div><div class="hospital-actions"><button class="link-btn" data-ehospital="${esc(h.id)}">Editar</button><button class="link-btn" data-rhospital="${esc(h.id)}">Remover</button></div></div>`).join("")||'<div class="empty">Nenhum hospital cadastrado.</div>';
 qsa("[data-ehospital]").forEach(b=>b.onclick=()=>openHospital(b.dataset.ehospital));
 qsa("[data-rhospital]").forEach(b=>b.onclick=async()=>{if([...state.appointments,...state.cancelledAppointments,...state.schedulingRules].some(a=>a.hospitalId===b.dataset.rhospital))return appNotice("Hospital em uso","Esse hospital está vinculado a agendamentos e não pode ser removido.");if(!await appConfirm("Remover hospital","O hospital será removido das opções disponíveis.","Remover",true))return;state.hospitals=state.hospitals.filter(h=>h.id!==b.dataset.rhospital);persist()})
}

function renderRules(){
 const surgeonSelect=$("rulesProfessionalFilter"),old=surgeonSelect.value;
 const surgeons=state.professionals.filter(p=>window.AgendaDoctorId?p.id===window.AgendaDoctorId:(p&&!isAnesthesiologist(p)));
 surgeonSelect.innerHTML=surgeons.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
 if([...surgeonSelect.options].some(o=>o.value===old))surgeonSelect.value=old;else if(surgeonSelect.options[0])surgeonSelect.value=surgeonSelect.options[0].value;
 const pid=surgeonSelect.value,showAll=$("rulesStatusFilter").value==="all";
 const rules=state.schedulingRules.filter(r=>r.professionalId===pid&&(showAll||r.enabled!==false));
 $("rulesList").innerHTML=rules.length?rules.map(r=>`<div class="rule-card ${r.enabled===false?"rule-disabled":""}"><div class="rule-main"><strong>${esc(r.name)}<span class="rule-severity ${esc(r.severity||"warning")}">${r.severity==="preference"?"Preferência":r.severity==="block"?"Bloqueio":"Aviso"}</span></strong><span>${esc(formatRuleSummary(r))}</span></div><div class="rule-actions"><button class="tiny-btn" data-toggle-rule="${esc(r.id)}">${r.enabled===false?"Ativar":"Desativar"}</button><button class="tiny-btn" data-edit-rule="${esc(r.id)}">Editar</button></div></div>`).join(""):'<div class="empty">Nenhuma regra cadastrada para este cirurgião.</div>';
 $("configuredBlocks").innerHTML=state.scheduleBlocks.filter(b=>b.professionalId===pid).map(b=>`<div class="rule-card"><div><strong>${esc(b.date)} · ${esc(b.start)} – ${esc(b.end)}</strong><p>${esc(b.reason||"Bloqueio")}</p></div><button class="tiny-btn" data-config-block="${esc(b.id)}">Editar</button></div>`).join("")||'<p>Nenhum bloqueio pontual.</p>';qsa("[data-config-block]").forEach(b=>b.onclick=()=>openBlock(b.dataset.configBlock));
 qsa("[data-edit-rule]").forEach(b=>b.onclick=()=>openRule(b.dataset.editRule));
 qsa("[data-toggle-rule]").forEach(b=>b.onclick=async()=>{const r=state.schedulingRules.find(x=>x.id===b.dataset.toggleRule);if(r){r.enabled=r.enabled===false?true:false;if(await persist()===false)return;toast(r.enabled?"Regra ativada.":"Regra desativada.")}})
}

let accessUsers=[];
function roleLabel(role){return role==="general_manager"?"Gerente geral":role==="secretary"?"Secretaria":"Médico"}
function doctorName(name){const value=String(name||"Médico").trim();return /^dr\.?\s/i.test(value)?value:`Dr. ${value}`}
function accountName(account){return account?.role==="doctor"?doctorName(account.name||account.email):account?.name||account?.email||"Usuário"}
function accessAgendaLabel(user){
 const ids=user.agendaIds||[],all=state.professionals.length>0&&state.professionals.every(p=>ids.includes(p.id));
 if(user.role==="general_manager"||all)return "Todas as agendas";
 const names=ids.map(id=>prof(id)?.name).filter(Boolean);
 return names.length?names.join(" · "):"Nenhuma agenda";
}
async function renderAccess(){if((window.AgendaAuth||{}).role!=="general_manager")return;const response=await fetch("/api/access");if(!response.ok)return;accessUsers=(await response.json()).users||[];$("accessList").innerHTML=accessUsers.filter(u=>u.role!=="doctor").map(u=>`<div class="access-card"><div><strong>${esc(accountName(u))}</strong><span>${esc(u.email)} · ${roleLabel(u.role)}</span><small>${esc(accessAgendaLabel(u))}</small></div><button class="tiny-btn" data-access-user="${esc(u.id)}">${u.role==="doctor"?"Gerenciar em Médicos":"Editar"}</button></div>`).join("");qsa("[data-access-user]").forEach(b=>b.onclick=()=>openAccess(Number(b.dataset.accessUser)))}
function openAccess(id=null){const u=accessUsers.find(x=>x.id===id);if(u?.role==="doctor"){window.location.assign("/doctors?doctor_id="+encodeURIComponent(u.doctor_id||""));return}$("accessForm").reset();$("accessPassword").type="password";$("toggleAccessPassword").setAttribute("aria-pressed","false");$("toggleAccessPassword").setAttribute("aria-label","Mostrar senha");$("accessFormError").classList.add("hidden");$("accessId").value=u?.id||"";$("accessEmail").value=u?.email||"";$("accessName").value=u?.name||"";$("accessPassword").value="";$("accessPassword").required=!u;$("accessRole").value=u?.role||"secretary";$("accessEmail").disabled=u?.email===(window.AgendaAuth||{}).email;$("deleteAccessBtn").classList.toggle("hidden",!u||u.email===(window.AgendaAuth||{}).email);$("accessAgendaChoices").innerHTML=state.professionals.map(p=>`<label><input type="checkbox" value="${esc(p.id)}" ${(u?.agendaIds||[]).includes(p.id)?"checked":""}><span><strong>${esc(p.name)}</strong><small>${isAnesthesiologist(p)?"Anestesista":"Cirurgião"}${p.crm?` · CRM ${esc(p.crm)}`:""}</small></span></label>`).join("");const toggle=()=>{const all=$("accessRole").value==="general_manager";$("accessAgendaChoices").classList.toggle("hidden",all);$("accessAgendaSummary").textContent=all?"Gerente geral tem acesso a todas as agendas.":state.professionals.length?"Selecione as agendas que esta pessoa poderá acessar.":"Nenhum profissional cadastrado."};$("accessRole").onchange=toggle;toggle();openModal("accessModal")}
function initWorkflowUI(){
 document.querySelector(".agenda-nav").insertAdjacentHTML("beforeend",'<button class="agenda-nav-item workflow-reviewer" data-view="requests"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h16v16H4zM8 12l3 3 5-6"/></svg> Solicitações <span id="requestBadge" class="nav-badge hidden">0</span></button><button class="agenda-nav-item doctor-only" data-view="notifications"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2"/></svg> Histórico de alterações <span id="notificationBadge" class="nav-badge hidden">0</span></button><button class="agenda-nav-item workflow-reviewer" data-view="audit"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg> Logs Agendamento</button>');
 document.querySelector(".main").insertAdjacentHTML("beforeend",'<section id="cancelledView" class="view"><div class="content-card"><div class="section-head"><div><h2>Pacientes cancelados</h2><p>Atendimentos cancelados organizados por mês.</p></div></div><div id="cancelledList" class="workflow-list"></div></div></section><section id="requestsView" class="view workflow-reviewer"><div class="content-card"><div class="section-head page-description-head"><p class="page-description">Sugestões enviadas pelos médicos para sua aprovação.</p><select id="requestStatusFilter"><option value="pending">Pendentes</option><option value="all">Todas</option></select></div><div id="requestList" class="workflow-list"></div></div></section><section id="notificationsView" class="view doctor-only"><div class="content-card"><div class="section-head"><div><h2>Histórico de alterações</h2><p>Acompanhe o retorno das suas sugestões.</p></div><button id="markNotificationsRead" class="secondary-btn">Marcar como lidas</button></div><div id="notificationList" class="workflow-list"></div></div></section><section id="auditView" class="view workflow-reviewer"><div class="content-card"><div class="section-head page-description-head"><p class="page-description">Histórico de alterações nas agendas autorizadas.</p><button id="refreshAudit" class="secondary-btn">Atualizar</button></div><div class="agenda-log-filters" aria-label="Filtros dos logs de agendamento"><label>De<input id="auditStart" type="date"></label><label>Até<input id="auditEnd" type="date"></label><label>Usuário<select id="auditActor"><option value="">Todos</option></select></label><label>Agenda / médico<select id="auditProfessional"><option value="">Todas</option></select></label><label>Ação<select id="auditAction"><option value="">Todas</option><option value="created">Criação</option><option value="changed">Alteração</option><option value="removed">Remoção</option><option value="request">Solicitação</option></select></label><label class="agenda-log-search">Buscar<input id="auditSearch" type="search"></label><button id="auditClearFilters" class="secondary-btn" type="button">Limpar filtros</button></div><div id="auditList" class="agenda-log-timeline"></div></div></section>');
 $("agendaView").insertAdjacentHTML("afterbegin",'<div id="anesthesiaConflictAlert" class="alert-strip conflict-alert hidden"><div>⚠</div><div><strong>Conflitos na agenda do anestesista</strong><div id="anesthesiaConflictList" class="alert-list"></div></div></div>');
 document.querySelector(".filters").insertBefore($("newBlockBtn"),$("statusFilter"));$("statusFilter").remove();
 const pageHeading=document.querySelector(".topbar > div:first-child");pageHeading.classList.add("agenda-page-heading");pageHeading.innerHTML="";
 const modeControl=document.querySelector(".filters .segmented");document.querySelector(".date-wrap")?.append(modeControl);
 document.querySelector(".date-wrap")?.insertAdjacentHTML("beforeend",'<button id="cancelledPageBtn" class="secondary-btn cancelled-inline-btn">Cancelados</button>');
 document.querySelector(".filters")?.insertAdjacentElement("beforeend",$("cancelledPageBtn"));
 document.querySelector(".filters")?.insertAdjacentElement("beforeend",$("newAppointmentBtn"));
 document.querySelector(".filters")?.insertAdjacentElement("beforeend",$("agendaNotifications"));
 $("guideExpiry").closest("label").insertAdjacentHTML("afterend",'<input id="appointmentPayment" type="hidden"><input id="appointmentInvoice" type="hidden">');

 $("appointmentForm").insertAdjacentHTML("afterbegin",'<section id="appointmentDetailView" class="appointment-detail hidden" aria-live="polite"></section>');
 $("patientName").closest("label").insertAdjacentHTML("beforebegin",'<label>Médico responsável<select id="patientDoctor" required></select></label>');
 $("requestStatusFilter").onchange=renderWorkflow;$("refreshAudit").onclick=refreshWorkflow;["auditStart","auditEnd","auditActor","auditProfessional","auditAction","auditSearch"].forEach(id=>{$(id).oninput=renderAgendaLogs;$(id).onchange=renderAgendaLogs});$("auditClearFilters").onclick=()=>{["auditStart","auditEnd","auditActor","auditProfessional","auditAction","auditSearch"].forEach(id=>{$(id).value=""});renderAgendaLogs()};$("markNotificationsRead").onclick=async()=>{await fetch("/api/workflow",{method:"DELETE"});await refreshWorkflow()};
 $("cancelledPageBtn").onclick=()=>showView("cancelled");
 $("systemDialogConfirm").onclick=()=>finishAppDialog(true);qsa("[data-dialog-cancel]").forEach(b=>b.onclick=()=>finishAppDialog(false));
 $("cancelReasonSelect").onchange=()=>$("cancelReasonOtherLabel").classList.toggle("hidden",$("cancelReasonSelect").value!=="Outro");
}
function workflowRoleLabel(role){return role==="general_manager"?"Gerência":role?roleLabel(role):""}
function workflowAuthorship(r,requesterRole="Médico"){const deciderRole=workflowRoleLabel(r.deciderRole);return `<div class="workflow-authorship"><div><strong>Solicitante:</strong> ${esc(doctorName(r.requesterName||"Médico"))} · ${requesterRole}</div><small>Enviada em: ${workflowDate(r.createdAt)}</small>${r.deciderName?`<div><strong>Decidido por:</strong> ${esc(r.deciderName)}${deciderRole?` · ${esc(deciderRole)}`:""}</div><small>Decidida em: ${workflowDate(r.decidedAt)}</small>`:""}</div>`}
function renderDoctorHistory(){
 const rows=workflowData.requests||[];
 return rows.length?rows.map(r=>`<article class="workflow-card doctor-history ${esc(r.status)}"><div class="workflow-card-main"><div class="workflow-heading"><strong>${esc(workflowRequestTitle(r))}</strong><span class="workflow-status ${esc(r.status)}">${r.status==="accepted"?"Aceita ✅":r.status==="denied"?"Recusada 🚫":"Aguardando aprovação"}</span></div><div class="workflow-changes">${workflowChangeRows(r)}</div>${r.decisionNote?`<p class="decision-reason"><strong>Motivo da recusa:</strong> ${esc(r.decisionNote)}</p>`:""}${workflowAuthorship(r)}</div></article>`).join(""):'<div class="empty">Nenhuma solicitação enviada.</div>';
}
function requestDenialReason(){
 return new Promise(resolve=>{
 const dialog=document.createElement("dialog");dialog.className="agenda-print-dialog";
 dialog.innerHTML='<form><h3>Motivo da recusa</h3><label>Motivo<textarea name="reason" rows="4" required></textarea></label><div class="print-dialog-actions"><button type="button" class="secondary-btn">Voltar</button><button type="submit" class="primary-btn">Confirmar recusa</button></div></form>';
 const finish=value=>{dialog.close();dialog.remove();resolve(value)};
 dialog.querySelector('button[type="button"]').onclick=()=>finish(null);
 dialog.oncancel=e=>{e.preventDefault();finish(null)};
 dialog.querySelector("form").onsubmit=e=>{e.preventDefault();const field=dialog.querySelector("textarea"),value=field.value.trim();if(!value){field.setCustomValidity("Informe o motivo");field.reportValidity();return}finish(value)};
 dialog.querySelector("textarea").oninput=e=>e.target.setCustomValidity("");document.body.appendChild(dialog);dialog.showModal();
 });
}
function workflowDate(value){return value?new Date(value).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"—"}
function suggestionReason(a){return a?.suggestionReason||a?.rescheduleReason||a?.cancelReason||""}
function workflowAppointment(a){if(!a)return null;const p=patient(a.patientId),h=hospital(a.hospitalId),place=hospitalAcronym(h),reason=suggestionReason(a),professional=state.professionals.find(x=>x.id===(a.doctorId||a.anesthetistId));return {a,p,professional:professional?.name||"",line:`${p?.name||"Paciente não disponível"} · ${a.date?parseDate(a.date.slice(0,10)).toLocaleDateString("pt-BR"):"—"} às ${a.time||"—"} · ${a.procedure||"Procedimento"}${place?` · ${place}`:""} · ${statusLabel(a.status||"scheduled")}${reason?` · Motivo: ${reason}`:""}`}}
function workflowRequestTitle(r){const target=workflowAppointment(r.proposed||r.previous),patientName=target?.p?.name||"Paciente não disponível";if(r.action==="create")return target?.professional?`Novo agendamento na agenda de ${target.professional}`:`Novo agendamento para ${patientName}`;if(r.action==="delete")return `Desagendamento de ${patientName}`;return `Alteração no agendamento de ${patientName}`}
function workflowChangeRows(r){const previous=workflowAppointment(r.previous),proposed=workflowAppointment(r.proposed),reason=suggestionReason(r.proposed);if(r.action==="create")return `${proposed?`<div class="workflow-change to"><span class="workflow-change-label">Adicionar:</span><span class="workflow-arrow" aria-hidden="true">≪</span><span>${esc(proposed.line)}</span></div>`:""}${reason?`<div class="workflow-cancel-reason"><strong>Motivo:</strong> ${esc(reason)}</div>`:""}`;if(r.action==="delete")return `${previous?`<div class="workflow-change from"><span class="workflow-change-label">REMOVIDO</span><span class="workflow-arrow" aria-hidden="true">≫</span><span>${esc(previous.line)}</span></div>`:""}${reason?`<div class="workflow-cancel-reason"><strong>Motivo:</strong> ${esc(reason)}</div>`:""}`;return `${previous?`<div class="workflow-change from"><span class="workflow-change-label">DE</span><span class="workflow-arrow" aria-hidden="true">≫</span><span>${esc(previous.line)}</span></div>`:""}${proposed?`<div class="workflow-change to"><span class="workflow-change-label">PARA</span><span class="workflow-arrow" aria-hidden="true">≪</span><span>${esc(proposed.line)}</span></div>`:""}${reason?`<div class="workflow-cancel-reason"><strong>Motivo:</strong> ${esc(reason)}</div>`:""}`}
function agendaLogPerson(id,fallback,missing){if(!id)return fallback||"";return state.professionals.find(x=>x.id===id)?.name||fallback||missing}
function agendaLogSnapshot(a){
 if(!a)return null;
 const p=patient(a.patientId),doctor=agendaLogPerson(a.doctorId,a.doctorName||a.doctor_name,"Profissional não disponível"),anesthetist=agendaLogPerson(a.anesthetistId,a.anesthetistName||a.anesthetist_name,"Profissional não disponível"),related=doctor||anesthetist,h=hospital(a.hospitalId),boolean=value=>value==null?"":value?"Sim":"Não",careType={outpatient:"Ambulatorial",inpatient:"Internado"}[a.careType]||a.careType||"",billingMethod={PARTICULAR:"Particular",CONVENIO:"Convênio"}[a.forma_cobranca]||a.forma_cobranca||"",guideExpiry=a.guideExpiry?parseDate(a.guideExpiry).toLocaleDateString("pt-BR"):"";
 return {patient:p?.name||a.patientName||a.patient_name||(a.patientId?"Paciente não disponível":""),agenda:related,date:a.date?parseDate(a.date).toLocaleDateString("pt-BR")+" às "+(a.time||""):"",procedure:a.procedure||"",place:h?.name?hospitalAcronym(h):(a.hospitalId?"Hospital não disponível":""),status:a.status?statusLabel(a.status):"",insurance:a.insurance||"",billingMethod,guideExpiry,careType,opme:boolean(a.opme),reports:boolean(a.reports),exams:boolean(a.exams),doctor,anesthetist,reason:suggestionReason(a)||"",duration:a.duration?String(a.duration)+" min":"",notes:a.notes||""};
}
const agendaLogFieldLabels={patient:"Paciente",agenda:"Agenda / profissional",date:"Data e horário",procedure:"Procedimento",place:"Hospital",status:"Status",insurance:"Convênio / plano",billingMethod:"Forma de cobrança",guideExpiry:"Validade da guia",careType:"Tipo de atendimento",opme:"OPME",reports:"Laudos",exams:"Exames",doctor:"Médico",anesthetist:"Anestesista",reason:"Motivo",duration:"Duração",notes:"Observação"};
function agendaLogContext(a,snapshot){return {patient:snapshot?.patient||patient(a.patientId)?.name||"Paciente não disponível",agenda:snapshot?.agenda||state.professionals.find(p=>p.id===a.professionalId)?.name||"Profissional não disponível"}}
function agendaLogHasValue(value){return value!=null&&String(value).trim()!==""}
function agendaLogSnapshotText(v){return Object.keys(agendaLogFieldLabels).filter(key=>agendaLogHasValue(v?.[key])).map(key=>`${agendaLogFieldLabels[key]}: ${v[key]}`).join(" · ")}
function agendaLogTitle(a,context){const suffix=context.patient!=="Paciente não disponível"?` de ${context.patient}`:"",requestAction=a.requestAction||a.metadata?.requestAction;if(a.action==="appointment_created")return `Novo agendamento${suffix}`;if(a.action==="appointment_removed"||a.action==="appointment_deleted"||a.action==="appointment_cancelled")return `Desagendamento${suffix}`;if(a.action==="request_created")return requestAction==="create"?(context.agenda!=="Profissional não disponível"?`Novo agendamento na agenda de ${context.agenda}`:`Novo agendamento${suffix}`):requestAction==="delete"?`Desagendamento${suffix}`:`Alteração no agendamento${suffix}`;if(a.action==="request_accepted")return `Solicitação aprovada${suffix}`;if(a.action==="request_denied")return `Solicitação recusada${suffix}`;return `Alteração no agendamento${suffix}`;}
function agendaLogBadge(a){const action=a.action||"";if(action==="appointment_created")return {label:"CRIAÇÃO",kind:"created"};if(["appointment_removed","appointment_deleted","appointment_cancelled"].includes(action))return {label:"REMOÇÃO",kind:"removed"};if(action.startsWith("request_"))return {label:"SOLICITAÇÃO",kind:"request"};return {label:"ALTERAÇÃO",kind:"changed"};}
function agendaLogValues(snapshot){return Object.keys(agendaLogFieldLabels).filter(key=>agendaLogHasValue(snapshot?.[key])).map(key=>agendaLogFieldLabels[key]+": "+snapshot[key])}
function agendaLogContent(a){
 const before=agendaLogSnapshot(a.before),after=agendaLogSnapshot(a.after),context=agendaLogContext(a,after||before),title=agendaLogTitle(a,context),snapshotText=v=>agendaLogSnapshotText(v);
 const lines=[];
 if(!before&&after){const values=agendaLogValues(after);if(values.length)lines.push({label:"Adicionou",values,kind:"after"});}
 else if(before&&!after){const values=agendaLogValues(before);if(values.length)lines.push({label:"REMOVIDO",values,kind:"before"});}
 else if(before&&after){const from=[],to=[];for(const key of Object.keys(agendaLogFieldLabels))if(before[key]!==after[key]){if(agendaLogHasValue(before[key]))from.push(agendaLogFieldLabels[key]+": "+before[key]);if(agendaLogHasValue(after[key]))to.push(agendaLogFieldLabels[key]+": "+after[key]);}if(from.length)lines.push({label:"DE",values:from,kind:"before"});if(to.length)lines.push({label:"PARA",values:to,kind:"after"});}
 const metadata=`Paciente: ${context.patient} · Agenda: ${context.agenda}`,meaningful=a.action!=="appointment_updated"||lines.length>0;
 return {title,lines,metadata,meaningful,search:[title,metadata,a.actorName,a.actorRole==="general_manager"?"Gerência":roleLabel(a.actorRole),snapshotText(before),snapshotText(after)].filter(Boolean).join(" ")};
}
function agendaLogNormalize(text){return String(text||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim()}
function agendaLogLocalDay(value){if(!value)return "";const date=new Date(value);if(Number.isNaN(date.getTime()))return String(value).slice(0,10);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-")}
function agendaLogMatchesFilters(row,filters={}){
 const a=row.a||row,content=row.title?row:agendaLogContent(a),context=content.context||agendaLogContext(a,agendaLogSnapshot(a.after)||agendaLogSnapshot(a.before)),badge=agendaLogBadge(a),actor=String(a.actorName||a.actorId||a.actor_id||""),professional=String(context.agenda||a.professionalId||a.professional_id||""),day=agendaLogLocalDay(a.createdAt);
 const includes=(value,query)=>!query||agendaLogNormalize(value).includes(agendaLogNormalize(query));
 return (!filters.start||day>=filters.start)&&(!filters.end||day<=filters.end)&&includes(actor,filters.actor)&&includes(professional,filters.professional)&&(!filters.action||badge.kind===filters.action)&&includes(content.search,filters.search);
}
function agendaLogFilterOptions(rows){
 const setOptions=(id,values,all)=>{const field=$(id);if(!field)return;const selected=field.value,unique=[...new Map(values.filter(v=>v.value).map(v=>[agendaLogNormalize(v.value),v])).values()].sort((a,b)=>a.label.localeCompare(b.label,"pt-BR"));field.innerHTML=`<option value="">${all}</option>${unique.map(v=>`<option value="${esc(v.value)}">${esc(v.label)}</option>`).join("")}`;field.value=unique.some(v=>v.value===selected)?selected:"";};
 setOptions("auditActor",rows.map(({a})=>({value:String(a.actorName||a.actorId||a.actor_id||""),label:String(a.actorName||"Usuário")})),"Todos");
 setOptions("auditProfessional",rows.map(row=>({value:String(row.context?.agenda||row.a.professionalId||row.a.professional_id||""),label:String(row.context?.agenda||"Agenda / médico")})),"Todas");
}
function renderAgendaLogs(){
 if(!$("auditList"))return;
 const filters={start:$("auditStart")?.value||"",end:$("auditEnd")?.value||"",actor:$("auditActor")?.value||"",professional:$("auditProfessional")?.value||"",action:$("auditAction")?.value||"",search:$("auditSearch")?.value||""};
 const rows=(workflowData.audit||[]).map(a=>{const content=agendaLogContent(a);return {a,...content,context:agendaLogContext(a,agendaLogSnapshot(a.after)||agendaLogSnapshot(a.before))}}).filter(row=>row.meaningful);
 agendaLogFilterOptions(rows);
 const filtered=rows.filter(row=>agendaLogMatchesFilters(row,filters));
 $("auditList").innerHTML=filtered.length?filtered.map(({a,title,lines,metadata})=>{const badge=agendaLogBadge(a),role=a.actorRole==="general_manager"?"Gerência":roleLabel(a.actorRole);return `<article class="agenda-log-event workflow-card"><div class="workflow-card-main"><div class="workflow-heading"><span class="workflow-status log-${badge.kind}">${badge.label}</span><strong>${esc(title)}</strong></div>${lines.length?`<div class="workflow-changes">${lines.map(group=>`<div class="workflow-change-group ${group.kind==="before"?"from":"to"}">${group.values.map((value,index)=>`<div class="workflow-change ${group.kind==="before"?"from":"to"}"><b class="workflow-change-label"${index?' aria-hidden="true"':""}>${index?"":group.label}</b><span class="workflow-arrow" aria-hidden="true">${group.kind==="before"?"≫":"≪"}</span><span>${esc(value)}</span></div>`).join("")}</div>`).join("")}</div>`:""}${metadata?`<p class="workflow-log-context"><strong>Contexto:</strong> ${esc(metadata)}</p>`:""}<div class="workflow-log-authorship"><div><strong>Responsável:</strong> ${esc(a.actorName||"Usuário")} · ${esc(role)}</div><small>Em: ${esc(workflowDate(a.createdAt))}</small></div></div></article>`}).join(""):'<p class="empty">Nenhum evento nos registros consultados.</p>';
}
async function refreshWorkflow(){const response=await fetch("/api/workflow");if(!response.ok)return false;workflowData=await response.json();renderWorkflow();return true}
function renderWorkflow(){
 const pending=(workflowData.requests||[]).filter(r=>r.status==="pending");if($("requestBadge")){ $("requestBadge").textContent=pending.length;$("requestBadge").classList.toggle("hidden",!pending.length) }
 const unread=(workflowData.notifications||[]).filter(n=>!n.readAt);if($("notificationBadge")){ $("notificationBadge").textContent=unread.length;$("notificationBadge").classList.toggle("hidden",!unread.length) }
 if($("requestList")){const rows=$("requestStatusFilter").value==="all"?(workflowData.requests||[]):pending;$("requestList").innerHTML=rows.length?rows.map(r=>{const busy=workflowBusy.has(r.id);return `<article class="workflow-card"><div class="workflow-card-main"><div class="workflow-heading"><span class="workflow-status ${esc(r.status)}">${r.status==="pending"?"Pendente":r.status==="accepted"?"Aceita":"Negada"}</span><strong>${esc(workflowRequestTitle(r))}</strong></div><div class="workflow-changes">${workflowChangeRows(r)}</div>${workflowAuthorship(r)}</div>${r.status==="pending"?`<div class="workflow-actions"><button class="secondary-btn" data-deny-request="${esc(r.id)}" ${busy?"disabled":""}>${busy?"Processando…":"Negar"}</button><button class="primary-btn" data-accept-request="${esc(r.id)}" ${busy?"disabled":""}>${busy?"Processando…":"Aceitar"}</button></div>`:""}</article>`}).join(""):'<div class="empty">Nenhuma solicitação nesta lista.</div>';qsa("[data-accept-request]").forEach(b=>b.onclick=()=>decideRequest(b.dataset.acceptRequest,"accepted"));qsa("[data-deny-request]").forEach(b=>b.onclick=()=>decideRequest(b.dataset.denyRequest,"denied"))}
 if($("notificationList"))$("notificationList").innerHTML=renderDoctorHistory();
 renderAgendaLogs();
}
const workflowBusy=new Set();
async function decideRequest(id,decision){if(workflowBusy.has(id))return;let note="";if(decision==="accepted"){const ok=await appConfirm("Aceitar solicitação","Tem certeza que deseja aceitar esta alteração? Ela será aplicada na agenda e ficará registrada no histórico.","Aceitar");if(!ok)return}else{const ok=await appConfirm("Negar solicitação","A solicitação será mantida no histórico e o médico receberá uma notificação.","Negar",true);if(!ok)return;note=await requestDenialReason();if(!note)return}workflowBusy.add(id);renderWorkflow();try{const response=await fetch("/api/workflow",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,decision,note})});const result=await response.json().catch(()=>({}));if(!response.ok)return appNotice("Não foi possível concluir",result.error||"Tente novamente.");toast(result.message);const [stateResponse]=await Promise.all([fetch("/api/state"),refreshWorkflow()]);if(stateResponse.ok){const resultState=await stateResponse.json();if(resultState.state){window.AgendaRevision=resultState.revision;state=Storage.migrate(resultState.state);renderAll()}}}finally{workflowBusy.delete(id);renderWorkflow()}}
async function sendAgendaSuggestion(action,appointment,appointmentId,button=null){if(button?.dataset.sending)return false;const auth=window.AgendaAuth||{},reason=appointment.suggestionReason||appointment.rescheduleReason||appointment.cancelReason||"";const needsReason=action!=="create";if(needsReason&&!reason){const typed=prompt("Informe o motivo da sugestão para a secretaria/gerente geral:");if(!typed?.trim())return appNotice("Motivo necessário","Explique o motivo da alteração para enviar a sugestão."),false;appointment={...appointment,suggestionReason:typed.trim()}}appointment={...appointment,suggestedByName:accountName(auth),suggestedByEmail:auth.email};const oldText=button?.textContent;if(button){button.dataset.sending="true";button.disabled=true;button.textContent="Enviando…";button.setAttribute("aria-busy","true")}try{const response=await fetch("/api/workflow",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,appointment,appointmentId})});const result=await response.json().catch(()=>({}));if(!response.ok){await appNotice("Não foi possível enviar",result.error||"Tente novamente.");return false}toast("Sugestão enviada, aguarde aprovação.");await refreshWorkflow();return true}finally{if(button?.isConnected){delete button.dataset.sending;button.disabled=false;button.textContent=oldText;button.removeAttribute("aria-busy")}}}
function applyRoleRestrictions(){const auth=window.AgendaAuth||{},manager=auth.role==="general_manager",doctor=auth.role==="doctor";qsa(".manager-only").forEach(el=>el.classList.toggle("hidden",!manager));qsa(".doctor-only").forEach(el=>el.classList.toggle("hidden",!doctor));qsa(".workflow-reviewer").forEach(el=>el.classList.toggle("hidden",doctor));$("newBlockBtn").classList.toggle("hidden",!manager&&!doctor);$("newAppointmentBtn").textContent=doctor?"Enviar Agendamento":"+ Novo agendamento";$("newPatientBtn").classList.toggle("hidden",doctor);$("editPatientFromDetail").classList.toggle("hidden",doctor);if(manager)renderAccess();refreshWorkflow()}
function cancelledBillingLabel(a){
 return ({PARTICULAR:"Particular",CONVENIO:"Convênio"})[a.forma_cobranca]||"Não informado";
}
function cancelledDetails(a){
 const snapshot=agendaLogSnapshot(a);
 const fields=[
  ["Procedimento",snapshot.procedure],
  ["Hospital",hospital(a.hospitalId)?.name||snapshot.place],
  ["Convênio / plano",a.insurance||"Não informado"],
  ["Médico",snapshot.doctor],
  ["Anestesista",snapshot.anesthetist],
  ["Status antes do cancelamento",snapshot.status],
  ["Duração",snapshot.duration],
  ["Validade da guia",snapshot.guideExpiry],
  ["Tipo de atendimento",snapshot.careType],
  ["OPME",snapshot.opme],
  ["Laudos",snapshot.reports],
  ["Exames",snapshot.exams],
  ["Observações",snapshot.notes],
  ["Proposto por",a.suggestedByName||""],
  ["Motivo da sugestão",a.suggestionReason&&a.suggestionReason!==a.cancelReason?a.suggestionReason:""],
  ["Última mudança de status",a.statusUpdatedAt?workflowDate(a.statusUpdatedAt):""]
 ];
 const details=fields.filter(([,value])=>value!=null&&String(value).trim()!=="").map(([label,value])=>`<div class="cancel-detail-field"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("");
 return `<dl class="cancel-detail-grid">${details}</dl>${renderRescheduleHistory(a)}`;
}
function renderCancelled(){
 if(!$("cancelledList"))return;
 const owner=selectedProf(),isDoctor=(window.AgendaAuth||{}).role==="doctor";
 const rows=(state.cancelledAppointments||[])
  .filter(a=>(isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner?.id))
  .sort((a,b)=>b.date.localeCompare(a.date));
 const groups={};
 rows.forEach(a=>{const key=a.date.slice(0,7);(groups[key]||=[]).push(a)});
 const financialHeaders=isDoctor?"":"<th>Valor</th><th>NF</th>";
 $("cancelledList").innerHTML=Object.entries(groups).map(([month,items])=>`
  <section class="cancel-month">
   <h3>${parseDate(month+"-01").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</h3>
   <table class="table cancel-table">
    <thead><tr><th>Paciente</th><th>Data</th><th>Horário</th><th>Forma de cobrança</th><th>Cancelado em</th><th>Motivo</th>${financialHeaders}<th>Informações</th></tr></thead>
    <tbody>${items.map(a=>`
     <tr>
      <td data-label="Paciente">${esc(patient(a.patientId)?.name||"Paciente não disponível")}</td>
      <td data-label="Data">${parseDate(a.date).toLocaleDateString("pt-BR")}</td>
      <td data-label="Horário">${esc(a.time||"—")}</td>
      <td data-label="Forma de cobrança"><span class="cancel-billing-pill ${a.forma_cobranca==="CONVENIO"?"insurance":a.forma_cobranca==="PARTICULAR"?"private":"unknown"}">${esc(cancelledBillingLabel(a))}</span></td>
      <td data-label="Cancelado em">${a.cancelledAt?workflowDate(a.cancelledAt):"—"}</td>
      <td data-label="Motivo">${esc(a.cancelReason||"Não informado")}</td>
      ${isDoctor?"":`<td data-label="Valor">${a.payment==null?"—":money(a.payment)}</td><td data-label="NF">${esc(a.invoiceNumber||"—")}</td>`}
      <td data-label="Informações" class="cancel-detail-cell">
       <details class="cancel-details"><summary>Ver detalhes</summary><div class="cancel-details-panel">${cancelledDetails(a)}</div></details>
      </td>
     </tr>`).join("")}</tbody>
   </table>
  </section>`).join("")||'<div class="empty">Nenhum cancelamento nesta agenda.</div>';
}
function money(v){return window.RNMoney.formatBRL(v==null?null:Number(v))}

function renderAll(){renderProfessionalOptions();renderAppointmentOptions();renderCalendar();renderPatients();renderCancelled();renderSettings();renderRules();if((window.AgendaAuth||{}).role==="general_manager")renderAccess()}
let lastFocusedElement=null;
function openModal(id){lastFocusedElement=document.activeElement;remoteAgendaNotice(false);const modal=$(id);$("modalBackdrop").classList.remove("hidden");modal.classList.remove("hidden");modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");requestAnimationFrame(()=>{if(id==="appointmentModal"&&modal.classList.contains("appointment-view-mode")){const title=$("appointmentModalTitle");title.tabIndex=-1;title.focus({preventScroll:true})}else modal.querySelector("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not([data-close])")?.focus()})}
function closeModals(){$("modalBackdrop").classList.add("hidden");qsa(".modal").forEach(m=>m.classList.add("hidden"));if(systemDialogResolve){const done=systemDialogResolve;systemDialogResolve=null;done(false)}if(lastFocusedElement?.isConnected)lastFocusedElement.focus();lastFocusedElement=null;window.AgendaSyncAfterModalClose?.()}
function renderHistory(pid,target,limit=999){
 const list=state.patientHistory.filter(h=>h.patientId===pid).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit);
 $(target).innerHTML=list.length?list.map(h=>`<div class="history-item"><strong>${esc(h.type)}</strong><span>${esc(h.text)}</span><span>${new Date(h.at).toLocaleString("pt-BR")}</span></div>`).join(""):'<div class="history-empty">Nenhum histórico registrado ainda.</div>'
}
function updatePatientSide(){
 const p=patient($("appointmentPatient").value),optional=isAnesthesiologist(selectedProf());$("patientSideName").textContent=p?.name||(optional?"Paciente não informado":"Selecione um paciente");$("patientSidePhone").textContent=p?.phone||"—";$("patientSideEmail").textContent=p?.email||"—";$("patientSideInsurance").textContent=p?.insurance||"—";$("patientSideCard").textContent=p?.cardNumber||"—";$("patientAvatar").textContent=p?.name?.charAt(0).toUpperCase()||"—";renderHistory(p?.id,"patientHistory",12)
}
function setFlag(id,val){$(id).checked=!!val;document.querySelector(`[data-state-for="${id}"]`).textContent=val?"Sim":"Não"}
const APPOINTMENT_STATUSES=["scheduled","confirmed","authorized","analysis","realized"];
function appointmentStatusLabel(status){return statusLabel(status)}
function appointmentStatusOptions(current){return APPOINTMENT_STATUSES.filter(status=>(window.AgendaAuth||{}).role!=="secretary"||status!=="realized").map(status=>`<option value="${status}" ${status===current?"selected":""}>${statusLabel(status)}</option>`).join("")}
function detailHospitalOptions(current){return state.hospitals.map(h=>`<option value="${esc(h.id)}" ${h.id===current?"selected":""}>${esc(h.name)}</option>`).join("")}
function detailDurationOptions(current){return [30,45,60,90,120].map(v=>`<option value="${v}" ${Number(current)===v?"selected":""}>${v} min</option>`).join("")}
function detailRelatedOptions(a,owner){
 const category=isAnesthesiologist(owner)?"doctor":"anesthetist",empty=category==="anesthetist"?'<option value="">Sem anestesista</option>':"";
 const current=category==="doctor"?a.doctorId:a.anesthetistId;
 return empty+state.professionals.filter(p=>(p.active!==false||p.id===current)&&(category==="anesthetist"?isAnesthesiologist(p):!isAnesthesiologist(p))).map(p=>`<option value="${esc(p.id)}" ${p.id===current?"selected":""}>${esc(p.name)}${p.crm?` - CRM ${esc(p.crm)}`:""}</option>`).join("")
}
function requestPasswordStatusChange(id,status="realized"){
 const a=state.appointments.find(item=>item.id===id),role=(window.AgendaAuth||{}).role;
 if(!a||!["doctor","general_manager"].includes(role))return appNotice("Acesso restrito","Somente médico ou Gerente Geral confirma o status.");
 if(role==="doctor"&&status!=="realized")return appNotice("Acesso restrito","O médico só pode marcar como Atendido.");
 if(a.status===status)return appNotice("Status já registrado","Este agendamento já está com esse status.");
 const targetLabel=statusLabel(status),dialog=document.createElement("dialog");
 dialog.className="attendance-password-dialog";
 dialog.setAttribute("aria-labelledby","attendancePasswordTitle");
 dialog.innerHTML=`<form class="attendance-password-form">
  <div class="attendance-password-heading"><span class="attendance-password-icon" aria-hidden="true">✓</span>
   <div><h3 id="attendancePasswordTitle">Confirmar ${esc(targetLabel)}</h3>
    <p>Esta alteração será registrada no histórico e não precisa de aprovação da secretaria.</p></div>
  </div>
  <div class="attendance-password-context"><strong>${esc(patient(a.patientId)?.name||"Agendamento")}</strong><span>${parseDate(a.date).toLocaleDateString("pt-BR")} · ${esc(a.time)}</span></div>
  <label for="attendancePasswordInput">Senha da sua conta (médico ou Gerente Geral)</label>
  <input id="attendancePasswordInput" type="password" name="confirmPassword" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="Digite sua senha">
  <p class="attendance-password-error" role="alert" hidden></p>
  <div class="attendance-password-buttons"><button type="button" class="secondary-btn" data-cancel-password>Voltar</button><button type="submit" class="primary-btn">Confirmar ${esc(targetLabel)}</button></div>
 </form>`;
 document.body.appendChild(dialog);
 dialog.addEventListener("close",()=>dialog.remove(),{once:true});
 dialog.querySelector("[data-cancel-password]").onclick=()=>dialog.close();
 const form=dialog.querySelector("form"),password=dialog.querySelector("#attendancePasswordInput"),errorBox=dialog.querySelector(".attendance-password-error"),submit=dialog.querySelector('button[type="submit"]');
 form.onsubmit=async event=>{
  event.preventDefault();if(submit.disabled)return;
  const secret=password.value;password.value="";
  submit.disabled=true;submit.textContent="Confirmando…";errorBox.hidden=true;
  let committed=false;
  try{
   const response=await fetch("/api/attendance/status",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({appointmentId:id,status,password:secret})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"Não foi possível alterar o status.");
   committed=true;
   const read=await fetch("/api/state",{cache:"no-store"});
   if(!read.ok)throw Error("O status foi salvo, mas a atualização da agenda falhou.");
   const snapshot=await read.json();window.AgendaRevision=snapshot.revision;state=Storage.migrate(snapshot.state);
   dialog.close();renderAll();
   const updated=state.appointments.find(item=>item.id===id);
   if(updated&&$("appointmentModal")&&!$("appointmentModal").classList.contains("hidden"))renderAppointmentDetail(updated);
   reconcileRemoteAgendaUpdate();
   toast(`Status alterado para ${targetLabel}.`);
  }catch(error){
   if(committed){
    dialog.close();closeModals();
    await appNotice("Status salvo","A alteração foi registrada. Atualize a agenda para carregar as informações mais recentes.");
    window.location.reload();return;
   }
   if(dialog.isConnected){errorBox.textContent=error.message||"Não foi possível confirmar.";errorBox.hidden=false;password.focus();}
  }finally{
   if(dialog.isConnected){submit.disabled=false;submit.textContent=`Confirmar ${targetLabel}`;}
  }
 };
 dialog.showModal();password.focus();
}

async function applyAppointmentStatus(id,status,reason=""){
 const a=state.appointments.find(x=>x.id===id);if(!a||a.status===status)return;
 const previous=a.status,updated={...a,status,rescheduleReason:status==="rescheduled"?reason:(a.rescheduleReason||""),statusUpdatedAt:new Date().toISOString()};
 if(previous==="realized"||status==="realized")return requestPasswordStatusChange(id,status);
 if((window.AgendaAuth||{}).role==="doctor"){if($("appointmentStatusSelect"))$("appointmentStatusSelect").value=previous;return appNotice("Acesso restrito","Status, valor e nota fiscal são alterados pela secretaria ou gerência.")}
 Object.assign(a,updated);hist(a.patientId,"Status alterado",`${statusLabel(previous)} → ${statusLabel(status)}${reason?` · Motivo: ${reason}`:""}`,id);if(await persist()===false)return;renderAppointmentDetail(a);toast(`Status alterado para ${statusLabel(status)}.`)
}
function rescheduleLine(label,date,time,type){return `<div class="reschedule-line ${type}"><span>${label}</span><b aria-hidden="true">${type==="from"?"≫":"≪"}</b><strong>${date?parseDate(date).toLocaleDateString("pt-BR"):"—"} às ${esc(time||"—")}</strong></div>`}
function renderReschedulePreview(){const a=state.appointments.find(x=>x.id===$("rescheduleAppointmentId").value);if(!a)return;$("reschedulePreview").innerHTML=rescheduleLine("De",a.date,a.time,"from")+rescheduleLine("Para",$("rescheduleNewDate").value,$("rescheduleNewTime").value,"to")}
function openReschedule(id){const a=state.appointments.find(x=>x.id===id);if(!a)return;$("rescheduleReasonForm").reset();$("rescheduleAppointmentId").value=id;$("rescheduleNewDate").value=a.date;$("rescheduleNewDate").min=ds(new Date());$("rescheduleNewTime").value=a.time;renderReschedulePreview();openModal("rescheduleReasonModal")}
function renderRescheduleHistory(a){const rows=[...(a.rescheduleHistory||[])].reverse();if(!rows.length&&!a.rescheduleReason&&!a.suggestedByName)return "";return `<section class="appointment-reschedule-history"><div class="reschedule-history-title"><span>Histórico deste agendamento</span><strong>${rows.length?`${rows.length} reagendamento${rows.length===1?"":"s"}`:"Registro"}</strong></div>${rows.length?rows.map(item=>`<article>${rescheduleLine("De",item.fromDate,item.fromTime,"from")}${rescheduleLine("Para",item.toDate,item.toTime,"to")}<p><b>Motivo:</b> ${esc(item.reason||"Não informado")}</p>${item.proposedBy?`<p><b>Proposto por:</b> ${esc(item.proposedBy)}</p>`:""}<small>${item.createdAt?new Date(item.createdAt).toLocaleString("pt-BR"):""}</small></article>`).join(""):`<article><p><b>Motivo:</b> ${esc(a.rescheduleReason||a.suggestionReason||"Alteração aprovada")}</p>${a.suggestedByName?`<p><b>Proposto por:</b> ${esc(a.suggestedByName)}</p>`:""}<small>${a.statusUpdatedAt?new Date(a.statusUpdatedAt).toLocaleString("pt-BR"):"Registro do agendamento"}</small></article>`}</section>`}
// Native appointment fields share the financial API and canonical billing record.
let nativeFinance=null;
function nativeFinanceRoot(){return $("appointmentModal").classList.contains("appointment-view-mode")?$("nativeFinance"):$("newAppointmentFinance")}
function nativeMethod(){return $("appointmentModal").classList.contains("appointment-view-mode")?$("detailBillingMethod")?.value:$("appointmentBillingMethod").value}
function captureNativeFinance(){if(!nativeFinance)return;for(const [id,key] of [["nativeEntity","billing_entity_id"],["nativeAmount","received_amount"],["nativeStatus","payment_status"],["nativePaidAt","paid_at"]]){const el=$(id);if(el)nativeFinance.draft[key]=el.value}}
function nativeFinanceError(message){const root=nativeFinanceRoot();if(!root)return;root.querySelector('[role="alert"]')?.remove();root.insertAdjacentHTML('beforeend',`<p class="native-finance-error" role="alert">${esc(message)}</p>`);root.querySelector('[role="alert"]').scrollIntoView({block:'nearest'})}

function financeProofsMarkup(current,history,editable){
 const link=a=>`<a href="/api/financial-attachments?id=${encodeURIComponent(a.id)}" target="_blank" rel="noopener noreferrer">Visualizar</a>`;
 const proof=(a,historical=false)=>`<li class="native-proof-row">
  <span class="native-proof-icon" aria-hidden="true">▤</span>
  <span class="native-proof-filename" title="${esc(a.original_filename)}">${esc(a.original_filename)}</span>
  ${historical?`<small>${a.deactivation_reason==='REMOVED_BY_USER'?'Excluído':a.deactivation_reason==='PAYMENT_REVERSED'?'Pagamento revertido':'Substituído'}</small>`:''}
  <span class="native-proof-actions">${link(a)}
  ${editable&&!historical?`${editable==='full'?'<button type="button" class="nativeProofReplace" data-attachment="'+esc(a.id)+'">Substituir</button>':''}
   <button type="button" class="nativeProofDelete" data-attachment="${esc(a.id)}" aria-label="Excluir comprovante ${esc(a.original_filename)}">Excluir</button>`:''}
  </span></li>`;
 return `<div class="native-proofs-title"><strong>Comprovantes de pagamento</strong><span>${current.length} anexo${current.length===1?'':'s'}</span></div>
  ${current.length?`<ul class="native-proof-list">${current.map(a=>proof(a)).join('')}</ul>`:'<p class="native-proof-empty">Nenhum comprovante anexado.</p>'}
  ${history.length?`<details class="native-proof-history"><summary>Histórico (${history.length})</summary><ul class="native-proof-list">${history.map(a=>proof(a,true)).join('')}</ul></details>`:''}`;
}
async function deleteNativeProof(f,id){
 const proof=(f.data?.attachments||[]).find(a=>a.id===id&&a.status==='READY'&&a.is_current);
 if(!proof)return nativeFinanceError('Comprovante não disponível.');
 if(!window.confirm('Excluir este comprovante? O pagamento será mantido e a exclusão ficará registrada no histórico.'))return;
 const buttons=nativeFinanceRoot()?.querySelectorAll('.nativeProofDelete,.nativeProofReplace');
 buttons?.forEach(b=>b.disabled=true);
 try{
  await window.RNFinance.removePaymentProof(id);
  await loadNativeFinance(f.id,f.draft);
  toast('Comprovante excluído.');
 }catch(error){
  buttons?.forEach(b=>b.disabled=false);
  nativeFinanceError(error.message||'Não foi possível excluir o comprovante.');
 }
}
function bindNativeProofDeletion(root,f){
 root.querySelectorAll('.nativeProofDelete').forEach(button=>button.onclick=()=>deleteNativeProof(f,button.dataset.attachment||''));
}
function nativeFinanceHeading(f){
 const record=f.row?.record,requests=f.data?.requests||[];
 const pendingRequest=requests.find(r=>r.billing_record_id===record?.id&&r.status==='PENDING'&&!r.invoice_id);
 const nf=record?.no_invoice?'S/N':requests.some(r=>r.attendance_id===f.id&&r.status==='PENDING')?'NF solicitada':
  requests.some(r=>r.attendance_id===f.id&&r.status==='CANCELLED')?'NF cancelada':'Sem solicitação';
 const status=record?.payment_status==='PAGO'&&f.row?.status_atendimento!=='realized'?
  '<span class="native-finance-tag warning" title="Pagamento recebido, mas atendimento ainda não realizado.">Atendimento não realizado</span>':'';
 return `<div class="native-finance-head"><h4>Financeiro do atendimento</h4><div class="native-finance-tags">
   ${nativeMethod()==='PARTICULAR'?'<span class="native-finance-tag">'+esc(nf)+'</span>':''}
   ${pendingRequest?'<button type="button" id="nativeEditInvoiceRequest" class="secondary-btn native-edit-invoice-request">Editar solicitação</button>':''}
   ${status}</div></div>`;
}
function paintNativeFinance(){
 const root=nativeFinanceRoot(),f=nativeFinance;if(!root||!f)return;captureNativeFinance();
 if(f.loading){root.innerHTML='<p>Carregando financeiro…</p>';return}
 if(f.error){root.innerHTML=`<p role="alert">${esc(f.error)}</p><button type="button" id="retryNativeFinance" class="secondary-btn">Tentar novamente</button>`;$("retryNativeFinance").onclick=()=>loadNativeFinance(f.id,f.draft);return}

 if(f.row?.invoice){
  const parts=(f.data?.payment_parts||[]).filter(p=>p.billing_record_id===f.row.record?.id);
  const proofs=(f.data?.attachments||[]).filter(a=>a.billing_record_id===f.row.record?.id&&a.status==='READY');
  const currentProofs=proofs.filter(a=>a.is_current),historicalProofs=proofs.filter(a=>!a.is_current);
  const invoice=f.row.invoice;
  root.innerHTML=`<div class="native-finance-head"><h4>Financeiro do atendimento</h4>
    <div class="native-finance-tags"><span class="native-finance-tag">NF ${esc(invoice.invoice_number)}</span>
    <span class="native-finance-tag">${invoice.paid_at?'Pago':'Aguardando pagamento'}</span></div></div>
    <div class="native-finance-view-summary">
     <div><small>Valor recebido</small><strong>${esc(money(window.RNFinance.individualReceived(f.row)))}</strong></div>
     <div><small>Data do pagamento</small><strong>${esc(invoice.paid_at?
      parseDate(invoice.paid_at.slice(0,10)).toLocaleDateString("pt-BR"):'—')}</strong></div>
    </div>`+
   (invoice.recipient_type==='PARTICULAR'?`<details class="native-proof-history">
    <summary>Formas de pagamento</summary>
    ${parts.length?`<ul>${parts.map(p=>`<li>${esc(window.RNFinance.paymentMethods[p.method]||'Outra forma')}
     · ${esc(money(p.amount))}${p.method==='CREDIT_CARD'&&p.installments?` · ${esc(p.installments)} parcelas`:''}
    </li>`).join('')}</ul>`:'Composição não informada.'}</details>
    <section class="native-payment-proofs" aria-label="Comprovantes de pagamento">
     ${financeProofsMarkup(currentProofs,historicalProofs,'delete')}
    </section>`:'');
  bindNativeProofDeletion(root,f);
  return;
 }
 const direct=f.row?window.RNFinance.directPayment(f.row,f.data,nativeMethod()):nativeMethod()==='PARTICULAR';
 if(!direct){root.innerHTML='<h4>Financeiro do atendimento</h4><p>'+ (nativeMethod()==='CONVENIO'?'Pagamento gerenciado pelo faturamento do convênio.':'Selecione a forma de cobrança para preencher o financeiro.')+'</p>';return}
 const options=f.row?window.RNFinance.allowedEntities(f.row,f.data):[];
 if(!f.draft.billing_entity_id&&options.length===1)f.draft.billing_entity_id=options[0].id;

 const proofs=(f.data?.attachments||[]).filter(a=>a.billing_record_id===f.row?.record?.id&&a.status==='READY');
 const currentProofs=proofs.filter(a=>a.is_current);
 const historicalProofs=proofs.filter(a=>!a.is_current);
 const showProofs=f.draft.payment_status==='PAGO';
 root.innerHTML=nativeFinanceHeading(f)+
  `<div class="native-finance-grid">
   ${f.row?`<label>Entidade recebedora<select id="nativeEntity"><option value="">Selecione</option>
    ${options.map(e=>`<option value="${esc(e.id)}">${esc(e.trade_name||e.name)}</option>`).join('')}
   </select></label>`:''}
   <label>Valor recebido<input id="nativeAmount" type="text" inputmode="decimal" placeholder="R$ 0,00"></label>
   <label>Status do pagamento<select id="nativeStatus"><option value="PENDENTE">Pendente</option>
    <option value="PAGO">Recebido</option></select></label>
   <label>Data de pagamento<input id="nativePaidAt" type="date"></label>
  </div>`+
  (showProofs?`<section class="native-payment-proofs" aria-label="Comprovantes de pagamento">
    ${financeProofsMarkup(currentProofs,historicalProofs,'full')}
    <div class="native-proof-upload">
     <input id="nativePaymentProof" type="file" hidden
      accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" aria-label="Selecionar comprovante">
     <button type="button" id="addNativePaymentProof" class="secondary-btn">+ Adicionar comprovante</button>
     <small>PDF, JPG ou PNG · até 10 MB</small>
    </div>
    ${f.proofFile?`<div class="native-proof-pending">✓ ${esc(f.proofFile.name)}
     <button type="button" id="clearNativePaymentProof">Remover seleção</button></div>`:''}
    ${f.proofTargetId&&f.proofFile?`<p class="native-finance-error" role="alert">Comprovante não enviado.
     <button type="button" id="retryNativePaymentProof" class="secondary-btn">Tentar novamente</button></p>`:''}
   </section>`:'');
 bindNativeProofDeletion(root,f);
 const pendingRequest=(f.data?.requests||[]).find(r=>r.billing_record_id===f.row?.record?.id&&r.status==='PENDING'&&!r.invoice_id);
 if($('nativeEditInvoiceRequest')&&pendingRequest)$('nativeEditInvoiceRequest').onclick=async()=>{
  const button=$('nativeEditInvoiceRequest');button.disabled=true;
  try{
   const changed=await window.RNFinance.editPendingInvoiceRequest(pendingRequest);
   if(changed){await loadNativeFinance(f.id);toast('Solicitação de NF atualizada.');}
   else if(button.isConnected)button.disabled=false;
  }catch(error){if(button.isConnected)button.disabled=false;nativeFinanceError(error.message||'Não foi possível editar a solicitação.');}
 };
 if($("nativeEntity"))$("nativeEntity").value=f.draft.billing_entity_id||'';
 $("nativeAmount").value=f.draft.received_amount??'';$("nativeStatus").value=f.draft.payment_status||'PENDENTE';$("nativePaidAt").value=f.draft.paid_at||'';
 $("nativeAmount").oninput=e=>{e.target.setCustomValidity('');captureNativeFinance()};
 $("nativeAmount").onblur=e=>{try{const amount=window.RNMoney.parseBRL(e.target.value);e.target.value=amount==null?'':money(amount);e.target.setCustomValidity('');captureNativeFinance()}catch(error){e.target.setCustomValidity(error.message);nativeFinanceError(error.message)}};
 for(const id of ['nativeEntity','nativeStatus','nativePaidAt'])if($(id))$(id).onchange=()=>{captureNativeFinance();if(id==='nativeStatus')paintNativeFinance()};
 if($('nativePaymentProof'))$('nativePaymentProof').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;f.proofFile=file;f.proofTargetId=null;if(f.row?.record?.payment_status==='PAGO'){try{await window.RNFinance.uploadPaymentProof(f.row.record.id,file,f.proofReplacesId);f.proofFile=null;f.proofReplacesId=null;await loadNativeFinance(f.id,f.draft);toast('Comprovante anexado.')}catch(error){f.proofTargetId=f.row.record.id;paintNativeFinance();nativeFinanceError(error.message||'O pagamento foi mantido, mas o comprovante não foi enviado.')}}else paintNativeFinance()};
 if($('addNativePaymentProof'))$('addNativePaymentProof').onclick=()=>{f.proofReplacesId=null;$('nativePaymentProof')?.click()};
 root.querySelectorAll('.nativeProofReplace').forEach(button=>button.onclick=()=>{f.proofReplacesId=button.dataset.attachment||null;$('nativePaymentProof')?.click()});
 if($('clearNativePaymentProof'))$('clearNativePaymentProof').onclick=()=>{f.proofFile=null;f.proofTargetId=null;f.proofReplacesId=null;paintNativeFinance()};
 if($('retryNativePaymentProof'))$('retryNativePaymentProof').onclick=async()=>{if(!f.proofFile||!f.proofTargetId)return;try{await window.RNFinance.uploadPaymentProof(f.proofTargetId,f.proofFile,f.proofReplacesId);f.proofFile=null;f.proofTargetId=null;f.proofReplacesId=null;await loadNativeFinance(f.id,f.draft);toast('Comprovante anexado.')}catch(error){nativeFinanceError(error.message||'O pagamento foi mantido, mas o comprovante não foi enviado.')}};
}
async function loadNativeFinance(id,draft=null){
 nativeFinanceRoot()?.replaceChildren();const f={id,draft:draft?{...draft}:{received_amount:'',payment_status:'PENDENTE',paid_at:'',billing_entity_id:''},proofFile:null,proofTargetId:null,proofReplacesId:null,loading:!!id,error:'',row:null,data:null};nativeFinance=f;paintNativeFinance();if(!id)return;
 try{const r=await fetch('/api/billing?appointment_id='+encodeURIComponent(id),{cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await r.json();if(!r.ok)throw Error(data.error);if(nativeFinance!==f)return;f.data=data;f.row=data.rows.find(r=>r.appointment_id===id);if(!f.row)throw Error('Atendimento não encontrado no faturamento.');if(!draft){const record=f.row.record;f.draft={billing_entity_id:record?.billing_entity_id||'',received_amount:record?.received_amount==null?'':money(record.received_amount),payment_status:record?.payment_status||'PENDENTE',paid_at:record?.paid_at||'',no_invoice:!!record?.no_invoice}}}
 catch(error){f.error=error?.name==='TimeoutError'?'O financeiro demorou para responder. Tente novamente.':error.message||'Não foi possível carregar o financeiro.'}finally{f.loading=false;if(nativeFinance===f)paintNativeFinance()}
}
function validateNativeFinance(){
 if((window.AgendaAuth||{}).role==='doctor')return;const f=nativeFinance;if(!f||f.loading)throw Error('Aguarde o carregamento do financeiro.');if(f.error)throw Error(f.error);captureNativeFinance();if(f.row?.invoice)return;
 const direct=f.row?window.RNFinance.directPayment(f.row,f.data,nativeMethod()):nativeMethod()==='PARTICULAR';if(!direct)return;
 const amount=window.RNMoney.parseBRL(f.draft.received_amount);if(f.draft.payment_status==='PAGO'&&(amount==null||!f.draft.paid_at))throw Error('Para registrar como pago, informe o valor e a data de pagamento.');
 if(f.row&&!f.draft.billing_entity_id&&(amount!=null||f.draft.payment_status==='PAGO'||f.row.record))throw Error('Selecione uma entidade recebedora vinculada ao médico.');
}
async function saveNativeFinance(id){
 if((window.AgendaAuth||{}).role==='doctor')return;captureNativeFinance();let f=nativeFinance;const method=nativeMethod();if(f?.row?.invoice)return;
 if(!f?.row){if(method!=='PARTICULAR'||window.RNMoney.parseBRL(f?.draft.received_amount)==null&&f?.draft.payment_status!=='PAGO')return;const proofFile=f.proofFile,proofTargetId=f.proofTargetId,proofReplacesId=f.proofReplacesId;await loadNativeFinance(id,f.draft);f=nativeFinance;if(f){f.proofFile=proofFile;f.proofTargetId=proofTargetId;f.proofReplacesId=proofReplacesId;}captureNativeFinance()}
 validateNativeFinance();if(!f.row)throw Error('Financeiro indisponível. Tente novamente.');
 const direct=window.RNFinance.directPayment(f.row,f.data,method),amount=direct?window.RNMoney.parseBRL(f.draft.received_amount):null;let proofUploadFailed=false;
 if(!f.row.record&&(amount==null&&f.draft.payment_status!=='PAGO'||!direct))return;
 const payload={...(f.row.record||{}),attendance_id:f.row.attendance_id,billing_entity_id:f.draft.billing_entity_id,billing_method:method,payment_status:direct?f.draft.payment_status:'PENDENTE',received_amount:amount,paid_at:direct?(f.draft.paid_at||null):null,no_invoice:!!f.draft.no_invoice};
 const pendingRequest=(f.data.requests||[]).find(r=>r.billing_record_id===f.row.record?.id&&r.status==='PENDING');
 if(pendingRequest&&payload.payment_status==='PAGO'&&
   (payload.billing_entity_id!==pendingRequest.billing_entity_id||
    Number(payload.received_amount)!==Number(pendingRequest.received_amount_snapshot)||
    payload.paid_at!==pendingRequest.paid_at_snapshot))
  throw Error('Solicitação de NF já pendente. Para mudar o pagamento, reverta-o de forma auditada e confirme novamente. Para emitir a NF, use Faturamento → Notas Fiscais → Solicitações.');
 if(f.row.record&&!(method==='PARTICULAR'&&payload.payment_status==='PAGO'&&!(f.data.requests||[]).some(r=>r.attendance_id===id&&r.status!=='CANCELLED')&&!f.row.record.invoice_number)&&['billing_entity_id','billing_method','payment_status','received_amount','paid_at'].every(k=>(payload[k]??null)===(f.row.record[k]??null)))return;
 if(method==='PARTICULAR'&&payload.payment_status==='PAGO'&&!(f.data.requests||[]).some(r=>r.attendance_id===id&&r.status!=='CANCELLED')&&!f.row.record?.invoice_number&&(!f.row.record?.no_invoice||Number(amount)!==Number(f.row.record?.received_amount)||payload.paid_at!==f.row.record?.paid_at)){const fiscal=await window.RNFinance.confirmFiscalPayment({patient:patient(f.row.patient_id)||{id:f.row.patient_id,name:f.row.patient},amount,paidAt:payload.paid_at,noInvoice:!!f.row.record?.no_invoice});if(!fiscal)throw Error('Confirmação cancelada. O pagamento não foi alterado.');payload.no_invoice=!!fiscal.no_invoice;if(!fiscal.no_invoice)payload.fiscal=fiscal;payload.payment_parts=fiscal.payment_parts;}
 const r=await fetch('/api/billing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'record',data:payload})}),result=await r.json();if(!r.ok)throw Error(result.error||'Não foi possível salvar o pagamento.');
 if(f.proofFile&&payload.payment_status==='PAGO'&&result.id){try{await window.RNFinance.uploadPaymentProof(result.id,f.proofFile,f.proofReplacesId);f.proofFile=null;f.proofTargetId=null;f.proofReplacesId=null}catch(error){f.proofTargetId=result.id;proofUploadFailed=true}}
 window.RNFinance.notifyFinancialChange();
  // Após resposta de sucesso da API, recarregar o estado é apenas sincronização,
  // não parte da confirmação do recebimento.
  let stateRefreshed=false;
  try{
   const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(response.ok){
    const snapshot=await response.json();
    window.AgendaRevision=snapshot.revision;
    state=Storage.migrate(snapshot.state);
    stateRefreshed=true;
    reconcileRemoteAgendaUpdate();
   }
  }catch{/* Sincronismo de agenda recupera eventual falha de leitura. */}
  if(proofUploadFailed){paintNativeFinance();throw Error('✓ Pagamento salvo. O comprovante não foi enviado. Tente novamente.');}
  return {paymentSaved:true,stateRefreshed};
}

async function saveAppointmentDetailChanges(id,button){
 if(button?.dataset.saving)return;const a=state.appointments.find(x=>x.id===id),owner=selectedProf();if(!a||!owner)return;
 const role=(window.AgendaAuth||{}).role,canEditStatus=role==="general_manager"||role==="secretary",selectedStatus=$("appointmentStatusSelect")?.value;
 const updates={
  ...(canEditStatus&&selectedStatus?{status:selectedStatus,statusUpdatedAt:selectedStatus!==a.status?new Date().toISOString():a.statusUpdatedAt}:{}),
  insurance:$("detailAppointmentInsurance").value.trim(),
  ...( $("detailBillingMethod")?.value?{forma_cobranca:$("detailBillingMethod").value}:{}),
  date:$("detailDate").value,time:$("detailTime").value,duration:Number($("detailDuration").value||60),
  procedure:$("detailProcedure").value.trim(),hospitalId:$("detailHospital").value,guideExpiry:$("detailGuideExpiry").value,
  careType:$("detailCareType").value,notes:$("detailNotes").value.trim(),opme:$("detailOpme").checked,reports:$("detailReports").checked,exams:$("detailExams").checked,
  doctorId:isAnesthesiologist(owner)?$("detailRelatedProfessional").value:a.doctorId,
  anesthetistId:(owner&&!isAnesthesiologist(owner))?$("detailRelatedProfessional").value:a.anesthetistId
 };
 if(!updates.procedure||!updates.hospitalId||!updates.date||!updates.time)return appNotice("Dados incompletos","Informe procedimento, hospital, data e horário.");
 const statusChanged=canEditStatus&&Boolean(selectedStatus)&&selectedStatus!==a.status,changed=Object.keys(updates).some(k=>String(updates[k]??"")!==String(a[k]??"")),otherChanged=Object.keys(updates).some(k=>k!=="status"&&k!=="statusUpdatedAt"&&String(updates[k]??"")!==String(a[k]??""));
 if(statusChanged&&(a.status==="realized"||selectedStatus==="realized")){
  if(role!=="general_manager")return appNotice("Acesso restrito","O status Atendido exige senha do médico ou Gerente Geral.");
  if(otherChanged)return appNotice("Salve os outros dados primeiro","Para confirmar o status com senha, salve as outras alterações antes.");
  return requestPasswordStatusChange(id,selectedStatus);
 }
 try{validateNativeFinance()}catch(error){nativeFinanceError(error.message);return}
 const detailReason=(window.AgendaAuth||{}).role==="doctor"?$("detailSuggestionReason")?.value.trim():"";if((window.AgendaAuth||{}).role==="doctor"&&!detailReason)return appNotice("Motivo necessário","Explique o motivo da alteração para enviar a sugestão.");const updated={...a,...updates,suggestionReason:detailReason||"Alteração do agendamento"};
 if(updated.forma_cobranca==="CONVENIO"&&!updated.insurance?.trim()&&(a.forma_cobranca!=="CONVENIO"||appointmentInsurance(a)!==updated.insurance))return appNotice("Convênio necessário","Informe o convênio do atendimento.");
 const availabilityChanged=["date","time","duration","doctorId","anesthetistId","hospitalId","procedure"]
  .some(key=>String(a[key]??"")!==String(updated[key]??""));
 if(availabilityChanged){
   const problems=window.RNAvailability.appointmentAvailabilityIssues(state,updated);
   if(problems.length)return appNotice("Horário indisponível",problems.join("\\n"));
   const ruleBlocks=evaluateSchedulingRules(updated).filter(x=>x.severity==="block");
   if(ruleBlocks.length)return appNotice("Agendamento bloqueado",ruleBlocks.map(x=>x.name+": "+x.text).join("\\n"));
 }
 const oldText=button.textContent;button.dataset.saving="true";button.disabled=true;button.setAttribute("aria-busy","true");button.textContent=(window.AgendaAuth||{}).role==="doctor"?"Enviando…":"Salvando…";
 try{
  if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("update",updated,id,button);if(sent){closeModals();toast("Sugestão enviada, aguarde aprovação.")}return}
  if(changed){const previousStatus=a.status;Object.assign(a,updated);if(otherChanged)hist(a.patientId,"Agendamento alterado",`${a.procedure} · ${a.date} às ${a.time}`,id);if(statusChanged)hist(a.patientId,"Status alterado",`${statusLabel(previousStatus)} → ${statusLabel(a.status)}`,id);if(await persist()===false)return}
  let financeResult;
  try{financeResult=await saveNativeFinance(id)}catch(error){nativeFinanceError((changed?"Agendamento salvo. ":"")+error.message);return}
  closeModals();
  renderAll();
  if(financeResult?.paymentSaved&&!financeResult.stateRefreshed){
   toast("Pagamento salvo. A agenda será atualizada automaticamente.");
   void checkAgendaRevision();
  }else toast("Agendamento salvo.");
 }finally{if(button.isConnected){delete button.dataset.saving;button.disabled=false;button.removeAttribute("aria-busy");button.textContent=oldText}}
}
function renderAppointmentDetail(a){
 const p=patient(a.patientId),h=hospital(a.hospitalId),doctor=prof(a.doctorId),anesthetist=prof(a.anesthetistId),end=hhmm(mins(a.time)+Number(a.duration||0));
 const owner=selectedProf(),isDoctor=(window.AgendaAuth||{}).role==="doctor",canAdmin=!isDoctor,relatedLabel=isAnesthesiologist(owner)?"Cirurgião":"Anestesista";
  const pending=isDoctor?null:appointmentPendingFlags(a);
 const flags=[["OPME",a.opme],["Laudos",a.reports],["Exames",a.exams]].map(([label,on])=>`<span class="detail-flag ${on?"active":""}">${label}: ${on?"Sim":"Não"}</span>`).join("");
 const heroName=p?.name||doctor?.name||"Cirurgião não informado",heroLabel=p?"Paciente":"Cirurgião",heroMeta=p?`${esc(appointmentInsurance(a)||"Sem convênio")}`:`Paciente ainda não informado · ${esc(a.insurance||"Convênio não informado")}`;
 $("appointmentDetailView").innerHTML=`<div class="appointment-detail-hero detail-modern-hero"><div class="detail-avatar">${esc(heroName.charAt(0))}</div><div><span class="detail-eyebrow">${heroLabel}</span><h4>${esc(heroName)}</h4><p>${heroMeta}</p></div><div class="detail-hero-meta"><span>${p?.email?esc(p.email):"Sem e-mail"}</span>${phoneControl(p?.phone)}</div><span class="detail-status ${esc(a.status)}">${appointmentStatusLabel(a.status)}</span></div><div class="detail-appointment-line"><div><span>Agendamento</span><strong>${parseDate(a.date).toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})} · ${esc(a.time)} às ${esc(end)}</strong>${isDoctor?`<div class="detail-appointment-actions"><button id="cancelDetailAppointmentBtn" type="button" class="danger-btn" ${financialIssuedAppointments.has(a.id)?'disabled title="Atendimento vinculado a Nota Fiscal emitida"':""}>Cancelar</button><button id="rescheduleAppointmentBtn" type="button" class="secondary-btn">Reagendar</button><button id="markAttendedBtn" type="button" class="attended-btn" ${a.status==="realized"?'disabled title="Atendimento já marcado como Atendido"':""}>Atendido</button></div>`:""}</div>${canAdmin?(a.status==="realized"&&(window.AgendaAuth||{}).role==="secretary"?`<div class="appointment-status-editor ${pending?.confirmation?"detail-pending-target":""}">${pending?.confirmation?pendingMark("Atendimento aguardando confirmação","detail-pending-mark"):""}<span>Status</span><strong class="status-readonly">Atendido · protegido</strong></div>`:`<div class="appointment-status-editor ${pending?.confirmation?"detail-pending-target":""}">${pending?.confirmation?pendingMark("Atendimento aguardando confirmação","detail-pending-mark"):""}<label for="appointmentStatusSelect">Status</label><div class="appointment-status-controls"><select id="appointmentStatusSelect" class="status-select ${esc(a.status)}">${appointmentStatusOptions(a.status)}</select></div></div>`):""}</div><div class="appointment-detail-grid detail-edit-grid"><label>Procedimento<input id="detailProcedure" value="${esc(a.procedure||"")}"></label><label>Hospital<select id="detailHospital">${detailHospitalOptions(a.hospitalId)}</select></label><label>Convênio / plano<input id="detailAppointmentInsurance" value="${esc(appointmentInsurance(a))}" ${canAdmin?"":"disabled"}></label><label>Forma de cobrança<select id="detailBillingMethod" ${canAdmin?"":"disabled"}><option value="">Não informada</option><option value="PARTICULAR" ${a.forma_cobranca==="PARTICULAR"?"selected":""}>Particular</option><option value="CONVENIO" ${a.forma_cobranca==="CONVENIO"?"selected":""}>Convênio</option></select></label><label>Data<input id="detailDate" type="date" min="${ds(new Date())}" value="${esc(a.date)}"></label><label>Horário<input id="detailTime" type="time" value="${esc(a.time)}"></label><label>Duração<select id="detailDuration">${detailDurationOptions(a.duration)}</select></label><label>${relatedLabel}<select id="detailRelatedProfessional">${detailRelatedOptions(a,owner)}</select></label><label class="${pending?.missingGuide||pending?.guide?"detail-pending-target":""}">Validade da guia${pending?.missingGuide?pendingMark("Validade da guia não informada","detail-pending-mark"):pending?.guide?pendingMark("Guia próxima do vencimento","detail-pending-mark"):""}<input id="detailGuideExpiry" type="date" value="${esc(a.guideExpiry||"")}"></label><label>Tipo<select id="detailCareType"><option value="outpatient" ${a.careType!=="inpatient"?"selected":""}>Ambulatorial</option><option value="inpatient" ${a.careType==="inpatient"?"selected":""}>Internado</option></select></label></div>${canAdmin?`<section id="nativeFinance" class="native-finance ${pending?.invoice?"pending-finance":""}" ${pending?.invoice?'title="Pendência: NF não informada" aria-label="Financeiro com pendência: NF não informada"':""}></section>`:""}<div class="detail-docs editable-flags"><label class="detail-check"><input id="detailOpme" type="checkbox" role="switch" ${a.opme?"checked":""}> OPME</label><label class="detail-check"><input id="detailReports" type="checkbox" role="switch" ${a.reports?"checked":""}> Laudos</label><label class="detail-check"><input id="detailExams" type="checkbox" role="switch" ${a.exams?"checked":""}> Exames</label></div><div class="detail-notes"><span>Observações</span><textarea id="detailNotes" rows="3" placeholder="Observações do atendimento...">${esc(a.notes||"")}</textarea></div>${isDoctor?'<div class="detail-notes"><span>Motivo da sugestão</span><textarea id="detailSuggestionReason" rows="3" required placeholder="Explique o motivo da alteração"></textarea></div>':""}<section id="surgeryDocuments"></section>${renderRescheduleHistory(a)}<div class="appointment-detail-toolbar ${isDoctor?"doctor-detail-toolbar":""}"><div></div><div class="appointment-detail-actions">${isDoctor?"":`<button id="cancelDetailAppointmentBtn" type="button" class="danger-btn" ${financialIssuedAppointments.has(a.id)?'disabled title="Atendimento vinculado a Nota Fiscal emitida"':""}>Cancelar</button><button id="rescheduleAppointmentBtn" type="button" class="secondary-btn">Reagendar</button>`}<button id="saveDetailChangesBtn" type="button" class="primary-btn">${isDoctor?"Enviar sugestão":"Salvar alterações"}</button></div></div>`;
 mountDocumentPanel($("surgeryDocuments"),a.id);
 if(canAdmin){void loadNativeFinance(a.id);$("detailBillingMethod").onchange=paintNativeFinance}
 $("cancelDetailAppointmentBtn").onclick=()=>openCancellation(a.id);$("rescheduleAppointmentBtn").onclick=()=>openReschedule(a.id);$("saveDetailChangesBtn").onclick=async()=>saveAppointmentDetailChanges(a.id,$("saveDetailChangesBtn"));if(isDoctor)$("markAttendedBtn").onclick=()=>requestPasswordStatusChange(a.id,"realized");qsa("#appointmentDetailView [data-close]").forEach(b=>b.onclick=closeModals);
}
function setAppointmentViewMode(viewing){$("appointmentModal").classList.toggle("appointment-view-mode",viewing);$("appointmentDetailView").classList.toggle("hidden",!viewing);document.querySelector("#appointmentForm > .appointment-layout").classList.toggle("hidden",viewing);qsa("#appointmentForm > .appointment-layout input,#appointmentForm > .appointment-layout select,#appointmentForm > .appointment-layout textarea").forEach(el=>el.disabled=viewing);$("saveAppointmentBtn").classList.toggle("hidden",viewing);$("deleteAppointmentBtn").classList.toggle("hidden",viewing||!$("appointmentId").value);$("appointmentModalTitle").textContent=viewing?"Detalhes do agendamento":"Novo agendamento"}
function openAppointment(id=null,preset={}){
 if(id){const a=state.appointments.find(x=>x.id===id);if(!a)return;$("appointmentId").value=id;setAppointmentViewMode(true);renderAppointmentDetail(a);openModal("appointmentModal");return}
 $("appointmentDetailView").replaceChildren();
 const owner=selectedProf();if(!owner)return appNotice("Profissional necessário","Cadastre um profissional para continuar.");if((owner&&!isAnesthesiologist(owner))&&!state.patients.length)return appNotice("Paciente necessário","Cadastre um paciente para continuar.");if(!state.hospitals.length)return appNotice("Hospital necessário","Cadastre um hospital em Médicos → Hospitais.");
 if(!id&&preset.date&&window.RNAvailability.entirelyUnavailable(state,owner.id,preset.date,!isAnesthesiologist(owner)))
  return appNotice("Dia totalmente bloqueado","Agenda indisponível nesta data para novos agendamentos.");
 if(!id&&preset.date&&preset.time){
   const issue=manualBlockForSlot(owner,preset.date,preset.time,60);
   if(issue){
     const who=prof(issue.professionalId)?.name||"Profissional";
     appNotice("Horário indisponível",`${who}: ${issue.block.start} - ${issue.block.end}\nMotivo: ${issue.block.reason}`);
     return;
   }
 }
 renderAppointmentOptions();$("appointmentForm").reset();$("appointmentId").value="";$("deleteAppointmentBtn").classList.add("hidden");$("appointmentDate").min=ds(new Date());const isDoctor=(window.AgendaAuth||{}).role==="doctor";$("saveAppointmentBtn").textContent=isDoctor?(id?"Enviar sugestão":"Sugerir agendamento"):"Salvar";$("deleteAppointmentBtn").textContent=isDoctor?"Sugerir desagendamento":"Excluir";
 const related=$("relatedProfessional"),label=$("relatedProfessionalLabel");
 if(isAnesthesiologist(owner)){label.childNodes[0].textContent="Cirurgião";related.innerHTML=state.professionals.filter(p=>window.AgendaDoctorId?p.id===window.AgendaDoctorId:(p&&!isAnesthesiologist(p))).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");$("agendaContext").innerHTML=`Agenda de <strong>${esc(owner.name)}</strong> · anestesista selecionado automaticamente.`}
 else{label.childNodes[0].textContent="Anestesista";related.innerHTML='<option value="">Sem anestesista</option>'+state.professionals.filter(p=>p.active!==false&&isAnesthesiologist(p)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");$("agendaContext").innerHTML=`Agenda de <strong>${esc(owner.name)}</strong> · cirurgião selecionado automaticamente.`}
 {  $("appointmentPatient").value=isAnesthesiologist(owner)?"":($("appointmentPatient").options[0]?.value||"");$("appointmentInsurance").value="";$("appointmentProcedure").value="";$("appointmentHospital").value=state.hospitals[0]?.id||"";$("guideExpiry").value="";$("appointmentPayment").value="";$("appointmentInvoice").value="";$("appointmentDate").value=preset.date||ds(new Date());$("appointmentTime").value=preset.time||"08:00";$("appointmentDuration").value="60";document.querySelector('input[name="careType"][value="outpatient"]').checked=true;setFlag("flagOpme",false);setFlag("flagReports",false);setFlag("flagExams",false)
 }if((owner&&!isAnesthesiologist(owner))&&!$("appointmentPatient").value)$("appointmentPatient").value=$("appointmentPatient").options[0]?.value||"";$("appointmentInsurance").value=patient($("appointmentPatient").value)?.insurance||"";updateStandaloneInsuranceField();updatePatientSide();validatePastDate();renderRuleFeedback();setAppointmentViewMode(false);nativeFinance=null;if(!isDoctor)void loadNativeFinance(null);else $("newAppointmentFinance").replaceChildren();openModal("appointmentModal")
}

function currentAppointmentDraft(){
 const owner=selectedProf();
 return {
   id:$("appointmentId").value||"",
   patientId:$("appointmentPatient").value,
   insurance:$("appointmentInsurance").value.trim(),forma_cobranca:$("appointmentBillingMethod").value,
   procedure:$("appointmentProcedure").value.trim(),
   hospitalId:$("appointmentHospital").value,
   guideExpiry:$("guideExpiry").value,
   date:$("appointmentDate").value,
   time:$("appointmentTime").value,
   duration:Number($("appointmentDuration").value||60),
   status:state.appointments.find(a=>a.id===$("appointmentId").value)?.status||"scheduled",
   careType:document.querySelector('input[name="careType"]:checked')?.value||"outpatient",
   doctorId:(owner&&!isAnesthesiologist(owner))?owner.id:$("relatedProfessional").value,
   anesthetistId:isAnesthesiologist(owner)?owner.id:($("relatedProfessional").value||null)
 }
}
function renderRuleFeedback(){
 const a=currentAppointmentDraft();
 if(!a.doctorId||!a.date||!a.time){$("ruleFeedback").innerHTML="";return}
 const rules=evaluateSchedulingRules(a),absoluteBlocks=getAbsoluteSchedulingBlocks(a);
 const msgs=[...rules,...absoluteBlocks];
 const dedup=[...new Map(msgs.map(m=>[`${m.severity}|${m.name}|${m.text}`,m])).values()];
 $("ruleFeedback").innerHTML=dedup.map(m=>`<div class="rule-message ${m.severity}"><strong>${esc(m.name)}:</strong> ${esc(m.text)}</div>`).join("");
 const saveBtn=$("saveAppointmentBtn");
 if(saveBtn){
   saveBtn.disabled=absoluteBlocks.length>0;
   saveBtn.title=absoluteBlocks.length?"Este horário/data está bloqueado.":"";
 }
}

function validatePastDate(){const bad=$("appointmentDate").value&&$("appointmentDate").value<ds(new Date());$("pastDateWarning").classList.toggle("hidden",!bad);return !bad}
$("appointmentForm").onsubmit=async e=>{
 if($("appointmentModal").classList.contains("appointment-view-mode")){e.preventDefault();return saveAppointmentDetailChanges($("appointmentId").value,$("saveDetailChangesBtn"))}
 e.preventDefault();const form=e.currentTarget,submitButton=e.submitter||$("saveAppointmentBtn");if(form.dataset.saving)return;if(!validatePastDate())return;
 form.dataset.saving="true";form.setAttribute("aria-busy","true");const oldSubmitText=submitButton?.textContent;if(submitButton){submitButton.disabled=true;submitButton.textContent=(window.AgendaAuth||{}).role==="doctor"?"Enviando…":"Salvando…"}
 try{
 const owner=selectedProf(),id=$("appointmentId").value||crypto.randomUUID(),old=state.appointments.find(a=>a.id===id);
 const newStatus=old?.status||"scheduled";
 const a={id,patientId:$("appointmentPatient").value,insurance:$("appointmentInsurance").value.trim(),forma_cobranca:$("appointmentBillingMethod").value,procedure:$("appointmentProcedure").value.trim(),hospitalId:$("appointmentHospital").value,guideExpiry:$("guideExpiry").value,payment:Number($("appointmentPayment").value||0),invoiceNumber:$("appointmentInvoice").value.trim(),date:$("appointmentDate").value,time:$("appointmentTime").value,duration:Number($("appointmentDuration").value),status:newStatus,careType:document.querySelector('input[name="careType"]:checked').value,opme:$("flagOpme").checked,reports:$("flagReports").checked,exams:$("flagExams").checked,notes:$("appointmentNotes").value.trim(),doctorId:(owner&&!isAnesthesiologist(owner))?owner.id:$("relatedProfessional").value,anesthetistId:isAnesthesiologist(owner)?owner.id:($("relatedProfessional").value||null)};
 
 if(a.forma_cobranca==="CONVENIO"&&!a.insurance)return appNotice("Convênio necessário","Informe o convênio do atendimento.");
 if((owner&&!isAnesthesiologist(owner))&&!a.patientId)return appNotice("Paciente necessário","Selecione o paciente do agendamento.");
 if(!a.doctorId)return appNotice("Cirurgião necessário","Selecione o cirurgião responsável.");
 const absoluteBlocks=getAbsoluteSchedulingBlocks(a);
 const sharedBlocks=window.RNAvailability.appointmentAvailabilityIssues(state,a);
 if(sharedBlocks.length)return appNotice("Horário indisponível",sharedBlocks.join("\\n"));
 if(absoluteBlocks.length){
   return appNotice("Não é possível salvar",absoluteBlocks.map(x=>`${x.name}: ${x.text}`).join("\n"));
 }

 const ruleIssues=evaluateSchedulingRules(a);
 const blockingRules=ruleIssues.filter(x=>x.severity==="block");
 if(blockingRules.length)return appNotice("Agendamento bloqueado",blockingRules.map(x=>`${x.name}: ${x.text}`).join("\n"));
 const warningRules=ruleIssues.filter(x=>x.severity==="warning");
 if(warningRules.length&&!await appConfirm("Avisos do agendamento",warningRules.map(x=>`${x.name}: ${x.text}`).join("\n"),"Salvar mesmo assim"))return;

 if((window.AgendaAuth||{}).role==="doctor"){
   const sent=await sendAgendaSuggestion(old?"update":"create",a,old?.id||null,submitButton);if(sent){closeModals();$("appointmentForm").reset()}return;
 }
 try{validateNativeFinance()}catch(error){nativeFinanceError(error.message);return}
 const i=state.appointments.findIndex(x=>x.id===id);if(i>=0)state.appointments[i]=a;else state.appointments.push(a);
 const hname=hospital(a.hospitalId)?.name||"hospital";
 if(!old)hist(a.patientId,"Agendamento criado",`${a.procedure} · ${a.date} às ${a.time} · ${hname} · ${statusLabel(a.status)}`,id);
 else{
  if(old.date!==a.date||old.time!==a.time)hist(a.patientId,"Reagendado",`De ${old.date} ${old.time} para ${a.date} ${a.time}`,id);
  if(old.status!==a.status)hist(a.patientId,`Status: ${statusLabel(a.status)}`,`Status alterado de ${statusLabel(old.status)} para ${statusLabel(a.status)}`,id);
  if(old.hospitalId!==a.hospitalId)hist(a.patientId,"Hospital alterado",`Novo hospital: ${hname}`,id);
  if(old.procedure!==a.procedure)hist(a.patientId,"Procedimento alterado",`De "${old.procedure||"—"}" para "${a.procedure}"`,id);
  if((old.guideExpiry||"")!==(a.guideExpiry||""))hist(a.patientId,"Validade da guia alterada",a.guideExpiry?`Nova validade: ${parseDate(a.guideExpiry).toLocaleDateString("pt-BR")}`:"Validade removida",id);
  [["opme","OPME"],["reports","Laudos"],["exams","Exames"]].forEach(([key,label])=>{if(!!old[key]!==!!a[key])hist(a.patientId,`${label} alterado`,`${label}: ${a[key]?"Sim":"Não"}`,id)});
  if(old.careType!==a.careType)hist(a.patientId,"Tipo de atendimento alterado",a.careType==="inpatient"?"Internado":"Ambulatorial",id);
 }
 if(await persist()===false)return;
 try{await saveNativeFinance(id)}catch(error){captureNativeFinance();const kept={...nativeFinance?.draft},proofFile=nativeFinance?.proofFile||null,proofTargetId=nativeFinance?.proofTargetId||null,proofReplacesId=nativeFinance?.proofReplacesId||null;$("appointmentId").value=id;setAppointmentViewMode(true);renderAppointmentDetail(state.appointments.find(x=>x.id===id)||a);await loadNativeFinance(id,kept);if(nativeFinance){nativeFinance.proofFile=proofFile;nativeFinance.proofTargetId=proofTargetId;nativeFinance.proofReplacesId=proofReplacesId;paintNativeFinance()}nativeFinanceError("Agendamento salvo. "+error.message);return}
 closeModals();toast("Agendamento salvo.")
 }finally{delete form.dataset.saving;form.removeAttribute("aria-busy");if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent=oldSubmitText}}
};
async function openCancellation(id){const a=state.appointments.find(x=>x.id===id);if(!a)return;await refreshFinancialAlerts();if(financialIssuedAppointments.has(id))return appNotice("Nota Fiscal emitida","Não é possível cancelar ou excluir este atendimento, pois existe uma Nota Fiscal emitida vinculada a ele.");$("cancelAppointmentForm").reset();$("cancelAppointmentId").value=id;$("cancelReasonOtherLabel").classList.add("hidden");$("cancelAppointmentSummary").innerHTML=`<strong>${esc(patient(a.patientId)?.name||"Paciente")}</strong><br>${parseDate(a.date).toLocaleDateString("pt-BR")} às ${esc(a.time)} · ${esc(a.procedure)}`;closeModals();openModal("cancelAppointmentModal")}
$("deleteAppointmentBtn").onclick=()=>openCancellation($("appointmentId").value);
$("rescheduleNewDate").oninput=renderReschedulePreview;$("rescheduleNewTime").oninput=renderReschedulePreview;
$("rescheduleReasonForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=e.submitter;if(form.dataset.saving)return;const id=$("rescheduleAppointmentId").value,a=state.appointments.find(x=>x.id===id),reason=$("rescheduleReason").value.trim(),newDate=$("rescheduleNewDate").value,newTime=$("rescheduleNewTime").value;if(!a)return;if(!reason)return appNotice("Motivo necessário","Explique o motivo do reagendamento para manter o histórico completo.");if(!newDate||!newTime)return appNotice("Nova data necessária","Informe a nova data e o horário do atendimento.");if(newDate===a.date&&newTime===a.time)return appNotice("Escolha um novo horário","A data ou o horário precisa ser diferente do agendamento atual.");form.dataset.saving="true";const oldText=button?.textContent;if(button){button.disabled=true;button.textContent="Salvando…"}try{const record={fromDate:a.date,fromTime:a.time,toDate:newDate,toTime:newTime,reason,proposedBy:accountName(window.AgendaAuth||{}),createdAt:new Date().toISOString()};const updated={...a,date:newDate,time:newTime,status:"scheduled",rescheduleReason:reason,suggestionReason:reason,rescheduleHistory:[...(a.rescheduleHistory||[]),record],statusUpdatedAt:new Date().toISOString()};const unavailable=window.RNAvailability.appointmentAvailabilityIssues(state,updated);if(unavailable.length)return appNotice("Horário indisponível",unavailable.join("\n"));const blockingRules=evaluateSchedulingRules(updated).filter(r=>r.severity==="block");if(blockingRules.length)return appNotice("Não é possível reagendar",blockingRules.map(r=>r.name+": "+r.text).join("\n"));const blocks=getAbsoluteSchedulingBlocks(updated);if(blocks.length)return appNotice("Não é possível reagendar",blocks.map(x=>`${x.name}: ${x.text}`).join("\n"));if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("update",updated,id,button);if(sent){closeModals();toast("Sugestão enviada, aguarde aprovação.")}return}Object.assign(a,updated);hist(a.patientId,"Reagendado",`De ${record.fromDate} ${record.fromTime} para ${record.toDate} ${record.toTime} · Motivo: ${reason}`,id);if(await persist()===false)return;closeModals();toast("Agendamento reagendado e salvo.")}finally{delete form.dataset.saving;if(button?.isConnected){button.disabled=false;button.textContent=oldText}}};
$("cancelAppointmentForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=e.submitter;if(form.dataset.saving)return;const id=$("cancelAppointmentId").value,a=state.appointments.find(x=>x.id===id);if(!a)return;const selected=$("cancelReasonSelect").value,reason=(selected==="Outro"?$("cancelReasonOther").value:selected).trim();if(!reason)return appNotice("Informe o motivo","Selecione um motivo ou descreva o cancelamento.");form.dataset.saving="true";const oldText=button?.textContent;if(button){button.disabled=true;button.textContent="Enviando…"}try{const archived={...a,cancelReason:reason,suggestionReason:reason,cancelledAt:new Date().toISOString()};if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("delete",archived,id,button);if(sent){closeModals();toast("Sugestão enviada, aguarde aprovação.")}return}state.cancelledAppointments=[...(state.cancelledAppointments||[]),archived];state.appointments=state.appointments.filter(x=>x.id!==id);hist(a.patientId,"Agendamento cancelado",`${a.procedure} · ${a.date} às ${a.time} · ${reason}`,id);if(await persist()===false)return;closeModals();toast("Agendamento movido para Cancelados.")}finally{delete form.dataset.saving;if(button?.isConnected){button.disabled=false;button.textContent=oldText}}};
function canAccessProfessional(id){const auth=window.AgendaAuth||{};return auth.role==="general_manager"||(auth.agendaIds||[]).includes(id)}
function allowedPatientDoctors(){const auth=window.AgendaAuth||{};return state.professionals.filter(p=>(p&&!isAnesthesiologist(p))&&(auth.role==="general_manager"||(auth.agendaIds||[]).includes(p.id)))}
function openPatient(id=null){if((window.AgendaAuth||{}).role==="doctor")return;$("patientForm").reset();$("patientId").value="";$("deletePatientBtn").classList.add("hidden");$("patientModalTitle").textContent=id?"Editar paciente":"Novo paciente";const doctors=allowedPatientDoctors();if(!doctors.length)return appNotice("Sem agenda permitida","Você não possui acesso a uma agenda de cirurgião para cadastrar pacientes.");$("patientDoctor").innerHTML=doctors.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");$("patientDoctor").value=(selectedProf()&&!isAnesthesiologist(selectedProf()))&&canAccessProfessional(selectedProf().id)?selectedProf().id:(doctors[0]?.id||"");if(id){const p=patient(id);if(!canAccessProfessional(p.doctorId))return appNotice("Acesso restrito","Você não possui acesso à agenda deste paciente.");$("patientId").value=p.id;$("patientDoctor").value=p.doctorId||"";$("patientName").value=p.name;$("patientPhone").value=p.phone||"";$("patientCPF").value=window.RNCPF.formatCPF(p.cpf||"");$("patientAddress").value=p.address||"";$("patientEmail").value=p.email||"";$("patientInsurance").value=p.insurance||"";$("patientCardNumber").value=p.cardNumber||""}openModal("patientModal")}

async function renderPatientFinancialHistory(patientId){
 const target=$("detailHistory"),auth=window.AgendaAuth||{};
 const section=document.createElement("section");section.className="patient-financial-history";section.dataset.patientId=patientId;target.append(section);
 try{
  const info=await fetch('/api/patient-authorship?patient_id='+encodeURIComponent(patientId),{cache:'no-store'});if(info.ok){const j=await info.json();if(section.isConnected)section.innerHTML='<h4>Cadastro do paciente</h4><p>Cadastrado por: '+esc(j.created_by_name||'Não informado')+' · '+esc(j.created_at?workflowDate(j.created_at):'Registro anterior à auditoria')+'</p><p>Última atualização por: '+esc(j.updated_by_name||'Não informado')+' · '+esc(j.updated_at?workflowDate(j.updated_at):'—')+'</p>';}
  if(auth.role!=='doctor'||!auth.services?.billing_enabled)return;
  const response=await fetch('/api/patient-finance?patient_id='+encodeURIComponent(patientId),{cache:'no-store'});
  if(!response.ok)throw Error('Não foi possível consultar o financeiro.');
  const {rows}=await response.json();if(!section.isConnected)return;
  section.insertAdjacentHTML('beforeend','<h4>Financeiro dos seus atendimentos · somente leitura</h4>'+(rows.length?rows.map(r=>'<article class="history-item"><strong>'+esc(r.date?parseDate(r.date.slice(0,10)).toLocaleDateString("pt-BR"):'—')+' · '+esc(r.procedure)+'</strong><span>'+esc(r.insurance||'Particular')+' · Status do atendimento: '+esc(appointmentStatusLabel(r.status_atendimento))+'</span><span>Forma de cobrança: '+esc(r.billing_method||'—')+' · NF: '+esc(r.invoice_number||'—')+'</span><span>Valor recebido: '+(r.received_amount==null?'—':esc(money(r.received_amount)))+' · Pagamento: '+esc(r.paid_at?parseDate(r.paid_at.slice(0,10)).toLocaleDateString("pt-BR"):'—')+'</span><span>Status financeiro: '+esc(r.payment_status==='PAGO'?'Pago':'Pendente')+'</span></article>').join(''):'<p>Nenhum atendimento financeiro deste médico para o paciente.</p>'));
 }catch(error){if(section.isConnected)section.insertAdjacentHTML('beforeend','<p role="alert">'+esc(error.message||'Falha na consulta financeira.')+'</p>');}
}

function openPatientDetail(id){const p=patient(id);if(!p)return;detailPatientId=id;$("patientDetailTitle").textContent=p.name;$("detailPhone").innerHTML=phoneControl(p.phone);$("detailEmail").textContent=p.email||"—";$("detailInsurance").textContent=p.insurance||"—";$("detailCard").textContent=p.cardNumber||"—";renderHistory(id,"detailHistory");void renderPatientFinancialHistory(id);let docs=$("patientDocuments");if(!docs){docs=document.createElement("section");docs.id="patientDocuments";$("patientDetailModal").querySelector(".modal-panel").append(docs)}mountDocumentPanel(docs,null,id);openModal("patientDetailModal")}
$("editPatientFromDetail").onclick=()=>{if((window.AgendaAuth||{}).role==="doctor")return;const id=detailPatientId;closeModals();openPatient(id)}
$("patientCPF").oninput=e=>{e.target.value=window.RNCPF.formatCPF(e.target.value);e.target.setCustomValidity("")};
$("patientForm").onsubmit=async e=>{e.preventDefault();if($("patientCPF").value&&!window.RNCPF.validCPF($("patientCPF").value)){ $("patientCPF").setCustomValidity("Informe um CPF válido ou deixe vazio.");$("patientCPF").reportValidity();return;}const x={id:$("patientId").value||crypto.randomUUID(),doctorId:$("patientDoctor").value,name:$("patientName").value.trim(),cpf:window.RNCPF.normalizeCPF($("patientCPF").value),address:$("patientAddress").value.trim(),phone:$("patientPhone").value.trim(),email:$("patientEmail").value.trim(),insurance:$("patientInsurance").value.trim(),cardNumber:$("patientCardNumber").value.trim()},i=state.patients.findIndex(p=>p.id===x.id);if(!canAccessProfessional(x.doctorId))return appNotice("Acesso restrito","Você só pode cadastrar pacientes nas agendas liberadas para sua conta.");if(i>=0){const old=state.patients[i];if(!canAccessProfessional(old.doctorId))return appNotice("Acesso restrito","Você não possui acesso à agenda atual deste paciente.");state.patients[i]={...old,...x};if(old.doctorId!==x.doctorId)hist(x.id,"Médico responsável alterado",`De "${prof(old.doctorId)?.name||"—"}" para "${prof(x.doctorId)?.name||"—"}"`);if(old.insurance!==x.insurance)hist(x.id,"Convênio alterado",`De "${old.insurance||"—"}" para "${x.insurance||"—"}"`);if(old.cardNumber!==x.cardNumber)hist(x.id,"Carteirinha alterada",`De "${old.cardNumber||"—"}" para "${x.cardNumber||"—"}"`)}else{state.patients.push(x);hist(x.id,"Paciente cadastrado","Cadastro criado.")}if(await persist()===false)return;closeModals();toast("Paciente salvo.")}
$("deletePatientBtn").onclick=()=>appNotice("Cadastro preservado","Pacientes não são excluídos do RN Integra.");

function openBlock(id=null,preset={}){
 const owner=selectedProf();if(!owner)return appNotice("Profissional necessário","Selecione um profissional.");
 $("blockForm").reset();$("blockId").value="";$("deleteBlockBtn").classList.add("hidden");$("blockModalTitle").textContent=id?"Editar bloqueio":"Bloquear horário";
 $("blockDate").min=ds(new Date());
 $("blockContext").innerHTML=`Agenda de <strong>${esc(owner.name)}</strong>`;
 if(id){
   const b=state.scheduleBlocks.find(x=>x.id===id);if(!b)return;
   $("blockId").value=b.id;$("blockDate").value=b.date;$("blockStart").value=b.start;$("blockEnd").value=b.end;$("blockReason").value=b.reason;$("deleteBlockBtn").classList.remove("hidden");
 }else{
   $("blockDate").value=preset.date||ds(new Date());$("blockStart").value=preset.start||"08:00";$("blockEnd").value=preset.end||"09:00";
 }
 openModal("blockModal")
}
$("blockForm").onsubmit=async e=>{
 e.preventDefault();const owner=selectedProf();if($("blockDate").value<ds(new Date()))return appNotice("Data inválida","Não é possível criar bloqueio em data passada.");
 if(mins($("blockStart").value)>=mins($("blockEnd").value))return appNotice("Horário inválido","O horário final deve ser posterior ao inicial.");
 const item={id:$("blockId").value||crypto.randomUUID(),professionalId:owner.id,date:$("blockDate").value,start:$("blockStart").value,end:$("blockEnd").value,reason:$("blockReason").value.trim(),hospitalId:null};

 // Bloqueios manuais impedem novos agendamentos; atendimentos já existentes são preservados.

 const i=state.scheduleBlocks.findIndex(x=>x.id===item.id);if(i>=0)state.scheduleBlocks[i]=item;else state.scheduleBlocks.push(item);
 if(await persist()===false)return;closeModals();toast("Bloqueio salvo.")
};
$("deleteBlockBtn").onclick=async()=>{const id=$("blockId").value;if(id&&await appConfirm("Excluir bloqueio","Este horário voltará a ficar disponível.","Excluir",true)){state.scheduleBlocks=state.scheduleBlocks.filter(x=>x.id!==id);if(await persist()===false)return;closeModals();toast("Bloqueio excluído.")}};

function syncRuleBlockAllDay(){const allDay=$("ruleBlockAllDay").checked,severity=$("ruleSeverity");if(allDay)severity.value="block";severity.disabled=allDay}
function openRule(id=null){
 const surgeons=state.professionals.filter(p=>window.AgendaDoctorId?p.id===window.AgendaDoctorId:(p&&!isAnesthesiologist(p)));if(!surgeons.length)return appNotice("Cirurgião necessário","Cadastre um cirurgião.");
 $("ruleForm").reset();$("ruleId").value="";$("deleteRuleBtn").classList.add("hidden");$("ruleModalTitle").textContent=id?"Editar regra":"Nova regra";
 $("ruleProfessional").innerHTML=surgeons.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
 $("ruleHospital").innerHTML='<option value="">Todos os hospitais</option>'+state.hospitals.map(h=>`<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("");
 $("ruleEnabled").checked=true;$("ruleBlockAllDay").checked=false;
 if(id){
   const r=state.schedulingRules.find(x=>x.id===id);if(!r)return;
   $("ruleId").value=r.id;$("ruleProfessional").value=r.professionalId;$("ruleName").value=r.name||"";$("ruleHospital").value=r.hospitalId||"";$("ruleSeverity").value=r.blockAllDay?"block":r.severity||"warning";$("ruleWeekday").value=r.weekday??"";$("ruleOccurrence").value=r.occurrence||"";$("ruleStart").value=r.start||"";$("ruleEnd").value=r.end||"";$("ruleMaxPatients").value=r.maxPatients||"";$("ruleProcedure").value=r.procedureContains||"";$("rulePreferredTimes").value=r.preferredTimes||"";$("ruleForbiddenTimes").value=r.forbiddenTimes||"";$("ruleBlockAllDay").checked=!!r.blockAllDay;$("ruleEnabled").checked=r.enabled!==false;$("deleteRuleBtn").classList.remove("hidden");
 }else if($("rulesProfessionalFilter").value)$("ruleProfessional").value=$("rulesProfessionalFilter").value;
 syncRuleBlockAllDay();openModal("ruleModal")
}
$("ruleForm").onsubmit=async e=>{
 e.preventDefault();
 const r={id:$("ruleId").value||crypto.randomUUID(),professionalId:$("ruleProfessional").value,name:$("ruleName").value.trim(),hospitalId:$("ruleHospital").value||null,severity:$("ruleSeverity").value,weekday:$("ruleWeekday").value,occurrence:$("ruleOccurrence").value,start:$("ruleStart").value,end:$("ruleEnd").value,maxPatients:$("ruleMaxPatients").value?Number($("ruleMaxPatients").value):null,procedureContains:$("ruleProcedure").value.trim(),preferredTimes:$("rulePreferredTimes").value.trim(),forbiddenTimes:$("ruleForbiddenTimes").value.trim(),blockAllDay:$("ruleBlockAllDay").checked,enabled:$("ruleEnabled").checked};r.severity=r.blockAllDay?"block":r.severity;
 if(r.start&&r.end&&mins(r.start)>=mins(r.end))return appNotice("Faixa inválida","O horário final deve ser posterior ao inicial.");
 const i=state.schedulingRules.findIndex(x=>x.id===r.id);if(i>=0)state.schedulingRules[i]=r;else state.schedulingRules.push(r);
 if(await persist()===false)return;closeModals();toast("Regra salva.")
};
$("ruleBlockAllDay").onchange=syncRuleBlockAllDay;
$("deleteRuleBtn").onclick=async()=>{const id=$("ruleId").value;if(id&&await appConfirm("Excluir regra","A regra deixará de orientar ou bloquear novos agendamentos.","Excluir",true)){state.schedulingRules=state.schedulingRules.filter(x=>x.id!==id);if(await persist()===false)return;closeModals();toast("Regra excluída.")}};


function openHospital(id=null){const h=state.hospitals.find(h=>h.id===id);$("hospitalForm").reset();$("hospitalId").value=h?.id||"";$("hospitalName").value=h?.name||"";$("hospitalModalTitle").textContent=h?"Editar hospital":"Novo hospital";$("hospitalForm").querySelector('[type="submit"]').textContent=h?"Salvar":"Adicionar";openModal("hospitalModal")}
$("hospitalForm").onsubmit=async e=>{e.preventDefault();const id=$("hospitalId").value,name=$("hospitalName").value.trim();if(state.hospitals.some(h=>h.id!==id&&h.name.localeCompare(name,"pt-BR",{sensitivity:"base"})===0))return appNotice("Hospital já cadastrado","Use o hospital existente na lista.");const h=state.hospitals.find(h=>h.id===id);if(h)h.name=name;else state.hospitals.push({id:crypto.randomUUID(),name});if(await persist()===false)return;closeModals();toast("Hospital salvo.")}

$("professionalFilter").onchange=renderCalendar;$("rulesProfessionalFilter").onchange=renderRules;$("rulesStatusFilter").onchange=renderRules;$("patientSearch").oninput=renderPatients;$("appointmentPatient").onchange=()=>{$("appointmentInsurance").value=patient($("appointmentPatient").value)?.insurance||"";updateStandaloneInsuranceField();updatePatientSide()};$("appointmentBillingMethod").onchange=()=>{updateStandaloneInsuranceField();paintNativeFinance()};$("appointmentDate").onchange=()=>{validatePastDate();renderRuleFeedback()};

["appointmentProcedure","appointmentHospital","appointmentTime","appointmentDuration","relatedProfessional","appointmentDate"].forEach(id=>$(id).addEventListener("change",renderRuleFeedback));
["appointmentTime","appointmentDate"].forEach(id=>$(id).addEventListener("input",renderRuleFeedback));
$("appointmentProcedure").addEventListener("input",renderRuleFeedback);

["flagOpme","flagReports","flagExams"].forEach(id=>$(id).onchange=()=>document.querySelector(`[data-state-for="${id}"]`).textContent=$(id).checked?"Sim":"Não");
$("prevBtn").onclick=()=>{currentDate=addDays(currentDate,calendarMode==="week"?-7:-1);renderCalendar()};$("nextBtn").onclick=()=>{currentDate=addDays(currentDate,calendarMode==="week"?7:1);renderCalendar()};$("todayBtn").onclick=()=>{currentDate=calendarMode==="week"?startOfWeek(new Date()):new Date();renderCalendar()}
$("newAppointmentBtn").onclick=()=>openAppointment(null,window.matchMedia("(max-width:900px)").matches?{date:mobileSelectedDate}:{});$("newBlockBtn").onclick=()=>openBlock();$("newRuleBtn").onclick=()=>openRule();$("newPatientBtn").onclick=()=>openPatient();$("newHospitalBtn").onclick=()=>openHospital();$("configureBlockBtn").onclick=()=>openBlock();
qsa(".segment").forEach(b=>b.onclick=()=>{qsa(".segment").forEach(x=>x.classList.remove("active"));b.classList.add("active");calendarMode=b.dataset.mode;currentDate=calendarMode==="week"?startOfWeek(currentDate):new Date(currentDate);renderCalendar()});
let mobileSelectedDate=ds(new Date()),mobileMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1),mobileListMode="day";
function initMobileUI(){
 $("agendaView").insertAdjacentHTML("beforeend",'<section id="mobileCalendar" class="mobile-calendar" aria-label="Calendário mensal"></section>');
 $("todayBtn").addEventListener("click",()=>{mobileSelectedDate=ds(new Date());mobileMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderMobileCalendar()});
}

function mobileCalendarCard(entry,apps,owner){
 if(entry.kind==="appointment"){
  const a=entry.item;
  const badge=typeof appointmentPendingBadge==="function"?appointmentPendingBadge(a):"";
   return `<button class="mobile-appointment ${esc(a.status)} ${hasAnesthesiaConflict(a,apps,owner)?"has-conflict":""} ${badge?"has-pending":""}" data-mobile-appointment="${esc(a.id)}">${badge}<span class="mobile-time"><strong>${esc(a.time)}</strong></span><span class="mobile-appointment-content">${appointmentCardContent(a,owner)}</span><span aria-hidden="true">›</span></button>`;
 }
 if(entry.kind==="rule"){
  const interval=entry.item;
  return `<div class="mobile-appointment mobile-block mobile-rule-block" role="note" aria-label="Indisponível das ${esc(window.RNAvailability.timeLabel(interval.start))} às ${esc(window.RNAvailability.timeLabel(interval.end))}"><span class="mobile-time"><strong>${esc(window.RNAvailability.timeLabel(interval.start))}</strong><small>até ${esc(window.RNAvailability.timeLabel(interval.end))}</small></span><span class="mobile-appointment-content"><strong class="mobile-block-label">HORÁRIO INDISPONÍVEL</strong><span class="mobile-block-reason">${esc(interval.reason)}</span></span></div>`;
 }
 const b=entry.item;
 return `<button type="button" class="mobile-appointment mobile-block" data-mobile-block="${esc(b.id)}" aria-label="Horário bloqueado, das ${esc(b.start)} às ${esc(b.end)}. ${esc(b.reason||"Sem motivo informado")}"><span class="mobile-time"><strong>${esc(b.start)}</strong><small>até ${esc(b.end)}</small></span><span class="mobile-appointment-content"><strong class="mobile-block-label">HORÁRIO BLOQUEADO</strong><span class="mobile-block-reason">${esc(b.reason||"Sem motivo informado")}</span></span><span aria-hidden="true">›</span></button>`;
}

function renderMobileCalendar(){
 mobileListMode="day";
 if($("mobileAccountSpecialty")){const auth=window.AgendaAuth||{},professional=state.professionals.find(p=>p.id===auth.professionalId)||state.professionals.find(p=>(auth.agendaIds||[]).includes(p.id));$("mobileAccountSpecialty").textContent=auth.role==="doctor"?(professional?.specialty||""):""}
 const root=$("mobileCalendar");if(!root)return;const owner=selectedProf();if(!owner){root.innerHTML='<div class="empty">Nenhuma agenda disponível.</div>';return}
 const apps=state.appointments.filter(a=>(isAnesthesiologist(owner)?a.anesthetistId===owner.id:a.doctorId===owner.id)&&a.status!=="cancelled"),blocks=state.scheduleBlocks.filter(b=>b.professionalId===owner.id),dates=new Set(apps.map(a=>a.date)),blockDates=new Set(blocks.map(b=>b.date)),start=addDays(mobileMonth,-mobileMonth.getDay()),selected=parseDate(mobileSelectedDate);
 const availability=window.RNAvailability,includeRules=!isAnesthesiologist(owner);
 const monthDates=Array.from({length:42},(_,i)=>ds(addDays(start,i)));
 const ruleDates=new Set(monthDates.filter(date=>availability.availabilityIntervals(state,owner.id,date,includeRules).some(interval=>interval.kind==="rule")));
 for(const date of ruleDates)blockDates.add(date);
 const fullyBlocked=availability.entirelyUnavailable(state,owner.id,mobileSelectedDate,includeRules);
 const newButton=$("newAppointmentBtn");
 if(newButton&&window.matchMedia("(max-width:900px)").matches){newButton.disabled=fullyBlocked;newButton.title=fullyBlocked?"Agenda indisponível nesta data.":"";}

 const from=mobileListMode==="week"?ds(startOfWeek(selected)):mobileSelectedDate,to=mobileListMode==="week"?ds(addDays(startOfWeek(selected),6)):mobileSelectedDate;
 const rows=apps.filter(a=>a.date>=from&&a.date<=to).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
 const visibleBlocks=blocks.filter(b=>b.date>=from&&b.date<=to);
 const ruleIntervals=fullyBlocked?[]:availability.groupedRuleIntervals(
  availability.availabilityIntervals(state,owner.id,mobileSelectedDate,includeRules));
 const entries=[...rows.map(a=>({kind:"appointment",item:a,date:a.date,time:a.time||""})),...visibleBlocks.map(b=>({kind:"block",item:b,date:b.date,time:b.start||""})),
  ...ruleIntervals.map((interval,i)=>({kind:"rule",item:interval,date:mobileSelectedDate,time:availability.timeLabel(interval.start),id:i}))].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));

 root.innerHTML=`<div class="mobile-month-nav"><button data-mobile-month="-1" aria-label="Mês anterior">‹</button><strong>${esc(mobileMonth.toLocaleDateString("pt-BR",{month:"long"}))}</strong><button data-mobile-month="1" aria-label="Próximo mês">›</button></div><div class="mobile-year-nav"><button data-mobile-year="-1" aria-label="Ano anterior">‹</button><strong>${mobileMonth.getFullYear()}</strong><button data-mobile-year="1" aria-label="Próximo ano">›</button></div><div class="mobile-month-grid">${["DOM","SEG","TER","QUA","QUI","SEX","SÁB"].map(d=>`<span class="mobile-weekday">${d}</span>`).join("")}${Array.from({length:42},(_,i)=>{const date=addDays(start,i),key=ds(date);return `<button class="mobile-date ${date.getMonth()!==mobileMonth.getMonth()?"outside":""} ${key===mobileSelectedDate?"selected":""}" data-mobile-date="${key}" aria-pressed="${key===mobileSelectedDate}" aria-label="${date.toLocaleDateString("pt-BR")}${dates.has(key)?", com atendimentos":""}${blockDates.has(key)?", com horário bloqueado":""}"><span>${date.getDate()}</span>${dates.has(key)||blockDates.has(key)?`<em class="mobile-date-dots" aria-hidden="true">${dates.has(key)?'<i class="mobile-date-appointment-dot"></i>':""}${blockDates.has(key)?'<i class="mobile-date-block-dot"></i>':""}</em>`:""}</button>`}).join("")}</div><div class="mobile-day-heading"><strong>${selected.toLocaleDateString("pt-BR",{day:"numeric",month:"short",year:"numeric"})}${mobileListMode==="week"?" · Semana":""}</strong><button id="mobileCalendarTop" aria-label="Voltar ao calendário">↑</button></div><div class="mobile-day-list">${fullyBlocked?'<div class="mobile-full-day-block" role="status"><strong>Dia totalmente bloqueado</strong><span>Agenda indisponível nesta data para novos agendamentos.</span></div>':''}${entries.map(entry=>mobileCalendarCard(entry,apps,owner)).join("")||(!fullyBlocked?'<div class="empty">Nenhum atendimento ou bloqueio neste dia.</div>':"")}</div>`;
 root.querySelectorAll("[data-mobile-month],[data-mobile-year]").forEach(b=>b.onclick=()=>{mobileMonth=new Date(mobileMonth.getFullYear()+Number(b.dataset.mobileYear||0),mobileMonth.getMonth()+Number(b.dataset.mobileMonth||0),1);mobileSelectedDate=ds(mobileMonth);currentDate=new Date(mobileMonth);renderCalendar()});
 root.querySelectorAll("[data-mobile-date]").forEach(b=>b.onclick=()=>{mobileSelectedDate=b.dataset.mobileDate;currentDate=parseDate(mobileSelectedDate);mobileMonth=new Date(currentDate.getFullYear(),currentDate.getMonth(),1);renderCalendar()});
 root.querySelectorAll("[data-mobile-appointment]").forEach(b=>b.onclick=()=>openAppointment(b.dataset.mobileAppointment));
 root.querySelectorAll("[data-mobile-block]").forEach(b=>b.onclick=()=>openBlock(b.dataset.mobileBlock));
 $("mobileCalendarTop").onclick=()=>root.scrollIntoView({behavior:"smooth",block:"start"});
}
initWorkflowUI();
function showView(view){
 const role=(window.AgendaAuth||{}).role;
 if(view==='settings'&&window.AgendaInitialView!=='settings'){if(role==='general_manager')window.location.assign('/settings');return}
 if(view==='settings'&&role!=='general_manager')return;if(view==='audit'&&!['general_manager','secretary'].includes(role))return;
 if(view==='requests'&&role==='doctor')return;
 qsa(".agenda-nav-item").forEach(x=>{const active=x.dataset.view===view;x.classList.toggle("active",active);x.setAttribute("aria-current",active?"page":"false")});qsa(".view").forEach(v=>v.classList.remove("active"));$(`${view}View`).classList.add("active");const onAgenda=view==="agenda",manager=(window.AgendaAuth||{}).role==="general_manager";$("newAppointmentBtn").classList.toggle("hidden",!onAgenda);$("newBlockBtn").classList.toggle("hidden",!onAgenda||(!manager&&(window.AgendaAuth||{}).role!=="doctor"));$("agendaNotifications").classList.toggle("hidden",!onAgenda||(window.AgendaAuth||{}).role==="doctor");if(!onAgenda)closeNotificationPanel();$("cancelledPageBtn").classList.toggle("hidden",!onAgenda);document.querySelector(".dynamic-page-heading")?.remove();document.querySelector(".topbar").classList.toggle("hidden",!onAgenda&&view!=="settings");if(view==="settings"&&window.AgendaAdminSection!=="hospitals"){const x=window.AgendaAdminSection==="rules"?["Regras e bloqueios","Disponibilidade da agenda selecionada."]:["Configurações","Usuários e permissões administrativas."],heading=`<h1>${esc(x[0])}</h1>`;document.querySelector(".agenda-page-heading").insertAdjacentHTML("afterbegin",`<div class="dynamic-page-heading">${heading}<p>${esc(x[1])}</p></div>`)}if(view==="cancelled")renderCancelled();if(view==="settings"&&(window.AgendaAuth||{}).role==="general_manager")renderAccess();window.scrollTo({top:0,behavior:"smooth"})}
qsa(".agenda-nav-item").forEach(b=>b.onclick=()=>showView(b.dataset.view));
$("notificationBell").onclick=e=>{e.stopPropagation();toggleNotificationPanel()};$("closeNotificationPanel").onclick=e=>{e.stopPropagation();closeNotificationPanel()};$("notificationPanel").onclick=e=>e.stopPropagation();document.addEventListener("click",closeNotificationPanel);
qsa("[data-close]").forEach(b=>b.onclick=closeModals);$("modalBackdrop").onclick=closeModals;document.addEventListener("click",e=>{const dialog=e.target instanceof HTMLDialogElement?e.target:null;if(dialog?.open&&e.target===dialog)dialog.close()});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModals()});
$("newAccessBtn").onclick=()=>openAccess();
$("toggleAccessPassword").onclick=()=>{const field=$("accessPassword"),visible=field.type==="password";field.type=visible?"text":"password";$("toggleAccessPassword").setAttribute("aria-pressed",String(visible));$("toggleAccessPassword").setAttribute("aria-label",visible?"Ocultar senha":"Mostrar senha");$("toggleAccessPassword").title=visible?"Ocultar senha":"Mostrar senha"};$("accessForm").onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;if(form.dataset.saving)return;const button=form.querySelector('[type="submit"]'),error=$("accessFormError");error.classList.add("hidden");const payload={id:Number($("accessId").value)||undefined,email:$("accessEmail").value,name:$("accessName").value,role:$("accessRole").value,doctor_id:null,updated_at:accessUsers.find(u=>u.id===Number($("accessId").value))?.updated_at,password:$("accessPassword").value||undefined,agendaIds:qsa('#accessAgendaChoices input:checked').map(x=>x.value)};form.dataset.saving="true";button.disabled=true;button.textContent="Salvando…";form.setAttribute("aria-busy","true");try{const response=await fetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Não foi possível concluir o salvamento. Confira a conexão e tente novamente.");closeModals();toast("Acesso atualizado.");renderAccess().catch(()=>toast("Acesso salvo. Reabra Configurações para atualizar a lista."))}catch(reason){error.textContent=reason.message||"Falha de conexão. Tente novamente.";error.classList.remove("hidden");error.focus()}finally{delete form.dataset.saving;button.disabled=false;button.textContent="Salvar acesso";form.removeAttribute("aria-busy")}};
$("deleteAccessBtn").onclick=async()=>{const id=Number($("accessId").value);if(!id||!await appConfirm("Remover acesso","Esta pessoa não conseguirá mais entrar nas agendas concedidas.","Remover",true))return;const response=await fetch(`/api/access?id=${id}`,{method:"DELETE"});if(!response.ok)return appNotice("Falha ao remover acesso",(await response.json()).error||"Tente novamente.");closeModals();await renderAccess();toast("Acesso removido.")};

$("professionalFilter").addEventListener("change",()=>{renderAppointmentOptions();renderPatients();renderCancelled()});
$("relatedProfessional").addEventListener("change",()=>{renderAppointmentOptions();updatePatientSide()});

initMobileUI();applyRoleRestrictions();renderAll();
if(window.AgendaDoctorId){$("professionalFilter").value=window.AgendaDoctorId;renderAll()}
window.addEventListener("rn-directory-changed",e=>{window.AgendaRevision=e.detail.revision;state=Storage.migrate(e.detail.state);renderAll()});
showView(window.AgendaInitialView||'agenda');
startAgendaSync();
if(location.hash==='#settings'&&window.AgendaInitialView!=='settings'&&(window.AgendaAuth||{}).role==='general_manager')window.location.replace('/settings');

const menuSizeObserver=new ResizeObserver(entries=>{document.documentElement.style.setProperty("--desktop-nav-height",`${entries[0].target.getBoundingClientRect().height}px`)});
menuSizeObserver.observe(document.querySelector(".agenda-subnav"));
window.addEventListener("pagehide",()=>{menuSizeObserver.disconnect();window.AgendaSyncCleanup?.()},{once:true});
const globalHeader=document.querySelector('.hub-header');
new ResizeObserver(()=>{document.documentElement.style.setProperty('--global-header-height',`${globalHeader.getBoundingClientRect().height}px`);scheduleCalendarHeader()}).observe(globalHeader);
const floatingDays=document.createElement("div");floatingDays.className="floating-calendar-days";floatingDays.setAttribute("aria-hidden","true");document.body.appendChild(floatingDays);
function positionCalendarDays(){
 const card=document.querySelector(".agenda-card"),grid=$("calendar").querySelector(".calendar-grid"),top=Math.max(document.querySelector(".agenda-subnav").getBoundingClientRect().bottom,document.querySelector(".hub-header").getBoundingClientRect().bottom),bounds=card.getBoundingClientRect();
 const visible=window.innerWidth>900&&$("agendaView").classList.contains("active")&&grid&&bounds.top<top&&bounds.bottom>top+80;
 floatingDays.hidden=!visible;if(!visible)return;
 floatingDays.style.cssText=`position:fixed;top:${top}px;left:${bounds.left}px;width:${card.clientWidth}px;overflow:hidden;z-index:17;pointer-events:none`;
 const row=document.createElement("div");row.className=grid.className;row.style.width=`${grid.getBoundingClientRect().width}px`;row.style.transform=`translateX(${-card.scrollLeft}px)`;
 grid.querySelectorAll(":scope > .corner,:scope > .day-head").forEach(cell=>row.appendChild(cell.cloneNode(true)));floatingDays.replaceChildren(row);
}
let calendarHeaderFrame=0;function scheduleCalendarHeader(){cancelAnimationFrame(calendarHeaderFrame);calendarHeaderFrame=requestAnimationFrame(positionCalendarDays)}
document.addEventListener("scroll",scheduleCalendarHeader,true);window.addEventListener("resize",scheduleCalendarHeader);
new MutationObserver(scheduleCalendarHeader).observe($("calendar"),{childList:true});
scheduleCalendarHeader();
let __lastRenderedMinute="";
setInterval(()=>{
 const now=new Date(),stamp=`${ds(now)}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
 if(stamp!==__lastRenderedMinute){
   __lastRenderedMinute=stamp;
   if($("agendaView").classList.contains("active"))renderCalendar();
 }
},15000);

function mountDocumentPanel(host,appointmentId,patientId){if(window.mountSurgeryDocuments)return window.mountSurgeryDocuments(host,appointmentId,patientId);host.textContent="Carregando documentos…";if(!window.documentsScriptPromise)window.documentsScriptPromise=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="/surgery-documents.js?v=1";s.onload=resolve;s.onerror=()=>{window.documentsScriptPromise=null;reject(new Error("Falha ao carregar documentos."))};document.body.append(s)});window.documentsScriptPromise.then(()=>{if(host.isConnected)window.mountSurgeryDocuments(host,appointmentId,patientId)}).catch(()=>{host.textContent="Não foi possível carregar os documentos. Feche e abra os detalhes novamente."})}


window.addEventListener("pageshow",event=>{if(event.persisted)window.location.reload()});
