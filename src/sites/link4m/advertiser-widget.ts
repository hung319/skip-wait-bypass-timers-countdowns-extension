import { ADVERTISER_CODE_RE, ADVERTISER_WIDGET_SCRIPT_RE } from './hosts';
import { normalizeCodeKey, saveCachedCode } from './code-store';

/**
 * Advertiser sites embed `website-analytics.net/widget/service-v3.js?key=XXXX`
 * which renders a "LẤY MÃ" (get code) button feeding Link4M the 6-char coupon.
 *
 * The widget is fragile in ways that make automating it worthwhile:
 *  - it binds its handler to `touchstart` on touch devices (a plain click does nothing);
 *  - the countdown only advances while synthetic scroll events keep flowing;
 *  - step 1 takes 60 s (server-enforced) and then asks for a page reload before step 2.
 */

const ELEMENT_WAIT_MS = 30_000;
const START_POLL_MS = 1000;
const KEEPALIVE_MS = 250;

type WidgetContext = {
  element: HTMLElement;
};

function widgetKeyFromScripts(): string | null {
  for (const script of Array.from(document.scripts)) {
    const src = script.getAttribute('src') || '';
    if (!ADVERTISER_WIDGET_SCRIPT_RE.test(src)) continue;
    const key = new URL(src, location.href).searchParams.get('key');
    if (key) return key;
  }
  return null;
}

function waitForElement(id: string, timeoutMs: number): Promise<HTMLElement | null> {
  const found = document.getElementById(id);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const mo = new MutationObserver(() => {
      const el = document.getElementById(id);
      if (el || Date.now() > deadline) {
        mo.disconnect();
        resolve(el);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => {
      mo.disconnect();
      resolve(document.getElementById(id));
    }, timeoutMs);
  });
}

const isAutoTab = (): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'SW_LINK4M_IS_AUTO_TAB' }, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply?.auto === true);
      });
    } catch {
      resolve(false);
    }
  });

function closeSelfTab(): void {
  try {
    chrome.runtime.sendMessage({ type: 'SW_LINK4M_CLOSE_SELF_TAB' }, () => void chrome.runtime.lastError);
  } catch {
    /* ignore */
  }
}

/** Fire the same event a real finger/mouse would. */
function pressStart(button: HTMLElement): void {
  const type = 'ontouchstart' in document.documentElement ? 'touchstart' : 'click';
  button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
}

function keepCountdownAlive(): number {
  return window.setInterval(() => {
    document.dispatchEvent(new Event('mousewheel', { bubbles: true }));
    document.body?.dispatchEvent(new Event('touchmove', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
  }, KEEPALIVE_MS);
}

function codePanelText(): string {
  return document.querySelector('.whatoncode')?.textContent?.trim() ?? '';
}

async function runWidget(ctx: WidgetContext): Promise<void> {
  const { element } = ctx;
  const auto = await isAutoTab();
  let startedAt = 0;
  let keepAlive = 0;
  let reloaded = false;
  let done = false;

  const stopKeepAlive = (): void => {
    if (keepAlive) window.clearInterval(keepAlive);
    keepAlive = 0;
  };

  const finish = async (code: string): Promise<void> => {
    if (done) return;
    done = true;
    stopKeepAlive();
    await saveCachedCode(normalizeCodeKey(location.hostname), code);
    // Hand the tab back: the Link4M page picks the code up from storage.
    if (auto) {
      const banner = document.createElement('div');
      banner.id = 'sw-link4m-done';
      banner.textContent = `Skip Wait: đã lấy mã ${code} — đang quay lại trang Link4M…`;
      banner.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:12px;background:#0f172a;color:#e2f3ff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.35)';
      document.documentElement.appendChild(banner);
      window.setTimeout(closeSelfTab, 1200);
    }
  };

  const scan = (): void => {
    if (done) return;
    const text = codePanelText();

    const codeMatch = text.match(ADVERTISER_CODE_RE);
    if (codeMatch?.[1]) {
      void finish(codeMatch[1]);
      return;
    }

    // Step 1 finished → the widget wants a fresh page load before step 2.
    const step1Done =
      element.dataset['loaded'] === 'true' && !text.includes('Mã KM') && text.length > 0;
    if (step1Done && !reloaded && auto) {
      reloaded = true;
      stopKeepAlive();
      window.setTimeout(() => location.reload(), 800);
      return;
    }

    // Start (or restart) the countdown handler.
    if (!element.dataset['click']) {
      const button = element.querySelector('button');
      if (button && Date.now() - startedAt > START_POLL_MS) {
        startedAt = Date.now();
        pressStart(button);
      }
      return;
    }

    if (!keepAlive && !element.dataset['loaded']) {
      keepAlive = keepCountdownAlive();
    }
    if (element.dataset['loaded'] && keepAlive) stopKeepAlive();
  };

  scan();
  const poll = window.setInterval(() => {
    scan();
    if (done) window.clearInterval(poll);
  }, 400);
  window.addEventListener('pagehide', () => stopKeepAlive(), { once: true });
}

export function initAdvertiserWidgetAutomation(): void {
  const boot = (): void => {
    const key = widgetKeyFromScripts();
    if (!key) return;
    void waitForElement(key, ELEMENT_WAIT_MS).then((element) => {
      if (!element) return;
      void runWidget({ element });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
