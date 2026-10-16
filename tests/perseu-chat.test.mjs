import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadTs} from "./load-ts.mjs";

const contracts=loadTs("lib/perseu/chat-contracts.ts");
const provider=loadTs("lib/perseu/chat-provider.ts",{"./chat-tools":{perseusTools:[]}});
const intelligence=loadTs("lib/perseu/document-intelligence.ts");
const bytes=value=>new TextEncoder().encode(value);

test("Perseu validates bounded conversation input and parses Responses function calls",()=>{
 assert.equal(contracts.validChatMessage("Relatório de glosas"),true);
 assert.equal(contracts.validChatMessage("   "),false);
 assert.equal(contracts.validChatMessage("x".repeat(8001)),false);
 const payload={id:"resp_1",model:"configured-model",status:"completed",output:[{type:"function_call",call_id:"call_1",name:"consultar_glosas",arguments:'{"payer":"MedSenior","limit":20}'},{type:"message",content:[{type:"output_text",text:"Consulta concluída."}]}],usage:{input_tokens:12,output_tokens:8,input_tokens_details:{cached_tokens:3}}};
 assert.equal(provider.textFromResponsesOutput(payload),"Consulta concluída.");
 assert.deepEqual(JSON.parse(JSON.stringify(provider.toolCallsFromResponsesOutput(payload))),[{callId:"call_1",name:"consultar_glosas",arguments:{payer:"MedSenior",limit:20}}]);
});

test("Perseu only enables the external provider after explicit model and consent configuration",()=>{
 const original={key:process.env.OPENAI_API_KEY,enabled:process.env.PERSEUS_CHAT_ENABLED,model:process.env.PERSEUS_CHAT_MODEL,consent:process.env.PERSEUS_MULTIMODAL_CONSENT};
 delete process.env.OPENAI_API_KEY;delete process.env.PERSEUS_CHAT_ENABLED;delete process.env.PERSEUS_CHAT_MODEL;delete process.env.PERSEUS_MULTIMODAL_CONSENT;
 assert.equal(provider.perseusChatAvailability().configured,false);
 process.env.OPENAI_API_KEY="test";process.env.PERSEUS_CHAT_ENABLED="true";process.env.PERSEUS_CHAT_MODEL="approved-model";process.env.PERSEUS_MULTIMODAL_CONSENT="true";
 assert.equal(provider.perseusChatAvailability().configured,true);
 for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test("Perseu preserves every structural row for global conversational queries",async()=>{
 const lines=["Beneficiário;Nº Guia;Procedimento"];for(let index=1;index<=2625;index++)lines.push(`Paciente ${index};${String(index).padStart(6,"0")};Proc ${index}`);
 const inspection=await intelligence.inspectGlobalPerseusDocument(bytes(lines.join("\n")),"saga.csv");
 assert.equal(inspection.records.length,2625);
 assert.equal(inspection.records[2624].normalizedData.guide_number,"002625");
 assert.equal(inspection.records[2624].sourceMetadata.row,2626);
});

test("Fase 5A persists isolated conversations, actual activities and no financial write path",()=>{
 const migration=readFileSync("supabase/migrations/20261015210000_perseus_conversational_assistant.sql","utf8");
 const route=readFileSync("app/api/perseu/chat/route.ts","utf8");
 const tools=readFileSync("lib/perseu/chat-tools.ts","utf8");
 assert.match(migration,/create table public\.perseus_conversations/);
 assert.match(migration,/owner_id bigint not null/);
 assert.match(migration,/create table public\.perseus_chat_events/);
 assert.match(migration,/create table public\.perseus_usage_events/);
 assert.match(migration,/perseus_document_records/);
 assert.match(route,/text\/event-stream/);
 assert.match(route,/executePerseusTool/);
 assert.match(route,/PERSEUS_CHAT_MAX_TOOL_CALLS/);
 assert.match(tools,/session\.account\.role!=="general_manager"/);
 assert.doesNotMatch(migration,/insert into public\.(billing_records|invoices|invoice_billing_records|attendances)/);
 assert.doesNotMatch(tools,/\.insert\(/);
});

test("knowledge boundary documents the RN Integra rules without granting writes",()=>{
 const knowledge=readFileSync("lib/perseu/operational-knowledge.ts","utf8");
 assert.match(knowledge,/nunca faça alterações/);
 assert.match(knowledge,/não duplique valores consolidados/);
 assert.match(knowledge,/não prova liquidação bancária/);
 assert.match(knowledge,/só consulta e prepara propostas/);
});
