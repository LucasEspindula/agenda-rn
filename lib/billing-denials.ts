export type DenialCharge={
 billing_record_id:string;patient:string;service_date:string;procedure:string;
 professional_id:string;professional_name:string;entity_name:string;billing_entity_id:string;payer:string;
};
export type DenialCase={
 id:string;billing_record_id:string;billing_entity_id:string;denied_on:string;
 denied_amount:number;recovered_amount:number;reason:string;payer_reference:string|null;notes:string|null;
 status:"OPEN"|"APPEALED"|"DECIDED"|"PARTIAL"|"RECOVERED"|"CLOSED";
 closing_reason:string|null;closed_at:string|null;created_at:string;updated_at:string;
 patient:string;service_date:string;procedure:string;professional_id:string;professional_name:string;
 entity_name:string;payer:string;
};
export type DenialAppeal={
 id:string;denial_id:string;filed_on:string;appealed_amount:number;protocol:string;notes:string|null;
 decision:"PENDING"|"ACCEPTED"|"PARTIAL"|"REJECTED";decision_on:string|null;
 approved_amount:number;decision_notes:string|null;
};
export type DenialRecovery={
 id:string;denial_id:string;appeal_id:string;recovered_on:string;amount:number;receipt_reference:string;notes:string|null;
};
export type DenialEvent={id:string;denial_id:string;actor_id:number;event_type:string;created_at:string};
export type DenialData={charges:DenialCharge[];cases:DenialCase[];appeals:DenialAppeal[];
 recoveries:DenialRecovery[];events:DenialEvent[];can_manage:boolean;today:string};
export const denialStatuses:Record<DenialCase["status"],string>={
 OPEN:"Em aberto",APPEALED:"Em recurso",DECIDED:"Recurso decidido",
 PARTIAL:"Parcialmente recuperada",RECOVERED:"Recuperação integral",CLOSED:"Encerrada"
};
export const appealDecisions:Record<DenialAppeal["decision"],string>={
 PENDING:"Aguardando decisão",ACCEPTED:"Deferido",PARTIAL:"Parcialmente deferido",REJECTED:"Indeferido"
};
