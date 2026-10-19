// Valores individualizados por atendimento realizado na competência do relatório.
// Não utiliza totais de NFs, que podem conter vários pacientes/profissionais.
const toCents=(value)=>{
 if(value===null||value===undefined||value==="")return null;
 const parsed=Number(value);
 return Number.isFinite(parsed)&&parsed>=0?Math.round(parsed*100):null;
};

export function monthlyReceiptComparison(attendances=[]){
 const privateGroup={label:"Particular",receivedCents:0,paidCount:0,missingPaidAmounts:0};
 const byInsurance=new Map();
 for(const attendance of attendances){
  const method=String(attendance.billing_method||"").toUpperCase();
  if(method!=="PARTICULAR"&&method!=="CONVENIO")continue;
  let group=privateGroup;
  if(method==="CONVENIO"){
   const label=String(attendance.insurance_name||"").trim()||"Convênio não informado";
   const key=label.toLocaleLowerCase("pt-BR");
   if(!byInsurance.has(key))byInsurance.set(key,{label,receivedCents:0,paidCount:0,missingPaidAmounts:0});
   group=byInsurance.get(key);
  }
  if(attendance.payment_status!=="PAGO")continue;
  // Particular: valor da cobrança direta, mesmo quando há NF particular.
  // Convênio: prioriza a soma discriminada dos itens da NF, sem somar a NF inteira.
  const value=method==="CONVENIO"?
   (attendance.invoice_item_received??attendance.received_amount):
   attendance.received_amount;
  const cents=toCents(value);
  if(cents===null){group.missingPaidAmounts++;continue}
  group.receivedCents+=cents;
  group.paidCount++;
 }
 const insurance=[...byInsurance.values()].sort((a,b)=>
  b.receivedCents-a.receivedCents||a.label.localeCompare(b.label,"pt-BR"));
 const groups=[privateGroup,...insurance];
 return {
  groups,
  totalCents:groups.reduce((sum,item)=>sum+item.receivedCents,0),
  missingPaidAmounts:groups.reduce((sum,item)=>sum+item.missingPaidAmounts,0)
 };
}
