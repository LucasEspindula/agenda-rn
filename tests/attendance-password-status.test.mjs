import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

const { touchesAttendedStatus, hasUnverifiedAttendedTransition } = loadTs("lib/security/attendance-status.ts");

test("status Atendido exige confirmação em qualquer entrada ou saída do estado", () => {
  assert.equal(touchesAttendedStatus({status:"scheduled"},{status:"realized"}),true);
  assert.equal(touchesAttendedStatus({status:"realized"},{status:"scheduled"}),true);
  assert.equal(touchesAttendedStatus(null,{status:"realized"}),true);
  assert.equal(touchesAttendedStatus({status:"realized"},{status:"realized"}),false);
  assert.equal(touchesAttendedStatus({status:"scheduled"},{status:"confirmed"}),false);
  assert.equal(hasUnverifiedAttendedTransition([{id:"a",status:"scheduled"}],[{id:"a",status:"realized"}]),true);
  assert.equal(hasUnverifiedAttendedTransition([{id:"a",status:"realized"}],[{id:"a",status:"confirmed"}]),true);
  assert.equal(hasUnverifiedAttendedTransition([{id:"a",status:"scheduled"}],[{id:"a",status:"confirmed"}]),false);
});

function setup({role="doctor",ownAgenda=true,initialStatus="scheduled",passwordValid=true}={}) {
  const original={id:"a-1",date:"2026-10-27",time:"09:00",duration:60,status:initialStatus,doctorId:"doctor-1",patientId:"patient-1"};
  const state={appointments:[original],patientHistory:[],cancelledAppointments:[]};
  let limitCalls=0;const commits=[];
  const db={
    from(table){return {
      select(){return this;},eq(){return this;},
      async maybeSingle(){
        if(table==="app_state")return {data:{payload:state,updated_at:"2026-10-27T10:00:00.000Z"},error:null};
        if(table==="users")return {data:{password_hash:"test-hash",password_salt:"test-salt"},error:null};
        throw Error("Unexpected table: "+table);
      }
    };},
    async rpc(name,data){commits.push({name,data});return {data:true,error:null};}
  };
  const account={id:42,name:"Dr. Exemplo",email:"medico@example.test",role};
  const mocks={
    "@/app/authz":{getSession:async()=>({account,agendaIds:["doctor-1"]})},
    "@/app/passwords":{verifyPassword:async value=>passwordValid&&value==="senha-correta"},
    "@/lib/doctor-services":{canUseAgenda:()=>true},
    "@/lib/security/state":{canReadAppointment:(session,a)=>session.account.role==="general_manager"||(ownAgenda&&session.agendaIds.includes(a.doctorId)),validId:id=>/^[A-Za-z0-9_-]{1,128}$/.test(id)},
    "@/lib/security/http":{readJson:async request=>request.json(),secureMutation:handler=>handler},
    "@/lib/security/rate-limit":{consumeLimit:async()=>{limitCalls++;}},
    "@/lib/supabase-admin":{getSupabaseAdmin:()=>db,dbError:error=>{if(error)throw error;}},
    "@/lib/agenda/store":{
      loadAgendaState:async()=>({state:structuredClone(state),revision:"2026-10-27T10:00:00.000Z"}),
      commitAgendaState:async(actor,revision,current,next,options)=>{commits.push({name:"apply_agenda_changes",data:{p_actor:actor,p_expected:revision,p_payload:next,p_audit:options.audit}});return {ok:true,revision:"2026-10-27T10:00:01.000Z"};},
    },
  };
  const {POST}=loadTs("app/api/attendance/status/route.ts",mocks);
  const send=async(status="realized",password="senha-correta")=>{
    const response=await POST(new Request("https://example.test/api/attendance/status",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({appointmentId:"a-1",status,password})}));
    return {status:response.status,data:await response.json()};
  };
  return {send,commits,getLimitCalls:()=>limitCalls};
}

test("médico com senha própria pode marcar Atendido com histórico e auditoria atômicos",async()=>{
  const {send,commits,getLimitCalls}=setup();
  const response=await send();
  assert.equal(response.status,200);
  assert.equal(commits.length,1);
  assert.equal(commits[0].name,"apply_agenda_changes");
  assert.equal(commits[0].data.p_payload.appointments[0].status,"realized");
  assert.equal(commits[0].data.p_payload.patientHistory[0].type,"Status alterado");
  assert.equal(commits[0].data.p_audit[0].metadata.passwordConfirmed,true);
  assert.equal(JSON.stringify(commits[0]).includes("senha-correta"),false);
  assert.equal(getLimitCalls(),1);
});

test("senha errada, perfil de secretaria e agenda alheia não alteram status",async()=>{
  const invalid=setup({passwordValid:false});
  assert.equal((await invalid.send()).status,401);
  assert.equal(invalid.commits.length,0);
  const secretary=setup({role:"secretary"});
  assert.equal((await secretary.send()).status,403);
  assert.equal(secretary.commits.length,0);
  const outsider=setup({ownAgenda:false});
  assert.equal((await outsider.send()).status,403);
  assert.equal(outsider.commits.length,0);
});

test("médico não pode reverter Atendido; gerente pode corrigir com senha",async()=>{
  const doctor=setup({initialStatus:"realized"});
  assert.equal((await doctor.send("scheduled")).status,403);
  const manager=setup({role:"general_manager",initialStatus:"realized"});
  assert.equal((await manager.send("confirmed")).status,200);
  assert.equal(manager.commits[0].data.p_payload.appointments[0].status,"confirmed");
});

test("gravação genérica e aprovação de sugestões não contornam autenticação do Atendido",()=>{
  const state=readFileSync("app/api/state/route.ts","utf8");
  const workflow=readFileSync("app/api/workflow/route.ts","utf8");
  assert.match(state,/hasUnverifiedAttendedTransition\(/);
  assert.match(workflow,/body\.action !== "delete" && proposed\.status === "realized" && previous\?\.status !== "realized"/);
  assert.match(workflow,/row\.action !== "delete" && proposed\.status === "realized" && previous\?\.status !== "realized"/);
});

test("interface do médico reposiciona os botões e exige senha mascarada",()=>{
  const js=readFileSync("public/legacy-app.js","utf8"),css=readFileSync("public/legacy.css","utf8");
  assert.doesNotMatch(js,/Sugerir cancelamento/);
  const line=js.slice(js.indexOf('class="detail-appointment-line"'),js.indexOf('class="appointment-detail-grid detail-edit-grid"'));
  for(const id of ["cancelDetailAppointmentBtn","rescheduleAppointmentBtn","markAttendedBtn"])assert.ok(line.includes(id),`Botão ${id} deve estar no bloco Agendamento`);
  assert.match(js,/type="password" name="confirmPassword"/);
  assert.match(js,/fetch\("\/api\/attendance\/status"/);
  assert.match(css,/\.doctor-detail-toolbar #saveDetailChangesBtn\{width:100%/);
  assert.match(css,/@media\(max-width:720px\)[\s\S]*\.detail-appointment-actions/);
});
