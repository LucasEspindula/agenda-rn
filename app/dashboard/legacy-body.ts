export const legacyBody = `<div class="agenda-shell">
<aside class="agenda-subnav" aria-label="Navegação do Agendamento">
 <div class="agenda-owner"><label for="professionalFilter">Agenda do profissional</label><select id="professionalFilter"></select></div>
 <nav class="agenda-nav" aria-label="Áreas do Agendamento">
  <button class="agenda-nav-item active" data-view="agenda"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16"/></svg> Agenda</button>
  <button class="agenda-nav-item" data-view="patients"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-3a6 6 0 0 1 6-4h4a6 6 0 0 1 6 4v3"/></svg> Pacientes</button>
 </nav>
</aside>
<main class="main">
<header class="topbar"><div><h1 id="pageTitle">Agenda</h1><p id="pageSubtitle">Organize os atendimentos do profissional selecionado.</p></div><div class="top-actions"><button id="newBlockBtn" class="secondary-btn">+ Bloquear horário</button><div id="agendaNotifications" class="notification-center"><button id="notificationBell" class="notification-bell" type="button" aria-label="Abrir avisos da agenda" aria-expanded="false">&#128276;<span id="notificationCount" class="notification-count hidden">0</span></button><div id="notificationPanel" class="notification-panel hidden"><div class="notification-panel-head"><div><strong>Avisos da agenda</strong><span id="notificationSummary">Nenhuma pendência</span></div><button id="closeNotificationPanel" type="button" aria-label="Fechar avisos">×</button></div><div id="notificationPanelList"><div id="invoiceAlert" class="alert-strip hidden"><div>⚠</div><div><strong>Notas fiscais não informadas</strong><div id="invoiceAlertList" class="alert-list"></div></div></div><div id="missingGuideAlert" class="alert-strip hidden"><div>⚠</div><div><strong>Validade da guia não informada</strong><div id="missingGuideAlertList" class="alert-list"></div></div></div><div id="confirmationAlert" class="alert-strip hidden"><div>⚠</div><div><strong>Pacientes aguardando confirmação</strong><div id="confirmationAlertList" class="alert-list"></div></div></div><div id="guideAlert" class="alert-strip hidden"><div>⚠</div><div><strong>Guias próximas do vencimento</strong><div id="guideAlertList" class="alert-list"></div></div></div><div id="notificationEmpty" class="notification-empty">Nenhum aviso nesta agenda.</div></div></div></div><button id="newAppointmentBtn" class="primary-btn">+ Novo agendamento</button></div></header>

<section id="agendaView" class="view active">
 <div class="toolbar">
  <div class="date-wrap"><div class="date-controls"><button id="prevBtn" class="icon-btn">‹</button><button id="todayBtn" class="secondary-btn today-inline">Hoje</button><button id="nextBtn" class="icon-btn">›</button></div><div class="date-copy"><strong id="periodLabel"></strong><span id="periodRange"></span></div></div>
  <div id="agendaOwnerDisplay" class="agenda-owner-display"></div>
  <div class="filters"><span id="conflictSummary" class="conflict-summary hidden"></span><select id="statusFilter"><option value="">Todos os status</option><option value="scheduled">Agendado</option><option value="confirmed">Confirmado</option><option value="authorized">Autorizado</option><option value="analysis">Análise</option><option value="realized">Realizado</option></select><div class="segmented"><button class="segment active" data-mode="week">Semana</button><button class="segment" data-mode="day">Dia</button></div></div>
 </div>
 <div class="agenda-card"><div id="calendar" class="calendar"></div></div>
</section>

<section id="patientsView" class="view">
 <div class="content-card">
  <div class="section-head"><div><h2>Pacientes</h2><p>Cadastro, convênio e histórico de atendimentos.</p></div><button id="newPatientBtn" class="primary-btn">+ Novo paciente</button></div>
  <div class="search-row"><input id="patientSearch" type="search" placeholder="Buscar por nome, telefone, convênio ou carteirinha"></div>
  <div id="patientsTableWrap"></div>
 </div>
</section>

<section id="settingsView" class="view">
 <div class="settings-grid">
  <div class="content-card hospital-panel"><div class="section-head"><div><h2>Hospitais</h2><p>Lista global disponível para todos os profissionais.</p></div><button id="newHospitalBtn" class="secondary-btn">+ Adicionar hospital</button></div><div id="hospitalsList" class="stack"></div><div class="scroll-help" aria-hidden="true">Role para ver mais hospitais</div></div>

  <div class="content-card wide rules-panel">
    <div class="section-head">
      <div><h2>Regras de agendamento</h2><p>Preferências, restrições e bloqueios desta agenda.</p></div>
      <button id="newRuleBtn" class="secondary-btn">+ Nova regra</button>
    </div>
    <div class="form-grid two" style="margin-bottom:8px">
      <label>Cirurgião
        <select id="rulesProfessionalFilter"></select>
      </label>
      <label>Mostrar
        <select id="rulesStatusFilter"><option value="active">Ativas</option><option value="all">Todas</option></select>
      </label>
    </div>
    <div id="rulesList" class="stack"></div><div class="section-head"><h2>Bloqueios pontuais</h2><button id="configureBlockBtn" class="secondary-btn">+ Novo bloqueio</button></div><div id="configuredBlocks" class="stack"></div>
  </div>
 <div class="content-card wide manager-only access-panel">
  <div class="section-head"><div><h2>Usuários e permissões</h2><p>Acessos administrativos. Os logins médicos são gerenciados em Médicos.</p></div><button id="newAccessBtn" class="primary-btn">+ Conceder acesso</button></div>
  <div id="accessList" class="stack"></div>
 </div>
</div>
</section>
</main>
</div>

<div id="modalBackdrop" class="modal-backdrop hidden"></div>

<div id="appointmentModal" class="modal hidden">
 <div class="modal-panel">
  <div class="modal-head"><div><h3 id="appointmentModalTitle">Novo agendamento</h3><p>Dados do procedimento e do paciente.</p></div><button class="modal-close" data-close>×</button></div>
  <form id="appointmentForm"><input id="appointmentId" type="hidden">
   <div class="appointment-layout">
    <div class="appointment-main">
     <div id="agendaContext" class="context-box"></div>
     <div class="form-grid two">
      <label>Paciente<select id="appointmentPatient"></select></label>
      <label id="appointmentInsuranceLabel">Convênio / plano<input id="appointmentInsurance" list="appointmentInsuranceOptions" placeholder="Selecione ou informe o convênio"><datalist id="appointmentInsuranceOptions"></datalist></label>
      <label>Forma de cobrança<select id="appointmentBillingMethod" required><option value="">Selecione</option><option value="PARTICULAR">Particular</option><option value="CONVENIO">Convênio</option></select></label><section id="newAppointmentFinance" class="native-finance"></section>
      <label>Procedimento<input id="appointmentProcedure" required placeholder="Ex.: Artroscopia de joelho"></label>
      <label>Hospital<select id="appointmentHospital" required></select></label>
      <label>Validade da guia<input id="guideExpiry" type="date"></label>
      <label>Data<input id="appointmentDate" type="date" required></label>
      <label>Horário<input id="appointmentTime" type="time" required></label>
      <label>Duração<select id="appointmentDuration"><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">120 min</option></select></label>
      <label id="relatedProfessionalLabel">Anestesista<select id="relatedProfessional"></select></label>
     </div>
     <p class="subheading">Tipo de atendimento</p>
     <div class="care-choice"><label class="care-option"><input type="radio" name="careType" value="inpatient"><span>Internado</span></label><label class="care-option"><input type="radio" name="careType" value="outpatient" checked><span>Ambulatorial</span></label></div>
     <hr class="section-divider"><p class="subheading">Documentação e materiais</p>
     <div class="toggle-grid">
      <label class="flag-toggle"><div><strong>OPME</strong><div class="flag-state" data-state-for="flagOpme">Não</div></div><input id="flagOpme" type="checkbox"><span class="switch"></span></label>
      <label class="flag-toggle"><div><strong>Laudos</strong><div class="flag-state" data-state-for="flagReports">Não</div></div><input id="flagReports" type="checkbox"><span class="switch"></span></label>
      <label class="flag-toggle"><div><strong>Exames</strong><div class="flag-state" data-state-for="flagExams">Não</div></div><input id="flagExams" type="checkbox"><span class="switch"></span></label>
     </div>
     <div class="form-grid"><label>Observações<textarea id="appointmentNotes" rows="4" placeholder="Observações do atendimento..."></textarea></label></div>
     <div id="ruleFeedback" class="rule-feedback"></div><div id="pastDateWarning" class="warning-note hidden">Não é possível salvar um agendamento em uma data anterior a hoje.</div>
     <div class="modal-actions"><button id="deleteAppointmentBtn" type="button" class="danger-btn hidden">Cancelar agendamento</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Fechar</button><button id="saveAppointmentBtn" type="submit" class="primary-btn">Salvar</button></div>
    </div>
    <aside class="patient-side">
     <div class="patient-card">
      <div class="patient-card-head"><div id="patientAvatar" class="patient-big-avatar">P</div><div><h4 id="patientSideName">Selecione um paciente</h4><p>Informações do paciente</p></div></div>
      <div class="patient-info-line"><span>Telefone</span><strong id="patientSidePhone">—</strong></div>
      <div class="patient-info-line"><span>E-mail</span><strong id="patientSideEmail">—</strong></div>
      <div class="patient-info-line"><span>Convênio</span><strong id="patientSideInsurance">—</strong></div>
      <div class="patient-info-line"><span>Carteirinha</span><strong id="patientSideCard">—</strong></div>
     </div>
     <div class="side-title">Histórico recente</div><div id="patientHistory" class="history-list"></div>
    </aside>
   </div>
  </form>
 </div>
</div>

<div id="patientModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3 id="patientModalTitle">Novo paciente</h3><p>Informações cadastrais.</p></div><button class="modal-close" data-close>×</button></div><form id="patientForm" style="padding:0 20px 20px"><input id="patientId" type="hidden"><div class="form-grid"><label>Nome<input id="patientName" required></label><label>CPF (opcional)<input id="patientCPF" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"></label><label>Endereço (opcional)<input id="patientAddress" maxlength="1000"></label><label>Telefone<input id="patientPhone"></label><label>E-mail<input id="patientEmail" type="email"></label><label>Convênio<input id="patientInsurance" placeholder="Ex.: Unimed"></label><label>Número da carteirinha<input id="patientCardNumber"></label></div><div class="modal-actions"><button id="deletePatientBtn" type="button" class="danger-btn hidden">Excluir</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Salvar</button></div></form></div></div>

<div id="patientDetailModal" class="modal hidden"><div class="modal-panel medium"><div class="modal-head"><div><h3 id="patientDetailTitle">Paciente</h3><p>Informações e histórico completo.</p></div><button class="modal-close" data-close>×</button></div><div class="patient-detail-grid"><div class="detail-card"><h4>Dados cadastrais</h4><div class="detail-row"><span>Telefone</span><strong id="detailPhone">—</strong></div><div class="detail-row"><span>E-mail</span><strong id="detailEmail">—</strong></div><div class="detail-row"><span>Convênio</span><strong id="detailInsurance">—</strong></div><div class="detail-row"><span>Carteirinha</span><strong id="detailCard">—</strong></div><div class="modal-actions"><button id="editPatientFromDetail" class="secondary-btn" type="button">Editar paciente</button></div></div><div class="detail-card"><h4>Histórico</h4><div id="detailHistory" class="history-list" style="max-height:430px"></div></div></div></div></div>


<div id="hospitalModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3 id="hospitalModalTitle">Novo hospital</h3><p>O hospital ficará disponível para todos.</p></div><button class="modal-close" data-close>×</button></div><form id="hospitalForm" style="padding:0 20px 20px"><div class="form-grid"><input id="hospitalId" type="hidden"><label>Nome do hospital<input id="hospitalName" required></label></div><div class="modal-actions"><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Adicionar</button></div></form></div></div>


<div id="blockModal" class="modal hidden">
 <div class="modal-panel small">
  <div class="modal-head"><div><h3 id="blockModalTitle">Bloquear horário</h3><p>Crie uma indisponibilidade pontual na agenda.</p></div><button class="modal-close" data-close>×</button></div>
  <form id="blockForm" style="padding:0 20px 20px">
   <input id="blockId" type="hidden">
   <div id="blockContext" class="context-box"></div>
   <div class="form-grid two">
    <label>Data<input id="blockDate" type="date" required></label>
    <label>Início<input id="blockStart" type="time" required></label>
    <label>Término<input id="blockEnd" type="time" required></label>
   </div>
   <p class="inline-note">O bloqueio manual vale para o profissional em qualquer hospital.</p>
   <div class="form-grid"><label>Motivo<input id="blockReason" required placeholder="Ex.: Congresso, indisponível, reunião..."></label></div>
   <div class="modal-actions"><button id="deleteBlockBtn" type="button" class="danger-btn hidden">Excluir</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Salvar bloqueio</button></div>
  </form>
 </div>
</div>

<div id="ruleModal" class="modal hidden">
 <div class="modal-panel medium">
  <div class="modal-head"><div><h3 id="ruleModalTitle">Nova regra</h3><p>Configure quando e como a regra deve ser aplicada.</p></div><button class="modal-close" data-close>×</button></div>
  <form id="ruleForm" style="padding:0 20px 20px">
   <input id="ruleId" type="hidden">
   <div class="form-grid two">
    <label>Cirurgião<select id="ruleProfessional" required></select></label>
    <label>Nome da regra<input id="ruleName" required placeholder="Ex.: HED Eletivas"></label>
    <label>Hospital<select id="ruleHospital"><option value="">Todos os hospitais</option></select></label>
    <label>Comportamento<select id="ruleSeverity"><option value="preference">Preferência</option><option value="warning">Aviso</option><option value="block">Bloqueio</option></select></label>
    <label>Dia da semana<select id="ruleWeekday"><option value="">Qualquer dia</option><option value="1">Segunda</option><option value="2">Terça</option><option value="3">Quarta</option><option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option><option value="0">Domingo</option></select></label>
    <label>Ocorrência no mês<select id="ruleOccurrence"><option value="">Qualquer</option><option value="1">Primeira</option><option value="2">Segunda</option><option value="3">Terceira</option><option value="4">Quarta</option><option value="last">Última</option></select></label>
    <label>Horário permitido - início<input id="ruleStart" type="time"></label>
    <label>Horário permitido - término<input id="ruleEnd" type="time"></label>
    <label>Máximo de pacientes no dia<input id="ruleMaxPatients" type="number" min="1" placeholder="Ex.: 4"></label>
    <label>Procedimento contém<input id="ruleProcedure" placeholder="Opcional. Ex.: eletiva"></label>
   </div>
   <div class="form-grid two">
    <label>Horários preferenciais<input id="rulePreferredTimes" placeholder="08:30, 11:00, 13:00"></label>
    <label>Horários proibidos<input id="ruleForbiddenTimes" placeholder="06:00, 07:00"></label>
   </div>
   <label class="checkbox-line"><input id="ruleBlockAllDay" type="checkbox"> Bloquear o dia inteiro</label>
   <label class="checkbox-line"><input id="ruleEnabled" type="checkbox" checked> Regra ativa</label>
   <p class="inline-note">Preferência apenas orienta. Aviso pede confirmação. Bloqueio impede o salvamento quando a condição for violada.</p>
   <div class="modal-actions"><button id="deleteRuleBtn" type="button" class="danger-btn hidden">Excluir regra</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Salvar regra</button></div>
  </form>
 </div>
</div>


<div id="accessModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3 id="accessModalTitle">Conceder acesso</h3><p>Defina o papel, a senha e as agendas disponíveis.</p></div><button class="modal-close" data-close>×</button></div><form id="accessForm" style="padding:0 20px 20px"><input id="accessId" type="hidden"><div class="form-grid"><label>E-mail<input id="accessEmail" type="email" required></label><label>Nome<input id="accessName"></label><label>Nível<select id="accessRole"><option value="secretary">Secretaria</option><option value="general_manager">Gerente geral</option></select></label><label>Senha inicial ou nova senha<span class="password-control"><input id="accessPassword" type="password" minlength="12" autocomplete="new-password" placeholder="Mínimo de 12 caracteres"><button id="toggleAccessPassword" type="button" aria-label="Mostrar senha" aria-pressed="false" title="Mostrar senha"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label><fieldset class="access-fieldset"><legend>Agendas permitidas</legend><p id="accessAgendaSummary" class="muted"></p><div id="accessAgendaChoices" class="agenda-choices"></div></fieldset></div><p id="accessFormError" role="alert" class="access-error hidden" tabindex="-1"></p><div class="modal-actions"><button id="deleteAccessBtn" type="button" class="danger-btn hidden">Remover acesso</button><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Cancelar</button><button type="submit" class="primary-btn">Salvar acesso</button></div></form></div></div>

<div id="cancelAppointmentModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3>Cancelar agendamento</h3><p>O atendimento sairá da agenda e continuará preservado em Cancelados.</p></div><button class="modal-close" data-close>×</button></div><form id="cancelAppointmentForm" style="padding:0 20px 20px"><input id="cancelAppointmentId" type="hidden"><div id="cancelAppointmentSummary" class="context-box"></div><div class="form-grid"><label>Motivo do cancelamento<select id="cancelReasonSelect" required><option value="">Selecione um motivo</option><option>Cancelado pelo paciente</option><option>Cancelado pelo médico</option><option>Problema com autorização do convênio</option><option>Reagendamento solicitado</option><option value="Outro">Outro motivo</option></select></label><label id="cancelReasonOtherLabel" class="hidden">Detalhe o motivo<textarea id="cancelReasonOther" rows="3"></textarea></label></div><div class="modal-actions"><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Voltar</button><button type="submit" class="danger-btn">Confirmar cancelamento</button></div></form></div></div>
<div id="rescheduleReasonModal" class="modal hidden"><div class="modal-panel small"><div class="modal-head"><div><h3>Reagendar atendimento</h3><p>Escolha a nova data e registre o motivo. Esta alteração ficará no histórico do agendamento.</p></div><button class="modal-close" data-close>×</button></div><form id="rescheduleReasonForm" style="padding:0 20px 20px"><input id="rescheduleAppointmentId" type="hidden"><div id="reschedulePreview" class="reschedule-compare"></div><div class="form-grid two"><label>Nova data<input id="rescheduleNewDate" type="date" required></label><label>Horário<input id="rescheduleNewTime" type="time" required></label></div><div class="form-grid"><label>Motivo<textarea id="rescheduleReason" rows="4" required placeholder="Descreva o motivo do reagendamento"></textarea></label></div><div class="modal-actions"><div class="spacer"></div><button type="button" class="secondary-btn" data-close>Voltar</button><button type="submit" class="primary-btn">Salvar</button></div></form></div></div>

<div id="systemDialog" class="modal hidden"><div class="modal-panel small system-dialog-panel"><div class="modal-head"><div><h3 id="systemDialogTitle">Aviso</h3><p id="systemDialogMessage"></p></div><button class="modal-close" data-dialog-cancel>×</button></div><div class="modal-actions system-dialog-actions"><button id="systemDialogCancel" type="button" class="secondary-btn" data-dialog-cancel>Cancelar</button><button id="systemDialogConfirm" type="button" class="primary-btn">Continuar</button></div></div></div>

<div id="toast" class="toast hidden"></div>`;


