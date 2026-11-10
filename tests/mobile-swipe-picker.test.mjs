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
 assert.match(nav,/dialogRef\.current\.style\.animation = "";\s*if \(!dialogRef\.current\?\.open\) dialogRef\.current\?\.showModal\(\)/,'header button opens with the entry animation');
 assert.doesNotMatch(src,/addEventListener\("close"/,'no dependency on the async close event');
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

// Reproduz o gesto com um DOM mínimo: arrastar para abrir, soltar e conferir que a animação
// de entrada não é religada (era isso que fazia o menu "piscar" ao terminar de abrir).
import ts from 'typescript';
import vm from 'node:vm';
function swipeHarness(){
 const docListeners={},menuListeners={},timers=[];
 const style={transform:'',transition:'',animation:'',props:{},setProperty(k,v){this.props[k]=v},removeProperty(k){delete this.props[k]}};
 const menu={open:false,style,offsetWidth:330,closes:0,styleAtClose:null,
  getBoundingClientRect:()=>({width:330}),
  showModal(){this.open=true},
  close(){this.styleAtClose=style.transform;this.open=false;this.closes++},  // o navegador dispara "close" depois, de forma assíncrona
  addEventListener(t,f){(menuListeners[t]||=[]).push(f)},removeEventListener(t,f){menuListeners[t]=(menuListeners[t]||[]).filter(x=>x!==f)}};
 class Element{matches(){return false}}
 const target=Object.assign(new Element(),{parentElement:null});
 let now=0;
 const context={exports:{},document:{body:{},addEventListener:(t,f)=>{(docListeners[t]||=[]).push(f)},removeEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},
  window:{setTimeout:(f)=>timers.push(f)},performance:{now:()=>now},getComputedStyle:()=>({overflowX:'visible'}),Element};
 const code=ts.transpileModule(read('components/menu-swipe.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,context);
 const api=context.exports.attachMenuSwipe(menu,{enabled:()=>true,onOpen:()=>menu.showModal(),onClose:()=>menu.close()});
 const fire=(type,x)=>(docListeners[type]||[]).forEach(f=>f({target,touches:type==='touchend'?[]:[{clientX:x,clientY:400}],preventDefault(){}}));
 const drag=(from,to,ms=300)=>{fire('touchstart',from);for(let i=1;i<=6;i++){now+=ms/6;fire('touchmove',from+(to-from)*i/6)}fire('touchend',to)};
 const finish=()=>{(menuListeners.transitionend||[]).slice().forEach(f=>f());timers.splice(0).forEach(f=>f())};
 const lateClose=()=>(menuListeners.close||[]).forEach(f=>f());
 return {menu,style,drag,finish,api,lateClose};
}

test('opening by swipe does not replay the entry animation when the finger lifts (no flash)',()=>{
 const h=swipeHarness();
 h.drag(340,120);
 assert.equal(h.menu.open,true);
 assert.equal(h.style.animation,'none','entry animation is off while dragging');
 h.finish();
 assert.equal(h.style.animation,'none','still off after settling open, so the browser does not replay it');
 assert.equal(h.style.transform,'','drag position cleared');
 h.drag(120,330);h.finish();
 assert.equal(h.menu.open,false);
 h.drag(340,120);
 assert.equal(h.style.animation,'none','a quick reopen by swipe never plays the entry animation');
 h.lateClose();
 assert.equal(h.style.animation,'none','a late async close event from the previous close does not re-enable it');
 h.finish();
 assert.equal(h.menu.open,true);
});

test('a short swipe that snaps back closes before clearing the drag position (no one-frame open drawer)',()=>{
 const h=swipeHarness();
 h.drag(340,310,600);
 assert.equal(h.menu.open,true,'drawer is out while the finger is down');
 h.finish();
 assert.equal(h.menu.open,false);
 assert.equal(h.menu.closes,1,'closed exactly once even with both transitionend and the fallback timer');
 assert.equal(h.menu.styleAtClose,'translateX(330px)','still off-screen at the moment it closes');
});

test('a new touch finishes a closing drawer first, so a quick reopen never mixes with the old close',()=>{
 const h=swipeHarness();
 h.drag(340,120);h.finish();
 h.drag(120,330);               // fecha; o assentamento ainda não terminou
 assert.equal(h.menu.open,true,'still sliding out');
 h.drag(340,120);               // reabre logo em seguida
 assert.equal(h.menu.closes,1,'the pending close completed when the new touch started');
 assert.equal(h.menu.open,true);
 assert.equal(h.style.animation,'none');
 h.finish();
 assert.equal(h.menu.open,true,'the late timer of the old close does not close the reopened menu');
 assert.equal(h.menu.closes,1);
});
