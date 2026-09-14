const encoder = new TextEncoder();
const ITERATIONS = 600_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hashPassword(password: string, saltValue?: string, iterations = ITERATIONS) {
  const salt = saltValue ? base64ToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return { hash: `pbkdf2-sha256$${iterations}$${bytesToBase64(new Uint8Array(bits))}`, salt: bytesToBase64(salt) };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string) {
  const parts = expectedHash.split("$");
  const iterations = parts.length === 1 ? 100_000 : Number(parts[1]);
  if ((parts.length !== 1 && (parts.length !== 3 || parts[0] !== "pbkdf2-sha256")) || ![100_000,600_000].includes(iterations)) return false;
  const candidate = await hashPassword(password, salt, iterations);
  const a = base64ToBytes(candidate.hash.split("$")[2]), b = base64ToBytes(parts.at(-1)!);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToBase64(new Uint8Array(digest));
}

