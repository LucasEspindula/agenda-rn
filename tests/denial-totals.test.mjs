import {test} from "node:test";
import assert from "node:assert/strict";
import {denialCents,summarizeDenials} from "../lib/denial-totals.js";
test("glosa parcial e recuperação fracionada não distorcem centavos",()=>{
 assert.equal(denialCents(10.01),1001);
 const out=summarizeDenials([
 {denied_amount:100.03,recovered_amount:80.02,status:"PARTIAL"},
 {denied_amount:99.99,recovered_amount:0,status:"CLOSED"}
 ]);
 assert.deepEqual(out,{total:2,denied:200.02,recovered:80.02,activeBalance:20.01,closedLoss:99.99});
});
test("encerramento sem recuperação continua registrado como perda",()=>{
 const out=summarizeDenials([{denied_amount:275.50,recovered_amount:100,status:"CLOSED"}]);
 assert.equal(out.activeBalance,0);
 assert.equal(out.closedLoss,175.50);
});
test("valor recuperado não se converte em entrada financeira",()=>{
 const result=summarizeDenials([{denied_amount:100,recovered_amount:30,status:"APPEALED"}]);
 assert.equal(result.recovered,30);
 assert.equal("payment_status" in result,false);
 assert.equal("paid_at" in result,false);
});
