import { expect, test, type Page } from '@playwright/test'
import geometry from '../src/calendar-puzzle/geometry.json' with { type: 'json' }
import {
  createSession,
  parseDate,
  pauseSession,
  saveSession,
  startSession,
  type SessionMode,
} from '../src/calendar-puzzle/session'
import photo from './calendar-photo-solution.json' with { type: 'json' }

const gamePath = '/'
const sessionRoot = (page: Page) => page.locator('main[data-phase], [data-phase].cal-app').first()
const lastPlacement = photo.placements.at(-1)!

async function seedNearCompletion(page: Page, mode: SessionMode) {
  const date = parseDate(photo.date)!
  const id = `photo-${mode}`
  const puzzle = JSON.stringify({
    version: 1,
    date: date.iso,
    weekday: date.weekday,
    boardVersion: geometry.boardVersion,
    pieceSetVersion: geometry.pieceSetVersion,
    steps: photo.placements.length - 1,
    pieces: photo.placements.map(piece => piece.id === lastPlacement.id ? { ...piece, anchor: null } : piece),
  })
  const session = pauseSession(startSession(createSession(date, mode, puzzle, id), 0), 4200)
  const entries = new Map<string, string>()
  saveSession(geometry, session, {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: (key, value) => entries.set(key, value),
  })
  await page.addInitScript((values) => {
    for (const [key, value] of values) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    }
  }, [...entries])
  return id
}

async function storedResults(page: Page, id: string) {
  return page.evaluate((sessionId) => Object.keys(localStorage)
    .filter(key => key.startsWith('calendar-puzzle:v1:') && key.endsWith(`:result:${sessionId}`))
    .map(key => JSON.parse(localStorage.getItem(key)!)), id)
}

async function placeLastPiece(page: Page) {
  await page.locator(`[data-piece="${lastPlacement.id}"]`).focus()
  const [x, y] = lastPlacement.anchor
  for (let i = 0; i < x; i += 1) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < y; i += 1) await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cal-candidate[data-legal="true"]').first()).toBeVisible()
  await page.keyboard.press('Enter')
}

for (const mode of ['timed', 'relaxed'] as const) {
  test(`completes the June 20 solution and restores one ${mode} result`, async ({ page }) => {
    const id = await seedNearCompletion(page, mode)
    await page.goto(gamePath)
    await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'paused')
    await page.getByRole('button', { name: '继续挑战', exact: true }).click()
    await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'running')
    await placeLastPiece(page)
    await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'complete')
    await expect(page.getByText('成功通关', { exact: true })).toBeVisible()
    await expect(page.locator('.cal-steps')).toHaveText(String(photo.placements.length))

    await expect.poll(() => storedResults(page, id)).toHaveLength(1)
    const [record] = await storedResults(page, id)
    expect(record.date).toMatchObject({ iso: photo.date, weekday: 7 })
    expect(record).toMatchObject({ id, steps: photo.placements.length, mode })
    if (mode === 'timed') expect(record.elapsedMs).toBeGreaterThanOrEqual(4200)
    else expect(record.elapsedMs).toBeNull()

    await page.reload()
    await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'complete')
    expect(await storedResults(page, id)).toEqual([record])
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '成绩', exact: true }).click()
    const records = page.getByRole('dialog', { name: '本机最快记录' })
    await expect(records.getByRole('listitem')).toContainText(`${photo.placements.length} 步`)
    await expect(records).toContainText('已完成 1 个不同日期')
    if (mode === 'timed') await expect(records.locator('.cal-record-best')).toContainText(`${photo.placements.length} 步`)
    else await expect(records).toContainText('暂无计时通关记录')
  })
}

test('validates a leap date before applying it and holds the same board geometry', async ({ page }) => {
  await page.goto(gamePath)
  await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'ready')
  const cells = page.locator('.cal-grid [data-cell]')
  await expect(cells).toHaveCount(50)
  const before = await cells.allTextContents()
  await page.getByRole('button', { name: '开始挑战', exact: true }).click()
  const openDate = () => page.getByRole('button', { name: '选择日期', exact: true }).click()
  await openDate()
  await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'paused')
  const date = page.locator('input[type=date]')
  const apply = page.getByRole('button', { name: '开始该日期', exact: true })
  await date.fill('')
  await expect(apply).toBeDisabled()
  await date.fill('2024-02-29')
  await expect(page.getByRole('dialog')).toContainText('星期四')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'paused')
  expect(await cells.allTextContents()).toEqual(before)

  await openDate()
  await date.fill('2024-02-29')
  await expect(page.getByRole('dialog')).toContainText('星期四')
  await expect(page.getByRole('dialog').locator('.cal-availability')).toHaveCount(0)
  await apply.click()
  await expect(sessionRoot(page)).toHaveAttribute('data-phase', 'ready')
  await expect(sessionRoot(page).locator('[data-target-date]')).toHaveText('2024年2月29日 星期四')
  await expect(sessionRoot(page).locator('.cal-availability')).toHaveCount(0)
  expect(await cells.allTextContents()).toEqual(before)
  await expect(page.locator('[data-cell="3,6"]')).toHaveText('31日')
})
