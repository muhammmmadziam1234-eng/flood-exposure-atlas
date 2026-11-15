import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startServer, launchBrowser, openPage, geojson, upload, point, square, zone, waitForStatus, listRows, horizontalOverflow} from './helpers.mjs';

let server, browser;
before(async () => { server = await startServer(); browser = await launchBrowser(); });
after(async () => { await browser?.close(); server?.stop(); });

async function open(t, options) {
  const app = await openPage(browser, server.url, options);
  t.after(() => app.close());
  return app;
}
async function download(page, button) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.click(button)]);
  return {name: file.suggestedFilename(), text: await readFile(await file.path(), 'utf8')};
}
const text = (page, selector) => page.locator(selector).innerText();
const rowText = (page, n) => page.locator('#problem-rows tr:nth-child(' + n + ')').evaluate(r => [...r.children].map(c => c.innerText).join(' | '));

// A small scenario with known answers: a square zone with a hole, and a separate low-level island.
const zonesFile = () => geojson([
  zone('Test zone', 'high', 'Polygon', [square(0, 0, 10, 10), square(4, 4, 6, 6)]),
  zone('Island', 'low', 'MultiPolygon', [[square(20, 0, 22, 2)]])
]);
const facilitiesFile = () => geojson([
  point('A', 2, 2), point('B', 5, 5), point('C', 4, 5), point('D', 10, 10), point('E', 21, 1), point('F', 50, 50)
]);

test('the sample scenario draws without errors, makes no outside request and needs no worker', async t => {
  const app = await open(t);
  assert.equal(await app.page.locator('#facilities .facility').count(), 16);
  assert.equal(await app.page.locator('#markers .marker').count(), 16);
  assert.match(await text(app.page, '#count'), /^16 of 16 facilities shown\. All exposure levels, baseline\.$/);
  assert.deepEqual(app.problems, []);
  assert.ok(app.requests.every(url => url.startsWith(server.url)), app.requests.join('\n'));
  assert.equal(app.workers.length, 0, 'the sample is analysed on the main thread');
});

test('the sample still draws when workers are unavailable', async t => {
  const app = await open(t, {beforeLoad: page => page.addInitScript(() => { window.Worker = class { constructor() { throw new Error('no workers here'); } }; })});
  assert.equal(await app.page.locator('#facilities .facility').count(), 16);
  assert.deepEqual(app.problems, []);
  await app.page.setInputFiles('#file-zones', upload('zones.geojson', zonesFile()));
  await waitForStatus(app.page, 'could not start');
  assert.equal(await app.page.locator('#facilities .facility').count(), 16, 'the sample stays on screen');
});

test('filter, scenario and selection are kept in the URL hash and restored', async t => {
  const app = await open(t), page = app.page;
  const scrollBefore = await page.evaluate(() => [scrollY, history.length]);
  await page.selectOption('#filter', 'high');
  assert.equal(await page.evaluate(() => location.hash), '#level=high');
  await page.selectOption('#scenario', 'expanded');
  assert.equal(await page.evaluate(() => location.hash), '#scenario=expanded&level=high');
  assert.equal(await text(page, '#count'), '3 of 16 facilities shown. High exposure, expanded extent.');
  await page.click('#facilities .facility:nth-child(2)');
  const hash = await page.evaluate(() => location.hash);
  assert.match(hash, /^#scenario=expanded&level=high&site=S\d\d$/);
  assert.deepEqual(await page.evaluate(() => [scrollY, history.length]), scrollBefore, 'no page jump and no new history entries');

  const second = await open(t);
  await second.page.goto(server.url + hash);
  assert.equal(await text(second.page, '#count'), '3 of 16 facilities shown. High exposure, expanded extent.');
  assert.equal(await second.page.locator('#scenario').inputValue(), 'expanded');
  assert.equal(await second.page.locator('#filter').inputValue(), 'high');
  assert.equal(await second.page.locator('#facilities .facility[aria-pressed=true]').getAttribute('data-site'), hash.split('site=')[1]);

  await second.page.goto(server.url + '#scenario=expanded&level=high&site=S04');
  assert.equal(await text(second.page, '#detail h3'), 'Alder Primary School');
  await second.page.evaluate(() => { location.hash = '#level=low'; });
  assert.match(await text(second.page, '#count'), /^3 of 16 facilities shown\. Low exposure, baseline\.$/);
});

test('a damaged or hostile hash falls back to the defaults and is cleaned up', async t => {
  const app = await open(t);
  await app.page.goto(server.url + '#scenario=%3Cscript%3E&level=extreme&site=nope');
  assert.match(await text(app.page, '#count'), /^16 of 16 facilities shown\./);
  assert.equal(await app.page.locator('#facilities .facility[aria-pressed=true] strong').innerText(), 'Harbour Clinic');
  assert.equal(await app.page.evaluate(() => location.hash), '');
  assert.deepEqual(app.problems, []);
});

test('imported zones and facilities are checked, analysed in a worker and exported', async t => {
  const app = await open(t), page = app.page;
  await page.setInputFiles('#file-zones', upload('zones.geojson', zonesFile()));
  await waitForStatus(page, 'Imported zones.geojson');
  assert.equal(app.workers.length >= 1, true, 'the analysis ran in a worker');
  assert.equal(await page.locator('#scenario').isDisabled(), true);
  assert.equal(await text(page, '#source-badge'), 'Sample facilities, imported zones');
  await page.setInputFiles('#file-facilities', upload('facilities.geojson', facilitiesFile()));
  await waitForStatus(page, 'Imported facilities.geojson');
  assert.equal(await text(page, '#source-badge'), 'Imported facilities and zones');
  assert.match(await text(page, '#import-status'), /Facilities: 6 of 6 features accepted\. 6 facilities analysed in \d+ ms\./);
  assert.deepEqual(await listRows(page), [['Facility A', 'High'], ['Facility B', 'Outside'], ['Facility C', 'High'], ['Facility D', 'High'], ['Facility E', 'Low'], ['Facility F', 'Outside']]);
  assert.equal(await page.locator('#markers .marker').count(), 6);
  assert.equal(await page.locator('#map-zones path').count(), 2);
  assert.match(await text(page, '#map-note'), /fitted to the data: longitude 0\.0000 to 50\.0000, latitude 0\.0000 to 50\.0000/);
  assert.equal(await text(page, '#comparison-title'), 'Exposure counts');
  assert.equal(await page.locator('#changes').innerText(), '');
  assert.deepEqual(await page.locator('#counts tbody tr').evaluateAll(rows => rows.map(r => r.innerText.replace(/\s+/g, ' '))),
    ['High 3', 'Moderate 0', 'Low 1', 'Outside 2', 'All facilities 6']);

  const csv = await download(page, '#export-csv');
  assert.equal(csv.name, 'exposure-results.csv');
  assert.equal(csv.text, ['id,name,category,lon,lat,exposure,baseline_exposure,change,matched_zones',
    'A,Facility A,Test,2,2,high,,,Test zone', 'B,Facility B,Test,5,5,outside,,,', 'C,Facility C,Test,4,5,high,,,Test zone',
    'D,Facility D,Test,10,10,high,,,Test zone', 'E,Facility E,Test,21,1,low,,,Island', 'F,Facility F,Test,50,50,outside,,,', ''].join('\r\n'));
  await page.selectOption('#filter', 'low');
  const json = JSON.parse((await download(page, '#export')).text);
  assert.deepEqual(json.features.map(f => [f.properties.id, f.properties.exposure, f.properties.matchedZones]), [['E', 'low', ['Island']]]);
  assert.deepEqual(app.problems, []);
});

test('a bad file lists every rejected feature and leaves the current data alone', async t => {
  const app = await open(t), page = app.page;
  const features = [point('ok1', 79.7, 7.0), point('ok1', 79.7, 7.0), point('bad-lon', 200, 7), point('no-name', 79.7, 7, {name: ''}),
    {type: 'Feature', geometry: {type: 'Polygon', coordinates: [square(0, 0, 1, 1)]}, properties: {id: 'poly', name: 'x', category: 'x'}},
    point('ok2', 79.71, 7.01, {name: '<img src=x onerror="window.pwned=1">'})];
  await page.setInputFiles('#file-facilities', upload('mixed.geojson', geojson(features)));
  await waitForStatus(page, 'Imported mixed.geojson');
  assert.match(await text(page, '#import-status'), /Facilities: 2 of 6 features accepted, 4 rejected\./);
  assert.equal(await page.locator('#problems').isVisible(), true);
  assert.deepEqual(await page.locator('#problem-rows tr').evaluateAll(rows => rows.map(r => [...r.children].slice(0, 3).map(c => c.innerText).join(' | '))),
    ['Facilities | 1 | properties.id', 'Facilities | 2 | geometry.coordinates[0]', 'Facilities | 3 | properties.name', 'Facilities | 4 | geometry.type']);
  assert.match(await text(page, '#problem-rows tr:nth-child(1)'), /Duplicate id "ok1" \(first used by feature 0\)/);
  assert.match(await text(page, '#problems-summary'), /Facilities: 4 of 6 features rejected\./);
  assert.deepEqual((await listRows(page)).map(r => r[0]), ['Facility ok1', '<img src=x onerror="window.pwned=1">'], 'hostile text is shown as text');
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('#facilities img').count(), 0);

  await page.setInputFiles('#file-zones', upload('nothing.geojson', geojson([zone('Z', 'severe', 'Polygon', [square(0, 0, 1, 1)])])));
  await waitForStatus(page, 'Nothing was imported from nothing.geojson');
  assert.match(await rowText(page, 1), /^Zones \| 0 \| properties\.level \| Must be one of low, moderate, high \(found "severe"\)\.$/);
  assert.equal((await listRows(page)).length, 2, 'the facilities from before are still shown');
  await page.setInputFiles('#file-zones', upload('broken.geojson', '{"type": "FeatureCollection", "features": ['));
  await waitForStatus(page, 'Nothing was imported from broken.geojson');
  assert.match(await rowText(page, 1), /^Zones \| whole file \| \(file\) \| Not valid JSON/);
  const workersBefore = app.workers.length;
  await page.setInputFiles('#file-zones', {name: 'huge.geojson', mimeType: 'application/geo+json', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32)});
  await waitForStatus(page, 'Nothing was imported from huge.geojson');
  assert.match(await rowText(page, 1), /^Zones \| whole file \| \(file\) \| The file is 5\.0 MB; the limit is 5 MB\./);
  assert.equal(app.workers.length, workersBefore, 'the oversize file was refused before any worker started for it');

  await page.click('#reset-sample');
  assert.equal((await listRows(page)).length, 16);
  assert.equal(await page.locator('#problems').isVisible(), false);
  assert.equal(await text(page, '#source-badge'), 'Fictional study area');
  assert.equal(await page.locator('#scenario').isDisabled(), false);
});

test('dropping a file on a layer imports it', async t => {
  const app = await open(t), page = app.page;
  const dataTransfer = await page.evaluateHandle(content => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], 'dropped.geojson', {type: 'application/geo+json'}));
    return transfer;
  }, facilitiesFile());
  await page.dispatchEvent('#drop-facilities', 'dragover', {dataTransfer});
  assert.equal(await page.locator('#drop-facilities').evaluate(e => e.classList.contains('over')), true);
  await page.dispatchEvent('#drop-facilities', 'drop', {dataTransfer});
  await waitForStatus(page, 'Imported dropped.geojson');
  assert.equal((await listRows(page)).length, 6);
  assert.equal(await page.locator('#drop-facilities').evaluate(e => e.classList.contains('over')), false);
  assert.equal(await text(page, '#source-badge'), 'Imported facilities, sample zones');
  assert.equal(await page.locator('#scenario').isDisabled(), false, 'sample zones keep both scenarios');
  assert.equal(await page.locator('#changes').innerText() !== '', true, 'and the comparison');
});

test('a long analysis shows progress, leaves the page responsive and can be cancelled', async t => {
  const app = await open(t), page = app.page;
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const facilities = geojson(Array.from({length: 20000}, (_, i) => point('P' + i, 79.65 + random() * 0.1, 6.95 + random() * 0.1)));
  await page.setInputFiles('#file-facilities', upload('many.geojson', facilities));
  await waitForStatus(page, 'Imported many.geojson');
  assert.match(await text(page, '#count'), /^20,000 of 20,000 facilities shown\..*list shows the first 200/);
  assert.equal(await page.locator('#facilities .facility').count(), 200);
  assert.equal(await page.locator('#markers .marker').count(), 1000);

  const ring = Array.from({length: 190000}, (_, i) => [+(79.7 + 0.2 * Math.cos(i / 190000 * 2 * Math.PI)).toFixed(7), +(7 + 0.2 * Math.sin(i / 190000 * 2 * Math.PI)).toFixed(7)]);
  ring.push(ring[0]);
  await page.setInputFiles('#file-zones', upload('detailed.geojson', geojson([zone('Detailed', 'high', 'Polygon', [ring])])));
  await page.waitForSelector('#run:not([hidden])');
  await page.waitForFunction(() => document.getElementById('progress').value > 0, null, {timeout: 20000});
  assert.match(await text(page, '#run-text'), /^Analysing… \d+%$/);
  await page.selectOption('#filter', 'outside');
  assert.match(await text(page, '#count'), /^\d[\d,]* of 20,000 facilities shown\. Outside exposure/, 'the page answers while the worker is busy');
  await page.click('#cancel');
  await page.waitForSelector('#run', {state: 'hidden'});
  assert.equal(await text(page, '#import-status'), 'Analysis cancelled. The previous data is still shown.');
  assert.equal(await page.locator('#source-badge').innerText(), 'Imported facilities, sample zones');
  assert.equal(await page.locator('#file-zones').isDisabled(), false);
  assert.deepEqual(app.problems, []);
});

test('arrow keys move through the list and the map, Enter and Space select, focus is visible', async t => {
  const app = await open(t), page = app.page;
  assert.equal(await page.locator('#facilities .facility[tabindex="0"]').count(), 1, 'the list is one tab stop');
  assert.equal(await page.locator('#markers .marker[tabindex="0"]').count(), 1, 'the map is one tab stop');
  const active = () => page.evaluate(() => document.activeElement.dataset.site);
  await page.focus('#facilities .facility[aria-pressed=true]');
  await page.keyboard.press('ArrowDown');
  assert.equal(await active(), 'S02');
  assert.equal(await page.locator('#facilities .facility[tabindex="0"]').getAttribute('data-site'), 'S02', 'the tab stop moves with the focus');
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth)]; });
  assert.deepEqual(ring, ['solid', 3], 'a visible focus ring');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#facilities .facility[aria-pressed=true]').getAttribute('data-site'), 'S02');
  assert.equal(await active(), 'S02', 'focus stays on the row after selecting');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#facilities .facility[aria-pressed=true]').getAttribute('data-site'), 'S03');
  await page.keyboard.press('End');
  assert.equal(await active(), 'S16');
  await page.keyboard.press('Home');
  assert.equal(await active(), 'S01');

  assert.equal(await page.locator('.marker').first().getAttribute('aria-label'), 'Harbour Clinic, Health, High exposure');
  assert.equal(await page.locator('.marker[data-site=S07]').getAttribute('aria-label'), 'Westgate School, Education, outside all modeled zones');
  await page.focus('#markers .marker[aria-pressed=true]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await active(), 'S04');
  const markerRing = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [s.outlineStyle, parseFloat(s.outlineWidth), s.boxShadow !== 'none']; });
  assert.deepEqual(markerRing, ['solid', 3, true]);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#facilities .facility[aria-pressed=true]').getAttribute('data-site'), 'S04', 'selecting on the map selects in the list');
  assert.equal(await text(page, '#detail h3'), 'Alder Primary School');
  assert.equal(await page.evaluate(() => location.hash), '#site=S04');
});

test('exports follow the filter and scenario, and keep the comparison fields', async t => {
  const app = await open(t), page = app.page;
  const everything = await download(page, '#export-csv');
  assert.equal(everything.name, 'alder-coast-exposure.csv');
  const lines = everything.text.split('\r\n');
  assert.equal(lines.length, 18);
  assert.match(lines[1], /^S01,Harbour Clinic,Health,79\.\d+,7\.\d+,high,,,Lower Alder floodway; River overflow corridor; Estuary floodplain$/);
  await page.selectOption('#scenario', 'expanded');
  await page.selectOption('#filter', 'high');
  const csv = (await download(page, '#export-csv')).text.split('\r\n');
  assert.equal(csv.length, 3 + 2 - 1 + 1 - 1 + 1, 'header, three rows and the closing line end');
  assert.match(csv[1], /^S\d\d,[^,]+,[^,]+,79\.\d+,7\.\d+,high,(low|moderate|high|outside),-?\d,/);
  const geo = await download(page, '#export');
  assert.equal(geo.name, 'alder-coast-exposure.geojson');
  const features = JSON.parse(geo.text).features;
  assert.equal(features.length, 3);
  assert.ok(features.every(f => f.properties.exposure === 'high' && f.properties.baselineExposure && typeof f.properties.exposureChange === 'number'));
  assert.match(await text(page, '#scenario-note'), /^2 of 16 facilities change exposure from baseline\.$/);
  assert.deepEqual(await page.locator('#changes tbody tr').evaluateAll(rows => rows.map(r => r.innerText.replace(/\s+/g, ' '))),
    ['West Pier Depot Low to Moderate +1', 'Estuary Pump Station High to Moderate -1']);
  assert.deepEqual(await page.locator('#counts tbody tr').evaluateAll(rows => rows.map(r => r.innerText.replace(/\s+/g, ' '))),
    ['High 4 3 -1', 'Moderate 3 5 +2', 'Low 3 2 -1', 'Outside 6 6 0', 'All facilities 16 16 0']);
});

test('a spreadsheet cannot be tricked into running an imported name as a formula', async t => {
  const app = await open(t), page = app.page;
  await page.setInputFiles('#file-facilities', upload('evil.geojson', geojson([point('=1+1', 79.7, 7.0, {name: '=HYPERLINK("http://example.invalid","x")', category: '@SUM(1)'})])));
  await waitForStatus(page, 'Imported evil.geojson');
  const csv = (await download(page, '#export-csv')).text.split('\r\n')[1];
  assert.equal(csv, `'=1+1,"'=HYPERLINK(""http://example.invalid"",""x"")",'@SUM(1),79.7,7,outside,,,`);
});

test('at 360 px wide nothing needs sideways scrolling, in every state of the page', async t => {
  const app = await open(t, {viewport: {width: 360, height: 800}}), page = app.page;
  const check = async label => { const o = await horizontalOverflow(page); assert.ok(o.scrollWidth <= o.clientWidth && o.offenders.length === 0, label + ' ' + JSON.stringify(o)); };
  await check('default');
  await page.selectOption('#scenario', 'expanded');
  await page.selectOption('#filter', 'moderate');
  await check('expanded and filtered');
  await page.setInputFiles('#file-facilities', upload('mixed.geojson', geojson([point('a', 200, 0), point('b', 0, 0, {name: 'N'.repeat(200)}), point('c', 5, 5, {id: 'long-id-'.repeat(25)})])));
  await waitForStatus(page, 'Imported mixed.geojson');
  assert.equal(await page.locator('#problems').isVisible(), true);
  await check('problems panel');
  await page.click('#reset-sample');
  await check('after reset');
  assert.deepEqual(app.problems, []);
});
