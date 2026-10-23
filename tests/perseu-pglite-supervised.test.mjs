import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

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

