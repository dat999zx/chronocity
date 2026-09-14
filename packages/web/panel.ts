import type { Demo } from '@chronocity/core/model.ts'
import type { CityLayout } from '@chronocity/core/layout.ts'
import { stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import { fileStats, districtStats, series } from '@chronocity/core/stats.ts'
import { langOf } from '@chronocity/core/lang.ts'
import type { Selection } from './selection.ts'
import { commitUrl, stepPatch } from './github.ts'

const DIFF_LINES = 60 // patch lines shown before "… N more lines"
const SVG_NS = 'http://www.w3.org/2000/svg'
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// Every repo-sourced string goes in through textContent: paths, subjects, authors and patches are untrusted.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export interface PanelContext {
  model: Demo
  lay: CityLayout
  tl: Timeline
  local(step: number): string         // a step's author-local ISO timestamp
  select(sel: Selection | null): void // breadcrumbs, "tallest" rows and ✕ re-select
}

export interface Panel {
  show(sel: Selection | null, u: number): void
  update(u: number, anchor: { x: number; y: number } | null): void
}

// The glass card pinned to the selection by a leader line.
export function createPanel(card: HTMLElement, leader: SVGSVGElement, ctx: PanelContext): Panel {
  const { model, lay, tl } = ctx
  const line = leader.querySelector('line')!
  const body = el('div'), diffBox = el('div', 'diffbox')
  const byPath = new Map(lay.districts.map((d, i) => [d[5], i]))
  const date = (step: number) => ctx.local(step).slice(0, 10)
  let sel: Selection | null = null
  let spark: Float64Array = new Float64Array(0)
  let renderedStep = -2, renderedAt = 0, diffToken = 0

  function crumbs(folder: string): HTMLElement {
    const nav = el('div', 'crumbs')
    const parts = folder ? folder.split('/') : []
    const link = (path: string, label: string) => {
      const b = el('button', '', label)
      b.onclick = () => ctx.select({ kind: 'district', index: byPath.get(path) ?? 0 })
      nav.append(b)
    }
    link('', model.repo)
    parts.forEach((p, i) => {
      nav.append(' / ')
      link(parts.slice(0, i + 1).join('/'), p)
    })
    return nav
  }

  function sparkline(u: number): SVGElement {
    const s = svg('svg', { class: 'spark', viewBox: '0 0 240 40', preserveAspectRatio: 'none' })
    const max = Math.max(1, ...spark)
    const points = Array.from(spark, (v, j) => `${((j / (spark.length - 1)) * 240).toFixed(1)},${(38 - (v / max) * 34).toFixed(1)}`).join(' ')
    const x = Math.min(1, Math.max(0, u / tl.D)) * 240
    s.append(
      svg('polyline', { points, fill: 'none', stroke: '#8fb3ff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }),
      svg('rect', { x, y: 0, width: 240 - x, height: 40, fill: 'rgba(16,20,28,.6)' }), // the future, shaded
    )
    return s
  }

  function renderFile(index: number, u: number): Node[] {
    const [path] = model.files[index]
    const lang = langOf(path), st = fileStats(model, tl, index, u)
    const chip = el('span', 'chip'), swatch = el('i')
    swatch.style.background = hex(lang.color)
    chip.append(swatch, lang.name)
    const nodes: Node[] = [crumbs(path.split('/').slice(0, -1).join('/')), el('div', 'title', path.slice(path.lastIndexOf('/') + 1)), chip]
    if (!st) return [...nodes, el('div', 'big', 'not built yet')]
    nodes.push(
      el('div', 'big', st.loc ? `${st.loc.toLocaleString()} lines` : 'demolished'),
      sparkline(u),
      el('div', 'meta', `${st.changes} change${st.changes === 1 ? '' : 's'} · since ${date(st.first)} · last ${date(st.last)}`),
    )
    const rows = el('div', 'rows')
    for (const c of st.recent) {
      const row = el('button', 'row'), nums = el('span')
      nums.append(el('span', 'add', `+${c.add}`), ' ', el('span', 'del', `−${c.del}`))
      row.append(el('span', 'muted', date(c.step).slice(5)), el('span', 'msg', model.commits[c.step][4]), nums)
      row.title = 'Show this change'
      row.onclick = () => showDiff(c.step, path)
      rows.append(row)
    }
    nodes.push(rows)
    if (commitUrl(model.repo, model.commits[0][3])) nodes.push(el('div', 'muted hint', 'click a change to see its diff'))
    return nodes
  }

  function renderDistrict(index: number, u: number): Node[] {
    const folder = lay.districts[index][5], st = districtStats(model, tl, folder, u)
    const nodes: Node[] = folder
      ? [crumbs(folder.split('/').slice(0, -1).join('/')), el('div', 'title', folder.slice(folder.lastIndexOf('/') + 1) + '/')]
      : [el('div', 'title', model.repo)]
    nodes.push(el('div', 'big', `${st.files.toLocaleString()} files · ${st.loc.toLocaleString()} lines`))
    if (st.loc) {
      const bar = el('div', 'langbar')
      for (const l of st.langs.slice(0, 6)) {
        const seg = el('i')
        seg.style.flex = String(l.loc)
        seg.style.background = hex(l.color)
        seg.title = l.name
        bar.append(seg)
      }
      nodes.push(bar, el('div', 'meta', st.langs.slice(0, 3).map(l => `${l.name} ${Math.round((l.loc / st.loc) * 100)}%`).join(' · ')))
    }
    nodes.push(sparkline(u))
    if (st.first >= 0) nodes.push(el('div', 'meta', `${st.changes.toLocaleString()} changes · since ${date(st.first)} · last ${date(st.last)}`))
    const rows = el('div', 'rows')
    st.top.forEach((i, rank) => {
      const [path] = model.files[i], row = el('button', 'row')
      row.append(
        el('span', 'muted', `#${rank + 1}`),
        el('span', 'msg', folder ? path.slice(folder.length + 1) : path),
        el('span', 'muted', (fileStats(model, tl, i, u)?.loc ?? 0).toLocaleString()),
      )
      row.title = 'Select this building'
      row.onclick = () => ctx.select({ kind: 'file', index: i })
      rows.append(row)
    })
    nodes.push(rows)
    return nodes
  }

  async function showDiff(step: number, path: string) {
    const token = ++diffToken
    diffBox.hidden = false
    diffBox.replaceChildren(el('div', 'muted', 'loading the diff from GitHub…'))
    const r = await stepPatch(model.repo, model.commits, step, path)
    if (token !== diffToken) return // the selection or the requested change moved on meanwhile
    const [, , , sha, subject, author] = model.commits[step]
    const nodes: Node[] = [el('div', 'meta', `${date(step)} · ${author} · ${subject}`)]
    if ('error' in r) nodes.push(el('div', 'muted', r.error))
    else {
      const pre = el('pre'), lines = r.patch.split('\n')
      for (const l of lines.slice(0, DIFF_LINES))
        pre.append(el('span', l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '', l + '\n'))
      if (lines.length > DIFF_LINES) pre.append(el('span', 'muted', `… ${lines.length - DIFF_LINES} more lines`))
      nodes.push(pre)
    }
    const url = commitUrl(model.repo, sha)
    if (url) {
      const a = el('a', 'gh', 'view on GitHub ↗')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      nodes.push(a)
    }
    diffBox.replaceChildren(...nodes)
  }

  function render(u: number) {
    if (sel) body.replaceChildren(...(sel.kind === 'file' ? renderFile(sel.index, u) : renderDistrict(sel.index, u)))
  }

  return {
    show(next, u) {
      sel = next
      diffToken++
      diffBox.hidden = true
      diffBox.replaceChildren()
      if (!next) {
        card.hidden = true
        leader.style.display = 'none'
        return
      }
      const folder = next.kind === 'district' ? lay.districts[next.index][5] : ''
      const prefix = folder ? folder + '/' : ''
      const indices = next.kind === 'file' ? [next.index] : model.files.flatMap(([p], i) => (p.startsWith(prefix) ? [i] : []))
      spark = series(model, tl, indices)
      const close = el('button', 'close', '✕')
      close.setAttribute('aria-label', 'Close')
      close.onclick = () => ctx.select(null)
      card.replaceChildren(close, body, diffBox)
      card.hidden = false
      card.classList.remove('pop')
      void card.offsetWidth // restart the pop-in animation
      card.classList.add('pop')
      render(u)
      renderedStep = stepAt(tl, u)
      renderedAt = performance.now()
    },
    update(u, anchor) {
      if (!sel) return
      const k = stepAt(tl, u), now = performance.now()
      if (k !== renderedStep && now - renderedAt > 120) {
        render(u)
        renderedStep = k
        renderedAt = now
      }
      if (!anchor) {
        leader.style.display = 'none'
        return
      }
      // Above-right of the anchor, flipped left near the right edge, kept on screen and above the controls.
      const w = card.offsetWidth, h = card.offsetHeight, m = 12
      const flip = anchor.x + 40 + w > innerWidth - m
      const left = Math.max(m, Math.min(innerWidth - w - m, flip ? anchor.x - 40 - w : anchor.x + 40))
      const top = Math.max(m, Math.min(innerHeight - h - 90, anchor.y - h - 30))
      card.style.left = `${left}px`
      card.style.top = `${top}px`
      card.classList.toggle('flip', flip)
      leader.style.display = ''
      line.setAttribute('x1', String(anchor.x))
      line.setAttribute('y1', String(anchor.y))
      line.setAttribute('x2', String(flip ? left + w : left))
      line.setAttribute('y2', String(top + h))
    },
  }
}
