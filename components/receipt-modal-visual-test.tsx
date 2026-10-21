"use client";
import {confirmFiscalPayment} from "./confirm-fiscal-payment";
export default function ReceiptModalVisualTest(){
 return <main style={{padding:24}}>
  <button type="button" data-testid="open-receipt" onClick={()=>{
   void confirmFiscalPayment({patient:{id:"test",name:"Paciente de teste",cpf:"52998224725"},
    amount:1500,paidAt:"2026-10-19",noInvoice:false});
  }}>Abrir confirmação de teste</button>
 </main>;
}
