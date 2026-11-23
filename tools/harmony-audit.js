'use strict';
/* СИМВОЛІЧНИЙ АУДИТ ГАРМОНІЇ Band Hero.
   Рахує числами, чи консонує кожна партія кожного інструмента в кожному жанрі з акордом такту, тональністю й іншими партіями.
   Нічого не відтворює й не змінює game.html: вирізає його <script> у vm-контекст і викликає LAYERS[..].steps / backingEvents напряму.
   Один процес і один vm-контекст (без worker_threads/child_process); між сценаріями живуть лише лічильники (n/d/c + ≤3 приклади).
   Запуск:  node tools/harmony-audit.js [--quick] [--genre g,g] [--keys N] [--progs N] [--bars N] [--top N] [--out файл.json] [--md файл.md] [--quiet]
   Без прапорців — ПОВНИЙ перебір (див. buildScenarios). Звіт — у stdout, повний JSON — у tools/harmony-report.json.
   Детермінований: Math.random підмінено засівним ГПВЧ, що перезасівається на кожен сценарій і на кожен прохід партії → результат не залежить від порядку. */
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
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
const SEV = {
  avoid_full: 1, avoid_own: .7, out_of_key: .8, leadtone_V: .1, clash_backing: 1, tritone: .7, mud: .6, mud_sub: .6, below_bass: .8,
  hook_nonct_full: .8, hook_nonct_own: .5, hook_avoid_full: 1, hook_avoid_own: .7, hook_seconds: .8,
  clash_pair: 1, tritone_pair: .7, mud_pair: .6, mud_sub_pair: .6, below_bass_pair: .8,
};
const METRIC_TEXT = {
  avoid_full: 'avoid-ноти проти ПОВНОГО акорда фону (те, що чує слухач)', avoid_own: 'avoid-ноти проти акорда гравця (chordAt)',
  out_of_key: 'ноти поза ладом/палітрою (не тони акорда)', leadtone_V: 'відомий ввідний тон мінору над V (інформаційно)',
  clash_backing: 'вертикальні тертя м2/в7/м9 з фоном (без тритону)', tritone: 'тритон з фоном поза домінантою й поза тонами одного акорда',
  mud: 'бруд низу 36–48: < ч5 у 36–40, < в3 у 40–48 (docs/harmony-rules.md)', mud_sub: 'бруд суб-низу < 36: усе, крім ч5 й октави (інтервал < октави)',
  below_bass: 'нота нижче баса фону', hook_nonct_full: 'сильна доля хука — не тон повного акорда', hook_nonct_own: 'сильна доля хука — не тон акорда гравця',
  hook_avoid_full: 'хук: avoid проти повного акорда', hook_avoid_own: 'хук: avoid проти акорда гравця', hook_seconds: 'lead і mel водночас на секунді',
  clash_pair: 'тертя м2/в7/м9 між інструментами гурту', tritone_pair: 'тритон між інструментами гурту поза домінантою', mud_pair: 'бруд низу 36–48 між інструментами',
  mud_sub_pair: 'бруд суб-низу < 36 між інструментами', below_bass_pair: 'нижче баса гурту',
};
const PAIR_METRICS = ['clash_pair', 'tritone_pair', 'mud_pair', 'mud_sub_pair', 'below_bass_pair'];

/* Лічильник: n — зважений «брудний» час, d — зважений загальний час, c — кількість нот, nd/dd — те саме лише в тактах,
   де акорд гравця (chordAt) ≠ повний акорд фону (fullChordAt). ex — ≤3 найвагоміші приклади (текст будується ліниво). */
const newAcc = () => ({ n: 0, d: 0, c: 0, nd: 0, dd: 0, ex: [] });
// детермінований порядок прикладів: вага ↓, id сценарію, такт, крок, ключ ноти
const better = (w, sid, bar, s, k, e) => w !== e.w ? w > e.w : sid !== e.sid ? sid < e.sid : bar !== e.bar ? bar < e.bar : s !== e.s ? s < e.s : k < e.k;
const want = (acc, w, sid, bar, s, k) => acc.ex.length < 3 || better(w, sid, bar, s, k, acc.ex[2]);
function addEx(acc, c) { // c: {w,sid,bar,s,k,mk|txt,chord,full}
  const ex = acc.ex;
  for (const e of ex) if (e.w === c.w && e.sid === c.sid && e.bar === c.bar && e.s === c.s && e.k === c.k) return;
  let i = ex.length; while (i > 0 && better(c.w, c.sid, c.bar, c.s, c.k, ex[i - 1])) i--;
  ex.splice(i, 0, c); if (ex.length > 3) ex.length = 3;
}
function materialize(acc) { for (const e of acc.ex) if (e.mk) { const r = e.mk(); e.txt = r.txt; e.chord = r.chord; e.full = r.full; e.mk = null; } }
function mergeAcc(into, from) { into.n += from.n; into.d += from.d; into.c += from.c; into.nd += from.nd; into.dd += from.dd; for (const e of from.ex) addEx(into, e); }
const cell = (map, key) => map[key] || (map[key] = newAcc());

/* ---------- межі низького регістру (docs/harmony-rules.md) ---------- */
// lo — нижча нота, d — інтервал: 0 — гаразд, 1 — бруд 36–48, 2 — бруд суб-низу < 36
function mudKind(lo, d) {
  if (lo >= 48 || d === 0) return 0;
  if (lo < 36) return d < 12 && d !== 7 ? 2 : 0; // нижче 36 — лише ч5 або октава (≥ октави не звужує)
  if (lo < 40) return d < 7 ? 1 : 0;             // 36–40 — не менше ч5
  return d < 4 ? 1 : 0;                           // 40–48 — не менше в3
}

/* ---------- сценарій: пісня + фон ---------- */
function setupScenario(L, sc, barsOpt) {
  const { g, a } = L;
  L.seed(hash(sc.id));
  const song = g.makeSong(null, sc.genre, { seed: hash(sc.id + '#song'), key: sc.key });
  const offs = g.GENRES[sc.genre].famous[sc.prog];
  song.prog = offs.map(o => g.mkChord(song, o));
  for (let i = 0; i < sc.have; i++) song.prog[i] = g.mkChord(song, offs[i], sc.lvl); // зібрані акорди мають рівень lvl, решта — повні заготовки
  song.have = sc.have;
  a.SONG = song; a.G = { layers: {}, pedals: {}, p: { x: 0, y: 0 }, players: [], t: 0 };
  // повний цикл форми з game.html: перший прохід (вступ…) + один «loop» (куплет-2 має інший рисунок: sec.round>0)
  const sum = l => l.reduce((n, x) => n + x[1], 0), form = song.form;
  const bars = barsOpt || (form ? sum(form.first) + sum(form.loop) : 36), sd = 60 / song.bpm / 4;
  const keySet = new Set((song.mode === 'minor' ? MIN : MAJ).map(x => (song.key + x) % 12));
  if (sc.genre === 'blues') BLUES.forEach(x => keySet.add((song.key + x) % 12));
  const inKey = new Uint8Array(12); keySet.forEach(x => { inKey[x] = 1; });
  const fqCache = {}, ctCache = new Map(), maskCache = new Map(), dark = sc.genre === 'metal' || sc.genre === 'industrial';
  const S = {
    sc, song, bars, sd, dark, keySet, inKey, mode: song.mode, g, a, pch: [], fch: [], div: new Uint8Array(bars), isV: new Uint8Array(bars), dom: new Uint8Array(bars),
    ctO: [], ctF: [], avO: [], avF: [],
    fullQ: off => fqCache[off] || (fqCache[off] = g.mkChord(song, off).q),
    ct(c) { // тони акорда: власні pcs (рівень гравця) ∪ повний акорд жанру
      const k = c.off + '|' + (c.lvl || 0); let s = ctCache.get(k);
      if (!s) { s = new Set(c.pcs); for (const x of a.QU[this.fullQ(c.off)] || []) s.add((c.root + x) % 12); ctCache.set(k, s); }
      return s;
    },
    avoid(c, pc) { // → назва avoid-інтервалу чи null
      if (this.ct(c).has(pc)) return null;
      const r = (pc - c.root + 12) % 12, A = AVOID[this.fullQ(c.off)];
      if (dark && this.fullQ(c.off) === '5' && (r === 1 || r === 6)) return null; // метал/індастріал: b2 (фрігійська) і тритон над пауер-акордом — жанровий колір (docs/harmony-rules.md)
      return A && A.includes(r) ? REL[r] + ' над ' + this.fullQ(c.off) : null;
    },
    masks(c) { // [тони, avoid] як Uint8Array(12) — O(1) на ноту
      const k = c.off + '|' + (c.lvl || 0) + '|' + c.pcs.join(','); let m = maskCache.get(k);
      if (!m) { const ct = new Uint8Array(12), av = new Uint8Array(12); for (let pc = 0; pc < 12; pc++) { ct[pc] = this.ct(c).has(pc) ? 1 : 0; av[pc] = this.avoid(c, pc) ? 1 : 0; } m = [ct, av]; maskCache.set(k, m); }
      return m;
    },
  };
  for (let b = 0; b < bars; b++) {
    const p = g.chordAt(b), f = g.fullChordAt(b); S.pch.push(p); S.fch.push(f);
    const mp = S.masks(p), mf = S.masks(f); S.ctO.push(mp[0]); S.avO.push(mp[1]); S.ctF.push(mf[0]); S.avF.push(mf[1]);
    S.div[b] = p.pcs.length === f.pcs.length && p.pcs.every(x => f.pcs.includes(x)) && p.off === f.off ? 0 : 1;
    S.isV[b] = p.off === 7 || f.off === 7 ? 1 : 0;
    S.dom[b] = S.fullQ(f.off) === '7' || S.fullQ(p.off) === '7' ? 1 : 0;
  }
  const back = []; // фон: бас, акорди, мелодія-хук (барабани без висоти)
  for (let b = 0; b < bars; b++) for (let s = 0; s < 16; s++) for (const e of g.backingEvents(b, s)) {
    if (e.kind === 'drum' || e.midi === undefined) continue;
    const d = effDur(e, sd, 'backing');
    back.push({ midi: e.midi, pc: e.midi % 12, bar: b, s, abs: b * 16 + s, end: b * 16 + s + d, w: metricW(s) * Math.max(.5, Math.min(d, 4)), src: 'backing:' + e.kind, inst: 'backing', bass: e.kind === 'bass' });
  }
  S.back = back; S.backIdx = makeIndex(back, bars * 16);
  S.backParts = { bass: back.filter(n => n.bass), chord: back.filter(n => n.src === 'backing:chord'), hook: back.filter(n => n.src === 'backing:hook') };
  S.vcache = new Map(); // voiced(акорд, $v_модифікатор) однаковий для всіх шарів інструмента → рахуємо один раз на модифікатор
  return S;
}
function makeIndex(notes, len) {
  // by[t] — ноти, що звучать у такті-кроці [t, t+1): шукати партнерів лише в тих кроках, де звучить x
  const by = Array.from({ length: len + 1 }, () => []);
  for (const n of notes) for (let t = Math.floor(n.abs), e = Math.min(len, Math.ceil(n.end)); t < e || t === Math.floor(n.abs); t++) { if (t > len) break; by[t].push(n); }
  return { by, len };
}
function voicedGrid(S, mod) { // mod=null → акорд гравця як є
  if (!mod) return null;
  let v = S.vcache.get(mod); if (v) return v;
  const lay = { ['$v_' + mod]: 1 }; v = new Array(S.bars * 16);
  for (let b = 0; b < S.bars; b++) for (let s = 0; s < 16; s++) v[b * 16 + s] = S.g.voiced(S.pch[b], lay, s, b);
  S.vcache.set(mod, v); return v;
}
function genNotes(S, inst, Ly, L, layers, errs, key, mod) {
  const { g, a, sd } = S; a.charKey = inst; a.G.layers = layers;
  const notes = [], strings = new Map(), grid = voicedGrid(S, mod), isBass = inst === 'bass', src = inst + ':' + Ly.id;
  for (let b = 0; b < S.bars; b++) for (let s = 0; s < 16; s++) {
    let evs;
    try { evs = Ly.steps(grid ? grid[b * 16 + s] : S.pch[b], s, b, L); } catch (e) { errs[key] = (errs[key] || 0) + 1; continue; }
    if (!evs || !evs.length) continue;
    for (const e of evs) {
      if (e.midi === undefined || e.drum || e.silent || e.art === 'dead' || e.mute || !Number.isFinite(e.midi)) continue;
      const d = effDur(e, sd, inst), abs = b * 16 + s, n = { midi: e.midi, pc: ((e.midi % 12) + 12) % 12, bar: b, s, abs, end: abs + d, w: metricW(s) * Math.max(.5, Math.min(d, 4)), inst, src, bass: isBass };
      if (inst === 'guitar' && e.str != null && e.art !== 'harmonic') { // нова нота на тій самій струні глушить попередню (dampString у playBuffered)
        const p = strings.get(Ly.id + e.str); if (p && p.abs < abs && p.end > abs) p.end = abs; strings.set(Ly.id + e.str, n);
      }
      notes.push(n);
    }
  }
  return notes;
}

/* ---------- вертикаль: тертя, тритон, бруд низу, нижче баса ---------- */
/* для кожної ноти x шукає ноти y, що звучать одночасно; кожен прапорець — за першим знайденим партнером.
   emit(kind, x, y, k): kind ∈ clash | tritone | mud | sub | below. belowChk — перевіряти «нижче баса» (y.bass). */
function vertical(S, xs, yIdx, belowChk, emit) {
  const { ctF, ctO } = S;
  let dsum = 0;
  for (const x of xs) {
    let fl = 0; // біти: 1 clash, 2 tritone, 4 mud, 8 sub, 16 below
    dsum += x.w;
    const t0 = Math.max(0, Math.floor(x.abs)), t1 = Math.min(yIdx.len, Math.max(t0 + 1, Math.ceil(x.end))), xd = x.end - x.abs, xm = x.midi;
    for (let t = t0; t < t1 && fl !== 31; t++) { const arr = yIdx.by[t]; for (let i = 0; i < arr.length; i++) {
      const y = arr[i], ym = y.midi; if (ym === xm) continue;
      const d = xm > ym ? xm - ym : ym - xm, lo = xm < ym ? xm : ym;
      // дешева відсічка за інтервалом/регістром до перевірки перекриття в часі
      let ck = d === 1 ? 1 : d === 11 ? 2 : d === 13 ? 3 : (d % 12 === 6 && d <= 18) ? 4 : 0;
      if (ck === 4 ? fl & 2 : fl & 1) ck = 0;
      let mk = lo < 48 ? mudKind(lo, d) : 0; if (mk === 1 ? fl & 4 : fl & 8) mk = 0;
      const bl = belowChk && !(fl & 16) && y.bass && xm < ym;
      if (!ck && !mk && !bl) continue;
      const ov = (x.end < y.end ? x.end : y.end) - (x.abs > y.abs ? x.abs : y.abs); // хвіст < ~1,5 кроку (≈0,2 с) — це розмазування, а не одночасне звучання
      if (ov <= 0) continue; const yd = y.end - y.abs; if (ov < Math.min(1.5, .8 * Math.min(xd, yd))) continue;
      const bar = Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16));
      if (ck) {
        const cf = ctF[bar], cp = ctO[bar], same = (cf[x.pc] && cf[y.pc]) || (cp[x.pc] && cp[y.pc]); // обидві — тони одного акорда: це його будова
        if (!same) {
          if (ck === 4) { if (!S.dom[bar]) { fl |= 2; emit('tritone', x, y, 'тритон'); } } // тритон у домінанті — норма
          else { fl |= 1; emit('clash', x, y, ck === 1 ? 'm2' : ck === 2 ? 'M7' : 'm9'); }
        }
      }
      if (mk === 1) { fl |= 4; emit('mud', x, y, ''); } else if (mk === 2) { fl |= 8; emit('sub', x, y, ''); }
      if (bl) { fl |= 16; emit('below', x, y, ''); }
    } }
  }
  return dsum;
}

/* Хроматичний підхід: нота баса на кроках 12–15, що лежить на півтон нижче/вище кореня наступного такту (акорда гравця АБО повного акорда фону).
   docs/harmony-rules.md не вважає її помилкою: вона розв'язується в корінь. 1 — підхід (не рахуємо avoid/out_of_key), 2 — ще й слабка 16-та (непарний крок, ≤ 1,5 кроку): не рахуємо тертя з фоном. */
function approachKind(S, n) {
  if (n.s < 12 || n.bar + 1 >= S.bars) return 0;
  const near = r => { const d = (n.pc - r + 12) % 12; return d === 1 || d === 11; };
  if (!near(S.pch[n.bar + 1].root) && !near(S.fch[n.bar + 1].root)) return 0;
  return n.s % 2 === 1 && n.end - n.abs <= 1.5 ? 2 : 1;
}

/* ---------- аналіз проходу одного шару/модифікатора ---------- */
function analyze(S, part, notes, ctx, o) {
  const { accL, sumAcc } = ctx, sc = S.sc, sid = sc.id, loc = {}, tag = o.tag || '', A = m => loc[m] || (loc[m] = newAcc());
  const hit = (m, n, w, dv) => { const x = A(m); x.n += w; x.c++; if (dv) x.nd += w; return x; };
  const info = (n, txt) => ({ txt: txt + ' ' + tag, chord: S.pch[n.bar].name, full: S.fch[n.bar].name });
  const lt = (S.song.key + 11) % 12, minor = S.mode === 'minor';
  let dsum = 0, ddiv = 0;
  for (const n of notes) {
    const bar = n.bar, pc = n.pc, dv = S.div[bar], w = n.w;
    dsum += w; if (dv) ddiv += w;
    n.appr = o.isBass ? approachKind(S, n) : 0; // хроматичний підхід баса до кореня наступного такту — жанровий прийом, не «avoid»
    if (n.appr) continue; // у «зваженому часі» (d) нота лишається, але як брудна тут не рахується
    if (S.avF[bar][pc]) { const x = hit('avoid_full', n, w, dv); if (want(x, w, sid, bar, n.s, n.midi)) addEx(x, { w, sid, bar, s: n.s, k: n.midi, mk: () => { const af = S.avoid(S.fch[bar], pc); return info(n, noteName(n.midi) + ' (' + af + ') проти ' + S.fch[bar].name + ', гравець грає ' + S.pch[bar].name); } }); }
    if (S.avO[bar][pc]) { const x = hit('avoid_own', n, w, dv); if (want(x, w, sid, bar, n.s, n.midi)) addEx(x, { w, sid, bar, s: n.s, k: n.midi, mk: () => info(n, noteName(n.midi) + ' (' + S.avoid(S.pch[bar], pc) + ') проти ' + S.pch[bar].name) }); }
    if (!S.inKey[pc]) { // метал/індастріал: b2 і тритон над коренем пауер-акорда — жанровий колір, не «поза ладом»
      if (minor && pc === lt) {
        if (S.isV[bar]) { const x = hit('leadtone_V', n, w, dv); if (want(x, w, sid, bar, n.s, n.midi)) addEx(x, { w, sid, bar, s: n.s, k: n.midi, mk: () => info(n, noteName(n.midi) + ' ввідний тон над V ' + S.pch[bar].name) }); }
        else { const x = hit('out_of_key', n, w, dv); if (want(x, w, sid, bar, n.s, n.midi)) addEx(x, { w, sid, bar, s: n.s, k: n.midi, mk: () => info(n, noteName(n.midi) + ' (ввідний тон поза V) над ' + S.pch[bar].name) }); }
      } else if (!S.ctO[bar][pc] && !S.ctF[bar][pc] && !(S.dark && S.fullQ(S.pch[bar].off) === '5' && [1, 6].includes((pc - S.pch[bar].root + 12) % 12))) { const x = hit('out_of_key', n, w, dv); if (want(x, w, sid, bar, n.s, n.midi)) addEx(x, { w, sid, bar, s: n.s, k: n.midi, mk: () => info(n, noteName(n.midi) + ' поза ладом ' + NN[S.song.key] + ' ' + S.mode + ' над ' + S.pch[bar].name) }); }
    }
  }
  for (const m of ['avoid_full', 'avoid_own', 'out_of_key', 'leadtone_V']) { const x = A(m); x.d += dsum; x.dd += ddiv; }
  const belowChk = !o.isBass, KM = { clash: 'clash_backing', tritone: 'tritone', mud: 'mud', sub: 'mud_sub', below: 'below_bass' }, KT = { clash: '', tritone: '', mud: 'бруд ', sub: 'суб-бруд ', below: 'нижче баса ' };
  const vd = vertical(S, notes, S.backIdx, belowChk, (kind, x, y, k) => {
    if (S.dark && (kind === 'clash' || kind === 'tritone') && S.fullQ(S.pch[x.bar].off) === '5' && [1, 6].includes((x.pc - S.pch[x.bar].root + 12) % 12)) return; // метал/індастріал: b2 і тритон від кореня пауер-акорда — жанровий колір (docs/harmony-rules.md)
    if (x.appr === 2 && (kind === 'clash' || kind === 'tritone')) return; // підхід на слабкій 16-й частці (≤ 1,5 кроку): тертя з фоном не рахуємо
    const m = KM[kind], dv = S.div[x.bar], c = hit(m, x, x.w, dv), kk = x.midi * 128 + y.midi;
    if (want(c, x.w, sid, x.bar, x.s, kk)) addEx(c, { w: x.w, sid, bar: x.bar, s: x.s, k: kk, mk: () => info(x, (k ? k + ' ' : KT[kind]) + noteName(x.midi) + '+' + noteName(y.midi) + ' (' + y.src.replace('backing:', 'фон ') + ') над ' + S.fch[Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16))].name + ', гравець ' + S.pch[x.bar].name) });
  });
  for (const m of ['clash_backing', 'tritone', 'mud', 'mud_sub', 'below_bass']) { const x = A(m); x.d += vd; x.dd += ddiv; }
  // бруд низу всередині партії: ноти, що б'ють разом (акордова будова, напр. кластер)
  const byAbs = new Map(); for (const n of notes) if (n.midi < 48) { const k = Math.round(n.abs); const g = byAbs.get(k); if (g) g.push(n); else byAbs.set(k, [n]); }
  for (const grp of byAbs.values()) if (grp.length > 1) {
    const s = grp.slice().sort((x, y) => x.midi - y.midi); let pm = null, ps = null;
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = mudKind(s[i].midi, s[j].midi - s[i].midi); if (k === 1 && !pm) pm = [s[i], s[j]]; else if (k === 2 && !ps) ps = [s[i], s[j]]; }
    for (const [m, pr, lbl] of [['mud', pm, 'бруд'], ['mud_sub', ps, 'суб-бруд']]) if (pr) {
      const n0 = s[0], x = hit(m, n0, n0.w, S.div[n0.bar]), kk = pr[0].midi * 128 + pr[1].midi;
      if (want(x, n0.w, sid, n0.bar, n0.s, kk)) addEx(x, { w: n0.w, sid, bar: n0.bar, s: n0.s, k: kk, mk: () => info(n0, lbl + ' у партії ' + noteName(pr[0].midi) + '+' + noteName(pr[1].midi) + ' над ' + S.pch[n0.bar].name) });
    }
  }
  flush(S, part, loc, ctx, o);
}
/* злиття локальних лічильників проходу в глобальні (за жанром/партією/рівнем/метрикою) і в зведення */
function flush(S, part, loc, ctx, o) {
  const genre = S.sc.genre, parts = o.also ? [part, ...o.also] : [part];
  for (const m of Object.keys(loc)) {
    const x = loc[m]; if (!x.d && !x.n) continue; materialize(x);
    for (const p of parts) mergeAcc(cell(ctx.accL, genre + '\t' + p + '\t' + o.L + '\t' + m), x);
    if (o.group) sumAdd(ctx.sumAcc, o.group, m, genre, o.label, S.sc.have, x);
  }
}
const DIMS = ['g', 'i', 'h', 'gi', 's'];
function sumAdd(sumAcc, group, metric, genre, label, have, x) {
  const G = sumAcc[group] || (sumAcc[group] = {}), M = G[metric] || (G[metric] = { g: {}, i: {}, h: {}, gi: {}, s: { div: newAcc(), same: newAcc() } });
  for (const [dim, key] of [['g', genre], ['i', label], ['h', 'have' + have], ['gi', genre + '\t' + label]]) { const c = cell(M[dim], key); c.n += x.n; c.d += x.d; c.c += x.c; c.nd += x.nd; c.dd += x.dd; }
  M.s.div.n += x.nd; M.s.div.d += x.dd; M.s.same.n += x.n - x.nd; M.s.same.d += x.d - x.dd;
}

/* ---------- хук: lead/mel за motifNote ---------- */
function analyzeHook(S, ctx) {
  const { a, pch, fch } = S, sid = S.sc.id, loc = {}, A = k => loc[k] || (loc[k] = newAcc()), seq = { lead: new Map(), mel: new Map() };
  const phr = b => { try { return S.g.phraseName(b); } catch (e) { return ''; } }, tg = ' [' + S.sc.genre + ' ' + NN[S.song.key] + ' have' + S.sc.have + ']';
  for (const role of ['lead', 'mel']) for (let b = 0; b < S.bars; b++) for (let s = 0; s < 16; s++) {
    const m = a.motifNote(role, b, s, pch[b]); if (m === null || m === undefined) continue;
    seq[role].set(b * 16 + s, m);
    const w = metricW(s), pc = ((m % 12) + 12) % 12, part = 'hook:' + role, dv = S.div[b];
    const x1 = A(part + '\thook_avoid_full'), x2 = A(part + '\thook_avoid_own'); x1.d += w; x2.d += w; if (dv) { x1.dd += w; x2.dd += w; }
    if (S.avF[b][pc]) { x1.n += w; x1.c++; if (dv) x1.nd += w; if (want(x1, w, sid, b, s, m)) addEx(x1, { w, sid, bar: b, s, k: m, mk: () => ({ txt: noteName(m) + ' (' + S.avoid(fch[b], pc) + ') проти ' + fch[b].name + tg, chord: pch[b].name, full: fch[b].name }) }); }
    if (S.avO[b][pc]) { x2.n += w; x2.c++; if (dv) x2.nd += w; if (want(x2, w, sid, b, s, m)) addEx(x2, { w, sid, bar: b, s, k: m, mk: () => ({ txt: noteName(m) + ' (' + S.avoid(pch[b], pc) + ') проти ' + pch[b].name + tg, chord: pch[b].name, full: fch[b].name }) }); }
    if (s % 4 === 0) {
      const x = A(part + '\thook_nonct_full'), y = A(part + '\thook_nonct_own'); x.d += w; y.d += w; if (dv) { x.dd += w; y.dd += w; }
      if (!S.ctF[b][pc]) { x.n += w; x.c++; if (dv) x.nd += w; if (want(x, w, sid, b, s, m)) addEx(x, { w, sid, bar: b, s, k: m, mk: () => ({ txt: noteName(m) + ' не тон ' + fch[b].name + ' (гравець ' + pch[b].name + ', фраза ' + phr(b) + ')' + tg, chord: pch[b].name, full: fch[b].name }) }); }
      if (!S.ctO[b][pc]) { y.n += w; y.c++; if (dv) y.nd += w; if (want(y, w, sid, b, s, m)) addEx(y, { w, sid, bar: b, s, k: m, mk: () => ({ txt: noteName(m) + ' не тон ' + pch[b].name + ' (фон ' + fch[b].name + ', фраза ' + phr(b) + ')' + tg, chord: pch[b].name, full: fch[b].name }) }); }
    }
  }
  for (const [abs, m] of seq.lead) if (seq.mel.has(abs)) {
    const o = seq.mel.get(abs), d = Math.abs(m - o), x = A('hook:lead+mel\thook_seconds'), b = abs >> 4, s = abs & 15; x.d += 1; if (S.div[b]) x.dd += 1;
    if (d === 1 || d === 2) { const w = d === 1 ? 2 : 1; x.n += 1; x.c++; if (S.div[b]) x.nd += 1; if (want(x, w, sid, b, s, m * 128 + o)) addEx(x, { w, sid, bar: b, s, k: m * 128 + o, mk: () => ({ txt: (d === 1 ? 'm2 ' : 'M2 ') + noteName(m) + '/' + noteName(o) + ' над ' + pch[b].name + tg, chord: pch[b].name, full: fch[b].name }) }); }
  }
  for (const k of Object.keys(loc)) {
    const [part, metric] = k.split('\t'), x = loc[k]; materialize(x);
    mergeAcc(cell(ctx.accL, S.sc.genre + '\t' + part + '\t-\t' + metric), x);
    sumAdd(ctx.sumAcc, 'backing', metric, S.sc.genre, part, S.sc.have, x);
  }
}

/* ---------- один сценарій ---------- */
function runScenario(L, sc, ctx, barsOpt) {
  const { g } = L, S = setupScenario(L, sc, barsOpt), errs = ctx.errs;
  const tagSc = '[' + sc.genre + ' ' + g.GENRES[sc.genre].famous[sc.prog].join('-') + ' ' + NN[S.song.key] + ' have' + sc.have + ' lvl' + sc.lvl + ']';
  for (const k of ['bass', 'chord', 'hook']) analyze(S, 'backing:' + k, S.backParts[k], ctx, { L: '-', tag: tagSc, isBass: k === 'bass', group: 'backing', label: 'backing:' + k });
  L.seed(hash(sc.id + '#hook')); analyzeHook(S, ctx);
  const kit = {};
  for (const inst of Object.keys(g.LAYERS)) {
    if (inst === 'drums') continue;
    const mods = Object.keys((g.VOICINGS && g.VOICINGS[inst]) || {});
    g.LAYERS[inst].forEach((Ly, li) => {
      for (const Lv of [1, 3, 5]) {
        L.seed(hash(sc.id + inst + Ly.id + Lv));
        const notes = genNotes(S, inst, Ly, Lv, { [Ly.id]: Lv }, errs, inst + ':' + Ly.id, null);
        // на L3 той самий прохід іде ще й у «базу» для порівняння з модифікаторами
        analyze(S, inst + ':' + Ly.id, notes, ctx, { L: 'L' + Lv, tag: tagSc + ' L' + Lv, isBass: inst === 'bass', group: 'layers', label: inst, also: Lv === 3 && sc.mods && mods.length ? [inst + ':~base'] : null });
        if (Lv === 3 && sc.pair && li < 5) (kit[inst] || (kit[inst] = [])).push(...notes);
      }
      if (sc.mods) for (const mod of mods) {
        L.seed(hash(sc.id + inst + Ly.id + mod));
        const notes = genNotes(S, inst, Ly, 3, { [Ly.id]: 3, ['$v_' + mod]: 1 }, errs, inst + ':' + Ly.id + '+' + mod, mod);
        analyze(S, inst + ':+' + mod, notes, ctx, { L: 'L3', tag: tagSc + ' ' + Ly.id + '+' + mod, isBass: inst === 'bass' });
      }
    });
  }
  if (sc.pair) analyzePairs(S, kit, ctx, tagSc);
}
/* парний аналіз: гурт із різних героїв (по 5 перших партій кожного, L3); кожна впорядкована пара інструментів */
function analyzePairs(S, kit, ctx, tag) {
  const idx = {}, insts = Object.keys(kit).sort(), sid = S.sc.id, KM = { clash: 'clash_pair', tritone: 'tritone_pair', mud: 'mud_pair', sub: 'mud_sub_pair', below: 'below_bass_pair' };
  for (const i of insts) idx[i] = makeIndex(kit[i], S.bars * 16);
  for (const A of insts) for (const B of insts) if (A !== B) {
    const loc = {}, label = A + '>' + B;
    const dsum = vertical(S, kit[A], idx[B], B === 'bass' && A !== 'bass', (kind, x, y, k) => {
      const m = KM[kind], c = loc[m] || (loc[m] = newAcc()), kk = x.midi * 128 + y.midi; c.n += x.w; c.c++;
      if (want(c, x.w, sid, x.bar, x.s, kk)) addEx(c, { w: x.w, sid, bar: x.bar, s: x.s, k: kk, mk: () => ({ txt: (k ? k + ' ' : kind === 'mud' ? 'бруд ' : kind === 'sub' ? 'суб-бруд ' : 'нижче баса ') + noteName(x.midi) + ' (' + x.src + ') + ' + noteName(y.midi) + ' (' + y.src + ') над ' + S.fch[Math.min(S.bars - 1, Math.floor(Math.max(x.abs, y.abs) / 16))].name + ' ' + tag, chord: S.pch[x.bar].name, full: S.fch[x.bar].name }) });
    });
    for (const m of PAIR_METRICS) { if (m === 'below_bass_pair' && B !== 'bass') continue; const c = loc[m] || newAcc(); c.d = dsum; materialize(c); mergeAcc(cell(ctx.pairAcc, S.sc.genre + '\t' + label + '\t3\t' + m), c); sumAdd(ctx.sumAcc, 'pairs', m, S.sc.genre, label, S.sc.have, c); }
  }
}

/* ---------- перелік сценаріїв ---------- */
/* ПОВНИЙ перебір (за замовчуванням): кожен жанр × кожна famous-прогресія × тональність (2: E і A — мод береться з жанру, тож це
   «мажорний»/«мінорний» боки залежно від жанру, а різні висоти змінюють регістри нижче 48) × have 1..4 × рівень акорда 1..3 ×
   L=1,3,5 × повний цикл форми (first 36 + loop 32 = 68 тактів) × усі шари інструментів × кожен $v_* окремо (L3, на have=4) + фон + хук + пари героїв.
   quick — по одній прогресії, одна тональність, два набори (have4/lvl1, have1/lvl1); модифікатори й пари лише в першому. */
const KEYS = [4, 9, 2, 7, 11, 0];
const COMBOS_QUICK = [[4, 1], [1, 1]], COMBOS_FULL = [1, 2, 3, 4].flatMap(h => [1, 2, 3].map(l => [h, l]));
function buildScenarios(L, o = {}) {
  const genres = o.genres && o.genres.length ? o.genres : Object.keys(L.g.GENRES), keys = KEYS.slice(0, o.keys || (o.quick ? 1 : 2)), combos = o.combos || (o.quick ? COMBOS_QUICK : COMBOS_FULL), out = [];
  for (const genre of genres) {
    const F = L.g.GENRES[genre].famous, progs = F.map((_, i) => i).slice(0, o.progs || (o.quick ? 1 : F.length));
    for (const prog of progs) keys.forEach((key, ki) => combos.forEach(([have, lvl]) => out.push({
      id: [genre, prog, key, have, lvl].join('|'), genre, prog, key, have, lvl,
      mods: o.mods !== undefined ? o.mods : (o.quick ? (have === 4 && lvl === 1) : have === 4), // $v_* змінюють лише голосіння акорда гравця й не залежать від have → усі рівні lvl, але лише have=4 (інакше ×4 часу)
      pair: o.pair !== undefined ? o.pair : (o.quick ? (have === 4 && lvl === 1 && ki === 0) : true),
    })));
  }
  return out;
}

/* ---------- збірка звіту ---------- */
const pctOf = c => c.d > 0 ? 100 * c.n / c.d : 0;
function build(ctx, scenarios) {
  const { acc, pairAcc, errs, sumAcc } = ctx;
  const val = pctOf, rows = [], baseRows = new Map(), modRows = [];
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
  // зведення: % зваженого часу по жанру / інструменту / have / (жанр×інструмент) + розподіл «такти, де гравець ≠ фон»
  const fmt = m => Object.fromEntries(Object.keys(m).sort().map(x => [x, +pctOf(m[x]).toFixed(3)]));
  const summary = {};
  for (const grp of Object.keys(sumAcc)) {
    summary[grp] = {};
    for (const me of Object.keys(sumAcc[grp]).sort()) {
      const M = sumAcc[grp][me];
      summary[grp][me] = { byGenre: fmt(M.g), byInstrument: fmt(M.i), byHave: fmt(M.h), byGenreInstrument: fmt(M.gi),
        split: { diverge: +pctOf(M.s.div).toFixed(3), same: +pctOf(M.s.same).toFixed(3), divergeShare: +(100 * M.s.div.d / Math.max(1e-9, M.s.div.d + M.s.same.d)).toFixed(2) } };
    }
  }
  return { ranked, mods, pairs, summary, errors: errs, scenarios: scenarios.length };
}

/* Один процес і один vm-контекст: loadGame — один раз на runAudit (або передано o.L). Між сценаріями живуть лише лічильники. */
async function runAudit(o = {}) {
  const t0 = Date.now(), L = o.L || loadGame(), scenarios = o.scenarios || buildScenarios(L, o);
  const ctx = { accL: {}, acc: null, pairAcc: {}, errs: {}, sumAcc: {} }; ctx.acc = ctx.accL;
  let peakHeap = 0, peakRss = 0; const mem = () => { const m = process.memoryUsage(); if (m.heapUsed > peakHeap) peakHeap = m.heapUsed; if (m.rss > peakRss) peakRss = m.rss; };
  mem();
  for (let i = 0; i < scenarios.length; i++) {
    runScenario(L, scenarios[i], ctx, o.bars);
    mem(); if (o.onProgress) o.onProgress(i + 1, scenarios.length);
  }
  const R = build(ctx, scenarios);
  R.meta = { seconds: +((Date.now() - t0) / 1000).toFixed(1), peakHeapMB: +(peakHeap / 1048576).toFixed(0), peakRssMB: +(peakRss / 1048576).toFixed(0), scenarios: scenarios.length, keys: [...new Set(scenarios.map(s => s.key))], bars: o.bars || 'форма first+loop з game.html' };
  if (o.list) R.scenarioList = scenarios.map(s => s.id);
  return R;
}

/* ---------- друк ---------- */
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
const SUM_METRICS = ['avoid_full', 'avoid_own', 'out_of_key', 'clash_backing', 'tritone', 'mud', 'mud_sub', 'below_bass'];
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
  const Sm = R.summary.layers || {}, ms = SUM_METRICS.filter(m => Sm[m]);
  const table = (title, key, names) => { P('\n' + title); P(pad('', 14) + ms.map(m => pad(m, 15)).join('')); for (const g of names) P(pad(g, 14) + ms.map(m => pad(((Sm[m][key] || {})[g] ?? 0).toFixed(1), 15)).join('')); };
  const names = key => [...new Set(ms.flatMap(m => Object.keys(Sm[m][key] || {})))].sort();
  P('\n' + line + '\nЗВЕДЕННЯ (% зваженого часу по всіх мелодійних партіях, L1/3/5, без модифікаторів)\n' + line);
  table('ПО ЖАНРАХ', 'byGenre', names('byGenre')); table('ПО ІНСТРУМЕНТАХ', 'byInstrument', names('byInstrument')); table('ПО have (скільки акордів зібрав гравець)', 'byHave', names('byHave'));
  P('\nФОН ПРОТИ ГРАВЦЯ: % у тактах, де chordAt ≠ fullChordAt (diverge) і де збігаються (same); частка часу з розбіжністю');
  for (const m of ms) P(pad(m, 16) + 'diverge ' + pad(Sm[m].split.diverge.toFixed(1), 8) + 'same ' + pad(Sm[m].split.same.toFixed(1), 8) + 'частка розбіжних тактів ' + Sm[m].split.divergeShare + '%');
  if (Object.keys(R.errors).length) P('\nВИНЯТКИ у партіях (ці кроки виміряти не вдалося): ' + JSON.stringify(R.errors));
  const mt = R.meta; if (mt) P('\nПАМʼЯТЬ: пік heapUsed ' + mt.peakHeapMB + ' МБ, пік rss ' + mt.peakRssMB + ' МБ');
}

/* markdown-зведення для docs/harmony-audit-results.md */
function toMarkdown(R, top = 30) {
  const o = [], Sm = R.summary.layers || {}, ms = SUM_METRICS.filter(m => Sm[m]), f = x => (x ?? 0).toFixed(1);
  const names = key => [...new Set(ms.flatMap(m => Object.keys(Sm[m][key] || {})))].sort();
  const tbl = (key, title) => { o.push('### ' + title, '', '| | ' + ms.join(' | ') + ' |', '|---|' + ms.map(() => '---:').join('|') + '|'); for (const n of names(key)) o.push('| ' + n + ' | ' + ms.map(m => f((Sm[m][key] || {})[n])).join(' | ') + ' |'); o.push(''); };
  o.push('## Зведення аудиту гармонії', '', '% зваженого часу мелодійних партій (L1/3/5, без модифікаторів). Сценаріїв: ' + R.scenarios + (R.meta ? ', час ' + R.meta.seconds + ' с, пік heap ' + R.meta.peakHeapMB + ' МБ' : '') + '.', '');
  tbl('byGenre', 'Жанр × метрика'); tbl('byInstrument', 'Інструмент × метрика'); tbl('byHave', 'have (зібрано акордів) × метрика');
  o.push('### Фон проти гравця (такти, де chordAt ≠ fullChordAt)', '', '| метрика | розбіжні такти, % | однакові такти, % | частка розбіжних тактів, % |', '|---|---:|---:|---:|');
  for (const m of ms) o.push('| ' + m + ' | ' + f(Sm[m].split.diverge) + ' | ' + f(Sm[m].split.same) + ' | ' + f(Sm[m].split.divergeShare) + ' |');
  o.push('', '### Фон і хук (частини фону)', '');
  const Sb = R.summary.backing || {}, bm = Object.keys(Sb).sort(), bn = [...new Set(bm.flatMap(m => Object.keys(Sb[m].byInstrument)))].sort();
  o.push('| | ' + bm.join(' | ') + ' |', '|---|' + bm.map(() => '---:').join('|') + '|'); for (const n of bn) o.push('| ' + n + ' | ' + bm.map(m => Sb[m].byInstrument[n] === undefined ? '' : f(Sb[m].byInstrument[n])).join(' | ') + ' |');
  o.push('', '### Топ-' + top + ' найгірших (жанр × партія × метрика)', '', '| # | жанр | партія | метрика | % | рівень | приклад |', '|--:|---|---|---|--:|---|---|');
  R.ranked.slice(0, top).forEach((r, i) => o.push('| ' + (i + 1) + ' | ' + r.genre + ' | ' + r.part + ' | ' + r.metric + ' | ' + f(r.value) + ' | ' + r.L + ' | ' + (r.examples[0] ? r.examples[0].text.replace(/\|/g, '/') : '') + ' |'));
  o.push('', '### Модифікатори $v_* (топ-15 за приростом)', '', '| жанр | партія | метрика | % | база | Δ |', '|---|---|---|--:|--:|--:|');
  for (const r of R.mods.slice(0, 15)) o.push('| ' + r.genre + ' | ' + r.part + ' | ' + r.metric + ' | ' + f(r.value) + ' | ' + f(r.base) + ' | ' + f(r.delta) + ' |');
  o.push('', '### Пари інструментів (топ-15)', '', '| жанр | пара | метрика | % |', '|---|---|---|--:|');
  for (const r of R.pairs.slice(0, 15)) o.push('| ' + r.genre + ' | ' + r.part + ' | ' + r.metric + ' | ' + f(r.value) + ' |');
  return o.join('\n') + '\n';
}

module.exports = { runAudit, buildScenarios, loadGame, printReport, toMarkdown, SEV, METRIC_TEXT };

if (require.main === module) (async () => {
  const argv = process.argv.slice(2), opt = {}, val = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  opt.quick = argv.includes('--quick'); if (val('--keys')) opt.keys = +val('--keys'); if (val('--bars')) opt.bars = +val('--bars');
  if (val('--genre')) opt.genres = val('--genre').split(','); if (val('--progs')) opt.progs = +val('--progs');
  const out = val('--out') || path.join(__dirname, '..', 'tools', 'harmony-report.json');
  if (!argv.includes('--quiet')) opt.onProgress = (i, n) => { if (i % 50 === 0 || i === n) process.stderr.write('\r  сценарій ' + i + '/' + n); };
  const R = await runAudit(opt); delete opt.onProgress; if (!argv.includes('--quiet')) process.stderr.write('\n');
  R.meta.options = opt; R.meta.metrics = METRIC_TEXT; R.meta.severity = SEV;
  const slim = { ...R, ranked: R.ranked.filter(r => r.value > 0), mods: R.mods.filter(r => r.value > 0 || r.delta !== 0) }; // у JSON — лише ненульові рядки
  fs.writeFileSync(out, JSON.stringify(slim));
  if (val('--md')) fs.writeFileSync(val('--md'), toMarkdown(R));
  if (!argv.includes('--quiet')) printReport(R, +val('--top') || 60);
  console.log('\nJSON: ' + path.relative(process.cwd(), out) + ' · ' + R.meta.seconds + ' с · пік heap ' + R.meta.peakHeapMB + ' МБ, rss ' + R.meta.peakRssMB + ' МБ');
})();
