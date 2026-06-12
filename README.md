# Wave Player V1 — Liquid Glass

A tiny, always-on-top Spotify miniplayer that looks and feels like Apple Music — built as a [Spicetify](https://spicetify.app) extension.

**[▶ Live UI demo](./index.html)** — open `index.html` in any browser to see all three modes (the demo uses a generated mock cover and fake lyrics; the real player is powered by your music).

---

## What is it?

Wave Player puts a small floating window on top of everything else while Spotify keeps running in the background. The whole interface is built around a **Liquid Glass** look: frosted, blurred cards that pick up the colors of whatever album is playing.

No screenshots needed — just open the demo page.

## The three modes

| Mode | Size | What it does |
|------|------|--------------|
| **Compact** | 460 × 80 | A slim bar: cover, song info, and a glass transport capsule. Perfect for the corner of your screen. |
| **Expanded** | 390 × 546 | The full player: big album art, scrubber, controls, volume, and shuffle/repeat — all inside one floating glass card. |
| **Lyrics** | 390 × 640 | Synced lyrics that scroll automatically. The current line is sharp and bright, the rest gently blur and fade out at the edges. |

Switch between them with the buttons in the player (or press **L** for lyrics).

## Features in plain words

- **Colors that match your music** — the player reads the album cover and extracts its real colors (using k-means clustering), so the background always matches the song.
- **Liquid Glass UI** — frosted cards with deep blur, soft shadows, and a subtle light-catch sheen instead of hard lines.
- **Synced lyrics** — word-for-word timing where available, with a smooth blur/fade effect.
- **Always on top** — uses the browser's Document Picture-in-Picture window, so it floats above every other app.
- **Marquee titles** — long song names scroll instead of getting cut off.
- **Knobless scrubber** — a clean progress bar you can click and drag anywhere.
- **Hearts, shuffle, repeat** — like/unlike, shuffle and repeat all work right from the miniplayer.

## Install (Windows)

1. Install [Spicetify](https://spicetify.app/docs/getting-started) if you haven't already.
2. Copy `waveplayer.js` into your Spicetify extensions folder:

   ```
   %APPDATA%\spicetify\Extensions
   ```

3. Enable it and apply:

   ```
   spicetify config extensions waveplayer.js
   spicetify apply
   ```

4. Restart Spotify, then click the **WavePlayer** button in the top bar to open the miniplayer.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / pause |
| `←` / `→` | Seek −5s / +5s |
| `↑` / `↓` | Volume +5% / −5% |
| `L` | Toggle lyrics mode |
| `Esc` | Back / close settings |

## Files in this repo

| File | What it is |
|------|------------|
| `waveplayer.js` | The actual Spicetify extension — this is what you install. |
| `index.html` | GitHub-ready live demo of the UI (mock data, no Spotify needed). |
| `waveplayer-preview.html` | Earlier static preview used during development. |

## Notes

- Wave Player needs a Chromium-based Spotify client (Document Picture-in-Picture support).
- Lyrics availability depends on the track.
- This is V1 — feedback and ideas welcome.
