import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const swipe=loadTs('components/menu-swipe.ts');
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('swipe intent: left opens, right closes, vertical scroll never triggers the menu',()=>{
 assert.equal(swipe.swipeIntent(-4,2,'open'),'wait');
 assert.equal(swipe.swipeIntent(-40,5,'open'),'menu');
 assert.equal(swipe.swipeIntent(40,5,'open'),'scroll','right swipe does not open');
 assert.equal(swipe.swipeIntent(40,5,'close'),'menu');
 assert.equal(swipe.swipeIntent(-40,5,'close'),'scroll','left swipe does not close');
 assert.equal(swipe.swipeIntent(-30,40,'open'),'scroll','mostly vertical is a page scroll');
});

test('swipe release completes past 30% of the drawer or on a fast flick, otherwise snaps back',()=>{
 assert.equal(swipe.settlesOpen('open',-120,400,320),true);
 assert.equal(swipe.settlesOpen('open',-60,600,320),false);
 assert.equal(swipe.settlesOpen('open',-60,80,320),true,'fast flick');
 assert.equal(swipe.settlesOpen('close',120,400,320),false);
 assert.equal(swipe.settlesOpen('close',50,600,320),true,'short drag snaps back open');
 assert.equal(swipe.settlesOpen('close',60,80,320),false,'fast flick closes');
});

test('menu swipe is wired on every page header, skips inputs, horizontal scrollers and other dialogs',()=>{
 const nav=read('components/mobile-navigation.tsx'),src=read('components/menu-swipe.ts'),css=read('app/hub/hub.css');
 assert.match(nav,/attachMenuSwipe\(dialog,/);
 assert.match(nav,/enabled: \(\) => phone\.matches/);
 assert.match(nav,/swipeRef\.current\.slideOut\(\)/,'X and outside tap slide the drawer out too');
 assert.match(src,/input,textarea,select,\[contenteditable=true\],\[data-no-swipe\]/);
 assert.match(src,/el\.scrollWidth > el\.clientWidth \+ 2/);
 assert.match(src,/dialog\[open\]/);
 assert.match(src,/\{ passive: false \}/);
 assert.match(css,/\.mobile-app-menu::backdrop\{background:rgb\(7 27 42 \/ calc\(\.75 \* var\(--menu-progress,1\)\)\)\}/);
});

test('agenda selector opens a grouped picker; the select stays the source of the value',()=>{
 const app=read('public/legacy-app.js'),css=read('public/legacy.css');
 assert.match(app,/function openAgendaPicker\(\)\{/);
 assert.match(app,/sel\.querySelectorAll\("optgroup"\)/,'only the agendas the role may see');
 assert.match(app,/sel\.dispatchEvent\(new Event\("change",\{bubbles:true\}\)\)/);
 assert.match(app,/display\.onclick=e=>\{if\(!e\.target\.closest\("\.agenda-print-btn"\)\)openAgendaPicker\(\)\}/);
 assert.match(css,/\.agenda-owner-select-card select\{pointer-events:none\}/);
 assert.match(css,/dialog\.agenda-picker\{inset:auto 0 0;/,'bottom sheet on phones');
});

test('Cancelados shows and switches the agenda; phone agenda has no empty band under the selector',()=>{
 const app=read('public/legacy-app.js'),css=read('public/legacy.css');
 assert.match(app,/<button id="cancelledOwnerBtn" type="button" class="cancelled-owner-btn"/);
 assert.match(app,/\$\("cancelledOwnerBtn"\)\.onclick=openAgendaPicker;/);
 assert.match(app,/function renderCancelled\(\)\{\r?\n if\(!\$\("cancelledList"\)\)return;\r?\n renderCancelledOwner\(\);/);
 assert.match(css,/\.rn-agenda #agendaView>\.toolbar\{padding-bottom:0;margin-bottom:8px;background:none\}/);
 assert.match(css,/\.rn-agenda #agendaView>\.toolbar \.filters\{display:contents\}/);
});
