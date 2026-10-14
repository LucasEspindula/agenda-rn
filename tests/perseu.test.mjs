import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './load-ts.mjs';

const engine=loadTs('lib/perseu/inspect.ts');
const normalize=loadTs('lib/perseu/normalize.ts');
const persistence=loadTs('lib/perseu/persistence.ts');
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

test('Perseu persists CSV, XLSX and XML source metadata without semantic fields',()=>{
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
  assert.deepEqual(Object.keys(row).sort(),['raw_data','source_index','source_metadata']);
 }
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
 assert.match(route,/upload_status!=='READY'/);
 assert.match(route,/perseus_status:'FAILED'/);
 assert.doesNotMatch(route,/billing_records|invoices|attendance_id:/);
 assert.match(route,/\.rpc\('replace_perseus_document_analysis'/);
 assert.doesNotMatch(route,/\.from\('insurance_document_items'\)\.(delete|insert|upsert)/);
 assert.match(route,/consumeLimit\('perseus-analyze'/);
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
});

test('Perseu replace RPC rolls back all item changes when an insert fails',async()=>{
 const db=new PGlite();
 const migration=readFileSync('supabase/migrations/20261009200000_stabilize_perseus_structured_parsing.sql','utf8');
 const adaptiveMigration=readFileSync('supabase/migrations/20261013170000_perseus_adaptive_structure.sql','utf8');
 const documentId='11111111-1111-4111-8111-111111111111';
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table insurance_documents(id uuid primary key,upload_status text not null,parser_key text,parser_version text,raw_metadata jsonb not null default '{}'::jsonb,perseus_status text not null default 'NOT_ANALYZED',updated_at timestamptz,updated_by bigint);
  create table insurance_document_items(id uuid primary key default gen_random_uuid(),document_id uuid not null references insurance_documents(id),source_index integer,raw_data jsonb not null check(raw_data ? 'value'),normalized_data jsonb not null default '{}'::jsonb,match_status text,source_metadata jsonb not null default '{}'::jsonb);
  grant all on insurance_documents,insurance_document_items to service_role;
  insert into insurance_documents(id,upload_status) values('${documentId}','READY');`);
 await db.exec(migration);
 await db.exec(adaptiveMigration);
 await db.exec('set role service_role');
 const call=(items,key='parser-a')=>db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(items),key,'1.0.0',JSON.stringify({row_count:items.length}),1]);
 await call([{source_index:0,raw_data:{value:'before'},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}}}]);
 await assert.rejects(()=>call([{source_index:0,raw_data:{value:'after'}},{source_index:1,raw_data:{}}],'parser-b'));
 const items=(await db.query('select source_index,raw_data,source_metadata from insurance_document_items where document_id=$1',[documentId])).rows;
 const document=(await db.query('select parser_key,perseus_status from insurance_documents where id=$1',[documentId])).rows[0];
 assert.deepEqual(JSON.parse(JSON.stringify(items)),[{source_index:0,raw_data:{value:'before'},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}}}]);
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
 assert.match(ui,/sourceMetadata\.table_id===selectedTable\.table_id/);
 assert.match(ui,/Estrutura identificada/);
 assert.match(ui,/perseus-preview-table-select/);
});
