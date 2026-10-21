import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(name)=>readFileSync(name,'utf8');
const sql=read('supabase/migrations/20261021115000_entity_receipt_analytics.sql');
const route=read('app/api/billing/entity-analytics/route.ts');
const ui=read('app/billing/entity-analytics.tsx');
const page=read('app/billing/entidades/[entityId]/indicadores/page.tsx');
const entities=read('app/billing/billing-client.tsx');

test('soma diretamente do faturamento sem somar duas vezes NFs de particulares',()=>{
 assert.match(sql,/from public\.billing_records b/);
 assert.match(sql,/b\.settlement_mode='DIRECT'/);
 assert.match(sql,/b\.billing_method='PARTICULAR'/);
 assert.match(sql,/b\.payment_status='PAGO'/);
 assert.match(sql,/b\.paid_at is not null/);
 assert.match(sql,/from public\.invoices i/);
 assert.match(sql,/i\.recipient_type='CONVENIO'/);
 assert.match(sql,/i\.status='ACTIVE' and i\.voided_at is null/);
 assert.match(sql,/i\.paid_at is not null and i\.net_amount is not null/);
 assert.match(sql,/i\.net_amount::numeric as amount/);
 assert.match(sql,/union all/);
 assert.match(sql,/group by r\.payment_year,r\.payment_month,r\.source/);
 assert.match(sql,/b\.billing_entity_id=p_entity/);
 assert.match(sql,/i\.billing_entity_id=p_entity/);
 assert.match(sql,/item\.is_active and inv\.status='ACTIVE'/);
});
test('somente gerente pode obter indicadores da entidade',()=>{
 assert.match(route,/session\.account\.role!=='general_manager'/);
 assert.match(route,/uuid\.test\(entityId\)/);
 assert.match(route,/from\('billing_entities'\)/);
 assert.match(route,/\.eq\('id',entityId\)/);
 assert.match(route,/\.rpc\('billing_entity_receipts_analytics',\{p_entity:entityId\}\)/);
 assert.match(route,/private, no-store/);
 assert.match(page,/session\.account\.role!=='general_manager'/);
});
test('Entidades recebedoras possui apenas ícone como ação adicional',()=>{
 assert.match(entities,/aria-label=\{"Ver gráficos de ganhos de "\+e\.name\}/);
 assert.match(entities,/<BarChart3 size=\{19\}/);
 assert.match(entities,/\/billing\/entidades\//);
});
test('nova página apresenta quatro visualizações alimentadas por API',()=>{
 assert.match(ui,/fetch\("\/api\/billing\/entity-analytics\?entity="/);
 assert.match(ui,/Valor por origem/);
 assert.match(ui,/Participação por origem/);
 assert.match(ui,/Comparativo mensal de recebimentos/);
 assert.match(ui,/Comparativo anual de crescimento/);
 assert.match(ui,/<PieChart>/);
 assert.match(ui,/layout="vertical"/);
 assert.match(ui,/<LabelList dataKey="amount" position="top"/);
 assert.match(ui,/byOrigin=useMemo/);
 assert.match(ui,/buckets\.filter|for\(const b of buckets\)if\(b\.year===year\)/);
 assert.doesNotMatch(ui,/Math\.random\(/);
});
