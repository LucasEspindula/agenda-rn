import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "@/lib/security/http";

// Envio de e-mail via Resend (API HTTP, sem SDK). Configuração na Vercel:
//   RESEND_API_KEY  — chave do Resend
//   EMAIL_FROM      — remetente verificado, ex.: "RN Integra <nao-responda@seudominio.com.br>"
//   APP_ORIGIN      — endereço público usado nos links (ex.: https://app.seudominio.com.br)
// Sem chave: produção recusa (fail-closed); preview/local registram o e-mail no log do servidor.
export type Mail = { to: string; subject: string; text: string; html: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendMail(mail: Mail): Promise<"sent" | "logged"> {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) {
    if (process.env.VERCEL_ENV === "production") throw new HttpError(503, "Envio de e-mail ainda não configurado.");
    console.info("[email:outbox]", JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text }));
    return "logged";
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!response.ok) throw new HttpError(502, "Não foi possível enviar o e-mail. Tente novamente.");
  return "sent";
}

// Links usam sempre um endereço configurado, nunca o Host da requisição.
export function appOrigin(request?: Request): string {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (request && process.env.NODE_ENV !== "production") return new URL(request.url).origin;
  throw new HttpError(503, "Endereço da aplicação não configurado.");
}

// Token de uso único: o link leva o valor; o banco guarda só o SHA-256.
export function newEmailToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashEmailToken(token) };
}
export function hashEmailToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function validEmailToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function layout(title: string, lines: string[], action?: { label: string; url: string }) {
  const text = [title, "", ...lines, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "RN Integra"].join("\n");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f7f9;font-family:Arial,sans-serif;color:#12374f">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:14px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
${lines.map(l => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${escape(l)}</p>`).join("")}
${action ? `<p style="margin:22px 0"><a href="${escape(action.url)}" style="background:#12857f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;display:inline-block">${escape(action.label)}</a></p>
<p style="font-size:12px;color:#5b7383;word-break:break-all">Se o botão não funcionar, copie este endereço: ${escape(action.url)}</p>` : ""}
<p style="font-size:12px;color:#5b7383;margin-top:24px">RN Integra · Se você não pediu este e-mail, pode ignorá-lo.</p></div></body></html>`;
  return { text, html };
}

export const emails = {
  confirm: (to: string, name: string, url: string): Mail => ({ to, subject: "Confirme seu e-mail no RN Integra",
    ...layout("Confirme seu e-mail", [`Olá, ${name}.`, "Falta só confirmar seu e-mail para começar a usar o RN Integra. O link vale por 48 horas."], { label: "Confirmar e-mail", url }) }),
  alreadyRegistered: (to: string, url: string): Mail => ({ to, subject: "Você já tem uma conta no RN Integra",
    ...layout("Você já tem uma conta", ["Alguém tentou criar uma conta com este e-mail, mas ele já está cadastrado.", "Se foi você, entre com sua senha ou use “Esqueci minha senha”."], { label: "Entrar", url }) }),
  reset: (to: string, name: string, url: string): Mail => ({ to, subject: "Redefinir sua senha do RN Integra",
    ...layout("Redefinir senha", [`Olá, ${name}.`, "Recebemos um pedido para redefinir sua senha. O link vale por 1 hora e só pode ser usado uma vez."], { label: "Criar nova senha", url }) }),
  invite: (to: string, organization: string, inviter: string, url: string): Mail => ({ to, subject: `Convite para ${organization} no RN Integra`,
    ...layout("Você recebeu um convite", [`${inviter} convidou você para participar de ${organization} no RN Integra.`, "O convite vale por 7 dias."], { label: "Aceitar convite", url }) }),
};
