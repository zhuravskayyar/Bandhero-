'use strict';
// node --test multiplayer.test.js — реальний сервер і чотири незалежні JS-сесії.
// Мінімальний DOM замінює лише малювання та кнопки; мережа й логіка гри справжні.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await delay(20); }
  throw new Error('Timeout: ' + label);
}
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.disabled = false; this.textContent = '';
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle(x, on) { if (on === undefined) on = !classes.has(x); if (on) classes.add(x); else classes.delete(x); } };
  }
  set innerHTML(html) {
    this.children = [];
    for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const e = new Element(); e.textContent = m[2].replace(/<[^>]*>/g, ''); e.disabled = /\bdisabled\b/.test(m[1]);
      const classes=m[1].match(/class="([^"]*)"/);if(classes)for(const c of classes[1].split(/\s+/))e.classList.add(c);
      for (const d of m[1].matchAll(/data-([\w-]+)="([^"]*)"/g)) e.dataset[d[1]] = d[2];
      this.children.push(e);
    }
  }
  querySelectorAll() { return this.children; }
  appendChild(e) { e.parentNode = this; this.children.push(e); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(e => e !== this); }
  addEventListener() {}
  setPointerCapture() {}
  select() {}
}
function session(origin, audio = false) {
  const elements = new Map(), events = new Map(), timers = new Set(), errors = [];
  let framesHeld = false, pendingFrame = null;
  const get = s => { if (!elements.has(s)) elements.set(s, new Element()); return elements.get(s); };
  const canvas = new Proxy({}, { get: (t, k) => t[k] || (() => {}), set: (t, k, v) => (t[k] = v, true) });
  get('#cv').getContext = () => canvas;
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); try { fn(); } catch (e) { errors.push(e); } }, ms); timers.add(id); return id; };
  const interval = (fn, ms) => { const id = setInterval(() => { try { fn(); } catch (e) { errors.push(e); } }, ms); timers.add(id); return id; };
  const param = () => ({ value: 0, events: [], setValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.events.push(['set',v,t]); this.value = v; },
    setTargetAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.events.push(['target',v,t]); this.value = v; },
    linearRampToValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.events.push(['linear',v,t]); },
    exponentialRampToValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.events.push(['exp',v,t]); } });
  const audioNode = () => {
    const n = { connect() {}, disconnect() {}, start(t = 0) { assert.ok(Number.isFinite(t) && t >= 0); this.startedAt=t; }, stop(t = 0) { assert.ok(Number.isFinite(t)); this.stoppedAt=t; } };
    for (const k of ['gain', 'frequency', 'Q', 'playbackRate', 'detune', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = param();
    return n;
  };
  class TestAudioContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 4000; this.destination = audioNode(); this.elapsed = 0; }
    get currentTime() { return this.elapsed + (this.state === 'running' ? (performance.now() - this.started) / 1000 : 0); }
    async resume() { if (this.state !== 'running') { this.started = performance.now(); this.state = 'running'; if (this.onstatechange) this.onstatechange(); } }
    async suspend() { this.elapsed = this.currentTime; this.state = 'suspended'; if (this.onstatechange) this.onstatechange(); }
    createBuffer(channels, length, sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { sampleRate, length, duration:length/sampleRate, getChannelData: c => data[c] }; }
    async decodeAudioData() { return this.createBuffer(1, 12516, this.sampleRate); }
  }
  for (const k of ['Gain', 'DynamicsCompressor', 'BiquadFilter', 'WaveShaper', 'Convolver', 'Delay', 'BufferSource', 'Oscillator']) TestAudioContext.prototype['create' + k] = audioNode;
  class TestWorker {
    postMessage(m) { later(() => this.onmessage({ data: m.ping ? { pong: 1 } : { key: m.key, data: new Float32Array(800), rate: 1 } }), 0); }
  }
  const context = vm.createContext({
    console: { log() {}, warn() {}, error: (...s) => errors.push(s.join(' ')) },
    document: { querySelector: get, createElement: () => new Element(), hidden: false, addEventListener() {} },
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1, performance, URL, URLSearchParams, Blob, atob,
    WebSocket, location: new URL(origin), setTimeout: later, clearTimeout, setInterval: interval,
    Image: class { constructor() { this.complete = true; this.naturalWidth = 1254; this.naturalHeight = 1254; } },
    fetch: (url, opts) => { const u = new URL(url, origin); return u.origin === origin ? fetch(u, opts) : Promise.resolve({ ok: false }); },
    ...(audio ? { AudioContext: TestAudioContext, Worker: TestWorker } : {}),
    requestAnimationFrame: fn => later(() => { if (framesHeld) pendingFrame = fn; else fn(performance.now()); }, 16),
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
  });
  context.window = context;
  vm.runInContext(source, context, { filename: 'game.html' });
  return {
    get game() { return context.__game; }, elements, errors,
    click: async s => { const e = get(s); assert.ok(!e.disabled, s + ' is disabled'); await e.onclick(); },
    pick: k => get('#lobby-cards').children.find(e => e.dataset.k === k).onclick(),
    key: (name, code) => { for (const fn of events.get(name) || []) fn({ code, preventDefault() {} }); },
    holdFrames(held) { framesHeld = held; if (!held && pendingFrame) { const fn = pendingFrame; pendingFrame = null; later(() => fn(performance.now()), 0); } },
    close() { if (context.__game.net.ws) context.__game.net.ws.close(); for (const id of timers) { clearTimeout(id); clearInterval(id); } },
  };
}

test('Wi-Fi band: lobby, four actors, shared combat, upgrades, pause and host handover', async t => {
  const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', b => output += b); server.stderr.on('data', b => output += b);
  const sessions = [];
  t.after(() => { sessions.forEach(s => s.close()); server.kill(); });
  await until(() => output.includes('http://localhost:'), 'server startup');
  const port = output.match(/http:\/\/localhost:(\d+)/)[1], origin = 'http://127.0.0.1:' + port;
  assert.equal((await fetch(origin + '/health')).status, 200);
  assert.match(await (await fetch(origin)).text(), /Грати з друзями/);
  const theme = await (await fetch(origin + '/game-effects.css')).text();
  assert.match(theme, /font-family:'Russo One'/); assert.ok(!theme.includes('@keyframes'), 'attacks no longer depend on CSS animation');
  for (const file of ['band-creatures-v2.png', 'band-mobs-v1.png', 'music-fx-v2.png', 'night-grove-floor-v2.png', 'night-grove-props-v2.png']) {
    const asset = await fetch(origin + '/assets/' + file); assert.equal(asset.status, 200); assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await asset.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  }
  for (const name of ['Rubik', 'RussoOne']) { const font = await fetch(origin + '/assets/' + name + '.ttf'); assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/ttf'); }
  const harmonics=await fetch(origin+'/assets/guitar-harmonics.js');assert.equal(harmonics.status,200);assert.match(await harmonics.text(),/MIDI\.Soundfont\.guitar_harmonics/);
  const host = session(origin, true); sessions.push(host); await host.click('#multiplayer');
  await until(() => host.game.net.id, 'host welcome');
  for (let i = 1; i < 4; i++) { const s = session(origin, i < 3); sessions.push(s); await s.click('#multiplayer'); await until(() => s.game.net.id, 'peer welcome'); }
  await until(() => host.game.net.roster.length === 4, 'roster of four');
  const [a, b, c, d] = sessions;
  const full = session(origin); t.after(() => full.close()); await full.click('#multiplayer');
  await until(() => full.elements.get('#menu-notice')?.textContent.includes('четверо'), 'fifth player rejected');
  await a.pick('guitar'); await until(() => b.game.net.roster[0].char === 'guitar', 'first pick');
  b.game.net.ws.send(JSON.stringify({ t: 'pick', char: 'guitar' })); await delay(80);
  assert.equal(b.game.net.roster.find(p => p.id === b.game.net.id).char, null);
  for (const [s, k] of [[b, 'drums'], [c, 'bass'], [d, 'piano']]) await s.pick(k);
  await until(() => a.game.net.roster.every(p => p.char), 'four unique instruments');
  a.game.net.ws.send(JSON.stringify({ t: 'begin' })); await delay(50);
  assert.equal(a.game.running, false, 'cannot start without readiness');
  for(const genre of ['newwave','chanson_ua']){
    a.game.net.ws.send(JSON.stringify({t:'genre',genre}));
    await until(()=>b.elements.get('#lobby-genres').children.some(x=>x.dataset.g===genre&&x.classList.contains('on')),genre+' accepted by relay');
  }
  a.game.net.ws.send(JSON.stringify({ t: 'genre', genre: 'metal' }));
  await until(() => b.elements.get('#lobby-genres').children.some(x => x.dataset.g === 'metal'), 'genre controls');
  for (const s of sessions) await s.click('#ready');
  await until(() => a.game.net.roster.every(p => p.ready), 'everyone ready');
  for (const s of sessions) s.game.logNotes(true);
  await a.click('#start-band');
  await until(() => sessions.every(s => s.game.running), 'all four playing');
  assert.equal(a.game.SONG.genre, 'metal');
  for (const s of sessions) {
    assert.equal(s.game.G.players.length, 4); assert.equal(s.game.G.seed, a.game.G.seed);
    assert.equal(JSON.stringify(s.game.SONG), JSON.stringify(a.game.SONG));
    assert.equal(s.game.G.p, s.game.G.players.find(p => p.id === s.game.net.id).p);
  }
  b.game.net.ws.send(JSON.stringify({ t: 'pick', char: 'guitar' })); await delay(50);
  assert.equal(b.game.net.roster.find(p => p.id === b.game.net.id).char, 'drums', 'cannot change actor in a run');
  const bx = a.game.G.players[1].p.x;
  b.key('keydown', 'KeyD'); await delay(550); b.key('keyup', 'KeyD'); await delay(150);
  assert.ok(a.game.G.players[1].p.x > bx + 45, 'guest input moves its actor on host');
  assert.ok(Math.abs(b.game.G.p.x - a.game.G.players[1].p.x) < 15, 'guest receives its movement');
  await until(() => a.game.G.mobs.length > 0, 'shared enemies');
  assert.ok(b.game.G.mobs.length > 0);
  const owners = new Set();
  await until(() => { for (const e of [...a.game.G.shots, ...a.game.G.rings, ...a.game.G.cones]) owners.add(e.owner); return owners.size === 4; }, 'attacks from four instruments');
  assert.deepEqual([...owners].sort(), Array.from(a.game.G.players, p => p.id).sort());
  for (const s of [a, b, c]) {
    assert.equal(new Set(s.game.notes.map(n => n.inst)).size, 4, 'each device schedules the entire band');
    assert.ok(s.game.notes.every(n => Number.isFinite(n.t)), 'music uses finite audio timestamps');
    for (const inst of ['guitar', 'bass', 'piano']) assert.ok(s.game.cache.some(k => k.startsWith('syn-' + inst + ':')), inst + ' keeps its own buffers');
  }
  for (const [i, id] of ['guitar_drive', 'drums_double', 'bass_sub', 'piano_familiar'].entries()) {
    const actor = a.game.G.players[i]; a.game.withPlayer(actor, () => a.game.applyUpgrade({ pd: a.game.PEDALS.find(p => p.id === id) }));
  }
  await until(() => d.game.G.players[3].pedals.piano_familiar === 1, 'personal gear synchronized');
  assert.equal(a.game.pedalEffects(a.game.G.players[0].pedals, 'guitar').drive, 1);
  assert.equal(a.game.pedalEffects(a.game.G.players[1].pedals, 'drums').drive, undefined);
  await until(() => a.game.G.shots.some(s => s.layer === 'familiar'), 'piano helper attacks');
  assert.ok(a.game.renderStats.spriteFX > 0 && a.game.renderStats.spriteFX <= 120, 'visible sprite effects are capped');
  assert.ok(b.game.renderStats.spriteFX > 0, 'guests render sprite effects from snapshots');
  await a.game.setPause(true); await until(() => b.game.paused, 'pause propagated');
  a.game.G.players[2].p.hp = 0;
  a.game.G.xp = 9; a.game.levelUp();
  await until(() => sessions.every(s => s.game.choosing && s.elements.get('#opts').children.length > 0), 'all receive own upgrade choices');
  assert.ok(a.game.G.players[2].p.hp > 0, 'fallen player revives on team level');
  const levelTime = a.game.G.t; await delay(120); assert.equal(a.game.G.t, levelTime, 'combat stops while choosing');
  await a.elements.get('#opts').children[0].onclick();
  assert.equal(a.game.net.pending.size, 3);
  const before = JSON.stringify(a.game.G.players[0].layers);
  a.game.net.ws.send(JSON.stringify({ t: 'toHost', d: { k: 'choice', match: a.game.net.match, index: 0, level: 2 } }));
  assert.equal(JSON.stringify(a.game.G.players[0].layers), before);
  for (const s of [b, c, d]) await s.elements.get('#opts').children[0].onclick();
  await until(() => sessions.every(s => !s.game.choosing && !s.game.paused), 'resume after every choice');
  for (const actor of a.game.G.players) assert.ok(Object.keys(actor.layers).every(k => a.game.LAYERS[actor.char].some(l => l.id === k)), 'upgrades belong to the chosen instrument');
  b.game.setPause(true); await until(() => a.game.paused && c.game.paused, 'guest requests global pause');
  a.game.setPause(false); await until(() => sessions.every(s => !s.game.paused), 'host resumes');
  for (const actor of a.game.G.players) actor.p.hp = 0;
  await until(() => sessions.every(s => !s.game.running && !s.game.G.players.some(p => p.p.hp > 0)), 'team defeat synchronized');
  await a.click('#again');
  await until(() => sessions.every(s => s.game.net.phase === 'lobby'), 'host returns band to lobby');
  assert.ok(sessions.every(s => !s.game.net.roster.some(p => p.ready)), 'readiness resets for replay');
  for (const s of sessions) await s.click('#ready');
  await until(() => a.game.net.roster.every(p => p.ready), 'ready for replay'); await a.click('#start-band');
  await until(() => sessions.every(s => s.game.running), 'replay starts');
  assert.equal(a.game.G.level, 1);
  a.game.G.xp = 9; a.game.levelUp();
  await until(() => d.game.choosing, 'second run upgrade choice');
  await d.click('#leave-band');
  await until(() => a.game.G.players.length === 3 && b.game.G.players.length === 3, 'guest departure removes actor');
  for (const s of [a, b, c]) await s.elements.get('#opts').children[0].onclick();
  await until(() => !a.game.choosing && !b.game.choosing, 'departed player does not block upgrades');
  assert.ok(a.game.running, 'other players continue');
  const busy = session(origin); t.after(() => busy.close()); await busy.click('#multiplayer');
  await until(() => busy.elements.get('#menu-notice')?.textContent.includes('Забіг уже триває'), 'late join rejected during run');
  await a.click('#leave-band');
  await until(() => b.game.net.isHost && b.game.net.phase === 'lobby' && !b.game.running, 'host departure resets lobby');
  assert.equal(b.game.G, null);
  await c.click('#leave-band'); await b.click('#leave-band');
  for (const s of sessions) assert.deepEqual(s.errors, [], 'no game runtime errors');
  await a.game.pick('guitar');
  await until(() => a.game.running && a.game.cache.length, 'solo sampled audio preparation still works');
  a.game.G.xp = 9; a.game.levelUp(); await a.elements.get('#opts').children[0].onclick();
  assert.equal(a.game.choosing, false); assert.deepEqual(a.errors, []);
  await d.game.pick('piano');
  await until(() => d.game.running, 'solo still starts after leaving multiplayer');
  assert.equal(d.game.G.players, undefined); d.game.setPause(true); assert.equal(d.game.paused, true);
});

test('each instrument receives only its own gear and incompatible bonuses stay inactive', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  for (const [inst, layers] of Object.entries(s.game.LAYERS)) for (const layer of layers) assert.ok(s.game.FX_PROFILES[inst + '-' + layer.id], 'sprite visual for ' + inst + '/' + layer.id);
  const ids = s.game.PEDALS.map(p => p.id); assert.equal(new Set(ids).size, 25);
  for (const inst of ['guitar', 'drums', 'bass', 'piano']) {
    await s.game.pick(inst); s.game.G.level = 10;
    const allowed = s.game.availableGear(inst); assert.ok(allowed.length >= 6);
    for (let i = 0; i < 200; i++) for (const o of s.game.levelOptions()) if (o.pd) assert.equal(o.pd.inst, inst);
    const foreign = s.game.PEDALS.find(p => p.inst !== inst);
    s.game.applyUpgrade({ pd: foreign }); assert.equal(Object.keys(s.game.G.pedals).length, 0, 'foreign upgrade rejected');
    for (const pd of allowed.slice(0, 4)) s.game.applyUpgrade({ pd });
    const options = s.game.levelOptions(); assert.ok(options.every(o => !o.pd || !o.isNew), 'four equipment slots');
    s.game.setPause(true);
  }
  assert.deepEqual(s.errors, []);
});

test('sprite rendering keeps HP visible for every enemy and freezes attack animation on pause', async t => {
  const s = session('http://127.0.0.1:8080'); t.after(() => s.close()); await s.game.pick('guitar'); s.game.setPause(true);
  const g = s.game.G;
  g.mobs = ['fal', 'shum', 'glush'].map((type, i) => ({ type, x: (i - 1) * 60, y: 45, r: [13, 9, 24][i], hp: [18, 3, 55][i], max: [18, 9, 110][i], wob: 0, flash: 0, kx: 0, ky: 0 }));
  g.shots = Array.from({ length: 180 }, (_, i) => ({ x: i % 10, y: i % 7, r: 10, age: .2, life: 1, inst: 'bass', layer: 'root', vx: 300, vy: 0 }));
  s.game.draw(); assert.equal(s.game.renderStats.hpBars, 3); assert.equal(s.game.renderStats.mobSprites, 3);
  assert.equal(s.game.renderStats.spriteFX, 120, 'VFX limit never removes enemy health bars');
  assert.equal(s.game.renderStats.effectMode, 'sprites');
  const age = g.shots[0].age; await delay(80); assert.equal(g.shots[0].age, age, 'paused sprite frames stay fixed');
  assert.deepEqual(s.errors, []);
});

test('a stalled render pauses safely and does not unleash old musical attacks', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close()); s.game.setGenre('pop'); await s.game.pick('piano');
  s.holdFrames(true); await delay(2000); s.holdFrames(false); await delay(70);
  assert.equal(s.game.paused, true, 'background audio cannot keep fighting while rendering is stalled');
  assert.ok(s.game.G.shots.length <= 4, 'only current notes may create fresh projectiles after a stall');
  assert.deepEqual(s.errors, []);
});

test('distortion clips the waveform and compensates output; chorus and bass compression use actual audio nodes', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  await s.game.pick('guitar');
  s.game.applyUpgrade({ pd: s.game.PEDALS.find(p => p.id === 'guitar_drive') });
  const bus = s.game.buses.guitar; assert.ok(bus.pre.gain.value > 1); assert.ok(bus.makeup.gain.value < 1); assert.equal(bus.ws.oversample, '2x');
  assert.equal(bus.cab.frequency.value, 3800);
  const n = 4096, wave = [];
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, .26 * Math.sin(i * Math.PI * 2 / n) * bus.pre.gain.value));
    const k = Math.round((x + 1) / 2 * (bus.ws.curve.length - 1)); wave.push(bus.ws.curve[k] * bus.makeup.gain.value);
  }
  const harmonic = k => Math.abs(wave.reduce((sum, y, i) => sum + y * Math.sin(i * Math.PI * 2 * k / n), 0)) * 2 / n;
  assert.ok(harmonic(3) / harmonic(1) > .15, 'audible harmonic distortion, not linear amplification');
  const rms = Math.sqrt(wave.reduce((sum, y) => sum + y * y, 0) / n);
  assert.ok(rms / (.26 / Math.sqrt(2)) < 1.6, 'output gain compensates the boosted input');
  s.game.applyUpgrade({ pd: s.game.PEDALS.find(p => p.id === 'guitar_chorus') });
  assert.ok(bus.cdepth.gain.value > 0 && bus.chWet.gain.value > 0, 'chorus modulates a wet delay');
  await s.game.pick('bass'); s.game.applyUpgrade({ pd: s.game.PEDALS.find(p => p.id === 'bass_comp') });
  assert.ok(s.game.buses.bass.comp.ratio.value > 1); assert.equal(s.game.buses.bass.ws.curve, null, 'bass compressor does not add guitar distortion');
  assert.deepEqual(s.errors, []);
});

test('genre arrangements keep their rhythm and pitch articulation through every upgrade rank', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const game=s.game,signatures={};
  for(const genre of Object.keys(game.GENRES)){
    const song=game.makeSong(null,genre);game.setSong(song);const original=JSON.stringify(song);
    assert.equal(song.prog.length,4);assert.ok(new Set(song.prog.map(c=>c.off)).size>=3,'four-bar harmony has movement: '+genre);
    assert.ok(song.bpm>=game.GENRES[genre].bpm[0]&&song.bpm<=game.GENRES[genre].bpm[1]);
    const events=(layer,rank)=>{const out=[];for(let bar=0;bar<8;bar++)for(let step=0;step<16;step++){
      for(const e of layer.steps(game.chordAt(bar),step,bar,rank)){
        assert.ok(!e.slide&&!e.vib,'no automatic pitch scoop: '+genre+'/'+layer.id);
        out.push([bar,step,e.midi,e.drum,e.art,e.dir]);
        if(e.art==='harmonic')assert.equal(e.midi,e.harmonicBase+12,'octave harmonic of an actual fretted string');
      }}return JSON.stringify(out);};
    for(const layers of Object.values(game.LAYERS))for(const layer of layers){
      const base=events(layer,1);assert.notEqual(base,'[]',genre+'/'+layer.id+' has a playable part');
      for(let rank=2;rank<=5;rank++)assert.equal(events(layer,rank),base,'rhythm never accelerates: '+genre+'/'+layer.id+'/'+rank);
    }
    signatures[genre]=events(game.LAYERS.guitar[0],1);
    assert.equal(JSON.stringify(song),original,'arrangement generation does not change genre, tempo or phrase');
  }
  for(const [a,b] of [['rock','newwave'],['rock','chanson'],['chanson','chanson_ua']])assert.notEqual(signatures[a],signatures[b]);
  assert.deepEqual(s.errors,[]);
});

test('one-shot notes ring for the whole sample at any BPM, overlap safely and use a separate harmonic voice', async t => {
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());s.game.setGenre('rock');await s.game.pick('guitar');
  s.game.setPause(true);s.holdFrames(true);const g=s.game;g.logNotes(true);await g.reqBuf('guitar',64);
  const durations=[];
  for(const bpm of [72,172]){
    g.SONG.bpm=bpm;const t0=g.ctx.currentTime+.1;g.playBuffered(t0,{midi:64,str:5,vel:.6,dur:1});
    const first=g.voices.at(-1),before=JSON.stringify(first.gain.events);
    g.playBuffered(t0+.05,{midi:64,str:5,vel:.6,dur:.5,clear:new Set()});
    assert.equal(JSON.stringify(first.gain.events),before,'new note/chord cannot cut the preceding string');
    const source=first.source,expected=source.buffer.duration/source.playbackRate.value;
    assert.ok(Math.abs(source.stoppedAt-source.startedAt-expected)<1e-8,'stop is at the end of the sample');
    durations.push(g.notes.at(-1).duration);
    source.onended();assert.ok(!g.voices.includes(first),'finished sources leave the live voice list');
  }
  assert.equal(durations[0],durations[1],'BPM cannot shorten a note');
  await g.warmLayer(g.LAYERS.guitar.find(l=>l.id==='harm'),'guitar');
  const harmonic=g.LAYERS.guitar.find(l=>l.id==='harm').steps(g.chordAt(0),0,0,5)[0];
  g.playBuffered(g.ctx.currentTime+.1,harmonic);assert.match(g.notes.at(-1).source,/harmonics/);assert.equal(g.notes.at(-1).art,'harmonic');
  g.playBuffered(g.ctx.currentTime+.2,{midi:40,vel:.5,art:'dead'});assert.equal(g.notes.at(-1).source,'muted-strings');assert.equal(g.notes.at(-1).midi,undefined);
  const natural=g.voices.filter(v=>v.endAt>g.ctx.currentTime+.1);g.endNoteTails();assert.ok(natural.every(v=>v.source.stoppedAt<=g.ctx.currentTime+.06),'restart/menu cleans old song tails');
  assert.deepEqual(s.errors,[]);
});
