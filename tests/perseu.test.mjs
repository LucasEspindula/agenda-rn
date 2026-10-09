import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import {loadTs} from './load-ts.mjs';

const engine=loadTs('lib/perseu/inspect.ts');
const normalize=loadTs('lib/perseu/normalize.ts');
const text=value=>new TextEncoder().encode(value);

test('Perseu parses CSV delimiters, preserves original headers and skips empty lines',()=>{
 for(const [delimiter,label] of [[',','vírgula'],[';','ponto e vírgula'],['\t','tab']]){
  const inspection=engine.inspectPerseusDocument('CSV',text(` Nome do Beneficiário ${delimiter}Número Guia\nAna${delimiter}123\n\nBruno${delimiter}456\n`));
  assert.equal(inspection.kind,'parsed',label);if(inspection.kind!=='parsed')continue;
  assert.equal(inspection.result.items.length,2);
  assert.equal(inspection.result.items[0].rawData['Nome do Beneficiário'],'Ana');
  assert.deepEqual(JSON.parse(JSON.stringify(inspection.result.structure.columns?.map(column=>column.normalized))),['nome_do_beneficiario','numero_guia']);
 }
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

test('Perseu extracts repeated XML records and rejects malformed or unsafe XML',()=>{
 const inspection=engine.inspectPerseusDocument('XML',text('<retorno><itens><item><nome>Ana</nome><guia>1</guia></item><item><nome>Bruno</nome><guia>2</guia></item></itens></retorno>'));
 assert.equal(inspection.kind,'parsed');if(inspection.kind!=='parsed')return;
 assert.equal(inspection.result.items.length,2);assert.equal(inspection.result.items[0].rawData.nome,'Ana');
 assert.throws(()=>engine.inspectPerseusDocument('XML',text('<retorno><item></retorno>')),/XML malformado/);
 assert.throws(()=>engine.inspectPerseusDocument('XML',text('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r><x>&xxe;</x></r>')),/DTD ou entidade externa/);
});

test('Perseu structural normalization and fingerprint are deterministic and contain no row values',()=>{
 assert.equal(normalize.normalizeStructuralKey(' Nome do Beneficiário '),'nome_do_beneficiario');
 const first=engine.inspectPerseusDocument('CSV',text('Nome;Guia\nAna;1\n'));
 const second=engine.inspectPerseusDocument('CSV',text('Nome;Guia\nBruno;2\n'));
 assert.equal(first.kind,'parsed');assert.equal(second.kind,'parsed');if(first.kind!=='parsed'||second.kind!=='parsed')return;
 assert.equal(first.result.layoutFingerprint,second.result.layoutFingerprint);
 assert.doesNotMatch(first.result.layoutFingerprint,/Ana|Bruno/);
});

test('Perseu keeps unsupported formats outside FAILED and the analysis endpoint remains document-only',()=>{
 const unsupported=engine.inspectPerseusDocument('PDF',text('%PDF- example'));
 assert.deepEqual(JSON.parse(JSON.stringify(unsupported)),{kind:'unsupported',format:'PDF',message:'O Perseu ainda não possui parser para este formato.'});
 const route=readFileSync('app/api/insurance-control/analyze/route.ts','utf8');
 assert.match(route,/upload_status!=='READY'/);
 assert.match(route,/perseus_status:'REVIEW_REQUIRED'/);
 assert.match(route,/perseus_status:'FAILED'/);
 assert.match(route,/match_status:'UNMATCHED'/);
 assert.match(route,/normalized_data:\{\}/);
 assert.doesNotMatch(route,/billing_records|invoices|attendance_id:/);
 assert.match(route,/replaceItems/);
 assert.match(route,/previous=await db\.from\('insurance_document_items'\)\.select\('\*'\)/);
 assert.match(route,/await db\.from\('insurance_document_items'\)\.insert\(previous\.data\)/);
 assert.match(route,/consumeLimit\('perseus-analyze'/);
});

test('Perseu enforces bounded structural input',()=>{
 const header=Array.from({length:161},(_,index)=>'C'+index).join(';');
 assert.throws(()=>engine.inspectPerseusDocument('CSV',text(header+'\n'+header+'\n')),/limite de colunas/);
 assert.throws(()=>engine.inspectPerseusDocument('CSV',text('Campo\n'+'x'.repeat(10001)+'\n')),/limite de tamanho de célula/);
});
