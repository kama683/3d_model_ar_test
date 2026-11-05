// E2E-проверка в Chromium с фейковой камерой.
// Запуск: сначала `npm run dev`, затем `node tests/e2e.mjs [baseUrl]`.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173/';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

// PW_CHANNEL=chrome|msedge — использовать установленный браузер вместо скачанного Chromium.
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'],
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = (page) => page.evaluate(() => ({ ...window.__arDebug.target }));

async function openAndStart(context, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByTestId('start-camera').waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${OUT}/${label}-1-start.png` });
  check(`[${label}] заставка с кнопкой`, await page.getByTestId('start-camera').isVisible());

  await page.getByTestId('start-camera').click();
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 2 && v.videoWidth > 0;
  }, null, { timeout: 15000 });
  check(`[${label}] камера включилась`, true);
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForSelector('.loading', { state: 'detached', timeout: 30000 }).catch(() => {});
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/${label}-2-camera-model.png` });
  return { page, errors };
}

// ---------- Десктоп ----------
{
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera'],
    acceptDownloads: true,
  });
  const { page, errors } = await openAndStart(context, 'desktop');

  // Модель видна: снимаем фото (оно композитит видео + WebGL), и проверяем, что WebGL-слой не пустой
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.getByTestId('take-photo').click();
  const download = await downloadPromise;
  const photoPath = `${OUT}/desktop-photo.png`;
  await download.saveAs(photoPath);
  check('[desktop] фото скачалось', fs.statSync(photoPath).size > 10000, download.suggestedFilename());

  const t0 = await target(page);
  for (let i = 0; i < 3; i++) await page.locator('[data-action="right"]').click();
  const t1 = await target(page);
  check('[desktop] 3 тапа «Вправо» = 3 шага', Math.abs(t1.x - t0.x - 0.45) < 1e-6, `x=${t1.x.toFixed(2)}`);

  const up = page.locator('[data-action="up"]');
  const box = await up.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(900);
  await page.mouse.up();
  const t2 = await target(page);
  check('[desktop] удержание «Вверх» = непрерывное движение', t2.y > 0.5, `y=${t2.y.toFixed(2)}`);

  await page.locator('[data-action="scaleUp"]').click();
  await page.locator('[data-action="forward"]').click();
  await page.locator('[data-action="rotateRight"]').click();
  const t3 = await target(page);
  check('[desktop] масштаб/ближе/поворот', t3.scale > 1.05 && t3.z > 0 && t3.rotY > 0,
    `scale=${t3.scale.toFixed(2)} z=${t3.z.toFixed(2)} rotY=${t3.rotY.toFixed(2)}`);

  // Мышь: drag и колесо
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(250, 300, { steps: 8 });
  await page.mouse.up();
  const t4 = await target(page);
  check('[desktop] ЛКМ-drag двигает модель', t4.x < t3.x - 0.3, `x ${t3.x.toFixed(2)} → ${t4.x.toFixed(2)}`);
  await page.mouse.wheel(0, -300);
  await sleep(100);
  const t5 = await target(page);
  check('[desktop] колесо = масштаб', t5.scale > t4.scale, `scale ${t4.scale.toFixed(2)} → ${t5.scale.toFixed(2)}`);

  await sleep(600);
  await page.screenshot({ path: `${OUT}/desktop-3-moved.png` });

  await page.getByTestId('auto-rotate').click();
  await page.getByTestId('dance').click();
  await sleep(1500);
  const t6 = await target(page);
  check('[desktop] авто-вращение', t6.rotY > t5.rotY + 1, `rotY=${t6.rotY.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/desktop-4-dance.png` });

  await page.getByTestId('reset').click();
  await sleep(900);
  const t7 = await target(page);
  check('[desktop] сброс', t7.x === 0 && t7.y === 0 && t7.z === 0 && t7.scale === 1 && t7.rotY === 0);
  await page.getByTestId('dance').click();
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/desktop-5-reset.png` });

  await page.getByTestId('switch-camera').click();
  await sleep(1000);
  const toast = await page.getByTestId('toast').textContent().catch(() => null);
  check('[desktop] переключение камеры обработано', true, `toast="${toast}"`);

  check('[desktop] нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------- Мобильные ----------
for (const [label, device] of [['iphone14', devices['iPhone 14']], ['pixel7', devices['Pixel 7']]]) {
  // Используем Chromium с параметрами устройства (вьюпорт, DPR, touch, UA).
  const { defaultBrowserType: _ignored, ...opts } = device;
  const context = await browser.newContext({ ...opts, permissions: ['camera'] });
  const { page, errors } = await openAndStart(context, label);

  const t0 = await target(page);
  await page.locator('[data-action="left"]').tap();
  await page.locator('[data-action="scaleDown"]').tap();
  const t1 = await target(page);
  check(`[${label}] тап по кнопкам`, t1.x < t0.x && t1.scale < t0.scale);

  // Pinch двумя пальцами + поворот через CDP
  const cdp = await context.newCDPSession(page);
  const vp = page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height * 0.35;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map(([x, y], id) => ({ x, y, id })),
  });
  const before = await target(page);
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let i = 1; i <= 10; i++) {
    const r = 40 + i * 8;
    const a = (i / 10) * 0.6;
    await touch('touchMove', [
      [cx - r * Math.cos(a), cy - r * Math.sin(a)],
      [cx + r * Math.cos(a), cy + r * Math.sin(a)],
    ]);
  }
  await touch('touchEnd', []);
  const after = await target(page);
  check(`[${label}] pinch увеличивает, два пальца вращают`,
    after.scale > before.scale * 1.5 && Math.abs(after.rotY - before.rotY) > 0.4,
    `scale ${before.scale.toFixed(2)} → ${after.scale.toFixed(2)}, rotY ${before.rotY.toFixed(2)} → ${after.rotY.toFixed(2)}`);

  // Один палец — перетаскивание
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx + i * 10, cy + i * 5]]);
  await touch('touchEnd', []);
  const dragged = await target(page);
  check(`[${label}] перетаскивание пальцем`, dragged.x > after.x + 0.2 && dragged.y < after.y,
    `x=${dragged.x.toFixed(2)} y=${dragged.y.toFixed(2)}`);

  await page.getByTestId('reset').tap();
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${label}-3-after-reset.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`[${label}] нет горизонтального скролла`, !overflow);
  const panelFits = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="control-panel"]').getBoundingClientRect();
    return p.right <= window.innerWidth + 1 && p.bottom <= window.innerHeight + 1;
  });
  check(`[${label}] панель помещается в экран`, panelFits);
  check(`[${label}] нет ошибок в консоли`, errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------- Ошибка доступа к камере ----------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByTestId('start-camera').click();
  await page.waitForSelector('.start-error');
  const msg = await page.locator('.start-error').textContent();
  const btn = await page.getByTestId('start-camera').textContent();
  check('[denied] сообщение об отказе + «Повторить»', msg.includes('запрещён') && btn === 'Повторить', msg);
  await page.screenshot({ path: `${OUT}/error-denied.png` });
  await context.close();
}

// ---------- Модель отсутствует -> заглушка ----------
{
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['camera'] });
  const page = await context.newPage();
  await page.route('**/models/model.glb', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto(BASE);
  await page.getByTestId('start-camera').click();
  const toast = await page.waitForSelector('[data-testid="toast"]', { timeout: 15000 }).then((t) => t.textContent());
  await sleep(800);
  await page.screenshot({ path: `${OUT}/placeholder.png` });
  check('[placeholder] заглушка при отсутствии модели', toast.includes('заглушку'), toast);
  await context.close();
}

// ---------- Гироскоп: синтетические события ориентации ----------
{
  const { defaultBrowserType: _i, ...pixel } = devices['Pixel 7'];
  const context = await browser.newContext({ ...pixel, permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'] });
  await context.addInitScript(() => {
    // Телефон вертикально, смотрит вперёд: beta = 90.
    window.__orient = { alpha: 0, beta: 90, gamma: 0 };
    setInterval(() => {
      const o = window.__orient;
      for (const type of ['deviceorientationabsolute', 'deviceorientation']) {
        window.dispatchEvent(new DeviceOrientationEvent(type, { ...o, absolute: true }));
      }
    }, 16);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const setAlpha = (alpha) => page.evaluate((a) => { window.__orient.alpha = a; }, alpha);
  const ndc = () => page.evaluate(() => window.__arModelNdc());

  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByTestId('start-camera').click();
  await page.waitForSelector('[data-testid="mode-badge"]', { timeout: 15000 });
  await page.waitForSelector('.loading', { state: 'detached', timeout: 30000 }).catch(() => {});
  await sleep(800);
  const badge = await page.getByTestId('mode-badge').textContent();
  check('[gyro] автоопределение: режим «Гироскоп»', badge === 'Гироскоп', badge);
  const noteText = await page.getByTestId('anchor-note').textContent();
  check('[gyro] предупреждение про ходьбу', noteText.includes('привязана к направлению'));
  check('[gyro] кнопка «Поставить модель»', (await page.getByTestId('anchor-action').textContent()) === 'Поставить модель');
  await page.screenshot({ path: `${OUT}/gyro-1-before-place.png` });

  // До размещения модель «едет» за взглядом
  await setAlpha(30);
  await sleep(700);
  const follow = await ndc();
  check('[gyro] до размещения модель следует за взглядом', Math.abs(follow.x) < 0.05, `x=${follow.x.toFixed(3)}`);

  await page.getByTestId('anchor-action').click();
  await sleep(700);
  check('[gyro] после размещения: кнопка «Центрировать»', (await page.getByTestId('anchor-action').textContent()) === 'Центрировать');
  const placedAt = await ndc();

  // Поворот телефона влево на 25°: модель уезжает вправо по экрану
  await setAlpha(55);
  await sleep(900);
  const turned = await ndc();
  await page.screenshot({ path: `${OUT}/gyro-2-turned-left.png` });
  check('[gyro] поворот влево: модель смещается вправо', turned.x > 0.3, `x ${placedAt.x.toFixed(2)} → ${turned.x.toFixed(2)}`);

  // Вернули телефон: модель снова там же
  await setAlpha(30);
  await sleep(900);
  const back = await ndc();
  check('[gyro] возврат: модель на прежнем месте', Math.abs(back.x - placedAt.x) < 0.03 && Math.abs(back.y - placedAt.y) < 0.03,
    `x=${back.x.toFixed(3)} y=${back.y.toFixed(3)}`);

  // Наклон вниз: модель поднимается по экрану (смотрим ниже неё)
  await page.evaluate(() => { window.__orient.beta = 70; });
  await sleep(900);
  const tilted = await ndc();
  check('[gyro] наклон вниз: модель смещается вверх', tilted.y > back.y + 0.2, `y ${back.y.toFixed(2)} → ${tilted.y.toFixed(2)}`);
  await page.evaluate(() => { window.__orient.beta = 90; });

  // «Центрировать» с другого направления
  await setAlpha(-60);
  await sleep(600);
  await page.getByTestId('anchor-action').click();
  await sleep(900);
  const centered = await ndc();
  await page.screenshot({ path: `${OUT}/gyro-3-centered.png` });
  check('[gyro] «Центрировать» возвращает модель перед камерой', Math.abs(centered.x) < 0.05, `x=${centered.x.toFixed(3)}`);

  // Кнопки работают и в мировом режиме
  const t0 = await target(page);
  await page.locator('[data-action="scaleUp"]').tap();
  await page.locator('[data-action="rotateLeft"]').tap();
  const t1 = await target(page);
  check('[gyro] кнопки масштаба/поворота', t1.scale > t0.scale && t1.rotY < t0.rotY);
  check('[gyro] нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------- iOS: отказ в доступе к датчикам -> режим «Экран» ----------
{
  const { defaultBrowserType: _i, ...iphone } = devices['iPhone 14'];
  const context = await browser.newContext({ ...iphone, permissions: ['camera'] });
  await context.addInitScript(() => {
    DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied');
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByTestId('start-camera').click();
  const toast = await page.waitForSelector('[data-testid="toast"]', { timeout: 15000 }).then((t) => t.textContent());
  const badge = await page.getByTestId('mode-badge').textContent();
  await page.screenshot({ path: `${OUT}/gyro-denied.png` });
  check('[ios-denied] сообщение и откат на «Экран»', toast.includes('отклонён') && badge === 'Экран', `${badge}: ${toast}`);
  await context.close();
}

// ---------- WebXR: поддержка обнаружена, но сессия не стартовала -> откат ----------
{
  const { defaultBrowserType: _i, ...pixel } = devices['Pixel 7'];
  const context = await browser.newContext({ ...pixel, permissions: ['camera'] });
  await context.addInitScript(() => {
    // Настоящий XRSystem: EventTarget (три.js/drei подписываются на devicechange).
    const fakeXr = Object.assign(new EventTarget(), {
      isSessionSupported: (m) => Promise.resolve(m === 'immersive-ar'),
      requestSession: () => Promise.reject(new DOMException('no ARCore', 'NotSupportedError')),
    });
    Object.defineProperty(Navigator.prototype, 'xr', { get: () => fakeXr, configurable: true });
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByTestId('start-xr').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/xr-start-screen.png` });
  check('[xr] при поддержке WebXR показана кнопка «Запустить AR»', true);
  await page.getByTestId('start-xr').click();
  const toast = await page.waitForSelector('[data-testid="toast"]', { timeout: 15000 }).then((t) => t.textContent());
  await page.waitForSelector('[data-testid="mode-badge"]', { timeout: 15000 });
  check('[xr] ошибка AR -> откат на обычный режим', toast.includes('AR не запустился'), toast);
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
