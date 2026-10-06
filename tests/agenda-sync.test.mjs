import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

function revisionRoute({role="general_manager",agendaIds=["d1"],revision="2026-10-06T19:20:31.123Z",audit="2026-10-06T19:20:30.000Z",notification="2026-10-06T19:20:29.000Z",readAt="2026-10-06T19:20:32.000Z",request="2026-10-06T19:20:28.000Z",session=true,allowed=true}={}) {
 const calls=[];
 const db={from(table){let columns="";const chain={select(value){columns=value;return chain},eq(){return chain},in(key,value){calls.push([table,"in",key,value]);return chain},not(key){calls.push([table,"not",key]);return chain},order(){return chain},limit:async()=>({data:table==="audit_logs"?audit?[{created_at:audit}]:[]:table==="agenda_requests"?request?[{created_at:request}]:[]:table==="notifications"&&columns==="read_at"?readAt?[{read_at:readAt}]:[]:table==="notifications"?notification?[{created_at:notification}]:[],error:null}),maybeSingle:async()=>({data:revision?{updated_at:revision}:null,error:null})};return chain}};
 const user=session?{account:{id:1,role},agendaIds}:null;
 return {route:loadTs("app/api/state/revision/route.ts",{"@/app/authz":{getSession:async()=>user,isManager:value=>value==="general_manager"},"@/lib/doctor-services":{canUseAgenda:()=>allowed},"@/lib/supabase-admin":{getSupabaseAdmin:()=>db,dbError:error=>{if(error)throw error}}}),calls};
}
test("agenda revision endpoint requires agenda authorization and returns only lightweight revisions",async()=>{
 for(const options of [{session:false},{allowed:false}]){const response=await revisionRoute(options).route.GET();assert.equal(response.status,403)}
 const response=await revisionRoute().route.GET(),body=await response.json();
 assert.deepEqual(body,{revision:"2026-10-06T19:20:31.123Z",workflowRevision:"2026-10-06T19:20:32.000Z"});assert.equal(response.headers.get("cache-control"),"private, no-store");for(const key of ["payload","requests","notifications","audit","patients"])assert.equal(key in body,false);
});
test("workflow revision follows permission scope without exposing administrative audit to doctors",async()=>{
 const secretary=revisionRoute({role:"secretary",agendaIds:["d1"]});await secretary.route.GET();assert.deepEqual(secretary.calls.find(call=>call[0]==="audit_logs"&&call[1]==="in"),["audit_logs","in","professional_id",["d1"]]);
 const doctor=revisionRoute({role:"doctor",agendaIds:["d1"]});await doctor.route.GET();assert.equal(doctor.calls.some(call=>call[0]==="audit_logs"),false);assert.deepEqual(doctor.calls.find(call=>call[0]==="agenda_requests"&&call[1]==="in"),["agenda_requests","in","professional_id",["d1"]]);
});
test("agenda sync decisions and pending reconciliation distinguish own saves, newer remotes and conflicts",()=>{
 const source=readFileSync("public/legacy-app.js","utf8"),ast=ts.createSourceFile("legacy.js",source,ts.ScriptTarget.Latest,true),names=new Set(["agendaRevisionIsNewer","agendaSyncDecision","agendaRemotePendingDecision"]),code=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name.text)).map(node=>node.getText(ast)).join("\n"),context={Date};vm.createContext(context);vm.runInContext(code,context);
 const x="2026-10-06T19:20:00.000Z",y="2026-10-06T19:20:31.123Z",z="2026-10-06T19:20:32.123Z";
 assert.equal(context.agendaSyncDecision({serverRevision:x,currentRevision:x}),"ignore");assert.equal(context.agendaSyncDecision({serverRevision:y,currentRevision:x}),"apply");assert.equal(context.agendaSyncDecision({serverRevision:y,currentRevision:x,editorOpen:true}),"pending");assert.equal(context.agendaSyncDecision({serverRevision:y,currentRevision:x,saving:true}),"pending");
 assert.equal(context.agendaRemotePendingDecision(y,y),"clear");assert.equal(context.agendaRemotePendingDecision(y,z),"clear");assert.equal(context.agendaRemotePendingDecision(z,y),"keep");
});
test("agenda runtime keeps one light cadence, refreshes workflow once per token and restores the real scrolling container",()=>{
 const client=readFileSync("public/legacy-app.js","utf8"),stateRoute=readFileSync("app/api/state/route.ts","utf8"),legacyHost=readFileSync("app/dashboard/legacy-app.tsx","utf8");
 assert.match(client,/fetch\("\/api\/state\/revision",\{cache:"no-store"\}\)/);assert.match(client,/workflowRevision/);assert.match(client,/refreshWorkflowRevision/);assert.match(client,/document\.querySelector\("\.agenda-card"\)/);assert.doesNotMatch(client,/const calendar=\$\("calendar"\)/);assert.match(client,/clearRemoteAgendaUpdate/);assert.match(client,/menuSizeObserver\.disconnect\(\)/);assert.match(client,/document\.visibilityState!=="visible"/);assert.match(client,/window\.AgendaSyncCleanup/);assert.doesNotMatch(client,/EventSource\(/);assert.doesNotMatch(client,/SUPABASE_SECRET_KEY|service_role|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
 assert.match(stateRoute,/status: 409/);assert.match(legacyHost,/AgendaSyncCleanup/);
});
