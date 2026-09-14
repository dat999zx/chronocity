# chronocity — clip export, gallery, launch polish

Approved in chat 2026-09-14. Extends `2026-09-13-chronocity-design.md` ("Export") and `2026-09-14-chronocity-interaction-design.md`.

## Decisions (user-chosen)

- **Overlay:** title + counters + watermark. From the bottom-left up: the commit headline, the repo name, `date · lines`. Bottom-right: `chronocity · dat999zx.github.io/chronocity`.
- **Shapes:** landscape 1920×1080 and vertical 1080×1920.
- **Length:** 15 s at 30 fps, so 450 frames.
- **Gallery:** knowl + chronocity.

## Clip export

- A 🎬 **Clip** button opens a menu with *Landscape 16:9* and *Vertical 9:16*. It's hidden unless `VideoEncoder` exists and Mediabunny's `canEncodeVideo('avc')` accepts both sizes. Verified 2026-09-14: headless Chrome supports avc at 1920×1080, 1080×1920 and 1080×1080.
- **Frame-stepped:** frame k renders `u = k / 449 · (D + TAIL)`, the whole 31.5 s playback timeline, which is the app at about 2.1×. Each frame is encoded before the next is rendered, awaiting the source's backpressure. No real-time capture, so no dropped frames on slow machines.
- **Clip mode in the city:** the renderer and composer switch to the clip size at pixel ratio 1, the camera to the auto pose, and spotlight and hover to 0. The main render loop pauses while the clip renders. `endClip()` restores the screen size, pixel ratio and interactive state.
- **Vertical framing:** `autoCamera` takes the aspect ratio and pulls back by `max(1, 1.6 / aspect) ^ 0.85` (a tuning knob). Phones in portrait get the same benefit in the app.
- **Compositing:** `drawImage(webglCanvas)` onto a 2D canvas, in the same task as `composer.render()` so no `preserveDrawingBuffer` is needed. Then `fillText` draws the overlay (repo text is drawn, never parsed). Font sizes scale with `min(w, h) / 1080`.
- **Clip headlines** use `headline()` with the tick scaled by the playback speed (0.6 s × 2.1), so a headline stays up about 0.6 s of *video* time and remains readable.
- **Encoding:** Mediabunny: `Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })`, `CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH })`, `addVideoTrack(src, { frameRate: 30 })`, then `add(k/30, 1/30)` per frame, then `finalize()`. `fastStart` puts the moov atom first, which suits X and Slack uploads.
- **UI:** an overlay reads `Rendering 1920×1080 · 42% · ~12 s left` with a progress bar. Cancel (or Esc) aborts through `output.cancel()`. The download is named `chronocity-<demo>-16x9.mp4` or `-9x16.mp4`. An encoding error stays on screen, and the Cancel button then reads Close.
- **Shared helper:** `cityTotals(model, tl, u) → { files, loc }` moves into core and is used by both the HUD and the overlay.

## Gallery

- `packages/web/public/demos/index.json` holds `[{ name, repo, steps, files }]`. `bake.ts` inserts or updates its own entry, keeping order, so knowl stays first. Bake names must match `/^[a-z0-9-]+$/`, because they end up in paths and URLs.
- The web app loads the index and picks `?repo=<name>` if it's listed, otherwise the first entry. A `<select>` in the bar switches demos by reloading with `?repo=` only.
- Demos are baked from fresh GitHub clones in `.bake/`. chronocity on 2026-09-14 had 28 steps and 51 files (7 KB). Re-bake it right before launch.

## Launch polish

- `README.md`: a hero image, a live link, what the effects mean, run/bake commands, how it works, prior art. There is no license section: the repo has no LICENSE yet and choosing one is the owner's call.
- Link previews: `description`, `og:title/description/image/url` and `twitter:card=summary_large_image`. `og.png` is a 1200×630 headless screenshot, also used as the README hero.

## Testing

- Core: `cityTotals` unit test.
- `scripts/drive.mjs` goes into the repo. It's the dependency-free Chrome DevTools-protocol driver (mouse, keys, eval, screenshots), plus download capture via `Browser.setDownloadBehavior`.
- The export test clicks Clip → Landscape (then Vertical), waits for the MP4, and probes it with Mediabunny in Node. Expected: an `avc1.*` codec, the exact size, a duration of about 15.0 s, and 450 packets. Opening the MP4 in Chrome's media viewer at 1 s, 7 s and 14 s gives screenshots of the overlay.
- The gallery test checks that `?repo=chronocity` loads and the select lists both demos.

## Out of scope

Audio, GIF, square format, choosing the clip length, clips of a selected district, a third gallery repo, and "your own repo" (Plan 2).
