'use strict';
/* Перевірка хуків на слух і очима: таблиця нот хука (такт, крок, акорд, MIDI, назва, роль) + прості WAV у tools/out/.
   node tools/hook-dump.js [--seed N] [--tpl id] [--bars 8] [--no-wav] [--only rock,chanson,accordion]
   Випадки: rock (lead, гітара), chanson (mel, піаніно), accordion (mel у регістрі акордеона, жанр chanson_ua; у грі акордеон не грає SONG.mel —
   це та сама лінія, що її грають флейта/сакс через hookMove, у регістрі 55–79). Кожен — при have=1 і have=4; для кожного ще «before» (старий генератор, fix.legacy).
   WAV: моно 44.1 кГц 16 біт; мелодія — пилка/квадрат з огинаючою, тихий бас-корінь акорда такту, клік на долю, темп пісні. Нічого не змінює в грі.
   Завантаження гри — як у tools/harmony-audit.js (vm-контекст, засівний Math.random). */
const fs = require('node:fs'), path = require('node:path');
const { loadGame } = require('./harmony-audit.js');
const argv = process.argv.slice(2), val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SEED = +val('--seed', 7), BARS = +val('--bars', 8), TPL = val('--tpl', undefined), WAV = !argv.includes('--no-wav');
const ONLY = val('--only', 'rock,chanson,accordion').split(',');
const OUT = path.join(__dirname, 'out');
const NN = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'], name = m => NN[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const CASES = [
  { id: 'rock', genre: 'rock', key: 4, role: 'lead', file: 'hook-rock', wave: 'saw' },
  { id: 'chanson', genre: 'chanson', key: 2, role: 'mel', file: 'hook-chanson', wave: 'square' },
  { id: 'accordion', genre: 'chanson_ua', key: 9, role: 'mel', file: 'hook-accordion', wave: 'square', fold: [55, 79] },
].filter(c => ONLY.includes(c.id));

const L = loadGame(), g = L.g, a = L.a;
const roleOf = (m, ch, key, minor) => { const d = (((m - ch.root) % 12) + 12) % 12; return d === 0 ? 'корінь' : d === 3 || d === 4 ? 'терція' : d === 7 ? 'квінта' : ch.pcs.includes(((m % 12) + 12) % 12) ? 'тон акорда' : 'прохідна'; };
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };

// ноти хука на BARS тактів: [{abs, bar, s, ch, midi}]
function notes(c, legacy, have) {
  L.seed(SEED);
  const song = g.makeSong(null, c.genre, { seed: SEED, key: c.key, ...(legacy ? { legacy: true } : TPL ? { tpl: TPL } : {}) });
  song.have = have; a.SONG = song;
  const out = [];
  for (let bar = 0; bar < BARS; bar++) {
    const ch = g.chordAt(bar);
    for (let s = 0; s < 16; s++) {
      let m;
      if (c.fold) { // як melodyAt: фраза мелодії, hookMove, згортання в регістр інструмента
        const h = g.hookPhrase('mel', bar), p = (bar % 2) * 16 + s;
        m = h.pos.includes(p) && h.mot[p] !== undefined ? fold(g.hookMove(h.mot[p], ch, s), c.fold[0], c.fold[1]) : null;
      } else m = a.motifNote(c.role, bar, s, ch);
      if (m !== null && m !== undefined) out.push({ bar, s, ch, midi: m });
    }
  }
  return { song, out };
}
function table(c, legacy, have) {
  const { song, out } = notes(c, legacy, have);
  const head = `\n=== ${c.id} · ${c.genre} · ${NN[c.key]} ${song.mode} · ${song.bpm} BPM · ${legacy ? 'BEFORE (старий генератор)' : 'шаблон ' + (song.hook.tpl || '—')} · настрій ${song.hook.mood} · have=${have} ===`;
  const rows = out.map(n => `${String(n.bar).padStart(2)} ${String(n.s).padStart(2)}  ${n.ch.name.padEnd(5)} ${String(n.midi).padStart(3)} ${name(n.midi).padEnd(4)} ${roleOf(n.midi, n.ch)}`);
  console.log(head + '\nтакт крок акорд  MIDI нота роль\n' + rows.join('\n'));
  return { song, out };
}

// ---- WAV ----
function render(song, out, wave) {
  const sr = 44100, step = 60 / song.bpm / 4, total = Math.ceil((BARS * 16 + 4) * step * sr), buf = new Float32Array(total), freq = m => 440 * Math.pow(2, (m - 69) / 12);
  const add = (t, dur, f, vol, kind, atk = .005) => {
    const i0 = Math.floor(t * sr), n = Math.floor(dur * sr);
    for (let i = 0; i < n && i0 + i < total; i++) {
      const x = i / sr, ph = (x * f) % 1, env = Math.min(1, x / atk) * Math.exp(-x * (kind === 'bass' ? 2 : 3.2)) * Math.min(1, (dur - x) / .02 + 0);
      const v = kind === 'saw' ? 2 * ph - 1 : kind === 'square' ? (ph < .5 ? 1 : -1) * .7 : Math.sin(2 * Math.PI * ph) * .9;
      buf[i0 + i] += v * env * vol;
    }
  };
  for (let bar = 0; bar < BARS; bar++) {
    const ch = g.chordAt(bar), t0 = bar * 16 * step; let r = ch.root + 36; // бас-корінь такту
    add(t0, 8 * step, freq(r), .18, 'bass', .01); add(t0 + 8 * step, 8 * step, freq(r), .14, 'bass', .01);
    for (let b = 0; b < 4; b++) add(t0 + b * 4 * step, .03, b ? 1800 : 2600, .12, 'sine', .001); // клік на долю
  }
  out.forEach((n, i) => {
    const t = (n.bar * 16 + n.s) * step, nxt = out[i + 1], gap = nxt ? (nxt.bar * 16 + nxt.s) * step - t : 4 * step;
    add(t, Math.min(Math.max(gap * .95, .08), 1.1), freq(n.midi), .33, wave);
  });
  return buf;
}
function wav(bufs) {
  const gap = new Float32Array(44100 / 2), all = bufs.flatMap((b, i) => i ? [gap, b] : [b]), len = all.reduce((s, b) => s + b.length, 0), pcm = Buffer.alloc(len * 2);
  let o = 0, peak = 1e-9; for (const b of all) for (const v of b) peak = Math.max(peak, Math.abs(v));
  for (const b of all) for (const v of b) { pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v / peak * .85)) * 32767), o); o += 2; }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

if (WAV) fs.mkdirSync(OUT, { recursive: true });
for (const c of CASES) for (const legacy of [false, true]) {
  const bufs = [];
  for (const have of [1, 4]) { const { song, out } = table(c, legacy, have); if (WAV) bufs.push(render(song, out, c.wave)); }
  if (WAV) { const f = path.join(OUT, c.file + (legacy ? '-before' : '') + '.wav'); fs.writeFileSync(f, wav(bufs)); console.log('WAV: ' + path.relative(process.cwd(), f)); }
}
