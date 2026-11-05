// E2E: полный игровой цикл в режиме симуляции.
// Запуск: `npm run dev` (порт 5174), затем `node tests/e2e.mjs [baseUrl]`.
// PW_CHANNEL=chrome|msedge — использовать установленный браузер.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5174/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--enable-unsafe-swiftshader'],
});
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors };
}

const state = (page) => page.evaluate(() => {
  const s = window.__store.getState();
  return { phase: s.phase, likes: s.profile.likes, given: s.profile.likesGiven, deliveries: s.profile.deliveries,
    benches: s.benches.length, trip: s.trip, result: s.result, notice: s.notice?.text ?? null };
});
const player = (page) => page.evaluate(() => window.__sim.player());
const walkTo = (page, x, z) => page.evaluate(([x, z]) => window.__sim.walkTo(x, z), [x, z]);
async function clickFloor(page, x, z) {
  const p = await page.evaluate(([x, z]) => window.__sim.screenOf(x, z), [x, z]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

const A = { x: -1.6, z: 0.6 };
const B = { x: 1.6, z: -1.2 };

// ---------------- Десктоп: полный цикл ----------------
{
  const { context, page, errors } = await newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByTestId('start-sim').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="start-sim"]').disabled);
  await page.screenshot({ path: `${OUT}/01-start.png` });
  check('стартовый экран, режим определён (нет WebXR → симуляция)', await page.getByTestId('start-sim').isVisible());

  await page.getByTestId('start-sim').click();
  await page.getByTestId('mode-badge').waitFor();
  check('индикатор режима «Симуляция»', (await page.getByTestId('mode-badge').textContent()) === 'Симуляция');
  await page.waitForFunction(() => window.__store.getState().phase === 'placingA', null, { timeout: 5000 });
  await sleep(1500); // камера доехала
  check('калибровка → расстановка A', true);

  await clickFloor(page, A.x, A.z);
  let s = await state(page);
  check('клик по полу ставит Старт (A)', s.phase === 'placingB');

  await clickFloor(page, A.x + 1, A.z);
  s = await state(page);
  check('Финиш ближе 2 м не ставится, есть предупреждение', s.phase === 'placingB' && /Слишком близко/.test(s.notice ?? ''), s.notice);
  await page.screenshot({ path: `${OUT}/02-too-close.png` });

  await clickFloor(page, B.x, B.z);
  s = await state(page);
  check('Финиш (B) поставлен → идти к Старту', s.phase === 'toStart');
  await sleep(300);
  await page.screenshot({ path: `${OUT}/03-stations.png` });
  check('кнопки «Получить» нет вдали от A', !(await page.getByTestId('pickup').isVisible()));

  // Клавиатура: W двигает игрока
  const p0 = await player(page);
  await page.keyboard.down('KeyW');
  await sleep(400);
  await page.keyboard.up('KeyW');
  const p1 = await player(page);
  check('WASD двигает игрока', p1.z < p0.z - 0.2, `z ${p0.z.toFixed(2)} → ${p1.z.toFixed(2)}`);

  await walkTo(page, A.x + 0.3, A.z);
  await sleep(200);
  check('у Старта появилась кнопка «Получить груз»', await page.getByTestId('pickup').isVisible());
  await page.getByTestId('pickup').click();
  await sleep(500);
  await page.screenshot({ path: `${OUT}/04-pickup-animation.png` });
  s = await state(page);
  check('груз получен, качество 100%', s.phase === 'carrying' && s.trip.quality > 99.5);
  await sleep(900);

  // Полпути: скамейка + благодарность
  await walkTo(page, 0, -0.3);
  await page.getByTestId('place-bench').click();
  s = await state(page);
  check('скамейка поставлена', s.benches === 1);
  await sleep(200);
  check('рядом со скамейкой есть «Поблагодарить волонтёров»', await page.getByTestId('thank').isVisible());

  // Спрей: −5
  await page.getByTestId('spray').click();
  s = await state(page);
  check('спрей стоит 5 Лайков и включает защиту', s.likes === 5 && s.trip.protection > 14, `likes=${s.likes}`);
  check('повторный спрей во время защиты недоступен', await page.getByTestId('spray').isDisabled());

  await page.getByTestId('thank').click();
  s = await state(page);
  check('благодарность: −1 Лайк, «Лайки отданы» +1', s.likes === 4 && s.given === 1);
  await sleep(200);
  check('повторно поблагодарить нельзя', !(await page.getByTestId('thank').isVisible()));
  await page.screenshot({ path: `${OUT}/05-carrying-bench.png` });

  await walkTo(page, B.x - 0.4, B.z + 0.2);
  await sleep(200);
  const beforeDeliver = await state(page);
  check('у Финиша кнопка «Сдать груз»', await page.getByTestId('deliver').isVisible(),
    `качество ${beforeDeliver.trip.quality.toFixed(1)}%, путь ${beforeDeliver.trip.distance.toFixed(1)} м, ${beforeDeliver.trip.time.toFixed(1)} с`);
  await page.getByTestId('deliver').click();
  await sleep(700);
  await page.screenshot({ path: `${OUT}/06-delivery-animation.png` });
  await page.getByTestId('result').waitFor({ timeout: 5000 });
  s = await state(page);
  check('груз сдан, Лайки начислены', s.phase === 'result' && s.result.likesEarned > 0 && s.likes === 4 + s.result.likesEarned,
    `+${s.result.likesEarned} (за качество ${s.result.base}, за скорость ${s.result.bonus}), всего ${s.likes}`);
  check('экран результата', (await page.getByTestId('reward').textContent()).includes(`+${s.result.likesEarned}`));
  await page.screenshot({ path: `${OUT}/07-result.png` });

  await page.getByTestId('new-order').click();
  s = await state(page);
  check('«Новый заказ» по тем же точкам', s.phase === 'toStart');

  // Сохранение между сессиями
  const likesSaved = s.likes;
  await page.reload();
  await page.getByTestId('profile').waitFor();
  const profileText = await page.getByTestId('profile').textContent();
  check('Лайки и статистика сохранены в localStorage', profileText.includes(String(likesSaved)) && profileText.includes('Доставок: 1') && profileText.includes('Лайки отданы: 1'), profileText);

  check('нет ошибок в консоли (десктоп)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------- Погода: событие и штраф (ускоренно) ----------------
{
  const { context, page, errors } = await newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('start-sim').click();
  await page.waitForFunction(() => window.__store.getState().phase === 'placingA');
  await sleep(1500);
  await clickFloor(page, A.x, A.z);
  await clickFloor(page, B.x, B.z);
  await walkTo(page, A.x, A.z);
  await page.getByTestId('pickup').click();
  // Ждём событие погоды (20–40 с по правилам)
  await page.waitForFunction(() => window.__store.getState().trip?.weather, null, { timeout: 45000 });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/08-weather.png` });
  check('пришло событие погоды, HUD показывает таймер', await page.getByTestId('weather').isVisible(),
    await page.getByTestId('weather').textContent());
  check('кнопка «Спрей» подсвечена', (await page.getByTestId('spray').getAttribute('class')).includes('btn-alert'));
  const q0 = (await state(page)).trip.quality;
  await page.waitForFunction(() => !window.__store.getState().trip?.weather, null, { timeout: 15000 });
  const q1 = (await state(page)).trip.quality;
  check('без спрея: −5% качества', q0 - q1 > 4.9, `${q0.toFixed(1)} → ${q1.toFixed(1)}`);
  check('нет ошибок в консоли (погода)', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------- Телефон (симуляция, Pixel 7) ----------------
{
  const { defaultBrowserType: _i, ...pixel } = devices['Pixel 7'];
  const { context, page, errors } = await newPage(pixel);
  await page.goto(BASE);
  await page.getByTestId('start-sim').click();
  await page.waitForFunction(() => window.__store.getState().phase === 'placingA');
  await sleep(1500);
  check('[pixel7] джойстик виден на сенсорном экране', await page.getByTestId('joystick').isVisible());
  // джойстик: тянем вверх
  const box = await page.getByTestId('joystick').boundingBox();
  const p0 = await player(page);
  const cdp = await context.newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 45 }] });
  await sleep(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const p1 = await player(page);
  check('[pixel7] джойстик двигает игрока', p1.z < p0.z - 0.2, `z ${p0.z.toFixed(2)} → ${p1.z.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/09-pixel7.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('[pixel7] нет горизонтального скролла', !overflow);
  check('[pixel7] нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
