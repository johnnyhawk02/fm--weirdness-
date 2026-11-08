// Screenshots with the voice running: node tools/screenshots.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // pre-installed globally
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
const srv = await serve(8123);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
for (const [w, h] of [[1440, 900], [1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w}x${h}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${w}x${h}: ${e.message}`));
  await page.goto('http://localhost:8123/?fresh');
  await page.click('#start');
  await page.waitForTimeout(2600);
  const info = await page.evaluate(() => ({
    running: window.fmseq.ui.running, hasState: !!window.fmseq.ui.state,
    scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
    appH: document.getElementById('app').getBoundingClientRect().bottom,
  }));
  console.log(`${w}x${h}`, JSON.stringify(info));
  await page.screenshot({ path: `out/screenshot-${w}x${h}.png` });
  await page.close();
}
// phone: Pixel 9a portrait, 412 x 915 css px screen; Chrome shows about 412 x 780 of it
for (const tab of ['A', 'voice', 'lfo', 'rnd']) {
  const page = await browser.newPage({ viewport: { width: 412, height: 780 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await page.goto('http://localhost:8123/?fresh');
  await page.tap(`#tabs [data-tab="${tab}"]`);
  await page.tap('#start');
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const over = [...document.querySelectorAll('#app *')].filter((n) => {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || n.offsetParent === null) return false;
      const box = n.closest('.op, .panel, #top');
      const b = box && box !== n ? box.getBoundingClientRect() : null;
      return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || (b && (r.bottom > b.bottom + 1 || r.right > b.right + 1));
    }).map((n) => n.className || n.tagName).slice(0, 5);
    return { running: window.fmseq.ui.running, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, over };
  });
  console.log(`pixel9a ${tab}`, JSON.stringify(info));
  if (info.scrollW > 412 || info.scrollH > 780 || info.over.length) errors.push(`phone ${tab}: does not fit ${JSON.stringify(info)}`);
  await page.screenshot({ path: `out/screenshot-pixel9a-${tab}.png` });
  await page.close();
}
await browser.close();
srv.close();
if (errors.length) { console.log('errors:\n' + errors.join('\n')); process.exitCode = 1; }
