import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const h = React.createElement;
// The existing cn utility also exports a browser-only iframe flag.
// Supply only that flag's environment; this does not simulate a browser or layout.
globalThis.window = { self: null, top: null };
const server = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom' });
try {
  const { default: ResponsiveTable } = await server.ssrLoadModule('/src/components/ui/responsive-table.jsx');
  const table = renderToStaticMarkup(h(ResponsiveTable, null,
    h('thead', null, h('tr', null, h('th', null, 'Client'), false, h('th', null, 'Status'))),
    h('tbody', null, h('tr', null, h('td', null, 'Test client'), false, h('td', null, h('button', { type: 'button' }, 'Review'))))));
  assert.match(table, /data-label="Client"/);
  assert.match(table, /data-label="Status"/);
  assert.equal((table.match(/<button/g) || []).length, 1, 'Responsive table must not duplicate interactive controls');

  const { default: Chart } = await server.ssrLoadModule('/src/components/portal/ProgressCompositionChart.jsx');
  const single = renderToStaticMarkup(h(Chart, { metrics: [{ entry_date: '2026-09-01', weight: 80 }] }));
  assert.match(single, /80/);
  assert.match(single, /ybs-number/);
  const multiple = renderToStaticMarkup(h(Chart, { metrics: [{ entry_date: '2026-09-01', weight: 80 }, { entry_date: '2026-09-02', weight: 81.2 }] }));
  assert.match(multiple, /81.2/);
  assert.match(multiple, /1.2/);
  const empty = renderToStaticMarkup(h(Chart));
  assert.match(empty, /No weight data in this period/);

  const css = await readFile(new URL('../src/styles/ybs-design.css', import.meta.url), 'utf8');
  const rgb = (name) => {
    const match = css.match(new RegExp(`--${name}: ([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
    assert.ok(match, `Missing color token ${name}`);
    const hue = +match[1]; const s = +match[2] / 100; const l = +match[3] / 100;
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map((n) => { const k = (n + hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); });
  };
  const luminance = (color) => color.map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const [foreground, background] of [['foreground', 'card'], ['muted-foreground', 'card'], ['primary', 'card'], ['primary-foreground', 'primary']]) {
    const values = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a,b) => b-a);
    const ratio = (values[0] + .05) / (values[1] + .05);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has insufficient contrast: ${ratio}`);
    console.log(`${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
  }
  console.log('PASS: responsive table, chart headline states, and core token contrast. This is not browser/layout verification.');
} finally {
  await server.close();
  delete globalThis.window;
}
