import {test} from "node:test";
import assert from "node:assert/strict";
import {monthlyInvoiceStatus} from "../lib/monthly-invoice-status.js";

test("mostra número da NF sucessora, inclusive fora da competência",()=>{
 assert.equal(monthlyInvoiceStatus({
  status:"REPLACED",invoice_number:"158",
  replaced_by_invoice_id:"other-month",replacement_invoice_number:"185"
 }),"Substituída (185)");
});
test("resolve a referência pelo ID quando sucessora está listada",()=>{
 assert.equal(monthlyInvoiceStatus({
  id:"old",invoice_number:"158",status:"REPLACED",replaced_by_invoice_id:"new"
 },[{id:"new",invoice_number:"179",status:"ACTIVE"}]),"Substituída (179)");
});
test("nunca inventa número quando vínculo está ausente",()=>{
 assert.equal(monthlyInvoiceStatus({status:"REPLACED"}),"Substituída");
});
test("preserva canceladas e ativas",()=>{
 assert.equal(monthlyInvoiceStatus({status:"CANCELLED"}),"Cancelada");
 assert.equal(monthlyInvoiceStatus({status:"ACTIVE"}),"Ativa");
});
