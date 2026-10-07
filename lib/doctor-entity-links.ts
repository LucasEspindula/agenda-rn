import type {BillingData,Doctor,Entity,Link} from './billing-types';

export type DoctorEntityLinkMutation=
 |{doctor_id:string;billing_entity_id:string;active:boolean}
 |Pick<Link,'id'|'doctor_id'|'billing_entity_id'|'updated_at'|'active'>;

export const entityLabel=(entity:Entity)=>(entity.trade_name||'').trim()||entity.name;

export const activeBillingEntities=(entities:Entity[])=>[...entities]
 .filter(entity=>entity.active)
 .sort((a,b)=>entityLabel(a).localeCompare(entityLabel(b),'pt-BR',{sensitivity:'base'}));

export const sortedBillingDoctors=(doctors:Doctor[])=>[...doctors]
 .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base'}));

export const doctorEntityLink=(links:Link[],doctorId:string,entityId:string)=>
 links.find(link=>link.doctor_id===doctorId&&link.billing_entity_id===entityId);

export const activeEntityLinkCount=(data:BillingData,doctorId:string)=>
 data.links.filter(link=>link.doctor_id===doctorId&&link.active&&data.entities.some(entity=>entity.id===link.billing_entity_id&&entity.active)).length;

export const inactiveEntityHistory=(data:BillingData,doctorId:string)=>
 data.links.flatMap(link=>{
  const entity=data.entities.find(value=>value.id===link.billing_entity_id);
  return link.doctor_id===doctorId&&entity&&!entity.active?[{link,entity}]:[];
 });

export function buildDoctorEntityLinkMutation(links:Link[],doctorId:string,entityId:string,desiredActive:boolean):DoctorEntityLinkMutation {
 const existing=doctorEntityLink(links,doctorId,entityId);
 return existing
  ?{id:existing.id,doctor_id:existing.doctor_id,billing_entity_id:existing.billing_entity_id,updated_at:existing.updated_at,active:desiredActive}
  :{doctor_id:doctorId,billing_entity_id:entityId,active:desiredActive};
}
