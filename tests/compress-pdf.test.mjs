import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import sharp from 'sharp';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/compress-pdf.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:createRequire(import.meta.url),Buffer,Date});
test('large JPEG shrinks without changing page content or page count',async()=>{
 const p=await PDFDocument.create();const page=p.addPage();const jpg=await sharp({create:{width:3000,height:3000,channels:3,background:'#759abc'}}).jpeg({quality:100}).toBuffer();const im=await p.embedJpg(jpg);page.drawImage(im,{x:0,y:0,width:200,height:200});page.drawText('Texto preservado');const bytes=Buffer.from(await p.save());const result=await exports.compressPdf(bytes);assert(result.bytes.length<bytes.length);const out=await PDFDocument.load(result.bytes);assert.equal(out.getPageCount(),1);assert.equal(out.getPage(0).node.Contents().toString(),page.node.Contents().toString());
});
test('signature field in compressed objects preserves exact original bytes',async()=>{const p=await PDFDocument.create();p.addPage();p.context.register(p.context.obj({FT:PDFName.of('Sig'),T:PDFString.of('Signature')}));const b=Buffer.from(await p.save());const r=await exports.compressPdf(b);assert.equal(r.reason,'signed');assert.deepEqual(r.bytes,b)});
test('unsupported input remains unchanged',async()=>{const b=Buffer.from('%PDF-invalid');assert.deepEqual((await exports.compressPdf(b)).bytes,b)});
