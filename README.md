  # CineGrid — Telegram Mini App video catalogue

Static HTML/CSS/vanilla JS. Browse thumbnails → preview → "Watch Video" → Monetag Rewarded Interstitial → MEGA share link (same context via `window.location.assign`).

## Status — read first
| Part | State |
|---|---|
| UI, catalogue, search, saved, settings, URL validation, MEGA navigation | Working code |
| Ad adapter `runRewardedAd()` | Implemented against the documented Monetag SDK, **but NOT production-ready until you add your Monetag tag + zone ID** |
| Mock mode (`CONFIG.MOCK_MODE`) | Dev only; shows "TEST MODE — NO REAL AD"; never opens a video |
| Bot | Optional; minimal script below |

## File structure
```
index.html        page shell, Telegram SDK script, Monetag tag placeholder
styles.css        theme and layout
app.js            CONFIG, catalogue loading/validation, UI, ad adapter, navigation
videos.json       the only catalogue source (placeholder data, not real links)
assets/logo.svg, assets/placeholder.svg
README.md
```

## What Monetag documents (verified against docs.monetag.com)
- Rewarded Interstitial is supported for Telegram Mini Apps. Dashboard flow per docs: add your Mini App, click **Get SDK**, then **Get instructions**, copy the script into your app's `<head>`.
- Call `show_<MAIN_ZONE_ID>({ ymid })`. It returns a Promise that **also resolves if the user closes early**. Docs say grant the reward only when `result?.reward_event_type === 'valued'`. This app follows exactly that.
- Rejected promise = ad failed to load/show.
- Use the **main** zone ID (not a sub-zone) and only one SDK tag. Call `Telegram.WebApp.ready()` (done in `init`).
- Monetag also sends **server-side postbacks** (`valued` / `non_valued`) with your `ymid`. The docs note device-side signals can be forged. This frontend-only app cannot verify postbacks; a determined user can bypass the check or share the MEGA link. For real enforcement you need a backend (see https://docs.monetag.com/docs/postbacks/).
- I could not verify exact dashboard button labels beyond those in the docs; follow the docs if the UI differs.

## Setup in order
1. **Bot:** in Telegram open @BotFather → `/newbot` → save the token (never put it in this repo).
2. **GitHub (Android):** create a repo in the GitHub app/website, upload all files keeping the `assets/` folder.
3. **Cloudflare Pages:** Dashboard → Workers & Pages → Create → Pages → connect the repo. Framework: None. Build command: empty. Output directory: `/`. You get `https://yourproject.pages.dev`.
4. **Mini App URL:** BotFather → `/newapp` (or `/mybots` → Bot Settings → Menu Button) → paste the HTTPS URL.
5. **Monetag:** register at publishers.monetag.com, add the Mini App URL, get the SDK tag, paste it in `index.html` where marked, set `MONETAG_ZONE_ID` in `app.js`. Await Monetag moderation.
6. **Catalogue:** edit `videos.json` (below), commit, wait for redeploy.
7. **Test** with the checklist below, inside Telegram on a real device.

## Editing videos.json
Fields: `id` (unique), `title`, `thumbnail` (HTTPS), `megaUrl`, `category` required; `description`, `duration` (`mm:ss`), `tags` (`"trending"`, `"latest"` enable those chips), `published` must be `true` to show.
- **Add:** copy an entry, new unique `id`. **Edit:** change fields. **Hide:** `"published": false`. **Delete:** remove the object.
- Validate the JSON (jsonlint.com) before committing; watch commas and quotes.
- Changes need a redeploy (automatic on Git push) and may be cached; the app fetches with `no-cache`, but Cloudflare/Telegram may still show old data briefly.
- Thumbnails: upload to any HTTPS image host and paste the direct image URL. Do not store videos in the repo.
- MEGA: in MEGA, right-click file → Share/Get link → copy. Accepted: `https://mega.nz/file/ID#KEY`, `/folder/ID#KEY`, and legacy `#!ID!KEY` (hosts: `mega.nz`, `mega.io`; edit `ALLOWED_MEGA_HOSTS`). Placeholder IDs in the example file are fake.
- A MEGA link is **not private**: anyone who has it can open or redistribute it.

## Minimal bot (optional)
No backend is needed if you use BotFather's menu button/`/newapp` link. For `/start` with an inline button, run this on a server (Node 18+), token in an environment variable:
```js
// bot.mjs — BOT_TOKEN=... APP_URL=https://yourproject.pages.dev node bot.mjs
const T = process.env.BOT_TOKEN, API = `https://api.telegram.org/bot${T}/`;
const call = (m, b) => fetch(API + m, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
let offset = 0;
for (;;) {
  const { result = [] } = await call('getUpdates', { offset, timeout: 30 });
  for (const u of result) {
    offset = u.update_id + 1;
    const m = u.message; if (!m || !m.text) continue;
    if (m.text.startsWith('/start')) await call('sendMessage', { chat_id: m.chat.id, text: 'Welcome to CineGrid — browse videos.',
      reply_markup: { inline_keyboard: [[{ text: 'Open Video Viewer', web_app: { url: process.env.APP_URL } }]] } });
    else if (m.text.startsWith('/help')) await call('sendMessage', { chat_id: m.chat.id, text: 'Tap /start, then "Open Video Viewer".' });
  }
}
```

## Test checklist
Dev mock: set `MOCK_MODE: true` and open `index.html?mock=valued|not_valued|unavailable|reject`.
- [ ] Valid reward (real, in Telegram): ad finishes → "Opening MEGA…" → MEGA opens in same context; "Continue to MEGA" link appears if it doesn't.
- [ ] Non-valued reward: close ad early → message, no navigation, button says "Try again".
- [ ] Rejected promise → error message, link stays locked.
- [ ] Missing SDK / empty zone ID → "unavailable" message.
- [ ] Invalid MEGA link (e.g. `http://`, other host) → entry skipped at load; none opens.
- [ ] Broken image → placeholder shown. Invalid JSON → error state with Retry. Offline → offline message.
- [ ] Telegram SDK missing (normal browser) → app still works.
- [ ] Double-tap "Watch Video" → only one ad call.
- [ ] Same-context navigation on Android Telegram, iOS Telegram, mobile browser (behaviour varies; MEGA may hand off to its app or external browser).

## Troubleshooting
Broken thumbnails: URL must be a direct HTTPS image. Invalid JSON: check commas/quotes. Ads unavailable: zone ID, tag placement, moderation status, region fill, frequency limits. Blocked navigation: use the "Continue to MEGA" button.

## Production checklist
- [ ] Real Monetag tag + main zone ID, app approved
- [ ] `MOCK_MODE: false`
- [ ] Placeholder entries replaced; links tested
- [ ] Tested in Telegram Android/iOS
- [ ] Postback/backend verification decided if strict enforcement matters
- [ ] No tokens in repo; privacy text reviewed

Docs: [Telegram Mini Apps](https://core.telegram.org/bots/webapps) · [Bot API](https://core.telegram.org/bots/api) · [Monetag](https://docs.monetag.com/) · [Cloudflare Pages](https://developers.cloudflare.com/pages/) · [MEGA](https://mega.nz/)
