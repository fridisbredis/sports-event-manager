import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
const p = await ctx.newPage()
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' })
await p.getByLabel('Phone number').fill('+46709900001')
const send = p.getByRole('button', { name: 'Send code' })
await send.click()
await p.getByLabel('6-digit code').waitFor({ state:'visible', timeout:20000 })
await p.getByLabel('6-digit code').fill('000000')
await p.getByRole('button', { name: /verify|log in|sign in/i }).click()
await p.waitForURL(/\/admin\//, { timeout:20000 })
await p.goto('http://localhost:3000/seed-klubben/admin/event', { waitUntil:'networkidle' })
await p.waitForTimeout(600)

// Intrinsic min width of the stage row: sum of its children at their natural size.
const m = await p.evaluate(() => {
  const label = [...document.querySelectorAll('*')].find(e => e.textContent?.trim()==='STAGES*' || e.className?.toString().includes('section-label') && e.textContent?.includes('STAGES'))
  const card = label?.closest('div')?.parentElement
  const row = [...document.querySelectorAll('div')].find(d => d.textContent?.includes('Day 1') && d.className?.toString().includes('flex-nowrap'))
  const kids = row ? [...row.children].map(c => ({ t: c.textContent.trim().slice(0,14), w: Math.round(c.getBoundingClientRect().width) })) : []
  const grid = document.querySelector('[class*="repeat(auto-fit"]')
  const main = document.querySelector('.px-8')
  return {
    rowW: row ? Math.round(row.getBoundingClientRect().width) : null,
    kids, kidSum: kids.reduce((a,k)=>a+k.w,0),
    gridW: grid ? Math.round(grid.getBoundingClientRect().width) : null,
    mainW: main ? Math.round(main.getBoundingClientRect().width) : null,
  }
})
console.log(JSON.stringify(m,null,2))
await b.close()
