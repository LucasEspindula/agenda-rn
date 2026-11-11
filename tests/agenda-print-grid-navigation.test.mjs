import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("blue mobile Agenda header exposes its own section menu with no duplicate white submenu",()=>{
 const header=source("components/site-header.tsx");
 const menu=source("components/agenda-section-menu.tsx");
 const hubCss=source("app/hub/hub.css");
 const legacyCss=source("public/legacy.css");
 const mobile=source("components/mobile-navigation.tsx");
 assert.match(header,/<MobileNavigation links=\{moduleLinks\(session\)\}[^>]*\/>\s*<\/header>/,"single menu trigger lives in the blue header");
 assert.doesNotMatch(header,/AgendaSectionMenu|BillingSectionMenu/);
 assert.match(mobile,/active === "agenda" && <AgendaSectionLinks role=\{role\} onNavigate=\{closeMenu\} \/>/);
 assert.match(menu,/<nav className="mobile-app-menu-links mobile-app-sections" aria-label="Seções da Agenda">/);
 assert.match(hubCss,/\.mobile-menu-trigger\{[\s\S]*?margin-left:auto/);
 assert.doesNotMatch(hubCss,/\.mobile-app-tabs/,"no second menu in a bottom tab bar");
 assert.match(legacyCss,/@media screen and \(max-width:900px\)\{\s*\.rn-agenda \.agenda-shell>\.agenda-subnav\{display:none!important\}/);
 assert.match(source("app/dashboard/legacy-body.ts"),/class="agenda-nav"/);
});

test("Agenda hamburger reuses real view handlers and respects role-specific sections",()=>{
 const menu=source("components/agenda-section-menu.tsx");
 const app=source("public/legacy-app.js");
 assert.match(menu,/role==="general_manager"\|\|role==="secretary"/);
 assert.match(menu,/view==="notifications"\)return role==="doctor"/);
 assert.match(menu,/!el\.classList\.contains\("hidden"\)/);
 assert.match(menu,/source\.click\(\)/);
 assert.match(menu,/new MutationObserver\(sync\)/);
 assert.match(menu,/document\.getElementById\("cancelledPageBtn"\)/,"Cancelados reuses the real button");
 assert.match(menu,/cancelled: "Cancelados"/);
 assert.match(app,/qsa\("\.agenda-nav-item"\)\.forEach\(b=>b\.onclick=\(\)=>showView\(b\.dataset\.view\)\)/);
 assert.match(app,/function showView\(view\)\{/);
});
