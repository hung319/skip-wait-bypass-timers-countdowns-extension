/**
 * Background side of the Link4M automation:
 *  - opens the advertiser page for the current coupon round in a real tab
 *    (a background tab would be throttled, and the widget's 60 s timer is
 *    server-enforced, so it has to actually elapse);
 *  - remembers which advertiser hosts we opened, so the advertiser content
 *    script knows it may drive the page and close the tab again.
 */
const MARK_PREFIX = 'sw:link4m:advhost:';
const MARK_TTL_MS = 30 * 60 * 1000;

type Mark = { at: number };

function hostKeyOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

async function markHost(host: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [MARK_PREFIX + host]: { at: Date.now() } });
  } catch {
    /* session storage unavailable */
  }
}

async function isMarkedHost(host: string): Promise<boolean> {
  try {
    const got = await chrome.storage.session.get(MARK_PREFIX + host);
    const mark = got?.[MARK_PREFIX + host] as Mark | undefined;
    return !!mark && Date.now() - mark.at < MARK_TTL_MS;
  } catch {
    return false;
  }
}

async function unmarkHost(host: string): Promise<void> {
  try {
    await chrome.storage.session.remove(MARK_PREFIX + host);
  } catch {
    /* ignore */
  }
}

type SwMessage = { type?: string; url?: string };

export function initLink4mBackground(): void {
  chrome.runtime.onMessage.addListener((msg: SwMessage, sender, sendResponse) => {
    const type = msg?.type;
    if (!type || !type.startsWith('SW_LINK4M_')) return false;

    const senderHost = sender.tab?.url ? hostKeyOf(sender.tab.url) : null;

    if (type === 'SW_LINK4M_OPEN_ADVERTISER') {
      const host = msg.url ? hostKeyOf(msg.url) : null;
      if (!host || !msg.url) {
        sendResponse({ ok: false });
        return false;
      }
      void markHost(host)
        .then(() => chrome.tabs.create({ url: msg.url as string, active: true }))
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (type === 'SW_LINK4M_IS_AUTO_TAB') {
      if (!senderHost) {
        sendResponse({ auto: false });
        return false;
      }
      void isMarkedHost(senderHost).then((auto) => sendResponse({ auto }));
      return true;
    }

    if (type === 'SW_LINK4M_CLOSE_SELF_TAB') {
      const tabId = sender.tab?.id;
      if (tabId === undefined || !senderHost) {
        sendResponse({ ok: false });
        return false;
      }
      void isMarkedHost(senderHost).then(async (auto) => {
        if (!auto) return sendResponse({ ok: false });
        await unmarkHost(senderHost);
        try {
          await chrome.tabs.remove(tabId);
        } catch {
          /* already gone */
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    return false;
  });
}
