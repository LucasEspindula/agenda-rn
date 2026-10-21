import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=readFileSync("public/legacy-app.js","utf8");
const between=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
const detail=between("async function saveAppointmentDetailChanges(id,button){","function renderAppointmentDetail(a){");
const financial=between("async function saveNativeFinance(id){","async function saveAppointmentDetailChanges(id,button){");
const fetcher=between("async function loadNativeFinance(id,draft=null){","function validateNativeFinance(){");

test("confirmação de recebimento fecha janela sem refazer Detalhes e sem deixar Carregando financeiro",()=>{
 assert.match(detail,/await saveNativeFinance\(id\)/);
 assert.match(detail,/closeModals\(\);\s*renderAll\(\)/);
 assert.doesNotMatch(detail,/renderAppointmentDetail\(/);
 assert.match(detail,/finally\{if\(button\.isConnected\)/);
});
test("erro da API financeira mantém janela aberta e apresenta erro; nunca confirma falso sucesso",()=>{
 assert.match(financial,/if\(!r\.ok\)throw Error\(result\.error/);
 assert.match(detail,/catch\(error\)\{nativeFinanceError\(/);
 assert.match(detail,/return\}\s*closeModals\(/);
 assert.match(financial,/if\(proofUploadFailed\).*throw Error/);
});
test("pagamento confirmado não vira erro por falha posterior na consulta do estado",()=>{
 assert.match(financial,/window\.RNFinance\.notifyFinancialChange\(\)/);
 assert.match(financial,/let stateRefreshed=false/);
 assert.match(financial,/try\{\s*const response=await fetch\('\/api\/state'/);
 assert.match(financial,/catch\{\/\* Sincronismo de agenda recupera eventual falha de leitura/);
 assert.match(financial,/return \{paymentSaved:true,stateRefreshed\}/);
 assert.match(detail,/void checkAgendaRevision\(\)/);
});
test("carregamento do financeiro tem prazo e botão de nova tentativa",()=>{
 assert.match(fetcher,/AbortSignal\.timeout\(20000\)/);
 assert.match(fetcher,/f\.error=error\?\.name==='TimeoutError'/);
 assert.match(src,/id="retryNativeFinance"/);
});
test("aviso de sincronização não fica coberto pelo modal em edição",()=>{
 assert.match(src,/if\(show&&!agendaEditorOpen\(\)&&!notice\)/);
 assert.match(src,/notice\.hidden=!show\|\|agendaEditorOpen\(\)/);
 assert.match(src,/function openModal\(id\)\{lastFocusedElement=document\.activeElement;remoteAgendaNotice\(false\)/);
 assert.match(src,/AgendaSyncAfterModalClose/);
});
test("fluxo executado fecha modal somente em sucesso e não reconstrói Detalhes",async()=>{
 const block=detail.replace(/^async function saveAppointmentDetailChanges\(id,button\)\{/,"async function saveAppointmentDetailChanges(id,button){");
 const user={id:"at1",patientId:"patient1",doctorId:"dr1",anesthetistId:null,
  insurance:"Particular",forma_cobranca:"PARTICULAR",date:"2026-10-21",
  time:"11:00",duration:60,procedure:"Exame",hospitalId:"h1",guideExpiry:"",
  careType:"outpatient",notes:"",opme:false,reports:false,exams:false,
  status:"scheduled",statusUpdatedAt:null};
 const fields={
  appointmentStatusSelect:{value:user.status},detailAppointmentInsurance:{value:user.insurance},
  detailBillingMethod:{value:user.forma_cobranca},detailDate:{value:user.date},
  detailTime:{value:user.time},detailDuration:{value:"60"},detailProcedure:{value:user.procedure},
  detailHospital:{value:user.hospitalId},detailGuideExpiry:{value:""},
  detailCareType:{value:user.careType},detailNotes:{value:""},
  detailOpme:{checked:false},detailReports:{checked:false},detailExams:{checked:false},
  detailRelatedProfessional:{value:""},detailSuggestionReason:{value:""}
 };
 const calls=[];
 let mode="success";
 const ctx={
  state:{appointments:[{...user}]},selectedProf:()=>({id:"dr1"}),$:(id)=>fields[id],
  window:{AgendaAuth:{role:"general_manager"}},isAnesthesiologist:()=>false,
  validateNativeFinance:()=>true,appointmentInsurance:(a)=>a.insurance,
  appNotice:()=>calls.push("notice"),nativeFinanceError:(e)=>calls.push("error:"+e),
  persist:async()=>true,hist:()=>calls.push("history"),
  saveNativeFinance:async()=>{calls.push("financial");if(mode==="failure")throw Error("NF inválida");return {paymentSaved:true,stateRefreshed:true}},
  closeModals:()=>calls.push("closed"),renderAll:()=>calls.push("renderAll"),
  renderAppointmentDetail:()=>calls.push("INVALID_RERENDER"),
  toast:(msg)=>calls.push("toast:"+msg),checkAgendaRevision:()=>calls.push("sync")
 };
 const make=new Function("scope","with(scope){ "+block+";return saveAppointmentDetailChanges; }");
 const save=make(ctx);
 const button={dataset:{},disabled:false,isConnected:true,setAttribute(){},removeAttribute(){},textContent:"Salvar alterações"};
 await save(user.id,button);
 assert.deepEqual(calls,["financial","closed","renderAll","toast:Agendamento salvo."]);
 assert.equal(button.disabled,false);
 calls.length=0;mode="failure";
 await save(user.id,button);
 assert.deepEqual(calls,["financial","error:NF inválida"]);
 assert.equal(button.disabled,false);
});
