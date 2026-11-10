import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Textos jurídicos: dados do fornecedor num só lugar, prazos decididos e aceite no cadastro.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('provider and DPO data live in one place and prazos match the decision of 2026-11-10',()=>{
 const legal=read('lib/legal.ts');
 for(const key of ['provider','cnpj','address','forum','contactEmail','dpoName','dpoEmail'])assert.match(legal,new RegExp(`${key}: "`),key);
 assert.match(legal,/exportWindowDays: 30/);
 assert.match(legal,/deletionWithinDays: 60/);
 assert.match(legal,/incidentNoticeHours: 48/);
 assert.match(legal,/TERMS_VERSION = "[^"]*rascunho"/,'stays a draft until legal review');
 for(const page of ['app/termos/page.tsx','app/privacidade/page.tsx','app/contrato-operador/page.tsx']){
  const src=read(page);
  assert.match(src,/from "@\/lib\/legal"/,page);
  assert.doesNotMatch(src,/\[(RAZÃO SOCIAL|CNPJ|NOME DO ENCARREGADO)\]/,page+' must use LEGAL constants, not hard-coded blanks');
 }
});

test('privacy policy names the real suboperators, the single session cookie and international transfer',()=>{
 const privacy=read('app/privacidade/page.tsx'),dpa=read('app/contrato-operador/page.tsx');
 for(const src of [privacy,dpa]){
  assert.match(src,/Supabase/);assert.match(src,/Vercel/);assert.match(src,/Resend/);
  assert.match(src,/art\. 33/);
 }
 assert.match(privacy,/apenas um cookie essencial de sessão/);
 assert.match(privacy,/até 8 horas/);
 assert.match(dpa,/arts\. 37 a 40/);
});

test('signup accepts all three documents on behalf of the organization; invitees see terms and privacy',()=>{
 const forms=read('components/auth-forms.tsx');
 assert.match(forms,/name="acceptTerms" required/);
 assert.match(forms,/href="\/termos"[\s\S]*?href="\/privacidade"[\s\S]*?href="\/contrato-operador"/);
 assert.match(forms,/Ao criar seu acesso, você concorda com os/);
 assert.match(read('components/legal-page.tsx'),/\["\/contrato-operador", "Contrato de tratamento de dados"\]/);
});
