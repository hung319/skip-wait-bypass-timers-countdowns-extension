import { createFullPageOverlay, type FullPageOverlay } from '../../injected-ui/full-page-overlay';
import { pinSiteWidgetOverOverlay } from '../../injected-ui/pin-site-widget';
import {
  CAPTCHA_RESPONSE_SELECTOR,
  extractSearchKeyword,
  fetchAdvertise,
  postGetLinkInfo,
  readApiDomain,
} from './api';
import { loadCachedCode, normalizeCodeKey, onCachedCodeChanged } from './code-store';
import { LINK4M_ALIAS_RE, isLink4mHost } from './hosts';

const OVERLAY_ID = 'skip-wait-link4m-overlay';
const CAPTCHA_PIN_STYLE_ID = 'skip-wait-link4m-captcha-pin';
const PANEL_CLASS = 'sw-l4m-panel';
const FIELD_NAMES = ['alias', 'campaign_id', 'display_id', 'prefix'] as const;

const NOTE_IDLE = {
  lead: 'Link4M cần một mã lấy từ trang quảng cáo.',
  detail: 'Skip Wait tự mở trang đó và lấy mã giúp bạn.',
} as const;

const NOTE_READY = {
  lead: 'Đã có mã — còn đúng 1 bước.',
  detail: 'Tick ô "Tôi không phải là người máy". Skip Wait tự chuyển trang khi xong.',
} as const;

const isRealUrl = (s: string): boolean => /^https?:\/\//i.test(s);

type Fields = Record<string, string>;

type Panel = {
  anchor: HTMLElement;
  setStatus: (text: string) => void;
  setAction: (text: string, handler: (() => void) | null) => void;
};

type State = {
  alias: string;
  fields: Fields;
  code: string | null;
  advertiserUrl: string | null;
  advertiserKey: string | null;
  overlay: FullPageOverlay;
  panel: Panel;
  quiet: boolean;
  finished: boolean;
};

const passwordInput = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>('input[name="password"]');

const captchaToken = (): string => {
  for (const el of Array.from(
    document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(CAPTCHA_RESPONSE_SELECTOR),
  )) {
    const value = (el.value || '').trim();
    if (value.length > 20) return value;
  }
  return '';
};

const captchaContainerId = (): string | null => {
  for (const id of ['recaptcha', 'recaptcha-2', 'hcaptcha', 'hcaptcha-2']) {
    if (document.getElementById(id)) return id;
  }
  return null;
};

const hostKey = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return normalizeCodeKey(new URL(url, location.href).hostname);
  } catch {
    return normalizeCodeKey(url);
  }
};

function readHiddenFields(): Fields {
  const out: Fields = {};
  for (const name of FIELD_NAMES) {
    const el = document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
    if (el?.value) out[name] = el.value;
  }
  return out;
}

/** The page injects the advertiser link inside `#advertise-html-wrapper`. */
function advertiserUrlFromPage(): string | null {
  const box = document.getElementById('advertise-html-wrapper');
  if (!box) return null;
  const copy = box.innerHTML.match(/copyTextToClipboard\(\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (copy?.[1]) return copy[1];
  const link = box.querySelector<HTMLAnchorElement>('a[href^="http"]');
  return link?.href ?? null;
}

function buildPanel(mount: HTMLElement): Panel {
  const style = document.createElement('style');
  style.textContent =
    `.${PANEL_CLASS}{width:100%;max-width:360px;margin:0 auto;display:flex;flex-direction:column;gap:10px;align-items:stretch}` +
    `.${PANEL_CLASS} .sw-l4m-status{font-size:.85em;line-height:1.5;color:#e2e8f0;text-align:center}` +
    `.${PANEL_CLASS} button{appearance:none;border:0;border-radius:10px;padding:11px 16px;font-size:.9em;font-weight:600;cursor:pointer;background:linear-gradient(180deg,#38bdf8,#0ea5e9);color:#04263a;font-family:inherit}` +
    `.${PANEL_CLASS} button[disabled]{opacity:.55;cursor:default}`;

  const panel = document.createElement('div');
  panel.className = PANEL_CLASS;

  const status = document.createElement('div');
  status.className = 'sw-l4m-status';

  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = true;

  const anchor = document.createElement('div');

  panel.append(style, status, button, anchor);
  mount.appendChild(panel);

  let handler: (() => void) | null = null;
  button.addEventListener('click', () => handler?.());

  return {
    anchor,
    setStatus: (text) => {
      status.textContent = text;
    },
    setAction: (text, nextHandler) => {
      handler = nextHandler;
      button.textContent = text;
      button.hidden = !nextHandler;
      button.disabled = !nextHandler;
    },
  };
}

function openAdvertiserTab(url: string): void {
  try {
    void chrome.runtime.sendMessage({ type: 'SW_LINK4M_OPEN_ADVERTISER', url }).catch(() => {});
  } catch {
    /* extension context invalidated */
  }
}

function applyCode(state: State, code: string): void {
  if (state.finished || state.code) return;
  state.code = code;
  const input = passwordInput();
  if (input && input.value !== code) {
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (!state.quiet) {
    state.overlay.setNote(NOTE_READY);
    state.overlay.setStatus('Đang chờ bạn xác nhận captcha…');
    state.panel.setStatus(`Đã lấy được mã: ${code}`);
    state.panel.setAction('', null);
  }
}

async function submit(state: State): Promise<boolean> {
  const token = captchaToken();
  if (!token) return false;

  const needsPassword = !!passwordInput();
  const password = (passwordInput()?.value || state.code || '').trim();
  if (needsPassword && password.length < 4) return false;

  const payload: Fields = { ...state.fields };
  if (password) payload['password'] = password;
  if (!payload['alias']) payload['alias'] = state.alias;

  const result = await postGetLinkInfo(readApiDomain(), payload, token);
  if (result.ok && result.url && isRealUrl(result.url)) {
    state.finished = true;
    if (!state.quiet) {
      state.overlay.setNote({ lead: 'Xong! Đang mở trang đích…' });
      state.overlay.setStatus(result.url);
      state.panel.setAction('', null);
    }
    location.replace(result.url);
    return true;
  }
  if (result.info && !state.quiet) state.overlay.setError(result.info);
  return false;
}

function waitForCaptchaWidget(timeoutMs: number): Promise<string | null> {
  const found = captchaContainerId();
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const id = captchaContainerId();
      if (id) return resolve(id);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

function waitForWrapper(timeoutMs: number): Promise<void> {
  if (document.getElementById('captcha-html-wrapper')) return Promise.resolve();
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const mo = new MutationObserver(() => {
      if (document.getElementById('captcha-html-wrapper') || Date.now() > deadline) {
        mo.disconnect();
        resolve();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => {
      mo.disconnect();
      resolve();
    }, timeoutMs);
  });
}

async function start(alias: string, codes: string): Promise<void> {
  const overlay = createFullPageOverlay({
    id: OVERLAY_ID,
    brand: 'Skip Wait',
    note: NOTE_IDLE,
    status: 'Đang chuẩn bị…',
  });
  const panel = buildPanel(overlay.turnstileMount);

  // The page itself calls `get-advertise` on load; only call it ourselves when
  // its form is missing (site change, blocked request, …).
  let fields = readHiddenFields();
  let advertiserUrl = advertiserUrlFromPage();
  let instructionsText = document.getElementById('advertise-html-wrapper')?.textContent ?? '';
  if (!fields['campaign_id']) {
    const adv = await fetchAdvertise(readApiDomain(), alias, codes);
    if (adv) {
      advertiserUrl = adv.advertiserUrl ?? advertiserUrl;
      instructionsText = adv.instructions;
      for (const name of FIELD_NAMES) {
        const value = adv.form.hidden[name];
        if (value) fields[name] = value;
      }
    }
  }
  if (!fields['alias']) fields['alias'] = alias;

  if (!fields['campaign_id']) {
    overlay.setError('Không đọc được nhiệm vụ. Hãy tải lại trang Link4M.');
    panel.setStatus('Lỗi: không đọc được dữ liệu nhiệm vụ.');
    return;
  }

  const advertiserKey = hostKey(advertiserUrl) ?? hostKey(extractAdvertiserHost(instructionsText));
  const searchKeyword = extractSearchKeyword(instructionsText);
  const state: State = {
    alias,
    fields,
    code: null,
    advertiserUrl,
    advertiserKey,
    overlay,
    panel,
    quiet: false,
    finished: false,
  };

  const cached = await loadCachedCode(
    [advertiserKey ?? '', extractAdvertiserHost(instructionsText) ?? '', alias].filter(
      (k): k is string => !!k,
    ),
  );

  // Nothing to open and nothing to search: don't hijack the page, just watch for
  // the captcha token and submit for the user.
  if (!cached && !advertiserUrl && !searchKeyword) {
    state.quiet = true;
    overlay.remove();
    watchUntilSubmitted(state);
    return;
  }

  const containerId = await waitForCaptchaWidget(12_000);
  if (containerId) {
    pinSiteWidgetOverOverlay({
      overlayId: OVERLAY_ID,
      mount: panel.anchor,
      widgetId: containerId,
      styleId: CAPTCHA_PIN_STYLE_ID,
      alsoVisibleSelectors: ['iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha.com"]'],
    });
  }

  if (cached) {
    applyCode(state, cached.code);
  } else if (advertiserUrl) {
    panel.setStatus('Chưa có mã — đang mở trang lấy mã…');
    openAdvertiserTab(advertiserUrl);
    panel.setAction('Mở lại trang lấy mã', () => openAdvertiserTab(advertiserUrl as string));
  } else if (searchKeyword) {
    panel.setStatus(`Nhiệm vụ: tìm "${searchKeyword}" trên Google, mở website rồi lấy mã.`);
    panel.setAction(`Tìm "${searchKeyword}" trên Google`, () =>
      openAdvertiserTab(`https://www.google.com/search?q=${encodeURIComponent(searchKeyword)}`),
    );
  }

  // Whichever route was taken, pick the code up as soon as the advertiser tab
  // stores it (a widget page opened by the user counts too).
  onCachedCodeChanged((key, code) => {
    const normalized = normalizeCodeKey(key);
    if (
      normalized === advertiserKey ||
      normalized === normalizeCodeKey(alias) ||
      normalized === normalizeCodeKey(extractAdvertiserHost(instructionsText) ?? '')
    ) {
      applyCode(state, code);
    }
  });

  watchUntilSubmitted(state);
}

/** `https://gamebai38.co.com` appears as plain text in some campaign templates. */
function extractAdvertiserHost(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>()]+/);
  return m?.[0] ?? null;
}

function watchUntilSubmitted(state: State): void {
  let lastSubmit = 0;
  window.setInterval(() => {
    if (state.finished) return;
    if (!captchaToken()) return;
    const now = Date.now();
    if (now - lastSubmit < 1500) return;
    lastSubmit = now;
    void submit(state);
  }, 400);
}

export function initLink4mGoPage(): void {
  if (!isLink4mHost(location.hostname)) return;
  if (!LINK4M_ALIAS_RE.test(location.pathname)) return;

  const boot = (): void => {
    void waitForWrapper(20_000).then(() => {
      const wrapper = document.getElementById('captcha-html-wrapper');
      const alias = wrapper?.dataset['alias'] ?? '';
      const codes = wrapper?.dataset['code'] ?? '';
      if (!alias || !codes) return;
      void start(alias, codes).catch(() => {});
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
