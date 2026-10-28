import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('agenda PDF uses the same scheduling entitlement as the agenda API',()=>{
 const report=source('app/api/reports/agenda/route.ts');
 const state=source('app/api/state/route.ts');
 assert.match(report,/import \{canUseAgenda\} from '@\/lib\/doctor-services'/);
 assert.match(report,/if\(!session\|\|!canUseAgenda\(session\)\)return Response\.json\(\{error:'Acesso negado\.'\},\{status:403\}\)/);
 assert.match(state,/!session\?\.account \|\| !canUseAgenda\(session\)/);
});

test('doctors without an enabled schedule cannot use the agenda, even with a doctor ID',()=>{
 const compiled=ts.transpileModule(source('lib/doctor-services.ts'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText;
 const exports={};
 new Function('exports',compiled)(exports);
 const canUseAgenda=exports.canUseAgenda;
 assert.equal(canUseAgenda({account:{role:'doctor',doctorId:'dr1'},services:{scheduling_enabled:false,billing_enabled:true,invoice_enabled:true}}),false);
 assert.equal(canUseAgenda({account:{role:'doctor',doctorId:'dr1'},services:{scheduling_enabled:false,billing_enabled:false,invoice_enabled:false}}),false);
 assert.equal(canUseAgenda({account:{role:'doctor',doctorId:null},services:{scheduling_enabled:true,billing_enabled:false,invoice_enabled:false}}),false);
 assert.equal(canUseAgenda({account:{role:'doctor',doctorId:'dr1'},services:{scheduling_enabled:true,billing_enabled:false,invoice_enabled:false}}),true);
 assert.equal(canUseAgenda({account:{role:'secretary'},services:{scheduling_enabled:false}}),true);
 assert.equal(canUseAgenda({account:{role:'general_manager'},services:{scheduling_enabled:false}}),true);
});
