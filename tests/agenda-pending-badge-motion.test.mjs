import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/legacy.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/legacy-app.js',import.meta.url),'utf8');

test('the ! badge is small, slightly tilted and gently animated for all pending surfaces',()=>{
 assert.match(css,/\.appointment-pending-mark\.card-pending-mark\{width:16px;height:16px;font-size:11px\}/);
 assert.match(css,/@keyframes rn-pending-nudge\s*\{/);
 assert.match(css,/\.appointment-pending-mark,\s*#appointmentModal \.native-finance\.pending-finance::after\s*\{\s*transform:rotate\(-10deg\);[\s\S]*?animation:rn-pending-nudge 7s ease-in-out infinite;/);
 assert.match(css,/\.appointment \.card-pending-mark\{position:absolute;top:-6px;right:-6px/);
 assert.match(css,/\.mobile-appointment \.card-pending-mark\{position:absolute;top:-5px;right:-5px/);
});

test('reduce-motion users get the tilted badge without movement',()=>{
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.appointment-pending-mark,[\s\S]*?\.native-finance\.pending-finance::after\{\s*animation:none;\s*transform:rotate\(-10deg\);/);
});

test('pending exclamation indicators remain hidden for doctors',()=>{
 assert.match(js,/function appointmentPendingBadge\(a\)\{\s*if\(\(window\.AgendaAuth\|\|\{\}\)\.role==="doctor"\)return "";/);
 assert.match(js,/const pending=isDoctor\?null:appointmentPendingFlags\(a\)/);
});
