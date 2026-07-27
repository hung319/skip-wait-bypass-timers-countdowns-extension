import { isAllowedHost } from '../../utils/domain-check';
import { LZMODS_HOSTS } from './hosts';

const WFL_BUTTON_SEL = 'a.wfl_button';

function findDownloadUrl(): string | null {
  const btn = document.querySelector<HTMLAnchorElement>(WFL_BUTTON_SEL);
  const href = btn?.getAttribute('href')?.trim();
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) return href;
  return null;
}

export function initLzmodsBypass(): void {
  if (!isAllowedHost(LZMODS_HOSTS)) return;

  // `/exit.php` on lewdzone.com or `/verify/` on lzmods.com
  const path = location.pathname;
  if (!path.includes('/exit.php') && !path.includes('/verify/')) return;

  const url = findDownloadUrl();
  if (url) {
    location.replace(url);
    return;
  }

  // Poll briefly in case the button is added dynamically
  let tries = 0;
  const id = window.setInterval(() => {
    tries++;
    const u = findDownloadUrl();
    if (u) {
      window.clearInterval(id);
      location.replace(u);
    } else if (tries >= 40) {
      window.clearInterval(id);
    }
  }, 150);
}
