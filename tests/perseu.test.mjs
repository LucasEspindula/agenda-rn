import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

const engine=loadTs('lib/perseu/inspect.ts');
const normalize=loadTs('lib/perseu/normalize.ts');
const semanticNormalize=loadTs('lib/perseu/semantic/normalize.ts');
const persistence=loadTs('lib/perseu/persistence.ts');
const supervision=loadTs('lib/perseu/supervision/rules.ts');
const supervisionReview=loadTs('lib/perseu/supervision/review.ts');
const operationalHistory=loadTs('lib/perseu/operational-history.ts');
const text=value=>new TextEncoder().encode(value);

test('Perseu uses the official SheetJS CE 0.20.3 package source',()=>{
 const packageJson=readFileSync('package.json','utf8'),lock=readFileSync('package-lock.json','utf8');
 assert.match(packageJson,/https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz/);
 assert.match(lock,/https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz/);
 assert.doesNotMatch(lock,/xlsx@0\.18\.5|"version": "0\.18\.5"/);
});

test('Perseu parses CSV delimiters, preserves original headers and skips empty lines',()=>{
 for(const [delimiter,label] of [[',','vírgula'],[';','ponto e vírgula'],['\t','tab']]){
  const inspection=engine.inspectPerseusDocument('CSV',text(` Nome do Beneficiário ${delimiter}Número Guia\nAna${delimiter}123\n\nBruno${delimiter}456\n`));
  assert.equal(inspection.kind,'parsed',label);if(inspection.kind!=='parsed')continue;
  assert.equal(inspection.result.items.length,2);
  assert.equal(inspection.result.items[0].rawData['Nome do Beneficiário'],'Ana');
  assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.structure.columns?.map(column=>column.normalized))),['nome_do_beneficiario','numero_guia']);
 }
});

test('Perseu finds delayed CSV headers, independent tables and physical multiline origins',()=>{
 const delayed=engine.inspectPerseusDocument('CSV',text('RELATÓRIO DO CONVÊNIO\nCompetência: 10/2026\n\nNome;Guia;Valor\nAna;1;10\nBia;2;20\n\nTOTAL; ;30\n'));
 assert.equal(delayed.kind,'parsed');if(delayed.kind!=='parsed')return;
 assert.equal(delayed.result.items.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(delayed.result.structure.tables?.[0].headerLocation)),{row:4,column:1});
 assert.equal(delayed.result.items[0].source?.row,5);
 const multiple=engine.inspectPerseusDocument('CSV',text('RESUMO\nCódigo;Total\nA;100\nB;200\n\nDETALHAMENTO\nIdentificador;Descrição;Quantidade\n1;Item A;1\n2;Item B;2\n'));
 assert.equal(multiple.kind,'parsed');if(multiple.kind!=='parsed')return;
 assert.equal(multiple.result.structure.tables?.length,2);
 assert.equal(multiple.result.structure.tables?.[0].recordCount,2);
 assert.equal(multiple.result.structure.tables?.[1].recordCount,2);
 const multiline=engine.inspectPerseusDocument('CSV',text('Nome;Descrição\n"Ana\nMaria";Teste\nBruno;Outro\n'));
 assert.equal(multiline.kind,'parsed');if(multiline.kind!=='parsed')return;
 assert.deepEqual(JSON.parse(JSON.stringify(multiline.result.items.map(item=>item.source?.row))),[2,4]);
});

test('Perseu reads one and multiple XLSX sheets without executing formulas',()=>{
 const workbook=XLSX.utils.book_new();
 const first=XLSX.utils.aoa_to_sheet([['Paciente','Valor'],['Ana',10],['Bruno',20]]);
 const second=XLSX.utils.aoa_to_sheet([['Guia','Status'],['123','OK']]);
 XLSX.utils.book_append_sheet(workbook,first,'Demonstrativo');XLSX.utils.book_append_sheet(workbook,second,'Retorno');
 const inspection=engine.inspectPerseusDocument('XLSX',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.structure.sheetCount,2);
 assert.equal(inspection.result.items.length,3);
 assert.equal(inspection.result.items[2].source?.sheet,'Retorno');
 assert.equal(inspection.result.items[0].source?.row,2);
});

test('Perseu detects XLSX tables from physical rows and columns',()=>{
 const workbook=XLSX.utils.book_new();
 const delayed=XLSX.utils.aoa_to_sheet([[null,null,null],[null,null,null],['Demonstrativo'],[null,null,null,'Nome','Guia','Valor'],[null,null,null,'Ana','1','10'],[null,null,null,'Bia','2','20'],[],[null,null,null,'Código','Total'],[null,null,null,'A','100'],[null,null,null,'B','200']]);
 XLSX.utils.book_append_sheet(workbook,delayed,'Dados');
 const inspection=engine.inspectPerseusDocument('XLSX',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.structure.tables?.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.structure.tables?.[0].region)),{rowStart:4,rowEnd:6,columnStart:4,columnEnd:6});
 assert.equal(inspection.result.items[0].source?.sheet,'Dados');
 assert.equal(inspection.result.items[0].source?.row,5);
 assert.equal(inspection.result.items[0].source?.region?.columnStart,4);
});

test('Perseu preserves duplicate headers, all cell values and deterministic structural origin',()=>{
 const inspection=engine.inspectPerseusDocument('CSV',text('Valor;Valor\n100;200\n'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.structure.columns)),[
  {original:'Valor',key:'Valor',normalized:'valor'},
  {original:'Valor',key:'Valor [2]',normalized:'valor_2'}
 ]);
 assert.equal(inspection.result.items[0].rawData.Valor,'100');
 assert.equal(inspection.result.items[0].rawData['Valor [2]'],'200');
 assert.match(inspection.result.warnings.join(' '),/Cabeçalhos duplicados/);
 const rows=persistence.perseusItemRows(inspection.result);
 assert.deepEqual(JSON.parse(JSON.stringify(rows[0].source_metadata)),{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:2}});
 assert.equal(rows[0].raw_data['Valor [2]'],'200');
});

test('Perseu extracts repeated XML records and rejects malformed or unsafe XML',()=>{
 const inspection=engine.inspectPerseusDocument('XML',text('<retorno><itens><item><nome>Ana</nome><guia>1</guia></item><item><nome>Bruno</nome><guia>2</guia></item></itens></retorno>'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.items.length,2);assert.equal(inspection.result.items[0].rawData.nome,'Ana');
 assert.equal(inspection.result.items[0].source?.path,'retorno.itens.item[0]');
 assert.throws(()=>engine.inspectPerseusDocument('XML',text('<retorno><item></retorno>')),/XML malformado/);
 assert.throws(()=>engine.inspectPerseusDocument('XML',text('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r><x>&xxe;</x></r>')),/DTD ou entidade externa/);
});

test('Perseu preserves independent XML collections without selecting nested duplicates',()=>{
 const inspection=engine.inspectPerseusDocument('XML',text('<retorno><resumo><linha><codigo>A</codigo></linha><linha><codigo>B</codigo></linha></resumo><detalhes><item><id>1</id><descricao>X</descricao></item><item><id>2</id><descricao>Y</descricao></item></detalhes></retorno>'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.structure.tables?.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.items.map(item=>item.source?.tableId))),['xml-table-1','xml-table-1','xml-table-2','xml-table-2']);
 assert.match(inspection.result.items[0].source?.path||'',/\[0\]$/);
});

test('Perseu persists CSV, XLSX and XML source metadata alongside empty semantic data',()=>{
 const csv=engine.inspectPerseusDocument('CSV',text('Nome\nAna\n'));
 const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Nome'],['Ana']]),'Demonstrativo');
 const xlsx=engine.inspectPerseusDocument('XLSX',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
 const xml=engine.inspectPerseusDocument('XML',text('<retorno><itens><item><nome>Ana</nome></item><item><nome>Bruno</nome></item></itens></retorno>'));
 for(const [inspection,expected] of [[csv,{row:2,table_id:'csv-table-1'}],[xlsx,{sheet:'Demonstrativo',row:2,table_id:'xlsx-demonstrativo-table-1'}],[xml,{path:'retorno.itens.item[0]',table_id:'xml-table-1'}]]){
  assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')continue;
  const [row]=persistence.perseusItemRows(inspection.result);
  const metadata=JSON.parse(JSON.stringify(row.source_metadata));
  assert.deepEqual(Object.fromEntries(Object.entries(metadata).filter(([key])=>key!=='region')),expected);
  assert.ok(metadata.region);
  assert.deepEqual(Object.keys(row).sort(),['normalized_data','raw_data','semantic_evidence','source_index','source_metadata']);
  assert.deepEqual(JSON.parse(JSON.stringify(row.normalized_data)),{});
  assert.deepEqual(JSON.parse(JSON.stringify(row.semantic_evidence)),{});
 }
});

test('Perseu interprets supported insurance headings with normalized values and auditable evidence',()=>{
 const inspection=engine.inspectPerseusDocument('CSV',text('Benefici\u00e1rio;N\u00ba Guia;Data do atendimento;C\u00f3digo TUSS;Procedimento;Valor cobrado;Valor aprovado;Valor pago;Diferen\u00e7a;C\u00f3digo da glosa;Motivo da glosa\nAna Silva;000123;05/10/2026;40101010;Colonoscopia;R$ 1.500,00;1200.5;999,99;200,51;G01;Documento incompleto\n'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 const item=inspection.result.items[0];
 assert.deepEqual(JSON.parse(JSON.stringify(item.normalizedData)),{
  patient_name:'Ana Silva',guide_number:'000123',service_date:'2026-10-05',procedure_code:'40101010',procedure_description:'Colonoscopia',amount_presented:'1500.00',amount_approved:'1200.50',gloss_code:'G01',gloss_reason:'Documento incompleto'
 });
 assert.equal(item.normalizedData?.amount_glossed,undefined);
 assert.equal(item.semanticEvidence?.amount_presented.classification,'HIGH');
 assert.match(JSON.stringify(item.semanticEvidence?.amount_presented.reasons),/cabe\u00e7alho reconhecido/);
 const semantic=inspection.result.semantic;
 assert.equal(semantic?.version,'1.0.0');
 assert.equal(semantic?.tables[0].columns.find(column=>column.sourceColumn==='Valor pago')?.classification,'UNKNOWN');
 assert.equal(semantic?.tables[0].columns.find(column=>column.sourceColumn==='Diferen\u00e7a')?.classification,'UNKNOWN');
 const row=persistence.perseusItemRows(inspection.result)[0];
 assert.equal(row.amount_presented,'1500.00');
 assert.equal(row.service_date,'2026-10-05');
 assert.equal(row.guide_number,'000123');
});

test('Perseu remains conservative with generic, ambiguous, invalid and total rows',()=>{
 const inspection=engine.inspectPerseusDocument('CSV',text('Nome;Valor;Data;Valor Glosado;Valor Glosado\nAna;1.500;31/02/2026;-1.500,00;200,00\nTOTAL;1.500;05/10/2026;0;0\n'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 const semantic=inspection.result.semantic?.tables[0];
 assert.equal(semantic?.columns.find(column=>column.sourceColumn==='Nome')?.classification,'UNKNOWN');
 assert.equal(semantic?.columns.find(column=>column.sourceColumn==='Valor')?.classification,'UNKNOWN');
 assert.equal(semantic?.columns.filter(column=>column.sourceColumn==='Valor Glosado').every(column=>column.classification==='AMBIGUOUS'),true);
 assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.items[0].normalizedData)),{});
 assert.equal(semanticNormalize.normalizeDate('2026-01-09').value,'2026-01-09');
 assert.equal(semanticNormalize.normalizeDate('09/01/2026').value,'2026-01-09');
 assert.equal(semanticNormalize.normalizeDate('31/02/2026').value,undefined);
 assert.equal(semanticNormalize.normalizeAmount('-1.500,00').value,'-1500.00');
 assert.equal(semanticNormalize.normalizeAmount('1.500').value,undefined);
 assert.equal(semanticNormalize.normalizeAmount('').value,undefined);
});

test('Perseu structural normalization and fingerprint are deterministic and contain no row values',()=>{
 assert.equal(normalize.normalizeStructuralKey(' Nome do Beneficiário '),'nome_do_beneficiario');
 const first=engine.inspectPerseusDocument('CSV',text('Nome;Guia\nAna;1\n'));
 const second=engine.inspectPerseusDocument('CSV',text('Nome;Guia\nBruno;2\n'));
 assert.equal(first.kind,'parsed');assert.equal(second.kind,'parsed');if(first.kind!=='parsed'||second.kind!=='parsed')return;
 assert.equal(first.result.layoutFingerprint,second.result.layoutFingerprint);
 assert.doesNotMatch(first.result.layoutFingerprint,/Ana|Bruno/);
 const reordered=engine.inspectPerseusDocument('CSV',text('Guia;Nome\n1;Ana\n'));
 assert.equal(reordered.kind,'parsed');if(reordered.kind==='parsed')assert.notEqual(first.result.layoutFingerprint,reordered.result.layoutFingerprint);
});

test('Perseu returns an auditable empty result for a document without a table',()=>{
 const inspection=engine.inspectPerseusDocument('CSV',text('RELATÓRIO\nEmitido em 10/10/2026\n'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.items.length,0);
 assert.match(inspection.result.warnings.join(' '),/Nenhuma estrutura tabular/);
});

test('Perseu keeps unsupported formats outside FAILED and delegates replacement to its atomic RPC',()=>{
 const unsupported=engine.inspectPerseusDocument('PDF',text('%PDF- example'));
 assert.deepEqual(JSON.parse(JSON.stringify(unsupported)),{kind:'unsupported',format:'PDF',message:'O Perseu ainda não possui parser para este formato.'});
 const route=readFileSync('app/api/insurance-control/analyze/route.ts','utf8');
 assert.match(route,/upload_status\s*!==\s*["']READY["']/);
 assert.match(route,/perseus_status\s*:\s*["']FAILED["']/);
 assert.doesNotMatch(route,/billing_records|invoices|attendance_id:/);
 assert.match(route,/\.rpc\(\s*["']replace_perseus_document_analysis["']/);
 assert.doesNotMatch(route,/\.from\('insurance_document_items'\)\.(delete|insert|upsert)/);
 assert.match(route,/consumeLimit\(\s*["']perseus-analyze["']/);
});

test('Perseu database replacement is locked, atomic and unique by source index',()=>{
 const migration=readFileSync('supabase/migrations/20261009200000_stabilize_perseus_structured_parsing.sql','utf8');
 assert.match(migration,/add column if not exists source_metadata jsonb not null default '\{\}'::jsonb/);
 assert.match(migration,/insurance_document_items_document_source_key unique\(document_id,source_index\)/);
 assert.match(migration,/replace_perseus_document_analysis/);
 assert.match(migration,/for update/);
 assert.match(migration,/delete from public\.insurance_document_items where document_id=p_document_id/);
 assert.match(migration,/insert into public\.insurance_document_items\(document_id,source_index,raw_data,normalized_data,source_metadata,match_status\)/);
 assert.match(migration,/perseus_status='REVIEW_REQUIRED'/);
 assert.match(migration,/revoke all on function .* from public,anon,authenticated/);
 assert.match(migration,/grant execute .* to service_role/);
 assert.doesNotMatch(migration,/billing_records|invoice_billing_records|attendance_id/);
 const adaptiveMigration=readFileSync('supabase/migrations/20261013170000_perseus_adaptive_structure.sql','utf8');
 assert.match(adaptiveMigration,/'table_id',item\.source_metadata->'table_id'/);
 assert.match(adaptiveMigration,/'region',item\.source_metadata->'region'/);
 assert.match(adaptiveMigration,/for update/);
 assert.match(adaptiveMigration,/revoke all on function .* from public,anon,authenticated/);
 const semanticMigration=readFileSync('supabase/migrations/20261014160000_perseus_semantic_interpretation.sql','utf8');
 assert.match(semanticMigration,/for update/);
 assert.match(semanticMigration,/match_evidence/);
 assert.match(semanticMigration,/patient_name,beneficiary_number,guide_number/);
 assert.match(semanticMigration,/attendance_id is not null or billing_record_id is not null/);
 assert.match(semanticMigration,/revoke all on function .* from public,anon,authenticated/);
 assert.doesNotMatch(semanticMigration,/insert into public\.(billing_records|invoices|invoice_billing_records|attendances)/);
});

test('Perseu replace RPC rolls back all item changes when an insert fails',async()=>{
 const db=new PGlite();
 const migration=readFileSync('supabase/migrations/20261009200000_stabilize_perseus_structured_parsing.sql','utf8');
 const adaptiveMigration=readFileSync('supabase/migrations/20261013170000_perseus_adaptive_structure.sql','utf8');
 const semanticMigration=readFileSync('supabase/migrations/20261014160000_perseus_semantic_interpretation.sql','utf8');
 const documentId='11111111-1111-4111-8111-111111111111';
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table insurance_documents(id uuid primary key,upload_status text not null,parser_key text,parser_version text,raw_metadata jsonb not null default '{}'::jsonb,perseus_status text not null default 'NOT_ANALYZED',updated_at timestamptz,updated_by bigint);
  create table insurance_document_items(id uuid primary key default gen_random_uuid(),document_id uuid not null references insurance_documents(id),source_index integer,raw_data jsonb not null check(raw_data ? 'value'),normalized_data jsonb not null default '{}'::jsonb,match_status text,match_evidence jsonb not null default '{}'::jsonb,source_metadata jsonb not null default '{}'::jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text,attendance_id uuid,billing_record_id uuid);
  grant all on insurance_documents,insurance_document_items to service_role;
  insert into insurance_documents(id,upload_status) values('${documentId}','READY');`);
 await db.exec(migration);
 await db.exec(adaptiveMigration);
 await db.exec(semanticMigration);
 await db.exec('set role service_role');
 const call=(items,key='parser-a')=>db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(items),key,'1.0.0',JSON.stringify({row_count:items.length}),1]);
 await call([{source_index:0,raw_data:{value:'before'},normalized_data:{patient_name:'Ana'},semantic_evidence:{patient_name:{classification:'HIGH'}},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}},patient_name:'Ana'}]);
 await assert.rejects(()=>call([{source_index:0,raw_data:{value:'after'}},{source_index:1,raw_data:{}}],'parser-b'));
 const items=(await db.query('select source_index,raw_data,normalized_data,match_evidence,source_metadata,patient_name from insurance_document_items where document_id=$1',[documentId])).rows;
 const document=(await db.query('select parser_key,perseus_status from insurance_documents where id=$1',[documentId])).rows[0];
 assert.deepEqual(JSON.parse(JSON.stringify(items)),[{source_index:0,raw_data:{value:'before'},normalized_data:{patient_name:'Ana'},match_evidence:{patient_name:{classification:'HIGH'}},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}},patient_name:'Ana'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(document)),{parser_key:'parser-a',perseus_status:'REVIEW_REQUIRED'});
 await assert.rejects(()=>call([{source_index:0,raw_data:{value:'one'}},{source_index:0,raw_data:{value:'two'}}]));
 await db.close();
});

test('Perseu enforces bounded structural input',()=>{
 const header=Array.from({length:161},(_,index)=>'C'+index).join(';');
 assert.throws(()=>engine.inspectPerseusDocument('CSV',text(header+'\n'+header+'\n')),/limite de colunas/);
 assert.throws(()=>engine.inspectPerseusDocument('CSV',text('Campo\n'+'x'.repeat(10001)+'\n')),/limite de tamanho de célula/);
 assert.throws(()=>engine.inspectPerseusDocument('CSV',text('Campo\n'+Array.from({length:10001},()=> 'x').join('\n'))),/limite de linhas/);
});

test('Perseu preview keeps detected tables distinct instead of mixing their columns',()=>{
 const ui=readFileSync('app/billing/insurance-control.tsx','utf8');
 assert.match(ui,/previewTableId/);
 assert.match(ui,/sourceMetadata\.table_id\s*===\s*selectedTable\.table_id/);
 assert.match(ui,/Estrutura identificada/);
 assert.match(ui,/perseus-preview-table-select/);
 assert.match(ui,/Interpreta\u00e7\u00e3o normalizada/);
});

test('Perseu learned mappings are strictly scoped and conflicts remain reviewable',()=>{
 const table={columns:[{normalized:'beneficiario'},{normalized:'guia'}]};
 const context={domain:'INSURANCE',billingEntityId:'entity-a',payerNormalized:'UNIMED',movementKind:'PROCESSING',layoutFingerprint:'layout-a',tableSignature:supervision.perseusTableSignature(table)};
 const rule={id:'rule-1',...context,columnNormalized:'beneficiario',semanticField:'patient_name',state:'ACTIVE',version:1};
 assert.equal(supervision.compatiblePerseusRules([rule],context,'beneficiario').length,1);
 assert.equal(supervision.compatiblePerseusRules([rule],{...context,payerNormalized:'OUTRO'},'beneficiario').length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(supervision.learnedRuleDecision([rule]))),{kind:'suggestion',field:'patient_name',ruleId:'rule-1'});
 assert.deepEqual(JSON.parse(JSON.stringify(supervision.learnedRuleDecision([rule,{...rule,id:'rule-2',semanticField:'guide_number'}]))),{kind:'conflict'});
});

test('Perseu keeps the source of a semantic suggestion distinct from its confidence',()=>{
 const column={classification:'MEDIUM',origin:'LEARNED_SUGGESTION',ruleId:'rule-1'};
 assert.equal(column.classification,'MEDIUM');
 assert.equal(operationalHistory.perseusOriginLabel(column.origin),'Aprendido anteriormente');
 assert.match(readFileSync('app/billing/insurance-control.tsx','utf8'),/perseusOriginLabel\(column\.origin\)/);
 assert.match(readFileSync('app/billing/insurance-control.tsx','utf8'),/classifica(?:ção|cao).*MEDIUM|column\.classification/);
});

test('Perseu operational event metadata is compact and never carries raw cells or financial values',()=>{
 const metadata=operationalHistory.safePerseusEventMetadata({
  column:' Valor apresentado ',field:'amount_presented',tables:2,records:12,
  patient:'Ana Maria',rawCell:'350,00',amount:'350,00',nested:{name:'Ana'},
 });
 assert.deepEqual(JSON.parse(JSON.stringify(metadata)),{column:'Valor apresentado',field:'amount_presented',tables:2,records:12});
});

test('Perseu Phase 3C protects reviewed documents and keeps supervision server-only',()=>{
 const migration=readFileSync('supabase/migrations/20261015120000_perseus_supervised_semantics.sql','utf8');
 const route=readFileSync('app/api/insurance-control/semantic-review/route.ts','utf8');
 assert.match(migration,/perseus_semantic_reviews/);
 assert.match(migration,/perseus_semantic_rules/);
 assert.match(migration,/perseus_semantic_value_corrections/);
 assert.match(migration,/O documento possui revisão humana/);
 assert.match(migration,/for update/);
 assert.match(migration,/revoke all on table .* from public,anon,authenticated/);
 assert.match(migration,/grant all on table .* to service_role/);
 assert.match(route,/canManageInsurance/);
 assert.match(route,/consumeLimit\('perseus-semantic-review'/);
 assert.match(route,/apply_perseus_semantic_review/);
 assert.doesNotMatch(route,/billing_records|invoice_billing_records|attendances/);
});

test('Perseu applies an approved mapping to all raw values without touching independent fields',()=>{
 const updates=supervisionReview.projectSemanticReview([
  {id:'a',rawData:{Valor:'350,00',Guia:'001'},normalizedData:{guide_number:'001'},semanticEvidence:{guide_number:{sourceKey:'Guia'}}},
  {id:'b',rawData:{Valor:'500,00',Guia:'002'},normalizedData:{guide_number:'002'},semanticEvidence:{guide_number:{sourceKey:'Guia'}}},
 ],'Valor','amount_presented');
 assert.equal(updates[0].normalizedData.amount_presented,'350.00');
 assert.equal(updates[1].normalizedData.amount_presented,'500.00');
 assert.equal(updates[0].typed.amount_presented,'350.00');
 assert.equal(updates[0].normalizedData.guide_number,'001');
 assert.equal(updates[0].semanticEvidence.amount_presented.origin,'USER_CONFIRMED');
 const remapped=supervisionReview.projectSemanticReview(updates.map((row,index)=>({id:row.id,rawData:{Valor:index?'500,00':'350,00'},normalizedData:row.normalizedData,semanticEvidence:row.semanticEvidence})),'Valor','amount_approved');
 assert.equal(remapped[0].normalizedData.amount_presented,undefined);
 assert.equal(remapped[0].normalizedData.amount_approved,'350.00');
});

test('Perseu adapts real Supabase snake_case rules before matching them',()=>{
 const table={columns:[{normalized:'valor_cobrado'}]},context={domain:'INSURANCE',billingEntityId:'entity-a',payerNormalized:'UNIMED',movementKind:'PROCESSING',layoutFingerprint:'layout-a',tableSignature:supervision.perseusTableSignature(table)};
 const rule=supervision.adaptSupabaseSemanticRule({id:'rule-a',domain:'INSURANCE',billing_entity_id:'entity-a',payer_normalized:'UNIMED',movement_kind:'PROCESSING',layout_fingerprint:'layout-a',table_signature:context.tableSignature,column_normalized:'valor_cobrado',semantic_field:'amount_presented',state:'ACTIVE',version:1});
 assert.ok(rule);
 const compatible=supervision.compatiblePerseusRules([rule],context,'valor_cobrado');
 assert.equal(compatible.length,1);
 assert.equal(supervision.learnedRuleDecision(compatible).field,'amount_presented');
});

test('Perseu applies and reuses a supervised mapping atomically for every table item',async()=>{
 const db=new PGlite();
 const stabilization=readFileSync('supabase/migrations/20261009200000_stabilize_perseus_structured_parsing.sql','utf8');
 const adaptive=readFileSync('supabase/migrations/20261013170000_perseus_adaptive_structure.sql','utf8');
 const semantic=readFileSync('supabase/migrations/20261014160000_perseus_semantic_interpretation.sql','utf8');
 const supervised=readFileSync('supabase/migrations/20261015120000_perseus_supervised_semantics.sql','utf8');
 const entityId='11111111-1111-4111-8111-111111111111',movementId='22222222-2222-4222-8222-222222222222',documentId='33333333-3333-4333-8333-333333333333';
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table billing_entities(id uuid primary key);
  create table insurance_movements(id uuid primary key,billing_entity_id uuid not null references billing_entities(id),payer text not null,kind text not null);
  create table insurance_documents(id uuid primary key,movement_id uuid not null references insurance_movements(id),upload_status text not null,parser_key text,parser_version text,raw_metadata jsonb not null default '{}'::jsonb,perseus_status text not null default 'NOT_ANALYZED',updated_at timestamptz,updated_by bigint);
  create table insurance_document_items(id uuid primary key default gen_random_uuid(),document_id uuid not null references insurance_documents(id),source_index integer,raw_data jsonb not null check(raw_data ? 'value'),normalized_data jsonb not null default '{}'::jsonb,match_status text,match_evidence jsonb not null default '{}'::jsonb,source_metadata jsonb not null default '{}'::jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text,attendance_id uuid,billing_record_id uuid);
  grant all on billing_entities,insurance_movements,insurance_documents,insurance_document_items to service_role;
  insert into billing_entities values('${entityId}');
  insert into insurance_movements values('${movementId}','${entityId}','Unimed','PROCESSING');
  insert into insurance_documents(id,movement_id,upload_status) values('${documentId}','${movementId}','READY');`);
 await db.exec(stabilization);await db.exec(adaptive);await db.exec(semantic);await db.exec(supervised);
 // PGlite does not model the service-role RLS bypass used by Supabase; disable it only in this isolated RPC fixture.
 await db.exec('alter table perseus_semantic_reviews disable row level security;alter table perseus_semantic_rules disable row level security;alter table perseus_semantic_value_corrections disable row level security;set role service_role');
 const sourceItems=[
  {source_index:0,raw_data:{value:'row-1',Valor:'350,00'},normalized_data:{},semantic_evidence:{},source_metadata:{table_id:'csv-table-1',row:2}},
  {source_index:1,raw_data:{value:'row-2',Valor:'500,00'},normalized_data:{},semantic_evidence:{},source_metadata:{table_id:'csv-table-1',row:3}},
 ];
 await db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(sourceItems),'csv','1.0.0',JSON.stringify({layout_fingerprint:'layout-a'}),7]);
 const context={billing_entity_id:entityId,payer_normalized:'UNIMED',movement_kind:'PROCESSING',layout_fingerprint:'layout-a',table_signature:'valor',column_normalized:'valor'};
 const review=async expected=>db.query('select apply_perseus_semantic_review($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9)',[documentId,'csv-table-1','Valor','amount_presented',true,JSON.stringify(context),JSON.stringify((await db.query('select id from insurance_document_items where document_id=$1 order by source_index',[documentId])).rows.map((row,value)=>({id:row.id,normalized_data:{amount_presented:value?'500.00':'350.00'},semantic_evidence:{amount_presented:{sourceKey:'Valor',origin:'USER_CONFIRMED'}},amount_presented:value?'500.00':'350.00'}))),expected,7]);
 let updatedAt=(await db.query('select updated_at from insurance_documents where id=$1',[documentId])).rows[0].updated_at;
 await review(updatedAt);
 const applied=(await db.query("select normalized_data,amount_presented::text,match_evidence from insurance_document_items where document_id=$1 order by source_index",[documentId])).rows;
 assert.deepEqual(JSON.parse(JSON.stringify(applied.map(row=>row.normalized_data))),[{amount_presented:'350.00'},{amount_presented:'500.00'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(applied.map(row=>row.amount_presented))),['350.00','500.00']);
 assert.equal(applied[0].match_evidence.amount_presented.origin,'USER_CONFIRMED');
 updatedAt=(await db.query('select updated_at from insurance_documents where id=$1',[documentId])).rows[0].updated_at;
 await review(updatedAt);
 assert.equal((await db.query("select count(*)::int as count from perseus_semantic_rules where state='ACTIVE'")).rows[0].count,1);
 assert.equal((await db.query('select count(*)::int as count from perseus_semantic_reviews where document_id=$1',[documentId])).rows[0].count,2);
 await assert.rejects(()=>db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(sourceItems),'csv','1.0.0',JSON.stringify({layout_fingerprint:'layout-a'}),7]),/revisão humana/);
 await db.close();
});

test('Perseu keeps operational events transactional, append-only and free of raw cells',async()=>{
 const db=new PGlite();
 const migrations=['20261009200000_stabilize_perseus_structured_parsing.sql','20261013170000_perseus_adaptive_structure.sql','20261014160000_perseus_semantic_interpretation.sql','20261015120000_perseus_supervised_semantics.sql','20261015142055_perseus_operational_history.sql'];
 const entityId='41111111-1111-4111-8111-111111111111',movementId='42222222-2222-4222-8222-222222222222',documentId='43333333-3333-4333-8333-333333333333';
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table billing_entities(id uuid primary key);
  create table insurance_movements(id uuid primary key,billing_entity_id uuid not null references billing_entities(id),payer text not null,kind text not null);
  create table insurance_documents(id uuid primary key,movement_id uuid not null references insurance_movements(id),upload_status text not null,parser_key text,parser_version text,raw_metadata jsonb not null default '{}'::jsonb,perseus_status text not null default 'NOT_ANALYZED',updated_at timestamptz,updated_by bigint);
  create table insurance_document_items(id uuid primary key default gen_random_uuid(),document_id uuid not null references insurance_documents(id),source_index integer,raw_data jsonb not null check(raw_data ? 'value'),normalized_data jsonb not null default '{}'::jsonb,match_status text,match_evidence jsonb not null default '{}'::jsonb,source_metadata jsonb not null default '{}'::jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text,attendance_id uuid,billing_record_id uuid);
  grant all on billing_entities,insurance_movements,insurance_documents,insurance_document_items to service_role;
  insert into billing_entities values('${entityId}');insert into insurance_movements values('${movementId}','${entityId}','IPE','PROCESSING');insert into insurance_documents(id,movement_id,upload_status) values('${documentId}','${movementId}','READY');`);
 for(const migration of migrations) await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
 await db.exec('alter table perseus_semantic_reviews disable row level security;alter table perseus_semantic_rules disable row level security;alter table perseus_semantic_value_corrections disable row level security;alter table perseus_document_events disable row level security;set role service_role');
 const items=[{source_index:0,raw_data:{value:'row-1',Valor:'350,00',Paciente:'Ana'},normalized_data:{},semantic_evidence:{},source_metadata:{table_id:'csv-table-1',row:2}}];
 const metadata={layout_fingerprint:'layout-a',row_count:1,column_count:3,structure:{tables:[{table_id:'csv-table-1'}]},semantic:{version:'1.0.0',tables:[{tableId:'csv-table-1',columns:[{sourceColumn:'Valor',sourceKey:'Valor',field:'amount_approved',origin:'HEURISTIC'}]}]}};
 await db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(items),'csv','1.0.0',JSON.stringify(metadata),7]);
 const expected=(await db.query('select updated_at from insurance_documents where id=$1',[documentId])).rows[0].updated_at;
 const item=(await db.query('select id from insurance_document_items where document_id=$1',[documentId])).rows[0];
 const context={billing_entity_id:entityId,payer_normalized:'IPE',movement_kind:'PROCESSING',layout_fingerprint:'layout-a',table_signature:'valor',column_normalized:'valor'};
 await db.query('select apply_perseus_semantic_review($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::timestamptz,$9)',[documentId,'csv-table-1','Valor','amount_approved',true,JSON.stringify(context),JSON.stringify([{id:item.id,normalized_data:{amount_approved:'350.00'},semantic_evidence:{amount_approved:{sourceKey:'Valor',origin:'USER_CONFIRMED'}},amount_approved:'350.00'}]),expected,7]);
 const events=(await db.query('select event_type,event_metadata from perseus_document_events where document_id=$1 order by occurred_at,id',[documentId])).rows;
 assert.ok(events.some(event=>event.event_type==='MAPPING_REVIEW_APPLIED'));
 assert.ok(events.some(event=>event.event_type==='LEARNED_RULE_CREATED'));
 assert.doesNotMatch(JSON.stringify(events),/Ana|350,00/);
 const analysesBefore=events.filter(event=>event.event_type==='ANALYSIS_COMPLETED').length;
 await assert.rejects(()=>db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(items),'csv','1.0.0',JSON.stringify(metadata),7]),/revisão humana/);
 const analysesAfter=(await db.query("select count(*)::int as count from perseus_document_events where document_id=$1 and event_type='ANALYSIS_COMPLETED'",[documentId])).rows[0].count;
 assert.equal(analysesAfter,analysesBefore);
 const rule=(await db.query("select id from perseus_semantic_rules where state='ACTIVE'",[])).rows[0];
 await db.query('select revoke_perseus_semantic_rule($1,$2)',[rule.id,9]);
 assert.equal((await db.query('select state from perseus_semantic_rules where id=$1',[rule.id])).rows[0].state,'REVOKED');
 assert.equal((await db.query("select count(*)::int as count from perseus_document_events where related_rule_id=$1 and event_type='LEARNED_RULE_REVOKED'",[rule.id])).rows[0].count,1);
 await db.close();
});
