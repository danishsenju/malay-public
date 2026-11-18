/**
 * Web Push on Web Crypto + fetch only - runs unchanged on Cloudflare Workers
 * and Node 20+. (The `web-push` npm package needs node:https and
 * crypto.createECDH, which Workers doesn't reliably provide.)
 *
 *   RFC 8291 - message encryption (aes128gcm content coding)
 *   RFC 8292 - VAPID (ES256 JWT in the Authorization header)
 */

export interface PushTarget {
  endpoint: string
  /** base64url, uncompressed P-256 point (65 bytes) */
  p256dh: string
  /** base64url, 16 bytes */
  auth: string
}

export interface VapidKeys {
  /** base64url, uncompressed P-256 point (65 bytes) - same value the browser subscribed with */
  publicKey: string
  /** base64url, 32-byte private scalar */
  privateKey: string
  /** https: URL or mailto: - push services contact this if we misbehave */
  subject: string
}

export interface SendOptions {
  ttlSeconds?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
}

/** HTTP status from the push service; 404/410 mean the subscription is gone. */
export class PushError extends Error {
  constructor(public statusCode: number, body: string) {
    super(`push service ${statusCode}: ${body.slice(0, 200)}`)
  }
}

const enc = new TextEncoder()

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8)
  return new Uint8Array(bits)
}

// ── VAPID (RFC 8292) ────────────────────────────────────────────────────────

const signingKeys = new Map<string, Promise<CryptoKey>>()

function vapidSigningKey(v: VapidKeys): Promise<CryptoKey> {
  let k = signingKeys.get(v.publicKey)
  if (!k) {
    const pub = b64urlDecode(v.publicKey) // 0x04 || x(32) || y(32)
    k = crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC', crv: 'P-256',
        x: b64urlEncode(pub.slice(1, 33)),
        y: b64urlEncode(pub.slice(33, 65)),
        d: v.privateKey,
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    signingKeys.set(v.publicKey, k)
  }
  return k
}

async function vapidAuthorization(endpoint: string, v: VapidKeys): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // spec max is 24h
    sub: v.subject,
  })))
  const unsigned = `${header}.${claims}`
  // Web Crypto ECDSA signatures are already raw r||s - exactly what JWS ES256 wants.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(v), enc.encode(unsigned))
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${v.publicKey}`
}

// ── Encryption (RFC 8291, aes128gcm) ────────────────────────────────────────

export async function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, plaintext: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(target.p256dh)
  const authSecret = b64urlDecode(target.auth)

  // Fresh ephemeral key per message (the "application server" key pair).
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // Single record: payload || 0x02 (last-record delimiter), no padding.
  const record = concat(enc.encode(plaintext), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))

  // Header: salt(16) || record size (uint32 BE) || idlen(1) || keyid (= as_public)
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

// ── Send ────────────────────────────────────────────────────────────────────

export async function sendWebPush(target: PushTarget, payload: string, vapid: VapidKeys, opts: SendOptions = {}): Promise<void> {
  const body = await encryptPayload(target, payload)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttlSeconds ?? 3600),
      Urgency: opts.urgency ?? 'normal',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new PushError(res.status, await res.text().catch(() => ''))
}
