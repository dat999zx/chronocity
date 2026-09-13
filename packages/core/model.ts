// The Model: the contract between the walker, the bake script and the renderer (spec: "Model").

/** [author time in unix seconds, minutes east of UTC, sum of |ΔLOC| across files in this step] */
export type Commit = [t: number, tz: number, churn: number]
/** [step index, lines of code at that step; 0 = deleted] */
export type Sample = [step: number, loc: number]
/** A file and every step that touched it. */
export type FileHistory = [path: string, samples: Sample[]]

export interface Model {
  v: 1
  commits: Commit[]
  files: FileHistory[]
}

/** A baked demo: a Model plus the repo it came from. */
export interface Demo extends Model {
  repo: string
}
