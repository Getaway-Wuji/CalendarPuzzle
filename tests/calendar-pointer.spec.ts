import { devices, expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import geometry from '../src/calendar-puzzle/geometry.json' with { type: 'json' };
import dailySolution from './calendar-all-dates-solution.json' with { type: 'json' };
import juneSolution from './calendar-photo-solution.json' with { type: 'json' };

test.use({ timezoneId: 'Asia/Shanghai' });

type Point = { x: number; y: number };

async function point(locator: Locator, x = 0.5, y = 0.5): Promise<Point> {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Expected a visible piece or cell');
  return { x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height };
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
}

test('direct navigation and mouse drags commit, cancel, and return pieces', async ({ page }) => {
  const engineResponse = page.waitForResponse(response => /\/assets\/calendar_puzzle_bg-.*\.wasm$/.test(response.url()));
  await page.goto('/');
  await expect(page).toHaveURL('/');
  const wasm = await engineResponse;
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()['content-type']).toContain('application/wasm');

  await page.getByRole('button', { name: '开始挑战', exact: true }).click();
  const grid = page.locator('.cal-grid');
  const piece = page.locator('[data-piece="J"]');
  const steps = page.locator('.cal-steps');
  const firstCell = page.locator('[data-cell="0,0"]');
  const adjacentCell = page.locator('[data-cell="1,0"]');

  await drag(page, await point(piece, 0.25), await point(firstCell));
  await expect(steps).toHaveText('0');
  await expect(grid.locator('.cal-candidate[data-legal="true"]')).toHaveCount(2);
  await page.mouse.up();
  await expect(steps).toHaveText('1');
  await expect(piece).toHaveAttribute('data-placed', 'true');
  await expect(piece).toHaveAttribute('data-rotation', '0');
  const placed = await point(piece, 0.25);
  expect(Math.abs(placed.x - (await point(firstCell)).x)).toBeLessThan(4);

  await drag(page, placed, await point(adjacentCell));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(steps).toHaveText('1');
  await expect(grid.locator('.cal-candidate')).toHaveCount(0);
  expect(await point(piece, 0.25)).toEqual(placed);

  await drag(page, placed, await point(adjacentCell));
  await page.mouse.up();
  await expect(steps).toHaveText('2');
  expect(Math.abs((await point(piece, 0.25)).x - (await point(adjacentCell)).x)).toBeLessThan(4);

  await drag(page, await point(piece, 0.25), await point(grid, 7.5 / 8, .5 / 8));
  await expect(grid.locator('.cal-candidate[data-legal="false"]').first()).toBeAttached();
  await page.mouse.up();
  await expect(steps).toHaveText('2');
  await expect(piece).toHaveAttribute('data-placed', 'false');

  await drag(page, await point(piece, 0.25), await point(firstCell));
  await page.mouse.up();
  await expect(steps).toHaveText('3');
  // The pointer sensor suppresses clicks for 50 ms after a drag.
  await page.waitForTimeout(60);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('main[data-phase]')).toHaveAttribute('data-phase', 'paused');
  await page.reload();
  await expect(page.locator('main[data-phase]')).toHaveAttribute('data-phase', 'paused');
  await expect(steps).toHaveText('3');
  await expect(piece).toHaveAttribute('data-placed', 'true');
  await page.getByRole('button', { name: '继续挑战', exact: true }).click();
  await page.getByRole('button', { name: '全部收回', exact: true }).click();
  await expect(steps).toHaveText('3');
  await expect(piece).toHaveAttribute('data-placed', 'false');
  await page.getByRole('button', { name: '重置关卡', exact: true }).click();
  await expect(page.locator('main[data-phase]')).toHaveAttribute('data-phase', 'ready');
  await expect(steps).toHaveText('0');
});

test('a short press rotates once and a long press flips once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始挑战', exact: true }).click();
  const piece = page.locator('[data-piece="J"]');
  await expect(piece).toHaveAttribute('data-rotation', '0');
  await expect(piece).toHaveAttribute('data-flipped', 'false');
  await piece.click();
  await expect(piece).toHaveAttribute('data-rotation', '1');
  await expect(piece).toHaveAttribute('data-flipped', 'false');

  const center = await point(piece);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect(piece).toHaveAttribute('data-flipped', 'true');
  await page.mouse.up();
  await expect(piece).toHaveAttribute('data-rotation', '3');
  await expect(piece).toHaveAttribute('data-flipped', 'true');
  await expect(page.locator('.cal-steps')).toHaveText('0');
});

for (const [name, solution] of [['June 20', juneSolution], ['today', dailySolution]] as const) {
  test(`plays all 11 pieces to solve ${name} from an empty board`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(`${dailySolution.date}T12:00:00+08:00`));
    await page.goto('/');
    if (name !== 'today') {
      await page.getByRole('button', { name: '选择日期', exact: true }).click();
      await page.getByLabel('目标日期', { exact: true }).fill(solution.date);
      await page.getByRole('button', { name: '开始该日期', exact: true }).click();
    }
    await expect(page.locator('[data-target-date]')).toHaveAttribute('data-target-date', solution.date);
    await expect(page.locator('.cal-availability')).toHaveCount(0);
    await page.getByRole('button', { name: '开始挑战', exact: true }).click();
    const steps = page.locator('.cal-steps');
    await expect(steps).toHaveText('0');

    for (const [index, { id, anchor: [x, y], rotation, flipped }] of solution.placements.entries()) {
      const original = geometry.pieceDefinitions.find(piece => piece.id === id)!;
      const piece = page.locator(`[data-piece="${id}"]`);
      await piece.focus();
      if (flipped) await page.keyboard.press('f');
      for (let turn = 0; turn < rotation; turn++) await page.keyboard.press('r');
      await expect(piece).toHaveAttribute('data-flipped', String(flipped));
      await expect(piece).toHaveAttribute('data-rotation', String(rotation));

      const cells = original.cells.map(([sourceX, sourceY]) => {
        let cellX = flipped ? -sourceX : sourceX;
        let cellY = sourceY;
        for (let turn = 0; turn < rotation; turn++) [cellX, cellY] = [-cellY, cellX];
        return [cellX, cellY];
      });
      const minX = Math.min(...cells.map(([cellX]) => cellX));
      const minY = Math.min(...cells.map(([, cellY]) => cellY));
      const width = Math.max(...cells.map(([cellX]) => cellX)) - minX + 1;
      const height = Math.max(...cells.map(([, cellY]) => cellY)) - minY + 1;
      const grabX = cells[0]![0] - minX;
      const grabY = cells[0]![1] - minY;
      const cell = page.locator(`[data-cell="${x + grabX},${y + grabY}"]`);
      await drag(page, await point(piece, (grabX + 0.5) / width, (grabY + 0.5) / height), await point(cell));
      await expect(page.locator('.cal-candidate[data-legal="true"]')).toHaveCount(original.cells.length);
      await page.mouse.up();
      await expect(steps).toHaveText(String(index + 1));
    }

    await expect(page.locator('main[data-phase]')).toHaveAttribute('data-phase', 'complete');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('成功通关');
    await expect(dialog).toContainText('本机该日期最快记录');
    if (name === 'today') await expect(page.locator('.cal-grid [data-target="true"]')).toHaveText(['11月', '17日', '星期二']);
  });
}

test.describe('touch input', () => {
  const { hasTouch, isMobile, userAgent, deviceScaleFactor } = devices['Pixel 7'];
  test.use({ hasTouch, isMobile, userAgent, deviceScaleFactor, viewport: { width: 393, height: 1150 } });

  test('touch drops snap to the fixed board and a cancelled touch preserves placement', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '开始挑战', exact: true }).click();
    const grid = page.locator('.cal-grid');
    const piece = page.locator('[data-piece="J"]');
    const steps = page.locator('.cal-steps');
    await expect(grid.locator('[data-cell]')).toHaveCount(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await piece.scrollIntoViewIfNeeded();

    const touch = await page.context().newCDPSession(page);
    async function move(from: Point, to: Point) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
      for (const fraction of [0.1, 0.5, 1]) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: from.x + fraction * (to.x - from.x), y: from.y + fraction * (to.y - from.y), id: 0 }],
        });
      }
    }

    const target = await point(page.locator('[data-cell="1,2"]'));
    await move(await point(piece, 0.25), target);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(steps).toHaveText('1');
    const placed = await point(piece, 0.25);
    expect(Math.abs(placed.x - target.x)).toBeLessThan(4);
    expect(Math.abs(placed.y - target.y)).toBeLessThan(4);

    await move(placed, await point(page.locator('[data-cell="2,2"]')));
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(steps).toHaveText('1');
    expect(await point(piece, 0.25)).toEqual(placed);
  });
});

test('scrolls a short phone viewport toward the board during a touch drag', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ ...devices['Pixel 7'], baseURL, viewport: { width: 393, height: 700 } });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '开始挑战', exact: true }).click();
    const piece = page.locator('[data-piece="K"]');
    const cell = page.locator('[data-cell="0,0"]');
    await piece.scrollIntoViewIfNeeded();
    expect((await point(cell)).y).toBeLessThan(0);

    const touch = await page.context().newCDPSession(page);
    const from = await point(piece, 0.125);
    const x = (await point(cell)).x;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 10, id: 0 }] });
    await expect.poll(async () => (await point(cell)).y).toBeGreaterThan(140);
    const target = await point(cell);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...target, id: 0 }] });
    await expect(page.locator('.cal-candidate[data-legal="true"]')).toHaveCount(4);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(piece).toHaveAttribute('data-placed', 'true');
    await expect(page.locator('.cal-steps')).toHaveText('1');
  } finally {
    await page.close();
  }
});
