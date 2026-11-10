// Versão dos textos jurídicos aceita no autocadastro (gravada em users.terms_version).
// Enquanto contiver "rascunho", as páginas mostram o aviso de revisão jurídica.
// Trocar a versão quando o advogado aprovar o texto final.
export const TERMS_VERSION = "2026-11-10-rascunho";

// Identificação do fornecedor e do encarregado: preencher aqui (um único lugar) antes do lançamento.
// Campos entre colchetes aparecem destacados nas páginas para não passarem despercebidos.
export const LEGAL = {
  provider: "[RAZÃO SOCIAL]",
  cnpj: "[CNPJ]",
  address: "[ENDEREÇO COMPLETO]",
  forum: "[CIDADE/UF DA SEDE]",
  contactEmail: "[E-MAIL DE CONTATO]",
  dpoName: "[NOME DO ENCARREGADO]",
  dpoEmail: "[E-MAIL DO ENCARREGADO]",
};

// Prazos decididos pelo responsável em 10/11/2026.
export const LEGAL_TERMS = {
  exportWindowDays: 30,      // após o cancelamento, prazo para a clínica pedir a exportação
  deletionWithinDays: 60,    // depois disso, eliminação definitiva, inclusive das cópias de segurança
  incidentNoticeHours: 48,   // aviso de incidente à organização contratante
};

// Autocadastro público só liga com PUBLIC_SIGNUP_ENABLED=true (depois de e-mail e textos jurídicos prontos).
export function publicSignupEnabled() {
  return process.env.PUBLIC_SIGNUP_ENABLED === "true";
}
