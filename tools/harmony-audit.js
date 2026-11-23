'use strict';
/* СИМВОЛІЧНИЙ АУДИТ ГАРМОНІЇ Band Hero.
   Рахує числами, чи консонує кожна партія кожного інструмента в кожному жанрі з акордом такту, тональністю й іншими партіями.
   Нічого не відтворює й не змінює game.html: вирізає його <script> у vm-контекст і викликає LAYERS[..].steps / backingEvents напряму.
   Запуск:  node tools/harmony-audit.js [--full] [--keys N] [--progs N] [--workers N] [--genre g,g] [--top N] [--out файл.json] [--quiet]
   Звіт — у stdout, повний JSON — у tools/harmony-report.json. Детермінований: Math.random підмінено засівним ГПВЧ (за сценарієм і партією). */
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const ROOT = path.join(__dirname, '..');

/* ---------- завантаження гри (мінімальний контекст без мережі й аудіо) ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
class El {
  constructor() { this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.textContent = ''; this.classList = { add() {}, remove() {}, contains: () => false, toggle() {} }; }
  set innerHTML(v) {} get innerHTML() { return ''; }
  querySelectorAll() { return []; } appendChild() {} remove() {} addEventListener() {} setPointerCapture() {} select() {}
  getContext() { return new Proxy({}, { get: (t, k) => t[k] || (() => {}), set: (t, k, v) => (t[k] = v, true) }); }
}
function loadGame() {
  let src = fs.readFileSync(path.join(ROOT, 'game.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  const marker = 'window.__game={';
  if (!src.includes(marker)) throw new Error('у game.html не знайдено window.__game');
  // додатковий доступ до приватних змінних IIFE — лише в копії тексту в памʼяті, файл не змінюється
  src = src.replace(marker, 'window.__audit={get G(){return G},set G(v){G=v},get charKey(){return charKey},set charKey(v){charKey=v},get SONG(){return SONG},set SONG(v){SONG=v},PAL,QU,motifNote};' + marker);
  const els = new Map(), get = s => { if (!els.has(s)) els.set(s, new El()); return els.get(s); };
  const rng = { f: mulberry32(1) }, mathProxy = Object.create(Math); mathProxy.random = () => rng.f();
  const noop = () => 0, errors = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error: (...s) => errors.push(s.join(' ')) },
    document: { querySelector: get, createElement: () => new El(), hidden: false, addEventListener() {} },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, performance, URL, URLSearchParams, Blob, atob,
    location: new URL('http://127.0.0.1:1/'), setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    Image: class { constructor() { this.complete = true; this.naturalWidth = 1254; this.naturalHeight = 1254; } },
    fetch: () => Promise.resolve({ ok: false }), Math: mathProxy, requestAnimationFrame: noop, addEventListener() {},
  });
  context.window = context;
  for (const f of ['pixel-icons.js', 'assets/expansion-audio.js', 'assets/sf2-bank.js', 'assets/expansion-genres.js', 'assets/expansion-instruments.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  vm.runInContext(src, context, { filename: 'game.html' });
  return { g: context.__game, a: context.__audit, seed: s => { rng.f = mulberry32(s); }, errors };
}

/* ---------- теорія ---------- */
const NN = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = m => NN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const REL = ['1', 'b9', '9', 'b3/#9', '3', '11', 'b5/#11', '5', 'b13', '13', 'b7', '7'];
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], BLUES = [3, 6, 10];
/* Avoid-ноти за ПОВНОЮ якістю акорда (інтервал від кореня): 11 над мажором, b9 і мала терція над мажором, b13 проти квінти,
   b7 над maj7, maj7 над домінантою й m7, b9/мажорна терція над мінором, тритон над мінором і квінтакордом.
   Домінанта: b9, #9, #11, b13 — доступні напруги, не avoid. */
const AVOID = { maj7: [1, 3, 5, 8, 10], maj: [1, 3, 5, 8], '7': [5, 11], m: [1, 4, 6], m7: [1, 4, 6, 11], m7b5: [1, 4], '5': [1, 6] };
const metricW = s => s % 8 === 0 ? 1 : s % 4 === 0 ? .7 : s % 2 === 0 ? .4 : .25; // метрична вага кроку (16 кроків у такті)
const HOLD_CAP = { piano: 6 }; // PIANO_MAX_HOLD у game.html
function effDur(e, sd, inst) { // скільки кроків нота реально звучить
  let d = e.dur == null ? 1 : e.dur;
  if (e.holdSteps > 0) d = e.holdSteps;
  if (e.art === 'pm' || e.art === 'staccato') d = Math.min(d, .5 / sd);
  if (e.art === 'pizzicato') d = Math.min(d, 1.2 / sd);
  if (e.seconds) d = Math.min(d, e.seconds / sd + .3);
  return Math.max(.25, Math.min(d, HOLD_CAP[inst] || 8));
}

/* ---------- метрики ---------- */
// вага метрики у рейтингу (score = значення% × вага): ввідний тон над V — лише інформація
const SEV = { avoid_full: 1, avoid_own: .7, out_of_key: .8, clash_backing: 1, mud: .6, mud_sub: .6, below_bass: .8, hook_nonct_full: .8, hook_avoid_full: 1, hook_seconds: .8, leadtone_V: .1, clash_pair: 1, mud_pair: .6, below_bass_pair: .8 };
const METRIC_TEXT = {
  avoid_full: 'avoid-ноти проти ПОВНОГО акорда фону (те, що чує слухач)', avoid_own: 'avoid-ноти проти акорда гравця (chordAt)',
  out_of_key: 'ноти поза ладом/палітрою (не тони акорда)', leadtone_V: 'відомий ввідний тон мінору над V (інформаційно)',
  clash_backing: 'вертикальні конфлікти (m2/M7/m9/тритон) з фоном', mud: 'бруд низу: інтервал < кварти нижче C3', mud_sub: 'бруд суб-низу: інтервал < квінти нижче E2',
  below_bass: 'нота нижче баса фону', hook_nonct_full: 'сильна доля хука — не тон повного акорда', hook_avoid_full: 'хук: avoid проти повного акорда',
  hook_seconds: 'lead і mel водночас на секунді', clash_pair: 'конфлікти між інструментами гурту', mud_pair: 'бруд низу між інструментами', below_bass_pair: 'нижче баса гурту',
};
const newAcc = () => ({ n: 0, d: 0, c: 0, ex: [] });
const exCmp = (x, y) => y.w - x.w || x.bar - y.bar || x.s - y.s || (x.txt < y.txt ? -1 : x.txt > y.txt ? 1 : 0);
function pushEx(acc, ex) { // лишає 3 найвагоміші приклади, детерміновано
  if (acc.ex.some(e => e.bar === ex.bar && e.s === ex.s && e.txt === ex.txt)) return;
  acc.ex.push(ex); acc.ex.sort(exCmp); if (acc.ex.length > 3) acc.ex.length = 3;
}
function mergeAcc(into, from) { into.n += from.n; into.d += from.d; into.c += from.c; for (const e of from.ex) pushEx(into, e); }
const cell = (map, key) => map[key] || (map[key] = newAcc());

/* ---------- сценарій: пісня + фон ---------- */
function setupScenario(L, sc) {
  const { g, a } = L;
  L.seed(hash(sc.id));
  const song = g.makeSong(null, sc.genre, { seed: hash(sc.id + '#song'), key: sc.key });
  const offs = g.GENRES[sc.genre].famous[sc.prog];
  song.prog = offs.map(o => g.mkChord(song, o));
  for (let i = 0; i < sc.have; i++) song.prog[i] = g.mkChord(song, offs[i], sc.lvl); // зібрані акорди мають рівень lvl, решта — повні заготовки
  song.have = sc.have;
  a.SONG = song; a.G = { layers: {}, pedals: {}, p: { x: 0, y: 0 }, players: [], t: 0 };
  const bars = 36, sd = 60 / song.bpm / 4; // повна форма: вступ 4 + куплет 8 + підхід 4 + приспів 8 + брейк 4 + приспів 8
  const keySet = new Set((song.mode === 'minor' ? MIN : MAJ).map(x => (song.key + x) % 12));
  if (sc.genre === 'blues') BLUES.forEach(x => keySet.add((song.key + x) % 12));
  const fqCache = {}, ctCache = new Map();
  const S = {
    sc, song, bars, sd, keySet, mode: song.mode, g, a, pch: [], fch: [],
    fullQ: off => fqCache[off] || (fqCache[off] = g.mkChord(song, off).q),
    ct(c) { // тони акорда: власні pcs (рівень гравця) ∪ повний акорд жанру
      const k = c.off + '|' + (c.lvl || 0); let s = ctCache.get(k);
      if (!s) { s = new Set(c.pcs); for (const x of a.QU[this.fullQ(c.off)] || []) s.add((c.root + x) % 12); ctCache.set(k, s); }
      return s;
    },
    avoid(c, pc) { // → назва avoid-інтервалу чи null
      if (this.ct(c).has(pc)) return null;
      const r = (pc - c.root + 12) % 12, A = AVOID[this.fullQ(c.off)];
      return A && A.includes(r) ? REL[r] + ' над ' + this.fullQ(c.off) : null;
    },
  };
  for (let b = 0; b < bars; b++) { S.pch.push(g.chordAt(b)); S.fch.push(g.fullChordAt(b)); }
  const back = []; // фон: бас, акорди, мелодія-хук (барабани без висоти)
  for (let b = 0; b < bars; b++) for (let s = 0; s < 16; s++) for (const e of g.backingEvents(b, s)) {
    if (e.kind === 'drum' || e.midi === undefined) continue;
    const d = effDur(e, sd, 'backing');
    back.push({ midi: e.midi, pc: e.midi % 12, bar: b, s, abs: b * 16 + s, end: b * 16 + s + d, w: metricW(s) * Math.max(.5, Math.min(d, 4)), src: 'backing:' + e.kind, inst: 'backing' });
  }
  S.back = back; S.backIdx = makeIndex(back, bars * 16);
  return S;
}
function makeIndex(notes, len) {
  const by = Array.from({ length: len + 1 }, () => []); let maxD = 1;
  for (const n of notes) { by[Math.min(len, Math.floor(n.abs))].push(n); maxD = Math.max(maxD, n.end - n.abs); }
  return { by, maxD: Math.ceil(maxD) + 1, len };
}
function genNotes(S, inst, Ly, L, layers, errs, key) {
  const { g, a, sd } = S; a.charKey = inst; a.G.layers = layers;
  const notes = [], strings = new Map();
  for (let b = 0; b < S.bars; b++) for (let s = 0; s < 16; s++) {
    let evs;
    try { evs = Ly.steps(g.voiced(S.pch[b], layers, s, b), s, b, L); } catch (e) { errs[key] = (errs[key] || 0) + 1; continue; }
    for (const e of evs) {
      if (e.midi === undefined || e.drum || e.silent || e.art === 'dead' || e.mute || !Number.isFinite(e.midi)) continue;
      const d = effDur(e, sd, inst), abs = b * 16 + s, n = { midi: e.midi, pc: ((e.midi % 12) + 12) % 12, bar: b, s, abs, end: abs + d, w: metricW(s) * Math.max(.5, Math.min(d, 4)), inst, src: inst + ':' + Ly.id };
      if (inst === 'guitar' && e.str != null && e.art !== 'harmonic') { // нова нота на тій самій струні глушить попередню (dampString у playBuffered)
        const p = strings.get(Ly.id + e.str); if (p && p.abs < abs && p.end > abs) p.end = abs; strings.set(Ly.id + e.str, n);
      }
      notes.push(n);
    }
  }
  return notes;
}

/* ---------- вертикаль: конфлікти, бруд низу, нижче баса ---------- */
const clashKind = (x, y) => { const d = Math.abs(x - y); return d === 1 ? 'm2' : d === 11 ? 'M7' : d === 13 ? 'm9' : (d % 12 === 6 && d <= 18) ? 'тритон' : null; };
/* для кожної ноти x шукає ноти y, що звучать одночасно; прапорці — за першим знайденим партнером */
function vertical(S, xs, yIdx, isBassY, out, mkEx) {
  const { pch, fch } = S;
  for (const x of xs) {
    let clash = null, mud = null, sub = null, below = null;
    for (let t = Math.max(0, Math.floor(x.abs) - yIdx.maxD); t < Math.min(yIdx.len, Math.ceil(x.end)); t++) for (const y of yIdx.by[t]) {
      const ov = Math.min(x.end, y.end) - Math.max(x.abs, y.abs); // хвіст < ~1,5 кроку (≈0,2 с) — це розмазування, а не одночасне звучання
      if (ov <= 0 || ov < Math.min(1.5, .8 * Math.min(x.end - x.abs, y.end - y.abs)) || y.midi === x.midi) continue;
      const d = Math.abs(x.midi - y.midi), lo = Math.min(x.midi, y.midi), bar = Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16));
      if (!clash) {
        const k = clashKind(x.midi, y.midi);
        if (k) {
          const cf = S.ct(fch[bar]), cp = S.ct(pch[bar]), same = (cf.has(x.pc) && cf.has(y.pc)) || (cp.has(x.pc) && cp.has(y.pc)); // обидві — тони одного акорда: це його будова
          const dom = k === 'тритон' && (S.fullQ(fch[bar].off) === '7' || S.fullQ(pch[bar].off) === '7'); // тритон у домінанті — норма
          if (!same && !dom) clash = { k, y };
        }
      }
      if (!mud && lo < 48 && d < 5) mud = { y };
      if (!sub && lo < 40 && d < 7) sub = { y };
      if (!below && isBassY && isBassY(y) && x.midi < y.midi) below = { y };
    }
    out.d += x.w;
    if (clash) mkEx('clash', x, clash.y, clash.k);
    if (mud) mkEx('mud', x, mud.y, '');
    if (sub) mkEx('sub', x, sub.y, '');
    if (below) mkEx('below', x, below.y, '');
  }
}

/* ---------- аналіз проходу одного шару/модифікатора ---------- */
function analyze(S, part, notes, accL, opts) {
  const loc = {}, tag = opts.tag || '', A = m => loc[m] || (loc[m] = newAcc());
  const hit = (m, n, txt) => { const x = A(m); x.n += n.w; x.c++; pushEx(x, { bar: n.bar, s: n.s, w: n.w, txt: txt + ' ' + tag, chord: S.pch[n.bar].name, full: S.fch[n.bar].name }); };
  const lt = (S.song.key + 11) % 12;
  for (const n of notes) {
    const pch = S.pch[n.bar], fch = S.fch[n.bar];
    for (const m of ['avoid_full', 'avoid_own', 'out_of_key', 'leadtone_V']) A(m).d += n.w;
    const af = S.avoid(fch, n.pc); if (af) hit('avoid_full', n, noteName(n.midi) + ' (' + af + ') проти ' + fch.name + ', гравець грає ' + pch.name);
    const ao = S.avoid(pch, n.pc); if (ao) hit('avoid_own', n, noteName(n.midi) + ' (' + ao + ') проти ' + pch.name);
    if (!S.keySet.has(n.pc)) {
      if (S.mode === 'minor' && n.pc === lt) {
        if (pch.off === 7 || fch.off === 7) hit('leadtone_V', n, noteName(n.midi) + ' ввідний тон над V ' + pch.name);
        else hit('out_of_key', n, noteName(n.midi) + ' (ввідний тон поза V) над ' + pch.name);
      } else if (!S.ct(pch).has(n.pc) && !S.ct(fch).has(n.pc)) hit('out_of_key', n, noteName(n.midi) + ' поза ладом ' + NN[S.song.key] + ' ' + S.mode + ' над ' + pch.name);
    }
  }
  const v = { d: 0 }, isBassBack = y => y.src === 'backing:bass';
  vertical(S, notes, S.backIdx, isBassBack, v, (kind, x, y, k) => {
    if (kind === 'below' && opts.isBass) return;
    const m = kind === 'clash' ? 'clash_backing' : kind === 'mud' ? 'mud' : kind === 'sub' ? 'mud_sub' : 'below_bass';
    hit(m, x, (kind === 'clash' ? k + ' ' : kind === 'mud' ? 'бруд ' : kind === 'sub' ? 'суб-бруд ' : 'нижче баса ') + noteName(x.midi) + '+' + noteName(y.midi) + ' (' + y.src.replace('backing:', 'фон ') + ') над ' + S.fch[Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16))].name + ', гравець ' + S.pch[x.bar].name);
  });
  for (const m of ['clash_backing', 'mud', 'mud_sub', 'below_bass']) A(m).d += v.d;
  // бруд низу всередині партії: ноти, що б'ють разом (акордова будова, напр. кластер)
  const byAbs = new Map(); for (const n of notes) { const k = Math.round(n.abs); (byAbs.get(k) || byAbs.set(k, []).get(k)).push(n); }
  for (const grp of byAbs.values()) if (grp.length > 1) {
    const s = grp.slice().sort((x, y) => x.midi - y.midi); let pair = null, sub = false;
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const d = s[j].midi - s[i].midi; if (d > 0 && s[i].midi < 48 && d < 5 && !pair) pair = [s[i], s[j]]; if (d > 0 && s[i].midi < 40 && d < 7) sub = true; }
    if (pair) hit('mud', s[0], 'бруд у партії ' + noteName(pair[0].midi) + '+' + noteName(pair[1].midi) + ' над ' + S.pch[s[0].bar].name);
    if (sub) { const x = A('mud_sub'); x.n += s[0].w; x.c++; }
  }
  for (const m of Object.keys(loc)) if (loc[m].d || loc[m].n) mergeAcc(cell(accL, S.sc.genre + '\t' + part + '\t' + opts.L + '\t' + m), loc[m]);
}

/* ---------- хук: lead/mel за motifNote ---------- */
function analyzeHook(S, accL) {
  const { a, pch, fch } = S, loc = {}, A = k => loc[k] || (loc[k] = newAcc()), seq = { lead: new Map(), mel: new Map() };
  const phr = b => { try { return S.g.phraseName(b); } catch (e) { return ''; } };
  for (const role of ['lead', 'mel']) for (let b = 0; b < S.bars; b++) for (let s = 0; s < 16; s++) {
    const m = a.motifNote(role, b, s, pch[b]); if (m === null || m === undefined) continue;
    seq[role].set(b * 16 + s, m);
    const w = metricW(s), pc = ((m % 12) + 12) % 12, part = 'hook:' + role, af = S.avoid(fch[b], pc), x1 = A(part + '\thook_avoid_full');
    x1.d += w; if (af) { x1.n += w; x1.c++; pushEx(x1, { bar: b, s, w, txt: noteName(m) + ' (' + af + ') проти ' + fch[b].name + ' [' + S.sc.genre + ' ' + NN[S.song.key] + ' have' + S.sc.have + ']', chord: pch[b].name, full: fch[b].name }); }
    if (s % 4 === 0) { const x = A(part + '\thook_nonct_full'); x.d += w; if (!S.ct(fch[b]).has(pc)) { x.n += w; x.c++; pushEx(x, { bar: b, s, w, txt: noteName(m) + ' не тон ' + fch[b].name + ' (гравець ' + pch[b].name + ', фраза ' + phr(b) + ') [' + S.sc.genre + ' ' + NN[S.song.key] + ' have' + S.sc.have + ']', chord: pch[b].name, full: fch[b].name }); } }
  }
  for (const [abs, m] of seq.lead) if (seq.mel.has(abs)) {
    const o = seq.mel.get(abs), d = Math.abs(m - o), x = A('hook:lead+mel\thook_seconds'), b = abs >> 4, s = abs & 15; x.d += 1;
    if (d === 1 || d === 2) { x.n += 1; x.c++; pushEx(x, { bar: b, s, w: d === 1 ? 2 : 1, txt: (d === 1 ? 'm2 ' : 'M2 ') + noteName(m) + '/' + noteName(o) + ' над ' + pch[b].name + ' [' + S.sc.genre + ' ' + NN[S.song.key] + ']', chord: pch[b].name, full: fch[b].name }); }
  }
  for (const k of Object.keys(loc)) { const [part, metric] = k.split('\t'); mergeAcc(cell(accL, S.sc.genre + '\t' + part + '\t-\t' + metric), loc[k]); }
}

/* ---------- один сценарій ---------- */
function runScenario(L, sc, accL, errs, accPair) {
  const { g } = L, S = setupScenario(L, sc);
  const tagSc = '[' + sc.genre + ' ' + g.GENRES[sc.genre].famous[sc.prog].join('-') + ' ' + NN[S.song.key] + ' have' + sc.have + ' lvl' + sc.lvl + ']';
  for (const k of ['bass', 'chord', 'hook']) analyze(S, 'backing:' + k, S.back.filter(n => n.src === 'backing:' + k), accL, { L: '-', tag: tagSc, isBass: k === 'bass' });
  analyzeHook(S, accL);
  const kit = {};
  for (const inst of Object.keys(g.LAYERS)) {
    if (inst === 'drums') continue;
    const mods = Object.keys((g.VOICINGS && g.VOICINGS[inst]) || {});
    g.LAYERS[inst].forEach((Ly, li) => {
      for (const Lv of [1, 3, 5]) {
        L.seed(hash(sc.id + inst + Ly.id + Lv));
        const notes = genNotes(S, inst, Ly, Lv, { [Ly.id]: Lv }, errs, inst + ':' + Ly.id), o = { L: 'L' + Lv, tag: tagSc + ' L' + Lv, isBass: inst === 'bass' };
        analyze(S, inst + ':' + Ly.id, notes, accL, o);
        if (Lv === 3) {
          if (sc.mods && mods.length) analyze(S, inst + ':~base', notes, accL, o); // базова лінія для порівняння з модифікаторами
          if (sc.pair && li < 5) (kit[inst] || (kit[inst] = [])).push(...notes);
        }
      }
      if (sc.mods) for (const mod of mods) {
        L.seed(hash(sc.id + inst + Ly.id + mod));
        const notes = genNotes(S, inst, Ly, 3, { [Ly.id]: 3, ['$v_' + mod]: 1 }, errs, inst + ':' + Ly.id + '+' + mod);
        analyze(S, inst + ':+' + mod, notes, accL, { L: 'L3', tag: tagSc + ' ' + Ly.id + '+' + mod, isBass: inst === 'bass' });
      }
    });
  }
  if (sc.pair) analyzePairs(S, kit, accPair, tagSc);
}
/* парний аналіз: гурт із різних героїв (по 5 перших партій кожного, L3); кожна впорядкована пара інструментів */
function analyzePairs(S, kit, acc, tag) {
  const idx = {}, insts = Object.keys(kit).sort();
  for (const i of insts) idx[i] = makeIndex(kit[i], S.bars * 16);
  for (const A of insts) for (const B of insts) if (A !== B) {
    const out = { d: 0 }, loc = {};
    vertical(S, kit[A], idx[B], B === 'bass' && A !== 'bass' ? () => true : null, out, (kind, x, y, k) => {
      const m = kind === 'clash' ? 'clash_pair' : kind === 'mud' ? 'mud_pair' : kind === 'below' ? 'below_bass_pair' : null; if (!m) return;
      const c = loc[m] || (loc[m] = newAcc()); c.n += x.w; c.c++;
      pushEx(c, { bar: x.bar, s: x.s, w: x.w, txt: (k ? k + ' ' : '') + noteName(x.midi) + ' (' + x.src + ') + ' + noteName(y.midi) + ' (' + y.src + ') над ' + S.fch[Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16))].name + ' ' + tag, chord: S.pch[x.bar].name, full: S.fch[x.bar].name });
    });
    for (const m of ['clash_pair', 'mud_pair', 'below_bass_pair']) { if (m === 'below_bass_pair' && B !== 'bass') continue; const c = loc[m] || newAcc(); c.d = out.d; mergeAcc(cell(acc, S.sc.genre + '\t' + A + '>' + B + '\t3\t' + m), c); }
  }
}

/* ---------- перелік сценаріїв ---------- */
const KEYS = [4, 9, 2, 7, 11, 0];
const COMBOS_DEFAULT = [[4, 1], [1, 1], [2, 1], [3, 2], [4, 3]], COMBOS_FULL = [1, 2, 3, 4].flatMap(h => [1, 2, 3].map(l => [h, l]));
function buildScenarios(L, o = {}) {
  const genres = o.genres && o.genres.length ? o.genres : Object.keys(L.g.GENRES), keys = KEYS.slice(0, o.keys || 2), combos = o.combos || (o.full ? COMBOS_FULL : COMBOS_DEFAULT), out = [];
  for (const genre of genres) {
    const F = L.g.GENRES[genre].famous, progs = F.map((_, i) => i).slice(0, o.progs || F.length);
    for (const prog of progs) keys.forEach((key, ki) => combos.forEach(([have, lvl]) => out.push({
      id: [genre, prog, key, have, lvl].join('|'), genre, prog, key, have, lvl,
      mods: o.mods !== undefined ? o.mods : (!!o.full || (have === 4 && lvl === 1)), // модифікатори — на повному гурті з трізвуками (чиста база)
      pair: o.pair !== undefined ? o.pair : (have === 4 && lvl === 1 && ki === 0),
    })));
  }
  return out;
}
function runScenarios(list) {
  const L = loadGame(), acc = {}, pairAcc = {}, errs = {};
  for (const sc of list) runScenario(L, sc, acc, errs, pairAcc);
  return { acc, pairAcc, errs };
}

/* ---------- збірка звіту ---------- */
function build(parts, scenarios) {
  const acc = {}, pairAcc = {}, errs = {};
  for (const p of parts) { for (const k in p.acc) mergeAcc(cell(acc, k), p.acc[k]); for (const k in p.pairAcc) mergeAcc(cell(pairAcc, k), p.pairAcc[k]); for (const k in p.errs) errs[k] = (errs[k] || 0) + p.errs[k]; }
  const val = c => c.d > 0 ? 100 * c.n / c.d : 0, rows = [], baseRows = new Map(), modRows = [];
  const mk = (k, c) => { const [genre, part, L, metric] = k.split('\t'); return { genre, part, L, metric, value: +val(c).toFixed(3), n: +c.n.toFixed(2), d: +c.d.toFixed(2), count: c.c, examples: c.ex.map(e => ({ bar: e.bar, step: e.s, chord: e.chord, full: e.full, text: e.txt })) }; };
  for (const k of Object.keys(acc).sort()) {
    const r = mk(k, acc[k]); if (r.d < 4) continue;
    if (r.part.endsWith(':~base')) baseRows.set(r.genre + '\t' + r.part.split(':')[0] + '\t' + r.metric, r);
    else if (/:\+/.test(r.part)) modRows.push(r);
    else rows.push(r);
  }
  const worst = new Map(); // найгірший рівень L для кожного (жанр, партія, метрика)
  for (const r of rows) { const k = r.genre + '\t' + r.part + '\t' + r.metric; (worst.get(k) || worst.set(k, []).get(k)).push(r); }
  const ranked = [], key3 = r => r.genre + r.part + r.metric;
  for (const list of worst.values()) { list.sort((x, y) => y.value - x.value || (x.L < y.L ? -1 : 1)); const w = list[0]; ranked.push({ ...w, score: +(w.value * (SEV[w.metric] ?? 1)).toFixed(3), byL: list.map(x => x.L + ':' + x.value) }); }
  ranked.sort((x, y) => y.score - x.score || (key3(x) < key3(y) ? -1 : 1));
  const mods = modRows.map(r => { // Δ відносно тієї самої групи шарів без модифікатора
    const b = baseRows.get(r.genre + '\t' + r.part.split(':')[0] + '\t' + r.metric), base = b ? b.value : 0;
    return { ...r, base, delta: +(r.value - base).toFixed(3), score: +((r.value - base) * (SEV[r.metric] ?? 1)).toFixed(3) };
  }).sort((x, y) => y.score - x.score || (key3(x) < key3(y) ? -1 : 1));
  const pairs = Object.keys(pairAcc).sort().map(k => mk(k, pairAcc[k])).filter(r => r.d >= 4).map(r => ({ ...r, score: +(r.value * (SEV[r.metric] ?? 1)).toFixed(3) })).sort((x, y) => y.score - x.score || (key3(x) < key3(y) ? -1 : 1));
  const isLayer = p => /^[a-z]+:[a-z0-9]+$/.test(p) && !/^backing|^hook/.test(p);
  const sum = (keyFn, metric) => { const m = {}; for (const k of Object.keys(acc)) { const [genre, part, , me] = k.split('\t'); if (me !== metric || !isLayer(part)) continue; const c = cell(m, keyFn(genre, part)); c.n += acc[k].n; c.d += acc[k].d; } return Object.fromEntries(Object.keys(m).sort().map(x => [x, +val(m[x]).toFixed(2)])); };
  const summary = {};
  for (const me of ['avoid_full', 'avoid_own', 'out_of_key', 'clash_backing', 'mud', 'below_bass']) summary[me] = { byGenre: sum(g => g, me), byInstrument: sum((g, p) => p.split(':')[0], me) };
  return { ranked, mods, pairs, summary, errors: errs, scenarios: scenarios.length };
}

async function runAudit(o = {}) {
  const L0 = loadGame(), scenarios = o.scenarios || buildScenarios(L0, o);
  const nW = o.workers !== undefined ? o.workers : Math.max(1, Math.min(os.cpus().length - 1, 10));
  let parts;
  if (nW <= 0) parts = [runScenarios(scenarios)];
  else { // сценарії розкидано за індексом; злиття не залежить від порядку завершення воркерів
    const chunks = Array.from({ length: nW }, (_, i) => scenarios.filter((_, j) => j % nW === i)).filter(c => c.length);
    parts = await Promise.all(chunks.map(c => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { harmonyAudit: c } }); w.once('message', res); w.once('error', rej); })));
  }
  return { ...build(parts, scenarios), scenarioList: scenarios.map(s => s.id) };
}

/* ---------- друк ---------- */
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
function printReport(R, top = 60) {
  const P = console.log, line = '─'.repeat(100);
  P('\nСИМВОЛІЧНИЙ АУДИТ ГАРМОНІЇ · сценаріїв: ' + R.scenarios + ' · рядків: ' + R.ranked.length + '\n' + line);
  P('ТОП-' + top + ' (найгірше першим; score = значення% × вага метрики; L — найгірший рівень партії)\n' + line);
  R.ranked.slice(0, top).forEach((r, i) => {
    P(pad(i + 1, 3) + pad(r.genre, 11) + pad(r.part, 22) + pad(r.metric, 17) + pad(r.value.toFixed(1) + '%', 8) + ' ' + r.L + '  (score ' + r.score + ', ' + r.count + ' нот)');
    for (const e of r.examples) P('      · такт ' + e.bar + ' крок ' + e.step + ' · ' + e.text);
  });
  P('\n' + line + '\nМОДИФІКАТОРИ $v_* (значення на L3 з модифікатором проти тих самих партій без нього; Δ — приріст)\n' + line);
  R.mods.slice(0, 30).forEach((r, i) => P(pad(i + 1, 3) + pad(r.genre, 11) + pad(r.part, 18) + pad(r.metric, 17) + pad(r.value.toFixed(1) + '%', 8) + ' база ' + pad(r.base.toFixed(1) + '%', 7) + ' Δ' + r.delta.toFixed(1) + '   напр. ' + (r.examples[0] ? r.examples[0].text : '')));
  P('\n' + line + '\nПАРИ ІНСТРУМЕНТІВ у гурті (x>y: ноти x проти нот y; перші 5 партій кожного, L3)\n' + line);
  R.pairs.slice(0, 20).forEach((r, i) => P(pad(i + 1, 3) + pad(r.genre, 11) + pad(r.part, 20) + pad(r.metric, 17) + pad(r.value.toFixed(1) + '%', 8) + '   ' + (r.examples[0] ? r.examples[0].text : '')));
  const ms = Object.keys(R.summary);
  P('\n' + line + '\nЗВЕДЕННЯ ПО ЖАНРАХ (% зваженого часу по всіх мелодійних партіях)\n' + line);
  P(pad('жанр', 12) + ms.map(m => pad(m, 15)).join(''));
  for (const g of Object.keys(R.summary.avoid_full.byGenre)) P(pad(g, 12) + ms.map(m => pad((R.summary[m].byGenre[g] ?? 0).toFixed(1), 15)).join(''));
  P('\nЗВЕДЕННЯ ПО ІНСТРУМЕНТАХ'); P(pad('інструмент', 12) + ms.map(m => pad(m, 15)).join(''));
  for (const g of Object.keys(R.summary.avoid_full.byInstrument)) P(pad(g, 12) + ms.map(m => pad((R.summary[m].byInstrument[g] ?? 0).toFixed(1), 15)).join(''));
  if (Object.keys(R.errors).length) P('\nВИНЯТКИ у партіях (ці кроки виміряти не вдалося): ' + JSON.stringify(R.errors));
}

if (!isMainThread && workerData && workerData.harmonyAudit) parentPort.postMessage(runScenarios(workerData.harmonyAudit));
module.exports = { runAudit, buildScenarios, loadGame, printReport, SEV, METRIC_TEXT };

if (require.main === module) (async () => {
  const argv = process.argv.slice(2), opt = {}, val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  opt.full = argv.includes('--full'); if (val('--keys')) opt.keys = +val('--keys'); if (val('--workers')) opt.workers = +val('--workers');
  if (val('--genre')) opt.genres = val('--genre').split(','); if (val('--progs')) opt.progs = +val('--progs');
  const t0 = Date.now(), R = await runAudit(opt), out = val('--out') || path.join(__dirname, 'harmony-report.json');
  R.meta = { seconds: +((Date.now() - t0) / 1000).toFixed(1), options: opt, metrics: METRIC_TEXT, severity: SEV };
  fs.writeFileSync(out, JSON.stringify(R));
  if (!argv.includes('--quiet')) printReport(R, +val('--top') || 60);
  console.log('\nJSON: ' + path.relative(process.cwd(), out) + ' · ' + R.meta.seconds + ' с');
})();
