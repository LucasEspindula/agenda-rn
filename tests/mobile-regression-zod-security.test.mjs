import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('patched Zod major and npm lock metadata are aligned for npm ci', () => {
  const pkg = JSON.parse(source('package.json'));
  const lock = JSON.parse(source('package-lock.json'));
  const version = lock.packages['node_modules/zod'];
  assert.equal(pkg.dependencies.zod, '^4.6.7');
  assert.equal(lock.packages[''].dependencies.zod, pkg.dependencies.zod);
  assert.equal(version.version, '4.6.7');
  assert.equal(version.resolved, 'https://registry.npmjs.org/zod/-/zod-4.6.7.tgz');
  assert.equal(version.integrity, 'sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==');
  assert.ok(Object.entries(lock.packages).filter(([path]) => path.endsWith('/zod')).every(([,value]) => Number(value.version.split('.')[0]) >= 4));
});

test('single mobile menu lists other modules without repeating the current one', () => {
  const component = source('components/mobile-navigation.tsx');
  assert.match(component, /const otherModules = links\.filter\(link => link\.id !== active\)/);
  assert.match(component, /otherModules\.map\(link =>/);
  assert.match(component, /<dialog /);
  assert.match(component, /role === "general_manager"/);
});

test('billing section selectors do not overflow horizontally and include doctor options', () => {
  const styles = source('app/billing/billing.css');
  const doctor = source('app/billing/doctor-billing.tsx');
  assert.match(styles, /nav\.billing-mobile-menu-links\{[\s\S]*?flex-direction:column;[\s\S]*?min-width:0;[\s\S]*?overflow-x:hidden;/);
  assert.match(styles, /nav\.billing-mobile-menu-links>button/);
  assert.match(doctor, /className="billing-mobile-menu"/);
  assert.match(doctor, /className="billing-mobile-menu-links"/);
  assert.match(doctor, /closest\('details'\)\?\.removeAttribute\('open'\)/);
  assert.match(source('app/billing/billing-subnav.tsx'), /<details className="billing-mobile-menu">/);
});

test('mobile calendar and procedure list are not reimplemented', () => {
  const agenda = source('public/legacy-app.js');
  assert.match(agenda, /function renderMobileCalendar\(\)/);
  assert.match(agenda, /mobile-month-grid/);
  assert.match(agenda, /mobile-day-list/);
  assert.match(agenda, /appointmentCardContent\(a,owner\)/);
});

test('new mobile appointments inherit selected calendar date without changing desktop behavior', () => {
  const runtime = source('public/legacy-app.js');
  assert.match(runtime, /\$\("newAppointmentBtn"\)\.onclick=\(\)=>openAppointment\(null,window\.matchMedia\("\(max-width:900px\)"\)\.matches\?\{date:mobileSelectedDate\}:\{\}\)/);
  assert.match(runtime, /mobileSelectedDate=b\.dataset\.mobileDate;currentDate=parseDate\(mobileSelectedDate\);mobileMonth=new Date\(currentDate\.getFullYear\(\),currentDate\.getMonth\(\),1\);renderCalendar\(\)/);
});

test('agenda notifications remain accessible above the mobile bottom bar', () => {
  const styles = source('public/legacy.css');
  assert.match(styles, /\.rn-agenda \.notification-panel\{[\s\S]*?bottom:calc\(80px \+ env\(safe-area-inset-bottom,0px\)\);[\s\S]*?overflow-y:auto;/);
});
