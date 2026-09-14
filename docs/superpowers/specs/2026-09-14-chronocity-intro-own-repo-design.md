# chronocity — intro card + render your own repo (no server)

Decided in chat 2026-09-14, then built and deployed in the same session (the user asked to "just finish it, execute and
deploy" rather than go through a written plan).

## Decisions (user)

- A transparent glass card on **every visit** (per browser session). Click outside or press Esc to hide; an ⓘ button
  reopens it to reread or switch projects. `?ui=0` (clean stills) never shows it.
- Content: what chronocity is, "you're watching knowl" (GitHub link only), project switch, "render your own", and
  "made by dat999zx" (GitHub) plus a source link.
- **No server.** Render your own = **clone with git, then drag-drop the folder**.

## Why a GitHub URL can't render directly (verified 2026-09-14)

- git smart-HTTP on github.com sends no CORS headers, so a browser can't clone without a proxy.
- Archive downloads (`github.com/o/r/archive/…` → `codeload.github.com`) send
  `Access-Control-Allow-Origin: https://render.githubusercontent.com` only, so our origin can't read them. They also
  contain **no history**: the chronocity tarball had 65 files and zero `.git` entries.
- `git clone --depth 1` is only the latest commit.

So a pasted URL becomes `git clone https://github.com/<owner>/<repo>.git` with a Copy button. If it names a gallery
repo, the card switches to that demo instead.

## How a dropped repo renders

1. Read `.git` into `Map<'.git/…', ArrayBuffer>` (`web/gitfolder.ts`). Three inputs:
   - drag-and-drop `FileSystemEntry` (all browsers; walks only `.git`);
   - Chromium `showDirectoryPicker` (walks only `.git`);
   - a fallback `<input webkitdirectory>` (Chrome includes hidden `.git` files).

   Checks, each with a worded error: no `.git`, `.git` as a pointer file (worktree/submodule), `.git/shallow`, and
   over 400 MB. The GitHub `owner/name` comes from `origin` in `.git/config` (`core/remote.ts`), so dropped GitHub
   clones get real diffs in the inspect card.
2. `web/walk-worker.ts` runs the **same core walker** as the bake script over `web/memfs.ts`, a read-only in-memory
   fs, with isomorphic-git. Its browser build needs a global `Buffer` (`web/buffer-shim.ts`, imported first).
   Progress is posted back to the card.
3. The Model goes into Cache Storage (`web/local.ts`), then the page reloads as `?repo=local`, and the repo dropdown
   gains "your repo (…)".
4. `web/vite.config.ts` pre-bundles isomorphic-git + buffer. Vite's dep scan doesn't follow
   `new Worker(new URL(...))`, and without it the first drop in dev reloads the page mid-replay.

Measured (spike + production build): knowl, 34 MB `.git`, replays in 8–9.5 s in-browser, identical to the Node bake.

## Verified end to end (production build, scripts/drive.mjs)

- The first visit shows the card; clicking outside hides it; ⓘ reopens it.
- A GitHub URL with `/tree/main` gives the clone command.
- `packages/core`, a non-repo, gives the "no .git" error.
- `.bake/chronocity` reloads to `?repo=local` with HUD `dat999zx/chronocity · … /37`, and the card stays closed.
