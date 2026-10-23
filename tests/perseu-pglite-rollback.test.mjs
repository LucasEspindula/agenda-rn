import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('Perseu replace RPC rolls back all item changes when an insert fails',async()=>{
 const db=new PGlite();
 const migration=readFileSync('supabase/migrations/20261009200000_stabilize_perseus_structured_parsing.sql','utf8');
 const adaptiveMigration=readFileSync('supabase/migrations/20261013170000_perseus_adaptive_structure.sql','utf8');
 const semanticMigration=readFileSync('supabase/migrations/20261014160000_perseus_semantic_interpretation.sql','utf8');
 const documentId='11111111-1111-4111-8111-111111111111';
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table insurance_documents(id uuid primary key,upload_status text not null,parser_key text,parser_version text,raw_metadata jsonb not null default '{}'::jsonb,perseus_status text not null default 'NOT_ANALYZED',updated_at timestamptz,updated_by bigint);
  create table insurance_document_items(id uuid primary key default gen_random_uuid(),document_id uuid not null references insurance_documents(id),source_index integer,raw_data jsonb not null check(raw_data ? 'value'),normalized_data jsonb not null default '{}'::jsonb,match_status text,match_evidence jsonb not null default '{}'::jsonb,source_metadata jsonb not null default '{}'::jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text,attendance_id uuid,billing_record_id uuid);
  grant all on insurance_documents,insurance_document_items to service_role;
  insert into insurance_documents(id,upload_status) values('${documentId}','READY');`);
 await db.exec(migration);
 await db.exec(adaptiveMigration);
 await db.exec(semanticMigration);
 await db.exec('set role service_role');
 const call=(items,key='parser-a')=>db.query('select replace_perseus_document_analysis($1,$2::jsonb,$3,$4,$5::jsonb,$6)',[documentId,JSON.stringify(items),key,'1.0.0',JSON.stringify({row_count:items.length}),1]);
 await call([{source_index:0,raw_data:{value:'before'},normalized_data:{patient_name:'Ana'},semantic_evidence:{patient_name:{classification:'HIGH'}},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}},patient_name:'Ana'}]);
 await assert.rejects(()=>call([{source_index:0,raw_data:{value:'after'}},{source_index:1,raw_data:{}}],'parser-b'));
 const items=(await db.query('select source_index,raw_data,normalized_data,match_evidence,source_metadata,patient_name from insurance_document_items where document_id=$1',[documentId])).rows;
 const document=(await db.query('select parser_key,perseus_status from insurance_documents where id=$1',[documentId])).rows[0];
 assert.deepEqual(JSON.parse(JSON.stringify(items)),[{source_index:0,raw_data:{value:'before'},normalized_data:{patient_name:'Ana'},match_evidence:{patient_name:{classification:'HIGH'}},source_metadata:{row:2,table_id:'csv-table-1',region:{rowStart:1,rowEnd:2,columnStart:1,columnEnd:1}},patient_name:'Ana'}]);
 assert.deepEqual(JSON.parse(JSON.stringify(document)),{parser_key:'parser-a',perseus_status:'REVIEW_REQUIRED'});
 await assert.rejects(()=>call([{source_index:0,raw_data:{value:'one'}},{source_index:0,raw_data:{value:'two'}}]));
 await db.close();
});

