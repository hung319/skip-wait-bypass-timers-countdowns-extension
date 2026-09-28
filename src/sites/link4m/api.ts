import { LINK4M_API_BASE } from './hosts';

/**
 * Link4M's `captcha-page` (AdLinkFly fork) talks to a separate API host.
 * The front-end exposes the base as `var api_domain = '…'` inside an inline script.
 * Content scripts live in an isolated world, so read it out of the DOM instead of `window`.
 */
export function readApiDomain(): string {
  for (const script of Array.from(document.scripts)) {
    const text = script.textContent ?? '';
    if (!text.includes('api_domain')) continue;
    const m = text.match(/api_domain\s*=\s*['"]([^'"]+)['"]/);
    if (m?.[1]) return m[1].replace(/\/+$/, '');
  }
  return LINK4M_API_BASE;
}

export type AdvertiseFields = {
  /** Hidden inputs of the injected `#main-form` (alias / campaign_id / display_id / prefix …). */
  hidden: Record<string, string>;
  /** `true` when the campaign asks for the 6-char advertiser coupon code. */
  hasPassword: boolean;
  /** `true` when a reCAPTCHA v2 widget is rendered for this campaign. */
  hasCaptcha: boolean;
};

export type AdvertiseResponse = {
  ok: boolean;
  info: string;
  /** Instructions for obtaining the coupon code (HTML). */
  instructions: string;
  /** Hidden form fields parsed out of `form`. */
  form: AdvertiseFields;
  /** First external destination mentioned in the instructions (the advertiser site). */
  advertiserUrl: string | null;
  /** Google-search keyword variant, when the campaign asks the user to search instead. */
  searchKeyword: string | null;
};

const IGNORED_ADVERTISER_HOSTS = [
  'link4m.com',
  'link4m.net',
  'link4m.co',
  'link4m.app',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'google.com',
  'google.com.vn',
  'gstatic.com',
];

function isIgnoredHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return IGNORED_ADVERTISER_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

/** Pull the advertiser destination out of the instructions HTML. */
export function extractAdvertiserUrl(html: string): string | null {
  const urls = new Set<string>();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    urls.add(a.href);
  }
  const copy = html.match(/copyTextToClipboard\(\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (copy?.[1]) urls.add(copy[1]);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>()]+/gi)) urls.add(m[0]);

  for (const raw of urls) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      if (isIgnoredHost(u.hostname)) continue;
      return u.origin;
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}

/** Some campaigns ask the visitor to search a keyword and open the matching site. */
export function extractSearchKeyword(html: string): string | null {
  const m = html.match(/t[ìi]m\s+t[ừu]\s+kho[áa][\s\S]{0,400}?>\s*([^<>{}]{2,60}?)\s*<\//i);
  if (!m?.[1]) return null;
  const keyword = m[1].trim();
  return /^https?:/i.test(keyword) ? null : keyword || null;
}

function parseFormFields(formHtml: string): AdvertiseFields {
  const doc = new DOMParser().parseFromString(formHtml, 'text/html');
  const hidden: Record<string, string> = {};
  for (const input of Array.from(doc.querySelectorAll<HTMLInputElement>('input[name]'))) {
    if (input.type === 'hidden') hidden[input.name] = input.value ?? '';
  }
  return {
    hidden,
    hasPassword: !!doc.querySelector('input[name="password"]'),
    hasCaptcha: !!doc.querySelector('.g-recaptcha, [name="g-recaptcha-response"], .h-captcha'),
  };
}

async function postForm(url: string, body: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(body),
    });
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

type RawAdvertise = {
  success?: boolean;
  info?: string;
  html?: string;
  form?: string;
  run?: string;
};

/** `POST /api/campaign/get-advertise` — asks the campaign which advertiser routine to run. */
export async function fetchAdvertise(
  base: string,
  alias: string,
  codes: string,
): Promise<AdvertiseResponse | null> {
  const raw = (await postForm(`${base}/api/campaign/get-advertise`, { alias, codes })) as
    | RawAdvertise
    | null;
  if (!raw || typeof raw !== 'object') return null;
  const html = typeof raw.html === 'string' ? raw.html : '';
  const formHtml = typeof raw.form === 'string' ? raw.form : '';
  return {
    ok: raw.success === true,
    info: typeof raw.info === 'string' ? raw.info : '',
    instructions: html,
    form: parseFormFields(formHtml),
    advertiserUrl: extractAdvertiserUrl(html),
    searchKeyword: extractSearchKeyword(html),
  };
}

export type GetLinkResult = { ok: boolean; url: string | null; info: string };

/**
 * `POST /links/get-link-info` — the only endpoint that returns the destination.
 * It requires the advertiser coupon code (when the campaign has one) **and** a
 * fresh reCAPTCHA v2 token. Link4M validates the captcha server-side; a token
 * cannot be minted without a real browser solve.
 */
export async function postGetLinkInfo(
  base: string,
  fields: Record<string, string>,
  captchaToken: string,
): Promise<GetLinkResult> {
  const raw = (await postForm(`${base}/links/get-link-info`, {
    ...fields,
    'g-recaptcha-response': captchaToken,
  })) as { success?: boolean; url?: string; info?: string } | null;
  const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
  return {
    ok: raw?.success === true && /^https?:\/\//i.test(url),
    url: url || null,
    info: typeof raw?.info === 'string' ? raw.info : '',
  };
}

export const PASSWORDS_QUERY = 'input[name="password"]';
export const CAPTCHA_RESPONSE_SELECTOR = '[name="g-recaptcha-response"]';
export const GET_LINK_SELECTOR = 'a.get-link';
