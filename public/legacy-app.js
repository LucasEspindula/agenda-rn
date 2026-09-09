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
  x.professionals=(d.professionals||f.professionals).map(p=>({...p,crm:p.crm||"",category:p.category||(String(p.specialty||"").toLowerCase().includes("anest")?"anesthetist":"doctor")}));
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
  try{
   let raw=localStorage.getItem(this.key);
   if(raw){const d=this.migrate(JSON.parse(raw));this.save(d);return d}
   raw=localStorage.getItem("agendaRNData_v4")||localStorage.getItem("agendaRNData_v3")||localStorage.getItem("agendaRNData_v2")||localStorage.getItem("agendaClinicaData_v1");
   const d=raw?this.migrate(JSON.parse(raw)):this.defaultData();this.save(d);return d
  }catch{const d=this.defaultData();this.save(d);return d}
 },
 save(d){localStorage.setItem(this.key,JSON.stringify(d));fetch("/api/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(d)}).then(response=>{if(!response.ok)throw new Error("sync")}).catch(()=>toast("Alteração salva neste dispositivo, mas ainda não sincronizada."))}
};
let state=Storage.load(),calendarMode="week",currentDate=startOfWeek(new Date()),detailPatientId=null,workflowData={requests:[],notifications:[],audit:[]};
const $=id=>document.getElementById(id),qsa=s=>[...document.querySelectorAll(s)];
function pad(n){return String(n).padStart(2,"0")}function ds(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function parseDate(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)}function startOfWeek(x){const d=new Date(x),day=d.getDay(),diff=day===0?-6:1-day;d.setDate(d.getDate()+diff);d.setHours(0,0,0,0);return d}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}function sameDay(a,b){return ds(a)===ds(b)}function mins(t){const[h,m]=t.split(":").map(Number);return h*60+m}function hhmm(v){return `${pad(Math.floor(v/60))}:${pad(v%60)}`}
function hospitalAcronym(name=""){
 if(String(name).trim().toLowerCase()==="hospital blanc")return "Blanc";
 const words=String(name).trim().split(/\s+/).filter(w=>w&&!/^(de|da|do|das|dos)$/i.test(w));
 if(!words.length)return "H";
 if(words.length===1)return words[0].slice(0,4).toUpperCase();
 return words.map(w=>w[0]).join("").slice(0,4).toUpperCase();
}
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function prof(id){return state.professionals.find(x=>x.id===id)}function patient(id){return state.patients.find(x=>x.id===id)}function hospital(id){return state.hospitals.find(x=>x.id===id)}function selectedProf(){return prof($("professionalFilter").value)||state.professionals[0]}
function statusLabel(s){return({scheduled:"Agendado",confirmed:"Confirmado",authorized:"Autorizado",analysis:"Análise",realized:"Realizado",rescheduled:"Agendado",provisional:"Agendado",attended:"Realizado"})[s]||s}
function occurrenceInMonth(date){
 const d=new Date(date),day=d.getDay(),dayNum=d.getDate();
 const occurrence=Math.ceil(dayNum/7);
 const nextSame=new Date(d);nextSame.setDate(dayNum+7);
 return {occurrence,isLast:nextSame.getMonth()!==d.getMonth(),weekday:day}
}
function csvTimes(value){return String(value||"").split(",").map(x=>x.trim()).filter(Boolean)}
function overlap(startA,endA,startB,endB){return startA<endB&&endA>startB}
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
   if(issues.length)messages.push({severity:r.severity||"warning",name:r.name||"Regra",text:issues.join(" · ")});
 }
 return messages
}
function evaluateBlocks(a){
 const issues=[];
 const professionals=[a.doctorId,a.anesthetistId].filter(Boolean);
 for(const pid of professionals){
   for(const b of state.scheduleBlocks.filter(x=>x.professionalId===pid&&blockAppliesToAppointment(x,a))){
     issues.push({professionalId:pid,block:b});
   }
 }
 return issues
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
   doctorId:owner.category==="doctor"?owner.id:null,
   anesthetistId:owner.category==="anesthetist"?owner.id:null
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
 if(!owner||owner.category!=="doctor")return [];
 return state.schedulingRules.filter(r=>r.professionalId===owner.id&&ruleMatchesDate(r,dateString));
}
function hardRuleIntervalsForDate(owner,dateString){
 const workStart=mins(state.settings.workStart),workEnd=mins(state.settings.workEnd),out=[];
 for(const r of activeRulesForDate(owner,dateString).filter(r=>r.severity==="block")){
   if(r.blockAllDay){
     out.push({start:workStart,end:workEnd,rule:r,label:`Dia bloqueado: ${r.name}`});
     continue;
   }
   // "start/end" represent the allowed window; outside it is blocked.
   if(r.start && mins(r.start)>workStart){
     out.push({start:workStart,end:mins(r.start),rule:r,label:`Fora da regra: ${r.name}`});
   }
   if(r.end && mins(r.end)<workEnd){
     out.push({start:mins(r.end),end:workEnd,rule:r,label:`Fora da regra: ${r.name}`});
   }
   for(const t of csvTimes(r.forbiddenTimes)){
     const s=mins(t);
     out.push({start:s,end:Math.min(s+30,workEnd),rule:r,label:`Horário bloqueado: ${r.name}`});
   }
 }
 return out.filter(x=>x.end>x.start);
}
function evaluateVisibleHardRuleBlocks(a){
 const surgeon=prof(a.doctorId);
 if(!surgeon||surgeon.category!=="doctor"||!a.date||!a.time)return [];
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
 if(surgeon?.category==="doctor"){
   const dateRules=activeRulesForDate(surgeon,a.date).filter(r=>r.severity==="block");

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




function persist(){Storage.save(state);renderAll()}function toast(s){$("toast").textContent=s;$("toast").classList.remove("hidden");clearTimeout(window.tt);window.tt=setTimeout(()=>$("toast").classList.add("hidden"),1800)}
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
 const auth=window.AgendaAuth||{},allowed=auth.role==="general_manager"?state.professionals:state.professionals.filter(p=>(auth.agendaIds||[]).includes(p.id));
 sel.innerHTML=allowed.map(p=>`<option value="${p.id}">${esc(p.name)}${p.crm?` — CRM ${esc(p.crm)}`:""} — ${p.category==="anesthetist"?"Anestesista":"Cirurgião"}</option>`).join("");
 sel.disabled=!allowed.length;sel.setAttribute("aria-label",allowed.length?"Agenda do profissional":"Nenhuma agenda disponível");
 if([...sel.options].some(o=>o.value===old))sel.value=old;else if(sel.options[0])sel.value=sel.options[0].value
}
function renderAppointmentOptions(){
 const owner=selectedProf(),doctorId=owner?.category==="doctor"?owner.id:($("relatedProfessional")?.value||"");
 const ps=$("appointmentPatient"),op=ps.value,available=state.patients.filter(p=>!doctorId||p.doctorId===doctorId),optional=owner?.category==="anesthetist";ps.required=!optional;ps.innerHTML=(optional?'<option value="">Paciente ainda não informado</option>':"")+available.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");if([...ps.options].some(o=>o.value===op))ps.value=op;else ps.value=optional?"":(available[0]?.id||"");
 const insuranceOptions=[...new Set(state.patients.map(p=>p.insurance?.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));$("appointmentInsuranceOptions").innerHTML=insuranceOptions.map(name=>`<option value="${esc(name)}"></option>`).join("");updateStandaloneInsuranceField();
 const hs=$("appointmentHospital"),oh=hs.value;hs.innerHTML=state.hospitals.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");if([...hs.options].some(o=>o.value===oh))hs.value=oh;
}
function updateStandaloneInsuranceField(){const input=$("appointmentInsurance"),show=selectedProf()?.category==="anesthetist"&&!$("appointmentPatient").value;$("appointmentInsuranceLabel").classList.toggle("hidden",!show);input.required=show;if(!show&&$("appointmentPatient").value)input.value=""}
function daysUntil(dateString){
 if(!dateString)return null;const today=parseDate(ds(new Date())),target=parseDate(dateString);return Math.ceil((target-today)/86400000)
}
function renderGuideAlerts(){
 const owner=selectedProf();if(!owner){$("guideAlert").dataset.count="0";$("guideAlert").classList.add("hidden");return}
 const relevant=state.appointments.filter(a=>(owner.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner.id)&&a.status!=="cancelled"&&a.guideExpiry)
  .map(a=>({a,days:daysUntil(a.guideExpiry)})).filter(x=>x.days!==null&&x.days>=0&&x.days<=5).sort((x,y)=>x.days-y.days);
 $("guideAlert").dataset.count=String(relevant.length);if(!relevant.length){$("guideAlert").classList.add("hidden");return}
 $("guideAlertList").innerHTML=relevant.map(({a,days})=>`<button type="button" class="notification-item" data-alert-appointment="${a.id}">Guia do paciente <strong>${esc(patient(a.patientId)?.name||"Paciente")}</strong> — ${days===0?"vence hoje":`vence em ${days} dia(s)`} (${parseDate(a.guideExpiry).toLocaleDateString("pt-BR")}) · ${esc(a.procedure||"Procedimento")}</button>`).join("");
 $("guideAlert").classList.remove("hidden")
}
function renderOperationalAlerts(){
 const owner=selectedProf(),today=ds(new Date());
 if(!owner){["invoiceAlert","missingGuideAlert","confirmationAlert"].forEach(id=>$(id).classList.add("hidden"));return}
 const belongs=a=>owner.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner.id;
 const rows=state.appointments.filter(belongs),name=a=>patient(a.patientId)?.name||prof(a.doctorId)?.name||"Agendamento",summary=a=>`<strong>${esc(name(a))}</strong> — ${parseDate(a.date).toLocaleDateString("pt-BR")} às ${esc(a.time)} · ${esc(a.procedure||"Procedimento")}`;
 const show=(boxId,listId,items,detail)=>{const box=$(boxId);box.dataset.count=String(items.length);if(!items.length){box.classList.add("hidden");return}$(listId).innerHTML=items.map(a=>`<button type="button" class="notification-item" data-alert-appointment="${a.id}">${summary(a)}${detail(a)}</button>`).join("");box.classList.remove("hidden")};
 show("invoiceAlert","invoiceAlertList",rows.filter(a=>a.status==="realized"&&!a.invoiceNumber&&daysUntil(a.date)<=-1),()=>" · NF não informada");
 show("missingGuideAlert","missingGuideAlertList",rows.filter(a=>a.date>=today&&!a.guideExpiry),()=>" · informe o vencimento da guia");
 show("confirmationAlert","confirmationAlertList",rows.filter(a=>{const days=daysUntil(a.date);return days!==null&&days>=0&&days<=2&&!["confirmed","authorized","realized"].includes(a.status)}),a=>` · atendimento em ${daysUntil(a.date)===0?"hoje":daysUntil(a.date)===1?"1 dia":"2 dias"}`);
}
function updateNotificationCenter(){
 const alerts=["invoiceAlert","missingGuideAlert","confirmationAlert","guideAlert"],total=alerts.reduce((sum,id)=>sum+Number($(id).dataset.count||0),0),badge=$("notificationCount");badge.textContent=total>99?"99+":String(total);badge.classList.toggle("hidden",!total);$("notificationSummary").textContent=total?`${total} pendência${total===1?"":"s"}`:"Nenhuma pendência";$("notificationEmpty").classList.toggle("hidden",!!total);qsa("[data-alert-appointment]").forEach(button=>button.onclick=()=>{closeNotificationPanel();openAppointment(button.dataset.alertAppointment)})
}
function closeNotificationPanel(){$("notificationPanel").classList.add("hidden");$("notificationBell").setAttribute("aria-expanded","false")}
function toggleNotificationPanel(){const opening=$("notificationPanel").classList.contains("hidden");$("notificationPanel").classList.toggle("hidden",!opening);$("notificationBell").setAttribute("aria-expanded",String(opening))}
function dayConflictCount(day,appointments){
 const apps=appointments.filter(a=>a.date===day&&a.status!=="cancelled"),ids=new Set();
 apps.forEach(a=>apps.forEach(b=>{if(a.id!==b.id&&mins(a.time)<mins(b.time)+Number(b.duration||0)&&mins(a.time)+Number(a.duration||0)>mins(b.time)){ids.add(a.id);ids.add(b.id)}}));
 return ids.size;
}
function surgeonColor(id){const palette=["#dff4ef","#e8efff","#fff0d9","#f2e8ff","#ffe6ec","#e4f4ff","#edf4dc"];let n=0;for(const c of String(id||""))n=(n*31+c.charCodeAt(0))>>>0;return palette[n%palette.length]}
function renderCalendar(){
 const owner=selectedProf();if(!owner){$("calendar").innerHTML='<div class="empty">Cadastre um profissional.</div>';return}
 $("agendaOwnerDisplay").innerHTML=`<div><strong>${esc(owner.name)}${owner.crm?` <span class="crm">- CRM: ${esc(owner.crm)}</span>`:""}</strong><span class="agenda-specialty">${esc(owner.specialty||"Sem especialidade")}</span></div>`;
 renderGuideAlerts();renderOperationalAlerts();updateNotificationCenter();
 const days=calendarMode==="week"?Array.from({length:7},(_,i)=>addDays(currentDate,i)):[new Date(currentDate)];
 $("periodLabel").textContent=calendarMode==="week"?currentDate.toLocaleDateString("pt-BR",{month:"long",year:"numeric"}):currentDate.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"});
 $("periodRange").textContent=calendarMode==="week"?`${days[0].toLocaleDateString("pt-BR")} — ${days.at(-1).toLocaleDateString("pt-BR")}`:currentDate.toLocaleDateString("pt-BR");
 let start=mins(state.settings.workStart),end=mins(state.settings.workEnd);
 const visible=state.appointments.filter(a=>owner.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner.id).filter(a=>!$("statusFilter").value||a.status===$("statusFilter").value);
 const visibleDays=new Set(days.map(d=>ds(d)));
 const relevantAppointments=state.appointments.filter(a=>visibleDays.has(a.date)&&(owner.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner.id));
 const relevantBlocks=state.scheduleBlocks.filter(b=>visibleDays.has(b.date)&&b.professionalId===owner.id);
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
 const conflictDays=new Map(days.map(d=>[ds(d),owner.category==="anesthetist"?dayConflictCount(ds(d),visible):0]));
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
   const ownerBlocks=blocksForProfessional(owner.id,day).filter(b=>mins(b.start)>=hour&&mins(b.start)<hour+60);
   ownerBlocks.forEach(b=>{
     const top=Math.max(2,((mins(b.start)-hour)/60)*64+2),height=Math.max(28,((mins(b.end)-mins(b.start))/60)*64-4);
     html+=`<button class="schedule-block" data-block-id="${b.id}" style="top:${top}px;height:${height}px"><strong>${esc(b.start)} - ${esc(b.end)}</strong><span>${esc(b.reason)}</span></button>`;
   });
   if(owner.category==="anesthetist"&&apps.length){
    apps.forEach((a,idx)=>{
     const overlaps=apps.filter(b=>a.id!==b.id&&mins(a.time)<mins(b.time)+b.duration&&mins(a.time)+a.duration>mins(b.time));const total=Math.max(1,1+overlaps.length);if(total>1)conflicts++;
     const width=`calc(${100/total}% - 8px)`,left=`calc(${(100/total)*Math.min(idx,total-1)}% + 4px)`;html+=appointmentCard(a,hour,total>1?`left:${left};right:auto;width:${width};`:"",total>1)
    })
   }else apps.forEach(a=>html+=appointmentCard(a,hour,"",false));
   html+="</div>"
  }
 }html+="</div>";$("calendar").innerHTML=html;
 const c=$("conflictSummary"),alert=$("anesthesiaConflictAlert");c.classList.add("hidden");if(owner.category==="anesthetist"&&conflicts){$("anesthesiaConflictList").innerHTML=[...conflictDays].filter(([,count])=>count).map(([day,count])=>`<p><strong>${parseDate(day).toLocaleDateString("pt-BR")}</strong> — ${count} atendimento(s) em conflito. Revise os horários antes de confirmar a agenda.</p>`).join("");alert.classList.remove("hidden")}else{alert?.classList.add("hidden")}
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
     if(owner?.category==="doctor"){
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
function appointmentCard(a,hour,extra,conflict){
 const p=patient(a.patientId),h=hospital(a.hospitalId),top=Math.max(3,((mins(a.time)-hour)/60)*64+3),height=Math.max(36,(a.duration/60)*64-6);
 const endTime=hhmm(mins(a.time)+Number(a.duration||0));
 const hospitalCode=hospitalAcronym(h?.name||"Hospital");
 const surgeon=prof(a.doctorId),isAnesthetist=selectedProf()?.category==="anesthetist",insurance=p?.insurance||a.insurance||"Sem convênio";
 return `<button class="appointment ${a.status} ${conflict?"anesthesia-conflict":""}" data-id="${a.id}" style="top:${top}px;height:${height}px;background:${isAnesthetist?surgeonColor(a.doctorId):""};${extra}">
 <strong>${esc(hospitalCode)}: <b>${esc(a.time)} - ${esc(endTime)}</b></strong>
 ${p?`<span class="appointment-patient">${esc(p.name)}</span>`:""}
 <span class="appointment-insurance">${esc(insurance)}</span>
 <span class="appointment-procedure">${esc(a.procedure||"Procedimento")}</span>
 ${isAnesthetist?`<span class="appointment-surgeon">${esc(surgeon?.name||"Cirurgião não informado")}</span>`:""}
 <span class="appointment-status-badge ${esc(a.status)}">${esc(statusLabel(a.status))}</span></button>`
}
function renderPatients(){
 const auth=window.AgendaAuth||{},owner=selectedProf(),t=$("patientSearch").value.toLowerCase().trim(),allowed=auth.role==="doctor"?state.patients.filter(p=>(auth.agendaIds||[]).includes(p.doctorId)):owner?.category==="doctor"?state.patients.filter(p=>p.doctorId===owner.id):state.patients;
 const rows=allowed.filter(p=>`${p.name} ${p.phone} ${p.email} ${p.insurance} ${p.cardNumber}`.toLowerCase().includes(t));
 $("patientsTableWrap").innerHTML=rows.length?`<table class="table"><thead><tr><th>Nome</th><th>Médico</th><th>Convênio</th><th>Carteirinha</th><th>Telefone</th><th>Histórico</th>${auth.role==="doctor"?"":"<th></th>"}</tr></thead><tbody>${rows.map(p=>`<tr><td><button class="patient-name-btn" data-detail="${p.id}">${esc(p.name)}</button></td><td>${esc(prof(p.doctorId)?.name||"—")}</td><td>${esc(p.insurance||"—")}</td><td>${esc(p.cardNumber||"—")}</td><td>${esc(p.phone||"—")}</td><td>${state.patientHistory.filter(h=>h.patientId===p.id).length} evento(s)</td>${auth.role==="doctor"?"":`<td><button class="link-btn" data-patient="${p.id}">Editar</button></td>`}</tr>`).join("")}</tbody></table>`:'<div class="empty">Nenhum paciente encontrado.</div>';
 qsa("[data-patient]").forEach(b=>b.onclick=()=>openPatient(b.dataset.patient));qsa("[data-detail]").forEach(b=>b.onclick=()=>openPatientDetail(b.dataset.detail))
}
function renderSettings(){
 $("professionalsList").innerHTML=state.professionals.map(p=>`<div class="prof-card"><div class="prof-left" style="cursor:pointer;flex:1" data-edit-prof="${p.id}"><div class="prof-avatar">${esc(p.name.charAt(0))}</div><div class="prof-meta"><strong>${esc(p.name)}<span class="category-badge">${p.category==="anesthetist"?"Anestesista":"Cirurgião"}</span></strong><span>${p.crm?`CRM: ${esc(p.crm)} · `:""}${esc(p.specialty||"Sem especialidade")}</span></div></div><div class="rule-actions"><button class="tiny-btn" data-edit-prof-btn="${p.id}">Editar</button><button class="link-btn" data-rprof="${p.id}">Remover</button></div></div>`).join("");
 $("hospitalsList").innerHTML=state.hospitals.map(h=>`<div class="hospital-card"><div class="prof-left"><div class="hospital-icon">H</div><div class="prof-meta"><strong>${esc(h.name)}</strong><span>Disponível para todos</span></div></div><button class="link-btn" data-rhospital="${h.id}">Remover</button></div>`).join("")||'<div class="empty">Nenhum hospital cadastrado.</div>';
 qsa("[data-edit-prof]").forEach(b=>b.onclick=()=>openProfessional(b.dataset.editProf));
 qsa("[data-edit-prof-btn]").forEach(b=>b.onclick=e=>{e.stopPropagation();openProfessional(b.dataset.editProfBtn)});
 qsa("[data-rprof]").forEach(b=>b.onclick=async e=>{e.stopPropagation();if(state.appointments.some(a=>a.doctorId===b.dataset.rprof||a.anesthetistId===b.dataset.rprof))return appNotice("Profissional em uso","Esse profissional possui agendamentos e não pode ser removido.");if(!await appConfirm("Remover profissional","O cadastro será removido das opções disponíveis.","Remover",true))return;state.professionals=state.professionals.filter(p=>p.id!==b.dataset.rprof);persist()});
 qsa("[data-rhospital]").forEach(b=>b.onclick=async()=>{if(state.appointments.some(a=>a.hospitalId===b.dataset.rhospital))return appNotice("Hospital em uso","Esse hospital está vinculado a agendamentos e não pode ser removido.");if(!await appConfirm("Remover hospital","O hospital será removido das opções disponíveis.","Remover",true))return;state.hospitals=state.hospitals.filter(h=>h.id!==b.dataset.rhospital);persist()})
}

function renderRules(){
 const surgeonSelect=$("rulesProfessionalFilter"),old=surgeonSelect.value;
 const surgeons=state.professionals.filter(p=>p.category==="doctor");
 surgeonSelect.innerHTML=surgeons.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
 if([...surgeonSelect.options].some(o=>o.value===old))surgeonSelect.value=old;else if(surgeonSelect.options[0])surgeonSelect.value=surgeonSelect.options[0].value;
 const pid=surgeonSelect.value,showAll=$("rulesStatusFilter").value==="all";
 const rules=state.schedulingRules.filter(r=>r.professionalId===pid&&(showAll||r.enabled!==false));
 $("rulesList").innerHTML=rules.length?rules.map(r=>`<div class="rule-card ${r.enabled===false?"rule-disabled":""}"><div class="rule-main"><strong>${esc(r.name)}<span class="rule-severity ${esc(r.severity||"warning")}">${r.severity==="preference"?"Preferência":r.severity==="block"?"Bloqueio":"Aviso"}</span></strong><span>${esc(formatRuleSummary(r))}</span></div><div class="rule-actions"><button class="tiny-btn" data-toggle-rule="${r.id}">${r.enabled===false?"Ativar":"Desativar"}</button><button class="tiny-btn" data-edit-rule="${r.id}">Editar</button></div></div>`).join(""):'<div class="empty">Nenhuma regra cadastrada para este cirurgião.</div>';
 qsa("[data-edit-rule]").forEach(b=>b.onclick=()=>openRule(b.dataset.editRule));
 qsa("[data-toggle-rule]").forEach(b=>b.onclick=()=>{const r=state.schedulingRules.find(x=>x.id===b.dataset.toggleRule);if(r){r.enabled=r.enabled===false?true:false;persist();toast(r.enabled?"Regra ativada.":"Regra desativada.")}})
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
async function renderAccess(){if((window.AgendaAuth||{}).role!=="general_manager")return;const response=await fetch("/api/access");if(!response.ok)return;accessUsers=(await response.json()).users||[];$("accessList").innerHTML=accessUsers.map(u=>`<div class="access-card"><div><strong>${esc(accountName(u))}</strong><span>${esc(u.email)} · ${roleLabel(u.role)}</span><small>${esc(accessAgendaLabel(u))}</small></div><button class="tiny-btn" data-access-user="${u.id}">Editar</button></div>`).join("");qsa("[data-access-user]").forEach(b=>b.onclick=()=>openAccess(Number(b.dataset.accessUser)))}
function openAccess(id=null){const u=accessUsers.find(x=>x.id===id);$("accessForm").reset();$("accessId").value=u?.id||"";$("accessEmail").value=u?.email||"";$("accessName").value=u?.name||"";$("accessPassword").value="";$("accessPassword").required=!u;$("accessRole").value=u?.role||"secretary";$("accessEmail").disabled=u?.email===(window.AgendaAuth||{}).email;$("deleteAccessBtn").classList.toggle("hidden",!u||u.email===(window.AgendaAuth||{}).email);$("accessAgendaChoices").innerHTML=state.professionals.map(p=>`<label><input type="checkbox" value="${p.id}" ${(u?.agendaIds||[]).includes(p.id)?"checked":""}><span>${esc(p.name)}</span></label>`).join("");const toggle=()=>$("accessAgendaChoices").classList.toggle("hidden",$("accessRole").value==="general_manager");$("accessRole").onchange=toggle;toggle();openModal("accessModal")}
function initWorkflowUI(){
 document.querySelector(".nav").insertAdjacentHTML("beforeend",'<button class="nav-item workflow-reviewer" data-view="requests">✓ Solicitações <span id="requestBadge" class="nav-badge hidden">0</span></button><button class="nav-item doctor-only" data-view="notifications">◌ Notificações <span id="notificationBadge" class="nav-badge hidden">0</span></button><button class="nav-item manager-only" data-view="audit">☷ Histórico</button>');
 document.querySelector(".main").insertAdjacentHTML("beforeend",'<section id="cancelledView" class="view"><div class="content-card"><div class="section-head"><div><h2>Pacientes cancelados</h2><p>Atendimentos cancelados organizados por mês.</p></div></div><div id="cancelledList" class="workflow-list"></div></div></section><section id="requestsView" class="view workflow-reviewer"><div class="content-card"><div class="section-head"><div><h2>Solicitações de agenda</h2><p>Sugestões enviadas pelos médicos para sua aprovação.</p></div><select id="requestStatusFilter"><option value="pending">Pendentes</option><option value="all">Todas</option></select></div><div id="requestList" class="workflow-list"></div></div></section><section id="notificationsView" class="view doctor-only"><div class="content-card"><div class="section-head"><div><h2>Notificações</h2><p>Acompanhe o retorno das suas sugestões.</p></div><button id="markNotificationsRead" class="secondary-btn">Marcar como lidas</button></div><div id="notificationList" class="workflow-list"></div></div></section><section id="auditView" class="view manager-only"><div class="content-card"><div class="section-head"><div><h2>Histórico geral</h2><p>Registro de tudo que acontece em todas as agendas.</p></div><button id="refreshAudit" class="secondary-btn">Atualizar</button></div><div id="auditList" class="workflow-list audit-list"></div></div></section>');
 $("agendaView").insertAdjacentHTML("afterbegin",'<div id="anesthesiaConflictAlert" class="alert-strip conflict-alert hidden"><div>⚠</div><div><strong>Conflitos na agenda do anestesista</strong><div id="anesthesiaConflictList" class="alert-list"></div></div></div>');
 const pageHeading=document.querySelector(".topbar > div:first-child");pageHeading.classList.add("report-heading");pageHeading.innerHTML='<div class="agenda-report-row"><button id="agendaReportBtn" class="secondary-btn">Gerar relatório mensal</button><button id="cancelledPageBtn" class="secondary-btn">Cancelados</button></div>';
 $("guideExpiry").closest("label").insertAdjacentHTML("afterend",'<label>Valor pago<input id="appointmentPayment" type="number" min="0" step="0.01" placeholder="0,00"></label><label>Número da NF<input id="appointmentInvoice" placeholder="Ex.: 12345"></label>');
 $("saveAppointmentBtn").insertAdjacentHTML("beforebegin",'<button id="editAppointmentBtn" type="button" class="secondary-btn hidden">Editar agendamento</button>');
 $("appointmentForm").insertAdjacentHTML("afterbegin",'<section id="appointmentDetailView" class="appointment-detail hidden" aria-live="polite"></section>');
 $("patientName").closest("label").insertAdjacentHTML("beforebegin",'<label>Médico responsável<select id="patientDoctor" required></select></label>');
 $("requestStatusFilter").onchange=renderWorkflow;$("refreshAudit").onclick=refreshWorkflow;$("markNotificationsRead").onclick=async()=>{await fetch("/api/workflow",{method:"DELETE"});await refreshWorkflow()};
 $("agendaReportBtn").onclick=generateMonthlyReport;$("cancelledPageBtn").onclick=()=>showView("cancelled");$("editAppointmentBtn").onclick=enableAppointmentEdit;
 $("systemDialogConfirm").onclick=()=>finishAppDialog(true);qsa("[data-dialog-cancel]").forEach(b=>b.onclick=()=>finishAppDialog(false));
 $("cancelReasonSelect").onchange=()=>$("cancelReasonOtherLabel").classList.toggle("hidden",$("cancelReasonSelect").value!=="Outro");
}
function workflowDate(value){return value?new Date(value).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"—"}
function workflowAppointment(a){if(!a)return null;const p=patient(a.patientId),h=hospital(a.hospitalId),place=hospitalAcronym(h?.name||""),reason=a.status==="rescheduled"&&a.rescheduleReason?` · Motivo: ${a.rescheduleReason}`:"";return {a,p,line:`${a.date||"—"} às ${a.time||"—"} · ${a.procedure||"Procedimento"}${place?` no ${place}`:""} · ${statusLabel(a.status||"scheduled")}${reason}`}}
function workflowRequestTitle(r){const requester=doctorName(r.requesterName||"Médico");if(r.action==="create")return `${requester} enviou um agendamento.`;if(r.action==="delete")return `${requester} sugeriu um desagendamento.`;return `${requester} sugeriu uma alteração.`}
function workflowChangeRows(r){const previous=workflowAppointment(r.previous),proposed=r.action==="delete"?null:workflowAppointment(r.proposed);return `${previous?`<div class="workflow-change from"><span class="workflow-change-label">De:</span><span class="workflow-arrow" aria-hidden="true">≫</span><span>${esc(previous.line)}</span></div>`:""}${proposed?`<div class="workflow-change to"><span class="workflow-change-label">Para:</span><span class="workflow-arrow" aria-hidden="true">≪</span><span>${esc(proposed.line)}</span></div>`:""}${r.action==="delete"&&r.proposed?.cancelReason?`<div class="workflow-cancel-reason"><strong>Motivo:</strong> ${esc(r.proposed.cancelReason)}</div>`:""}`}
async function refreshWorkflow(){const response=await fetch("/api/workflow");if(!response.ok)return;workflowData=await response.json();renderWorkflow()}
function renderWorkflow(){
 const pending=(workflowData.requests||[]).filter(r=>r.status==="pending");if($("requestBadge")){ $("requestBadge").textContent=pending.length;$("requestBadge").classList.toggle("hidden",!pending.length) }
 const unread=(workflowData.notifications||[]).filter(n=>!n.readAt);if($("notificationBadge")){ $("notificationBadge").textContent=unread.length;$("notificationBadge").classList.toggle("hidden",!unread.length) }
 if($("requestList")){const rows=$("requestStatusFilter").value==="all"?(workflowData.requests||[]):pending;$("requestList").innerHTML=rows.length?rows.map(r=>`<article class="workflow-card"><div class="workflow-card-main"><div class="workflow-heading"><span class="workflow-status ${r.status}">${r.status==="pending"?"Pendente":r.status==="accepted"?"Aceita":"Negada"}</span><strong>${esc(workflowRequestTitle(r))}</strong></div><div class="workflow-changes">${workflowChangeRows(r)}</div><small>Enviada em ${workflowDate(r.createdAt)}${r.deciderName?` · decisão por ${esc(r.deciderName)}`:""}</small></div>${r.status==="pending"?`<div class="workflow-actions"><button class="secondary-btn" data-deny-request="${r.id}">Negar</button><button class="primary-btn" data-accept-request="${r.id}">Aceitar</button></div>`:""}</article>`).join(""):'<div class="empty">Nenhuma solicitação nesta lista.</div>';qsa("[data-accept-request]").forEach(b=>b.onclick=()=>decideRequest(b.dataset.acceptRequest,"accepted"));qsa("[data-deny-request]").forEach(b=>b.onclick=()=>decideRequest(b.dataset.denyRequest,"denied"))}
 if($("notificationList"))$("notificationList").innerHTML=(workflowData.notifications||[]).length?(workflowData.notifications||[]).map(n=>`<article class="notification-card ${n.readAt?"":"unread"}"><strong>${esc(n.message)}</strong><span>${workflowDate(n.createdAt)}</span></article>`).join(""):'<div class="empty">Nenhuma notificação.</div>';
 if($("auditList"))$("auditList").innerHTML=(workflowData.audit||[]).length?(workflowData.audit||[]).map(a=>`<article class="audit-card"><div class="audit-dot"></div><div><strong>${esc(a.description)}</strong>${a.before||a.after?`<div class="workflow-changes">${workflowChangeRows({previous:a.before,proposed:a.after,action:a.action==="appointment_cancelled"?"delete":""})}</div>`:""}<span>${esc(roleLabel(a.actorRole))} · ${workflowDate(a.createdAt)}</span></div></article>`).join(""):'<div class="empty">Nenhuma atividade registrada.</div>'
}
async function decideRequest(id,decision){let note="";if(decision==="denied"){const ok=await appConfirm("Negar solicitação","A solicitação será mantida no histórico e o médico receberá uma notificação.","Negar",true);if(!ok)return}const response=await fetch("/api/workflow",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,decision,note})});const result=await response.json();if(!response.ok)return appNotice("Não foi possível concluir",result.error||"Tente novamente.");const stateResponse=await fetch("/api/state");if(stateResponse.ok){const resultState=await stateResponse.json();if(resultState.state){state=Storage.migrate(resultState.state);localStorage.setItem(Storage.key,JSON.stringify(state));renderAll()}}await refreshWorkflow();toast(result.message)}
async function sendAgendaSuggestion(action,appointment,appointmentId){const response=await fetch("/api/workflow",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,appointment,appointmentId})});const result=await response.json();if(!response.ok){await appNotice("Não foi possível enviar",result.error||"Tente novamente.");return false}await refreshWorkflow();toast(result.message||"Alteração de agenda enviada.");return true}
function applyRoleRestrictions(){const auth=window.AgendaAuth||{},manager=auth.role==="general_manager",doctor=auth.role==="doctor",displayName=accountName(auth);qsa(".manager-only").forEach(el=>el.classList.toggle("hidden",!manager));qsa(".doctor-only").forEach(el=>el.classList.toggle("hidden",!doctor));qsa(".workflow-reviewer").forEach(el=>el.classList.toggle("hidden",doctor));$("newBlockBtn").classList.toggle("hidden",!manager);$("exportBtn").classList.toggle("hidden",!manager);$("importInput").closest("label").classList.toggle("hidden",!manager);$("newPatientBtn").classList.toggle("hidden",doctor);$("editPatientFromDetail").classList.toggle("hidden",doctor);$("sessionName").textContent=displayName;$("sessionRole").textContent=roleLabel(auth.role);$("sessionAvatar").textContent=String(displayName).replace(/^Dr\.?\s*/i,"").trim().charAt(0).toUpperCase();if(manager)renderAccess();refreshWorkflow()}
function renderCancelled(){if(!$("cancelledList"))return;const owner=selectedProf(),rows=(state.cancelledAppointments||[]).filter(a=>(owner?.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner?.id)).sort((a,b)=>b.date.localeCompare(a.date)),groups={};rows.forEach(a=>{const key=a.date.slice(0,7);(groups[key]||=[]).push(a)});$("cancelledList").innerHTML=Object.entries(groups).map(([month,items])=>`<section class="cancel-month"><h3>${parseDate(month+"-01").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</h3><table class="table"><thead><tr><th>Paciente</th><th>Data</th><th>Horário</th><th>Cancelado em</th><th>Motivo</th><th>Valor</th><th>NF</th></tr></thead><tbody>${items.map(a=>`<tr><td>${esc(patient(a.patientId)?.name||"Paciente")}</td><td>${parseDate(a.date).toLocaleDateString("pt-BR")}</td><td>${esc(a.time)}</td><td>${a.cancelledAt?workflowDate(a.cancelledAt):"—"}</td><td>${esc(a.cancelReason||"Não informado")}</td><td>${money(a.payment)}</td><td>${esc(a.invoiceNumber||"—")}</td></tr>`).join("")}</tbody></table></section>`).join("")||'<div class="empty">Nenhum cancelamento nesta agenda.</div>'}
function money(v){return Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function generateMonthlyReport(){
 const owner=selectedProf(),isAnesthetist=owner.category==="anesthetist",month=(calendarMode==="week"?currentDate:new Date(currentDate)),key=`${month.getFullYear()}-${pad(month.getMonth()+1)}`;
 const belongs=a=>(isAnesthetist?a.anesthetistId===owner.id:a.doctorId===owner.id)&&a.date.startsWith(key),active=state.appointments.filter(belongs),cancelled=(state.cancelledAppointments||[]).filter(belongs);
 const surgeonHead=isAnesthetist?"<th>Cirurgião</th>":"",surgeonCell=a=>isAnesthetist?`<td>${esc(prof(a.doctorId)?.name||"Não informado")}</td>`:"";
 const table=items=>items.length?`<table><thead><tr><th>Paciente</th>${surgeonHead}<th>Data</th><th>Horário</th><th>Procedimento</th><th>Valor pago</th><th>NF</th></tr></thead><tbody>${items.map(a=>`<tr><td>${esc(patient(a.patientId)?.name||"—")}</td>${surgeonCell(a)}<td>${parseDate(a.date).toLocaleDateString("pt-BR")}</td><td>${esc(a.time)}</td><td>${esc(a.procedure||"—")}</td><td>${money(a.payment)}</td><td>${esc(a.invoiceNumber||"—")}</td></tr>`).join("")}</tbody></table>`:"<p>Nenhum registro.</p>";
 const cancelTable=cancelled.length?`<table><thead><tr><th>Paciente</th>${surgeonHead}<th>Data agendada</th><th>Horário</th><th>Cancelado em</th><th>Motivo</th><th>Valor</th><th>NF</th></tr></thead><tbody>${cancelled.map(a=>`<tr><td>${esc(patient(a.patientId)?.name||"—")}</td>${surgeonCell(a)}<td>${parseDate(a.date).toLocaleDateString("pt-BR")}</td><td>${esc(a.time)}</td><td>${a.cancelledAt?workflowDate(a.cancelledAt):"—"}</td><td>${esc(a.cancelReason||"Não informado")}</td><td>${money(a.payment)}</td><td>${esc(a.invoiceNumber||"—")}</td></tr>`).join("")}</tbody></table>`:"<p>Nenhum cancelamento.</p>",w=open("","_blank");
 w.document.write(`<!doctype html><html><head><title>Relatório ${esc(owner.name)} - ${key}</title><style>@page{size:A4;margin:16mm}body{font:12px Arial;color:#183044}h1{font-size:22px}h2{margin-top:24px;color:#087f82}header{position:relative;border-bottom:3px solid #0ea5a4;padding:0 82px 12px 0}.report-logo{position:absolute;right:0;top:0;width:58px;height:58px;object-fit:contain;border-radius:12px}.summary{display:flex;gap:12px;margin:18px 0}.summary b{padding:12px;background:#eef8f8;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #dce5ea;text-align:left}th{background:#f3f7f9}small{color:#60717d}</style></head><body><header><img class="report-logo" src="/agenda-rn-icon.jpg" alt="Agenda RN"><h1>Relatório mensal da agenda</h1><strong>${esc(owner.name)}</strong><br><small>${month.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</small></header><div class="summary"><b>${active.length+cancelled.length} agendamento(s)</b><b>${cancelled.length} cancelamento(s)</b></div><h2>Atendimentos agendados</h2>${table(active)}<h2>Cancelamentos</h2>${cancelTable}<script>onload=()=>print()<\/script></body></html>`);w.document.close()
}
function renderAll(){renderProfessionalOptions();renderAppointmentOptions();renderCalendar();renderPatients();renderCancelled();renderSettings();renderRules();if((window.AgendaAuth||{}).role==="general_manager")renderAccess()}
let lastFocusedElement=null;
function openModal(id){lastFocusedElement=document.activeElement;const modal=$(id);$("modalBackdrop").classList.remove("hidden");modal.classList.remove("hidden");modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");requestAnimationFrame(()=>modal.querySelector("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not([data-close])")?.focus())}
function closeModals(){$("modalBackdrop").classList.add("hidden");qsa(".modal").forEach(m=>m.classList.add("hidden"));if(systemDialogResolve){const done=systemDialogResolve;systemDialogResolve=null;done(false)}if(lastFocusedElement?.isConnected)lastFocusedElement.focus();lastFocusedElement=null}
function renderHistory(pid,target,limit=999){
 const list=state.patientHistory.filter(h=>h.patientId===pid).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit);
 $(target).innerHTML=list.length?list.map(h=>`<div class="history-item"><strong>${esc(h.type)}</strong><span>${esc(h.text)}</span><span>${new Date(h.at).toLocaleString("pt-BR")}</span></div>`).join(""):'<div class="history-empty">Nenhum histórico registrado ainda.</div>'
}
function updatePatientSide(){
 const p=patient($("appointmentPatient").value),optional=selectedProf()?.category==="anesthetist";$("patientSideName").textContent=p?.name||(optional?"Paciente não informado":"Selecione um paciente");$("patientSidePhone").textContent=p?.phone||"—";$("patientSideEmail").textContent=p?.email||"—";$("patientSideInsurance").textContent=p?.insurance||"—";$("patientSideCard").textContent=p?.cardNumber||"—";$("patientAvatar").textContent=p?.name?.charAt(0).toUpperCase()||"—";renderHistory(p?.id,"patientHistory",12)
}
function setFlag(id,val){$(id).checked=!!val;document.querySelector(`[data-state-for="${id}"]`).textContent=val?"Sim":"Não"}
const APPOINTMENT_STATUSES=["scheduled","confirmed","authorized","analysis","realized"];
function appointmentStatusLabel(status){return statusLabel(status)}
function appointmentStatusOptions(current){return APPOINTMENT_STATUSES.map(status=>`<option value="${status}" ${status===current?"selected":""}>${statusLabel(status)}</option>`).join("")}
async function applyAppointmentStatus(id,status,reason=""){
 const a=state.appointments.find(x=>x.id===id);if(!a||a.status===status)return;
 const previous=a.status,updated={...a,status,rescheduleReason:status==="rescheduled"?reason:(a.rescheduleReason||""),statusUpdatedAt:new Date().toISOString()};
 if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("update",updated,id);if($("appointmentStatusSelect"))$("appointmentStatusSelect").value=previous;if(sent)toast("Alteração de status enviada para aprovação.");return}
 Object.assign(a,updated);hist(a.patientId,"Status alterado",`${statusLabel(previous)} → ${statusLabel(status)}${reason?` · Motivo: ${reason}`:""}`,id);persist();renderAppointmentDetail(a);toast(`Status alterado para ${statusLabel(status)}.`)
}
function requestAppointmentStatus(id,status){applyAppointmentStatus(id,status)}
function rescheduleLine(label,date,time,type){return `<div class="reschedule-line ${type}"><span>${label}</span><b aria-hidden="true">${type==="from"?"≫":"≪"}</b><strong>${date?parseDate(date).toLocaleDateString("pt-BR"):"—"} às ${esc(time||"—")}</strong></div>`}
function renderReschedulePreview(){const a=state.appointments.find(x=>x.id===$("rescheduleAppointmentId").value);if(!a)return;$("reschedulePreview").innerHTML=rescheduleLine("De",a.date,a.time,"from")+rescheduleLine("Para",$("rescheduleNewDate").value,$("rescheduleNewTime").value,"to")}
function openReschedule(id){const a=state.appointments.find(x=>x.id===id);if(!a)return;$("rescheduleReasonForm").reset();$("rescheduleAppointmentId").value=id;$("rescheduleNewDate").value=a.date;$("rescheduleNewDate").min=ds(new Date());$("rescheduleNewTime").value=a.time;renderReschedulePreview();openModal("rescheduleReasonModal")}
function renderRescheduleHistory(a){const rows=[...(a.rescheduleHistory||[])].reverse();if(!rows.length&&!a.rescheduleReason)return "";return `<section class="appointment-reschedule-history"><div class="reschedule-history-title"><span>Histórico deste agendamento</span><strong>${rows.length||1} reagendamento${(rows.length||1)===1?"":"s"}</strong></div>${rows.length?rows.map(item=>`<article>${rescheduleLine("De",item.fromDate,item.fromTime,"from")}${rescheduleLine("Para",item.toDate,item.toTime,"to")}<p><b>Motivo:</b> ${esc(item.reason||"Não informado")}</p><small>${item.createdAt?new Date(item.createdAt).toLocaleString("pt-BR"):""}</small></article>`).join(""):`<article><p><b>Motivo:</b> ${esc(a.rescheduleReason)}</p><small>Registro anterior preservado</small></article>`}</section>`}
function renderAppointmentDetail(a){
 const p=patient(a.patientId),h=hospital(a.hospitalId),doctor=prof(a.doctorId),anesthetist=prof(a.anesthetistId),end=hhmm(mins(a.time)+Number(a.duration||0));
 const flags=[["OPME",a.opme],["Laudos",a.reports],["Exames",a.exams]].map(([label,on])=>`<span class="detail-flag ${on?"active":""}">${label}: ${on?"Sim":"Não"}</span>`).join("");
 const heroName=p?.name||doctor?.name||"Cirurgião não informado",heroLabel=p?"Paciente":"Cirurgião",heroMeta=p?`${esc(p.insurance||"Sem convênio")}${p.phone?` · ${esc(p.phone)}`:""}`:`Paciente ainda não informado · ${esc(a.insurance||"Convênio não informado")}`;
 $("appointmentDetailView").innerHTML=`<div class="appointment-detail-hero"><div class="detail-avatar">${esc(heroName.charAt(0))}</div><div><span class="detail-eyebrow">${heroLabel}</span><h4>${esc(heroName)}</h4><p>${heroMeta}</p></div><span class="detail-status ${esc(a.status)}">${appointmentStatusLabel(a.status)}</span></div><div class="appointment-detail-time"><div><span>Data e horário</span><strong>${parseDate(a.date).toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</strong><b>${esc(a.time)} às ${esc(end)}</b></div><div><span>Hospital</span><strong>${esc(h?.name||"Hospital não informado")}</strong><b>${esc(a.procedure||"Procedimento")}</b></div></div><div class="appointment-detail-grid"><div class="detail-section"><span>Equipe</span><strong>${esc(doctor?.name||"Cirurgião não informado")}</strong><p>${anesthetist?`Anestesista: ${esc(anesthetist.name)}`:"Sem anestesista"}</p></div><div class="detail-section"><span>Financeiro</span><strong>${money(a.payment)}</strong><p>NF: ${esc(a.invoiceNumber||"Não informada")}</p></div><div class="detail-section"><span>Validade da guia</span><strong>${a.guideExpiry?parseDate(a.guideExpiry).toLocaleDateString("pt-BR"):"Não informada"}</strong><p>${a.careType==="inpatient"?"Internado":"Ambulatorial"}</p></div></div><div class="detail-docs">${flags}</div>${a.notes?`<div class="detail-notes"><span>Observações</span><p>${esc(a.notes)}</p></div>`:""}${renderRescheduleHistory(a)}<div class="appointment-status-editor"><label for="appointmentStatusSelect">Status do agendamento</label><div class="appointment-status-controls"><select id="appointmentStatusSelect" class="status-select ${esc(a.status)}">${appointmentStatusOptions(a.status)}</select><button id="rescheduleAppointmentBtn" type="button" class="secondary-btn">Reagendar</button></div></div><div class="appointment-detail-actions"><button type="button" class="secondary-btn" data-close>Fechar</button><button id="appointmentDetailEditBtn" type="button" class="primary-btn">${(window.AgendaAuth||{}).role==="doctor"?"Sugerir alteração":"Editar agendamento"}</button></div>`;
 $("appointmentStatusSelect").onchange=e=>requestAppointmentStatus(a.id,e.target.value);$("rescheduleAppointmentBtn").onclick=()=>openReschedule(a.id);$("appointmentDetailEditBtn").onclick=enableAppointmentEdit;qsa("#appointmentDetailView [data-close]").forEach(b=>b.onclick=closeModals);
}
function setAppointmentViewMode(viewing){$("appointmentModal").classList.toggle("appointment-view-mode",viewing);$("appointmentDetailView").classList.toggle("hidden",!viewing);document.querySelector("#appointmentForm > .appointment-layout").classList.toggle("hidden",viewing);qsa("#appointmentForm input:not(#appointmentId),#appointmentForm select:not(#appointmentStatusSelect),#appointmentForm textarea").forEach(el=>el.disabled=viewing);if($("appointmentStatusSelect"))$("appointmentStatusSelect").disabled=false;$("saveAppointmentBtn").classList.toggle("hidden",viewing);$("deleteAppointmentBtn").classList.toggle("hidden",viewing||!$("appointmentId").value);$("editAppointmentBtn").classList.add("hidden");$("appointmentModalTitle").textContent=viewing?"Detalhes do agendamento":($("appointmentId").value?"Editar agendamento":"Novo agendamento")}
function enableAppointmentEdit(){setAppointmentViewMode(false);$("appointmentProcedure").focus()}
function openAppointment(id=null,preset={},editImmediately=false){
 const owner=selectedProf();if(!owner)return appNotice("Profissional necessário","Cadastre um profissional para continuar.");if(owner.category!=="anesthetist"&&!state.patients.length)return appNotice("Paciente necessário","Cadastre um paciente para continuar.");if(!state.hospitals.length)return appNotice("Hospital necessário","Cadastre um hospital nas configurações.");
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
 if(owner.category==="anesthetist"){label.childNodes[0].textContent="Cirurgião";related.innerHTML=state.professionals.filter(p=>p.category==="doctor").map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");$("agendaContext").innerHTML=`Agenda de <strong>${esc(owner.name)}</strong> · anestesista selecionado automaticamente.`}
 else{label.childNodes[0].textContent="Anestesista";related.innerHTML='<option value="">Sem anestesista</option>'+state.professionals.filter(p=>p.category==="anesthetist").map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");$("agendaContext").innerHTML=`Agenda de <strong>${esc(owner.name)}</strong> · cirurgião selecionado automaticamente.`}
 if(id){
  const a=state.appointments.find(x=>x.id===id);if(!a)return;
  $("appointmentId").value=a.id;$("appointmentPatient").value=a.patientId;$("appointmentInsurance").value=a.insurance||"";$("appointmentProcedure").value=a.procedure||"";$("appointmentHospital").value=a.hospitalId;$("guideExpiry").value=a.guideExpiry||"";$("appointmentPayment").value=a.payment||"";$("appointmentInvoice").value=a.invoiceNumber||"";$("appointmentDate").value=a.date;$("appointmentTime").value=a.time;$("appointmentDuration").value=String(a.duration);$("appointmentNotes").value=a.notes||"";
  document.querySelector(`input[name="careType"][value="${a.careType||"outpatient"}"]`).checked=true;related.value=owner.category==="anesthetist"?a.doctorId:(a.anesthetistId||"");renderAppointmentOptions();$("appointmentPatient").value=a.patientId;
  setFlag("flagOpme",a.opme);setFlag("flagReports",a.reports);setFlag("flagExams",a.exams);$("deleteAppointmentBtn").classList.remove("hidden");renderAppointmentDetail(a)
 }else{
  $("appointmentPatient").value=owner.category==="anesthetist"?"":($("appointmentPatient").options[0]?.value||"");$("appointmentInsurance").value="";$("appointmentProcedure").value="";$("appointmentHospital").value=state.hospitals[0]?.id||"";$("guideExpiry").value="";$("appointmentPayment").value="";$("appointmentInvoice").value="";$("appointmentDate").value=preset.date||ds(new Date());$("appointmentTime").value=preset.time||"08:00";$("appointmentDuration").value="60";document.querySelector('input[name="careType"][value="outpatient"]').checked=true;setFlag("flagOpme",false);setFlag("flagReports",false);setFlag("flagExams",false)
 }if(owner.category!=="anesthetist"&&!$("appointmentPatient").value)$("appointmentPatient").value=$("appointmentPatient").options[0]?.value||"";updateStandaloneInsuranceField();updatePatientSide();validatePastDate();renderRuleFeedback();setAppointmentViewMode(!!id&&!editImmediately);openModal("appointmentModal")
}

function currentAppointmentDraft(){
 const owner=selectedProf();
 return {
   id:$("appointmentId").value||"",
   patientId:$("appointmentPatient").value,
   insurance:$("appointmentInsurance").value.trim(),
   procedure:$("appointmentProcedure").value.trim(),
   hospitalId:$("appointmentHospital").value,
   guideExpiry:$("guideExpiry").value,
   date:$("appointmentDate").value,
   time:$("appointmentTime").value,
   duration:Number($("appointmentDuration").value||60),
   status:state.appointments.find(a=>a.id===$("appointmentId").value)?.status||"scheduled",
   careType:document.querySelector('input[name="careType"]:checked')?.value||"outpatient",
   doctorId:owner?.category==="doctor"?owner.id:$("relatedProfessional").value,
   anesthetistId:owner?.category==="anesthetist"?owner.id:($("relatedProfessional").value||null)
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
 e.preventDefault();if(!validatePastDate())return;
 const owner=selectedProf(),id=$("appointmentId").value||crypto.randomUUID(),old=state.appointments.find(a=>a.id===id);
 const newStatus=old?.status||"scheduled";
 const a={id,patientId:$("appointmentPatient").value,insurance:$("appointmentInsurance").value.trim(),procedure:$("appointmentProcedure").value.trim(),hospitalId:$("appointmentHospital").value,guideExpiry:$("guideExpiry").value,payment:Number($("appointmentPayment").value||0),invoiceNumber:$("appointmentInvoice").value.trim(),date:$("appointmentDate").value,time:$("appointmentTime").value,duration:Number($("appointmentDuration").value),status:newStatus,careType:document.querySelector('input[name="careType"]:checked').value,opme:$("flagOpme").checked,reports:$("flagReports").checked,exams:$("flagExams").checked,notes:$("appointmentNotes").value.trim(),doctorId:owner.category==="doctor"?owner.id:$("relatedProfessional").value,anesthetistId:owner.category==="anesthetist"?owner.id:($("relatedProfessional").value||null)};
 
 if(owner.category!=="anesthetist"&&!a.patientId)return appNotice("Paciente necessário","Selecione o paciente do agendamento.");
 if(!a.doctorId)return appNotice("Cirurgião necessário","Selecione o cirurgião responsável.");
 const absoluteBlocks=getAbsoluteSchedulingBlocks(a);
 if(absoluteBlocks.length){
   return appNotice("Não é possível salvar",absoluteBlocks.map(x=>`${x.name}: ${x.text}`).join("\n"));
 }

 const ruleIssues=evaluateSchedulingRules(a);
 const blockingRules=ruleIssues.filter(x=>x.severity==="block");
 if(blockingRules.length)return appNotice("Agendamento bloqueado",blockingRules.map(x=>`${x.name}: ${x.text}`).join("\n"));
 const warningRules=ruleIssues.filter(x=>x.severity==="warning");
 if(warningRules.length&&!await appConfirm("Avisos do agendamento",warningRules.map(x=>`${x.name}: ${x.text}`).join("\n"),"Salvar mesmo assim"))return;

 if((window.AgendaAuth||{}).role==="doctor"){
   const sent=await sendAgendaSuggestion(old?"update":"create",a,old?.id||null);if(sent){closeModals();$("appointmentForm").reset()}return;
 }
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
 persist();closeModals();toast("Agendamento salvo.")
};
function openCancellation(id){const a=state.appointments.find(x=>x.id===id);if(!a)return;$("cancelAppointmentForm").reset();$("cancelAppointmentId").value=id;$("cancelReasonOtherLabel").classList.add("hidden");$("cancelAppointmentSummary").innerHTML=`<strong>${esc(patient(a.patientId)?.name||"Paciente")}</strong><br>${parseDate(a.date).toLocaleDateString("pt-BR")} às ${esc(a.time)} · ${esc(a.procedure)}`;closeModals();openModal("cancelAppointmentModal")}
$("deleteAppointmentBtn").onclick=()=>openCancellation($("appointmentId").value);
$("rescheduleNewDate").oninput=renderReschedulePreview;$("rescheduleNewTime").oninput=renderReschedulePreview;
$("rescheduleReasonForm").onsubmit=async e=>{e.preventDefault();const id=$("rescheduleAppointmentId").value,a=state.appointments.find(x=>x.id===id),reason=$("rescheduleReason").value.trim(),newDate=$("rescheduleNewDate").value,newTime=$("rescheduleNewTime").value;if(!a)return;if(!reason)return appNotice("Motivo necessário","Explique o motivo do reagendamento para manter o histórico completo.");if(!newDate||!newTime)return appNotice("Nova data necessária","Informe a nova data e o horário do atendimento.");if(newDate===a.date&&newTime===a.time)return appNotice("Escolha um novo horário","A data ou o horário precisa ser diferente do agendamento atual.");const record={fromDate:a.date,fromTime:a.time,toDate:newDate,toTime:newTime,reason,createdAt:new Date().toISOString()};const updated={...a,date:newDate,time:newTime,status:"scheduled",rescheduleReason:reason,rescheduleHistory:[...(a.rescheduleHistory||[]),record],statusUpdatedAt:new Date().toISOString()};const blocks=getAbsoluteSchedulingBlocks(updated);if(blocks.length)return appNotice("Não é possível reagendar",blocks.map(x=>`${x.name}: ${x.text}`).join("\n"));if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("update",updated,id);if(sent){closeModals();toast("Reagendamento enviado para aprovação.")}return}Object.assign(a,updated);hist(a.patientId,"Reagendado",`De ${record.fromDate} ${record.fromTime} para ${record.toDate} ${record.toTime} · Motivo: ${reason}`,id);persist();closeModals();toast("Agendamento reagendado e salvo.")};
$("cancelAppointmentForm").onsubmit=async e=>{e.preventDefault();const id=$("cancelAppointmentId").value,a=state.appointments.find(x=>x.id===id);if(!a)return;const selected=$("cancelReasonSelect").value,reason=(selected==="Outro"?$("cancelReasonOther").value:selected).trim();if(!reason)return appNotice("Informe o motivo","Selecione um motivo ou descreva o cancelamento.");const archived={...a,cancelReason:reason,cancelledAt:new Date().toISOString()};if((window.AgendaAuth||{}).role==="doctor"){const sent=await sendAgendaSuggestion("delete",archived,id);if(sent){closeModals();toast("Cancelamento enviado para aprovação.")}return}state.cancelledAppointments=[...(state.cancelledAppointments||[]),archived];state.appointments=state.appointments.filter(x=>x.id!==id);hist(a.patientId,"Agendamento cancelado",`${a.procedure} · ${a.date} às ${a.time} · ${reason}`,id);persist();closeModals();toast("Agendamento movido para Cancelados.")};
function openPatient(id=null){if((window.AgendaAuth||{}).role==="doctor")return;$("patientForm").reset();$("patientId").value="";$("deletePatientBtn").classList.add("hidden");$("patientModalTitle").textContent=id?"Editar paciente":"Novo paciente";const doctors=state.professionals.filter(p=>p.category==="doctor");$("patientDoctor").innerHTML=doctors.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");$("patientDoctor").value=selectedProf()?.category==="doctor"?selectedProf().id:(doctors[0]?.id||"");if(id){const p=patient(id);$("patientId").value=p.id;$("patientDoctor").value=p.doctorId||"";$("patientName").value=p.name;$("patientPhone").value=p.phone||"";$("patientEmail").value=p.email||"";$("patientInsurance").value=p.insurance||"";$("patientCardNumber").value=p.cardNumber||""}openModal("patientModal")}
function openPatientDetail(id){const p=patient(id);if(!p)return;detailPatientId=id;$("patientDetailTitle").textContent=p.name;$("detailPhone").textContent=p.phone||"—";$("detailEmail").textContent=p.email||"—";$("detailInsurance").textContent=p.insurance||"—";$("detailCard").textContent=p.cardNumber||"—";renderHistory(id,"detailHistory");openModal("patientDetailModal")}
$("editPatientFromDetail").onclick=()=>{if((window.AgendaAuth||{}).role==="doctor")return;const id=detailPatientId;closeModals();openPatient(id)}
$("patientForm").onsubmit=e=>{e.preventDefault();const x={id:$("patientId").value||crypto.randomUUID(),doctorId:$("patientDoctor").value,name:$("patientName").value.trim(),phone:$("patientPhone").value.trim(),email:$("patientEmail").value.trim(),insurance:$("patientInsurance").value.trim(),cardNumber:$("patientCardNumber").value.trim()},i=state.patients.findIndex(p=>p.id===x.id);if(i>=0){const old=state.patients[i];state.patients[i]=x;if(old.doctorId!==x.doctorId)hist(x.id,"Médico responsável alterado",`De "${prof(old.doctorId)?.name||"—"}" para "${prof(x.doctorId)?.name||"—"}"`);if(old.insurance!==x.insurance)hist(x.id,"Convênio alterado",`De "${old.insurance||"—"}" para "${x.insurance||"—"}"`);if(old.cardNumber!==x.cardNumber)hist(x.id,"Carteirinha alterada",`De "${old.cardNumber||"—"}" para "${x.cardNumber||"—"}"`)}else{state.patients.push(x);hist(x.id,"Paciente cadastrado","Cadastro criado.")}persist();closeModals();toast("Paciente salvo.")}
$("deletePatientBtn").onclick=()=>appNotice("Cadastro preservado","Pacientes não são excluídos do Agenda RN.");

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
$("blockForm").onsubmit=e=>{
 e.preventDefault();const owner=selectedProf();if($("blockDate").value<ds(new Date()))return appNotice("Data inválida","Não é possível criar bloqueio em data passada.");
 if(mins($("blockStart").value)>=mins($("blockEnd").value))return appNotice("Horário inválido","O horário final deve ser posterior ao inicial.");
 const item={id:$("blockId").value||crypto.randomUUID(),professionalId:owner.id,date:$("blockDate").value,start:$("blockStart").value,end:$("blockEnd").value,reason:$("blockReason").value.trim(),hospitalId:null};

 const bs=mins(item.start),be=mins(item.end);
 const conflicts=state.appointments.filter(a=>{
   if(a.status==="cancelled"||a.date!==item.date)return false;
   const belongs=owner.category==="anesthetist"?a.anesthetistId===owner.id:a.doctorId===owner.id;
   if(!belongs)return false;
   const as=mins(a.time),ae=as+Number(a.duration||0);
   return overlap(bs,be,as,ae);
 });
 if(conflicts.length){
   const names=conflicts.slice(0,4).map(a=>`${a.time} - ${patient(a.patientId)?.name||"Paciente"}`).join("\n");
   return appNotice("Conflito com agendamento",`Já existe atendimento neste intervalo:\n${names}\n\nReagende ou cancele o atendimento primeiro.`);
 }

 const i=state.scheduleBlocks.findIndex(x=>x.id===item.id);if(i>=0)state.scheduleBlocks[i]=item;else state.scheduleBlocks.push(item);
 persist();closeModals();toast("Bloqueio salvo.")
};
$("deleteBlockBtn").onclick=async()=>{const id=$("blockId").value;if(id&&await appConfirm("Excluir bloqueio","Este horário voltará a ficar disponível.","Excluir",true)){state.scheduleBlocks=state.scheduleBlocks.filter(x=>x.id!==id);persist();closeModals();toast("Bloqueio excluído.")}};

function openRule(id=null){
 const surgeons=state.professionals.filter(p=>p.category==="doctor");if(!surgeons.length)return appNotice("Cirurgião necessário","Cadastre um cirurgião.");
 $("ruleForm").reset();$("ruleId").value="";$("deleteRuleBtn").classList.add("hidden");$("ruleModalTitle").textContent=id?"Editar regra":"Nova regra";
 $("ruleProfessional").innerHTML=surgeons.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
 $("ruleHospital").innerHTML='<option value="">Todos os hospitais</option>'+state.hospitals.map(h=>`<option value="${h.id}">${esc(h.name)}</option>`).join("");
 $("ruleEnabled").checked=true;$("ruleBlockAllDay").checked=false;
 if(id){
   const r=state.schedulingRules.find(x=>x.id===id);if(!r)return;
   $("ruleId").value=r.id;$("ruleProfessional").value=r.professionalId;$("ruleName").value=r.name||"";$("ruleHospital").value=r.hospitalId||"";$("ruleSeverity").value=r.severity||"warning";$("ruleWeekday").value=r.weekday??"";$("ruleOccurrence").value=r.occurrence||"";$("ruleStart").value=r.start||"";$("ruleEnd").value=r.end||"";$("ruleMaxPatients").value=r.maxPatients||"";$("ruleProcedure").value=r.procedureContains||"";$("rulePreferredTimes").value=r.preferredTimes||"";$("ruleForbiddenTimes").value=r.forbiddenTimes||"";$("ruleBlockAllDay").checked=!!r.blockAllDay;$("ruleEnabled").checked=r.enabled!==false;$("deleteRuleBtn").classList.remove("hidden");
 }else if($("rulesProfessionalFilter").value)$("ruleProfessional").value=$("rulesProfessionalFilter").value;
 openModal("ruleModal")
}
$("ruleForm").onsubmit=e=>{
 e.preventDefault();
 const r={id:$("ruleId").value||crypto.randomUUID(),professionalId:$("ruleProfessional").value,name:$("ruleName").value.trim(),hospitalId:$("ruleHospital").value||null,severity:$("ruleSeverity").value,weekday:$("ruleWeekday").value,occurrence:$("ruleOccurrence").value,start:$("ruleStart").value,end:$("ruleEnd").value,maxPatients:$("ruleMaxPatients").value?Number($("ruleMaxPatients").value):null,procedureContains:$("ruleProcedure").value.trim(),preferredTimes:$("rulePreferredTimes").value.trim(),forbiddenTimes:$("ruleForbiddenTimes").value.trim(),blockAllDay:$("ruleBlockAllDay").checked,enabled:$("ruleEnabled").checked};
 if(r.start&&r.end&&mins(r.start)>=mins(r.end))return appNotice("Faixa inválida","O horário final deve ser posterior ao inicial.");
 const i=state.schedulingRules.findIndex(x=>x.id===r.id);if(i>=0)state.schedulingRules[i]=r;else state.schedulingRules.push(r);
 persist();closeModals();toast("Regra salva.")
};
$("deleteRuleBtn").onclick=async()=>{const id=$("ruleId").value;if(id&&await appConfirm("Excluir regra","A regra deixará de orientar ou bloquear novos agendamentos.","Excluir",true)){state.schedulingRules=state.schedulingRules.filter(x=>x.id!==id);persist();closeModals();toast("Regra excluída.")}};


function openProfessional(id=null){
 $("professionalForm").reset();
 $("professionalId").value="";
 $("professionalModalTitle").textContent=id?"Editar profissional":"Novo profissional";
 $("saveProfessionalBtn").textContent=id?"Salvar alterações":"Adicionar";
 $("specialtyResults").classList.add("hidden");
 if(id){
   const p=state.professionals.find(x=>x.id===id);
   if(!p)return;
   $("professionalId").value=p.id;
   $("professionalName").value=p.name||"";
   $("professionalCrm").value=p.crm||"";
   $("professionalSpecialty").value=p.specialty||"";
   $("professionalCategory").value=p.category||"doctor";
 }
 openModal("professionalModal");
}

$("professionalForm").onsubmit=async e=>{
 e.preventDefault();
 const id=$("professionalId").value||crypto.randomUUID();
 const existing=state.professionals.find(p=>p.id===id);
 const category=$("professionalCategory").value;
 if(existing && existing.category!==category){
   const hasAppointments=state.appointments.some(a=>a.doctorId===id||a.anesthetistId===id);
   if(hasAppointments && !await appConfirm("Alterar categoria","Este profissional possui agendamentos e a mudança pode afetar a agenda dele.","Alterar mesmo assim"))return;
 }
 const item={
   id,
   name:$("professionalName").value.trim(),
   crm:$("professionalCrm").value.trim(),
   specialty:$("professionalSpecialty").value.trim(),
   category
 };
 const i=state.professionals.findIndex(p=>p.id===id);
 if(i>=0)state.professionals[i]=item;else state.professionals.push(item);
 persist();
 closeModals();
 $("professionalForm").reset();
 $("specialtyResults").classList.add("hidden");
 toast(i>=0?"Profissional atualizado.":"Profissional adicionado.");
}
$("hospitalForm").onsubmit=e=>{e.preventDefault();const name=$("hospitalName").value.trim();if(state.hospitals.some(h=>h.name.localeCompare(name,"pt-BR",{sensitivity:"base"})===0))return appNotice("Hospital já cadastrado","Use o hospital existente na lista.");state.hospitals.push({id:crypto.randomUUID(),name});persist();closeModals();$("hospitalForm").reset();toast("Hospital adicionado.")}
$("professionalFilter").onchange=renderCalendar;$("rulesProfessionalFilter").onchange=renderRules;$("rulesStatusFilter").onchange=renderRules;$("statusFilter").onchange=renderCalendar;$("patientSearch").oninput=renderPatients;$("appointmentPatient").onchange=()=>{updateStandaloneInsuranceField();updatePatientSide()};$("appointmentDate").onchange=()=>{validatePastDate();renderRuleFeedback()};

["appointmentProcedure","appointmentHospital","appointmentTime","appointmentDuration","relatedProfessional","appointmentDate"].forEach(id=>$(id).addEventListener("change",renderRuleFeedback));
["appointmentTime","appointmentDate"].forEach(id=>$(id).addEventListener("input",renderRuleFeedback));
$("appointmentProcedure").addEventListener("input",renderRuleFeedback);

["flagOpme","flagReports","flagExams"].forEach(id=>$(id).onchange=()=>document.querySelector(`[data-state-for="${id}"]`).textContent=$(id).checked?"Sim":"Não");
$("prevBtn").onclick=()=>{currentDate=addDays(currentDate,calendarMode==="week"?-7:-1);renderCalendar()};$("nextBtn").onclick=()=>{currentDate=addDays(currentDate,calendarMode==="week"?7:1);renderCalendar()};$("todayBtn").onclick=()=>{currentDate=calendarMode==="week"?startOfWeek(new Date()):new Date();renderCalendar()}
$("newAppointmentBtn").onclick=()=>openAppointment();$("newBlockBtn").onclick=()=>openBlock();$("newRuleBtn").onclick=()=>openRule();$("newPatientBtn").onclick=()=>openPatient();$("newProfessionalBtn").onclick=()=>openProfessional();$("newHospitalBtn").onclick=()=>openModal("hospitalModal");
qsa(".segment").forEach(b=>b.onclick=()=>{qsa(".segment").forEach(x=>x.classList.remove("active"));b.classList.add("active");calendarMode=b.dataset.mode;currentDate=calendarMode==="week"?startOfWeek(currentDate):new Date(currentDate);renderCalendar()});
initWorkflowUI();
function showView(view){qsa(".nav-item").forEach(x=>{const active=x.dataset.view===view;x.classList.toggle("active",active);x.setAttribute("aria-current",active?"page":"false")});qsa(".view").forEach(v=>v.classList.remove("active"));$(`${view}View`).classList.add("active");const onAgenda=view==="agenda";$("newAppointmentBtn").classList.toggle("hidden",!onAgenda);$("newBlockBtn").classList.toggle("hidden",!onAgenda||(window.AgendaAuth||{}).role!=="general_manager");$("agendaNotifications").classList.toggle("hidden",!onAgenda);if(!onAgenda)closeNotificationPanel();$("agendaReportBtn").classList.toggle("hidden",!onAgenda);$("cancelledPageBtn").classList.toggle("hidden",!onAgenda);document.querySelector(".dynamic-page-heading")?.remove();if(!onAgenda){const x={patients:["Pacientes","Cadastro, convênio e histórico dos pacientes."],cancelled:["Pacientes cancelados","Cancelamentos separados por mês."],settings:["Configurações","Cirurgiões, anestesistas, hospitais e acessos."],requests:["Solicitações","Aceite ou negue sugestões enviadas pelos médicos."],notifications:["Notificações","Acompanhe o retorno das suas sugestões."],audit:["Histórico geral","Auditoria de todas as agendas."]}[view];document.querySelector(".report-heading").insertAdjacentHTML("afterbegin",`<div class="dynamic-page-heading"><h1>${esc(x[0])}</h1><p>${esc(x[1])}</p></div>`)}if(view==="cancelled")renderCancelled();if(view==="settings"&&(window.AgendaAuth||{}).role==="general_manager")renderAccess();window.scrollTo({top:0,behavior:"smooth"})}
qsa(".nav-item").forEach(b=>b.onclick=()=>showView(b.dataset.view));
$("notificationBell").onclick=e=>{e.stopPropagation();toggleNotificationPanel()};$("closeNotificationPanel").onclick=e=>{e.stopPropagation();closeNotificationPanel()};$("notificationPanel").onclick=e=>e.stopPropagation();document.addEventListener("click",closeNotificationPanel);
qsa("[data-close]").forEach(b=>b.onclick=closeModals);$("modalBackdrop").onclick=closeModals;document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModals()});
$("exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=`agenda-rn-backup-${ds(new Date())}.json`;a.click();URL.revokeObjectURL(u)}
$("importInput").onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const d=Storage.migrate(JSON.parse(await f.text()));if(await appConfirm("Importar backup","A importação substituirá os dados atuais.","Importar",true)){state=d;persist();toast("Backup importado.")}}catch{await appNotice("Arquivo inválido","O arquivo selecionado não contém um backup válido.")}e.target.value=""}
$("newAccessBtn").onclick=()=>openAccess();
$("accessForm").onsubmit=async e=>{e.preventDefault();const payload={id:Number($("accessId").value)||undefined,email:$("accessEmail").value,name:$("accessName").value,role:$("accessRole").value,password:$("accessPassword").value||undefined,agendaIds:qsa('#accessAgendaChoices input:checked').map(x=>x.value)};const response=await fetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});if(!response.ok)return appNotice("Falha ao salvar acesso",(await response.json()).error||"Tente novamente.");closeModals();await renderAccess();toast("Acesso atualizado.")};
$("deleteAccessBtn").onclick=async()=>{const id=Number($("accessId").value);if(!id||!await appConfirm("Remover acesso","Esta pessoa não conseguirá mais entrar nas agendas concedidas.","Remover",true))return;const response=await fetch(`/api/access?id=${id}`,{method:"DELETE"});if(!response.ok)return appNotice("Falha ao remover acesso",(await response.json()).error||"Tente novamente.");closeModals();await renderAccess();toast("Acesso removido.")};

const MEDICAL_SPECIALTIES=[
"Acupuntura","Alergia e Imunologia","Anestesiologia","Angiologia","Cardiologia","Cirurgia Cardiovascular",
"Cirurgia da Mão","Cirurgia de Cabeça e Pescoço","Cirurgia do Aparelho Digestivo","Cirurgia Geral",
"Cirurgia Oncológica","Cirurgia Pediátrica","Cirurgia Plástica","Cirurgia Torácica","Cirurgia Vascular",
"Clínica Médica","Coloproctologia","Dermatologia","Endocrinologia e Metabologia","Endoscopia",
"Gastroenterologia","Genética Médica","Geriatria","Ginecologia e Obstetrícia","Hematologia e Hemoterapia",
"Homeopatia","Infectologia","Mastologia","Medicina de Emergência","Medicina de Família e Comunidade",
"Medicina do Trabalho","Medicina do Tráfego","Medicina Esportiva","Medicina Física e Reabilitação",
"Medicina Intensiva","Medicina Legal e Perícia Médica","Medicina Nuclear","Medicina Preventiva e Social",
"Nefrologia","Neurocirurgia","Neurologia","Nutrologia","Oftalmologia","Oncologia Clínica",
"Ortopedia e Traumatologia","Otorrinolaringologia","Patologia","Patologia Clínica/Medicina Laboratorial",
"Pediatria","Pneumologia","Psiquiatria","Radiologia e Diagnóstico por Imagem","Radioterapia",
"Reumatologia","Urologia"
];
function renderSpecialtyResults(){
 const input=$("professionalSpecialty"),box=$("specialtyResults"),q=input.value.trim().toLowerCase();
 const items=MEDICAL_SPECIALTIES.filter(x=>!q||x.toLowerCase().includes(q)).slice(0,40);
 box.innerHTML=items.map(x=>`<div class="combo-option" data-specialty="${esc(x)}">${esc(x)}</div>`).join("");
 box.classList.toggle("hidden",!items.length);
 qsa("[data-specialty]").forEach(el=>el.onclick=()=>{input.value=el.dataset.specialty;box.classList.add("hidden")});
}
$("professionalSpecialty").addEventListener("focus",renderSpecialtyResults);
$("professionalSpecialty").addEventListener("input",renderSpecialtyResults);
document.addEventListener("click",e=>{if(!e.target.closest(".combo-wrap"))$("specialtyResults").classList.add("hidden")});

$("professionalFilter").addEventListener("change",()=>{renderAppointmentOptions();renderPatients();renderCancelled()});
$("relatedProfessional").addEventListener("change",()=>{renderAppointmentOptions();updatePatientSide()});

applyRoleRestrictions();renderAll();

let __lastRenderedMinute="";
setInterval(()=>{
 const now=new Date(),stamp=`${ds(now)}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
 if(stamp!==__lastRenderedMinute){
   __lastRenderedMinute=stamp;
   if($("agendaView").classList.contains("active"))renderCalendar();
 }
},15000);
