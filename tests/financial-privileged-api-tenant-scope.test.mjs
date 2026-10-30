import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=(path)=>readFileSync(new URL('../app/api/billing/'+path+'/route.ts',import.meta.url),'utf8');
for(const path of ['approvers','doctor-entities','entity-analytics']){
 test(path+' verifies active organization before privileged reads',()=>{
  const source=api(path);
  assert.match(source,/financialActorOrganizationId\(session\.account\.id\)/);
  assert.match(source,/if\(!organizationId\)return Response\.json\(\{error:/);
  assert.match(source,/getSupabaseAdmin\(\)/);
 });
}
test('approvers only returns managers linked to current organization',()=>{
 const src=api('approvers');
 assert.match(src,/organization_memberships!inner\(organization_id\)/);
 assert.match(src,/\.eq\("organization_memberships\.organization_id",organizationId\)/);
});
test('doctor entities and links both use the current tenant key',()=>{
 const src=api('doctor-entities');
 assert.equal((src.match(/\.eq\('organization_id',organizationId\)/g)||[]).length,2);
});
test('entity analytics refuses entities outside the actor organization before RPC',()=>{
 const src=api('entity-analytics');
 assert.match(src,/\.eq\('id',entityId\)\.eq\('organization_id',organizationId\)\.maybeSingle\(\)/);
 assert.ok(src.indexOf("eq('organization_id',organizationId)")<src.indexOf("rpc('billing_entity_receipts_analytics'"));
});
