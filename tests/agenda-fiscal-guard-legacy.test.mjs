import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(
 'supabase/migrations/20261021194500_guard_fiscal_legacy_null_professional_agenda.sql','utf8');

test('solicitação fiscal antiga sem profissional não impede agendamentos não relacionados',()=>{
 assert.match(migration,/CREATE OR REPLACE FUNCTION public\.guard_invoice_appointments\(\)/);
 assert.equal((migration.match(/if entry\.independent and entry\.professional_id is not null then/g)||[]).length,2);
 assert.equal((migration.match(/if appointment is not null and appointment is not distinct from previous then continue; end if;/g)||[]).length,2);
 assert.match(migration,/from jsonb_array_elements\(coalesce\(old\.payload->'appointments'/);
 assert.match(migration,/coalesce\(old\.payload->'cancelledAppointments'/);
});
test('não relaxa as proibições de alterar vínculo, paciente e convênio dos atendimentos protegidos',()=>{
 assert.match(migration,/Atendimento com NF: preserve realização, médico, anestesista e paciente/);
 assert.match(migration,/Atendimento com solicitação fiscal: preserve o paciente/);
 assert.match(migration,/NF legada: preserve convênio e forma de cobrança/);
 assert.match(migration,/Solicitação fiscal legada: preserve a forma particular/);
 assert.match(migration,/Profissional da solicitação fiscal não participa do atendimento/);
 assert.match(migration,/return new;/);
 assert.doesNotMatch(migration,/delete from public\./i);
});
