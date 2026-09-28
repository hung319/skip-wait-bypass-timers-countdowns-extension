/**
 * Link4M runs on many TLDs (`link4m.co`, `link4m.net`, `link4m.com`, …), and the
 * `/full/?url=<base64>` endpoint is a *link builder*: it creates a short link
 * whose destination is the base64 `url` parameter. Reading that parameter is
 * therefore a complete bypass — no ad page, no captcha.
 */
export const LINK4M_FULL_RE = /^\/full\/?$/i;
export const LINK4M_HOST_RE = /^link4m\.[a-z]{2,6}$/i;

export function isLink4mHost(hostname: string): boolean {
  return LINK4M_HOST_RE.test(hostname.toLowerCase());
}
