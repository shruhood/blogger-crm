// Minimal HMAC-SHA256 JWT implementation using the Web Crypto API.
// No external dependency needed — Workers ship SubtleCrypto natively.

function base64url(input: ArrayBuffer | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

async function getKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  exp: number; // unix seconds
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const key = await getKey(secret);

  const sigStr = base64urlDecode(sigB64);
  const sigBytes = new Uint8Array(sigStr.length);
  for (let i = 0; i < sigStr.length; i++) sigBytes[i] = sigStr.charCodeAt(i);

  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
  if (!valid) return null;

  const payload: JwtPayload = JSON.parse(base64urlDecode(payloadB64));
  if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
  return payload;
}
