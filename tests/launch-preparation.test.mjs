import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const source=path=>readFileSync(path,'utf8');

test('Perseu is disabled by default on both server navigation and experimental routes',()=>{
 const previous=process.env.RN_PERSEUS_ENABLED;
 delete process.env.RN_PERSEUS_ENABLED;
 const availability=loadTs('lib/perseu/availability.ts');
 assert.equal(availability.isPerseusOperationalEnabled(),false);
 process.env.RN_PERSEUS_ENABLED='true';
 assert.equal(availability.isPerseusOperationalEnabled(),true);
 if(previous===undefined)delete process.env.RN_PERSEUS_ENABLED;else process.env.RN_PERSEUS_ENABLED=previous;
 const subnav=source('app/billing/billing-subnav.tsx');
 assert.match(subnav,/perseusEnabled = false/);
 assert.match(subnav,/\{perseusEnabled &&/);
 for(const path of ['app/api/perseu/chat/route.ts','app/api/perseu/conversations/route.ts','app/api/perseu/documents/route.ts','app/api/perseu/documents/analyze/route.ts','app/api/perseu/proposals/route.ts']){
  assert.match(source(path),/isPerseusOperationalEnabled/);
 }
 assert.match(source('app/perseu/page.tsx'),/redirect\("\/billing\?view=insurance"\)/);
});

test('professional charge model keeps the clinical attendance as source and separates commercial concepts',()=>{
 const migration=source('supabase/migrations/20261016120000_independent_professional_billing.sql');
 for(const column of ['professional_id','professional_role','patient_insurance_snapshot','commercial_modality_code','submission_channel_code','effective_payer_id','effective_payer_role','billing_entity_name_snapshot'])assert.match(migration,new RegExp('add column if not exists '+column));
 assert.match(migration,/billing_records_attendance_professional_unique/);
 assert.match(migration,/billing_commercial_modalities/);
 assert.match(migration,/billing_submission_channels/);
 assert.match(migration,/billing_counterparties/);
 assert.match(migration,/billing_professional_commercial_rules/);
 assert.match(migration,/save_professional_charge/);
 assert.match(migration,/save_professional_invoice/);
 assert.match(migration,/revoke all on function public\.save_professional_charge/);
 assert.match(migration,/grant execute on function public\.save_professional_charge\(bigint,jsonb\) to service_role/);
 assert.doesNotMatch(migration,/delete from public\.billing_records(?! where invoice_id)/);
});

test('billing projection creates one financial row per professional charge and doctor filters use the charge owner',()=>{
 const data=source('lib/billing-data.ts');
 const projection=source('lib/billing-projection.ts');
 const rows=source('lib/billing-row.ts');
 assert.match(data,/recordsByAttendance/);
 assert.match(data,/attendanceRecords\.map/);
 assert.match(projection,/record\?\.professional_id\|\|clinicalDoctorId/);
 assert.match(rows,/row\.doctor_id===f\.doctor/);
 assert.match(rows,/billingRowKey/);
});

test('professional mutations stay isolated from the legacy record endpoint and no Perseu migrations are applied',()=>{
 const route=source('app/api/billing/route.ts');
 assert.match(route,/professional_charge/);
 assert.match(route,/save_professional_charge/);
 assert.match(route,/professional_invoice/);
 assert.match(route,/save_professional_invoice/);
 assert.doesNotMatch(source('supabase/migrations/20261016120000_independent_professional_billing.sql'),/perseus_documents|openai/i);
});
