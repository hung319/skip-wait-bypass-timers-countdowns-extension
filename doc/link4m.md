# Link4M — flow, anti-bot layers, and what can actually be bypassed

Researched 2026-09-28 against `https://link4m.net/go/Yl9Bq45e` (live traffic).
Link4M runs an AdLinkFly fork front-end plus a custom API on `s1.link4m.app`
and an advertiser network on `website-analytics.net` / `best-traffic.pages.dev`.

## Two entry points

| URL shape | What it is | Bypassable? |
| --- | --- | --- |
| `link4m.<tld>/full/?url=<base64>` | **Link builder.** Creates a short link whose destination is the base64 `url` param. Responds `302 → /go/<new-alias>`. | ✅ The destination is in the URL. Decode it and redirect — no ad page, no captcha. |
| `link4m.<tld>/<alias>` → `302 /go/<alias>` | The "captcha page". | ⚠️ Partially (see below). |

Hosts seen live: `link4m.co`, `link4m.com`, `link4m.net`. The site rotates TLDs, so
match `^(?:www\.)?link4m\.[a-z]{2,6}$`.

## The `captcha-page` flow

```
GET  /go/<alias>
       ↓ HTML contains #captcha-html-wrapper[data-alias][data-code]  (code = 256 hex, session-bound)
       ↓ loads /assets/v20/Default/Links/view.js  → var api_domain = 'https://s1.link4m.app'
       ↓ that same file (served dynamically!) carries a rotating recaptcha_key
POST https://s1.link4m.app/api/campaign/get-advertise   { alias, codes }
       ↓ { success, html: <advertiser instructions>, form: <#main-form>, run: <js> }
       ↓ form fields: password, alias, campaign_id, display_id, prefix
       ↓ `run` js overrides recaptcha_key again (new key per request)
POST https://s1.link4m.app/links/get-link-info
       { password, alias, campaign_id, display_id, prefix, g-recaptcha-response }
       ↓ { success, url }   ← the only place the destination is ever returned
```

`POST /links/check-captcha` exists too (used after the captcha callback) but needs
the same token. Both endpoints are CORS-open for `https://link4m.net` and
`https://link4m.com` (not `link4m.co`), with `access-control-allow-credentials: true`.

Notes:
* The session lives 600 s (`Thời gian phiên còn: 597`).
* The hidden-field set is **per visit**: `display_id` and `prefix` change, so every
  submission must reuse the values from that page.
* Calling the API without the page's cookies/session gets `{"success":false,"info":"Lỗi khi xử lý"}`.

## Anti-bot layers (measured, not guessed)

1. **Rotating reCAPTCHA v2 sitekey.** Three different keys were observed within
   minutes (`6LcQsTQg…`, `6LegqIgs…`, `6LdBq4gs…`). The page renders a normal
   *checkbox* widget: `grecaptcha.execute()` throws
   `Error: grecaptcha.execute only works with invisible reCAPTCHA`, so a token
   **cannot** be minted from JS. The server rejects any request without a valid
   token (`Bạn vui lòng check captcha`) and rejects fakes
   (`Mã captcha đã sai hoặc quá hạn`), so it is verified server-side.
   → *The last click (the checkbox) is unavoidable.*
2. **Advertiser coupon code ("Mã KM").** The `password` is a real 6-char coupon the
   advertiser hands out, not something derivable from the link page. Two campaign
   templates were observed:
   * *Direct*: open the advertiser site, scroll to the bottom, press **LẤY MÃ**,
     wait **60 s**, click any internal link, come back, wait **15 s** → `Mã KM: zTdPrn`.
   * *Keyword*: search a keyword on Google (`tr88 casino`), open the result, get the
     code there.
3. **Server-enforced 60 s dwell.** Fast-forwarding the widget's own timer patch
   (`setInterval` → 5 ms, all 600 ticks in ~3 s) makes the server answer
   `Chưa cập nhật được mã` instead of the step-1 payload — so the wait is validated
   server-side and cannot be compressed. Only real elapsed time works.
4. **Rotating advertiser host + campaign.** `campaign_id` / instructions changed
   between visits; the advertiser page and its coupon rotate.

## What the extension does with this

`src/sites/link4m/`

* **`/full/?url=`** — decoded and redirected (`/full/` on any TLD).
* **`/go/<alias>`** — full-page overlay that
  * reads the page's own `get-advertise` result (`campaign_id`, `display_id`, `prefix`)
    and only calls the API itself if the page failed to;
  * reuses a **cached coupon** for that advertiser host (`chrome.storage.local`,
    12 h TTL) and auto-fills `input[name=password]`;
  * otherwise opens the advertiser page in a real tab and lets
    `advertiser-widget.ts` mine the code there;
  * pins the real reCAPTCHA above the overlay and **submits automatically** the
    instant a token appears — the user's only job is ticking the checkbox;
  * falls back to a silent watcher (no overlay) when the campaign can't be automated.
* **Advertiser side** (`website-analytics.net` widget) —
  * dispatches the event the widget actually listens for (`touchstart` on touch
    devices — a plain `click` does nothing, which is why casual automation fails);
  * keeps the countdown alive by feeding the synthetic scroll events it requires;
  * survives step 1 → step 2 by reloading the page once (the quest lives in
    `localStorage`), then reads `Mã KM: XXXXXX` out of `.whatoncode`;
  * stores the code for the Link4M tab and closes the tab it opened.

### Honest limits

* The reCAPTCHA checkbox must be ticked by a human (or a paid solver). Everything
  else is automated.
* The 60 s advertiser dwell is real wall-clock time; there is no way around it short
  of the advertiser changing their rules.
* Keyword-based campaigns where the keyword lives inside an image can only be
  handled semi-manually.
