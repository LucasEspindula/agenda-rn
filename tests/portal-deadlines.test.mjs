import {test} from "node:test";
import assert from "node:assert/strict";
import {addCalendarDays,calculatePortalDeadline,destinationKey,matchDeadlineRule,validCivilDate} from "../lib/portal-deadlines.js";

test("prazo exige regra explícita; pagamento não define envio",()=>{
 assert.deepEqual(calculatePortalDeadline({today:"2026-10-16",serviceDate:"2026-10-01",guideReceivedAt:null,submittedAt:null,rule:null}),
  {state:"NO_RULE",deadline:null,remaining:null});
});
test("30 dias a partir do atendimento, com alerta cinco dias antes e vencimento",()=>{
 const rule={deadline_days:30,alert_before_days:5,starts_from:"SERVICE_DATE"};
 assert.deepEqual(calculatePortalDeadline({today:"2026-10-26",serviceDate:"2026-10-01",guideReceivedAt:null,submittedAt:null,rule}),
  {state:"ALERT",deadline:"2026-10-31",remaining:5});
 assert.equal(calculatePortalDeadline({today:"2026-11-01",serviceDate:"2026-10-01",guideReceivedAt:null,submittedAt:null,rule}).state,"OVERDUE");
 assert.equal(calculatePortalDeadline({today:"2026-11-11",serviceDate:"2026-10-01",guideReceivedAt:null,submittedAt:"2026-10-28",rule}).state,"SUBMITTED");
});
test("data de recebimento da guia não pode ser confundida com a data do procedimento",()=>{
 const r={deadline_days:10,alert_before_days:2,starts_from:"GUIDE_RECEIVED"};
 assert.equal(calculatePortalDeadline({today:"2026-10-16",serviceDate:"2026-10-01",guideReceivedAt:null,submittedAt:null,rule:r}).state,"WAITING_GUIDE");
 assert.equal(calculatePortalDeadline({today:"2026-10-16",serviceDate:"2026-10-01",guideReceivedAt:"2026-10-10",submittedAt:null,rule:r}).deadline,"2026-10-20");
});
test("regra vigente e específica precede regra geral do convênio",()=>{
 const general={id:"g",professional_id:null,destination_key:"UNIMED",submission_channel_code:"PORTAL_CONVENIO",deadline_days:30,alert_before_days:5,starts_from:"SERVICE_DATE",valid_from:"2026-01-01",valid_to:null,active:true};
 const specific={...general,id:"p",professional_id:"med-2",deadline_days:20,valid_from:"2026-10-01"};
 assert.equal(matchDeadlineRule([general,specific],{destination:" unimed ",channel:"PORTAL_CONVENIO",professionalId:"med-2",serviceDate:"2026-10-16"}).id,"p");
 assert.equal(matchDeadlineRule([general,specific],{destination:"UNIMED",channel:"PORTAL_CONVENIO",professionalId:"med-1",serviceDate:"2026-10-16"}).id,"g");
 assert.equal(matchDeadlineRule([specific],{destination:"UNIMED",channel:"PORTAL_CONVENIO",professionalId:"med-2",serviceDate:"2026-09-16"}),null);
});
test("datas civis são reais e não dependem de horário de verão",()=>{
 assert.equal(validCivilDate("2026-02-30"),false);
 assert.equal(validCivilDate("2028-02-29"),true);
 assert.equal(addCalendarDays("2026-12-30",3),"2027-01-02");
 assert.equal(destinationKey("  coopa  "), "COOPA");
});
