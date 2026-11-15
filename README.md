# Flood Exposure Atlas

A browser map and reproducible spatial analysis for a fictional coastal flood scenario. The map classifies 16 sample facilities against overlapping exposure polygons, then lets you inspect, filter, and export the results.

![Flood Exposure Atlas screenshot](docs/preview.png)

## Run locally

Requires Node.js 22 or later. There are no packages to install.

~~~sh
npm start
npm test
npm run analyze -- exposure.geojson expanded
npm run benchmark
~~~

Open http://127.0.0.1:4173. Switch from baseline to expanded extent to see which facilities change exposure. Filter by exposure, inspect intersecting zones, then download the displayed facilities as GeoJSON. The expanded export includes baseline exposure and the signed change in severity. The batch command exports every facility for the chosen scenario.

## How the analysis works

The scenario stores facility points and zone polygons as [WGS 84 GeoJSON](https://www.rfc-editor.org/info/rfc7946/). A point-in-polygon spatial join checks each facility against each zone. Points on a polygon boundary count as covered; points strictly inside holes do not. Overlaps take the highest exposure level, while all matching zones remain in the result. The local display projection is suitable for this small sample, and the exported coordinates remain longitude and latitude. The browser and batch command use the same analysis code. A uniform grid uses zone bounding boxes to shortlist candidates, followed by an exact polygon test. Very broad zones use a separate candidate list to cap the number of grid entries. The benchmark compares the grid with a direct scan across 6,000 synthetic points and 1,000 polygons, and checks that both return identical results. It is an illustrative benchmark for compact geographic data, not a production workload.

This is fictional sample data, not a flood forecast or a real-world risk assessment. The app has no map tile dependencies or external services. Headings use Georgia where it is installed and the bundled Gelasio, an open typeface with Georgia's letter widths, everywhere else.

## Publish the demo

The static files at the repository root can be served by GitHub Pages. In repository Settings → Pages, choose the main branch and the root folder as the source.

© 2026 muhammmmadziam1234-eng. All rights reserved, except the typeface in [fonts](fonts), which keeps its own licence.
