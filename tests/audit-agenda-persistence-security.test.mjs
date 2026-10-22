import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const agenda=readFileSync('public/legacy-app.js','utf8');
const privilege=readFileSync('supabase/migrations/20261022090000_restrict_legacy_function_exposure.sql','utf8');
test('cancelamento e reagendamento só informam sucesso depois da confirmação do servidor',()=>{
 assert.match(agenda,/hist\(a\.patientId,"Agendamento cancelado"[\s\S]{0,250}if\(await persist\(\)===false\)return;closeModals\(\);toast\("Agendamento movido para Cancelados\."\)/);
 assert.match(agenda,/hist\(a\.patientId,"Reagendado"[\s\S]{0,250}if\(await persist\(\)===false\)return;closeModals\(\)/);
});
test('cadastro do paciente, regras e bloqueios aguardam persistencia remota',()=>{
 for(const marker of ['Paciente salvo.','Bloqueio salvo.','Bloqueio excluído.','Regra salva.','Regra excluída.']){
  const i=agenda.indexOf('toast("'+marker+'")');
  assert.ok(i>0,'ausente '+marker);
  assert.match(agenda.slice(i-130,i),/if\(await persist\(\)===false\)return;closeModals\(\);/,'persistencia esperada: '+marker);
 }
 assert.match(agenda,/\$\("patientForm"\)\.onsubmit=async e=>/);
 assert.match(agenda,/\$\("ruleForm"\)\.onsubmit=async e=>/);
 assert.match(agenda,/\$\("blockForm"\)\.onsubmit=async e=>/);
});
test('status só confirma quando estado foi persistido',()=>{
 assert.match(agenda,/hist\(a\.patientId,"Status alterado"[\s\S]{0,260}if\(await persist\(\)===false\)return;renderAppointmentDetail\(a\);toast/);
});
test('remove funções legadas sem referências ativas',()=>{
 assert.doesNotMatch(agenda,/function evaluateBlocks\(/);
 assert.doesNotMatch(agenda,/function requestAppointmentStatus\(/);
});
test('restringe execucao das funcoes sensiveis para papéis publicos',()=>{
 assert.match(privilege,/revoke execute on function public\.restore_billing_invoice\(bigint,jsonb\) from public, anon, authenticated/);
 assert.match(privilege,/grant execute on function public\.restore_billing_invoice\(bigint,jsonb\) to service_role/);
 assert.match(privilege,/revoke execute on function public\.guard_billing_monthly_closing_immutable\(\) from public, anon, authenticated/);
 assert.match(privilege,/revoke execute on function public\.log_monthly_financial_action\(\) from public, anon, authenticated/);
});
