# Disc Logs

A free play tracker for a public Discogs record collection: https://disc-logs.com

## What it does
Type a Discogs username, and the page loads that user's **public** collection from the Discogs API. Tap a record when you play it. Plays, cartridge hours and settings are saved in the browser's localStorage on that device only. A backup file can be saved and restored by hand.

## Security model (for reviewers)
- **No credentials of any kind.** No sign-in, no passwords, no API keys or tokens. Private Discogs collections are deliberately not supported.
- **No server.** Static files only (`index.html`, `app.js`, icons, manifest). Nothing is collected or sent anywhere.
- **Network is locked down by Content-Security-Policy** (in `index.html`): scripts only from this site (`app.js`, no inline script), `fetch` only to `https://api.discogs.com`, images only from `https://i.discogs.com` and this site. All other origins are blocked by the browser.
- **No third-party code.** No libraries, frameworks, analytics, fonts or CDNs. No build step: what is in the repository is exactly what runs.
- **Untrusted text is escaped.** Everything that comes from Discogs (artist and title text, etc.) goes through `esc()` before being placed in the page; image URLs are only used if they start with `https://i.discogs.com/`; release IDs must be digits.
- Requests to Discogs are sent with `credentials: 'omit'`, so a visitor's own Discogs session is never used.

## Files
- `index.html`: markup, styles, Content-Security-Policy
- `app.js`: all behaviour (about 300 lines, plain JavaScript)
- `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`: lets people add it to their home screen
- `CNAME`: the custom domain for GitHub Pages

Disc Logs is not made by or affiliated with Discogs.
