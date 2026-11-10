// Limpeza do que vai para o monitoramento: mensagens de erro podem carregar e-mail, CPF,
// telefone, nomes em URLs ou tokens. Nada disso sai daqui; sobra só o que ajuda a achar a falha.

export const MAX_TITLE = 300;
export const MAX_DETAIL = 2000;

export function scrub(value: unknown, max = MAX_TITLE): string {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
    .replace(/\b(?:eyJ|sk_|re_|Bearer\s)[\w.-]{8,}/g, "[token]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim()
    .slice(0, max);
}

// Rota sem identificadores: /api/patients/123/export → /api/patients/:id/export.
export function normalizeRoute(value: unknown): string {
  let path = String(value ?? "");
  try { path = new URL(path, "http://x").pathname; } catch { path = ""; }
  return path
    .split("/")
    .map(part => (/^\d+$/.test(part) || /^[0-9a-f-]{16,}$/i.test(part) || /^[A-Za-z0-9_-]{24,}$/.test(part) ? ":id" : part))
    .join("/")
    .slice(0, 200) || "/";
}

// Só as primeiras linhas da pilha, sem caminhos da máquina: o suficiente para achar o arquivo.
export function scrubStack(stack: unknown, lines = 5): string {
  return String(stack ?? "")
    .split("\n")
    .slice(1, lines + 1)
    .map(line => scrub(line.trim()
      // Caminho do projeto vira relativo (app/…, lib/…); qualquer outro caminho vira só o nome do arquivo.
      .replace(/[^\s()]*[\\/][^\s()]*/g, path => {
        const project = path.match(/(?:^|[\\/])((?:app|lib|components|public|_next)[\\/].*)$/);
        return (project ? project[1] : path.split(/[\\/]/).pop() || "").replace(/\\/g, "/");
      }), 200))
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_DETAIL);
}

// Agrupa erros iguais: números e ids variam a cada ocorrência, a assinatura não.
export function groupingText(value: string): string {
  return value.replace(/\[[a-zúê]+\]/g, "_").replace(/\d+/g, "N").toLowerCase();
}

export async function fingerprint(...parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
