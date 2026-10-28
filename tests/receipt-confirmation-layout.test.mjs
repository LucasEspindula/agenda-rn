import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const form=readFileSync('components/confirm-fiscal-payment.tsx','utf8');
const parts=readFileSync('components/payment-parts.tsx','utf8');
const css=readFileSync('components/confirm-fiscal-payment.css','utf8');

test('checkbox Sem NF permanece compacto e nao herda tamanho de input de texto',()=>{
 assert.match(css,/input:not\(\[type=radio\]\):not\(\[type=checkbox\]\)/);
 assert.doesNotMatch(css,/\.fiscal-confirmation input:not\(\[type=radio\]\),/);
 assert.match(css,/\.fiscal-radio :is\(input\[type=checkbox\],input\[type=radio\]\)/);
 assert.match(css,/width:18px!important;height:18px!important/);
 assert.match(css,/appearance:auto/);
 assert.match(form,/className="fiscal-radio fiscal-no-invoice"/);
 assert.match(form,/checked=\{noInvoice\}/);
});
test('modal tem dois cards, dados alinhados e campos fiscais com a mesma logica',()=>{
 assert.match(form,/className="fiscal-card" aria-labelledby="fiscal-payment-title"/);
 assert.match(form,/className="fiscal-card" aria-labelledby="fiscal-nf-title"/);
 assert.match(form,/className="fiscal-payment-summary"/);
 assert.match(form,/className="fiscal-recipient-grid"/);
 assert.match(form,/className="fiscal-recipient-options"/);
 assert.match(form,/context\.paidAt\.split/);
 assert.match(form,/formatBRL\(context\.amount\)/);
 assert.match(form,/taker_kind==='PATIENT'/);
 assert.match(form,/required readOnly=\{value\.taker_kind==='PATIENT'\}/);
 assert.match(form,/validCPF\(value\.taker_tax_id\)/);
 assert.match(form,/validPaymentParts\(parts,context\.amount\?\?0\)/);
 assert.match(form,/done\(\{\.\.\.value,payment_parts:parts,no_invoice:noInvoice/);
 assert.match(form,/noInvoice\?'Confirmar recebimento S\/N'/);
});
test('formas de pagamento mantem composição e removivel com resumo em barra separada',()=>{
 assert.match(parts,/className="payment-parts-list"/);
 assert.match(parts,/className="payment-parts-toolbar"/);
 assert.match(parts,/onChange\(\[\.\.\.value,\{method:'PIX',amount:0\}\]\)/);
 assert.match(parts,/onChange\(value\.filter\(\(_,i\)=>i!==index\)\)/);
 assert.match(parts,/paymentDifference\(value,amount\)/);
 assert.match(parts,/payment-parts-difference/);
 assert.match(parts,/payment-parts-ok/);
 assert.match(css,/dialog\.fiscal-confirmation-dialog \.fiscal-confirmation \.payment-parts-toolbar/);
 assert.match(css,/dialog\.fiscal-confirmation-dialog \.fiscal-confirmation \.fiscal-recipient-grid/);
 assert.match(css,/@media\(max-width:620px\)/);
});

test('CSS isolado é importado pelo componente, com estilo inline defensivo e bust do legado',()=>{
 assert.match(form,/import '\.\/confirm-fiscal-payment\.css'/);
 assert.match(form,/data-layout-version="receipt-20261021-v2"/);
 assert.match(form,/style=\{\{width:18,height:18,minWidth:18,minHeight:18/);
 const legacy=readFileSync('app/dashboard/legacy-app.tsx','utf8');
 const scriptVersion=legacy.match(/legacy-app\.js\?v=([a-z0-9-]+)/)?.[1];
 const styleVersion=legacy.match(/legacy\.css\?v=([a-z0-9-]+)/)?.[1];
 assert.ok(scriptVersion,'script da agenda deve usar identificador de versão');
 assert.equal(styleVersion,scriptVersion,'CSS e script precisam atualizar o cache juntos');
 const globals=readFileSync('app/globals.css','utf8');
 assert.doesNotMatch(globals,/\.fiscal-confirmation input:not\(\[type=radio\]\)/);
});
