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

test('mobile overflow menu has no duplicated primary navigation items', () => {
  const component = source('components/mobile-navigation.tsx');
  assert.match(component, /const tabs = links\.slice\(0, 3\)/);
  assert.match(component, /overflowLinks = links\.filter\(link => !tabs\.some\(tab => tab\.id === link\.id\)\)/);
  assert.match(component, /overflowLinks\.map\(link =>/);
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

test('Cadastros navigation sits flush below 60px mobile header', () => {
  const styles = source('app/billing/billing.css');
  assert.match(source('app/doctors/page.tsx'), /className="billing-subnav cadastros-subnav"/);
  assert.match(styles, /\.billing-subnav\.cadastros-subnav \{[\s\S]*?top:60px;[\s\S]*?margin:0;/);
  assert.match(styles, /\.billing-subnav\.cadastros-subnav nav\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('mobile calendar and procedure list are not reimplemented', () => {
  const agenda = source('public/legacy-app.js');
  assert.match(agenda, /function renderMobileCalendar\(\)/);
  assert.match(agenda, /mobile-month-grid/);
  assert.match(agenda, /mobile-day-list/);
  assert.match(agenda, /appointmentCardContent\(a,owner\)/);
});
