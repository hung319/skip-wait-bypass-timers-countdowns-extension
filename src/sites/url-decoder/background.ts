import { decodeBase64 } from './index';

const LINK4M_FULL_RE = /^https:\/\/link4m\.co\/full\/\?/i;

/** Intercept link4m.co/full/ navigations and redirect directly to decoded URL */
export function initUrlDecoderBackground(): void {
  chrome.webNavigation.onBeforeNavigate.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      if (!LINK4M_FULL_RE.test(details.url)) return;

      try {
        const u = new URL(details.url);
        const raw = u.searchParams.get('url')?.trim();
        if (!raw) return;
        const decoded = decodeBase64(raw);
        if (!decoded.startsWith('http://') && !decoded.startsWith('https://')) return;

        // Redirect directly to the decoded destination
        chrome.tabs.update(details.tabId, { url: decoded });
      } catch {}
    },
    { url: [{ hostEquals: 'link4m.co', pathPrefix: '/full/' }] },
  );
}
