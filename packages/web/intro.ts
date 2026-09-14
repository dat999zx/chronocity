import { renderOwn, type Report } from './local.ts'
import { FolderError, directoryPicker, fromEntry, fromFileList, fromHandle, type GitFolder } from './gitfolder.ts'

export interface GalleryEntry { name: string; repo: string; about?: string }

export interface IntroContext {
  gallery: GalleryEntry[]
  current: GalleryEntry      // what's on screen now
  commits: number            // its real commit count
  local: GalleryEntry | null // the last repo you dropped, if any
  open(name: string): void   // switch to a gallery demo, or 'local'
}

export interface Intro {
  readonly isOpen: boolean
  show(): void
  hide(): void
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i
const SHORTHAND = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/

// The glass card at the start: what this is, who made it, what's on screen, and "render your own" by dropping a cloned
// repo folder (browsers can't clone from GitHub, so a pasted URL becomes the clone command). Everything stays local.
export function createIntro(root: HTMLElement, ctx: IntroContext): Intro {
  const $ = <T extends Element>(selector: string) => root.querySelector(selector) as T
  const drop = $<HTMLDivElement>('.drop'), status = $<HTMLDivElement>('.status'), bar = $<HTMLProgressElement>('.drop progress')
  const pickInput = $<HTMLInputElement>('.pickinput'), urlInput = $<HTMLInputElement>('.gh input')
  const clone = $<HTMLDivElement>('.clone'), cloneCode = $<HTMLElement>('.clone code'), copyBtn = $<HTMLButtonElement>('.clone .copy')
  let busy = false

  // "You're watching knowl: … · 1,165 commits · GitHub ↗". Repo text goes in as text; links only from owner/name.
  const title = document.createElement('b')
  title.textContent = ctx.current.name === 'local' ? ctx.current.repo : ctx.current.name
  const count = document.createElement('span')
  count.className = 'muted'
  count.textContent = ` ${ctx.commits.toLocaleString()} commits`
  $<HTMLParagraphElement>('.now').replaceChildren("You're watching ", title, ctx.current.about ? `: ${ctx.current.about}` : '', count)
  if (REPO.test(ctx.current.repo)) {
    const a = document.createElement('a')
    a.href = `https://github.com/${ctx.current.repo}`
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = 'GitHub ↗'
    $<HTMLParagraphElement>('.now').append(' · ', a)
  }

  // Switch project
  for (const d of [...ctx.gallery, ...(ctx.local ? [ctx.local] : [])]) {
    const b = document.createElement('button')
    b.textContent = d.name === 'local' ? `your repo (${d.repo})` : d.name
    b.classList.toggle('on', d.name === ctx.current.name)
    b.onclick = () => (d.name === ctx.current.name ? hide() : ctx.open(d.name))
    $<HTMLDivElement>('.projects').append(b)
  }

  const report: Report = (text, fraction) => {
    status.textContent = text
    bar.hidden = fraction === undefined
    if (fraction !== undefined) bar.value = fraction
  }
  async function run(read: (onBytes: (n: number) => void) => Promise<GitFolder>) {
    if (busy) return
    busy = true
    show()
    drop.classList.add('busy')
    status.classList.remove('err')
    try {
      await renderOwn(read, report) // reloads into ?repo=local on success
    } catch (e) {
      busy = false
      drop.classList.remove('busy')
      bar.hidden = true
      status.classList.add('err')
      status.textContent = e instanceof FolderError ? e.message : `Couldn't replay that repo: ${(e as Error).message}`
    }
  }

  $<HTMLButtonElement>('.pick').onclick = async () => {
    if (!directoryPicker) return pickInput.click() // Firefox/Safari: the webkitdirectory input
    let dir: FileSystemDirectoryHandle
    try {
      dir = await directoryPicker({ id: 'chronocity-repo', mode: 'read' })
    } catch {
      return // cancelled
    }
    run(onBytes => fromHandle(dir, onBytes))
  }
  pickInput.onchange = () => {
    const list = pickInput.files
    if (list?.length) run(onBytes => fromFileList(list, onBytes))
  }

  // Drop a folder anywhere on the page.
  addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    document.body.classList.add('dropping')
  })
  addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping') })
  addEventListener('drop', e => {
    document.body.classList.remove('dropping')
    if (!e.dataTransfer?.items.length) return
    e.preventDefault()
    const entry = e.dataTransfer.items[0].webkitGetAsEntry() // only readable inside the handler
    run(onBytes => fromEntry(entry, onBytes))
  })

  // A GitHub URL becomes the clone command: browsers can't clone from GitHub (no CORS), and archives have no history.
  $<HTMLFormElement>('.gh').onsubmit = e => {
    e.preventDefault()
    const m = GITHUB_URL.exec(urlInput.value.trim()) ?? SHORTHAND.exec(urlInput.value.trim())
    status.classList.toggle('err', !m)
    clone.hidden = !m
    if (!m) {
      status.textContent = 'That doesn’t look like a GitHub repo. Try github.com/owner/repo.'
      return
    }
    const repo = `${m[1]}/${m[2]}`
    const known = ctx.gallery.find(d => d.repo.toLowerCase() === repo.toLowerCase())
    if (known) return ctx.open(known.name) // already baked: just show it
    status.textContent = ''
    cloneCode.textContent = `git clone https://github.com/${repo}.git`
  }
  copyBtn.onclick = () => {
    navigator.clipboard?.writeText(cloneCode.textContent ?? '').then(() => {
      copyBtn.textContent = 'Copied'
      setTimeout(() => { copyBtn.textContent = 'Copy' }, 1500)
    })
  }

  $<HTMLButtonElement>('.go').onclick = () => hide()
  $<HTMLButtonElement>('.close').onclick = () => hide()
  root.addEventListener('pointerdown', e => { if (e.target === root) hide() }) // click outside the card
  if (matchMedia('(pointer: coarse)').matches) root.classList.add('touch') // phones: no folders to drop

  function show() { root.hidden = false }
  function hide() { if (!busy) root.hidden = true }
  return { get isOpen() { return !root.hidden }, show, hide }
}
