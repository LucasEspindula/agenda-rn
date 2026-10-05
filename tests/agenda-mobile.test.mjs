import {loadTs} from './load-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../public/legacy-app.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('legacy.js', source, ts.ScriptTarget.Latest, true);
const names = new Set(['hasAnesthesiaConflict', 'phoneNumber', 'appointmentPartner', 'appointmentCardContent', 'doctorName', 'renderDoctorHistory', 'workflowDate', 'renderMobileCalendar', 'assignCalendarLanes']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name.text)).map(n => n.getText(ast)).join('\n');
function fixture() {
  const doctor = { id: 'd', name: 'Rosa', specialty: 'Ortopedia e Traumatologia' }, anesthetist = { id: 'a', name: 'Dr. Lima', specialty: 'Anestesiologia' };
  const appointment = { id: 'one', doctorId: 'd', anesthetistId: 'a', patientId: 'p', hospitalId: 'h', date: '2026-09-11', time: '09:00', duration: 60, status: 'scheduled', procedure: 'Joelho' };
  const elements = new Map();
  const context = {
    state: { professionals: [doctor, anesthetist], appointments: [appointment], cancelledAppointments: [], scheduleBlocks: [] },
    owner: doctor, window: { AgendaAuth: { role: 'doctor' } }, workflowData: { requests: [] },
    selectedProf: () => context.owner, prof: id => ({ d: doctor, a: anesthetist })[id],
    patient: id => id === 'p' ? { name: 'Paciente teste', insurance: 'Convênio teste' } : null,
    hospital: () => ({ name: 'Hospital teste' }), hospitalAcronym: v => v,
    esc: v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    mins: v => Number(v.slice(0, 2)) * 60 + Number(v.slice(3)), hhmm: v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`,
    statusLabel: () => 'Agendado', workflowRequestTitle: () => 'Sugestão enviada', workflowChangeRows: () => 'De / Para',
    parseDate: v => new Date(`${v}T12:00:00`), pad: v => String(v).padStart(2, '0'),
    ds: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    addDays: (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n),
    startOfWeek: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7),
    currentDate: new Date(2026, 8, 11), calendarMode: 'day', money: () => 'R$ 0,00',
    mobileSelectedDate: '2026-09-11', mobileMonth: new Date(2026, 8, 1), mobileListMode: 'day',
    $: id => { if (!elements.has(id)) elements.set(id, { innerHTML: '', querySelectorAll: () => [] }); return elements.get(id); },
  };
  context.isAnesthesiologist=loadTs('lib/medical-specialties.ts').isAnesthesiologist;context.appointmentInsurance=a=>a.insurance??context.patient(a.patientId)?.insurance??'';vm.createContext(context); vm.runInContext(functions, context);
  return { context, appointment, doctor, anesthetist, elements };
}

test('cards preserve patient and team, with insurance immediately before status', () => {
  const { context: c, appointment: a, anesthetist } = fixture();
  let html = c.appointmentCardContent(a);
  assert.match(html, /Dr\. Lima/); assert.doesNotMatch(html, /Dr\. Dr\./);
  assert(html.indexOf('Convênio teste') < html.indexOf('appointment-status-badge'));
  c.owner = anesthetist; html = c.appointmentCardContent(a);
  assert.match(html, /Dr\. Rosa/); assert.match(html, /Paciente teste/);
});

test('contact numbers preserve country codes and normalize Brazilian DDD numbers', () => {
  const { context: c } = fixture();
  assert.equal(c.phoneNumber('(51) 99965-1810'), '5551999651810');
  assert.equal(c.phoneNumber('+55 51 99965-1810'), '5551999651810');
  assert.equal(c.phoneNumber('+1 415 555 0123'), '14155550123');
});

test('anesthesia conflicts include overlapping intervals but not adjacent, cancelled or other agendas', () => {
  const { context: c, appointment: a, anesthetist, doctor } = fixture();
  const b = { ...a, id: 'two', time: '09:30' };
  assert.equal(c.hasAnesthesiaConflict(a, [a, b], anesthetist), true);
  for (const change of [{ time: '10:00' }, { date: '2026-09-12' }, { anesthetistId: 'other' }, { status: 'cancelled' }]) assert.equal(c.hasAnesthesiaConflict(a, [a, { ...b, ...change }], anesthetist), false);
  assert.equal(c.hasAnesthesiaConflict(a, [a, b], doctor), false);
  c.owner = anesthetist; c.state.appointments.push(b); c.renderMobileCalendar();
  assert.equal((c.$('mobileCalendar').innerHTML.match(/has-conflict/g) || []).length, 2);
});

test('legacy financial report shortcut is removed from Agenda', () => {
 assert.doesNotMatch(source,/agendaReportBtn|generateMonthlyReport/);
});

test('mobile calendar has 42 dates and uses the same card content without other agendas', () => {
  const { context: c, appointment: a } = fixture();
  c.state.appointments.push({ ...a, id: 'forbidden', doctorId: 'other' });
  c.renderMobileCalendar(); const html = c.$('mobileCalendar').innerHTML;
  assert.equal((html.match(/data-mobile-date=/g) || []).length, 42);
  assert.match(html, /data-mobile-appointment="one"/); assert.doesNotMatch(html, /data-mobile-appointment="forbidden"/);
  assert(html.includes(c.appointmentCardContent(a)));
});

test('doctor history includes pending requests without notifications and rejection reason', () => {
  const { context: c } = fixture();
  c.workflowData = { notifications: [], requests: [{ status: 'pending' }, { status: 'denied', decisionNote: '<script>indisponível</script>' }, { status: 'accepted' }] };
  const html = c.renderDoctorHistory();
  assert.match(html, /Aguardando aprovação/); assert.match(html, /Recusada 🚫/); assert.match(html, /Aceita ✅/);
  assert.match(html, /&lt;script>/); assert.doesNotMatch(html, /<script>/);
});

test('API requires denial reason before writing and filters doctor requests before limit', async () => {
  const calls = []; let role = 'secretary';
  const query = { in() { return this; }, select() { return this; }, eq(...args) { calls.push(['eq', ...args]); return this; }, order() { return this; }, limit(n) { calls.push(['limit', n]); return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const api=loadTs('app/api/workflow/route.ts',{
    '@/app/authz':{getSession:async()=>({account:{role,id:5,doctorId:'d'},services:{scheduling_enabled:true,billing_enabled:true,invoice_enabled:true},agendaIds:['d']}),isManager:r=>r==='general_manager'},
    '@/lib/supabase-admin':{getSupabaseAdmin:()=>({from:()=>query}),dbError(){}},
    '@/lib/security/rate-limit':{consumeLimit:async()=>{}}
  });
  const denied = await api.PATCH(new Request('https://example.com/api/workflow',{method:'PATCH',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify({id:'r',decision:'denied',note:'  '})}));
  assert.equal(denied.status, 400); assert.equal(calls.length, 0);
  role = 'doctor'; await api.GET();
  assert.deepEqual(calls[0], ['eq', 'requested_by', 5]); assert.deepEqual(calls[1], ['limit', 200]);
});


test('agenda starts weeks on Sunday and treats all-day rules as absolute', () => {
  assert.match(source,/function startOfWeek\(x\)\{const d=new Date\(x\),day=d\.getDay\(\);d\.setDate\(d\.getDate\(\)-day\)/);
  assert.match(source,/r\.severity==="block"\|\|r\.blockAllDay/);
  assert.doesNotMatch(source,/Reagende ou cancele o atendimento primeiro/);
});

test('detail cancellation and critical dialogs remain reachable', () => {
  assert.match(source,/cancelDetailAppointmentBtn/);
  assert.match(source,/detailSuggestionReason/);
  assert.match(source,/e\.target instanceof HTMLDialogElement/);
});


test('calendar lanes include intervals that cross an hour boundary', () => {
  const { context: c } = fixture();
  const lanes = c.assignCalendarLanes([
    { key: 'appointment', start: 9 * 60 + 30, end: 11 * 60 },
    { key: 'block', start: 10 * 60, end: 10 * 60 + 30 },
  ]);
  assert.equal(lanes.get('appointment').total, 2);
  assert.notEqual(lanes.get('appointment').lane, lanes.get('block').lane);
});

test('calendar lanes keep adjacent intervals together and transitive overlaps collision-free', () => {
  const { context: c } = fixture();
  const adjacent = c.assignCalendarLanes([{ key: 'a', start: 9 * 60, end: 10 * 60 }, { key: 'b', start: 10 * 60, end: 11 * 60 }]);
  assert.equal(adjacent.get('a').total, 1);
  assert.equal(adjacent.get('a').lane, adjacent.get('b').lane);
  const lanes = c.assignCalendarLanes([{ key: 'a', start: 9 * 60, end: 10 * 60 }, { key: 'b', start: 9 * 60 + 30, end: 10 * 60 + 30 }, { key: 'c', start: 10 * 60, end: 11 * 60 }]);
  assert.equal(lanes.get('a').total, 2);
  assert.notEqual(lanes.get('a').lane, lanes.get('b').lane);
  assert.equal(lanes.get('a').lane, lanes.get('c').lane);
});
