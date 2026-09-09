import { readFile, writeFile } from "node:fs/promises";

const sourceRoot = "/workspace/sites/agenda-rn-refatorada";
const targetRoot = "/workspace/sites/agenda-rn-next";
const source = await readFile(`${sourceRoot}/source-original.html`, "utf8");
const body = source.match(/<body>\n([\s\S]*?)\n<script>/)?.[1];

if (!body) throw new Error("Corpo da aplicação original não encontrado.");

const accessNav = `\n  <button class="nav-item manager-only" data-view="access">♙ Acessos</button>`;
const accessView = `
<section id="accessView" class="view manager-only">
 <div class="content-card">
  <div class="section-head"><div><h2>Acessos</h2><p>Gerencie papéis e agendas disponíveis para cada pessoa.</p></div><button id="newAccessBtn" class="primary-btn">+ Conceder acesso</button></div>
  <div id="accessList" class="stack"></div>
 </div>
</section>`;
const accessModal = `
<div id="accessModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3 id="accessModalTitle">Conceder acesso</h3><p>Defina o papel, a senha e as agendas disponíveis.</p></div><button class="modal-close" data-close>×</button></div><form id="accessForm" style="padding:0 20px 20px"><input id="accessId" type="hidden"><div class="form-grid"><label>E-mail<input id="accessEmail" type="email" required></label><label>Nome<input id="accessName"></label><label>Nível<select id="accessRole"><option value="secretary">Secretaria</option><option value="doctor">Médico</option><option value="general_manager">Gerente geral</option></select></label><label>Senha inicial ou nova senha<input id="accessPassword" type="password" minlength="8" placeholder="Mínimo de 8 caracteres"></label><fieldset class="access-fieldset"><legend>Agendas permitidas</legend><div id="accessAgendaChoices" class="agenda-choices"></div></fieldset></div><div class="modal-actions"><button id="deleteAccessBtn" type="button" class="danger-btn hidden">Remover acesso</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Salvar acesso</button></div></form></div></div>`;

const enhanced = body
  .replace(/\n  <div class="content-card"><h2>Horário de funcionamento<\/h2>[\s\S]*?<button id="saveSettingsBtn" class="primary-btn">Salvar configurações<\/button><\/div>/, "")
  .replace('<div class="content-card wide"><div class="section-head"><div><h2>Hospitais</h2>', '<div class="content-card hospital-panel"><div class="section-head"><div><h2>Hospitais</h2>')
  .replace('<div id="hospitalsList" class="stack"></div></div>', '<div id="hospitalsList" class="stack"></div><div class="scroll-help" aria-hidden="true">Role para ver mais hospitais</div></div>')
  .replace('  <button class="nav-item" data-view="settings">⚙ Configurações</button>', '  <button class="nav-item manager-only" data-view="settings">⚙ Configurações</button>' + accessNav)
  .replace('<div class="sidebar-footer"><button id="exportBtn"', '<div class="sidebar-footer"><div class="sidebar-profile"><div id="sessionAvatar" class="session-avatar">U</div><div><strong id="sessionName">Usuário</strong><span id="sessionRole">Perfil</span></div><a href="/api/auth/logout" aria-label="Sair">Sair</a></div><button id="exportBtn"')
  .replace('</main>\n</div>', `${accessView}\n</main>\n</div>`)
  .replace('<div id="toast"', `${accessModal}\n\n<div id="toast"`);

await writeFile(`${targetRoot}/app/dashboard/legacy-body.ts`, `export const legacyBody = ${JSON.stringify(enhanced)};\n`);
