import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../public/legacy-app.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('legacy.js', source, ts.ScriptTarget.Latest, true);
const names = new Set(['phoneNumber', 'appointmentPartner', 'appointmentCardContent', 'doctorName', 'renderDoctorHistory', 'workflowDate', 'generateMonthlyReport', 'renderMobileCalendar', 'mobileHomeView']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name.text)).map(n => n.getText(ast)).join('\n');
function fixture() {
  const doctor = { id: 'd', name: 'Rosa', category: 'doctor' }, anesthetist = { id: 'a', name: 'Dr. Lima', category: 'anesthetist' };
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
  vm.createContext(context); vm.runInContext(functions, context);
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

test('monthly reports separate patient and the other professional, including cancellations', () => {
  const { context: c, appointment: a, anesthetist } = fixture();
  c.state.cancelledAppointments = [{ ...a, id: 'cancelled' }];
  let html = ''; c.open = () => ({ document: { write: v => { html = v; }, close() {} } });
  c.generateMonthlyReport(); assert.match(html, /<th>Paciente<\/th><th>Anestesista<\/th>/);
  c.owner = anesthetist; c.generateMonthlyReport();
  assert.equal((html.match(/<th>Paciente<\/th><th>Médico<\/th>/g) || []).length, 2);
  assert.match(html, /Dr\. Rosa/);
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
  for (const [role, view] of [['doctor', 'notifications'], ['secretary', 'requests'], ['general_manager', 'audit']]) { c.window.AgendaAuth.role = role; assert.equal(c.mobileHomeView(), view); }
});

test('API requires denial reason before writing and filters doctor requests before limit', async () => {
  const code = ts.transpileModule(readFileSync(new URL('../app/api/workflow/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = []; let role = 'secretary';
  const query = { select() { return this; }, eq(...args) { calls.push(['eq', ...args]); return this; }, order() { return this; }, limit(n) { calls.push(['limit', n]); return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const context = { exports: {}, Response, require: name => name.includes('authz') ? { getSession: async () => ({ account: { role, id: 5 }, agendaIds: ['d'] }), isManager: r => r === 'general_manager' } : { getSupabaseAdmin: () => ({ from: () => query }), dbError() {} } };
  vm.runInNewContext(code, context);
  const denied = await context.exports.PATCH({ json: async () => ({ id: 'r', decision: 'denied', note: '  ' }) });
  assert.equal(denied.status, 400); assert.equal(calls.length, 0);
  role = 'doctor'; await context.exports.GET();
  assert.deepEqual(calls[0], ['eq', 'requested_by', 5]); assert.deepEqual(calls[1], ['limit', 200]);
});
