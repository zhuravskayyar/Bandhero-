'use strict';
// node --test harmony.test.js — символічний аудит гармонії (tools/harmony-audit.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAudit, buildScenarios, loadGame, SEV } = require('./tools/harmony-audit.js');

// Пороги — «стеля» % зваженого часу за метрикою на quick-наборі (по одній прогресії й тональності на жанр, have4/lvl1 і have1/lvl1).
// Це максимум по всіх рядках (жанр × партія) ПІСЛЯ виправлень гармонії (див. docs/harmony-audit-results.md) + запас max(+2 п.п., +25 %): тест ловить регресії.
// Значення, що лишаються високими, — свідомі або позасистемні: стартові партії (їх висоти не міняються: тести «тримає акорд», «однаково щотакту»), hook_nonct_full у розбіжних тактах (хук лишається в акорді гравця),
// avoid_own фону (бас фону проти акорда гравця — рішення «фон грає повну прогресію»), пари інструментів (гітара/піаніно нижче баса), leadtone_V (лише інформація).
const THRESHOLDS = {
  avoid_full: 17.3, avoid_own: 31.7, out_of_key: 8.3, leadtone_V: 31.3, clash_backing: 20.5, tritone: 9.8, mud: 19, mud_sub: 2, below_bass: 6.1,
  hook_nonct_full: 47.2, hook_nonct_own: 2, hook_avoid_full: 2, hook_avoid_own: 2, hook_seconds: 2,
  clash_pair: 32, tritone_pair: 27.8, mud_pair: 11.5, mud_sub_pair: 2, below_bass_pair: 64.9,
};
// мінімальний набір: по одній прогресії на жанр, одна тональність, повний гурт і гурт з одним акордом
const quick = L => buildScenarios(L, { quick: true });

test('аудит гармонії працює для всіх жанрів і повертає скінченні числа', async () => {
  const L = loadGame(), scenarios = quick(L);
  assert.equal(new Set(scenarios.map(s => s.genre)).size, Object.keys(L.g.GENRES).length, 'усі жанри в аудиті');
  const R = await runAudit({ L, scenarios });
  assert.ok(R.ranked.length > 500, 'є що рейтингувати: ' + R.ranked.length);
  assert.ok(R.mods.length > 0, 'модифікатори $v_* виміряно');
  assert.ok(R.pairs.length > 0, 'пари інструментів виміряно');
  assert.deepEqual(R.errors, {}, 'партії не кидають винятків: ' + JSON.stringify(R.errors));
  for (const r of [...R.ranked, ...R.pairs]) {
    assert.ok(Number.isFinite(r.value) && r.value >= 0 && r.value <= 100.0001, r.genre + ' ' + r.part + ' ' + r.metric + ' = ' + r.value);
    assert.ok(r.metric in SEV, 'невідома метрика ' + r.metric);
    if (r.value > 0) assert.ok(r.examples.length > 0, 'ненульова метрика без прикладів: ' + r.part + ' ' + r.metric);
    assert.ok(r.value <= THRESHOLDS[r.metric], r.genre + ' ' + r.part + ' ' + r.metric + ' ' + r.value + '% > порогу ' + THRESHOLDS[r.metric]);
  }
});

test('аудит детермінований: двічі — той самий результат', async () => {
  const L = loadGame(), scenarios = buildScenarios(L, { genres: ['pop', 'metal'], quick: true, combos: [[4, 1], [2, 1]] });
  const a = await runAudit({ L, scenarios }), b = await runAudit({ L, scenarios });
  assert.deepEqual(a.ranked, b.ranked);
  assert.deepEqual(a.mods, b.mods);
  assert.deepEqual(a.pairs, b.pairs);
  assert.deepEqual(a.summary, b.summary);
  // не залежить від порядку сценаріїв
  const c = await runAudit({ L, scenarios: scenarios.slice().reverse() });
  assert.deepEqual(a.ranked, c.ranked);
  assert.deepEqual(a.pairs, c.pairs);
});

test('памʼять: один процес, пік heap малий', async () => {
  const L = loadGame(), R = await runAudit({ L, scenarios: quick(L) });
  assert.ok(R.meta.peakHeapMB < 500, 'пік heap ' + R.meta.peakHeapMB + ' МБ');
});

test('виявляє навмисно хибну партію: нота b9 над коренем дає avoid, а звичайні клавіші — ні', async () => {
  const L = loadGame(), scenarios = buildScenarios(L, { genres: ['pop'], quick: true, combos: [[4, 1]] });
  // партія «wrong» додається лише в цьому тесті й не потрапляє в гру: сильні долі — b9 над коренем акорда (avoid над мажором)
  L.g.LAYERS.piano.push({ id: 'wrong', steps: (ch, s) => s % 4 === 0 ? [{ midi: 72 + ((ch.root + 1) % 12) % 12, vel: .5, dur: 2 }] : [] });
  try {
    const R = await runAudit({ L, scenarios });
    const bad = R.ranked.find(r => r.part === 'piano:wrong' && r.metric === 'avoid_full'), good = R.ranked.find(r => r.part === 'piano:chords' && r.metric === 'avoid_full');
    assert.ok(bad && bad.value > 25, 'хибна партія має давати багато avoid: ' + (bad && bad.value));
    assert.ok(!good || good.value < 3.5, 'звичайні клавіші — майже без avoid: ' + (good && good.value));
  } finally { L.g.LAYERS.piano.pop(); }
});
