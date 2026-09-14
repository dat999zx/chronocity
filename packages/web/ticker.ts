import { headline, stepAt, type Timeline } from '@chronocity/core/timeline.ts'
import type { Demo } from '@chronocity/core/model.ts'

// The commit line above the scrubber. While playing it names the biggest commit of the previous 0.6 s, readable at
// 25 commits a second; paused or scrubbing, exactly the commit at u.
export function createTicker(el: HTMLElement, model: Demo, tl: Timeline, churn: Float64Array, local: (step: number) => string) {
  let shown = -2
  return {
    update(u: number, playing: boolean) {
      const k = playing ? headline(churn, tl, u) : stepAt(tl, u)
      if (k === shown) return
      shown = k
      if (k < 0) {
        el.textContent = ''
        return
      }
      const [, , , , subject, author] = model.commits[k]
      el.textContent = `${local(k).slice(0, 10)} · ${author} · ${subject}`
      el.classList.remove('tick')
      void el.offsetWidth // restart the fade-in
      el.classList.add('tick')
    },
  }
}
