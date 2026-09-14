// node packages/bake/bake.ts <repoPath> <name> [label] [ref]
// Walks a local repo's history and writes packages/web/public/demos/<name>.json for the gallery.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as git from 'isomorphic-git'
import { walk } from '@chronocity/core/walker.ts'
import type { Demo } from '@chronocity/core/model.ts'

const [repoPath, name, label = name, ref = 'HEAD'] = process.argv.slice(2)
if (!repoPath || !name) {
  console.error('usage: node packages/bake/bake.ts <repoPath> <name> [label] [ref]')
  process.exit(1)
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`demo name must be lowercase letters, digits and dashes (it ends up in paths and URLs): ${name}`)
  process.exit(1)
}
const started = Date.now()
const model = await walk({
  git, fs, ref, dir: path.resolve(repoPath),
  onProgress: (i, n) => process.stderr.write(`\r${i}/${n} steps`),
})
const out = fileURLToPath(new URL(`../web/public/demos/${name}.json`, import.meta.url))
fs.mkdirSync(path.dirname(out), { recursive: true })
const demo: Demo = { repo: label, ...model }
fs.writeFileSync(out, JSON.stringify(demo))
const secs = ((Date.now() - started) / 1000).toFixed(1)
console.error(`\n${model.commits.length} steps, ${model.files.length} files, ${secs}s -> ${out}`)

// demos/index.json lists the gallery. Upsert this demo, keeping order (the first entry is the default demo) and any
// hand-written fields such as `about`, the one-liner the intro card shows.
type Entry = { name: string; repo: string; steps: number; files: number; about?: string }
const indexFile = fileURLToPath(new URL('../web/public/demos/index.json', import.meta.url))
const index: Entry[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : []
const entry: Entry = { name, repo: label, steps: model.commits.length, files: model.files.length }
const at = index.findIndex(e => e.name === name)
if (at >= 0) index[at] = { ...index[at], ...entry }
else index.push(entry)
fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n')
console.error(`gallery: ${index.map(e => e.name).join(', ')}`)
