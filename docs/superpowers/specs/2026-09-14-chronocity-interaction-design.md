# chronocity — interaction design (inspect panel, diffs, feel)

Approved in chat 2026-09-14. Extends `2026-09-13-chronocity-design.md`.

## Goal

Click any building or district and a glass card pinned to it tells its story:
- its size;
- its history as a sparkline;
- its last changes, with commit messages and `+added −removed`;
- for public GitHub repos, the real diff of any change.

The city also *feels* interactive: hover highlight, fly-to with spotlight, a commit ticker, an activity scrubber, and keyboard control.

## Decisions (user-chosen)

- Panel: an **anchored glass card**, an HTML overlay pinned to the selection by an SVG leader line, re-projected every frame, slightly tilted in 3D. We rejected a side drawer (detached from the city) and an in-scene WebGL billboard (blurry text, no room for a diff).
- Diff depth: **counts + messages baked in, plus the real diff fetched from GitHub on demand.**
- Feel: **fly-to + spotlight, hover highlight, commit ticker, activity scrubber + keys** (all four).

## Model v2

```
commits: [t, tz, churn, sha, subject, author]   // subject = first line of the message, ≤ 100 chars
files:   [path, [[step, loc, add, del], ...]]    // add/del = lines added / removed at that step
v: 2
```

- `add`/`del` are **line multisets**: each version's lines are hashed with 32-bit FNV-1a and counted, and the counts are compared. So `add − del == Δloc` always holds, and a moved line is not a change. GitHub's Myers diff can show slightly more on moves; that's accepted.
- Verified on knowl (2026-09-14): 738 steps in 16.5 s, zero `add − del ≠ Δloc` over 4,013 samples, JSON 100 KB → 203 KB.
- The walker keeps each live file's line-count map, which is about 18 MB for knowl. Plan 2's browser path must respect the repo-size cap for this reason.
- Layout districts gain their folder path: `[x, z, w, d, depth, path]`, where the root is `''`.

## Selection

- `Selection = { kind: 'file', index } | { kind: 'district', index }`.
- A click raycasts buildings and plates together; the nearest hit wins. The root plate (depth 0) means the whole repo. A click on nothing (sky or open ground) deselects, and Esc deselects too.
- Selecting a file or non-root district:
  - sets per-instance `aSel` (1 inside, 0 outside);
  - eases `uSpot` 0→1 so the rest dims to 22%;
  - flies the camera to a focus pose over 0.9 s (easeInOutCubic). The pose keeps the current viewing direction, with distance fitted to the selection.
- In focus mode OrbitControls orbits around the selection. Deselecting flies back to the live auto-camera pose. Selecting the root only shows the panel: no fly, no spotlight.
- Hover: a `uHover` instance index compared with `gl_InstanceID` in the shader brightens the building under the cursor, with no per-frame attribute writes. A small label shows the name, and the cursor becomes a pointer.
- Deep link: `?select=<file path | folder path | />`, kept in sync with `history.replaceState`.

## Panel content

- **File:**
  - folder breadcrumbs, each clickable to that district;
  - the name, a language chip, and live LOC;
  - a sparkline of its whole history (48 points) with the future part shaded;
  - "N changes · since · last";
  - the last 5 changes as rows: `MM-DD · subject · +add −del`. Click a row for its diff.
- **District:**
  - breadcrumbs and name (the repo name at root);
  - `files · lines`;
  - a language bar, with a legend of the top 3 languages by %;
  - a sparkline and a changes line;
  - its 3 tallest buildings, clickable.
- The body re-renders at most every 120 ms and only when the step changes. Its position updates every frame. It sits above-right of the anchor and flips left at the screen edge.
- **Every piece of repo-sourced text goes in through `textContent`.** Links are built only from validated `owner/name` and 40-hex SHAs.

## GitHub diff

- `GET api.github.com/repos/{repo}/compare/{prevSha}...{sha}` for step > 0, or `/commits/{sha}` for step 0. Verified: CORS `*`, `X-RateLimit-*` exposed, `files[].patch`. The compare reproduces the step exactly, even for merges and sampled history.
- The file matches on `filename` or `previous_filename` (renames). Up to 60 patch lines are shown, colored by the first character, plus a "view on GitHub ↗" link.
- Responses are cached per API URL for the session.
- Errors become plain sentences:
  - rate limit, with minutes until reset from `x-ratelimit-reset`;
  - other HTTP statuses;
  - offline;
  - file not in the compare (GitHub caps it at 300 files);
  - no patch (binary or too large).
- Only for `repo` matching `owner/name`. Plan 2's dropped folders get no diff button until they have a local diff.

## Ticker, scrubber, keys

- Code churn per step (Σ|Δloc| over non-data files) moves into `timeline.ts` as `codeChurn()`, shared by rain, the scrubber and the ticker.
- **Ticker** (pure in u): while playing, `headline()` shows the biggest-churn commit of the *previous* 0.6 s playback window, so it's readable and lags behind the action rather than spoiling it. Paused or scrubbing, it shows the exact commit at u. The line reads `date · author · subject`, with a short fade-in.
- **Scrubber:** `activity()` bins code churn into 160 bins over [0, D + TAIL]. The bars are drawn on a canvas under a transparent range input, sqrt-scaled, brighter where already played.
- **Keys:** Space plays or pauses; ←/→ step to the previous or next commit (paused); Esc deselects.

## Files

- Core:
  - `model.ts` v2;
  - `walker.ts` (`lineCounts`, `addDel`, commit meta);
  - `layout.ts` (district paths);
  - new `stats.ts` (`fileStats`, `districtStats`, `series`);
  - `timeline.ts` (`codeChurn`, `activity`, `headline`).
- Web:
  - new `panel.ts`, `github.ts`, `ticker.ts`, `activity.ts`;
  - rewritten `city.ts` (selection, hover, focus camera, `pick`, `anchor`);
  - `buildingMaterial.ts` (aSel, uSpot, uHover);
  - `main.ts` and `index.html`.
- The knowl demo is re-baked as v2.

## Testing

- Core unit tests cover:
  - add/del (`2`→`two` plus 2 new lines gives +3 −1), subject/author/sha, and sampled steps;
  - district paths;
  - fileStats, districtStats and series;
  - activity bins and headline windows.
- Headless screenshots cover `?select=` for a file, a folder and the root, plus the ticker and scrubber.
- Manual checklist (real browser): hover label, click, fly-to and back, Esc, Space, ←/→, drag while focused, loading a diff, and the rate-limit message.

## Out of scope

Local diffs for dropped folders (Plan 2), author avatars, search, multi-select, commit-by-commit diff browsing beyond the last 5 rows.
