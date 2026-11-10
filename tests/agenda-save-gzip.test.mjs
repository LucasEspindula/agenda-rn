import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {loadTs} from './load-ts.mjs';

// Salvamento mais leve: o navegador manda a agenda compactada em gzip e o servidor descompacta
// conferindo o limite sobre o tamanho já descompactado.
const http=loadTs('lib/security/http.ts');
const post=(body,headers={})=>new Request('https://example.com',{method:'PUT',headers:{'content-type':'application/json',...headers},body});

test('gzip body is read as the same JSON',async()=>{
 const value={appointments:Array.from({length:200},(_,i)=>({id:`a${i}`,procedure:'Consulta de rotina'}))};
 const packed=gzipSync(JSON.stringify(value));
 assert.ok(packed.length<JSON.stringify(value).length/5);
 assert.deepEqual(JSON.parse(JSON.stringify(await http.readJson(post(packed,{'content-encoding':'gzip'}),1024*1024))),value);
 assert.deepEqual(JSON.parse(JSON.stringify(await http.readJson(post('{"ok":true}',{'content-encoding':'identity'})))),{ok:true});
});

test('the size cap applies after decompression, so a small bomb is cut',async()=>{
 const bomb=gzipSync(JSON.stringify({x:'x'.repeat(5_000_000)}));
 assert.ok(bomb.length<64*1024);
 await assert.rejects(()=>http.readJson(post(bomb,{'content-encoding':'gzip'}),64*1024),error=>error.status===413);
});

test('broken gzip and unknown encodings are refused',async()=>{
 await assert.rejects(()=>http.readJson(post('{"not":"gzip"}',{'content-encoding':'gzip'})),error=>error.status===400);
 await assert.rejects(()=>http.readJson(post('{}',{'content-encoding':'br'})),error=>error.status===415);
});

test('the browser compresses large saves and keeps plain JSON when it cannot',()=>{
 const source=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');
 assert.match(source,/async function agendaRequestBody\(json\)\{if\(json\.length<8192\|\|typeof CompressionStream!=="function"\)return \{body:json,headers:\{\}\}/);
 assert.match(source,/pipeThrough\(new CompressionStream\("gzip"\)\)/);
 assert.match(source,/catch\{return \{body:json,headers:\{\}\}\}/);
 assert.match(source,/const packed=await agendaRequestBody\(body\),response=await fetch\("\/api\/state",\{method:"PUT",headers:\{"content-type":"application\/json","if-match":window\.AgendaRevision\|\|"new",\.\.\.packed\.headers\},body:packed\.body\}\)/);
});
