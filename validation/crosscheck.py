#!/usr/bin/env python3
"""Cross-check the JavaScript point-in-polygon engine (geo.mjs) against Shapely.

Seeded random polygons are generated here (convex, concave, with holes, multipolygons, on an integer grid so
boundary cases are exact; plus float polygons at longitude/latitude scale). Every case and its test points go to
validation/classify.mjs, which classifies them with the real engine. Shapely's `covers` (boundary counts as
covered, holes do not) is the reference. The result is written to docs/evidence/crosscheck.json and the exit
status is 1 if there is any disagreement or fewer pairs than --min-pairs.

Usage: python validation/crosscheck.py [--seed N] [--out FILE] [--min-pairs N] [--scale X] [--root DIR]
Needs Python 3.12 and `pip install -r validation/requirements.txt`, and `node` on PATH (or set NODE).
"""
import argparse
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import MultiPoint, MultiPolygon, Polygon, box, mapping

ROOT = Path(__file__).resolve().parent.parent
PATHS = ('contains', 'analyze', 'grid')
FLOAT_MARGIN = 1e-7  # float-case points stay at least this far (degrees, about 1 cm) from every boundary


class Gen:
    """Seeded generator. Only random() is used, so the same seed gives the same cases on any Python 3."""

    def __init__(self, seed):
        self.rng = random.Random(seed)

    def r(self):
        return self.rng.random()

    def ri(self, lo, hi):
        return lo + int(self.r() * (hi - lo + 1))


def convex(g, cx, cy, span):
    for _ in range(100):
        pts = [(g.ri(cx - span, cx + span), g.ri(cy - span, cy + span)) for _ in range(g.ri(3, 9))]
        hull = MultiPoint(pts).convex_hull
        if hull.geom_type == 'Polygon' and hull.area > 0:
            return hull
    return box(cx - span, cy - span, cx + span, cy + span)


def star(g, cx, cy, span):
    for _ in range(200):
        n = g.ri(5, 10)
        pts = []
        for k in range(n):
            angle = (k + g.r() * 0.8) / n * 2 * math.pi
            radius = 1 + g.r() * (span - 1)
            pts.append((cx + round(radius * math.cos(angle)), cy + round(radius * math.sin(angle))))
        poly = Polygon(pts)
        if len(set(pts)) == n and poly.is_valid and poly.area > 0:
            return poly
    return convex(g, cx, cy, span)


def holed(g, cx, cy, span):
    shell = convex(g, cx, cy, span) if g.r() < 0.5 else star(g, cx, cy, span)
    holes = []
    for _ in range(g.ri(1, 3)):
        for _ in range(30):  # holes may touch the shell or each other at a point; Shapely decides validity
            hole = convex(g, g.ri(cx - span, cx + span), g.ri(cy - span, cy + span), g.ri(1, 2))
            candidate = Polygon(shell.exterior.coords, [h.exterior.coords for h in holes + [hole]])
            if candidate.is_valid:
                holes.append(hole)
                break
    poly = Polygon(shell.exterior.coords, [h.exterior.coords for h in holes])
    return poly if holes and poly.is_valid else None


def multi(g, cx, cy, span):
    for _ in range(50):
        parts = []
        for k in range(g.ri(2, 3)):
            maker = (holed, convex, star)[g.ri(0, 2)]
            part = maker(g, cx + k * (2 * span + g.ri(0, 1)), cy + g.ri(-1, 1), span)
            if part is not None:
                parts.append(part)
        if len(parts) >= 2:
            geom = MultiPolygon(parts)
            if geom.is_valid:
                return geom
    return None


def float_zone(g):
    cx, cy = 79.7 + g.r() * 0.05, 7.0 + g.r() * 0.05
    scale = 0.002 + g.r() * 0.02

    def blob(ox, oy):
        for _ in range(100):
            n = g.ri(6, 14)
            angles = sorted(g.r() * 2 * math.pi for _ in range(n))
            pts = [(ox + math.cos(a) * scale * (0.3 + g.r()), oy + math.sin(a) * scale * (0.3 + g.r())) for a in angles]
            poly = Polygon(pts)
            if poly.is_valid and poly.area > 0:
                return poly
        return box(ox - scale, oy - scale, ox + scale, oy + scale)

    shell = blob(cx, cy)
    if g.r() < 0.4:
        hole = shell.centroid.buffer(0.15 * math.sqrt(shell.area), quad_segs=3)
        with_hole = Polygon(shell.exterior.coords, [hole.exterior.coords])
        if with_hole.is_valid and hole.area > 0:
            shell = with_hole
    if g.r() < 0.2:
        both = MultiPolygon([shell, blob(cx + 3 * scale, cy + 0.5 * scale)])
        if both.is_valid:
            return both
    return shell


def grid_points(geom):
    minx, miny, maxx, maxy = geom.bounds
    xs = np.arange(math.floor(minx) - 1, math.ceil(maxx) + 1.5, 0.5)
    ys = np.arange(math.floor(miny) - 1, math.ceil(maxy) + 1.5, 0.5)
    gx, gy = np.meshgrid(xs, ys)
    return np.column_stack([gx.ravel(), gy.ravel()])


def float_points(g, geom):
    minx, miny, maxx, maxy = geom.bounds
    padx, pady = (maxx - minx) * 0.25, (maxy - miny) * 0.25
    pts = [(minx - padx + g.r() * (maxx - minx + 2 * padx), miny - pady + g.r() * (maxy - miny + 2 * pady)) for _ in range(70)]
    boundary = geom.boundary
    for _ in range(70):  # points a hair away from an edge are the hard ones for ray casting
        b = boundary.interpolate(g.r(), normalized=True)
        distance = 10 ** (-7 + 3 * g.r())
        angle = g.r() * 2 * math.pi
        pts.append((b.x + distance * math.cos(angle), b.y + distance * math.sin(angle)))
    arr = np.array(pts)
    keep = shapely.distance(boundary, shapely.points(arr)) >= FLOAT_MARGIN
    return arr[keep]


def build_cases(seed, scale):
    g = Gen(seed)
    plan = [('convex', 400), ('concave', 400), ('holes', 400), ('multi', 300), ('float', 300)]
    cases = []
    for kind, count in plan:
        made = 0
        while made < max(1, round(count * scale)):
            span = g.ri(3, 6)
            cx, cy = g.ri(span + 1, span + 4), g.ri(span + 1, span + 4)
            if kind == 'convex':
                geom = convex(g, cx, cy, span)
            elif kind == 'concave':
                geom = star(g, cx, cy, span)
            elif kind == 'holes':
                geom = holed(g, cx, cy, span)
            elif kind == 'multi':
                geom = multi(g, cx, cy, span)
            else:
                geom = float_zone(g)
            if geom is None or geom.is_empty or not geom.is_valid:
                continue
            if kind == 'float':
                points, step = float_points(g, geom), [0.006, 0.003, 0.01][g.ri(0, 2)]
            else:
                points, step = grid_points(geom), [0.5, 1, 2, 3][g.ri(0, 3)]
            cases.append({'kind': kind, 'geom': geom, 'points': points, 'gridStep': step})
            made += 1
    return cases


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--seed', type=int, default=20261115)
    ap.add_argument('--out', default=str(ROOT / 'docs' / 'evidence' / 'crosscheck.json'))
    ap.add_argument('--min-pairs', type=int, default=200000)
    ap.add_argument('--scale', type=float, default=1.0, help='multiply the number of cases (quick local runs)')
    ap.add_argument('--root', default=str(ROOT), help='folder holding geo.mjs and validation/classify.mjs (used by mutants.py)')
    args = ap.parse_args()

    node = os.environ.get('NODE') or shutil.which('node')
    if not node:
        sys.exit('node was not found on PATH; install Node.js 22 or later, or set NODE.')
    cases = build_cases(args.seed, args.scale)

    with tempfile.TemporaryDirectory() as tmp:
        cases_file, results_file = Path(tmp, 'cases.json'), Path(tmp, 'results.json')
        payload = [{'geometry': mapping(c['geom']), 'points': c['points'].tolist(), 'gridStep': c['gridStep']} for c in cases]
        cases_file.write_text(json.dumps({'cases': payload}, separators=(',', ':')))
        subprocess.run([node, str(Path(args.root) / 'validation' / 'classify.mjs'), str(cases_file), str(results_file)], check=True)
        answers = json.loads(results_file.read_text())
    node_version = answers['node']

    pairs = covered = boundary_pairs = hole_pairs = disagreements = 0
    by_kind, per_path, first = Counter(), Counter(), []
    for index, (case, got) in enumerate(zip(cases, answers['results'])):
        geom, pts = case['geom'], shapely.points(case['points'])
        shapely.prepare(geom)
        expected = shapely.covers(geom, pts)
        on_boundary = shapely.intersects(geom.boundary, pts)
        if geom.geom_type == 'Polygon' and len(geom.interiors):
            hole_pairs += int((~expected & shapely.covers(Polygon(geom.exterior), pts)).sum())
        wrong_any = np.zeros(len(pts), dtype=bool)
        for name in PATHS:
            engine = np.frombuffer(got[name].encode(), dtype=np.uint8) == ord('1')
            if len(engine) != len(pts):
                sys.exit('classify.mjs returned %d answers for %d points in case %d' % (len(engine), len(pts), index))
            wrong = engine != expected
            per_path[name] += int(wrong.sum())
            wrong_any |= wrong
        for i in np.flatnonzero(wrong_any):
            if len(first) < 25:
                first.append({'case': index, 'kind': case['kind'], 'point': case['points'][i].tolist(), 'shapely_covers': bool(expected[i]),
                              'engine': {n: got[n][i] == '1' for n in PATHS}, 'geometry': mapping(geom)})
        pairs += len(pts)
        covered += int(expected.sum())
        boundary_pairs += int(on_boundary.sum())
        disagreements += int(wrong_any.sum())
        by_kind[case['kind']] += len(pts)

    report = {
        'seed': args.seed,
        'script': 'validation/crosscheck.py',
        'versions': {'python': platform.python_version(), 'shapely': shapely.__version__, 'geos': shapely.geos_version_string,
                     'numpy': np.__version__, 'node': node_version},
        'reference': 'shapely.covers(polygon, point): boundary counts as covered, hole interiors do not',
        'engine_paths': {'contains': 'geo.mjs contains()', 'analyze': 'geo.mjs analyze() with its default grid index',
                         'grid': 'geo.mjs zoneIndex() with a per-case cell size, then contains()'},
        'float_boundary_margin_degrees': FLOAT_MARGIN,
        'cases': dict(Counter(c['kind'] for c in cases)),
        'polygons': len(cases),
        'pairs': pairs,
        'pairs_by_kind': dict(by_kind),
        'covered_pairs': covered,
        'boundary_cases': boundary_pairs,
        'hole_interior_pairs': hole_pairs,
        'disagreements': disagreements,
        'disagreements_by_path': {name: per_path[name] for name in PATHS},
        'first_disagreements': first,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    print('%d polygons, %d polygon-point pairs (%d on a boundary, %d inside a hole), %d disagreements -> %s'
          % (len(cases), pairs, boundary_pairs, hole_pairs, disagreements, out))
    if disagreements:
        sys.exit('FAIL: the engine and Shapely disagree; see first_disagreements in the report.')
    if pairs < args.min_pairs:
        sys.exit('FAIL: only %d pairs, need at least %d.' % (pairs, args.min_pairs))


if __name__ == '__main__':
    main()
