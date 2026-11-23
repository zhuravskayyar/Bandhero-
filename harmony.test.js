'use strict';
// node --test harmony.test.js — символічний аудит гармонії (tools/harmony-audit.js).
// Порогів поки що не накладаємо жорстко: THRESHOLDS лише фіксують «стелю» (100 % = не перевіряти).
// Коли гармонію виправлять, головна модель зменшує числа — і тест почне ловити регресії.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAudit, buildScenarios, loadGame, SEV } = require('./tools/harmony-audit.js');

// максимально допустимий % зваженого часу за метрикою (100 = поки без обмеження)
const THRESHOLDS = {
  avoid_full: 100, avoid_own: 100, out_of_key: 100, leadtone_V: 100, clash_backing: 100, tritone: 100, mud: 100, mud_sub: 100, below_bass: 100,
  hook_nonct_full: 100, hook_nonct_own: 100, hook_avoid_full: 100, hook_avoid_own: 100, hook_seconds: 100,
  clash_pair: 100, tritone_pair: 100, mud_pair: 100, mud_sub_pair: 100, below_bass_pair: 100,
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
  // розрізнення працює: гармонічно «ідеальна» партія не може бути й у всіх жанрах бездоганною, і навпаки
  const avoid = R.ranked.filter(r => r.metric === 'avoid_full');
  assert.ok(avoid.some(r => r.value === 0) && avoid.some(r => r.value > 0), 'метрика avoid_full розрізняє партії');
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

test('виявляє навмисно хибну партію: кластер піаніно дає avoid-ноти, а базова лінія — ні', async () => {
  const L = loadGame(), scenarios = buildScenarios(L, { genres: ['pop'], quick: true, combos: [[4, 1]] });
  const R = await runAudit({ L, scenarios });
  const cluster = R.mods.find(r => r.part === 'piano:+cluster' && r.metric === 'avoid_full');
  assert.ok(cluster && cluster.delta > 5, 'кластер має давати приріст avoid-нот: ' + (cluster && cluster.delta));
});
