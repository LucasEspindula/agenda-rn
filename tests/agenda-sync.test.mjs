import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";

// Autorização e escopo por papel da revisão: tests/session-sync-single-call.test.mjs (RPC agenda_sync_signal).
test("agenda sync keeps own saves silent and still processes later external updates",()=>{
 const source=readFileSync("public/legacy-app.js","utf8"),ast=ts.createSourceFile("legacy.js",source,ts.ScriptTarget.Latest,true),names=new Set(["agendaRevisionIsNewer","agendaSyncDecision","agendaRemotePendingDecision","agendaRemoteNoticeMode","agendaRemoteUpdateAfterSave"]),code=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name.text)).map(node=>node.getText(ast)).join("\n"),context={Date};vm.createContext(context);vm.runInContext(code,context);
 const x="2026-10-06T19:20:00.000Z",y="2026-10-06T19:20:31.123Z",z="2026-10-06T19:20:32.123Z";
 assert.equal(context.agendaSyncDecision({serverRevision:x,currentRevision:x}),"ignore");assert.equal(context.agendaSyncDecision({serverRevision:y,currentRevision:x,saving:true}),"pending");assert.equal(context.agendaRemoteNoticeMode({saving:true}),"silent");assert.equal(context.agendaRemoteNoticeMode({pending:true}),"silent");
 assert.equal(context.agendaRemotePendingDecision(y,y),"clear");assert.equal(context.agendaRemoteUpdateAfterSave({remoteRevision:y,currentRevision:y}),"clear");
 assert.equal(context.agendaRemotePendingDecision(z,y),"keep");assert.equal(context.agendaRemoteUpdateAfterSave({remoteRevision:z,currentRevision:y}),"apply");
 assert.equal(context.agendaSyncDecision({serverRevision:z,currentRevision:y,editorOpen:true}),"pending");assert.equal(context.agendaRemoteNoticeMode({}),"show");assert.equal(context.agendaRemoteUpdateAfterSave({remoteRevision:z,currentRevision:y,editorOpen:true}),"notice");
});
test("agenda runtime keeps one light cadence, refreshes workflow once per token and restores the real scrolling container",()=>{
 const client=readFileSync("public/legacy-app.js","utf8"),stateRoute=readFileSync("app/api/state/route.ts","utf8"),legacyHost=readFileSync("app/dashboard/legacy-app.tsx","utf8");
 assert.match(client,/fetch\("\/api\/state\/revision",\{cache:"no-store"\}\)/);assert.match(client,/workflowRevision/);assert.match(client,/refreshWorkflowRevision/);assert.match(client,/document\.querySelector\("\.agenda-card"\)/);assert.doesNotMatch(client,/const calendar=\$\("calendar"\)/);assert.match(client,/clearRemoteAgendaUpdate/);assert.match(client,/menuSizeObserver\.disconnect\(\)/);assert.match(client,/document\.visibilityState!=="visible"/);assert.match(client,/window\.AgendaSyncCleanup/);assert.doesNotMatch(client,/EventSource\(/);assert.doesNotMatch(client,/SUPABASE_SECRET_KEY|service_role|NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
 assert.match(stateRoute,/status: 409/);assert.match(legacyHost,/AgendaSyncCleanup/);
});
