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
await browser.close();
srv.close();
if (errors.length) { console.log('errors:\n' + errors.join('\n')); process.exitCode = 1; }
