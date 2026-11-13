// Regra única para toda senha nova (cadastro, redefinição, convite e acessos criados pela gerência).
// O login continua aceitando senhas antigas: a regra vale na hora de criar ou trocar a senha.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

// Palavras que, sozinhas ou repetidas e cercadas só de números e símbolos, deixam a senha fácil de adivinhar.
const WEAK_WORDS = new Set([
  "senha", "minhasenha", "novasenha", "senhaforte", "mudarsenha", "trocarsenha", "mudar", "trocar",
  "password", "passw", "pass", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbn", "abc", "abcd", "abcdef", "abcdefgh",
  "admin", "administrador", "login", "usuario", "user", "teste", "test", "welcome", "bemvindo", "iloveyou", "teamo",
  "clinica", "rnintegra", "integra", "agenda", "agendarn", "medico", "medica", "doutor", "doutora", "secretaria", "gerente", "anestesia",
  "brasil", "deus", "jesus", "deusefiel", "flamengo", "corinthians", "palmeiras", "saopaulo", "gremio", "vasco", "santos", "cruzeiro", "internacional",
]);

export const PASSWORD_RULE = `Use de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres e evite senhas comuns (como "senha", sequências de números ou o seu e-mail).`;

function letters(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

// Devolve o motivo da recusa, ou null quando a senha pode ser usada.
export function passwordProblem(password: string, email?: string | null): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return `A senha precisa ter de ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres.`;
  const weak = "Essa senha é fácil de adivinhar. " + PASSWORD_RULE;
  if (/^(.)\1+$/u.test(password)) return weak;
  const word = letters(password), unit = word.match(/^(.+?)\1+$/)?.[1] ?? word;
  // Quase só números e símbolos (ex.: 123456789012, Ab123456789!).
  if (word.length < 3) return weak;
  if (WEAK_WORDS.has(word) || WEAK_WORDS.has(unit) || unit.length <= 2) return weak;
  const local = letters(String(email || "").split("@")[0] || "");
  if (local.length >= 4 && word.includes(local)) return "A senha não pode conter o seu e-mail. " + PASSWORD_RULE;
  return null;
}
