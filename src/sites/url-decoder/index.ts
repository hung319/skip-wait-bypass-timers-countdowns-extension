import { isAllowedHost } from '../../utils/domain-check';
import { URL_DECODER_HOSTS } from './hosts';

const LINK4M_FULL_RE = /^\/full\/?$/i;

// ── Shared decoding utilities ──

/** Safe base64 decode with error handling */
export function decodeBase64(s: string): string {
  try {
    return atob(s);
  } catch {
    return '';
  }
}

/** Safe decodeURIComponent with error handling */
export function safeDecodeUriComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Base64 decode a URL-safe segment (with -_ padding) */
export function decodeBase64UrlSafe(segment: string): string {
  const padding = segment.length % 4;
  const padded = padding ? segment + '='.repeat(4 - padding) : segment;
  try {
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

/** Decode base64 then JSON parse */
export function b64Json<T = unknown>(raw: string): T | null {
  try {
    const s = decodeURIComponent(raw);
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    return JSON.parse(atob(s + pad)) as T;
  } catch {
    return null;
  }
}

/** JWT payload decode (base64url) */
export function jwtPayload<T = unknown>(token: string): T | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = decodeBase64UrlSafe(part);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** Decode URL param from base64 query param */
function decodedUrlFromQueryParam(): string | null {
  try {
    const u = new URL(location.href);
    const raw = u.searchParams.get('url')?.trim();
    if (!raw) return null;
    const decoded = decodeBase64(raw);
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
  } catch {}
  return null;
}

// ── Content script init ──

export function initUrlDecoder(): void {
  if (!isAllowedHost(URL_DECODER_HOSTS)) return;

  // ── link4m.co/full/?api=...&url=<base64>&type=... ──
  if (!LINK4M_FULL_RE.test(location.pathname)) return;

  const url = decodedUrlFromQueryParam();
  if (url) {
    location.replace(url);
    return;
  }

  // Fallback: poll briefly for dynamic params
  let tries = 0;
  const id = window.setInterval(() => {
    tries++;
    const u = decodedUrlFromQueryParam();
    if (u) {
      window.clearInterval(id);
      location.replace(u);
    } else if (tries >= 20) {
      window.clearInterval(id);
    }
  }, 150);
}
