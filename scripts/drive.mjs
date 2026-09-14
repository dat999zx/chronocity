// Drive headless Chrome over the DevTools protocol (no dependencies): real mouse and keyboard input, evals,
// screenshots and file downloads. For checking interaction and clip export, which plain --screenshot can't.
// usage: node scripts/drive.mjs <outDir> <steps.json>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [outDir, stepsFile] = process.argv.slice(2)
if (!outDir || !stepsFile) {
  console.error('usage: node scripts/drive.mjs <outDir> <steps.json>')
  process.exit(1)
}
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'))
const out = path.resolve(outDir)
fs.mkdirSync(out, { recursive: true })
const port = 9333
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(process.env.TEMP ?? '/tmp', 'chrono-drive')}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
      console.log('CONSOLE', msg.params.type, msg.params.args.map(a => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  return { ws, send }
}

let targets = []
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page') } catch {}
  if (!targets.length) await sleep(200)
}
const browser = await connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl)
await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out, eventsEnabled: true })
const page = await connect(targets[0].webSocketDebuggerUrl)
const { send } = page
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
const click = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y) }
const KEYS = { Escape: 27, ' ': 32, ArrowRight: 39, ArrowLeft: 37 }

for (const s of steps) {
  if (s.go) { await send('Page.navigate', { url: s.go }); await sleep(s.settle ?? 4000) }
  else if (s.wait) await sleep(s.wait)
  else if (s.move) await mouse('mouseMoved', ...s.move, { button: 'none' })
  else if (s.click) await click(...s.click)
  else if (s.clickSel) {
    const r = await send('Runtime.evaluate', { returnByValue: true, expression:
      `(() => { const e = document.querySelector(${JSON.stringify(s.clickSel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })()` })
    const p = r.result?.result?.value
    console.log('clickSel', s.clickSel, JSON.stringify(p))
    if (p) await click(...p)
  }
  else if (s.key) {
    const code = s.key === ' ' ? 'Space' : s.key
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: s.key, code, windowsVirtualKeyCode: KEYS[s.key] })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code })
  }
  else if (s.setFiles) {
    // Pick files (or, for <input webkitdirectory>, a whole folder) on a file input, as if chosen in the dialog.
    const { root } = (await send('DOM.getDocument', { depth: 0 })).result
    const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: s.setFiles })).result
    await send('DOM.setFileInputFiles', { nodeId, files: s.paths.map(p => path.resolve(p)) })
    console.log('setFiles', s.setFiles, s.paths.join(', '))
  }
  else if (s.eval) {
    const r = await send('Runtime.evaluate', { expression: s.eval, returnByValue: true, awaitPromise: true })
    console.log('EVAL', s.label ?? '', JSON.stringify(r.result?.result?.value))
  }
  else if (s.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, s.shot + '.png'), Buffer.from(r.result.data, 'base64'))
    console.log('shot', s.shot)
  }
  else if (s.waitFile) {
    const file = path.join(out, s.waitFile), until = Date.now() + (s.timeout ?? 600) * 1000
    let size = -1
    while (Date.now() < until) {
      const now = fs.existsSync(file) ? fs.statSync(file).size : -1
      if (now > 0 && now === size) break // present and no longer growing
      size = now
      await sleep(2000)
    }
    console.log('file', s.waitFile, fs.existsSync(file) ? `${fs.statSync(file).size} bytes` : 'MISSING')
  }
}
page.ws.close()
browser.ws.close()
chrome.kill()
