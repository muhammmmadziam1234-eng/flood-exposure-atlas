import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {startServer, launchBrowser, openPage, geojson, upload, point, waitForStatus, runAxe} from './helpers.mjs';

let server, browser;
const evidence = {tool: 'axe-core', axe: null, views: [], contrast: null, targets: null};
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => {
  await browser?.close();
  server?.stop();
  if (process.env.WRITE_EVIDENCE) {
    mkdirSync(new URL('../docs/evidence/', import.meta.url), {recursive: true});
    writeFileSync(new URL('../docs/evidence/accessibility.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  }
});
// axe-core is injected through the DevTools protocol, which the page's Content-Security-Policy does not govern.
async function open(t, options) {
  const app = await openPage(browser, server.url, options);
  t.after(() => app.close());
  return app;
}
async function axe(page, view, viewport) {
  const result = await runAxe(page);
  evidence.axe = result.version;
  evidence.views.push({view, viewport, violations: result.violations.length, rulesPassed: result.passes, needsReview: result.incomplete});
  assert.deepEqual(result.violations, [], view + ': ' + JSON.stringify(result.violations, null, 1));
}
const badFile = () => upload('bad.geojson', geojson([point('a', 79.7, 7.0), point('a', 79.7, 7.0), point('b', 300, 7), point('c', 1, 1, {name: ''})]));

test('axe-core finds no violation on the default view', async t => {
  const app = await open(t);
  await axe(app.page, 'default view', '1280x900');
});

test('axe-core finds no violation on the expanded scenario with a filter and a selection', async t => {
  const app = await open(t);
  await app.page.selectOption('#scenario', 'expanded');
  await app.page.selectOption('#filter', 'high');
  await app.page.click('#facilities .facility:nth-child(2)');
  await axe(app.page, 'expanded scenario, high filter, one facility selected', '1280x900');
});

test('axe-core finds no violation on the rejected-features panel', async t => {
  const app = await open(t);
  await app.page.setInputFiles('#file-facilities', badFile());
  await waitForStatus(app.page, 'Imported bad.geojson');
  assert.equal(await app.page.locator('#problems').isVisible(), true);
  await axe(app.page, 'rejected-features panel', '1280x900');
});

test('axe-core finds no violation at 360 px, with and without the rejected-features panel', async t => {
  const app = await open(t, {viewport: {width: 360, height: 800}});
  await axe(app.page, 'default view', '360x800');
  await app.page.setInputFiles('#file-facilities', badFile());
  await waitForStatus(app.page, 'Imported bad.geojson');
  await axe(app.page, 'rejected-features panel', '360x800');
});

test('every line of text has a contrast ratio of at least 4.5:1', async t => {
  for (const [viewport, label] of [[{width: 1280, height: 900}, '1280'], [{width: 360, height: 800}, '360']]) {
    const app = await open(t, {viewport});
    await app.page.setInputFiles('#file-facilities', badFile());
    await waitForStatus(app.page, 'Imported bad.geojson');
    await app.page.click('#reset-sample');
    await app.page.setInputFiles('#file-facilities', badFile());
    await waitForStatus(app.page, 'Imported bad.geojson');
    const measured = await app.page.evaluate(() => {
      const parse = css => { const [r, g, b, a = 1] = css.match(/[\d.]+/g).map(Number); return {r, g, b, a}; };
      const mix = (top, under) => ({r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1});
      const light = ({r, g, b}) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => { const [hi, lo] = [light(a), light(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      const backdrop = el => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a === 1) break; } }
        return layers.reverse().reduce((under, c) => mix(c, under), {r: 255, g: 255, b: 255, a: 1});
      };
      const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
      const rows = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement, text = node.textContent.trim();
        if (!text || !el || el.closest('svg, option, script, style, :disabled') || el.closest('[hidden]')) continue;
        const style = getComputedStyle(el), box = el.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.display === 'none' || box.width === 0 || box.height === 0) continue;
        const under = backdrop(el), fg = mix({...parse(style.color), a: parse(style.color).a * Number(style.opacity)}, under);
        rows.push({what: name(el) + ' "' + text.slice(0, 30) + '"', ratio: ratio(fg, under)});
      }
      for (const el of document.querySelectorAll('select, input[type=file]')) {
        if (el.disabled || el.getBoundingClientRect().width === 0) continue;
        const style = getComputedStyle(el), own = parse(style.backgroundColor);
        const under = own.a > 0 ? mix(own, backdrop(el.parentElement)) : backdrop(el);
        rows.push({what: name(el), ratio: ratio(parse(style.color), under)});
      }
      // Map labels sit on a halo (the stroke) or, for the water name, on the sea colour.
      const fillOf = el => { const h = el.getAttribute('fill'); return {r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1}; };
      const sea = fillOf(document.querySelector('#map rect'));
      for (const el of document.querySelectorAll('#map text')) {
        const style = getComputedStyle(el), halo = style.stroke === 'none' ? sea : parse(style.stroke);
        rows.push({what: 'map ' + name(el) + ' "' + el.textContent + '"', ratio: ratio(parse(style.fill), halo)});
      }
      return rows;
    });
    assert.ok(measured.length > 60, label + ': only ' + measured.length + ' text items measured');
    const worst = measured.sort((a, b) => a.ratio - b.ratio)[0];
    assert.ok(worst.ratio >= 4.5, label + ' px: lowest contrast ' + worst.ratio.toFixed(2) + ' on ' + worst.what);
    evidence.contrast = {...(evidence.contrast ?? {}), ['viewport_' + label]: {textItemsMeasured: measured.length, lowestRatio: Math.round(worst.ratio * 100) / 100, lowestIs: worst.what}};
  }
});

test('every control is at least 24 by 24 CSS pixels, at desktop and phone width', async t => {
  const measure = page => page.evaluate(() => [...document.querySelectorAll('button, select, input, a[href], [role=button], [tabindex="0"]')]
    .filter(el => !el.disabled && !el.hidden && el.getBoundingClientRect().width > 0)
    .map(el => { const r = el.getBoundingClientRect(); return {what: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(' ')[0], w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10}; }));
  for (const [viewport, label] of [[{width: 1280, height: 900}, '1280'], [{width: 360, height: 800}, '360']]) {
    const app = await open(t, {viewport});
    const sample = await measure(app.page);
    assert.ok(sample.length > 40, label + ': only ' + sample.length + ' controls found on the sample view');
    await app.page.setInputFiles('#file-facilities', badFile());
    await waitForStatus(app.page, 'Imported bad.geojson');
    const withPanel = await measure(app.page);
    assert.ok(withPanel.some(s => s.what.includes('problem-scroll')), 'the scrollable problems list is a control too');
    const sizes = [...sample, ...withPanel], small = sizes.filter(s => s.w < 24 || s.h < 24);
    assert.deepEqual(small, [], label + ' px: controls under 24 px');
    evidence.targets = {...(evidence.targets ?? {}), ['viewport_' + label]: {controlsMeasured: sizes.length, smallestWidth: Math.min(...sizes.map(s => s.w)), smallestHeight: Math.min(...sizes.map(s => s.h))}};
  }
});

test('motion is switched off when the system asks for reduced motion', async t => {
  const durations = page => page.evaluate(() => [...document.querySelectorAll('body *')].flatMap(el => {
    const s = getComputedStyle(el);
    return [s.transitionDuration, s.animationName === 'none' ? '0s' : s.animationDuration].flatMap(v => v.split(',').map(x => x.trim()));
  }).filter(v => v !== '0s'));
  const reduced = await open(t, {reducedMotion: 'reduce'});
  assert.deepEqual(await durations(reduced.page), [], 'no transition or animation under reduced motion');
  const normal = await open(t, {reducedMotion: 'no-preference'});
  assert.ok((await durations(normal.page)).length > 0, 'the test can see motion when it is allowed');
});

test('the filter summary is a polite live region that changes with the filter', async t => {
  const app = await open(t);
  assert.equal(await app.page.locator('#count').getAttribute('role'), 'status');
  assert.equal(await app.page.locator('#detail').getAttribute('aria-live'), 'polite');
  const before = await app.page.locator('#count').innerText();
  await app.page.selectOption('#filter', 'low');
  assert.notEqual(await app.page.locator('#count').innerText(), before);
  assert.equal(await app.page.locator('#count').innerText(), '3 of 16 facilities shown. Low exposure, baseline.');
});
