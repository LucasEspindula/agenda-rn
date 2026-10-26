import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("mobile navigation reuses authorized module links and native menu controls", () => {
  const header = file("components/site-header.tsx");
  const mobile = file("components/mobile-navigation.tsx");
  assert.match(header, /MobileNavigation links=\{moduleLinks\(session\)\}/);
  assert.match(mobile, /links\.slice\(0, 3\)/);
  assert.match(mobile, /<dialog /);
  assert.match(mobile, /\.showModal\(\)/);
  assert.match(mobile, /aria-haspopup="dialog"/);
  assert.match(mobile, /role === "general_manager"/);
});

test("finance remains available on mobile with role-gated links and a compact section picker", () => {
  const css = file("app/billing/billing.css");
  const nav = file("app/billing/billing-subnav.tsx");
  const shell = file("app/hub/hub.css");
  assert.match(css, /\.billing-mobile-menu>summary/);
  assert.match(css, /\.billing-panel[^}]*overflow-x:auto|\.billing-panel[^}]*overflow-x:clip|\.billing-panel[^}]*max-width:100%/);
  assert.match(nav, /denialsEnabled&&<a href="\/billing\/glosas"/);
  assert.match(nav, /closingEnabled&&<a href="\/billing\/fechamento"/);
  assert.match(shell, /\.mobile-app-tabs/);
  assert.match(shell, /safe-area-inset-bottom/);
  assert.doesNotMatch(shell, /\.mobile-app-tabs\{display:none!important/);
});

test("patient edit action is visible on phones while mobile agenda remains the large calendar plus procedures", () => {
  const css = file("public/legacy.css");
  const runtime = file("public/legacy-app.js");
  assert.match(css, /#patientsTableWrap \.table td:last-child:has\(\[data-patient\]\)/);
  assert.match(css, /\.rn-agenda \.agenda-nav\{display:grid/);
  assert.match(runtime, /function renderMobileCalendar\(\)/);
  assert.match(runtime, /class="mobile-month-grid"/);
  assert.match(runtime, /class="mobile-day-list"/);
  assert.match(runtime, /appointmentCardContent\(a,owner\)/);
});


test("mobile notifications float above bottom tabs, retain permissions and close behind dialogs", () => {
  const css = file("public/legacy.css");
  const body = file("app/dashboard/legacy-body.ts");
  const runtime = file("public/legacy-app.js");
  assert.match(css, /\.rn-agenda #agendaNotifications:not\(\.hidden\)\{[\s\S]*?position:fixed;[\s\S]*?bottom:calc\(86px \+ env\(safe-area-inset-bottom,0px\)\);[\s\S]*?right:16px;/);
  assert.match(css, /\.rn-agenda #notificationBell\{[\s\S]*?border-radius:50%;/);
  assert.match(css, /\.rn-agenda #notificationPanel\{[\s\S]*?position:fixed;[\s\S]*?bottom:calc\(158px \+ env\(safe-area-inset-bottom,0px\)\);/);
  assert.match(css, /body:has\(dialog\[open\]\) \.rn-agenda #agendaNotifications/);
  assert.match(body, /id="notificationBell"[^>]*aria-expanded="false"/);
  assert.match(body, /id="notificationCount"/);
  assert.match(runtime, /role==="doctor"\)\{\$\("agendaNotifications"\)\.classList\.add\("hidden"\)/);
  assert.match(runtime, /\$\("agendaNotifications"\)\.classList\.toggle\("hidden",!onAgenda/);
  assert.match(runtime, /\$\("notificationBell"\)\.onclick=e=>\{e\.stopPropagation\(\);toggleNotificationPanel\(\)\}/);
});

test("floating bell matches the blue header and red blocked-day marker sits above the day number",()=>{
 const css=file("public/legacy.css");
 const header=file("app/hub/hub.css");
 assert.match(header,/background:linear-gradient\(180deg,#123d57,#102f44\)/);
 assert.match(css,/\.rn-agenda #notificationBell\{[\s\S]*?background:linear-gradient\(180deg,#123d57,#102f44\)/);
 assert.match(css,/\.rn-agenda \.mobile-date>\.mobile-date-block-dot\{[\s\S]*?position:absolute;[\s\S]*?top:-2px;[\s\S]*?bottom:auto;/);
 assert.match(css,/\.rn-agenda \.mobile-date \.mobile-date-dots\{[\s\S]*?inset:auto 0 1px/);
 assert.doesNotMatch(css,/\.rn-agenda \.mobile-block \.mobile-block-range\{/);
});
