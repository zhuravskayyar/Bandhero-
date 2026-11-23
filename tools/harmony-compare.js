'use strict';
/* Порівняння двох звітів harmony-audit (before.json after.json) → markdown у stdout.
   node tools/harmony-compare.js tools/harmony-baseline.json tools/harmony-report.json [--genres a,b] [--md] */
const fs = require('node:fs');
const argv = process.argv.slice(2), files = argv.filter(a => !a.startsWith('--') && fs.existsSync(a));
const gi = argv.indexOf('--genres'), only = gi >= 0 ? argv[gi + 1].split(',') : null;
const A = JSON.parse(fs.readFileSync(files[0], 'utf8')), B = JSON.parse(fs.readFileSync(files[1], 'utf8'));
const KEY = ['avoid_full', 'avoid_own', 'out_of_key', 'clash_backing', 'tritone', 'mud', 'mud_sub', 'below_bass'];
const f = x => x === undefined ? '–' : x.toFixed(1), cell = (a, b) => a === undefined && b === undefined ? '' : f(a) + ' → ' + f(b);
function table(title, dim, metrics, names) {
  const o = ['### ' + title, '', '| | ' + metrics.join(' | ') + ' |', '|---|' + metrics.map(() => '---:').join('|') + '|'];
  for (const n of names) o.push('| ' + n + ' | ' + metrics.map(m => cell(((A.summary.layers[m] || {})[dim] || {})[n], ((B.summary.layers[m] || {})[dim] || {})[n])).join(' | ') + ' |');
  return o.join('\n') + '\n';
}
const names = dim => [...new Set(KEY.flatMap(m => [...Object.keys(((A.summary.layers[m] || {})[dim]) || {}), ...Object.keys(((B.summary.layers[m] || {})[dim]) || {})]))].sort().filter(n => dim !== 'byGenre' || !only || only.includes(n));
const out = [];
out.push(table('Інструмент × метрика (% зваженого часу, до → після)', 'byInstrument', KEY, names('byInstrument')));
out.push(table('Жанр × метрика', 'byGenre', KEY, names('byGenre')));
out.push(table('have × метрика', 'byHave', KEY, names('byHave')));
const hm = ['hook_nonct_full', 'hook_nonct_own', 'hook_avoid_full', 'hook_avoid_own', 'hook_seconds'], hs = x => (x.summary.backing || {});
out.push('### Хук (мелодія): до → після\n\n| | ' + hm.join(' | ') + ' |\n|---|' + hm.map(() => '---:').join('|') + '|');
for (const n of ['hook:lead', 'hook:mel', 'hook:lead+mel']) out.push('| ' + n + ' | ' + hm.map(m => cell((hs(A)[m] || { byInstrument: {} }).byInstrument[n], (hs(B)[m] || { byInstrument: {} }).byInstrument[n])).join(' | ') + ' |');
out.push('');
const pm = ['clash_pair', 'tritone_pair', 'mud_pair', 'mud_sub_pair', 'below_bass_pair'], ps = x => (x.summary.pairs || {});
out.push('### Пари інструментів (усереднено по всіх парах): до → після\n\n| | ' + pm.join(' | ') + ' |\n|---|' + pm.map(() => '---:').join('|') + '|');
const avgPairs = (R, m) => { const v = Object.values(((ps(R)[m] || {}).byInstrument) || {}); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined; };
out.push('| середнє | ' + pm.map(m => cell(avgPairs(A, m), avgPairs(B, m))).join(' | ') + ' |\n');
out.push('### Розбіжні такти (chordAt ≠ fullChordAt) — diverge / same, до → після\n\n| метрика | diverge | same |\n|---|---:|---:|');
for (const m of KEY) { const a = (A.summary.layers[m] || {}).split, b = (B.summary.layers[m] || {}).split; if (a && b) out.push('| ' + m + ' | ' + cell(a.diverge, b.diverge) + ' | ' + cell(a.same, b.same) + ' |'); }
out.push('', '### Топ-15 після (за score)\n\n| # | жанр | партія | метрика | % | до |\n|--:|---|---|---|--:|--:|');
const idx = new Map(A.ranked.map(r => [r.genre + '\t' + r.part + '\t' + r.metric, r.value]));
B.ranked.filter(r => !only || only.includes(r.genre)).slice(0, 15).forEach((r, i) => out.push('| ' + (i + 1) + ' | ' + r.genre + ' | ' + r.part + ' | ' + r.metric + ' | ' + f(r.value) + ' | ' + f(idx.get(r.genre + '\t' + r.part + '\t' + r.metric)) + ' |'));
console.log(out.join('\n'));
