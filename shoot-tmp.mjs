import { chromium } from 'playwright'
const OUT = process.argv[2]
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } })
const p = await ctx.newPage()
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERR:', m.text().slice(0,200)) })
p.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0,200)))

await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' })
await p.getByLabel('Phone number').fill('+46709900001')
const send = p.getByRole('button', { name: 'Send code' })
await send.waitFor({ state: 'visible' })
// GoTrue throttles OTP sends per number; the button becomes "Resend code (Ns)".
const code = p.getByLabel('6-digit code')
for (let attempt = 1; attempt <= 12; attempt++) {
  if (await code.isVisible().catch(() => false)) break
  if (await send.isEnabled().catch(() => false)) await send.click().catch(() => {})
  if (await code.isVisible({ timeout: 5000 }).catch(() => false)) break
  await p.waitForTimeout(5000)
}
await code.waitFor({ state: 'visible', timeout: 30000 })
await p.getByLabel('6-digit code').fill('000000')
await p.getByRole('button', { name: /verify|log in|sign in/i }).click()
await p.waitForURL(/\/admin\//, { timeout: 20000 })
console.log('logged in ->', p.url())

const widths = [1440, 1100, 980, 860, 700]
for (const w of widths) {
  await p.setViewportSize({ width: w, height: 1100 })
  await p.goto('http://localhost:3000/seed-klubben/admin/event', { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${OUT}/event-${w}.png`, fullPage: false })
  console.log('shot', w)
}
await p.setViewportSize({ width: 1440, height: 1100 })
for (const [name, url] of [['dashboard','/seed-klubben/admin/dashboard'],['workareas','/seed-klubben/admin/workstations'],['scheduling','/seed-klubben/admin/scheduling']]) {
  await p.goto('http://localhost:3000'+url, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  console.log('shot', name)
}
await b.close()
