// The Model: the contract between the walker, the bake script and the renderer (spec: "Model").

/**
 * [author unix seconds, minutes east of UTC, Σ|ΔLOC| this step, commit sha, subject, author name, commits this step brings]
 * `commits` is 1 for an ordinary commit and 1 + the branch's own commits for a merge, so it sums to the repo's full
 * commit count (what GitHub shows), while the steps themselves follow the first-parent main line.
 */
export type Commit = [t: number, tz: number, churn: number, sha: string, subject: string, author: string, commits: number]
/** [step index, lines of code at that step (0 = deleted), lines added, lines removed] */
export type Sample = [step: number, loc: number, add: number, del: number]
/** A file and every step that touched it. */
export type FileHistory = [path: string, samples: Sample[]]

export interface Model {
  v: 3
  commits: Commit[]
  files: FileHistory[]
}

/** A baked demo: a Model plus the repo it came from (owner/name for GitHub repos). */
export interface Demo extends Model {
  repo: string
}
