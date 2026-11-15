#!/usr/bin/env python3
"""Show that validation/crosscheck.py can fail: break geo.mjs in known ways and check each break is caught.

Each mutant is a one-line change applied to a scratch copy of geo.mjs (the real file is never touched). The
cross-check is run against the copy on a reduced case set. A mutant that survives (0 disagreements) is a gap in
the check, and the script exits 1. Writes docs/evidence/crosscheck-mutants.json.

Usage: python validation/mutants.py            (needs the same setup as crosscheck.py)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MUTANTS = [
    ('boundary points not covered', "return loc === 'edge' || (loc === 'inside'", "return (loc === 'inside'"),
    ('holes ignored', "!holes.some(hole => ringLocation(point, hole) === 'inside')", 'true'),
    ('only the first part of a MultiPolygon is tested', 'polygons.some(([outer', 'polygons.slice(0, 1).some(([outer'),
    ('edge test ignores the segment bounds', 'x >= Math.min(a, c) && x <= Math.max(a, c) && y >= Math.min(b, d) && y <= Math.max(b, d)', 'true'),
    ('grid leaves out the last column of cells', 'for (let x = west; x <= east; x++)', 'for (let x = west; x < east; x++)'),
    ('edge tolerance widened to 1e-3', '< 1e-12', '< 1e-3'),
]


def main():
    source = (ROOT / 'geo.mjs').read_text()
    results = []
    for name, old, new in MUTANTS:
        if source.count(old) != 1:
            sys.exit('mutant "%s": expected exactly one match of %r in geo.mjs, found %d' % (name, old, source.count(old)))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'validation').mkdir()
            (tmp / 'geo.mjs').write_text(source.replace(old, new))
            shutil.copy(ROOT / 'validation' / 'classify.mjs', tmp / 'validation' / 'classify.mjs')
            out = tmp / 'out.json'
            subprocess.run([sys.executable, str(ROOT / 'validation' / 'crosscheck.py'), '--root', str(tmp), '--out', str(out),
                            '--scale', '0.1', '--min-pairs', '0'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            report = json.loads(out.read_text())
        results.append({'mutant': name, 'change': '%s  ->  %s' % (old, new), 'pairs': report['pairs'],
                        'disagreements': report['disagreements'], 'caught': report['disagreements'] > 0})
        print('%-45s %s (%d disagreements in %d pairs)' % (name, 'caught' if results[-1]['caught'] else 'SURVIVED',
                                                         report['disagreements'], report['pairs']))
    evidence = ROOT / 'docs' / 'evidence' / 'crosscheck-mutants.json'
    evidence.write_text(json.dumps({'script': 'validation/mutants.py', 'cases_scale': 0.1, 'mutants': results}, indent=2) + '\n')
    if not all(r['caught'] for r in results):
        sys.exit('FAIL: at least one mutant survived.')


if __name__ == '__main__':
    main()
