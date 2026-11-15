// Shared plumbing for the browser tests: a server on a free port, Chromium from CHROME_PATH, and a few builders.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root = process.env.E2E_ROOT || fileURLToPath(new URL('..', import.meta.url));

export async function startServer() {
  const child = spawn(process.execPath, [join(root, 'serve.mjs')], {env: {...process.env, PORT: '0'}, stdio: ['ignore', 'pipe', 'inherit']});
  let output = '';
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = output.match(/127\.0\.0\.1:(\d+)/);
    if (match) return {url: 'http://127.0.0.1:' + match[1] + '/', stop: () => child.kill()};
  }
  throw new Error('The server stopped before it began listening.');
}

export function launchBrowser() {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) throw new Error('Set CHROME_PATH to a Chromium or Chrome executable, for example: CHROME_PATH=/usr/bin/google-chrome npm run e2e');
  return chromium.launch({executablePath, args: ['--no-sandbox']});
}

/** Opens the app in a fresh context and records console problems, requests and workers. */
export async function openPage(browser, url, {viewport = {width: 1280, height: 900}, reducedMotion = 'no-preference', bypassCSP = false, beforeLoad} = {}) {
  const context = await browser.newContext({viewport, reducedMotion, bypassCSP, acceptDownloads: true});
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT || 30000));
  const seen = {problems: [], requests: [], workers: []};
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') seen.problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => seen.problems.push('pageerror: ' + e.message));
  page.on('request', r => seen.requests.push(r.url()));
  page.on('worker', w => seen.workers.push(w.url()));
  if (beforeLoad) await beforeLoad(page);
  await page.goto(url);
  await page.waitForSelector('.facility');
  return {page, ...seen, close: () => context.close()};
}

export const geojson = features => JSON.stringify({type: 'FeatureCollection', features});
export const upload = (name, text) => ({name, mimeType: 'application/geo+json', buffer: Buffer.from(text)});
export const point = (id, lon, lat, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]},
  properties: {id, name: 'Facility ' + id, category: 'Test', ...extra}});
export const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
export const zone = (name, level, type, coordinates) => ({type: 'Feature', geometry: {type, coordinates}, properties: {name, level}});

/** Waits until the import status line shows text containing `text`. */
export const waitForStatus = (page, text, timeout = 20000) =>
  page.waitForFunction(t => document.getElementById('import-status').textContent.includes(t), text, {timeout});

/** Rows of the facility list as [name, level label]. */
export const listRows = page => page.locator('#facilities .facility').evaluateAll(rows =>
  rows.map(r => [r.querySelector('strong').textContent, r.querySelector('.level').textContent]));

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
/** Runs axe-core (every default rule) on the current page. */
export async function runAxe(page) {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const r = await window.axe.run(document);
    return {
      version: window.axe.version,
      violations: r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.map(n => n.target.join(' ') + ' | ' + (n.failureSummary || '').replace(/\s+/g, ' '))})),
      passes: r.passes.length, incomplete: r.incomplete.map(i => i.id), inapplicable: r.inapplicable.length
    };
  });
}

/** True when the page needs no sideways scrolling; otherwise lists the elements that stick out. */
export function horizontalOverflow(page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > limit + 0.5 || r.left < -0.5) && !e.closest('.problem-scroll, .list, svg');
    }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right));
    return {scrollWidth: document.documentElement.scrollWidth, clientWidth: limit, offenders};
  });
}
