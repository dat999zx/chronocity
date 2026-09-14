// Which effects the city draws: switched in the ⚙ menu, remembered in this browser, and read by the city every frame
// (so they apply to exported clips too).
export const EFFECTS = {
  daynight: 'Day & night',
  fog: 'Fog',
  rain: 'Rain',
  lights: 'Window lights',
  scaffolding: 'Scaffolding',
  weathering: 'Weathering',
  shadows: 'Shadows',
  bloom: 'Glow',
} as const
export type Effects = Record<keyof typeof EFFECTS, boolean>

const KEY = 'chronocity:effects'

export function loadEffects(): Effects {
  const fx = Object.fromEntries(Object.keys(EFFECTS).map(k => [k, true])) as Effects
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    for (const k of Object.keys(fx) as (keyof Effects)[]) if (typeof saved[k] === 'boolean') fx[k] = saved[k]
  } catch {} // private window, blocked storage, bad JSON: everything on
  return fx
}

// One checkbox per effect in `menu`; `button` opens and closes it, and so does a click outside.
export function createEffectsMenu(button: HTMLButtonElement, menu: HTMLElement, fx: Effects) {
  for (const [key, label] of Object.entries(EFFECTS) as [keyof Effects, string][]) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = fx[key]
    box.onchange = () => {
      fx[key] = box.checked
      try { localStorage.setItem(KEY, JSON.stringify(fx)) } catch {}
    }
    const row = document.createElement('label')
    row.append(box, label)
    menu.append(row)
  }
  button.onclick = () => { menu.hidden = !menu.hidden }
  addEventListener('pointerdown', e => {
    const t = e.target as Node
    if (!menu.hidden && !menu.contains(t) && !button.contains(t)) menu.hidden = true
  })
}
