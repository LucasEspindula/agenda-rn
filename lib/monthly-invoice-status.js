// O número da NF substituta pode pertencer a outra competência.
// A fonte prioritária é a relação histórica de substituição na NF.
export function monthlyInvoiceStatus(invoice,allInvoices=[]){
 if(invoice?.status==="CANCELLED")return "Cancelada";
 if(invoice?.status==="REPLACED"){
  const linked=invoice.replaced_by_invoice_id
   ?allInvoices.find(i=>i.id===invoice.replaced_by_invoice_id)?.invoice_number
   :null;
  const number=String(invoice.replacement_invoice_number||linked||"").trim();
  return number?"Substituída ("+number+")":"Substituída";
 }
 if(invoice?.status==="ACTIVE")return "Ativa";
 return "—";
}
