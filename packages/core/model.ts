// The Model: the contract between the walker, the bake script and the renderer (spec: "Model").

/** [author unix seconds, minutes east of UTC, Σ|ΔLOC| this step, commit sha, first line of the message, author name] */
export type Commit = [t: number, tz: number, churn: number, sha: string, subject: string, author: string]
/** [step index, lines of code at that step (0 = deleted), lines added, lines removed] */
export type Sample = [step: number, loc: number, add: number, del: number]
/** A file and every step that touched it. */
export type FileHistory = [path: string, samples: Sample[]]

export interface Model {
  v: 2
  commits: Commit[]
  files: FileHistory[]
}

/** A baked demo: a Model plus the repo it came from (owner/name for GitHub repos). */
export interface Demo extends Model {
  repo: string
}
