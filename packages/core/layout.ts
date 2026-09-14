export const STREET = 1.2 // street width around top-level districts; halves at each level (tuning knob)
export const LOT = 1      // side of one file's lot, before streets (tuning knob)

export type Rect = [x: number, z: number, w: number, d: number]
export type District = [x: number, z: number, w: number, d: number, depth: number, path: string] // path '' = root
export interface CityLayout {
  size: number               // the city spans [0, size] on x and z
  lots: Map<string, Rect>    // whole plot per file; the renderer insets the building
  districts: District[]      // one plate per folder, root first
}

interface Folder { name: string; dirs: Map<string, Folder>; files: string[]; weight: number }
interface Item { name: string; weight: number; dir?: Folder; path?: string }
interface Box { x: number; z: number; w: number; d: number }

// Squarified treemap over every path that ever existed. Pure: the same set of paths gives the same city.
export function layout(paths: string[]): CityLayout {
  const root = buildTree(paths)
  const size = Math.sqrt(root.weight) * LOT * 1.35 // 1.35 leaves room for streets
  const lots = new Map<string, Rect>(), districts: District[] = []
  place(root, { x: 0, z: 0, w: size, d: size }, 0, '', lots, districts)
  return { size, lots, districts }
}

function buildTree(paths: string[]): Folder {
  const mk = (name: string): Folder => ({ name, dirs: new Map(), files: [], weight: 0 })
  const root = mk('')
  for (const p of paths) {
    let node = root
    node.weight++
    for (const part of p.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, mk(part))
      node = node.dirs.get(part)!
      node.weight++
    }
    node.files.push(p)
  }
  return root
}

function place(node: Folder, r: Box, depth: number, path: string, lots: Map<string, Rect>, districts: District[]) {
  districts.push([r.x, r.z, r.w, r.d, depth, path])
  const pad = Math.min(STREET / 2 ** depth, 0.1 * Math.min(r.w, r.d))
  const inner = { x: r.x + pad, z: r.z + pad, w: r.w - 2 * pad, d: r.d - 2 * pad }
  const items: Item[] = [...node.dirs.values()].map((n): Item => ({ name: n.name, weight: n.weight, dir: n }))
    .concat(node.files.map(p => ({ name: p.slice(p.lastIndexOf('/') + 1), weight: 1, path: p })))
    .sort((a, b) => b.weight - a.weight || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || +!!b.dir - +!!a.dir)
  for (const { it, x, z, w, d } of squarify(items, inner)) {
    if (it.dir) place(it.dir, { x, z, w, d }, depth + 1, path ? `${path}/${it.dir.name}` : it.dir.name, lots, districts)
    else lots.set(it.path!, [x, z, w, d])
  }
}

// Bruls et al. squarified treemap. items are sorted by weight, descending.
function squarify(items: Item[], rect: Box): (Box & { it: Item })[] {
  const total = items.reduce((s, it) => s + it.weight, 0)
  const scale = (rect.w * rect.d) / total // area per unit of weight
  const out: (Box & { it: Item })[] = []
  let r = rect, row: Item[] = [], i = 0
  while (i < items.length) {
    const side = Math.min(r.w, r.d)
    const next = [...row, items[i]]
    if (row.length === 0 || worst(next, side, scale) <= worst(row, side, scale)) { row = next; i++ }
    else { r = layoutRow(row, r, scale, out); row = [] }
  }
  if (row.length) layoutRow(row, r, scale, out)
  return out
}

function worst(row: Item[], side: number, scale: number): number {
  let sum = 0, max = 0, min = Infinity
  for (const it of row) {
    const a = it.weight * scale
    sum += a
    max = Math.max(max, a)
    min = Math.min(min, a)
  }
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
}

// Lay a row along the shorter side of r; return what's left of r.
function layoutRow(row: Item[], r: Box, scale: number, out: (Box & { it: Item })[]): Box {
  const area = row.reduce((s, it) => s + it.weight * scale, 0)
  if (r.w >= r.d) {
    const colW = area / r.d
    let z = r.z
    for (const it of row) {
      const d = (it.weight * scale) / colW
      out.push({ it, x: r.x, z, w: colW, d })
      z += d
    }
    return { x: r.x + colW, z: r.z, w: r.w - colW, d: r.d }
  }
  const rowD = area / r.w
  let x = r.x
  for (const it of row) {
    const w = (it.weight * scale) / rowD
    out.push({ it, x, z: r.z, w, d: rowD })
    x += w
  }
  return { x: r.x, z: r.z + rowD, w: r.w, d: r.d - rowD }
}
