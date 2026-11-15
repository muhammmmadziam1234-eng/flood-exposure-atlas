// Runs the unit tests with Node's built-in coverage and fails when geo.mjs or validate.mjs has under 90% line coverage.
//   node scripts/coverage.mjs           check the gate
//   node scripts/coverage.mjs --write   also record the report in docs/evidence/coverage.txt
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const FILES = ['geo.mjs', 'validate.mjs'], MIN_LINES = 90;
const root = fileURLToPath(new URL('..', import.meta.url));
const run = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--experimental-test-coverage',
  ...FILES.map(file => '--test-coverage-include=' + file), 'test/*.test.mjs'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: {...process.env, COVERAGE_RUN: '1'}});
const lines = (run.stdout + run.stderr).split('\n').map(line => line.replace(/^[^\w-]+/, '').trimEnd());
if (run.status !== 0) {
  console.error(lines.slice(-40).join('\n'));
  console.error('The unit tests failed, so there is no coverage result.');
  process.exit(1);
}
const start = lines.findIndex(line => line === 'start of coverage report'), end = lines.findIndex(line => line === 'end of coverage report');
if (start < 0 || end < 0) { console.error('No coverage report in the test output.'); process.exit(1); }
const table = lines.slice(start + 1, end);
let failed = false;
for (const file of FILES) {
  const row = table.find(line => line.startsWith(file + ' '));
  const percent = row ? Number(row.split('|')[1]) : NaN;
  const ok = percent >= MIN_LINES;
  console.log((ok ? 'ok   ' : 'FAIL ') + file + ': ' + percent + '% of lines (need ' + MIN_LINES + '%)');
  failed ||= !ok;
}
if (process.argv.includes('--write')) {
  const out = new URL('../docs/evidence/coverage.txt', import.meta.url);
  mkdirSync(new URL('.', out), {recursive: true});
  writeFileSync(out, ['Unit-test coverage from Node\'s built-in test runner (node --test --experimental-test-coverage).',
    'Recorded with: npm run test:coverage -- --write', 'Node ' + process.version,
    'Gate: line coverage of geo.mjs and validate.mjs must each be at least ' + MIN_LINES + '%.', '', ...table, ''].join('\n'));
  console.log('Wrote docs/evidence/coverage.txt');
}
process.exit(failed ? 1 : 0);
