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
const dictionaryContext=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'i18n.js'),'utf8'),dictionaryContext);
const dictionary=dictionaryContext.window.I18N_DICT;
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
function session(origin, audio = false, audioFixture = {}) {
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
    exponentialRampToValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.events.push(['exp',v,t]); },
    cancelScheduledValues(t){assert.ok(Number.isFinite(t));this.events.push(['cancel',t]);} });
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
    async decodeAudioData() { if(audioFixture.failDecode)throw new Error('invalid test MP3');const b=this.createBuffer(1,12516,this.sampleRate);if(audioFixture.sampleLevel)for(let n=0;n<b.length;n++)b.getChannelData(0)[n]=audioFixture.sampleLevel*Math.sin(2*Math.PI*440*n/this.sampleRate);return b; }
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
    // SoundFont-банк (.sf2) не тягнемо з мережі: тест не має залежати від того, чи запущено сервер на 8080.
    // audioFixture.sf2 — справжній файл із диска (див. тест «A320U bank renders…»), інакше банку «немає» → запасні семпли.
    fetch: (url, opts) => { const u = new URL(url, origin);
      if (u.pathname.startsWith('/assets/violin/')) return Promise.resolve(audioFixture.violin ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false }); // семпли скрипки: лише коли тест просить
      if (u.pathname.endsWith('.sf2')) return Promise.resolve(audioFixture.sf2 ? { ok: true, arrayBuffer: async () => { const b = fs.readFileSync(path.join(__dirname, u.pathname)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } } : { ok: false });
      return u.origin === origin ? fetch(u, opts) : Promise.resolve(audioFixture.soundfontText?{ok:true,text:async()=>audioFixture.soundfontText}:{ok:false}); },
    ...(audio ? { AudioContext: TestAudioContext, Worker: TestWorker } : {}),
    requestAnimationFrame: fn => later(() => { if (framesHeld) pendingFrame = fn; else fn(performance.now()); }, 16),
    addEventListener: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
  });
  context.window = context;
  for(const file of ['pixel-icons.js','assets/expansion-audio.js','assets/sf2-bank.js','assets/expansion-genres.js','assets/expansion-instruments.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{filename:file});
  vm.runInContext(source, context, { filename: 'game.html' });
  return {
    get game() { return context.__game; }, get dictionary(){return dictionary;}, elements, errors,
    click: async s => { const e = get(s); assert.ok(!e.disabled, s + ' is disabled'); await e.onclick(); },
    pick: k => get('#lobby-cards').children.find(e => e.dataset.k === k).onclick(),
    key: (name, code) => { for (const fn of events.get(name) || []) fn({ code, preventDefault() {} }); },
    holdFrames(held) { framesHeld = held; if (!held && pendingFrame) { const fn = pendingFrame; pendingFrame = null; later(() => fn(performance.now()), 0); } },
    close() { if (context.__game.net.ws) context.__game.net.ws.close(); for (const id of timers) { clearTimeout(id); clearInterval(id); } },
  };
}
const roomUrl = (origin, host) => origin + '/?band=1&room=' + host.game.net.room;

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
  for (const file of ['band-mobs-v1.png', 'hero-guitar-v3.png', 'hero-drums-v3.png', 'hero-drums-atk-v3.png', 'hero-bass-v3.png', 'hero-bass-atk-v3.png', 'hero-piano-v3.png', 'hero-piano-atk-v3.png', 'fx-guitar-v3.png', 'fx-drums-v3.png', 'fx-bass-v3.png', 'fx-piano-v3.png', 'night-grove-floor-v2.png', 'night-grove-props-v2.png']) {
    const asset = await fetch(origin + '/assets/' + file); assert.equal(asset.status, 200); assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await asset.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
  }
  for (const name of ['Rubik', 'RussoOne']) { const font = await fetch(origin + '/assets/' + name + '.ttf'); assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/ttf'); }
  const harmonics=await fetch(origin+'/assets/guitar-harmonics.js');assert.equal(harmonics.status,200);assert.match(await harmonics.text(),/MIDI\.Soundfont\.guitar_harmonics/);
  const host = session(origin, true); sessions.push(host); await host.click('#multiplayer');
  await until(() => host.game.net.id, 'host welcome');
  for (let i = 1; i < 4; i++) { const s = session(roomUrl(origin, host), i < 3); sessions.push(s); await s.click('#multiplayer'); await until(() => s.game.net.id, 'peer welcome'); }
  await until(() => host.game.net.roster.length === 4, 'roster of four');
  const [a, b, c, d] = sessions;
  const full = session(roomUrl(origin, host)); t.after(() => full.close()); await full.click('#multiplayer');
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
  for (const actor of a.game.G.players) assert.ok(Object.keys(actor.layers).filter(k => k[0] !== '$').every(k => a.game.LAYERS[actor.char].some(l => l.id === k)), 'upgrades belong to the chosen instrument'); // '$boi'/'$pick' — обраний малюнок, не партія
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
  const busy = session(roomUrl(origin, host)); t.after(() => busy.close()); await busy.click('#multiplayer');
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
  const ids = s.game.PEDALS.map(p => p.id); assert.equal(new Set(ids).size, ids.length);
  for (const inst of ['guitar', 'drums', 'bass', 'piano']) {
    await s.game.pick(inst); s.game.G.level = 10;
    const allowed = s.game.availableGear(inst); assert.ok(allowed.length >= 6);
    for (let i = 0; i < 200; i++) for (const o of s.game.levelOptions()) if (o.pd) assert.equal(o.pd.inst, inst);
    const foreign = s.game.PEDALS.find(p => p.inst !== inst);
    s.game.applyUpgrade({ pd: foreign }); assert.equal(Object.keys(s.game.G.pedals).length, 0, 'foreign upgrade rejected');
    for (const pd of allowed.filter(p=>p.cat==='sound')) s.game.applyUpgrade({ pd });
    const options = s.game.levelOptions(); assert.ok(options.every(o => !o.pd || !o.isNew || o.pd.cat==='damage'), 'sound and damage use separate slots');
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
  const bus = s.game.buses.guitar; assert.ok(bus.pre.gain.value > 1); assert.ok(bus.makeup.gain.value < 1); assert.equal(bus.ws.oversample, '4x'); // м'якший дисторшн із меншим аліасингом
  assert.equal(bus.cab.frequency.value, 5000); assert.equal(bus.tight.frequency.value, 150, 'low end is cut before clipping');
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
    signatures[genre]=events(game.LAYERS.guitar.find(l=>l.id==='strum'),1); // стартовий удар униз однаковий у всіх жанрах навмисно
    assert.equal(JSON.stringify(song),original,'arrangement generation does not change genre, tempo or phrase');
  }
  for(const [a,b] of [['rock','newwave'],['rock','chanson'],['chanson','chanson_ua']])assert.notEqual(signatures[a],signatures[b]);
  assert.deepEqual(s.errors,[]);
});

test('genre hooks give aggressive, playful and singable phrases while staying in the unlocked chord', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const styles=new Map();
  for(const genre of ['metal','funk','pop','chanson']){
    const song=g.makeSong(null,genre);song.have=4;g.setSong(song);
    const layer=g.LAYERS.piano.find(l=>l.id==='mel'),notes=[];
    for(let bar=0;bar<2;bar++)for(let step=0;step<16;step++)for(const e of layer.steps(g.chordAt(bar),step,bar,1)){
      assert.ok(Number.isFinite(e.midi),genre+' has a real note');
      assert.ok(g.chordAt(bar).pcs.includes(e.midi%12),genre+' melody follows the current chord');
      notes.push({beat:bar*16+step,midi:e.midi,art:e.art,vel:e.vel});
    }
    assert.ok(new Set(notes.map(e=>e.midi)).size>1,genre+' has a melodic contour');
    styles.set(genre,{mood:song.hook.mood,notes});
  }
  assert.equal(styles.get('metal').mood,'fierce');
  assert.equal(styles.get('funk').mood,'playful');
  assert.ok(styles.get('metal').notes.every(e=>e.art==='staccato'));
  assert.ok(styles.get('funk').notes.every(e=>e.art==='staccato'));
  assert.ok(styles.get('chanson').notes.every(e=>!e.art),'the singable phrase rings out');
  assert.notDeepEqual(styles.get('metal').notes.map(e=>e.beat),styles.get('funk').notes.map(e=>e.beat));
  assert.deepEqual(s.errors,[]);
});

test('frog right hand follows nearby motif notes between its quarter beats', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const song=g.makeSong(null,'chanson');song.hook={mood:'anthem',variant:0};
  song.mel={0:60,6:64,12:67,18:60,24:64,30:67};song.prog[0].root=0;song.prog[0].pcs=[0,4,7];
  g.setSong(song);
  const ch=song.prog[0],right=g.LAYERS.accordion.find(l=>l.id==='right');
  const notes=[0,4,8,12].map(step=>right.steps(ch,step,0,1)[0].midi);
  assert.deepEqual(notes,[60,64,64,67]);
  assert.deepEqual(s.errors,[]);
});

test('every genre has its own fixed backing beat, bass, chords and hook without combat events', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game,beats=new Set();
  for(const genre of Object.keys(g.GENRES)){
    const song=g.makeSong(null,genre);g.setSong(song);
    const events=Array.from({length:32},(_,i)=>g.backingEvents(i>>4,i&15));
    const parts=new Set(events.flat().map(e=>e.kind));
    assert.deepEqual([...parts].sort(),['bass','chord','drum','hook'],genre+' has the whole band');
    for(let i=0;i<32;i++)for(const e of events[i]){
      assert.ok(!e.atk&&!e.damage,genre+' backing has no attack');
      if(e.midi!==undefined)assert.ok(g.chordAt(i>>4).pcs.includes(e.midi%12),genre+' backing stays in the chord');
    }
    const signature=events.map(a=>a.filter(e=>e.kind==='drum').map(e=>e.drum).join('+')).join('|');
    beats.add(signature);
    assert.equal(JSON.stringify(events),JSON.stringify(Array.from({length:32},(_,i)=>g.backingEvents(i>>4,i&15))),genre+' keeps the same arrangement');
  }
  assert.ok(beats.size>=10,'most genres have a distinct beat');
  assert.deepEqual(s.errors,[]);
});

test('flute, violin and sax have complete playable and translated skill catalogs', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game,allMissing=new Set();
  for(const inst of ['flute','violin','sax']){
    const layers=g.LAYERS[inst].filter(l=>!l.starter),gear=g.availableGear(inst),voicings=g.VOICINGS[inst];
    assert.equal(layers.length,10,inst+' active parts');
    assert.equal(gear.filter(p=>p.cat==='sound').length,5,inst+' sound cards');
    assert.equal(gear.filter(p=>p.cat==='damage').length,5,inst+' damage cards');
    assert.equal(Object.keys(voicings).length,5,inst+' personal chords');
    const words=[];
    for(const l of layers){assert.ok(g.ICON.has(inst,l.id));assert.ok(g.FX_PROFILES[inst+'-'+l.id]);
      assert.ok(!g.ICON.part(inst,l.id).includes('undefined'),inst+'/'+l.id+' icon is drawn');words.push(l.name,l.desc,...l.lv);}
    for(const pd of gear){assert.ok(g.ICON.hasGear(pd.key),inst+'/'+pd.key+' gear icon');words.push(pd.name,...pd.lv);}
    for(const v of Object.values(voicings))words.push(v.name,v.desc);
    for(const [id,V] of Object.entries(g.VARIANTS))if(V.inst===inst){words.push(V.title,V.change);for(const c of Object.values(V.cards))words.push(c.name,c.desc);}
    for(const word of words)for(const lang of ['en','de','ru'])if(!s.dictionary[lang][word])allMissing.add(inst+'/'+lang+': '+word);
    for(const genre of Object.keys(g.GENRES)){
      const song=g.makeSong(null,genre);song.have=4;g.setSong(song);
      for(const l of layers){let n=0;for(let bar=0;bar<4;bar++)for(let step=0;step<16;step++)for(const e of l.steps(g.chordAt(bar),step,bar,1)){
        if(e.midi!==undefined&&!e.orn){assert.ok(g.chordAt(bar).pcs.includes(e.midi%12),inst+'/'+l.id+' follows the chord');n++;}
      }assert.ok(n>0,inst+'/'+l.id+' plays in '+genre);}
    }
  }
  assert.deepEqual([...allMissing],[],[...allMissing].join('\n'));
  assert.deepEqual(s.errors,[]);
});

test('guitar, drums, bass and piano have complete skills and mutually exclusive parts', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game,missing=new Set();
  for(const inst of ['guitar','drums','bass','piano']){
    const parts=g.LAYERS[inst].filter(l=>!l.starter),gear=g.availableGear(inst),chords=g.VOICINGS[inst]||{};
    assert.ok(parts.length>=10,inst+' active parts');
    assert.equal(gear.filter(p=>p.cat==='sound').length,5,inst+' sound');
    assert.equal(gear.filter(p=>p.cat==='damage').length,5,inst+' damage');
    if(inst!=='drums')assert.equal(Object.keys(chords).length,5,inst+' personal chords');
    const words=[];
    for(const l of parts){assert.ok(g.ICON.has(inst,l.id),inst+'/'+l.id);assert.ok(g.FX_PROFILES[inst+'-'+l.id]);words.push(l.name,l.desc,...l.lv);}
    for(const pd of gear){assert.ok(g.ICON.hasGear(pd.key),inst+'/'+pd.key);words.push(pd.name,...pd.lv);}
    for(const v of Object.values(chords))words.push(v.name,v.desc);
    for(const V of Object.values(g.VARIANTS))if(V.inst===inst){words.push(V.title,V.change);for(const c of Object.values(V.cards))words.push(c.name,c.desc);}
    for(const word of words)for(const lang of ['en','de','ru'])if(!s.dictionary[lang][word])missing.add(word);
  }
  assert.deepEqual([...missing],[],[...missing].join('\n'));
  assert.deepEqual(s.errors,[]);
});

test('new families change the played rhythm and personal chords leave the band song intact', async t => {
  for(const [inst,left,right,first,last] of [
    ['drums','hat','ride','closed','sixteenth'],['bass','root','walk','quarter','eighth'],['piano','chords','arp','beat','skank']
  ]){
    const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
    g.setGenre('funk');await g.pick(inst);g.setPause(true);
    const l=g.LAYERS[inst].find(x=>x.id===left),r=g.LAYERS[inst].find(x=>x.id===right);
    g.applyUpgrade({l,variant:first});assert.equal(g.G.layers[left],1,inst+' family part');
    const played=()=>Array.from({length:16},(_,step)=>l.steps(g.chordAt(0),step,0,1).map(e=>e.midi??e.drum).join('+')).join('|');
    const before=played();g.applyUpgrade({l,variant:last});assert.notEqual(played(),before,inst+' variant changes notes');
    g.applyUpgrade({l:r,variant:Object.keys(g.VARIANTS[right].cards)[0]});assert.ok(!g.G.layers[right],inst+' rival remains unavailable');
    assert.deepEqual(s.errors,[]);
  }
  for(const [inst,key,step] of [['guitar','power',0],['bass','octbass',4],['piano','cluster',0]]){
    const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
    g.setGenre('funk');await g.pick(inst);g.setPause(true);
    const before=JSON.stringify(g.SONG.prog),base=g.chordAt(0),v=g.voiced(base,{['$v_'+key]:1},step,0);
    assert.notEqual(JSON.stringify(v),JSON.stringify(base),inst+' personal chord changes its own notes');
    assert.equal(JSON.stringify(g.SONG.prog),before,inst+' shared song is untouched');
    assert.deepEqual(s.errors,[]);
  }
});

test('new combat gear changes hits, rings and notes without changing the song', async t => {
  for(const inst of ['guitar','drums','bass','piano']){
    const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
    g.setGenre('rock');await g.pick(inst);g.setPause(true);
    const gear=Object.fromEntries(g.availableGear(inst).map(pd=>[pd.key,pd]));
    const song=JSON.stringify(g.SONG.prog),at=(layer,fn)=>g.withPlayer(null,()=>g.withAttack({layer,step:0,owner:null},fn));
    if(inst==='guitar'){
      g.applyUpgrade({pd:gear.sparks});g.applyUpgrade({pd:gear.fuzzHit});
      const m=g.addMob('glush',100,0);at('accent',()=>g.hurtMob(m,10,0,0));
      assert.ok(m.burn>0&&m.burnDmg>0,'string sparks burn');assert.ok(m.max-m.hp>10,'fuzz accent adds damage');
    }else if(inst==='drums'){
      g.applyUpgrade({pd:gear.wave});g.applyUpgrade({pd:gear.stun});
      at('kick',()=>g.LAYERS.drums.find(l=>l.id==='kick').atk([{drum:'kick',vel:1}],1));
      assert.ok(g.G.rings[0].maxR>45,'kick wave widens ring beyond the base 45');
      const m=g.addMob('glush',100,0);at('snare',()=>g.hurtMob(m,10,0,0));assert.ok(m.stun>=.2,'snare stuns');
    }else if(inst==='bass'){
      g.applyUpgrade({pd:gear.heavyLow});g.applyUpgrade({pd:gear.pierce});g.applyUpgrade({pd:gear.vibration});
      const m=g.addMob('glush',100,0);at('root',()=>g.hurtMob(m,10,100,0));
      assert.ok(m.kx>35&&m.slow>0,'bass knockback (boosted above the plain ×0.35 scale) and slow');
      at('root',()=>g.LAYERS.bass.find(l=>l.id==='root').atk([{midi:40}],1));
      assert.ok(g.G.shots[0].pierce>=7,'bass wave pierces more enemies');
    }else{
      g.applyUpgrade({pd:gear.homingPlus});g.applyUpgrade({pd:gear.split});g.applyUpgrade({pd:gear.slow});
      at('mel',()=>g.LAYERS.piano.find(l=>l.id==='mel').atk([{midi:60}],1));
      assert.ok(g.G.shots[0].spd>360&&g.G.shots[0].split>0,'piano note flies faster and splits');
      const m=g.addMob('glush',100,0);at('mel',()=>g.hurtMob(m,10,0,0));assert.ok(m.slow>0,'piano note slows');
    }
    assert.equal(JSON.stringify(g.SONG.prog),song,'gear leaves shared song intact');
    assert.deepEqual(s.errors,[]);
  }
});

test('every new personal chord card changes its starter part immediately', async t => {
  for(const inst of ['guitar','bass','piano']){
    const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
    g.setGenre('pop');await g.pick(inst);g.setPause(true);g.SONG.have=4;
    const starter=g.LAYERS[inst][0],song=JSON.stringify(g.SONG.prog);
    const heard=layers=>Array.from({length:4},(_,bar)=>Array.from({length:16},(_,step)=>{
      const ch=g.voiced(g.chordAt(bar),layers,step,bar);
      return starter.steps(ch,step,bar,1).map(e=>e.midi).join('+');
    }).join('|')).join('/');
    const before=heard({});
    for(const id of Object.keys(g.VOICINGS[inst]))assert.notEqual(heard({['$v_'+id]:1}),before,inst+'/'+id+' has an audible pitch or rhythm change');
    assert.equal(JSON.stringify(g.SONG.prog),song,'personal voicings do not rewrite shared chords');
    assert.deepEqual(s.errors,[]);
  }
});

test('solo flute hears a backing band and new sound cards change the audio path', async t => {
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('funk');await g.pick('flute');await until(()=>g.backingVoices>0,'backing band starts in solo');g.setPause(true);
  const gear=Object.fromEntries(g.availableGear('flute').map(pd=>[pd.key,pd]));
  g.applyUpgrade({pd:gear.echo});assert.ok(g.buses.flute.fb.gain.value>0,'echo changes the delay bus');
  g.applyUpgrade({pd:gear.flutter});assert.ok(g.buses.flute.tremDepth.gain.value>0,'flutter modulates volume');
  g.applyUpgrade({pd:gear.vibrato});g.applyUpgrade({pd:gear.breath});g.applyUpgrade({pd:gear.octave});
  const midi=Array.from({length:32},(_,i)=>g.LAYERS.flute[0].steps(g.chordAt(i>>4),i%16,i>>4,1).filter(e=>!e.orn)).find(a=>a.length)[0].midi; /* стартова партія грає мелодію пісні на її позиціях, а не на кожній долі */await g.reqBuf('flute',midi);await g.reqBuf('flute',midi+12);
  const before=g.voices.length;g.logNotes(true);g.fire(g.ctx.currentTime+.05,[{midi,vel:.5,dur:3}]);
  assert.ok(g.voices.length>=before+3,'main note, octave and air attack are audible voices');
  assert.ok(g.notes.some(n=>n.midi===midi+12),'flute octave sounds above the note');
  assert.deepEqual(s.errors,[]);
});

test('one-shot notes ring for the whole sample at any BPM, overlap safely and play harmonics with the guitar sample or a clean string synth', async t => {
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());s.game.setGenre('rock');await s.game.pick('guitar');
  s.game.setPause(true);s.holdFrames(true);const g=s.game;g.logNotes(true);await g.reqBuf('guitar',64);
  const durations=[];
  for(const bpm of [72,172]){
    g.SONG.bpm=bpm;const t0=g.ctx.currentTime+.1;g.playBuffered(t0,{midi:64,str:5,vel:.6,dur:1});
    const first=g.voices.at(-1),before=JSON.stringify(first.gain.events);
    g.playBuffered(t0+.05,{midi:64,str:4,vel:.6,dur:.5,clear:new Set()});
    assert.equal(JSON.stringify(first.gain.events),before,'a note on another string cannot cut the preceding string');
    const source=first.source,expected=source.buffer.duration/source.playbackRate.value;
    assert.ok(Math.abs(source.stoppedAt-source.startedAt-expected)<1e-8,'stop is at the end of the sample');
    // рок/метал: нова нота на тій самій струні глушить попередню
    g.playBuffered(t0+.06,{midi:64,str:4,vel:.6,dur:.5});const second=g.voices.at(-2);
    assert.ok(second.gain.events.some(e=>e[0]==='target'&&e[1]===0&&Math.abs(e[2]-(t0+.06))<1e-6),'same string is damped in rock');
    assert.ok(second.source.stoppedAt<t0+.2,'damped note stops right after');
    durations.push(g.notes.at(-1).duration);
    source.onended();assert.ok(!g.voices.includes(first),'finished sources leave the live voice list');
  }
  assert.equal(durations[0],durations[1],'BPM cannot shorten a note');
  await g.warmLayer(g.LAYERS.guitar.find(l=>l.id==='harm'),'guitar');
  const harmonic=g.LAYERS.guitar.find(l=>l.id==='harm').steps(g.chordAt(0),0,0,5)[0];
  const guitarSource=g.notes.at(-1).source;
  g.playBuffered(g.ctx.currentTime+.1,harmonic);assert.equal(g.notes.at(-1).source,guitarSource.startsWith('syn-')?'syn-harm':guitarSource,'harmonic uses the guitar sample, or a dedicated clean string synth without one');assert.equal(g.notes.at(-1).art,'harmonic');
  g.playBuffered(g.ctx.currentTime+.2,{midi:40,vel:.5,art:'dead'});assert.equal(g.notes.at(-1).source,'muted-strings');assert.equal(g.notes.at(-1).midi,undefined);
  const natural=g.voices.filter(v=>v.endAt>g.ctx.currentTime+.1);g.endNoteTails();assert.ok(natural.every(v=>v.source.stoppedAt<=g.ctx.currentTime+.06),'restart/menu cleans old song tails');
  assert.deepEqual(s.errors,[]);
});

async function startServer(t, env = {}) {
  const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const box = { output: '' }; server.stdout.on('data', b => box.output += b); server.stderr.on('data', b => box.output += b);
  t.after(() => server.kill());
  await until(() => box.output.includes('http://localhost:'), 'server startup');
  box.port = box.output.match(/http:\/\/localhost:(\d+)/)[1]; box.origin = 'http://127.0.0.1:' + box.port;
  return box;
}
async function bandOfTwo(t, origin) {
  const a = session(origin, true); t.after(() => a.close());
  await a.click('#multiplayer'); await until(() => a.game.net.id, 'host welcome');
  const b = session(roomUrl(origin, a), true); t.after(() => b.close());
  await b.click('#multiplayer'); await until(() => b.game.net.id, 'guest welcome');
  await a.pick('guitar'); await b.pick('drums'); await until(() => a.game.net.roster.every(p => p.char), 'picks');
  await a.click('#ready'); await b.click('#ready'); await until(() => a.game.net.roster.every(p => p.ready), 'ready');
  await a.click('#start-band'); await until(() => a.game.running && b.game.running, 'both playing');
  return [a, b];
}

test('public rooms keep separate bands, invites and game state', async t => {
  const srv = await startServer(t);
  const first = session(srv.origin, true), second = session(srv.origin, true);
  t.after(() => { first.close(); second.close(); });
  await first.click('#multiplayer'); await until(() => first.game.net.room, 'first room');
  await second.click('#multiplayer'); await until(() => second.game.net.room, 'second room');
  assert.notEqual(first.game.net.room, second.game.net.room);
  assert.match(first.elements.get('#invite').value, new RegExp('room=' + first.game.net.room));
  const guest = session(roomUrl(srv.origin, first), true); t.after(() => guest.close());
  await guest.click('#multiplayer'); await until(() => guest.game.net.id, 'invited guest');
  assert.equal(first.game.net.roster.length, 2);
  assert.equal(second.game.net.roster.length, 1);
  first.game.net.ws.send(JSON.stringify({ t: 'genre', genre: 'rock' }));
  await until(() => guest.game.net.roster.length === 2 && guest.game.net.phase === 'lobby', 'same room roster');
  assert.equal(second.game.net.roster.length, 1, 'another room cannot see players');
  assert.equal(second.game.net.host, second.game.net.id, 'another room has its own host');
  await first.pick('guitar'); await guest.pick('drums');
  await until(() => first.game.net.roster.every(p => p.char) && guest.game.net.roster.every(p => p.char), 'both instruments selected');
  await first.click('#ready'); await guest.click('#ready');
  await until(() => first.game.net.roster.every(p => p.ready), 'first band ready');
  await first.click('#start-band'); await until(() => first.game.running && guest.game.running, 'first band playing');
  assert.equal(second.game.net.phase, 'lobby', 'another room stays in its lobby');
  assert.equal(second.game.running, false);
  const health = await (await fetch(srv.origin + '/health')).json();
  assert.equal(health.rooms, 2); assert.equal(health.players, 3);
  await first.click('#leave-band'); await guest.click('#leave-band');
  let remaining;
  for (let i = 0; i < 50; i++) {
    remaining = (await (await fetch(srv.origin + '/health')).json()).rooms;
    if (remaining === 1) break;
    await delay(20);
  }
  assert.equal(remaining, 1, 'empty room removed');
  assert.equal(second.game.net.roster.length, 1);
});

test('an expired invite explains the closed room and can start a new band', async t => {
  const srv = await startServer(t);
  const host = session(srv.origin); t.after(() => host.close());
  await host.click('#multiplayer'); await until(() => host.game.net.room, 'host room');
  const oldRoom = host.game.net.room, invite = roomUrl(srv.origin, host);
  await host.click('#leave-band');
  let roomsAfterLeave;
  for (let i = 0; i < 50; i++) {
    roomsAfterLeave = (await (await fetch(srv.origin + '/health')).json()).rooms;
    if (roomsAfterLeave === 0) break;
    await delay(20);
  }
  assert.equal(roomsAfterLeave, 0, 'host departure closes empty room');
  const visitor = session(invite); t.after(() => visitor.close());
  await visitor.click('#multiplayer');
  await until(() => !visitor.game.net.active, 'closed room rejected');
  assert.match(visitor.elements.get('#menu-notice').textContent, /Кімната вже закрита/);
  await visitor.click('#multiplayer'); await until(() => visitor.game.net.room, 'new room after expired invite');
  assert.notEqual(visitor.game.net.room, oldRoom);
});

test('old band links without a room code still reach the same band', async t => {
  const srv = await startServer(t), oldLink = srv.origin + '/?band=1';
  const a = session(oldLink), b = session(oldLink);
  t.after(() => { a.close(); b.close(); });
  await a.click('#multiplayer'); await until(() => a.game.net.id, 'first old-link player');
  await b.click('#multiplayer'); await until(() => b.game.net.id, 'second old-link player');
  assert.equal(a.game.net.room, '0000000000');
  assert.equal(b.game.net.room, a.game.net.room);
  await until(() => a.game.net.roster.length === 2, 'old-link band roster');
  assert.equal(a.game.net.roster.length, 2);
});

test('a guest whose connection drops mid-run comes back as the same musician', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const id = b.game.net.id, token = b.game.net.token; assert.ok(token, 'server hands out a resume token');
  b.game.net.ws.close(); // обрив зв’язку без свідомого виходу
  await until(() => srv.output.includes('втратив зв’язок'), 'server keeps the seat');
  assert.equal(a.game.G.players.length, 2, 'host keeps the actor while the guest is away');
  await until(() => b.game.net.ws && b.game.net.ws.readyState === 1 && !b.game.net.reconnecting, 'guest reconnects by itself', 8000);
  assert.equal(b.game.net.id, id, 'same player id after resume');
  assert.ok(b.game.running && b.game.net.active, 'guest stays in the run');
  assert.match(srv.output, /повернувся/);
  const bx = a.game.G.players[1].p.x;
  b.key('keydown', 'KeyD'); await delay(500); b.key('keyup', 'KeyD');
  await until(() => a.game.G.players[1].p.x > bx + 30, 'resumed guest controls its actor again');
  await until(() => Math.abs(b.game.G.p.x - a.game.G.players[1].p.x) < 20, 'resumed guest receives the world');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('a guest who cannot return in time is removed and told why', async t => {
  const srv = await startServer(t, { GRACE_MS: '700' });
  const [a, b] = await bandOfTwo(t, srv.origin);
  b.game.net.token = 'stale'; b.game.net.ws.close();
  await until(() => !b.game.net.active, 'guest gives up after the server refuses the token');
  assert.match(b.elements.get('#menu-notice').textContent, /не відновився вчасно/);
  await until(() => a.game.G.players.length === 1, 'host drops the actor after the grace period');
  assert.match(srv.output, /не повернувся вчасно/);
  assert.ok(a.game.running, 'the host keeps playing');
});

test('a stalled guest is not disconnected: periodic snapshots are skipped, event messages still arrive', async t => {
  const srv = await startServer(t);
  const a = session(srv.origin, true); t.after(() => a.close());
  await a.click('#multiplayer'); await until(() => a.game.net.id, 'host welcome');
  const net = require('node:net');
  const raw = net.connect({ port: srv.port, host: '127.0.0.1' }); t.after(() => raw.destroy());
  await new Promise(r => raw.once('connect', r));
  raw.write('GET /ws?room='+a.game.net.room+' HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  let got = ''; raw.on('data', b => { got += b.toString('latin1'); });
  await until(() => a.game.net.roster.length === 2, 'raw guest joined');
  raw.pause(); // гість «завис»: нічого не читає
  const blob = 'x'.repeat(100 * 1024);
  for (let i = 0; i < 150; i++) a.game.net.ws.send(JSON.stringify({ t: 'toAll', d: { k: 'state', blob }, drop: 1 }));
  a.game.net.ws.send(JSON.stringify({ t: 'toAll', d: { k: 'marker-ended' } }));
  await delay(1500);
  assert.equal(a.game.net.roster.length, 2, 'slow guest is still in the band');
  raw.resume();
  await until(() => got.includes('marker-ended'), 'event message delivered after the stall', 8000);
  assert.ok(got.length < 150 * blob.length, 'stale snapshots were skipped instead of queued');
});

test('a guest who was away while the band returned to the lobby comes back to the lobby, not a frozen run', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  b.game.net.ws.close();
  await until(() => srv.output.includes('втратив зв’язок'), 'seat held');
  await a.click('#quit');
  await until(() => !b.game.net.reconnecting && b.game.net.ws && b.game.net.ws.readyState === 1, 'guest reconnects', 8000);
  await until(() => b.game.net.phase === 'lobby' && !b.game.running && !b.elements.get('#lobby').classList.contains('hide'), 'guest sees the lobby');
  await until(() => a.game.net.roster.length === 2, 'guest is in the host lobby again');
  await b.pick('drums'); await until(() => !b.elements.get('#ready').disabled && !a.elements.get('#ready').disabled, 'ready buttons enabled');
  await b.click('#ready'); await a.click('#ready');
  await until(() => !a.elements.get('#start-band').disabled, 'host can start a new run');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('a host whose connection drops mid-run comes back: the run pauses and continues, nobody is sent to the lobby', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const id = a.game.net.id, match = a.game.net.match, t0 = a.game.G.t;
  a.game.net.ws.close(); // обрив у хоста, без свідомого виходу
  await until(() => srv.output.includes('втратив зв’язок'), 'server keeps the host seat');
  assert.ok(a.game.paused, 'host pauses the run while it is offline');
  await until(() => a.game.net.ws && a.game.net.ws.readyState === 1 && !a.game.net.reconnecting, 'host reconnects by itself', 8000);
  assert.equal(a.game.net.id, id); assert.ok(a.game.net.isHost, 'still the host');
  assert.equal(a.game.net.match, match, 'same run');
  await until(() => !a.game.paused && !b.game.paused && b.game.running, 'run continues for everyone');
  assert.notEqual(b.game.net.phase, 'lobby');
  assert.ok(!srv.output.includes('відключився') && a.game.G.t >= t0, 'nobody was removed');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('a guest moves its own musician immediately and stays in agreement with the host', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  await delay(200);
  const bx = b.game.G.p.x;
  b.key('keydown', 'KeyD'); await delay(60);
  assert.ok(b.game.G.p.x > bx + 1, 'own hero moves before the host answers');
  await delay(600); b.key('keyup', 'KeyD');
  await until(() => Math.abs(b.game.G.p.x - a.game.G.players[1].p.x) < 6, 'prediction converges to the host position', 3000);
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('band finder: teammates show on the minimap and get an edge arrow when off-screen', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  a.game.draw(); assert.equal(a.game.renderStats.minimapMates, 1, 'friend on the radar'); assert.equal(a.game.renderStats.offscreenMates, 0, 'nearby friend needs no arrow');
  a.game.G.players[1].p.x += 3000;
  a.game.draw(); assert.equal(a.game.renderStats.offscreenMates, 1, 'far friend gets an edge arrow'); assert.equal(a.game.renderStats.minimapMates, 1, 'far friend stays pinned to the radar edge');
  await until(() => Math.abs(b.game.G.players[1].p.x - a.game.G.players[1].p.x) < 50, 'guest sees itself far away');
  b.game.draw(); assert.equal(b.game.renderStats.offscreenMates, 1, 'guest sees an arrow to the host');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('chords are collected note by note; each instrument has a pool of 10 parts and holds at most 5', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar'); s.game.setPause(true);
  const g = s.game;
  assert.equal(g.SONG.have, 1, 'run starts on one chord');
  assert.equal(new Set([0, 1, 2, 3].map(b => g.chordAt(b).name)).size, 1, 'every bar plays the single collected chord');
  for (let k = 2; k <= 4; k++) { // картки НОТ: акорд долучається, коли зібрано всі його ноти
    for (let guard = 0; g.SONG.have < k && guard < 5; guard++) {
      let card = null; for (let i = 0; i < 400 && !card; i++) card = g.levelOptions().find(o => o.note && o.lvl === 1);
      assert.ok(card && card.slot === k - 1, 'a note card of the next chord is offered while chords are missing');
      g.applyUpgrade(card);
    }
    assert.equal(g.SONG.have, k);
  }
  assert.equal(new Set([0, 1, 2, 3].map(b => g.chordAt(b).name)).size >= 2, true, 'collected chords now move');
  // кожен інструмент починає зі стартової партії «у долю» (не картка); пул карток — решта: гітара 11 (+Пінч), інші 10
  for (const k of Object.keys(g.LAYERS)) { assert.ok(g.LAYERS[k][0].starter, k + ' starts on the beat'); assert.equal(g.LAYERS[k].filter(l => l.starter).length, 1); }
  for (const k of ['guitar','drums','bass','piano']) assert.equal(g.LAYERS[k].filter(l => !l.starter).length, k === 'guitar' ? 11 : 10, k + ' card pool');
  for (const k of ['flute','violin','sax']) assert.equal(g.LAYERS[k].filter(l => !l.starter).length, 10, k + ' has ten distinct parts');
  assert.equal(g.LAYERS.accordion.filter(l=>!l.starter).length,9,'frog has nine selectable parts plus its permanent starter');
  // стартова партія замовкає, щойно взято Бій, і місця не займає; Бій і Перебір — або-або
  const real = g.LAYERS.guitar.filter(l => !l.starter && l.id !== 'pick');
  const held = () => Object.keys(g.G.layers).filter(k => k[0] !== '$' && !g.LAYERS.guitar.find(l => l.id === k).starter).length;
  for (const l of real.slice(0, 5)) g.applyUpgrade({ l, isNew: true });
  assert.equal(held(), 5);
  for (let i = 0; i < 200; i++) assert.ok(g.levelOptions().every(o => !o.l || g.G.layers[o.l.id]), 'no sixth part is offered');
  g.applyUpgrade({ l: real[6], isNew: true });
  assert.equal(held(), 5, 'a sixth part cannot be added');
  assert.ok(!g.G.layers.pick, 'picking cannot join the strum');
  // drums play no chords: instead of chord cards the drummer collects figures for a 4-bar rhythm phrase
  await g.pick('drums'); s.game.setPause(true);
  let drumCard = null; for (let i = 0; i < 400 && !drumCard; i++) drumCard = g.levelOptions().find(o => o.rhythm);
  for (let i = 0; i < 400; i++) assert.ok(!g.levelOptions().some(o => o.note || o.chord), 'drummer is never offered notes or chords');
  assert.ok(drumCard && drumCard.add && drumCard.slot === 0, 'drummer collects rhythm figures, first slot first');
  const syn = g.G.syn, kicks = () => { const k = g.LAYERS.drums[0], out = []; for (let s = 0; s < 16; s++) out.push(k.steps(g.SONG.prog[0], s, 0, 1).map(e => e.drum).join('+')); return out.join(','); };
  const before = kicks(); g.applyUpgrade({ rhythm: true, add: true, slot: 0, fig: 'crash' });
  assert.equal(g.SONG.dfig[0], 'crash'); assert.notEqual(kicks(), before, 'the figure is heard in the base part right away');
  assert.ok(g.G.syn > syn, 'a figure on its home bar adds synergy');
  for (const [slot, fig] of [[1, 'push'], [2, 'bomb'], [3, 'fill']]) g.applyUpgrade({ rhythm: true, add: true, slot, fig });
  assert.ok(Math.abs(g.G.syn - syn * 1.54) < 1e-9, 'four home figures + classic phrase = +24% +30% (crown)');
  for (let i = 0; i < 100; i++) assert.ok(!g.levelOptions().some(o => o.rhythm), 'no cards that could only break the crown');
  // стоп-такт глушить тих, хто тримає час, але не куплений «Брейк» (він грає саме в 4-му такті)
  g.applyUpgrade({ rhythm: true, add: false, slot: 3, fig: 'stop' }); g.G.layers.fill = 1; g.G.layers.snare = 1;
  const fill = g.LAYERS.drums.find(l => l.id === 'fill'); let fillHits = 0;
  for (let bar = 0; bar < 8; bar++) for (let s = 0; s < 16; s++) if (fill.steps(g.SONG.prog[0], s, bar, 1).length) fillHits++;
  assert.ok(fillHits > 0 && g.hitsPerSec(g.SONG.genre, g.SONG.bpm, fill, 1) > 0, 'the fill part still plays on a stop bar');
  // бій шансону: густіша шістка/вісімка б'є частіше, але кожен удар слабший — шкода за такт однакова
  const strum = g.LAYERS.guitar.find(l => l.id === 'strum'), perBar = []; // бій жанру, не стартовий удар униз
  await g.pick('guitar'); g.setPause(true);
  for (const boi of [1, 2, 3]) { const S = { ...g.SONG, genre: 'chanson', boi }; g.setSong(S);
    const hps = g.hitsPerSec('chanson', S.bpm, strum, 1); perBar.push(hps); }
  assert.ok(perBar[1] > perBar[0] && perBar[2] > perBar[1], 'denser boi = more strokes, so balanceK lowers damage per stroke on its own');
  assert.deepEqual(s.errors, []);
});

test('new enemies behave: ranged notes hurt, swarms come in groups, echoes split, feedback charges', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('lofi'); await s.game.pick('drums');
  const g = s.game, G = g.G;
  G.layers = {}; // беззбройний, щоб вороги дожили
  const p = G.p;
  const strel = g.addMob('strel', p.x + 200, p.y); strel.cd = 0;
  const taran = g.addMob('taran', p.x - 250, p.y); taran.cd = 0;
  const echo = g.addMob('dilka', p.x, p.y + 900);
  await until(() => G.eshots.length > 0, 'ranged enemy fires');
  const hp = p.hp; await until(() => p.hp < hp, 'enemy notes or contact hurt the player', 6000);
  await until(() => taran.mode === 'wind' || taran.mode === 'dash', 'feedback winds up a charge');
  echo.hp = 0; await delay(80);
  assert.equal(G.mobs.filter(m => m.type === 'dilka' && m.gen).length, 2, 'echo splits into two');
  G.mobs.length = 0; G.t = 400; for (let i = 0; i < 200; i++) g.spawnMob();
  const types = new Set(G.mobs.map(m => m.type));
  for (const k of ['fal', 'shum', 'roi', 'strel', 'dilka', 'taran']) assert.ok(types.has(k), k + ' spawns by minute 7');
  g.draw(); assert.deepEqual(s.errors, []);
});

test('bosses arrive at 5, 10 and 15 minutes; killing the last one wins the run (solo and band)', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game;
  for (const [i, at] of [[0, 300], [1, 600], [2, 900]]) {
    g.G.t = at - .02; g.G.bossNext = i;
    await until(() => g.G.mobs.some(m => m.type === 'boss' + (i + 1)), 'boss ' + (i + 1) + ' spawns');
    const b = g.G.mobs.find(m => m.type === 'boss' + (i + 1));
    g.hurtMob(b, 1, 500, 500); assert.equal(b.kx, 0, 'bosses ignore knockback'); assert.equal(b.stun || 0, 0);
    g.G.p.hp = g.G.p.max; g.draw();
    if (i < 2) { b.hp = 0; await until(() => !g.G.mobs.includes(b), 'boss dies'); assert.ok(g.running, 'run continues'); }
    else { b.hp = 0; await until(() => !g.running, 'final boss ends the run'); }
  }
  assert.equal(g.G.won, true); assert.match(s.elements.get('#over h1').textContent, /Перемога/);
  assert.deepEqual(s.errors, []);
  // у гурті гість бачить перемогу, а не поразку
  const srv = await startServer(t);
  const [a, b2] = await bandOfTwo(t, srv.origin);
  a.game.G.t = 899.98; a.game.G.bossNext = 2;
  await until(() => a.game.G.mobs.some(m => m.type === 'boss3'), 'final boss in band');
  await until(() => b2.game.G.mobs.some(m => m.type === 'boss3'), 'guest sees the boss');
  for (const p of a.game.G.players) p.p.hp = p.p.max;
  a.game.G.mobs.find(m => m.type === 'boss3').hp = 0;
  await until(() => !b2.game.running && b2.game.G.won, 'guest receives the victory');
  assert.match(b2.elements.get('#over h1').textContent, /переміг/);
  assert.deepEqual(a.errors, []); assert.deepEqual(b2.errors, []);
});

test('every part, piece of gear, chord and rest card has its own code-drawn picture', async t => {
  const s = session('http://127.0.0.1:8080'); t.after(() => s.close());
  const g = s.game, seen = new Set();
  for (const [inst, layers] of Object.entries(g.LAYERS)) for (const l of layers) {
    assert.ok(g.ICON.has(inst, l.id), 'picture for ' + inst + '/' + l.id);
    const svg = g.ICON.part(inst, l.id); assert.match(svg, /^<svg/); assert.ok(!/NaN|undefined/.test(svg), inst + '/' + l.id); seen.add(svg);
  }
  for (const pd of g.PEDALS) { const svg = g.ICON.gear(pd); assert.ok(!/NaN|undefined/.test(svg), pd.id); seen.add(svg); }
  for (const svg of [g.ICON.chord(true), g.ICON.chord(false), g.ICON.heal()]) { assert.ok(!/NaN|undefined/.test(svg)); seen.add(svg); }
  assert.ok(seen.size >= 40 + 20, 'pictures are distinct, not one placeholder');
  await g.pick('bass'); g.setPause(true); g.G.xp = 99; g.levelUp();
  assert.ok(s.elements.get('#opts').children.length > 0); assert.deepEqual(s.errors, []);
});

test('own attacks reflect enemy notes back into enemies', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('drums');
  const g = s.game, G = g.G, p = G.p;
  G.layers.crash = 3; G.layers.kick = 3;
  const target = g.addMob('glush', p.x + 300, p.y); target.spd = 0; target.hp = target.max = 1e6;
  let parried = 0;
  const end = Date.now() + 6000;
  while (Date.now() < end && !(G.parried > 2 && target.hp < 1e6)) {
    p.hp = p.max; G.xp = 0;
    if (G.eshots.length < 6) for (let i = 0; i < 4; i++) { const a = i / 4 * 6.283; G.eshots.push({ x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 60, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60, r: 6, age: 0, life: 3, dmg: 9, col: '#5fc4d9' }); }
    await delay(50);
  }
  assert.ok(G.parried > 2, 'drum hits reflect incoming notes');
  assert.ok(target.hp < 1e6, 'a reflected note damages an enemy');
  assert.ok(G.eshots.every(e => !e.fr || e.owner !== undefined), 'reflected notes remember who hit them back');
  g.draw(); assert.deepEqual(s.errors, []);
});

test('a level no longer changes max HP or heals; the +10% max HP card raises both by the same amount', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  await s.game.pick('bass'); const g = s.game, base = g.G.p.max;
  g.G.p.hp = 50; g.G.xp = 99; g.levelUp();
  assert.equal(g.G.p.max, base); assert.equal(g.G.p.hp, 50);
  g.applyUpgrade({ hp: true });
  assert.equal(g.G.p.max, base * 1.1); assert.equal(g.G.p.hp, 50 + base * .1);
  for (let i = 0; i < 10; i++) g.applyUpgrade({ hp: true });
  assert.equal(g.G.layers.$hp, 5, 'the card stacks up to five times'); assert.ok(Math.abs(g.G.p.max - base * 1.5) < .1);
  g.setPause(true); for (let i = 0; i < 100; i++) assert.ok(!g.levelOptions().some(o => o.hp || o.heal), 'no more HP cards at five, and no heal card ever');
  assert.deepEqual(s.errors, []);
});

test('pixel FX pack: instrument-coloured hit sparks, level-up star, revive lotus and boss death reach the guest', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('bass');
  const g = s.game, G = g.G;
  assert.match(g.VISUAL_ASSETS.fxpack, /^assets\/fx-pack-v1\.png(\?v=\d+)?$/);
  const m = g.addMob('glush', G.p.x + 40, G.p.y); m.spd = 0; m.hp = m.max = 1e6;
  g.hurtMob(m, 1, 0, 0); assert.equal(m.hc, 3, 'a bass hit picks the blue spark row');
  g.draw(); assert.ok(g.renderStats.packFX >= 1, 'the spark is drawn from the pack atlas');
  // атаки героїв теж із пакета: конус, кільце, вибух ревера, снаряд і блискавка
  const base = { owner: null, age: .1, hit: new Set() };
  G.cones.push({ ...base, inst: 'guitar', layer: 'strum', x: G.p.x, y: G.p.y, dir: 0, r: 10, maxR: 90 });
  G.rings.push({ ...base, inst: 'drums', layer: 'kick', x: G.p.x, y: G.p.y, r: 30, maxR: 80 }, { ...base, inst: 'piano', layer: 'chords', x: G.p.x + 20, y: G.p.y, r: 20, maxR: 50, boom: true });
  G.shots.push({ ...base, inst: 'bass', layer: 'root', x: G.p.x + 30, y: G.p.y, r: 8, vx: 300, vy: 0, life: 1 }, { ...base, inst: 'piano', layer: 'mel', x: G.p.x - 30, y: G.p.y, r: 6, vx: 0, vy: 200, life: 1 });
  G.zaps.push({ ...base, inst: 'drums', layer: 'hat', x1: G.p.x, y1: G.p.y, x2: G.p.x + 60, y2: G.p.y + 20 });
  g.draw(); assert.ok(g.renderStats.packFX >= 8, 'every attack kind is drawn from the pack atlas');
  G.cones = []; G.rings = []; G.shots = []; G.zaps = [];
  // багато ворогів під ударом: іскри не виходять за спільний ліміт VFX, HP видно всім
  for (let i = 0; i < 200; i++) { const e = g.addMob('fal', G.p.x + (i % 20) * 8 - 80, G.p.y + Math.floor(i / 20) * 8 - 40); e.flash = .1; e.hc = 1 + i % 4; }
  g.draw(); assert.ok(g.renderStats.spriteFX <= 120, 'spark budget holds'); assert.equal(g.renderStats.hpBars, g.G.mobs.length);
  G.mobs = []; G.xp = 99; g.levelUp(); assert.ok(G.pfx.some(f => f.k === 'star' && f.who === 'solo'), 'level-up star over the hero');
  assert.deepEqual(s.errors, []);
  // гурт: усе, що бачить хост, бачить і гість
  const srv = await startServer(t);
  // атлас може бути не в репозиторії (ліцензія пакета): тоді гра малює старі ефекти, а перевірку роздачі пропускаємо
  if (fs.existsSync(path.join(__dirname, 'assets', 'fx-pack-v1.png'))) {
    const atlas = await fetch(srv.origin + '/assets/fx-pack-v1.png'); assert.equal(atlas.status, 200, 'server serves the FX atlas');
    assert.equal(atlas.headers.get('content-type'), 'image/png');
  }
  const [a, b] = await bandOfTwo(t, srv.origin);
  const host = a.game, guest = b.game, H = host.G;
  for (const p of H.players) p.p.hp = p.p.max;
  const hit = host.addMob('glush', H.players[0].p.x + 300, H.players[0].p.y); hit.spd = 0; hit.hp = hit.max = 1e6;
  host.hurtMob(hit, 1, 0, 0); assert.equal(hit.hc, 1, 'host guitar hit');
  await until(() => guest.G.mobs.some(e => e.netId === hit.netId && e.hc === 1), 'guest gets the guitar spark colour (index 1 survives the wire)');
  const boss = host.addMob('boss1', H.players[0].p.x + 200, H.players[0].p.y); boss.spd = 0; boss.hp = 0;
  await until(() => (guest.G.pfx || []).some(f => f.k === 'boom') && guest.G.pfx.some(f => f.k === 'skull'), 'guest sees boss explosion and skull');
  const mate = H.players.find(p => p.char === 'drums'); mate.p.hp = 0; H.xp = 99; host.levelUp();
  assert.ok(H.pfx.some(f => f.k === 'lotus' && f.who === mate.id), 'downed teammate rises with a lotus');
  await until(() => (guest.G.pfx || []).some(f => f.k === 'lotus') && guest.G.pfx.filter(f => f.k === 'star').length === 2, 'guest sees both stars and the lotus');
  guest.draw(); host.draw();
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('music answers the game: quiet without a fight, opens in combat and motion, dips on hits, events get cues; notes for attacks stay untouched', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('piano');
  const g = s.game, G = g.G, p = G.p, M = g.MUSIC_REACT, bus = g.buses.piano;
  await delay(300);
  assert.ok(g.reactState('solo').eng < .05, 'no enemies: the part is idle');
  await until(() => bus.react.frequency.value < 3000, 'idle part is darkened');
  const evs = [{ midi: 72, vel: .8, dur: 1 }], quiet = g.reactNotes(evs, 4, 0);
  assert.notEqual(quiet, evs); assert.equal(evs[0].vel, .8, 'attack notes are not modified');
  assert.ok(quiet[0].vel < .8 * .6, 'idle notes play softer');
  for (let i = 0; i < 6; i++) { const m = g.addMob('glush', p.x + 60 + i * 10, p.y + 40); m.spd = 0; m.hp = m.max = 1e6; m.r = 4; }
  await until(() => { p.hp = p.max; return g.reactState('solo').eng > .9; }, 'combat engages the part');
  await until(() => bus.react.frequency.value > 12000, 'combat opens the part');
  assert.ok(g.reactNotes(evs, 4, 0)[0].vel > .75, 'combat notes play at full strength');
  // удар по героєві — провал фільтра; мало HP — музика глухне
  const lp = g.masterReact.lp; p.hurt = .15;
  await until(() => lp.frequency.events.some(e => e[0] === 'set' && e[1] === M.hurtCut), 'a hit dips the whole mix');
  p.hp = p.max * .2; await until(() => g.masterReact.mood.gain.value === M.lowGain && lp.frequency.value === M.lowCut, 'low HP muffles the music');
  p.hp = p.max; G.mobs = [];
  // рух угору на пів секунди — мелодія переходить на октаву вище з першої долі такту
  const t0 = Date.now(); while (Date.now() - t0 < 900) { p.y -= 3; p.hp = p.max; await delay(16); }
  assert.equal(g.reactState('solo').want, 1, 'moving up asks for the upper octave');
  g.reactNotes(evs, 0, 1); await delay(200);
  await until(() => g.reactNotes(evs, 4, 1)[0].midi === 84, 'single melody notes follow the movement an octave up');
  assert.equal(evs[0].midi, 72);
  // бос: гул, поки живий; рівень: сигнал після вибору
  const boss = g.addMob('boss1', p.x + 200, p.y); boss.spd = 0;
  await until(() => g.bossDrone, 'boss drone starts'); boss.hp = 0; await until(() => !g.bossDrone, 'boss drone stops when the boss dies');
  G.gems = []; G.mobs = []; const lvl = G.level; G.xp = 99; g.levelUp(); await delay(100);
  assert.equal(g.reactWorld.level, lvl, 'no level cue while the choice screen is open');
  G.xp = 0; await s.elements.get('#opts').children[0].onclick();
  await until(() => g.reactWorld.level === G.level && !g.reactWorld.pendingLevel, 'level cue plays after the choice', 8000);
  assert.deepEqual(s.errors, []);
  // гурт: гість рахує ту саму реакцію для партії хоста
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  const H = a.game.G, hostId = a.game.net.id, hp = H.players.find(x => x.id === hostId).p;
  for (let i = 0; i < 6; i++) { const m = a.game.addMob('glush', hp.x + 50 + i * 8, hp.y + 30); m.spd = 0; m.hp = m.max = 1e6; m.r = 4; }
  await until(() => { for (const x of H.players) x.p.hp = x.p.max; return a.game.reactState(hostId).eng > .9 && b.game.reactState(hostId).eng > .9; }, 'host and guest both hear the host part engaged');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('level-up choice works from the keyboard: Q/E move the highlight, Space takes it, not instantly after the screen opens', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G; G.gems = []; G.xp = 99; g.levelUp();
  const opts = s.elements.get('#opts').children, sel = () => opts.findIndex(b => b.classList.contains('sel'));
  assert.ok(opts.length >= 2); assert.equal(sel(), 0, 'first card is highlighted');
  s.key('keydown', 'KeyE'); assert.equal(sel(), 1, 'E moves right');
  s.key('keydown', 'KeyQ'); s.key('keydown', 'KeyQ'); assert.equal(sel(), opts.length - 1, 'Q moves left and wraps around');
  const level = G.level, state = () => JSON.stringify([G.layers, G.pedals, g.SONG.have, g.SONG.prog.map(c => c.name), Math.round(G.p.hp)]);
  G.p.hp = G.p.max * .5; const before = state();
  s.key('keydown', 'Space'); await delay(50); assert.equal(g.choosing, true, 'a held Space right as the screen opens does not pick');
  await delay(400); G.xp = 0; s.key('keydown', 'Space');
  await until(() => !g.choosing, 'Space takes the highlighted card');
  assert.notEqual(state(), before, 'the highlighted upgrade was applied');
  assert.equal(G.level, level); assert.deepEqual(s.errors, []);
});

test('lo-fi, reggae and jazz grooves: real genre figures, phrase variation, same notes for every player of the same song', async t => {
  const grid = (g, inst, id, bars = 4) => { const S = g.SONG, n = S.prog.length, have = S.have || n, ch = b => S.prog[(b % n) % Math.max(1, Math.min(n, have))];
    const Ly = g.LAYERS[inst].find(l => l.id === id), out = [];
    for (let bar = 0; bar < bars; bar++) for (let s = 0; s < 16; s++) { const e = Ly.steps(ch(bar), s, bar, 1); if (e.length) out.push([bar, s, e.map(x => [x.midi, x.drum, x.dir, x.vel])]); }
    return out; };
  const steps = (gr, bar) => gr.filter(x => x[0] === bar).map(x => x[1]);
  for (const genre of ['lofi', 'reggae', 'jazz']) {
    const a = session('http://127.0.0.1:8080'), b = session('http://127.0.0.1:8080'); t.after(() => { a.close(); b.close(); });
    a.game.setGenre(genre); await a.game.pick('guitar'); b.game.setGenre(genre); await b.game.pick('guitar');
    b.game.setSong(JSON.parse(JSON.stringify(a.game.SONG)));
    for (const [inst, id] of [['guitar', 'strum'], ['drums', 'kick'], ['drums', 'snare'], ['drums', 'hat'], ['bass', 'root'], ['piano', 'chords']])
      assert.equal(JSON.stringify(grid(a.game, inst, id, 8)), JSON.stringify(grid(b.game, inst, id, 8)), genre + '/' + id + ': same song, same notes for every player');
    const g = a.game;
    if (genre === 'reggae') {
      assert.deepEqual(steps(grid(g, 'drums', 'kick'), 0), [4, 12], 'one drop on 2 and 4 at a reggae count');
      assert.deepEqual(steps(grid(g, 'guitar', 'strum'), 0), [2, 6, 10, 14], 'skank on every off-beat eighth');
      assert.ok(!steps(grid(g, 'bass', 'root'), 0).includes(0) && !steps(grid(g, 'bass', 'root'), 1).includes(0), 'the riddim leaves beat one empty');
    }
    if (genre === 'jazz') {
      assert.deepEqual(steps(grid(g, 'bass', 'root'), 0), [0, 4, 8, 12], 'walking bass in quarter notes');
      const gr = grid(g, 'guitar', 'strum'); assert.ok(gr.every(x => x[1] % 2 === 0), 'swung comping stays on the eighth grid');
      assert.notDeepEqual(steps(gr, 0), steps(gr, 1), 'comping changes from bar to bar');
    }
    if (genre === 'lofi') {
      assert.notDeepEqual(steps(grid(g, 'guitar', 'strum'), 0), [0, 4, 8, 12], 'no flat quarter-note strumming');
      assert.notDeepEqual(steps(grid(g, 'drums', 'kick'), 3), steps(grid(g, 'drums', 'kick'), 0), 'the 4th bar of a phrase varies the beat');
      // нота → акорди: тоніка на старті — трізвук (рівень 1); нона з'являється на рівні 3 (раніше була в повному акорді одразу)
      assert.equal(g.SONG.prog[0].lvl, 1); const c3 = g.mkChord(g.SONG, 0, 3); assert.ok(c3.pcs.includes((c3.root + 2) % 12), 'lo-fi chords reach the ninth at level 3');
    }
    assert.deepEqual(a.errors, []);
  }
});

test('bosses play their own parts and attack on their notes: tape-replay bursts, auto-tune spiral, conductor fermata', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p, keep = () => { p.hp = p.max; G.xp = 0; };
  const fight = async (type, ms) => { G.mobs = []; G.eshots = []; const b = g.addMob(type, p.x + 260, p.y); b.spd = 0; b.hp = b.max = 1e7;
    const end = Date.now() + ms, shots = []; let casts = 0;
    while (Date.now() < end) { keep(); b.x = p.x + 260; b.y = p.y; /* бос лишається на відстані: після ривку він інакше стоїть упритул, і ноти гаснуть об героя; снаряди героя більше не відбивають ноти й не подовжують їм життя */ if (b.castK && b.castAt !== undefined) casts++; shots.push(G.eshots.length); await delay(30); }
    return { b, shots, casts }; };
  // Фонограма: залпи по 12 нот на сильні долі, не за таймером
  let r = await fight('boss1', 3200);
  assert.ok(G.eshots.length >= 12, 'tape boss fires bursts on its beats');
  assert.ok(r.casts > 0, 'the boss winds up before a queued attack');
  // Автотюн: кожна його нота — виток спіралі з 3 рукавів
  r = await fight('boss2', 4500); // довше вікно: снаряди героя більше не відбивають ноти (а відбиті жили довше), тож у вікно має влучити кілька витків
  assert.ok(Math.max(...r.shots) >= 3, 'auto-tune spiral turns come on its notes');
  // Диригент Тиші: у 4-му такті фрази фермата — уся музика гурту притихає
  const m = g.masterReact.master.gain;
  r = await fight('boss3', 9000);
  assert.ok(m.events.some(e => e[0] === 'set' && e[1] === .04), 'fermata silences the band');
  assert.ok(G.eshots.length > 0, 'conductor attacks on its stabs');
  assert.deepEqual(s.errors, []);
});

test('new genres have distinct primary parts and blues follows twelve bars with collected chords', t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const signatures=new Set();
  for(const genre of ['funk','synthwave','folkrock','blues','dnb']){
    const song=g.makeSong(null,genre);song.have=4;g.setSong(song);
    const out=[];for(let bar=0;bar<4;bar++)for(let step=0;step<16;step++)out.push(g.LAYERS.guitar[0].steps(g.chordAt(bar),step,bar,1));
    signatures.add(JSON.stringify(out));
    for(const inst of ['flute','violin','sax','accordion'])assert.ok(g.GENRES[genre].sf[inst],genre+' includes '+inst);
  }
  assert.equal(signatures.size,5,'each genre has its own guitar part');
  const blues=g.makeSong(null,'blues');blues.have=4;g.setSong(blues);
  assert.deepEqual(Array.from({length:12},(_,bar)=>g.chordAt(bar).off),[0,0,0,0,5,5,0,0,7,5,0,7]);
  assert.ok(blues.prog.slice(1).every(ch=>ch.q==='7'),'future bars are dominant sevenths'); // тоніка в забігу — трізвук; септима приходить із карткою (рівень 2)
  assert.equal(g.mkChord(blues,0,2).q,'7');
  blues.have=1;assert.ok(Array.from({length:12},(_,bar)=>g.chordAt(bar).off).every(off=>off===0));
  assert.deepEqual(s.errors,[]);
});

test('four new instruments join a real Wi-Fi band, sound on each device and share their combat effects', async t=>{
  const server=await startServer(t),sessions=[];t.after(()=>sessions.forEach(s=>s.close()));
  const instruments=['flute','violin','sax','accordion'];
  for(const inst of instruments){
    const s=session(sessions.length?roomUrl(server.origin,sessions[0]):server.origin,true);sessions.push(s);await s.click('#multiplayer');await until(()=>s.game.net.id,'new player welcome');await s.pick(inst);
  }
  const host=sessions[0];await until(()=>host.game.net.roster.every(p=>p.char),'new band picks');
  for(const genre of ['funk','synthwave','folkrock','blues','dnb']){
    host.game.net.ws.send(JSON.stringify({t:'genre',genre}));
    await until(()=>sessions[1].elements.get('#lobby-genres').children.some(b=>b.dataset.g===genre&&b.classList.contains('on')),'relay accepts '+genre);
  }
  for(const s of sessions){s.game.logNotes(true);await s.click('#ready');}
  await until(()=>host.game.net.roster.every(p=>p.ready),'new band ready');await host.click('#start-band');
  await until(()=>sessions.every(s=>s.game.running),'new band plays');
  const owners=new Set();await until(()=>{
    for(const f of host.game.G.instrumentFX||[])owners.add(f.owner);
    return owners.size===4;
  },'all four signature attacks');
  await until(()=>sessions.every(s=>new Set(s.game.notes.map(n=>n.inst)).size===4),'all devices play all instruments');
  await until(()=>sessions[1].game.G.instrumentFX?.some(f=>f.owner===host.game.net.id),'guest receives new attack geometry');
  await host.click('#pause');await until(()=>sessions.every(s=>s.game.paused),'shared pause');
  for(const s of sessions){
    assert.equal(s.game.SONG.genre,'dnb');assert.equal(s.game.G.players.length,4);
    assert.ok(s.game.notes.every(n=>Number.isFinite(n.t)&&Number.isFinite(n.duration)));
    assert.doesNotThrow(()=>JSON.stringify(s.game.cleanState()));s.game.draw();assert.deepEqual(s.errors,[]);
  }
  const frog=host.game.G.players.find(a=>a.char==='accordion'),songBefore=JSON.stringify(host.game.SONG.prog);
  host.game.withPlayer(frog,()=>host.game.applyUpgrade({voicing:'sev'}));
  assert.equal(host.game.cleanState().players.find(a=>a.char==='accordion').layers.$v_sev,1);
  assert.equal(JSON.stringify(host.game.SONG.prog),songBefore);
  await host.click('#resume');
  await until(()=>sessions[1].game.G.players.find(a=>a.char==='accordion')?.layers.$v_sev===1,'personal frog chord reaches the band');
  assert.equal(JSON.stringify(sessions[1].game.SONG.prog),songBefore,'the shared song stays unchanged on the guest');
});

test('offline electronic voices use separate caches and new instrument envelopes stay finite', async t=>{
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('synthwave');await g.pick('bass');g.setPause(true);
  assert.ok(g.cache.some(k=>k.startsWith('syn-bass-synthbass:')));
  await g.pick('piano');g.setPause(true);assert.ok(g.cache.some(k=>k.startsWith('syn-piano:'))&&!g.cache.some(k=>k.includes('synthkeys')||k.includes('clavinet')),'keys are never synth/clavinet — always the acoustic piano buffers');
  for(const inst of ['flute','violin','sax','accordion']){
    g.setGenre('folkrock');await g.pick(inst);g.setPause(true);g.logNotes(true);
    await g.reqBuf(inst,72);g.playBuffered(g.ctx.currentTime+.05,{midi:72,vel:.5,seconds:.6});
    assert.ok(g.notes.some(n=>n.inst===inst&&n.duration>0&&n.duration<=.6));
    assert.equal(g.availableGear(inst).length,inst==='accordion'?12:10);
    const foreign=g.PEDALS.find(p=>p.inst!==inst);g.applyUpgrade({pd:foreign});assert.equal(Object.keys(g.G.pedals).length,0);
    for(const layer of g.LAYERS[inst])assert.ok(g.ICON.has(inst,layer.id));
  }
  assert.deepEqual(s.errors,[]);
});

test('frog skill catalog has distinct art, attack profiles and all three translations',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game,inst='accordion';
  const layers=g.LAYERS[inst],gear=g.availableGear(inst),voicings=g.VOICINGS[inst],variants=g.VARIANTS.pulse.cards;
  assert.equal(layers.length,10);assert.equal(gear.filter(p=>p.cat==='sound').length,5);
  assert.ok(gear.filter(p=>p.cat==='damage').length>=5);assert.equal(Object.keys(voicings).length,5);
  const partArt=new Set();for(const layer of layers){assert.ok(g.ICON.has(inst,layer.id),layer.id+' icon');assert.ok(g.FX_PROFILES[inst+'-'+layer.id],layer.id+' attack profile');partArt.add(g.ICON.part(inst,layer.id));}
  assert.equal(partArt.size,layers.length,'each frog part has its own icon');
  const gearArt=new Set();for(const pd of gear){assert.ok(g.ICON.hasGear(pd.key),pd.key+' gear icon');gearArt.add(g.ICON.gear(pd));}
  assert.equal(gearArt.size,gear.length,'each frog gear card has its own icon');
  const dictContext=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'i18n.js'),'utf8'),dictContext);
  const dict=dictContext.window.I18N_DICT;
  const texts=[...layers.slice(5).flatMap(l=>[l.name,l.desc]),...gear.slice(4).flatMap(p=>[p.name,...p.lv]),...Object.values(voicings).flatMap(v=>[v.name,v.desc]),...Object.values(variants).flatMap(v=>[v.name,v.desc]),'Звук','Шкода','Акорд','Партія'];
  for(const value of texts)for(const lang of ['en','de','ru'])assert.ok(dict[lang][value],lang+' translation: '+value);
});

test('frog personal chords, variants and sound gear stay personal',async t=>{
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('chanson');await g.pick('accordion');g.setPause(true);const original=JSON.stringify(g.SONG.prog);
  for(const id of Object.keys(g.VOICINGS.accordion))g.applyUpgrade({voicing:id});
  assert.equal(Object.keys(g.G.layers).filter(k=>k.startsWith('$v_')).length,5);
  assert.equal(JSON.stringify(g.SONG.prog),original,'personal voicings do not edit the song');
  const ch=g.chordAt(0),v=g.voiced(ch,g.G.layers,0);assert.notEqual(v,ch);assert.ok(v.pcs.length>=ch.pcs.length);
  assert.equal(g.voiced(ch,{},0),ch,'another player keeps the original chord');
  g.SONG.have=4;
  for(let bar=0;bar<4;bar++)for(let step=0;step<16;step++){
    const voiced=g.voiced(g.chordAt(bar),g.G.layers,step);
    for(const part of g.LAYERS.accordion)for(const e of part.steps(voiced,step,bar,1))if(e.midi!==undefined)assert.ok(voiced.pcs.includes(((e.midi%12)+12)%12),part.id+' stays in the personal chord');
  }
  assert.ok(g.levelOptions().every(o=>!o.voicing),'five chord slots are full');
  const starter=g.LAYERS.accordion[0],before=starter.steps(ch,0,0,1)[0].midi;
  g.applyUpgrade({l:starter,variant:'waltz'});assert.equal(g.G.layers.pulse,1);assert.equal(g.G.layers.$frogpick,'waltz');
  assert.equal(starter.steps(ch,0,0,1)[0].midi,before);assert.notEqual(starter.steps(ch,4,0,1)[0].midi,starter.steps(ch,8,0,1)[0].midi);
  const left=g.LAYERS.accordion.find(l=>l.id==='bass'),oompah=g.LAYERS.accordion.find(l=>l.id==='oompah');
  g.applyUpgrade({l:left});g.applyUpgrade({l:oompah});assert.equal(g.G.layers.oompah,undefined,'rival stays locked');
  const sound=g.availableGear('accordion').filter(p=>p.cat==='sound');for(const pd of sound)g.applyUpgrade({pd});
  assert.equal(Object.keys(g.G.pedals).length,5);assert.ok(g.levelOptions().every(o=>!o.pd||!o.isNew||o.pd.cat==='damage'));
  assert.ok(g.buses.accordion.tremDepth.gain.value>0,'bellows shake changes the audio bus');
  g.logNotes(true);const event=starter.steps(g.voiced(ch,g.G.layers,0),0,0,1);g.fire(g.ctx.currentTime+.05,event);
  assert.ok(g.notes.some(n=>n.midi===event[0].midi-12),'bandoneon adds a lower reed');
  assert.ok(g.notes.some(n=>n.midi===event[0].midi+12),'piccolo adds an upper reed');
  assert.deepEqual(s.errors,[]);
});

test('each frog sound card changes an audible voice or bus control',async t=>{
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('chanson');await g.pick('accordion');g.setPause(true);
  const gear=Object.fromEntries(g.availableGear('accordion').map(p=>[p.key,p]));
  const e=g.LAYERS.accordion[0].steps(g.chordAt(0),0,0,1),at=()=>g.ctx.currentTime+.05;
  g.logNotes(true);g.fire(at(),e);const musetteBefore=g.notes[0].musette;
  g.applyUpgrade({pd:gear.musette});g.logNotes(true);g.fire(at(),e);
  assert.ok(g.notes[0].musette>musetteBefore,'musette changes reed beating');
  g.bellowsBar(at(),0);const before=g.buses.accordion.bellowsLP.frequency.events.filter(x=>x[0]==='set').at(-1)[1];
  g.applyUpgrade({pd:gear.cassotto});g.bellowsBar(at(),0);
  const after=g.buses.accordion.bellowsLP.frequency.events.filter(x=>x[0]==='set').at(-1)[1];
  assert.ok(after<before*.9,'cassotto lowers the bellows filter');
  g.applyUpgrade({pd:gear.shake});assert.ok(g.buses.accordion.tremDepth.gain.value>.1,'shake modulates bus gain');
  g.applyUpgrade({pd:gear.bandoneon});g.applyUpgrade({pd:gear.piccolo});g.logNotes(true);g.fire(at(),e);
  assert.ok(g.notes.some(n=>n.midi===e[0].midi-12),'16-foot reed is lower');
  assert.ok(g.notes.some(n=>n.midi===e[0].midi+12),'4-foot reed is higher');
  assert.deepEqual(s.errors,[]);
});

function testSoundfont(){
  const names=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  return JSON.stringify(Object.fromEntries(Array.from({length:57},(_,i)=>{const midi=i+40;return[names[midi%12]+(Math.floor(midi/12)-1),'data:audio/mp3;base64,AAAA'];})));
}
test('new decoded instruments are level-matched and violin pizzicato uses its own warmed bank',async t=>{
  const s=session('http://127.0.0.1:8080',true,{soundfontText:testSoundfont(),sampleLevel:.05});t.after(()=>s.close());const g=s.game;
  g.setGenre('folkrock');
  for(const inst of ['flute','violin','sax','accordion']){
    await g.pick(inst);g.setPause(true);await g.reqBuf(inst,69);g.logNotes(true);
    g.playBuffered(g.ctx.currentTime+.05,{midi:69,vel:.55,seconds:.85});
    const note=g.notes.at(-1);assert.ok(note.trim>3&&note.trim<5,inst+' raises a quiet decoded sample to the body target');
    assert.ok(g.buses[inst].out.gain.value>=.9,inst+' is no longer attenuated twice');
    if(inst==='violin'){
      const layer=g.LAYERS.violin.find(l=>l.id==='pizz');await g.warmLayer(layer);
      assert.ok(g.cache.some(k=>k.startsWith('pizzicato_strings:')),'pizzicato is warmed under its articulation bank');
      await g.reqBuf(inst,69,'pizzicato');g.playBuffered(g.ctx.currentTime+.1,{midi:69,vel:.5,seconds:.2,art:'pizzicato'});
      assert.equal(g.notes.at(-1).source,'pizzicato_strings');assert.ok(g.notes.at(-1).duration>3,'a plucked note rings to its own sample end');
    }
  }
  assert.deepEqual(s.errors,[]);
});
test('failed MP3 decoding renders a playable new-instrument synth instead of silence',async t=>{
  const s=session('http://127.0.0.1:8080',true,{soundfontText:testSoundfont(),failDecode:true});t.after(()=>s.close());const g=s.game;
  g.setGenre('folkrock');await g.pick('flute');g.setPause(true);await g.reqBuf('flute',69);g.logNotes(true);
  g.playBuffered(g.ctx.currentTime+.05,{midi:69,vel:.55,seconds:.85});
  assert.equal(g.notes.at(-1).source,'syn-flute-decode-fallback');assert.ok(g.voices.at(-1).source.buffer.length>1);
  assert.deepEqual(s.errors,[]);
});

test('new starter instruments keep the sole unlocked chord until all its notes are collected',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  await g.pick('flute');g.setPause(true);
  for(const genre of Object.keys(g.GENRES)){
    const song=g.makeSong(null,genre);g.setSong(song);assert.equal(song.have,1);
    const starterNotes=inst=>Array.from({length:12},(_,bar)=>{
      const notes=[];for(let step=0;step<16;step++)notes.push(...(['flute','sax'].includes(inst)?g.LAYERS[inst][0]:g.LAYERS[inst].find(l=>!l.starter)).steps(g.chordAt(bar),step,bar,1).filter(e=>!e.orn).map(e=>e.midi));return notes; /* стартова партія флейти й сакса веде мелодію пісні (лише ноти відкритих акордів); у решти — головна партія */
    });
    for(const inst of ['flute','violin','sax','accordion']){
      const bars=starterNotes(inst),root=song.prog[0].root;
      const melodic=['accordion','flute','sax'].includes(inst);
      for(const notes of bars){const allowed=melodic?Array.from(song.prog[0].pcs):[root];assert.ok(notes.every(m=>allowed.includes(m%12)),genre+'/'+inst+' holds the unlocked chord');if(!melodic)assert.deepEqual(notes,bars[0],genre+'/'+inst+' cannot rotate notes automatically');}
    }
    assert.equal(song.have,1,'playing bars never unlocks chords');
    // раніше одна картка акорду додавала такт; тепер акорд долучається, коли зібрано всі його ноти (2–3 картки)
    for(let n=0;n<3;n++){assert.equal(song.have,1,'the chord is not in the song before its last note');const card=g.noteCards().find(o=>o.lvl===1);assert.ok(card&&card.slot===1,genre+' offers a note of the next chord');g.applyUpgrade(card);if(song.have===2)break;}
    assert.equal(song.have,2);
    const allowed=new Set(Array.from(song.prog.slice(0,2),ch=>ch.root));
    for(const inst of ['flute','violin','sax','accordion']){
      const roots=new Set(starterNotes(inst).flat().map(m=>m%12));
      if(inst!=='accordion'&&inst!=='violin'){
        const pcs=new Set(Array.from(song.prog.slice(0,2)).flatMap(ch=>Array.from(ch.pcs)));
        for(const pc of roots)assert.ok(pcs.has(pc),genre+'/'+inst+' never plays a locked chord');
      }else if(inst==='accordion'){
        const pcs=new Set(Array.from(song.prog.slice(0,2)).flatMap(ch=>Array.from(ch.pcs)));
        assert.deepEqual([...roots].sort((a,b)=>a-b),[...pcs].sort((a,b)=>a-b),genre+'/'+inst+' plays exactly the unlocked chord tones');
      }else{assert.equal(roots.size,2,genre+'/'+inst+' follows the second chord only after the card');for(const root of roots)assert.ok(allowed.has(root),genre+'/'+inst+' never plays a locked chord');}
    }
  }
  assert.deepEqual(s.errors,[]);
});

test('each instrument owns its song caption and icon silhouette on the same song',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game,shapes=new Set(),icons=new Set();
  const song=g.makeSong(null,'chanson');song.boi=2;g.setSong(song);const original=JSON.stringify(song),labels=new Set();
  for(const inst of Object.keys(g.CHARS)){
    g.setChar(inst);const label=g.songLabel(),part=g.songPartLabel();labels.add(part);
    assert.ok(label.includes(part));
    if(inst==='guitar')assert.match(label,/Бій «шістка»/);
    else{assert.ok(!label.includes('шістка')&&!label.includes('Бій «'),'guitar strum cannot leak to '+inst);assert.equal(part,g.LAYERS[inst][0].name);}
    const first=g.ICON.part(inst,g.LAYERS[inst][0].id),symbol=first.match(/<g class="instrument-symbol"[^>]*>([\s\S]*?)<\/g>/);
    assert.ok(symbol,inst+' has a real instrument silhouette');shapes.add(symbol[1].replace(/#[0-9a-f]{3,8}/gi,'#color'));
    for(const layer of g.LAYERS[inst])icons.add(g.ICON.part(inst,layer.id).replace(/#[0-9a-f]{3,8}/gi,'#color'));
  }
  assert.equal(labels.size,8);assert.equal(shapes.size,8,'silhouettes differ even with every icon in one color');
  assert.equal(icons.size,Object.values(g.LAYERS).reduce((n,layers)=>n+layers.length,0),'each skill remains distinct');
  assert.equal(JSON.stringify(song),original,'personal captions never change the shared song');assert.deepEqual(s.errors,[]);
});

test('accordion reed notes are short staccato strikes: each re-articulates and none carries over into the next',async t=>{
  const s=session('http://127.0.0.1:8080',true,{soundfontText:testSoundfont(),sampleLevel:.05});t.after(()=>s.close());const g=s.game;
  g.setGenre('chanson');await g.pick('accordion');g.setPause(true);s.holdFrames(true);
  const song=g.SONG;song.key=0;song.bpm=60;song.prog=[0,5,7,0].map(off=>g.mkChord(song,off));song.have=1;
  const part=g.LAYERS.accordion.find(l=>l.id==='bellows'),first=part.steps(g.chordAt(0),0,0,1);
  g.logNotes(true);const at=g.ctx.currentTime+.1;g.fire(at,first);const original=g.voices.slice(-3);
  assert.equal(original.length,3);assert.ok(original.every(v=>v.source.loop&&v.source.loopStart>0));
  assert.ok(original.every(v=>v.source.stoppedAt-v.source.startedAt<.5),'a reed strike is short, not a held drone');
  g.fire(at+.05,first);assert.ok(g.notes.slice(-3).every(n=>!n.continued&&n.source==='accordion'),'the same note struck again is a new attack');
  assert.ok(g.voices.length>=6,'every strike has its own voices');
  g.endNoteTails();assert.deepEqual(s.errors,[]);
});

test('violin resolves to the real VSCO sampler: spiccato by default, arco only on request, names mapped to MIDI',async t=>{
  const s=session('http://127.0.0.1:8080',true,{violin:true,sampleLevel:.05});t.after(()=>s.close());const g=s.game;
  g.setGenre('folkrock');await g.pick('violin');g.setPause(true);g.logNotes(true);const at=()=>g.ctx.currentTime+.05;
  g.playBuffered(at(),{midi:69,vel:.5,seconds:.2});let n=g.notes.at(-1);
  assert.equal(n.source,'vsco-spic');assert.match(n.sample,/^spic_A3_v2_rr[12]$/,'spic names are an octave below scientific: spic_A3 is MIDI 69');assert.ok(Math.abs(n.rate-1)<1e-9);assert.ok(n.duration<.4,'spiccato is short');
  g.playBuffered(at(),{midi:69,vel:.2,seconds:.2});assert.match(g.notes.at(-1).sample,/^spic_A3_v1/,'soft layer for soft notes');
  const rr=new Set();for(let i=0;i<4;i++){g.playBuffered(at(),{midi:72,vel:.5,seconds:.2});rr.add(g.notes.at(-1).sample);}assert.equal(rr.size,2,'two round robins alternate');
  g.playBuffered(at(),{midi:70,vel:.5,seconds:.2});n=g.notes.at(-1);assert.ok(Math.abs(n.rate-Math.pow(2,1/12))<1e-9||Math.abs(n.rate-Math.pow(2,-2/12))<1e-9,'nearest sample is repitched by playbackRate');
  g.playBuffered(at(),{midi:55,vel:.5,seconds:.2});assert.match(g.notes.at(-1).sample,/^spic_G2/,'lowest violin note G3 = MIDI 55 = spic_G2');
  await new Promise(r=>setTimeout(r,50));
  g.playBuffered(at(),{midi:69,vel:.5,seconds:.3,art:'arco'});n=g.notes.at(-1);assert.equal(n.source,'vsco-arco');assert.match(n.sample,/^arco_A4_f$/,'arco names are scientific: arco_A4 is MIDI 69');assert.ok(n.duration<.5,'arco is re-bowed, not held');
  g.playBuffered(at(),{midi:69,vel:.5,seconds:.2,art:'pizzicato'});assert.equal(g.notes.at(-1).source,'vsco-pizz');assert.match(g.notes.at(-1).sample,/^pizz_A4_f/);
  g.playBuffered(at(),{midi:69,vel:.5,seconds:.2});const v=g.voices.at(-1);assert.ok(v.source.stoppedAt-v.source.startedAt<.4);
  assert.deepEqual(s.errors,[]);
});

test('violin and accordion in the game: no held notes, at least two attacks in every bar, any bow or pizz card',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const inst of ['violin','accordion']){
    await g.pick(inst);g.setPause(true);g.SONG.have=4;
    const cards=inst==='violin'?[['$bow',Object.keys(g.VIOLIN_BOW_CARDS||{detache:1,legato:1,martele:1})],['$pizz',['quarter','eighth','bass']]]:[['$x',[undefined]]];
    for(const [key,opts] of cards)for(const opt of opts){
      if(key!=='$x')g.G.layers[key]=opt;
      for(const layer of g.LAYERS[inst]){
        if(key==='$pizz'&&layer.id!=='pizz'&&opt!=='quarter')continue;if(key==='$bow'&&layer.id!=='bow'&&opt!=='detache')continue;
        for(let bar=0;bar<4;bar++){let attacks=0;
          for(let st=0;st<16;st++){const evs=layer.steps(g.voiced(g.chordAt(bar),g.G.layers,st,bar),st,bar,1);
            for(const e of evs){assert.ok(e.dur<=6&&!(e.seconds>.5)&&!(e.holdSteps>2),inst+'/'+layer.id+' note is short');}
            attacks+=layer.perNote?evs.filter(e=>!e.noAtk&&!e.orn).length:(evs.length?1:0);}
          assert.ok(attacks>=2,inst+'/'+layer.id+'/'+opt+' bar '+bar+' attacks '+attacks);}
      }
      delete g.G.layers[key];
    }
  }
  assert.deepEqual(s.errors,[]);
});

test('accordion bellows are played in strokes of varying length, identical for the whole band',async t=>{
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('chanson');await g.pick('accordion');g.setPause(true);
  const lens=new Set(),dirs=new Set();
  for(let ph=0;ph<12;ph++){const list=g.bellowsStrokes(ph);assert.equal(list.reduce((n,x)=>n+x.len,0),128,'strokes tile the 8-bar phrase');
    assert.deepEqual(JSON.stringify(g.bellowsStrokes(ph)),JSON.stringify(list),'same phrase, same strokes');
    list.forEach((x,i)=>{lens.add(x.len);if(i)assert.notEqual(x.dir,list[i-1].dir,'pull and push alternate');});}
  assert.ok([...lens].some(l=>l<=8)&&[...lens].some(l=>l>=16),'both short and long strokes occur');
  const ev=g.buses.accordion.bellows.gain.events;g.bellowsBar(g.ctx.currentTime+.05,0);
  const sets=ev.filter(x=>x[0]==='set'||x[0]==='linear').map(x=>x[1]);assert.ok(sets.every(Number.isFinite)&&Math.min(...sets)<.45,'bar gain swells and dips');
  assert.deepEqual(s.errors,[]);
});

test('A320U bank renders real notes, electric guitars stay on FluidR3 recordings, accordion has musette reeds and bellows', async t => {
  const s = session('http://127.0.0.1:8080', true, { sf2: true, soundfontText: testSoundfont() }); t.after(() => s.close()); const g = s.game;
  g.setGenre('pop'); await g.pick('guitar'); g.setPause(true); await g.reqBuf('guitar', 52); g.logNotes(true);
  g.playBuffered(g.ctx.currentTime + .05, { midi: 52, vel: .7, dur: 4 });
  let n = g.notes.at(-1); assert.equal(n.source, 'acoustic_guitar_steel');
  assert.ok(n.duration < 1.5, 'a sustained bank note is released after its written length, not the whole 3.5 s render');
  g.setGenre('rock'); await g.pick('guitar'); g.setPause(true); await g.reqBuf('guitar', 52); g.logNotes(true);
  g.playBuffered(g.ctx.currentTime + .05, { midi: 52, vel: .7, dur: 4 });
  assert.equal(g.voices.at(-1).source.buffer.length, 12516, 'clean electric guitar comes from the decoded recording, not the A320U loop');
  g.setGenre('chanson'); await g.pick('accordion'); g.setPause(true); g.logNotes(true);
  g.fire(g.ctx.currentTime + .05, g.LAYERS.accordion[0].steps(g.chordAt(0), 0, 0, 1));
  const v = g.voices.at(-1); assert.ok(v.reed2 && v.reed2.loop && v.source.loopStart > 0, 'two looping reeds per note');
  assert.ok(g.notes.at(-1).musette > 3, 'the second reed is tuned up for a musette beat');
  assert.ok(g.buses.accordion.bellows && g.buses.accordion.bellowsLP, 'the accordion bus has bellows gain and brightness');
  assert.deepEqual(s.errors, []);
});

test('accordion frog picks the chord on the keys, one small ring per note that neither pulls nor reflects', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close()); const g = s.game;
  g.setGenre('chanson'); await g.pick('accordion'); g.setPause(true);
  const part = g.LAYERS.accordion[0], ch = g.chordAt(0), bars = [];
  assert.ok(part.starter && part.by.length === 0, 'key picking stays after cards');
  for (let bar = 0; bar < 4; bar++) { const notes = []; for (let st = 0; st < 16; st++) for (const e of part.steps(ch, st, bar, 1)) notes.push([st, e.midi, e.holdSteps]); bars.push(JSON.stringify(notes)); }
  const first = JSON.parse(bars[0]);
  assert.deepEqual(first.map(n => n[0]), [0, 4, 8, 12], 'one note per beat');
  assert.ok(first.every(n => ch.pcs.includes(n[1] % 12) && n[2] < 4), 'chord tones only, each released before the next beat');
  assert.ok(bars.every(b => b === bars[0]), 'the same picking every bar');
  const G = g.G; G.instrumentFX = []; part.atk(part.steps(ch, 0, 0, 1), 1);
  const ring = G.instrumentFX.at(-1); assert.equal(ring.kind, 'noteRing'); assert.ok(ring.maxR <= 120 && !ring.delay, 'small ring, no pull phase');
  assert.deepEqual(s.errors, []);
});

/* ===== Зріз «герой сам грає мелодію»: сопілка й сакс ===== */
test('flute and sax carry the song melody themselves: the backing hook is muted for them, still plays for guitar',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  await g.pick('flute');g.setPause(true);
  const hook={kind:'hook'};
  const w=(char,layers={pulse:1})=>({char,layers});
  assert.equal(g.backingSkip(hook,[w('flute')]),true);assert.equal(g.backingSkip(hook,[w('sax')]),true);
  assert.equal(g.backingSkip(hook,[w('guitar')]),false,'a guitar hero still gets the backing melody');
  assert.equal(g.backingSkip(hook,[w('guitar'),w('flute')]),true,'one melody-carrying wind player in the band is enough');
  assert.equal(g.backingSkip({kind:'bass'},[{char:'flute'}]),false);assert.equal(g.backingSkip({kind:'chord'},[{char:'sax'}]),false);
  assert.equal(g.backingSkip({kind:'bass'},[{char:'bass'}]),true,'old muting rules unchanged');
  for(const inst of ['flute','sax']){
    await g.pick(inst);g.setPause(true);g.SONG.have=4;let heard=0;
    for(let i=0;i<32;i++){const bar=i>>4,st=i%16,hooks=g.backingEvents(bar,st).filter(e=>e.kind==='hook');
      const starter=g.LAYERS[inst][0].steps(g.voiced(g.chordAt(bar),g.G.layers,st,bar),st,bar,1).filter(e=>!e.orn);
      assert.equal(starter.length>0,hooks.length>0,inst+' starter sounds exactly where the song melody sits');
      if(hooks.length){heard++;assert.equal(starter[0].midi%12,hooks[0].midi%12,inst+' plays the same melody note');}}
    assert.ok(heard>=4);
  }
  assert.deepEqual(s.errors,[]);
});

test('perNote layers queue one attack per note at t+off; each note is exactly one attack; ornaments are tiny and give no swing',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const [inst,ids] of [['flute',['pulse','melody','legato','trill']],['sax',['pulse','riff','breath','stab']]]){
    g.setGenre('pop');await g.pick(inst);g.setPause(true);g.SONG.have=4;g.SONG.swing=0;
    for(const id of ids){
      const Ly=g.LAYERS[inst].find(l=>l.id===id);assert.ok(Ly.perNote,inst+'/'+id+' is perNote');
      g.G.layers={[id]:1};g.atkQ=[];g.G.mobs=[];g.G.instrumentFX=[];
      const T=g.now()-.1;let notes=0,orns=0;
      for(let step=0;step<64;step++){
        const bar=step>>4,st=step&15,evs=Ly.steps(g.voiced(g.chordAt(bar),g.G.layers,st,bar),st,bar,1);notes+=evs.length;orns+=evs.filter(e=>e.orn).length;
        const before=g.atkQ.length;g.doPlayerStep(step,T);
        const fresh=g.atkQ.length-before;assert.equal(fresh,evs.length,inst+'/'+id+' one queue entry per note at step '+step);
      }
      assert.equal(g.atkQ.length,notes);
      for(let i=0;i<g.atkQ.length;i++){const q=g.atkQ[i];assert.equal(q.hits.length,1);assert.equal(q.hits[0].evs.length,1);assert.equal(q.hits[0].Ly,Ly);
        assert.equal(q.orn,!!q.hits[0].evs[0].orn);assert.ok(Number.isFinite(q.t));if(i)assert.ok(q.t>=g.atkQ[i-1].t,'queue stays sorted by time');
        assert.equal(q.t,T+(q.hits[0].evs[0].off||0),'t = step time + note offset');}
      assert.equal(g.atkQ.filter(q=>q.orn).length,orns);
    }
  }
  /* один крок із прикрасою: два записи — форшлаг одразу, нота пізніше */
  g.setGenre('pop');await g.pick('flute');g.setPause(true);g.SONG.have=4;g.SONG.swing=0;g.G.layers={melody:1};
  const Ly=g.LAYERS.flute.find(l=>l.id==='melody');let graceStep=-1;
  for(let i=0;i<64&&graceStep<0;i++){const evs=Ly.steps(g.voiced(g.chordAt(i>>4),g.G.layers,i&15,i>>4),i&15,i>>4,1);if(evs.some(e=>e.orn))graceStep=i;}
  assert.ok(graceStep>=0,'melody has a grace note somewhere');
  g.atkQ=[];const T=g.now()-.1;g.doPlayerStep(graceStep,T);
  assert.equal(g.atkQ.length,2);assert.equal(g.atkQ[0].orn,true);assert.equal(g.atkQ[0].t,T);assert.ok(g.atkQ[1].t>T&&!g.atkQ[1].orn,'the main note attacks later, at its own offset');
  assert.deepEqual(s.errors,[]);
});

test('perNote attacks are consumed one effect per note, with echo pedals and the hero swing',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('flute');g.setPause(true);g.SONG.have=4;g.SONG.swing=0;
  g.G.layers={melody:1};const Ly=g.LAYERS.flute.find(l=>l.id==='melody');
  let graceStep=-1;for(let i=0;i<64&&graceStep<0;i++){const evs=Ly.steps(g.voiced(g.chordAt(i>>4),g.G.layers,i&15,i>>4),i&15,i>>4,1);if(evs.some(e=>e.orn))graceStep=i;}
  /* порожній забіг: одна прикраса — ефект є, замаху немає */
  g.atkQ=[];g.G.instrumentFX=[];g.G.p.atkT=undefined;
  g.doPlayerStep(graceStep,g.now()-.3);g.processQueues();
  assert.equal(g.atkQ.length,0);assert.equal(g.G.instrumentFX.length,2,'grace and note each fired one effect');
  const tiny=g.G.instrumentFX.filter(f=>f.tiny);assert.equal(tiny.length,1);assert.ok(tiny[0].life<=.35);
  assert.notEqual(g.G.p.atkT,undefined,'the real note swings the hero');
  /* echo-педаль: кожен запис дає одне відлуння з тією самою єдиною нотою */
  g.PEDALS.push({id:'flute_testdelay',key:'testdelay',inst:'flute',fx:{delay:1},lv:[]});g.G.pedals={flute_testdelay:1};
  g.atkQ=[];g.G.instrumentFX=[];g.doPlayerStep(graceStep,g.now()-.3);g.processQueues();
  assert.equal(g.atkQ.length,2,'each of the two note entries queued one echo');
  for(const q of g.atkQ){assert.ok(q.echo>0);assert.equal(q.hits.length,1);assert.equal(q.hits[0].evs.length,1);}
  assert.deepEqual(s.errors,[]);
});

test('perNote balance: damage per bar stays within 25% of the old one-attack-per-step model for every slice layer',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  /* старі партії: [атак на такт, шкода атаки] — те, що було до «кожна нота — атака» */
  const OLD={flute:{pulse:[4,12],melody:[4.5,12],legato:[1,15],trill:[1,8.4]},sax:{pulse:[4,19.5],riff:[5,5],breath:[2,19.5],stab:[2,7]}};
  const nominal=f=>f.dmg*(f.kind==='beam'?Math.ceil(f.life/.16):f.kind==='orbit'?Math.ceil(f.life/f.tick):f.kind==='puddle'?Math.ceil(f.life/f.tick):f.kind==='bounce'?f.hops:1);
  for(const genre of ['lofi','pop','metal','reggae','jazz'])for(const [inst,layers] of Object.entries(OLD)){
    g.setGenre(genre);await g.pick(inst);g.setPause(true);g.SONG.have=4;g.SONG.swing=0;
    const bpm=g.SONG.bpm;
    for(const [id,[hits,dmg]] of Object.entries(layers)){
      const Ly=g.LAYERS[inst].find(l=>l.id===id);g.G.layers={[id]:1};g.G.mobs=[];let total=0;const bars=8;
      for(let step=0;step<bars*16;step++){g.atkQ=[];g.G.instrumentFX=[];g.doPlayerStep(step,g.now()-.3);g.processQueues();for(const f of g.G.instrumentFX)total+=nominal(f);}
      const old=128*hits*dmg*(Ly.starter?.7:1)/bpm,now=total/bars;
      assert.ok(now/old>.75&&now/old<1.25,genre+' '+inst+'/'+id+' damage per bar '+now.toFixed(1)+' vs old '+old.toFixed(1)+' ('+(now/old).toFixed(2)+')');
    }
  }
  assert.deepEqual(s.errors,[]);
});

test('every flute and sax chord card audibly changes a slice layer (personalPitch routing)',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const inst of ['flute','sax']){
    g.setGenre('pop');await g.pick(inst);g.setPause(true);g.SONG.have=4;
    /* контрольна мелодія: ноти в кожній чверті такту, щоб кожна картка мала на що лягти */
    g.SONG.phrases={...g.SONG.phrases,mel:[0,4,8,12,18,22,26,30]};g.SONG.mel={0:76,4:74,8:72,12:79,18:77,22:74,26:71,30:67};
    const sliceHeard=layers=>(inst==='flute'?['pulse','melody','legato','trill']:['pulse','riff','breath','stab']).map(id=>{const Ly=g.LAYERS[inst].find(l=>l.id===id);
      return Array.from({length:64},(_,i)=>{const bar=i>>4,st=i&15,ch=g.voiced(g.chordAt(bar),layers,st,bar);return Ly.steps(ch,st,bar,1).map(e=>e.midi).join('+');}).join('|');}).join('/');
    const before=sliceHeard({});
    for(const id of Object.keys(g.VOICINGS[inst]))assert.notEqual(sliceHeard({['$v_'+id]:1}),before,inst+'/'+id+' changes the notes of a slice layer');
  }
  assert.deepEqual(s.errors,[]);
});

test('the song melody is muted only while a wind player actually holds a melody-carrying layer',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  await g.pick('flute');g.setPause(true);
  const hook={kind:'hook'},skip=(char,layers,p)=>g.backingSkip(hook,[{char,layers,...(p?{p}:{})}]);
  assert.equal(skip('flute',{pulse:1}),true,'active starter carries the melody');
  assert.equal(skip('flute',{pulse:1,melody:1}),true);assert.equal(skip('flute',{melody:1}),true);
  for(const id of ['legato','flutter','stacc'])assert.equal(skip('flute',{pulse:1,[id]:1}),false,'flute+'+id+': starter replaced, melody returns to the backing');
  assert.equal(skip('flute',{pulse:1,legato:1,melody:1}),true);
  assert.equal(skip('sax',{pulse:1}),true);assert.equal(skip('sax',{pulse:1,riff:1}),true);
  for(const id of ['breath','stab'])assert.equal(skip('sax',{pulse:1,[id]:1}),false,'sax+'+id+': hook audible');
  assert.equal(skip('sax',{pulse:1,breath:1,riff:1}),true);
  assert.equal(skip('flute',{pulse:1},{hp:0}),false,'a dead player carries nothing');assert.equal(skip('flute',{pulse:1},{hp:5}),true);
  assert.equal(g.backingSkip(hook,[{char:'flute',layers:{pulse:1},p:{hp:0}},{char:'guitar',layers:{}}]),false);
  assert.equal(g.backingSkip(hook,[{char:'guitar',layers:{}}]),false);
  assert.deepEqual(s.errors,[]);
});

test('sax starter steps aside for riff, and the in-game breath and stab use the per-note path',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('sax');g.setPause(true);g.SONG.have=4;g.SONG.swing=0;
  g.G.layers={pulse:1,riff:1};g.atkQ=[];const T=g.now()-.3;
  for(let i=0;i<32;i++)g.doPlayerStep(i,T);
  assert.ok(g.atkQ.length>0&&g.atkQ.every(q=>q.hits[0].Ly.id==='riff'),'only riff plays, the starter does not double it');
  /* стаб: акцент → ударне кільце r≈110; видих: промінь на довжину ноти */
  g.G.layers={stab:1};g.atkQ=[];g.G.instrumentFX=[];
  for(let i=0;i<16;i++)g.doPlayerStep(i,T);
  assert.ok(g.atkQ.length>0&&g.atkQ.every(q=>q.per&&q.hits[0].evs[0].accent===true));
  g.processQueues();assert.ok(g.G.instrumentFX.length>0&&g.G.instrumentFX.every(f=>f.kind==='blast'&&f.maxR>=100));
  g.G.layers={breath:1};g.atkQ=[];g.G.instrumentFX=[];
  for(let i=0;i<16;i++)g.doPlayerStep(i,T);
  assert.ok(g.atkQ.length>0);g.processQueues();assert.ok(g.G.instrumentFX.length>0&&g.G.instrumentFX.every(f=>f.kind==='beam'));
  assert.deepEqual(s.errors,[]);
});

test('trill and double-time pairs do not restart the hero swing every note',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('flute');g.setPause(true);g.SONG.swing=0;
  const Ly=g.LAYERS.flute.find(l=>l.id==='melody');g.G.layers={melody:1};g.G.mobs=[];
  let st=-1;for(let i=0;i<32&&st<0;i++)if(Ly.steps(g.voiced(g.chordAt(i>>4),g.G.layers,i&15,i>>4),i&15,i>>4,1).some(e=>!e.orn))st=i;
  g.atkQ=[];g.doPlayerStep(st,g.now()-.3);g.G.p.atkT=undefined;g.processQueues();
  const first=g.G.p.atkT;assert.notEqual(first,undefined,'the first note swings');
  g.G.t+=.05;g.atkQ=[];g.doPlayerStep(st,g.now()-.3);g.processQueues();
  assert.equal(g.G.p.atkT,first,'a note within .18 s of the swing does not restart it');
  g.G.t+=.3;g.atkQ=[];g.doPlayerStep(st,g.now()-.3);g.processQueues();
  assert.ok(g.G.p.atkT>first,'later notes swing again');
  assert.deepEqual(s.errors,[]);
});

test('bass walk follows the note: root straight at the enemy, other notes fan out by pitch (country variant)',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('bass');g.setPause(true);g.SONG.have=4;
  const Ly=g.LAYERS.bass.find(l=>l.id==='walk');g.G.layers={walk:2,$walk:'country'};g.G.mobs=[];g.G.shots=[];
  const p=g.G.p,m=g.addMob('strel',p.x+300,p.y);m.hp=1e9;
  const angles=[],rootAngles=[];
  for(let st=0;st<16;st+=4){
    const ch=g.voiced(g.chordAt(0),g.G.layers,st,0),evs=Ly.steps(ch,st,0,2);assert.equal(evs.length,1);
    g.G.shots=[];g.withAttack({owner:null,layer:'walk',step:st},()=>Ly.atk(evs,2,st));
    const sh=g.G.shots[0],a=Math.atan2(sh.vy,sh.vx),toEnemy=Math.atan2(m.y-p.y,m.x-p.x);
    angles.push(Math.round((a-toEnemy)*1000)/1000);if((evs[0].midi-evs[0].rootMidi)%12===0)rootAngles.push(a-toEnemy);
  }
  assert.ok(new Set(angles).size>=3,'a bar sweeps across at least three directions: '+angles);
  assert.ok(rootAngles.length>=1&&rootAngles.every(a=>Math.abs(a)<1e-6),'the root note hits straight at the enemy');
  assert.deepEqual(s.errors,[]);
});

test('walk side alternates on repeated original notes, but an echo (ATK_SCALE<1) keeps the side',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('bass');g.setPause(true);g.SONG.have=4;
  const Ly=g.LAYERS.bass.find(l=>l.id==='walk');g.G.layers={walk:2,$walk:'country'};g.G.mobs=[];g.G.shots=[];
  const p=g.G.p;g.addMob('strel',p.x+300,p.y).hp=1e9;
  const ev=[{midi:40,rootMidi:36}];
  const original=()=>{g.G.shots=[];g.withAttack({owner:null,layer:'walk',step:0},()=>Ly.atk(ev,2,0));return g.walkSide;};
  assert.deepEqual([original(),original()],[1,-1],'repeated original note flips the side');
  g.atkQ=[];g.qInsert({t:g.now()-.1,s:0,hits:[{Ly,evs:ev,L:2}],run:g.runId,owner:null,echo:.5});
  g.processQueues();
  assert.ok(g.G.shots.length>=1,'the echo actually fired a shot');
  assert.equal(g.walkSide,-1,'echo of the same note keeps the side');
  assert.equal(g.walkLast,4,'echo does not touch walkLast');
  assert.deepEqual(s.errors,[]);
});

test('balance: a passive solo player standing still is overrun, and enemies show up right at the start', async t => {
  // Герой стоїть і лише грає (авто-атаки йдуть кожен крок секвенсера), без руху й без вибору покращень.
  for (const inst of ['guitar', 'drums', 'bass', 'piano']) {
    const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
    s.game.setGenre('pop'); await s.game.pick(inst);
    const g = s.game, G = g.G, p = G.p;
    const hp0 = p.max, t0 = G.t, stepLen = 60 / g.SONG.bpm / 4;
    let firstMobAt = null, step = 0, acc = 0, diedAt = null;
    for (let i = 0; i < 150 * 30 && G.p.hp > 0; i++) {
      acc += 1 / 30; while (acc >= stepLen) { acc -= stepLen; g.doPlayerStep(step++, g.now()); }
      g.update(1 / 30); G.xp = 0; // вікно вибору рівня не зупиняє симуляцію
      if (firstMobAt === null && G.mobs.some(m => Math.hypot(m.x - p.x, m.y - p.y) < 700)) firstMobAt = G.t - t0;
    }
    if (G.p.hp <= 0) diedAt = G.t - t0;
    assert.ok(firstMobAt !== null && firstMobAt < 3, inst + ': first enemies appear near the hero within seconds, got ' + firstMobAt);
    assert.ok(diedAt !== null || p.hp < hp0 * .5, inst + ': standing still must cost at least half the HP within 150 s (hp ' + p.hp + '/' + hp0 + ')');
  }
});

test('balance: plain shots pass through enemy notes, knockback is scaled down', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p;
  G.mobs.length = 0; G.eshots.length = 0; G.shots.length = 0;
  G.shots.push({ x: p.x + 100, y: p.y, vx: 0, vy: 0, spd: 1, r: 8, age: 0, life: 1, dmg: 1, pierce: 5, hit: new Set(), kind: 'note' });
  G.eshots.push({ x: p.x + 100, y: p.y, vx: 0, vy: 0, r: 6, age: 0, life: 3, dmg: 9, col: '#5fc4d9' });
  g.update(1 / 60);
  assert.ok(!G.eshots[0].fr && !G.parried, 'a plain shot does not reflect an enemy note');
  const m = g.addMob('fal', p.x + 500, p.y); m.kx = m.ky = 0;
  g.hurtMob(m, 1, 100, 0);
  assert.ok(m.kx > 0 && m.kx <= 40, 'knockback 100 is scaled to <=40, got ' + m.kx);
});

test('keys hero is an acoustic grand piano in every genre', () => {
  const s=session('http://127.0.0.1:8080');const g=s.game;try{
    for(const [id,genre] of Object.entries(g.GENRES))assert.equal(genre.sf.piano,'acoustic_grand_piano',id+' keys sample');
    for(const [id,genre] of Object.entries(g.GENRES))if(id!=='blues')assert.equal(genre.keys,'рояль',id+' keys label');
  }finally{s.close();}
});

test('piano never hums: a new chord damps the previous one within ~120 ms; rolls, melody and left hand are not cut', async t => {
  const s=session('http://127.0.0.1:8080',true);t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('piano');g.setPause(true);g.SONG.bpm=120;g.logNotes(true);
  for(const m of [60,64,67,72,48,55])await g.reqBuf('piano',m); // тестовий семпл ≈0,2 с — усе відбувається всередині нього
  const t0=g.ctx.currentTime+.1,chord=(at,roll)=>[60,64,67,72].forEach((m,i)=>g.playBuffered(at,{midi:m,vel:.5,dur:16,off:i*roll,chord:true}));
  chord(t0,.02);const first=g.voices.slice(-4),ring=first.map(v=>v.endAt);
  assert.ok(first.every((v,k)=>Math.abs(v.endAt-t0-.02*k-.2)<1e-6),'a rolled chord (20 ms spread) does not cut its own notes: '+first.map(v=>v.endAt-t0));
  g.playBuffered(t0+.05,{midi:72,vel:.5,dur:4});                       // мелодія
  g.playBuffered(t0+.05,{midi:55,vel:.5,dur:6,lh:true});               // ліва рука
  g.playBuffered(t0+.05,{midi:72,vel:.5,dur:1.5,chord:true,noDamp:true}); // луна педалі
  assert.deepEqual(first.map(v=>v.endAt),ring,'melody, left hand and pedal echo do not damp the chord');
  chord(t0+.05,.02);
  assert.ok(first.every(v=>v.endAt<=t0+.05+.121),'the next chord releases the previous one within ~120 ms: '+first.map(v=>v.endAt-t0));
  assert.deepEqual(s.errors,[]);
});

test('piano chord events are tagged for the damper in every genre and layer', () => {
  const s=session('http://127.0.0.1:8080');const g=s.game;try{
    for(const genre of Object.keys(g.GENRES)){g.setGenre(genre);g.setSong(g.makeSong(null,genre));
      for(const id of ['pulse','chords','stab','pad'])for(let bar=0;bar<4;bar++)for(let st=0;st<16;st++)
        for(const e of g.LAYERS.piano.find(l=>l.id===id).steps(g.chordAt(bar),st,bar,1))assert.ok(e.midi===undefined||e.chord,genre+'/'+id+' chord note is tagged');}
  }finally{s.close();}
});

test('piano long holds are capped (<= 6 steps) in the game source', () => {
  assert.match(source,/PIANO_MAX_HOLD=6/);assert.match(source,/Math\.min\(ev\.dur,s\.inst==='piano'\?PIANO_MAX_HOLD/);
});

test('piano pad and whole chords are re-struck rhythmically, never one 14-step drone', () => {
  const s=session('http://127.0.0.1:8080');const g=s.game;try{
    g.setGenre('pop');g.setSong(g.makeSong(null,'pop'));
    const pad=g.LAYERS.piano.find(l=>l.id==='pad');
    for(let bar=0;bar<4;bar++){const hits=[];for(let st=0;st<16;st++)if(pad.steps(g.chordAt(bar),st,bar,1).length)hits.push(st);
      assert.ok(hits.length>=2,'pad has at least two attacks per bar');
      for(let st=0;st<16;st++)for(const e of pad.steps(g.chordAt(bar),st,bar,1))assert.ok(e.dur<=8,'pad note is not a held drone');}
  }finally{s.close();}
});

/* ===== Ноти → акорди, ефекти й колір акордів, серця ===== */
test('note cards: every note of the next chord is needed, colour notes add the 7th and 9th, all genres can finish', async t => {
  const s = session('http://127.0.0.1:8080'); t.after(() => s.close()); const g = s.game;
  await g.pick('flute'); g.setPause(true);
  for (const genre of Object.keys(g.GENRES)) {
    const song = g.makeSong(null, genre); g.setSong(song); g.G.syn = 1;
    assert.equal(song.have, 1); assert.equal(song.prog[0].lvl, 1, genre + ': tonic starts as a triad');
    for (let slot = 1; slot < 4; slot++) {
      const need = g.chordTones(slot, 1); assert.ok(need.length >= 2 && need.length <= 3, genre + ': a triad (a power chord has two notes)');
      for (let n = 0; n < need.length; n++) {
        assert.equal(song.have, slot, genre + ': the chord is not in the song before its last note');
        const cards = g.noteCards().filter(o => o.lvl === 1); assert.ok(cards.length && cards.every(o => o.slot === slot && need.includes(o.pc)), genre + ': note cards belong to the next chord');
        assert.ok(g.serializeOption(cards[0]) === cards[0] && JSON.parse(JSON.stringify(cards[0])).pc === cards[0].pc, 'note cards are plain JSON');
        g.applyUpgrade(cards[0]);
      }
      assert.equal(song.have, slot + 1); assert.equal(song.prog[slot].lvl, 1);
      assert.ok(need.every(pc => song.prog[slot].pcs.includes(pc)), 'the chord sounds exactly the collected notes');
      assert.ok(song.ev && song.ev.slot === slot && song.ev.lvl === 1, 'a song event announces the new chord');
    }
    // два гравці взяли одну й ту саму ноту: друга не пропадає, а йде в іншу, тож дублікатів у слоті немає
    const dup = g.makeSong(null, genre); g.setSong(dup); const c = g.noteCards().find(o => o.lvl === 1);
    g.applyUpgrade(c); g.applyUpgrade(c); assert.equal(new Set(dup.notes[1]).size, dup.notes[1].length, genre + ': no duplicate notes');
    g.setSong(song);
    g.applyUpgrade({ hp: true }); g.G.layers = { ...g.G.layers }; // (лічильник HP-карток не впливає на пісню)
    g.G.syn = 1; g.applyUpgrade({ note: true, slot: 3, pc: 0, lvl: 2 });
    assert.ok(Math.abs(g.G.syn - g.synergy(song.prog.map(c => c.off), genre).bonus) < 1e-9, genre + ': synergy follows the collected chords (fifths, crown)');
    // колірні ноти: септима (рівень 2), потім нона (рівень 3) — акорд звучить багатше
    for (let slot = 0; slot < 4; slot++) {
      const n1 = song.prog[slot].pcs.length;
      for (const lvl of [2, 3]) {
        if ((song.prog[slot].lvl || 1) >= lvl) continue;
        let card = null; for (let i = 0; i < 80 && !card; i++) card = g.noteCards().find(o => o.slot === slot && o.lvl === lvl); assert.ok(card, genre + ': colour card level ' + lvl + ' is offered');
        const before = song.prog[slot].pcs.slice(); g.applyUpgrade(card);
        assert.equal(song.prog[slot].lvl, lvl); assert.ok(before.every(p => song.prog[slot].pcs.includes(p)) && song.prog[slot].pcs.length > before.length, genre + ': colour tone is added to the voicing');
      }
      assert.ok(song.prog[slot].pcs.includes((song.prog[slot].root + 2) % 12), genre + ': level 3 has the ninth'); assert.ok(song.prog[slot].pcs.length > n1 - 1);
    }
    assert.equal(g.noteCards().length, 0, genre + ': nothing left to collect');
  }
  // барабанщик нот не збирає: лише ритм-картки
  await g.pick('drums'); g.setPause(true); assert.equal(g.noteCards().length, 0);
  for (let i = 0; i < 100; i++) assert.ok(!g.levelOptions().some(o => o.note));
  assert.deepEqual(s.errors, []);
});

test('chord function: each chord has its own effect and colour, applied to attacks and tinting them during its bar', async t => {
  const s = session('http://127.0.0.1:8080'); t.after(() => s.close()); const g = s.game;
  g.setGenre('pop'); await g.pick('bass'); g.setPause(true);
  const song = g.makeSong(null, 'pop'); song.prog = [0, 5, 7, 9].map(off => g.mkChord(song, off, 1)); song.have = 4; g.setSong(song);
  g.G.syn = 1; g.G.layers = { [g.LAYERS.bass[0].id]: 1 };
  const kinds = [0, 1, 2, 3].map(b => g.chordStamp(g.chordAt(b)).k); assert.deepEqual(kinds, ['I', 'IV', 'V', 'vi']);
  // мінор: i, iv, v, VI — ті ж функції; решта ступенів — «Світло»
  assert.deepEqual([0, 5, 7, 8, 2, 4, 10].map(o => g.chordFnId(o)), ['I', 'IV', 'V', 'vi', 'ii', 'iii', 'iii']);
  for (const k of ['I', 'IV', 'V', 'vi', 'ii', 'iii']) assert.ok(/^#[0-9a-f]{6}$/.test(g.CHORD_FN[k].col));
  assert.equal(new Set(Object.values(g.CHORD_FN).map(f => f.col)).size, 6, 'six distinct colours');
  const G = g.G, hpLoss = (type, cf) => { const m = g.addMob(type, G.p.x + 500, G.p.y); m.hp = m.max = 1e6; m.slow = 0; m.slowAmt = 0;
    g.withAttack({ layer: 'root', step: 0, cf, owner: undefined }, () => g.hurtMob(m, 10, 0, 0)); const d = 1e6 - m.hp; G.mobs = G.mobs.filter(x => x !== m); return { d, m }; };
  const base = hpLoss('fal').d;
  assert.ok(Math.abs(hpLoss('fal', { k: 'I', l: 1 }).d / base - 1.2) < 1e-6, 'I: +20% damage');
  assert.ok(Math.abs(hpLoss('fal', { k: 'I', l: 3 }).d / base - 1.4) < 1e-6, 'I: +10% per chord level');
  assert.ok(Math.abs(hpLoss('fal', { k: 'IV', l: 1 }).d / base - 1) < 1e-6, 'IV does not add damage');
  const elite = hpLoss('glush').d; assert.ok(Math.abs(hpLoss('glush', { k: 'iii', l: 1 }).d / elite - 1.15) < 1e-6, 'iii: +15% to elites'); assert.ok(Math.abs(hpLoss('fal', { k: 'iii', l: 1 }).d / base - 1) < 1e-6, 'iii: nothing against regular enemies');
  const slowed = hpLoss('fal', { k: 'vi', l: 1 }).m; assert.ok(slowed.slow >= 1.5 && Math.abs(slowed.slowAmt - .25) < 1e-9, 'vi: slow 25% for 1.5 s'); assert.ok(Math.abs(hpLoss('fal', { k: 'vi', l: 2 }).m.slowAmt - .35) < 1e-9);
  assert.equal(hpLoss('fal').m.slow, 0, 'no chord, no slow');
  let crits = 0; for (let i = 0; i < 600; i++) { const r = hpLoss('fal', { k: 'V', l: 1 }).d; if (Math.abs(r / base - 1.8) < 1e-6) crits++; else assert.ok(Math.abs(r / base - 1) < 1e-6); }
  assert.ok(crits > 30 && crits < 130, 'V: about 12% crits (×1.8), got ' + crits);
  assert.equal(g.attackChord, null, 'no chord context leaks outside attacks');
  // реальні атаки: штамп акорда такту йде з doPlayerStep, фарбує атаку й змінює розмір/швидкість
  const fire = (bar, noChord) => {
    G.shots = []; G.rings = []; G.cones = []; g.atkQ = [];
    g.doPlayerStep(bar * 16, g.now() - .01); assert.ok(g.atkQ.length, 'the starter part attacks on the downbeat'); if (noChord) g.atkQ.forEach(a => { a.cf = null; });
    else assert.equal(g.atkQ[0].cf.k, g.chordFnId(g.chordAt(bar).off));
    g.processQueues(); return G.shots.concat(G.rings, G.cones);
  };
  const plainAtk = fire(1, true); assert.ok(plainAtk.length && plainAtk.every(a => a.cc === undefined && a.cf === undefined));
  for (const bar of [0, 1, 2, 3]) {
    const atk = fire(bar), col = g.CHORD_FN[kinds[bar]].col; assert.ok(atk.length);
    for (const a of atk) { assert.equal(a.cc, col, 'attack carries the chord colour for the renderer'); assert.equal(a.cf.k, kinds[bar]); if (a.col) assert.notEqual(a.col, plainAtk[0].col, 'col is blended toward the chord colour'); }
  }
  const sPlain = fire(0, true).find(a => a.vx !== undefined), iv = fire(1).find(a => a.vx !== undefined);
  assert.ok(sPlain && iv, 'the bass starter shoots waves'); assert.ok(Math.abs(iv.r / sPlain.r - 1.25) < 1e-9, 'IV: +25% size');
  song.prog[3] = g.mkChord(song, 2, 1); const ii = fire(3).find(a => a.vx !== undefined);
  assert.equal(ii.pierce, sPlain.pierce + 1, 'ii: +1 pierce'); assert.ok(Math.abs(Math.hypot(ii.vx, ii.vy) / Math.hypot(sPlain.vx, sPlain.vy) - 1.2) < 1e-9, 'ii: +20% projectile speed');
  // барабанщик акордів не грає: без ефектів і фарби
  g.setChar('drums'); assert.equal(g.chordStamp(g.chordAt(0)), null);
  // HUD і малювання не падають
  g.setChar('bass'); fire(2); g.draw(); assert.deepEqual(s.errors, []);
});

test('hearts: 2% / 6% / boss drops, heal 20% max HP to whoever picks them, despawn after 20 s; level-up heals nothing', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close()); const g = s.game;
  await g.pick('guitar'); const G = g.G, p = G.p; G.mobs = [];
  const count = (type, n) => { let c = 0; for (let i = 0; i < n; i++) { G.hearts = []; g.dropHearts({ type, x: 0, y: 0 }, undefined); c += G.hearts.length; } return c; };
  const reg = count('fal', 6000), heavy = count('glush', 3000); assert.ok(reg > 60 && reg < 190, 'regular enemies drop ~2%, got ' + reg); assert.ok(heavy > 110 && heavy < 260, 'heavy enemies drop ~6%, got ' + heavy);
  G.hearts = []; g.dropHearts({ type: 'boss1', x: 0, y: 0 }, undefined); assert.equal(G.hearts.length, 3, 'a boss always drops three hearts');
  // помічник: +2% за рівень до шансу
  G.pedals = { guitar_roadie: 3 }; const boosted = count('fal', 6000); assert.ok(boosted > reg * 1.8, 'roadie pedal raises the drop chance, got ' + boosted); G.pedals = {};
  assert.ok(g.PEDALS.filter(x => (x.inst === 'guitar' && x.key === 'roadie') || x.key === 'crew' || ['nest', 'keeper', 'tuner'].includes(x.key)).every(x => x.fx.heartDrop && !x.fx.heal), 'tech pedals drop hearts instead of healing on kills');
  // підбір: лікує 20% максимуму, на повному здоров'ї серце лишається
  G.hearts = [{ x: p.x, y: p.y, age: 0 }]; p.hp = p.max; g.update(.016); assert.equal(G.hearts.length, 1, 'a full-health hero leaves the heart');
  p.hp = 50; g.update(.016); assert.ok(Math.abs(p.hp - (50 + p.max * .2)) < 1e-6 && G.hearts.length === 0, 'heart heals 20% of max HP and is gone');
  // зникає через 20 с, останні 3 с мигає
  G.hearts = [{ x: p.x + 2000, y: p.y, age: 0 }]; g.update(.016); G.hearts[0].age = 19.9; g.update(.05); assert.equal(G.hearts.length, 1); g.update(.1); assert.equal(G.hearts.length, 0, 'despawns after 20 s');
  G.hearts = [{ x: p.x + 30, y: p.y, age: 18 }]; g.draw(); G.hearts[0].age = 5; g.draw();
  // рівень не лікує
  p.hp = 40; G.xp = 99; g.levelUp(); assert.equal(p.hp, 40);
  assert.deepEqual(s.errors, []);
});

test('co-op: guests see hearts and heal from them, and their note cards complete chords in the shared song', async t => {
  const srv = await startServer(t);
  const a = session(srv.origin, true); t.after(() => a.close()); await a.click('#multiplayer'); await until(() => a.game.net.id, 'host welcome');
  const b = session(roomUrl(srv.origin, a), true); t.after(() => b.close()); await b.click('#multiplayer'); await until(() => b.game.net.id, 'guest welcome');
  await a.pick('guitar'); await b.pick('bass'); await until(() => a.game.net.roster.every(p => p.char), 'picks');
  await a.click('#ready'); await b.click('#ready'); await until(() => a.game.net.roster.every(p => p.ready), 'ready'); await a.click('#start-band');
  await until(() => a.game.running && b.game.running, 'both playing');
  const host = a.game, guest = b.game, H = host.G, me = H.players.find(p => p.id === guest.net.id);
  // серця: гість бачить їх і лікується від них
  H.mobs = []; me.p.hp = 30; H.hearts.push({ x: me.p.x + 400, y: me.p.y, age: 0 });
  await until(() => guest.G.hearts && guest.G.hearts.length === 1 && guest.G.hearts[0].netId, 'guest sees the heart'); guest.draw();
  H.hearts[0].x = me.p.x; H.hearts[0].y = me.p.y;
  await until(() => H.hearts.length === 0 && me.p.hp > 30, 'the guest hero picks the heart'); assert.ok(me.p.hp >= 30 + me.p.max * .2 - 1);
  await until(() => guest.G.hearts.length === 0, 'the heart disappears for the guest too');
  // ноти гостя ведуть до спільного акорда
  const song = host.SONG; let got = false;
  for (let attempt = 0; attempt < 30 && !got; attempt++) {
    H.xp = 4 + 5 * H.level; host.levelUp(); // ровно на рівень: без залишку, що одразу дав би наступний
    await until(() => a.game.choosing && b.game.choosing && b.elements.get('#opts').children.length > 0 && a.elements.get('#opts').children.length > 0, 'both choose');
    const opts = host.net.pending.get(guest.net.id), idx = opts.findIndex(o => o.note && o.lvl === 1), hostBtn = a.elements.get('#opts').children[0];
    if (idx >= 0) {
      assert.equal(b.elements.get('#opts').children.length, opts.length, 'the guest renders every card, note cards included');
      const before = (song.notes[1] || []).length, haveBefore = song.have; await b.elements.get('#opts').children[idx].onclick(); got = true;
      await until(() => host.SONG.have > haveBefore || (host.SONG.notes[1] || []).length > before, 'the guest note reaches the shared song');
      await until(() => guest.SONG.have === host.SONG.have && (guest.SONG.notes[1] || []).length === (host.SONG.notes[1] || []).length, 'guest song matches');
    } else await b.elements.get('#opts').children[0].onclick();
    await hostBtn.onclick(); await until(() => !a.game.choosing && !b.game.choosing, 'level closes');
  }
  assert.ok(got, 'the guest was offered a note card');
  assert.equal(H.players.find(p => p.char === 'bass').p.max, 120, 'levels do not change max HP');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});
