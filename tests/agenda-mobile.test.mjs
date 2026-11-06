import {loadTs} from './load-ts.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../public/legacy-app.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('legacy.js', source, ts.ScriptTarget.Latest, true);
const names = new Set(['hasAnesthesiaConflict', 'phoneNumber', 'appointmentPartner', 'appointmentCardContent', 'doctorName', 'doctorShortName', 'renderDoctorHistory', 'workflowAuthorship', 'workflowRoleLabel', 'workflowDate', 'renderMobileCalendar', 'mobileCalendarCard', 'assignCalendarLanes']);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.has(n.name.text)).map(n => n.getText(ast)).join('\n');
function fixture() {
  const doctor = { id: 'd', name: 'Rosa', specialty: 'Ortopedia e Traumatologia' }, anesthetist = { id: 'a', name: 'Dr. Lima', specialty: 'Anestesiologia' };
  const appointment = { id: 'one', doctorId: 'd', anesthetistId: 'a', patientId: 'p', hospitalId: 'h', date: '2026-09-11', time: '09:00', duration: 60, status: 'scheduled', procedure: 'Joelho' };
  const elements = new Map();
  const context = {
    state: { professionals: [doctor, anesthetist], appointments: [appointment], cancelledAppointments: [], scheduleBlocks: [], schedulingRules: [], settings: {workStart:'07:00',workEnd:'19:00'} },
    owner: doctor, window: { AgendaAuth: { role: 'doctor' }, RNAvailability:loadTs('lib/agenda-availability.ts'), matchMedia:()=>({matches:true}) }, workflowData: { requests: [] },
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


test('blocked slots show gray appointment-style cards in chronological order, with red and green dots together',()=>{
 const {context:c,appointment:a}=fixture();
 const earlier={id:'early',professionalId:'d',date:a.date,start:'08:00',end:'08:30',reason:'Reunião clínica'};
 const later={id:'late',professionalId:'d',date:a.date,start:'10:00',end:'11:30',reason:'Bloqueio reservado'};
 c.state.scheduleBlocks=[later,earlier];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 const early=html.indexOf('data-mobile-block="early"'),ap=html.indexOf('data-mobile-appointment="one"'),late=html.indexOf('data-mobile-block="late"');
 assert.ok(early>=0&&ap>=0&&late>=0&&early<ap&&ap<late,'Atendimentos e bloqueios devem respeitar horário');
 assert.match(html,/class="mobile-appointment mobile-block"/);
 assert.match(html,/class="mobile-block-reason">Reunião clínica/);
 assert.match(html,/class="mobile-date-appointment-dot"/);
 assert.match(html,/class="mobile-date-block-dot"/);
 const cell=html.match(/<button class="mobile-date [^"]*" data-mobile-date="2026-09-11"[^>]*>(.*?)<\/button>/)?.[1]||'';
 assert.match(cell,/mobile-date-appointment-dot/);
 assert.match(cell,/mobile-date-block-dot/);
});

test('calendar displays a red dot and block card for a day with only a block, without false empty state',()=>{
 const {context:c}=fixture();
 c.state.appointments=[];
 c.state.scheduleBlocks=[{id:'only',professionalId:'d',date:'2026-09-11',start:'12:00',end:'13:00',reason:'Recesso <especial>'}];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 assert.match(html,/data-mobile-block="only"/);
 assert.match(html,/Recesso &lt;especial>/);
 assert.doesNotMatch(html,/class="mobile-date-appointment-dot"/);
 assert.match(html,/class="mobile-date-block-dot"/);
 assert.doesNotMatch(html,/Nenhum atendimento ou bloqueio neste dia/);
});

test('mobile block markers and cards only include the selected professional',()=>{
 const {context:c}=fixture();
 c.state.scheduleBlocks=[
  {id:'other',professionalId:'other-doctor',date:'2026-09-11',start:'08:00',end:'09:00',reason:'Privado'},
  {id:'ours',professionalId:'d',date:'2026-09-12',start:'14:00',end:'15:00',reason:'Bloqueio da agenda'}
 ];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 assert.doesNotMatch(html,/data-mobile-block="other"|Privado/);
 assert.doesNotMatch(html,/data-mobile-block="ours"/);
 assert.match(html,/data-mobile-date="2026-09-12"[^>]*com horário bloqueado/);
 assert.match(html,/class="mobile-date-block-dot"/);
});

test('blocked-day red marker sits beside green below the date and duplicate time is absent',()=>{
 const {context:c,appointment:a}=fixture();
 c.state.scheduleBlocks=[{id:'block-1',professionalId:'d',date:a.date,start:'10:00',end:'11:00',reason:'Reunião'}];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 const day=html.match(/<button class="mobile-date [^"]*" data-mobile-date="2026-09-11"[^>]*>(.*?)<\/button>/)?.[1]||'';
 assert.match(day,/<span>11<\/span><em class="mobile-date-dots" aria-hidden="true"><i class="mobile-date-appointment-dot"><\/i><i class="mobile-date-block-dot"><\/i><\/em>/);
 const card=html.match(/<button type="button" class="mobile-appointment mobile-block"[^>]*>(.*?)<\/button>/)?.[1]||'';
 assert.match(card,/<strong>10:00<\/strong><small>até 11:00<\/small>/);
 assert.match(card,/class="mobile-block-reason">Reunião<\/span>/);
 assert.doesNotMatch(card,/mobile-block-range|10:00\s*[–-]\s*11:00/);
});

test('blocked-only calendar day retains a red bottom marker and no green marker',()=>{
 const {context:c}=fixture();
 c.state.appointments=[];
 c.state.scheduleBlocks=[{id:'only',professionalId:'d',date:'2026-09-11',start:'10:00',end:'11:00',reason:'Bloqueado'}];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 const day=html.match(/<button class="mobile-date [^"]*" data-mobile-date="2026-09-11"[^>]*>(.*?)<\/button>/)?.[1]||'';
 assert.match(day,/<em class="mobile-date-dots" aria-hidden="true"><i class="mobile-date-block-dot"><\/i><\/em>/);
 assert.doesNotMatch(day,/mobile-date-appointment-dot/);
});

test('appointment 08:00, block 09:00 and appointment 10:00 render in chronological sequence',()=>{
 const {context:c,appointment:a}=fixture();
 c.state.appointments=[
  {...a,id:'at-eight',time:'08:00'},
  {...a,id:'at-ten',time:'10:00'}
 ];
 c.state.scheduleBlocks=[
  {id:'at-nine-block',professionalId:'d',date:a.date,start:'09:00',end:'09:30',reason:'Indisponível'}
 ];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 const eight=html.indexOf('data-mobile-appointment="at-eight"');
 const nine=html.indexOf('data-mobile-block="at-nine-block"');
 const ten=html.indexOf('data-mobile-appointment="at-ten"');
 assert.ok(eight>=0&&nine>eight&&ten>nine, 'a ordem deve ser 08h agendamento, 09h bloqueio, 10h agendamento');
});

test('mobile displays full-day recurring closure while preserving historical appointments',()=>{
 const {context:c,appointment:a}=fixture();
 c.state.schedulingRules=[{id:'r1',professionalId:'d',name:'Recesso',blockAllDay:true,severity:'block',weekday:5,enabled:true}];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 assert.match(html,/Dia totalmente bloqueado/);
 assert.match(html,/Agenda indisponível nesta data/);
 assert.match(html,/data-mobile-appointment="one"/);
 assert.match(html,/com horário bloqueado/);
 assert.doesNotMatch(html,/Nenhum atendimento ou bloqueio neste dia/);
});
test('partial recurring closure is interleaved chronologically with appointments',()=>{
 const {context:c,appointment:a}=fixture();
 c.state.appointments=[{...a,id:'before',time:'08:00'},{...a,id:'after',time:'10:00'}];
 c.state.schedulingRules=[{id:'r2',professionalId:'d',name:'Restrição',weekday:5,severity:'block',start:'07:00',end:'19:00',forbiddenTimes:'09:00'}];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 const a1=html.indexOf('data-mobile-appointment="before"'),rule=html.indexOf('mobile-rule-block'),a2=html.indexOf('data-mobile-appointment="after"');
 assert.ok(a1>=0&&rule>a1&&a2>rule);
 assert.match(html,/HORÁRIO INDISPONÍVEL/);
 assert.doesNotMatch(html,/Dia totalmente bloqueado/);
});
test('recurrent rule for a different professional does not leak into the mobile agenda',()=>{
 const {context:c}=fixture();
 c.state.schedulingRules=[{professionalId:'other',name:'Restrição privada',blockAllDay:true,weekday:5,severity:'block'}];
 c.renderMobileCalendar();
 assert.doesNotMatch(c.$('mobileCalendar').innerHTML,/Dia totalmente bloqueado|Restrição privada/);
});

test('mobile overlapping partial rules become a single gray interval and keep existing appointments',()=>{
 const {context:c,appointment:a}=fixture();
 c.state.appointments=[{...a,id:'before',time:'08:00'},{...a,id:'after',time:'14:00'}];
 c.state.schedulingRules=[
  {id:'one',professionalId:'d',weekday:5,severity:'block',name:'Reunião',start:'07:00',end:'19:00',forbiddenTimes:'12:00'},
  {id:'two',professionalId:'d',weekday:5,severity:'block',name:'Consulta externa',start:'07:00',end:'19:00',forbiddenTimes:'12:15'}
 ];
 c.renderMobileCalendar();
 const html=c.$('mobileCalendar').innerHTML;
 assert.equal((html.match(/class="mobile-appointment mobile-block mobile-rule-block"/g)||[]).length,1);
 assert.match(html,/Reunião/);
 assert.match(html,/Consulta externa/);
 assert.match(html,/12:00/);
 assert.match(html,/até 12:45/);
 assert.match(html,/data-mobile-appointment="before"/);
 assert.match(html,/data-mobile-appointment="after"/);
 assert.doesNotMatch(html,/Dia totalmente bloqueado/);
});
