import { decodeBase64 } from './index';
import { LINK4M_HOST_RE } from './hosts';

const LINK4M_FULL_RE = /^https?:\/\/link4m\.[a-z]{2,6}\/full\/\?/i;

/** Intercept `link4m.<tld>/full/?url=…` navigations and redirect straight to the decoded URL. */
export function initUrlDecoderBackground(): void {
  chrome.webNavigation.onBeforeNavigate.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      if (!LINK4M_FULL_RE.test(details.url)) return;

      try {
        const url = new URL(details.url);
        if (!LINK4M_HOST_RE.test(url.hostname)) return;
        const raw = url.searchParams.get('url')?.trim();
        if (!raw) return;
        const decoded = decodeBase64(raw);
        if (!/^https?:\/\//i.test(decoded)) return;

        // Skip the ad page: the destination is already in the link.
        chrome.tabs.update(details.tabId, { url: decoded });
      } catch {
        /* malformed URL — leave navigation alone */
      }
    },
    { url: [{ hostSuffix: 'link4m.co' }, { hostSuffix: 'link4m.net' }, { hostSuffix: 'link4m.com' }] },
  );
}
