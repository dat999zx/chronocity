import type { Commit } from '@chronocity/core/model.ts'

export type DiffResult = { patch: string; url: string } | { error: string; url?: string }
interface GhFile { filename: string; previous_filename?: string; patch?: string }

const REPO = /^[\w.-]+\/[\w.-]+$/
const SHA = /^[0-9a-f]{40}$/
const cache = new Map<string, Promise<GhFile[]>>() // per API URL, for the session

// A commit's page on GitHub, only for well-formed owner/name and sha (both are baked data, so validate).
export function commitUrl(repo: string, sha: string): string | null {
  return REPO.test(repo) && SHA.test(sha) ? `https://github.com/${repo}/commit/${sha}` : null
}

// One file's unified diff at one step. It uses GitHub's compare of the previous step against this one, so the lines
// match the step even when it spans a merge or sampled history. Public repos only, unauthenticated: about 60
// requests an hour per visitor, so responses are cached and every failure becomes a sentence for the panel.
export async function stepPatch(repo: string, commits: Commit[], step: number, path: string): Promise<DiffResult> {
  const head = commits[step]?.[3] ?? '', base = commits[step - 1]?.[3]
  const url = commitUrl(repo, head)
  if (!url) return { error: 'No GitHub diff for this repo.' }
  const api = base && SHA.test(base)
    ? `https://api.github.com/repos/${repo}/compare/${base}...${head}`
    : `https://api.github.com/repos/${repo}/commits/${head}`
  let files = cache.get(api)
  if (!files) {
    files = load(api)
    cache.set(api, files)
  }
  try {
    const f = (await files).find(x => x.filename === path || x.previous_filename === path)
    if (!f) return { error: 'GitHub left this file out of the diff (too many files changed at once).', url }
    if (!f.patch) return { error: 'No text diff for this file (too large or binary).', url }
    return { patch: f.patch, url }
  } catch (e) {
    cache.delete(api)
    return { error: e instanceof TypeError ? 'Could not reach GitHub.' : (e as Error).message, url }
  }
}

async function load(api: string): Promise<GhFile[]> {
  const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 60
    throw new Error(`GitHub's hourly limit for anonymous visitors is used up; try again in ${mins} min.`)
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return ((await res.json()).files ?? []) as GhFile[]
}
