// Authenticator (TOTP, RFC 6238) code generation — so the bot can hand a VA the
// current 2-factor login code for their account on demand, instead of the VA
// setting up an authenticator app. Pure Node crypto, no dependency.

import { createHmac } from "crypto";

// Decode an RFC 4648 base32 secret (the string from an authenticator setup).
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue; // skip anything that isn't base32
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Current TOTP code for a base32 secret (SHA-1, 30s step, 6 digits by default). */
export function totp(secret: string, atMs: number = Date.now(), digits = 6, stepSec = 30): string {
  const key = base32Decode(secret);
  let counter = Math.floor(atMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** Seconds left before the current code rolls to the next one. */
export function totpSecondsRemaining(atMs: number = Date.now(), stepSec = 30): number {
  return stepSec - (Math.floor(atMs / 1000) % stepSec);
}

/**
 * Pull the 2FA/TOTP secret out of a stored login line. In our account format
 * ("user:pass:email:emailpass:token:token:SECRET") the secret is the trailing
 * base32 field (uppercase A–Z + 2–7, 16+ chars) — the hex auth-tokens and the
 * mixed-case passwords don't match, so we scan from the end for the first one
 * that does.
 */
export function parse2FASecret(login: string | null | undefined): string | null {
  if (!login) return null;
  const fields = login.split(":").map((f) => f.trim());
  for (let i = fields.length - 1; i >= 0; i--) {
    if (/^[A-Z2-7]{16,64}$/.test(fields[i])) return fields[i];
  }
  return null;
}
