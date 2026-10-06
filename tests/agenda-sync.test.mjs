import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

function revisionRoute({session={account:{id:1}},allowed=true,revision="2026-10-06T19:20:31.123Z"}={}) {
 const db={from(table){assert.equal(table,"app_state");return {select(columns){assert.equal(columns,"updated_at");return {eq(id,value){assert.equal(id,"id");assert.equal(value,1);return {maybeSingle:async()=>({data:revision?{updated_at:revision}:null,error:null})}}}}}}};
 return loadTs("app/api/state/revision/route.ts",{"@/app/authz":{getSession:async()=>session},"@/lib/doctor-services":{canUseAgenda:()=>allowed},"@/lib/supabase-admin":{getSupabaseAdmin:()=>db,dbError:error=>{if(error)throw error}}});
}
test("agenda revision endpoint requires agenda authorization and returns no payload",async()=>{
 for(const options of [{session:null},{allowed:false}]){const response=await revisionRoute(options).GET();assert.equal(response.status,403)}
 const response=await revisionRoute().GET(),body=await response.json();
 assert.deepEqual(body,{revision:"2026-10-06T19:20:31.123Z"});assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal("payload" in body,false);
});
test("agenda sync decisions only apply newer revisions and defer open editors or saves",()=>{
 const source=readFileSync("public/legacy-app.js","utf8"),ast=ts.createSourceFile("legacy.js",source,ts.ScriptTarget.Latest,true),names=new Set(["agendaRevisionIsNewer","agendaSyncDecision"]),code=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name.text)).map(node=>node.getText(ast)).join("\n"),context={Date};vm.createContext(context);vm.runInContext(code,context);
 const current="2026-10-06T19:20:00.000Z",newer="2026-10-06T19:20:31.123Z";
 assert.equal(context.agendaSyncDecision({serverRevision:current,currentRevision:current}),"ignore");
 assert.equal(context.agendaSyncDecision({serverRevision:newer,currentRevision:current}),"apply");
 assert.equal(context.agendaSyncDecision({serverRevision:newer,currentRevision:current,editorOpen:true}),"pending");
 assert.equal(context.agendaSyncDecision({serverRevision:newer,currentRevision:current,saving:true}),"pending");
 assert.equal(context.agendaSyncDecision({serverRevision:newer,currentRevision:current,pending:true}),"pending");
 assert.equal(context.agendaRevisionIsNewer(current,newer),false);
});
test("agenda runtime polls only revisions, cleans up listeners and retains CAS conflict protection",()=>{
 const client=readFileSync("public/legacy-app.js","utf8"),stateRoute=readFileSync("app/api/state/route.ts","utf8"),legacyHost=readFileSync("app/dashboard/legacy-app.tsx","utf8");
 assert.match(client,/fetch\("\/api\/state\/revision",\{cache:"no-store"\}\)/);assert.match(client,/document\.visibilityState!=="visible"/);assert.match(client,/window\.addEventListener\("focus",wake\)/);assert.match(client,/window\.addEventListener\("online",wake\)/);assert.match(client,/window\.AgendaSyncCleanup/);assert.doesNotMatch(client,/EventSource\(/);assert.doesNotMatch(client,/SUPABASE_SECRET_KEY|service_role|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
 assert.match(stateRoute,/status: 409/);assert.match(legacyHost,/AgendaSyncCleanup/);assert.match(legacyHost,/legacy-app\.js\?v=agenda-sync-20261006/);
});
