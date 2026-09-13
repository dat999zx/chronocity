# chronocity — design

Approved in chat 2026-09-13. Build fast; this is a fun project.

## Goal

A web page that renders a git repo as a 3D city (folders = districts, files =
buildings, height = lines of code) and replays its history as a timelapse:
buildings rise when files are added, collapse when deleted, windows light up
when touched. Export a 15-second MP4. It's a spectacle, not an analysis tool:
if something doesn't make the timelapse better, cut it.

Honest pitch: Gource, but a city, running in the browser with zero install and
one-click clips.

## Inputs (all three at launch)

1. **Gallery.** Pre-baked real histories served as static JSON. The page
   auto-plays one on load, so an HN visitor is interacting immediately.
   Demos: `dat999zx/knowl` (public; 1,165 commits, which is 738 main-line
   steps since merged branches land as one step; 1,120 files; 37 MB pack),
   baked from a fresh GitHub clone, and chronocity itself.
2. **Drop a repo folder.** Chromium: `showDirectoryPicker()` or the drop
   event's `getAsFileSystemHandle()`. Firefox/Safari: `webkitGetAsEntry()`.
   Only `.git/` is read, into an in-memory fs.
3. **GitHub link.** First, a size check: `GET api.github.com/repos/{o}/{r}`
   (CORS-enabled, one request); refuse `size` > 150 MB with "drop the folder
   instead". Then a single-branch, no-tags isomorphic-git clone into the
   in-memory fs, through our CORS proxy.

No non-git mode: a folder without `.git` gets "needs a git repo".

## Repo layout (npm workspaces)

```
package.json               private, "workspaces": ["packages/*"]
packages/
  core/    pure ES modules: no DOM, no Node APIs, no runtime deps
    walker.js    isomorphic-git instance + fs → Model (git is injected)
    skip.js      lockfile / minified / vendored / binary rules
    layout.js    path list → lots (squarified treemap), pure
    timeline.js  Model → playback times + derived signals (fog, rain, sky)
    test.mjs     node test: fixture repo → walker/layout/timeline asserts
  web/     static site, no build step
    index.html   import map: three, three/addons, mediabunny, @chronocity/core/ → ./core/
    main.js      UI wiring: gallery, drop, GitHub input, scrubber, HUD
    city.js      Three.js scene; render(u) is a pure function of playback time
    colors.js    extension → GitHub language color (muted)
    sources.js   folder / GitHub → in-memory .git; PROXY_URL constant
    memfs.js     minimal in-memory fs (only what isomorphic-git calls)
    git-worker.js  module worker: runs core walker, posts progress + Model
    export.js    frame-stepped WebCodecs → Mediabunny MP4
    demos/       baked Model JSON
  bake/
    bake.mjs     node bake.mjs <repoPath> <name> → packages/web/demos/<name>.json
  proxy/
    worker.js    Cloudflare Worker CORS proxy, github.com git paths only
    wrangler.toml
scripts/dev.mjs            serves web at / and core at /core/ (same shape as the deploy)
.github/workflows/pages.yml  assemble _site = web + core/ → GitHub Pages
```

`core` is the only code shared between browser and Node, which is why it
takes `git` as a parameter instead of importing it: Node passes the npm
`isomorphic-git`, the browser worker passes the CDN build.

## Model (the contract between walker, bake, and renderer)

```json
{
  "v": 1,
  "repo": "dat999zx/knowl",
  "commits": [[t, tz, churn], ...],
  "files":   [["path/to/file.ts", [[commitIdx, loc], ...]], ...]
}
```

- `t`: author time, unix seconds. `tz`: minutes EAST of UTC (+0700 → 420).
  isomorphic-git's `timezoneOffset` has the opposite sign (like
  `Date#getTimezoneOffset`), so the walker negates it.
- `churn`: sum of |ΔLOC| across files in that step.
- File samples: one per step that touched the file; `loc` 0 = deleted.
  A touch that leaves the LOC unchanged still gets a sample (it lights windows).

## Walker

1. Follow the first-parent chain from HEAD (`readCommit`, `parent[0]`), then
   reverse it. Merges land as one step, so the state at every step is exact.
2. More than `MAX_STEPS` (2000) steps: keep evenly spaced ones, always
   including the first and last.
3. Diff each kept tree against the previous kept tree, descending only into
   subtrees whose oid changed.
4. Skip files matching `skip.js`: lockfiles (package-lock, yarn.lock,
   pnpm-lock, bun.lockb, Cargo.lock, Gemfile.lock, poetry.lock,
   composer.lock, go.sum, uv.lock), `*.min.js|css`, `*.map`, paths under
   `node_modules/ dist/ vendor/`. Also skip submodules and symlinks.
5. LOC = newline count, plus 1 if the last byte isn't `\n`. A NUL byte in the
   first 8000 bytes marks the file binary, and it's excluded for good. LOC is
   memoized per blob oid.
6. Report progress every 25 steps.

## Layout

- Input: every non-skipped path that ever existed. Computed once per repo,
  so nothing moves during playback.
- Squarified treemap. Folder weight = number of files under it; each file is
  a leaf of weight 1. Children are sorted by weight descending, then by name.
  Each folder level insets its rect for streets, which get thinner with depth.
- A building's footprint is its lot inset by 15%. Height =
  `HEIGHT_K * sqrt(loc)`, clamped at `MAX_H` (both are tuning knobs).
- Output: per-file `[x, z, w, d]` plus district rects for ground plates.

## Timeline and render(u)

`u` = playback seconds, 0 to `D` (30 s in the app, 15 s for export).

- Each commit's `u_i` comes from gaps capped at `GAP_CAP` = 3 days, then
  scaled so the whole history fills `D`.
- **Fog**: strength around `u_i` grows with how much of that gap was cut.
  The fog marks skipped time.
- **Rain**: churn in the trailing 1 s, divided by the repo's 90th-percentile churn.
- **Sky**: circular mean of author-local commit hours over the trailing
  2 s, computed from prefix sums of (cos, sin), so render(u) stays pure.
  A short mean vector means commits are scattered around the clock, which
  gives twilight.
- **Buildings**: height eases from the previous LOC to the new one over
  0.6 s after the step. Deleted files shrink to zero, then hide.
- **Windows**: glow = 1 − (u − last touch) / 1.5 s, clamped. Drawn as a
  procedural window pattern in the shader.
- **Camera**: slow auto-orbit, with radius from the bounding box of the
  standing buildings (precomputed per step, interpolated). Dragging switches
  to OrbitControls; export always uses the auto camera.
- Rendering: one InstancedMesh for buildings (per-instance color plus a glow
  attribute via `onBeforeCompile`), one for district plates, HemisphereLight +
  sun DirectionalLight, FogExp2, and a Points layer for rain.
- Click a building (raycast → instanceId) for a tooltip: path, LOC now,
  first seen, last touched.
- HUD: repo, date, commit n/N, files, total LOC. Controls: scrubber, play,
  0.5×/1×/2× speed, export.

## Export

- 15 s at 60 fps, 1920×1080 or 1080×1920. Export builds its own timeline
  with D = 15, then frame k renders u = k/60, so ease and glow durations
  match the app.
- The WebGL frame and a text overlay (watermark, repo name, date) are
  composited onto a 2D canvas, which feeds Mediabunny's `CanvasSource`
  (H.264/avc) into an MP4 `BufferTarget`, then downloads.
- Hidden when `VideoEncoder` is missing. Shows progress and a cancel button.

## Proxy (trust boundary: do not loosen)

Cloudflare Worker. isomorphic-git's `corsProxy` sends requests to
`<proxy>/github.com/<owner>/<repo>.git/...`. The Worker allows only
`GET /github.com/{o}/{r}(.git)?/info/refs?service=git-upload-pack` and
`POST /github.com/{o}/{r}(.git)?/git-upload-pack`. It forwards only
`content-type`, `accept`, and `git-protocol`, strips cookies and auth,
answers OPTIONS preflight, and adds CORS headers. Everything else gets 403.

Until the Worker is deployed, `PROXY_URL` defaults to
`https://cors.isomorphic-git.org`. That's fine for dev, not for launch.

## Hosting

Static site on GitHub Pages; the proxy on a free Cloudflare Worker.
Optionally point `chronocity.knowl.cloud` at Pages later. Don't host it on
the knowl.cloud Docker server: HN traffic shouldn't land on the product's box.

## Errors and limits

- GitHub repo > 150 MB, private (404), or rate-limited: a clear message
  suggesting the folder drop.
- Folder without `.git`, or a shallow clone (`.git/shallow` exists): message.
- Walker failures surface in the progress panel; the gallery city stays up.
- Phones: gallery only, drop and export hidden.

## Testing

`node packages/core/test.mjs`:

- Builds a fixture repo with isomorphic-git in a temp dir, with fixed
  timestamps and timezoneOffset −420:
  - c1 adds `a.ts` (3 lines), `package-lock.json`, `img.png` (binary);
  - c2 edits `a.ts` to 5 lines and adds `src/b.rs`;
  - c3 deletes `a.ts`.
- Walker asserts: `a.ts` = `[[0,3],[1,5],[2,0]]`; the lockfile and png are
  absent; `tz` = 420; churn per step.
- Layout asserts: same input gives identical output, no two lots overlap,
  every lot is inside the root.
- Timeline asserts: `u` is monotonic; a 60-day gap gets capped and flagged
  as fog; the circular mean of 23:00 and 01:00 is about 00:00.

Visuals are checked by eye in the browser.

## Build order (site goes live after step 3)

1. core walker + skip + test; bake the knowl repo; measure walk time.
2. Layout + grey boxes at the final step (the old M1).
3. Timeline, scrubber, play; deploy to Pages.
4. Folder drop + GitHub link (memfs, worker, proxy).
5. Beauty: colors, lights, sky, fog, rain, windows, camera, optional bloom.
6. MP4 export.
7. Gallery: both demos, polish, launch.

## Out of scope

Non-git folders, rename tracking, branch views, author avatars, sound, GIF
export, private GitHub repos / auth, caching walked repos, drag-drop on mobile.
