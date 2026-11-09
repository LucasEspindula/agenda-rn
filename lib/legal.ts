// Versão dos termos aceita no autocadastro (gravada em users.terms_version).
// Trocar a versão quando o texto jurídico final substituir o rascunho.
export const TERMS_VERSION = "2026-11-rascunho";

// Autocadastro público só liga com PUBLIC_SIGNUP_ENABLED=true (depois de e-mail e textos jurídicos prontos).
export function publicSignupEnabled() {
  return process.env.PUBLIC_SIGNUP_ENABLED === "true";
}
