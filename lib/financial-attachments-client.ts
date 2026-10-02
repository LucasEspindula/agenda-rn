export type FinancialAttachmentTarget={invoiceId?:string;billingRecordId?:string;replacesId?:string|null};
export const paymentProofAccept='application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
const failure='O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.';
async function json(response:Response){return response.json().catch(()=>({}));}
export async function cleanupPendingFinancialAttachment(id:string){
 try{await fetch('/api/financial-attachments?id='+encodeURIComponent(id),{method:'DELETE'});}catch{/* Best effort: the server will clean abandoned PENDING uploads later. */}
}
export async function uploadFinancialAttachment(file:File,target:FinancialAttachmentTarget){
 let pendingId='';
 try{
  const response=await fetch('/api/financial-attachments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...target,name:file.name,mimeType:file.type,size:file.size})});
  const started=await json(response);if(!response.ok)throw Error(started.error||failure);
  pendingId=started.id;
  const uploaded=await fetch(started.url,{method:'PUT',headers:{'content-type':file.type},body:file});
  if(!uploaded.ok)throw Error(failure);
  const completed=await fetch('/api/financial-attachments',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:pendingId})});
  const done=await json(completed);if(!completed.ok)throw Error(done.error||failure);
  return {id:pendingId};
 }catch(error){if(pendingId)await cleanupPendingFinancialAttachment(pendingId);throw error instanceof Error?error:Error(failure);}
}
