import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const nodeRequire=createRequire(import.meta.url);
export function loadTs(path,mocks={},cache=new Map()) {
 const file=resolve(path.endsWith(".ts") && !existsSync(path) && existsSync(path+"x") ? path+"x" : path);if(cache.has(file))return cache.get(file);
 if(file.endsWith('.json.ts'))return {default:JSON.parse(readFileSync(file.slice(0,-3),'utf8')),__esModule:true};
 const exports={};cache.set(file,exports);
 const source=readFileSync(file,'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{
  exports,Request,Response,Headers,URL,Buffer,TextEncoder,TextDecoder,Uint8Array,ReadableStream,DecompressionStream,CompressionStream,AbortController,crypto:webcrypto,atob,btoa,process,setTimeout,clearTimeout,
  require(name){if(name in mocks)return mocks[name];if(name==='server-only'||name.endsWith('.css'))return {};if(name.startsWith('@/')||name.startsWith('.'))return loadTs(resolve(name.startsWith('@/')?name.slice(2):dirname(file)+'/'+name)+'.ts',mocks,cache);return nodeRequire(name)}
 });return exports;
}
