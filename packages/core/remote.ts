// "owner/name" when a repo's .git/config has a GitHub `origin`, else null. It lets a dropped clone get GitHub diffs
// in the inspect card. Only `origin` counts: forks often have an `upstream` that isn't where the commits live.
export function githubRepoOf(config: string): string | null {
  let inOrigin = false
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line)
      continue
    }
    const url = inOrigin && /^url\s*=\s*(.+)$/.exec(line)?.[1].trim()
    if (!url) continue
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
    return m ? `${m[1]}/${m[2]}` : null
  }
  return null
}
