import type { Demo, Model } from '@chronocity/core/model.ts'
import type { GitFolder } from './gitfolder.ts'
import type { WalkReply } from './walk-worker.ts'

// "Render your own": read a dropped repo's .git, replay it in a Web Worker, keep the result in this origin's Cache
// Storage, then reload into it as ?repo=local. Nothing leaves the machine.

const CACHE = 'chronocity', KEY = 'local-repo.json'

export async function loadLocal(): Promise<Demo | null> {
  if (!('caches' in globalThis)) return null
  const hit = await (await caches.open(CACHE)).match(KEY)
  return hit ? hit.json() : null
}

async function saveLocal(demo: Demo) {
  const cache = await caches.open(CACHE)
  await cache.put(KEY, new Response(JSON.stringify(demo), { headers: { 'content-type': 'application/json' } }))
}

export type Report = (text: string, fraction?: number) => void

export async function renderOwn(read: (onBytes: (n: number) => void) => Promise<GitFolder>, report: Report): Promise<void> {
  report('Reading .git…', 0)
  const folder = await read(n => report(`Reading .git · ${(n / 1048576).toFixed(1)} MB…`))
  const model = await new Promise<Model>((resolve, reject) => {
    const worker = new Worker(new URL('./walk-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WalkReply>) => {
      const m = e.data
      if (m.type === 'progress') {
        report(`Replaying ${folder.repo} · ${m.step.toLocaleString()} / ${m.total.toLocaleString()} steps`, m.total ? m.step / m.total : 0)
        return
      }
      worker.terminate()
      if (m.type === 'done') resolve(m.model)
      else reject(new Error(m.message))
    }
    worker.onerror = e => {
      worker.terminate()
      reject(new Error(e.message || 'The history worker crashed.'))
    }
    worker.postMessage(folder.files, [...folder.files.values()])
  })
  report('Building the city…', 1)
  await saveLocal({ repo: folder.repo, ...model })
  location.search = '?repo=local'
}
