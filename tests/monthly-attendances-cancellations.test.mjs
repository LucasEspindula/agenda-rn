import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261019223000_monthly_attendance_cancelled_overview.sql");
const print=read("app/api/reports/monthly-closing/print/route.ts");
const ui=read("app/billing/monthly-closing.tsx");
const pdf=read("app/api/reports/monthly-closing/route.ts");

test("snapshot mensal captura atendimentos, inclusive cancelados sem faturamento",()=>{
 assert.match(migration,/from public\.attendances a/);
 assert.match(migration,/a\.status in \('realized','cancelled'\)/);
 assert.match(migration,/a\.billing_entity_id=p_entity or exists/);
 assert.match(migration,/a\.date>=first_day and a\.date<last_day/);
 assert.match(migration,/a\.cancellation_reason/);
 assert.match(migration,/a\.cancelled_at/);
 assert.match(migration,/jsonb_agg\(to_jsonb\(t\)/);
 assert.match(migration,/'attendance_overview',attendance_overview/);
 assert.doesNotMatch(migration,/(?:update|delete)\s+public\.billing_monthly_closings/i);
});

test("tela apresenta realizados e cancelados sem duplicar cobrança ou misturar receita",()=>{
 assert.match(ui,/data\.attendance_overview/);
 assert.match(ui,/a\.status===status/);
 assert.match(ui,/Atendimentos realizados/);
 assert.match(ui,/Atendimentos cancelados/);
 assert.match(ui,/a\.attendance_id/);
 assert.match(ui,/cancellation_reason/);
 assert.match(ui,/fora dos totais financeiros/);
});

test("impressão mensal preserva gráfico e adiciona listagem clínica separada",()=>{
 assert.match(print,/const fifth=page\(heading\("Atendimentos da competência"/);
 assert.match(print,/first\+second\+third\+fourth\+fifth/);
 assert.match(print,/receiptChartSvg\(comparison\.groups\)/);
 assert.match(print,/ATENDIMENTOS REALIZADOS/);
 assert.match(print,/ATENDIMENTOS CANCELADOS/);
 assert.match(print,/cancellations\.length\?/);
 assert.match(print,/!snap\.attendance_overview/);
 assert.match(print,/cancellation_reason/);
});

test("PDF alternativo e fechamentos antigos respeitam a origem do snapshot",()=>{
 assert.match(pdf,/snap\.attendance_overview/);
 assert.match(pdf,/Atendimentos cancelados/);
 assert.match(pdf,/if\(cancelled\.length\)/);
 assert.match(print,/const legacyOverview=/);
 assert.match(ui,/registros já fechados não são recalculados/);
});
