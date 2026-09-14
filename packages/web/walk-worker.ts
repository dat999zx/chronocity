// Replays a dropped repo's history off the main thread: the same core walker the bake script runs, on an in-memory .git.
import './buffer-shim.ts' // must come before isomorphic-git
import * as git from 'isomorphic-git'
import { walk } from '@chronocity/core/walker.ts'
import type { Model } from '@chronocity/core/model.ts'
import { memfs } from './memfs.ts'

export type WalkReply =
  | { type: 'progress'; step: number; total: number }
  | { type: 'done'; model: Model }
  | { type: 'error'; message: string }

const reply = (m: WalkReply) => (self as unknown as { postMessage(m: WalkReply): void }).postMessage(m)

self.onmessage = async (e: MessageEvent<Map<string, ArrayBuffer>>) => {
  try {
    const files = new Map([...e.data].map(([path, bytes]) => [path, new Uint8Array(bytes)] as const))
    const model = await walk({ git, fs: memfs(files), dir: '/', onProgress: (step, total) => reply({ type: 'progress', step, total }) })
    reply({ type: 'done', model })
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    reply({ type: 'error', message: /Could not find HEAD/.test(message) ? 'That repo has no commits yet (or its HEAD is missing).' : message })
  }
}
