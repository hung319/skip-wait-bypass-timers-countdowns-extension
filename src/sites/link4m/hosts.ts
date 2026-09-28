/** Link4M rotates through many TLDs — match `link4m.<tld>` (optionally with `www.`). */
const LINK4M_HOST_RE = /^(?:www\.)?link4m\.[a-z]{2,6}$/i;

/** `link4m.co/full/?url=…` builds a short link and leaks the destination inline. */
export const LINK4M_FULL_PATH_RE = /^\/full\/?$/i;

/** `/<alias>` (302 → `/go/<alias>`) and the canonical `/go/<alias>`. */
export const LINK4M_ALIAS_RE = /^\/go\/([A-Za-z0-9_-]{4,32})\/?$/;
export const LINK4M_BARE_ALIAS_RE = /^\/([A-Za-z0-9_-]{4,32})\/?$/;

/** The API host used by the `captcha-page` front-end (`api_domain`). */
export const LINK4M_API_BASE = 'https://s1.link4m.app';

/** Hosts that serve the "get my code" (LẤY MÃ) widget on advertiser sites. */
export const ADVERTISER_WIDGET_HOSTS = ['website-analytics.net', 'best-traffic.pages.dev'] as const;

/** `/widget/service-v3.js?key=XXXX` — the widget bootstrap served to publishers. */
export const ADVERTISER_WIDGET_SCRIPT_RE =
  /(?:website-analytics\.net|best-traffic\.pages\.dev)\/widget\/(service(?:-v\d+)?)\.js/i;

/** Text the widget prints right before the coupon code, e.g. `Mã KM: zTdPrn`. */
export const ADVERTISER_CODE_RE = /M[ãa]\s*KM\s*:?\s*([A-Za-z0-9]{4,12})/i;

export function isLink4mHost(hostname: string): boolean {
  return LINK4M_HOST_RE.test(hostname.toLowerCase());
}

export function isAdvertiserWidgetHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ADVERTISER_WIDGET_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}
