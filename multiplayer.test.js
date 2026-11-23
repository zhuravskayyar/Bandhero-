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
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) {
    this._html = html; this.children = [];
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
    ...(audioFixture.sessionStorage ? { sessionStorage: audioFixture.sessionStorage } : {}),
    // Підказки першого забігу в тестах вимкнено, якщо тест сам не дає сховище (audioFixture.localStorage).
    localStorage: 'localStorage' in audioFixture ? audioFixture.localStorage : { getItem: k => k === 'bandhero.hints' ? '0' : null, setItem() {} },
    WebSocket, location: new URL(origin), setTimeout: later, clearTimeout, setInterval: interval,
    Image: class { constructor() { this.complete = true; this.naturalWidth = 1254; this.naturalHeight = 1254; } },
    // SoundFont-банк (.sf2) не тягнемо з мережі: тест не має залежати від того, чи запущено сервер на 8080.
    // audioFixture.sf2 — справжній файл із диска (див. тест «A320U bank renders…»), інакше банку «немає» → запасні семпли.
    fetch: (url, opts) => { const u = new URL(url, origin);
      if (u.pathname.startsWith('/assets/flute/')) return Promise.resolve(audioFixture.flute ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { ok: false }); // семпли сопілки: лише коли тест просить
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

test('genre arrangements keep a stable rhythm inside each pattern band and a clean articulation at every upgrade rank', t => {
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const game=s.game,signatures={};
  for(const genre of Object.keys(game.GENRES)){
    const song=game.makeSong(null,genre);game.setSong(song);const original=JSON.stringify(song);
    assert.equal(song.prog.length,4);assert.ok(new Set(song.prog.map(c=>c.off)).size>=3,'four-bar harmony has movement: '+genre);
    // 4-й бій російського шансону має власний темп 100–105 BPM поза діапазоном жанру
    const [lo,hi]=genre==='chanson'&&song.boi===4?[100,105]:game.GENRES[genre].bpm;
    assert.ok(song.bpm>=lo&&song.bpm<=hi,'tempo in range: '+genre);
    const events=(layer,rank)=>{const out=[];for(let bar=0;bar<8;bar++)for(let step=0;step<16;step++){
      for(const e of layer.steps(game.chordAt(bar),step,bar,rank)){
        assert.ok(!e.slide&&!e.vib,'no automatic pitch scoop: '+genre+'/'+layer.id);
        out.push([bar,step,e.midi,e.drum,e.art,e.dir]);
        if(e.art==='harmonic')assert.equal(e.midi,e.harmonicBase+12,'octave harmonic of an actual fretted string');
      }}return JSON.stringify(out);};
    for(const layers of Object.values(game.LAYERS))for(const layer of layers){
      const base=events(layer,1);assert.notEqual(base,'[]',genre+'/'+layer.id+' has a playable part');
      // рівень → рисунок ритму: L1–2 один рисунок, L3–4 інший, L5 третій (де в партії є рисунки); усередині пари нічого не міняється
      assert.equal(events(layer,2),base,'ranks 1 and 2 share a pattern: '+genre+'/'+layer.id);
      assert.equal(events(layer,4),events(layer,3),'ranks 3 and 4 share a pattern: '+genre+'/'+layer.id);
      assert.notEqual(events(layer,5),'[]',genre+'/'+layer.id+' still plays at rank 5');
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
      // фон йде за ПОВНОЮ прогресією (навіть коли зібрано лише 1 акорд); мелодія фону — за акордом гравця
      if(e.midi!==undefined){const ch=e.kind==='hook'?g.chordAt(i>>4):g.genreExpansion.chordAt(song,i>>4,true)||song.prog[(i>>4)%4];assert.ok(ch.pcs.includes(e.midi%12),genre+' backing stays in the chord ('+e.kind+')');}
    }
    // основа біта жанру — куплет (такти 4–5); вступ навмисно рідший
    const verse=Array.from({length:32},(_,i)=>g.backingEvents(4+(i>>4),i&15)),signature=verse.map(a=>a.filter(e=>e.kind==='drum').map(e=>e.drum).join('+')).join('|');
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
  await a.click('#quit'); await a.click('#quit');
  await until(() => !b.game.net.reconnecting && b.game.net.ws && b.game.net.ws.readyState === 1, 'guest reconnects', 8000);
  await until(() => b.game.net.phase === 'lobby' && !b.game.running && !b.elements.get('#lobby').classList.contains('hide'), 'guest sees the lobby');
  await until(() => a.game.net.roster.length === 2, 'guest is in the host lobby again');
  await b.pick('drums'); await until(() => !b.elements.get('#ready').disabled && !a.elements.get('#ready').disabled, 'ready buttons enabled');
  await b.click('#ready'); await a.click('#ready');
  await until(() => !a.elements.get('#start-band').disabled, 'host can start a new run');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

const memoryStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('co-op pause: the player who paused can resume, others cannot, the host always can, and the overlay names who paused', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const bid = b.game.net.id;
  b.game.setPause(true); await until(() => a.game.paused && b.game.paused, 'guest pause reaches everyone');
  assert.equal(a.game.net.pausedBy, bid); assert.equal(b.game.net.pausedBy, bid);
  assert.match(a.elements.get('#pause-title').textContent, new RegExp(bid + ' · .* поставив гурт на паузу'), 'host sees who paused');
  await until(() => b.elements.get('#pause-title').textContent === 'Ти поставив гурт на паузу', 'guest sees that it paused');
  assert.ok(!b.elements.get('#resume').classList.contains('hide'), 'the pauser gets the resume button');
  assert.ok(!a.elements.get('#resume').classList.contains('hide'), 'the host always has the resume button');
  b.key('keydown', 'KeyP'); await until(() => !a.game.paused && !b.game.paused, 'guest unpauses with P');
  assert.equal(a.game.net.pausedBy, null);
  // хост поставив паузу — гість зняти її не може
  a.game.setPause(true); await until(() => b.game.paused, 'host pause reaches the guest');
  assert.ok(b.elements.get('#resume').classList.contains('hide'), 'a guest cannot resume the host pause');
  b.game.setPause(false); await delay(150); assert.ok(a.game.paused && b.game.paused, 'guest request is ignored');
  b.game.net.ws.send(JSON.stringify({ t: 'toHost', d: { k: 'resume', match: b.game.net.match } })); await delay(150);
  assert.ok(a.game.paused, 'forged resume is ignored by the host');
  a.game.setPause(false); await until(() => !a.game.paused && !b.game.paused, 'host resumes');
  // гість поставив паузу — хост знімає її в будь-який момент
  b.game.setPause(true); await until(() => a.game.paused, 'guest pause again');
  a.game.setPause(false); await until(() => !a.game.paused && !b.game.paused, 'host overrides the guest pause');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('the host asks twice before returning the band to the lobby', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  a.game.setPause(true); await until(() => b.game.paused, 'paused');
  await a.click('#quit');
  assert.equal(a.elements.get('#quit').textContent, 'Точно? Натисни ще раз'); assert.ok(a.game.running && b.game.running, 'one click does nothing yet');
  await a.click('#quit'); await until(() => !a.game.running && b.game.net.phase === 'lobby', 'second click returns everyone to the lobby');
});

test('a guest who reloads the page mid-run reclaims the same seat from sessionStorage and gets the world back', async t => {
  const srv = await startServer(t);
  const a = session(srv.origin, true); t.after(() => a.close());
  await a.click('#multiplayer'); await until(() => a.game.net.id, 'host welcome');
  const store = memoryStorage(), invite = roomUrl(srv.origin, a);
  let b = session(invite, true, { sessionStorage: store }); t.after(() => b.close());
  await b.click('#multiplayer'); await until(() => b.game.net.id, 'guest welcome');
  await a.pick('guitar'); await b.pick('drums'); await until(() => a.game.net.roster.every(p => p.char), 'picks');
  await a.click('#ready'); await b.click('#ready'); await until(() => a.game.net.roster.every(p => p.ready), 'ready');
  await a.click('#start-band'); await until(() => a.game.running && b.game.running, 'both playing');
  const id = b.game.net.id, token = b.game.net.token;
  await until(() => store.getItem('bandhero.band'), 'resume token stored');
  assert.deepEqual(JSON.parse(store.getItem('bandhero.band')), { room: a.game.net.room, token });
  b.close(); // вкладку перезавантажено: пам’ять гри втрачена, sessionStorage лишився
  await until(() => srv.output.includes('втратив зв’язок'), 'server keeps the seat');
  const b2 = session(invite, true, { sessionStorage: store }); t.after(() => b2.close()); // ?band=1&room=… з’єднується сама
  await until(() => b2.game.net.id === id, 'same player id after reload');
  await until(() => b2.game.running && b2.game.G && b2.game.G.players.length === 2, 'reloaded guest gets the run back');
  assert.equal(b2.game.net.token, token); assert.equal(a.game.G.players.length, 2, 'host kept the musician');
  const bx = a.game.G.players[1].p.x; b2.key('keydown', 'KeyD'); await delay(500); b2.key('keyup', 'KeyD');
  await until(() => a.game.G.players[1].p.x > bx + 30, 'reloaded guest controls its actor again');
  assert.deepEqual(a.errors, []); assert.deepEqual(b2.errors, []);
  // вихід гравця стирає токен
  await b2.click('#quit'); await until(() => !b2.game.net.active, 'guest left'); assert.equal(store.getItem('bandhero.band'), null, 'token cleared on leave');
});

test('a late joiner is told the run is in progress and is offered their own room', async t => {
  const srv = await startServer(t);
  const [a] = await bandOfTwo(t, srv.origin);
  const late = session(roomUrl(srv.origin, a)); t.after(() => late.close());
  await late.click('#multiplayer'); await until(() => !late.game.net.active, 'late join rejected');
  assert.match(late.elements.get('#menu-notice').textContent, /Забіг уже триває.*лобі.*власну кімнату/);
  assert.ok(!late.elements.get('#own-room').classList.contains('hide'), 'own-room button is shown');
  await late.click('#own-room'); await until(() => late.game.net.room && late.game.net.id, 'own room created');
  assert.notEqual(late.game.net.room, a.game.net.room);
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
  for (const boi of [1, 2, 3, 4]) { const S = { ...g.SONG, genre: 'chanson', boi }; g.setSong(S);
    const hps = g.hitsPerSec('chanson', S.bpm, strum, 1); perBar.push(hps); }
  assert.ok(perBar[1] > perBar[0] && perBar[2] > perBar[1] && perBar[3] > perBar[2], 'denser boi = more strokes, so balanceK lowers damage per stroke on its own');
  // 4-й бій («шансонний») лише в російського шансону: ~103 BPM
  const seen = { 1: 0, 2: 0, 3: 0, 4: 0 }, uaBois = new Set();
  for (let i = 0; i < 200; i++) { const c = g.makeSong(null, 'chanson'); seen[c.boi]++; if (c.boi === 4) assert.ok(c.bpm >= 100 && c.bpm <= 105, 'chanson boi 4 tempo 100-105, got ' + c.bpm); else assert.ok(c.bpm >= 80 && c.bpm <= 100);
    uaBois.add(g.makeSong(null, 'chanson_ua').boi); }
  assert.ok(Object.values(seen).every(n => n > 0), 'all four chanson bois get picked'); assert.deepEqual([...uaBois].sort(), [1, 2, 3], 'ukrainian chanson keeps three bois');
  assert.deepEqual(s.errors, []);
});

test('new enemies behave: ranged notes hurt, swarms come in groups, echoes split, feedback charges', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('lofi'); await s.game.pick('drums');
  const g = s.game, G = g.G;
  G.layers = {}; // беззбройний, щоб вороги дожили
  G.t = 9; // стартовий щит (перші 8 с) уже згас
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

// після вбивства (не фінального) боса гурт отримує безкоштовний вибір покращення і +30% HP: беремо першу картку, щоб гра пішла далі
const takeBossReward = async (ss, lv0) => {
  await until(() => ss[0].game.G.level > lv0, 'boss reward is a free level');
  await delay(150); if (!ss.some(s => s.game.choosing)) return; // високий рівень: «нічого вибирати» застосовується саме
  await until(() => ss.every(s => s.game.choosing && s.elements.get('#opts').children.length > 0), 'reward cards');
  for (const s of ss) await s.elements.get('#opts').children[0].onclick();
  await until(() => ss.every(s => !s.game.choosing), 'reward taken');
};

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
    if (i < 2) { const lv = g.G.level; b.hp = 0; await until(() => !g.G.mobs.includes(b), 'boss dies'); await takeBossReward([s], lv); assert.ok(g.running, 'run continues'); }
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

// усе куплено й прокачано: пул карток порожній, лишаються лише «▲» повтори або взагалі нічого
function maxOutBuild(g, pl, inst) {
  for (const l of g.LAYERS[inst]) if (!l.starter) pl.layers[l.id] = 3;
  for (const p of g.PEDALS) pl.pedals[p.id] = 3;
  for (const id of Object.keys(g.VOICINGS[inst] || {})) pl.layers['$v_' + id] = 1;
  pl.layers.$hp = 5; g.SONG.prog.forEach(c => { c.lvl = 3; }); g.SONG.have = g.SONG.prog.length;
}

test('balance: late levels are slower, bosses are tanky and enrage below 35% HP, the opening is shielded, the XP magnet is wider', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G;
  // темп: до 25-го рівня стара крива, далі швидко дорожчає
  assert.equal(g.need(10), 54); assert.equal(g.need(25), 129); assert.ok(g.need(45) > 3 * (4 + 5 * 45) / 2); assert.ok(g.need(40) > g.need(39));
  let cum = 0, lv = 1; while (cum + g.need(lv) <= 10985) cum += g.need(lv++);
  assert.ok(lv >= 40 && lv <= 52, 'повний забіг бота закінчується на ~40–50 рівні, а не 66: ' + lv);
  G.level = 60; G.t = 900; const late = g.threat().hp; G.t = 300; assert.ok(late > g.threat().hp * 2.5, 'вороги в кінці забігу не слабшають');
  // боси: HP від ~10 до ~58 тис., у парі ×1.6
  for (const [k, min] of [['boss1', 9000], ['boss2', 14000], ['boss3', 50000]]) assert.ok(g.MOBS[k].hp >= min, k);
  // лють нижче 35% HP: з'являються додаткові залпи, є видима мітка в HUD
  g.addMob('boss1', G.p.x + 300, G.p.y, { age: 5 }); const b = G.mobs.find(m => m.type === 'boss1'); b.hp = b.max = 10600;
  assert.equal(g.bossEnraged(b), false); b.hp = b.max * .4; assert.equal(g.bossEnraged(b), false);
  const burstsAt = (m, steps) => steps.filter(st => { const n = g.bossNotes(m, st, { off: 0 }); return n && n.atk && n.atk.k === 'burst'; }).length;
  const calm = burstsAt(b, [0, 4, 8, 12]); b.hp = b.max * .3; assert.equal(g.bossEnraged(b), true);
  assert.ok(burstsAt(b, [0, 4, 8, 12]) > calm, 'enraged boss fires extra bursts');
  g.draw(); // HUD з міткою люті малюється без помилок
  assert.equal(dictionary.en['У ЛЮТІ!'], 'ENRAGED!'); assert.ok(dictionary.de['Авто: {0}'] && dictionary.ru['Авто: {0}']);
  b.hp = 0; G.mobs = G.mobs.filter(m => m !== b);
  // стартовий щит: перші 8 с герой невразливий, потім ні
  G.mobs.length = 0; G.t = 3; const a = G.players && G.players[0] || { p: G.p, pedals: G.pedals, char: 'guitar' };
  const hp0 = G.p.hp; g.hurtPlayer(a, 30); assert.equal(G.p.hp, hp0, 'shield absorbs damage'); g.draw();
  G.t = g.SPAWN_SHIELD + .01; g.hurtPlayer(a, 30); assert.ok(G.p.hp < hp0, 'shield is gone after 8 s');
  assert.equal(g.GEM_MAGNET, 120);
  assert.deepEqual(s.errors, []);
});

test('late level-ups with no meaningful choice apply a small bonus instead of pausing (solo)', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, layer = Object.keys(G.layers)[0] || g.LAYERS.guitar[0].id;
  const grow = { l: g.LAYERS.guitar.find(l => l.id === layer) || g.LAYERS.guitar[0], isNew: false };
  assert.equal(g.noChoice([grow, grow, grow], 30), true, 'all repeats late → no choice');
  assert.equal(g.noChoice([grow, grow, grow], 5), false, 'early levels always show cards');
  assert.equal(g.noChoice([grow, { hp: true }, grow], 30), false, 'one real option keeps the screen');
  assert.equal(g.noChoice([{ hp: true }], 3), true, 'a single option is not a choice');
  assert.equal(g.noChoice([{ xpb: true }], 3), true);
  // повний «пізній» стан: усі слоти й картки на максимумі → пул порожній → автобонус, гра не стає на паузу
  maxOutBuild(g, G, 'guitar');
  G.layers.$hp = 5; G.level = 40; G.xp = g.need(40); G.p.hp = G.p.max * .5;
  const hp = G.p.hp, lvl = G.level, before = G.texts.length;
  g.levelUp();
  assert.equal(G.level, lvl + 1); assert.equal(g.choosing, false); assert.equal(s.elements.get('#lvl').classList.contains('hide'), true, 'level screen stays closed');
  assert.ok(G.p.hp > hp, 'small heal'); assert.ok(G.texts.length > before && G.texts.some(x => x.toast), 'toast shown');
  assert.deepEqual(s.errors, []);
});

test('band: the host auto-applies a level-up with no real choice for that player only; the others still choose', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const g = a.game, G = g.G, guitar = G.players.find(x => x.char === 'guitar'), drums = G.players.find(x => x.char === 'drums');
  maxOutBuild(g, guitar, 'guitar'); guitar.p.hp = guitar.p.max * .5; drums.p.hp = drums.p.max * .5; const hp = guitar.p.hp;
  G.t = 20; G.level = 40; G.xp = g.need(40);
  await until(() => G.level === 41, 'host levels up');
  assert.ok(guitar.p.hp > hp, 'the maxed guitarist got the small heal automatically');
  assert.equal(g.net.pending.has(guitar.id), false, 'no card screen for the maxed player');
  await until(() => b.game.G.level === 41 && b.game.G.players.find(x => x.char === 'guitar').p.hp > hp - 1, 'guest sees the same level and heal');
  if (g.net.pending.size) assert.equal(g.paused, true, 'the run waits only while somebody still has a real choice');
  else assert.equal(g.paused, false, 'nobody has a choice: the run does not pause');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
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
  const boss = host.addMob('boss1', H.players[0].p.x + 200, H.players[0].p.y); boss.spd = 0; boss.hp = 0; const lv0 = H.level;
  await until(() => (guest.G.pfx || []).some(f => f.k === 'boom') && guest.G.pfx.some(f => f.k === 'skull'), 'guest sees boss explosion and skull');
  H.gems = []; H.xp = 0; await takeBossReward([a, b], lv0); await until(() => !(H.pfx || []).some(f => f.k === 'star'), 'reward stars fade');
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
  const level = G.level, state = () => JSON.stringify([G.layers, G.pedals, g.SONG.have, g.SONG.prog.map(c => c.name), Math.round(G.p.hp), g.SONG.notes, g.SONG.dfig]); // + ноти акорда й ритм-фігури: картка могла змінити лише їх (давало рідкісний збій)
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
      for(let b=0;b<bars.length;b++){const notes=bars[b],allowed=Array.from(song.prog[0].pcs);assert.ok(notes.every(m=>allowed.includes(m%12)),genre+'/'+inst+' holds the unlocked chord');
        // не обертається сама; єдиний виняток — такт, де фон іде в інший акорд: нота-корінь, що була б avoid проти нього, замінюється іншим тоном ТОГО Ж акорда гравця (узгодження з фоном, game.html: fitEvents)
        if(!melodic&&g.fullChordAt(b).off===song.prog[0].off)assert.deepEqual(notes,bars[0],genre+'/'+inst+' cannot rotate notes automatically');}
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
      }else{const pcs=new Set(Array.from(song.prog.slice(0,2)).flatMap(ch=>Array.from(ch.pcs)));
        // корені двох акордів чути завжди; у такті, де фон іде в інший акорд, корінь може змінитись на інший тон акорда гравця (fitEvents), але не на чужий
        assert.ok(roots.size>=2,genre+'/'+inst+' follows the second chord only after the card');for(const root of roots)assert.ok(pcs.has(root),genre+'/'+inst+' never plays a locked chord');}
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

test('flute resolves to the real VSCO vibrato sustain samples, names mapped to MIDI, nearest sample repitched; without files it falls back',async t=>{
  const s=session('http://127.0.0.1:8080',true,{flute:true,sampleLevel:.05});t.after(()=>s.close());const g=s.game;
  g.setGenre('folkrock');await g.pick('flute');g.setPause(true);g.logNotes(true);const at=()=>g.ctx.currentTime+.05;
  g.playBuffered(at(),{midi:81,vel:.5,seconds:.3});let n=g.notes.at(-1);
  assert.equal(n.source,'vsco-flute');assert.equal(n.sample,'susvib_A4','susvib_A4 sounds A5 = MIDI 81');assert.ok(Math.abs(n.rate-1)<1e-9);assert.ok(n.duration<.5,'a short note is cut, not the whole 4 s sample');
  g.playBuffered(at(),{midi:60,vel:.5,seconds:.3});assert.equal(g.notes.at(-1).sample,'susvib_C3','lowest sample C3 = MIDI 60');
  g.playBuffered(at(),{midi:83,vel:.5,seconds:.3});n=g.notes.at(-1);assert.equal(n.sample,'susvib_C5');assert.ok(Math.abs(n.rate-Math.pow(2,-1/12))<1e-9,'nearest sample is repitched by playbackRate');
  for(let m=60;m<=96;m++){g.playBuffered(at(),{midi:m,vel:.5,seconds:.2});n=g.notes.at(-1);assert.equal(n.source,'vsco-flute');assert.ok(Math.abs(Math.log2(n.rate))*12<=2.51,'midi '+m+' is within 2.5 semitones of a sample');}
  // педаль октави над високою нотою (до 104) — справді вище, а не той самий звук
  g.playBuffered(at(),{midi:100,vel:.5,seconds:.2});n=g.notes.at(-1);assert.equal(n.source,'vsco-flute');assert.equal(n.sample,'susvib_C6');assert.ok(Math.abs(Math.log2(n.rate)*12-4)<1e-9,'100 = C6 sample raised 4 semitones, not folded to unison');
  g.playBuffered(at(),{midi:110,vel:.5,seconds:.2});n=g.notes.at(-1);assert.equal(n.source,'vsco-flute','notes far above the samples fold an octave down');
  // трелі й форшлаги (0,05 с) не тягнуться під наступну ноту
  g.playBuffered(at(),{midi:81,vel:.5,seconds:.05});n=g.notes.at(-1);assert.ok(n.duration<.1,'ornament stays short: '+n.duration);
  assert.deepEqual(s.errors,[]);
  const f=session('http://127.0.0.1:8080',true,{sampleLevel:.05});t.after(()=>f.close());await f.game.pick('flute');f.game.setPause(true);f.game.logNotes(true);
  f.game.playBuffered(f.game.ctx.currentTime+.05,{midi:81,vel:.5,seconds:.3});const last=f.game.notes.at(-1);assert.ok(!last||last.source!=='vsco-flute','no sample files: old SoundFont/synth path');
  assert.deepEqual(f.errors,[]);
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
  /* Міх детермінований, але ключ і темп пісні випадкові (makeSong): у такті 0 перший хід може тривати 2–8 тактів без розвороту, і «провалу» там немає.
     Тому береться такт, де хід гарантовано розвертається (початок 2-го ходу фрази 0) — і перевіряється саме він. */
  const turn=g.bellowsStrokes(0).find(x=>x.start>0),turnBar=turn.start>>4;
  const ev=g.buses.accordion.bellows.gain.events,from=ev.length;g.bellowsBar(g.ctx.currentTime+.05,turnBar);
  const sets=ev.slice(from).filter(x=>x[0]==='set'||x[0]==='linear').map(x=>x[1]);assert.ok(sets.length>3&&sets.every(Number.isFinite)&&Math.min(...sets)<.45,'bar gain swells and dips at a stroke turnaround');
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
      { const c = song.prog[slot], ext = [2, 5, 9, 1].map(i => (c.root + i) % 12); assert.ok(ext.some(p => c.pcs.includes(p) && !g.mkChord(song, c.off, 2).pcs.includes(p)), genre + ': level 3 has the ninth (діатонічна нона; над iii мажору — 11, над V мінору — b9)'); } assert.ok(song.prog[slot].pcs.length > n1 - 1);
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
    } else await b.elements.get('#opts').children[Math.max(0, opts.findIndex(o => !o.hp))].onclick(); // не картка +10% макс. HP: вона законно змінює максимум
    await hostBtn.onclick(); await until(() => !a.game.choosing && !b.game.choosing, 'level closes');
  }
  assert.ok(got, 'the guest was offered a note card');
  assert.equal(H.players.find(p => p.char === 'bass').p.max, 120, 'levels do not change max HP');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

/* ================= МЕРЕЖЕВА ПЛАВНІСТЬ ГОСТЯ: коалесценція, інтерполяція, SONG раз на зміну, акорд одним числом ================= */
// Знімок для ручної подачі гостю: справжній стан хоста + службові поля; усі числа вже пройшли через проводовий формат.
const handSnapshot = (host, over = {}, mobs) => {
  const state = host.game.cleanState(); if (mobs) state.mobs = mobs; state.t = over.t ?? state.t;
  return JSON.parse(JSON.stringify({ k: 'state', match: host.game.net.match, sq: over.sq ?? 1, ts: over.ts ?? 1000, state, step: 0, until: 0.1, paused: !!over.paused, choosing: false, choices: {}, ended: false, ...(over.ev ? { ev: 1 } : {}) }));
};
const deliver = (guest, d) => guest.game.net.ws.__handler({ data: JSON.stringify({ t: 'fromHost', d }) });
// гість більше не бачить справжніх знімків хоста: усе, що він застосує, подаємо вручну
const cutFeed = guest => { const ws = guest.game.net.ws; ws.__handler = ws.onmessage; ws.onmessage = null; };

test('guest coalesces a burst of snapshots into one apply per frame; event snapshots apply at once and cancel older ones', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  a.game.G.mobs = []; await delay(150); cutFeed(b); b.holdFrames(true); await delay(250); // зачекати, поки застосується знімок, що вже стояв у черзі
  const ip = b.game.net.ip, applied = ip.applied, coalesced = ip.coalesced;
  for (let i = 0; i < 3; i++) deliver(b, handSnapshot(a, { t: 1000 + i, sq: 10 + i, ts: 5000 + i * 20 }));
  assert.equal(ip.applied, applied, 'regular snapshots wait for the frame, they are not applied one by one');
  await until(() => ip.applied > applied, 'the pending snapshot is applied (timer fallback while frames are held)');
  assert.equal(ip.applied, applied + 1, 'three snapshots, one apply'); assert.equal(ip.coalesced, coalesced + 2);
  assert.equal(b.game.G.t, 1002, 'the newest one won');
  // подія (пауза) іде одразу й по черзі; старіший регулярний знімок після неї не повертає гру з паузи
  deliver(b, handSnapshot(a, { t: 2000, sq: 20, ts: 5100 })); deliver(b, handSnapshot(a, { t: 2001, sq: 21, ts: 5120, paused: true, ev: 1 }));
  assert.equal(b.game.G.t, 2001, 'the event snapshot is applied immediately'); assert.equal(b.game.paused, true);
  await delay(200); assert.equal(b.game.G.t, 2001, 'the older regular snapshot was discarded'); assert.equal(b.game.paused, true);
  b.holdFrames(false); assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('net.ip interpolation state resets on connect, host change, prepare and leave', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  const g = b.game, ip = g.net.ip, dirty = () => Object.assign(ip, { off: 12345, last: 99, lost: 3, applied: 7, gaps: [1, 2] });
  dirty(); g.leaveBand(); assert.equal(g.net.ip, ip, 'same object'); assert.deepEqual([ip.off, ip.last, ip.lost, ip.applied, ip.gaps.length], [null, 0, 0, 0, 0], 'leaveBand resets');
  assert.deepEqual(a.errors, []);
});

test('guest interpolates remote mobs between snapshots, extrapolates up to 150 ms, then holds, and snaps on teleports', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  a.game.G.mobs = []; await delay(150); cutFeed(b); b.holdFrames(true); await delay(250); // зачекати, поки застосується знімок, що вже стояв у черзі
  const g = b.game, ip = g.net.ip, at = (x, ts) => handSnapshot(a, { ts, sq: ts }, [{ netId: 9001, type: 'fal', x, y: -x / 2, hp: 10 }]);
  const mob = () => g.G.mobs.find(m => m.netId === 9001);
  ip.off = 0; ip.avg = 75; ip.dev = 0; ip.delay = 110; // зсув годинників 0: час знімка = ts; затримка рендера 110 мс
  for (const [x, ts] of [[0, 1000], [75, 1075], [150, 1150]]) await g.receiveHost(at(x, ts), performance.now()); // напряму: без статистики годинників, час знімка = ts
  const frame = rt => { g.interpolateWorld(0.001, rt + ip.delay); return mob(); }; // render time = rt
  let m = frame(1040); assert.ok(Math.abs(m.x - 40) < .6 && Math.abs(m.y + 20) < .6, 'between snapshots 1 and 2: x=' + m.x);
  m = frame(1100); assert.ok(Math.abs(m.x - 100) < .6, 'between snapshots 2 and 3: x=' + m.x);
  m = frame(1200); assert.ok(Math.abs(m.x - 200) < .6, 'newer snapshot not here yet: extrapolates by the last velocity, x=' + m.x);
  m = frame(1500); assert.ok(Math.abs(m.x - 300) < .6, 'extrapolation is capped at 150 ms, then the mob holds, x=' + m.x);
  m = frame(1100); assert.ok(Math.abs(m.x - 100) < .6, 'sampling is a pure function of render time');
  await g.receiveHost(at(2000, 1225), performance.now()); m = frame(1226);
  assert.equal(Math.round(m.x), 2000, 'a teleport (>500 px) snaps instead of sliding across the screen');
  // нова сутність не виїжджає з нескінченності: одна вибірка — стоїть на місці
  await g.receiveHost(handSnapshot(a, { ts: 1300, sq: 1300 }, [{ netId: 9002, type: 'fal', x: 30, y: 40, hp: 10 }]), performance.now());
  g.interpolateWorld(0.001, 1300 + ip.delay + 500); const fresh = g.G.mobs.find(x => x.netId === 9002); assert.deepEqual([fresh.x, fresh.y], [30, 40]);
  assert.equal(g.G.players.find(p => p.id === g.net.id).p.sm, undefined, 'the own hero is predicted, never interpolated');
  // чистий sampleAt: вибірки [T,x,y…]
  assert.deepEqual(Array.from(g.sampleAt([0, 0, 0, 100, 100, 50], 50)), [50, 25]); assert.deepEqual(Array.from(g.sampleAt([0, 0, 0], 999)), [0, 0]);
  b.holdFrames(false); assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('own hero reconciliation corrects small errors gradually instead of teleporting', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  a.game.G.mobs = []; await delay(150); cutFeed(b); b.holdFrames(true); await delay(250); // зачекати, поки застосується знімок, що вже стояв у черзі
  const g = b.game, me = g.G.players.find(p => p.id === g.net.id), x0 = me.p.x;
  g.net.hist = [{ t: performance.now() - 1000, x: x0, y: me.p.y }]; g.net.rtt = 0;
  const d = handSnapshot(a, { ts: 3000, sq: 3000, ev: 1 }); d.state.players.find(p => p.id === g.net.id).p.x = x0 + 40; // хост бачить нас на 40 px правіше
  await g.receiveHost(d, performance.now());
  const mine = g.G.players.find(p => p.id === g.net.id);
  assert.ok(Math.abs(mine.p.x - x0) < 1, 'applying a snapshot does not move the own hero by the error'); assert.ok(g.net.err && Math.abs(g.net.err.x - 40) < 2);
  g.interpolateWorld(1 / 60); const step1 = mine.p.x - x0; assert.ok(step1 > 0 && step1 < 10, 'one frame removes only a part of the error: ' + step1);
  for (let i = 0; i < 90; i++) g.interpolateWorld(1 / 60); assert.ok(Math.abs(mine.p.x - (x0 + 40)) < 1.5, 'and it converges: ' + (mine.p.x - x0));
  b.holdFrames(false); assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('SONG travels only when it changes (and in event/reconnect snapshots); guests keep the last one, also after a reconnect', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  const sent = []; const ws = a.game.net.ws, orig = ws.send.bind(ws); ws.send = s => { try { const m = JSON.parse(s); if (m.t === 'toAll' && m.d && m.d.k === 'state') sent.push({ ev: !!m.d.ev, song: !!m.d.song, len: s.length }); } catch {} return orig(s); };
  await until(() => sent.filter(s => !s.ev).length >= 8, 'a few regular snapshots');
  const regular = sent.filter(s => !s.ev);
  assert.ok(regular.filter(s => !s.song).length >= regular.length - 2, 'regular snapshots carry no SONG while it is unchanged: ' + JSON.stringify(regular.map(s => +s.song)));
  const withSong = regular.find(s => s.song), without = regular.find(s => !s.song); if (withSong) assert.ok(withSong.len > without.len + 500, 'the SONG is the bulky part');
  assert.equal(JSON.stringify(b.game.SONG), JSON.stringify(a.game.SONG), 'the guest has the host song');
  // ноти-карта на хості змінює пісню (рівні) — гість отримує нову
  const before = a.game.SONG.have; a.game.SONG.have = (before || 0) + 1; await until(() => b.game.SONG.have === a.game.SONG.have, 'a changed SONG reaches the guest');
  // обрив і повернення: хост одразу надсилає пісню знову
  sent.length = 0; b.game.net.ws.close();
  await until(() => b.game.net.ws && b.game.net.ws.readyState === 1 && !b.game.net.reconnecting, 'guest reconnects', 8000);
  await until(() => sent.some(s => s.song), 'the host resends the SONG for the returned guest');
  assert.equal(JSON.stringify(b.game.SONG), JSON.stringify(a.game.SONG), 'the guest still has the right SONG after the reconnect');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('attack chord travels as one number and the guest renders the same colour and chord level as before', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  const H = a.game.G, host = a.game; H.mobs = [];
  const keys = host.CHORD_KEYS; assert.deepEqual(Array.from(keys), Object.keys(host.CHORD_FN));
  const wire = JSON.parse(JSON.stringify({ cf: { k: 'V', l: 2 }, cc: host.CHORD_FN.V.col, x: 1.26, y: -3.51, vx: 120.4, age: .123456 }, host.wireReplacer));
  assert.deepEqual(wire, { cf: keys.indexOf('V') * 4 + 2, x: 1, y: -4, vx: 120, age: .12 }, 'cf is a number, cc is gone, coordinates are integers');
  assert.equal(JSON.stringify({ hp: 1, fx: 1, x: 1.26 }, host.wireReplacer), '{"hp":1,"fx":1,"x":1.3}', 'heroes keep one decimal');
  const me = H.players[0], ids = {};
  keys.forEach((k, i) => { const vid = 770 + i; ids[k] = vid; H.shots.push({ owner: me.id, layer: 'down', step: 0, cf: { k, l: 1 + i % 3 }, cc: host.CHORD_FN[k].col, inst: 'guitar', visualId: vid, kbk: 1, x: me.p.x + 3000 + i * 30, y: me.p.y + 3000, vx: 0, vy: 0, hit: new Set(), age: 0, life: 99, dmg: 0, spd: 0, pierce: 99, r: 4 }); });
  await until(() => keys.every(k => b.game.G.shots.some(s => s.visualId === ids[k])), 'guest sees the six chord shots');
  keys.forEach((k, i) => { const s = b.game.G.shots.find(x => x.visualId === ids[k]); assert.equal(s.cc, host.CHORD_FN[k].col, k + ' colour'); assert.deepEqual({ ...s.cf }, { k, l: 1 + i % 3 }, k + ' chord'); });
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

/* ================= ГЕНЕРАТОР ХУКІВ, СЕКЦІЇ ПІСНІ, ФОН, РІВНІ → РИТМ, ДРАЙВОВИЙ РОК ================= */
const pcOf=(m,key)=>((m-key)%12+12)%12;
const hookSig=song=>JSON.stringify({hook:song.hook,phrases:song.phrases,lead:song.lead,mel:song.mel,hk:song.hk});

test('hook engine: the same seed gives the same phrases, different seeds give different ones',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const genre of Object.keys(g.GENRES)){
    const a=g.makeSong(null,genre,{seed:777,key:2}),b=g.makeSong(null,genre,{seed:777,key:2});
    assert.equal(hookSig(a),hookSig(b),genre+': same seed and key — the same hook');
    assert.equal(a.seed,777);
  }
  const sigs=new Set(),rhythms=new Set();
  for(let seed=1;seed<=24;seed++){const song=g.makeSong(null,'pop',{seed,key:0});sigs.add(hookSig(song));rhythms.add(JSON.stringify(song.phrases.mel));}
  assert.ok(sigs.size>=22,'different seeds give different hooks ('+sigs.size+'/24)');
  assert.ok(rhythms.size>=8,'rhythm is generated, not picked from two templates ('+rhythms.size+' variants)');
  const k1=g.makeSong(null,'pop',{seed:5,key:0}),k2=g.makeSong(null,'pop',{seed:5,key:5});
  assert.notEqual(JSON.stringify(k1.mel),JSON.stringify(k2.mel),'the key transposes the hook');
  assert.deepEqual(s.errors,[]);
});

test('hook engine: phrases A, A′, B, A″ have the same density, stable endings, a contrasting answer and a higher return',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const mean=ph=>Object.values(ph.mot).reduce((a,b)=>a+b,0)/Object.keys(ph.mot).length;
  for(const genre of Object.keys(g.GENRES))for(const seed of [3,11,29]){
    const song=g.makeSong(null,genre,{seed,key:4});
    for(const role of ['lead','mel']){
      const A={pos:song.phrases[role],mot:song[role]},{Ap,B,App}=song.hk[role],name=genre+'/'+role+'/'+seed;
      assert.ok(A.pos.length>=4&&A.pos.length<=12,name+' a motif of 4–12 notes');
      for(const ph of [A,Ap,B,App]){
        assert.equal(ph.pos.length,A.pos.length,name+' every phrase has the same note count (damage per second does not depend on the phrase)');
        assert.equal(JSON.stringify(ph.pos),JSON.stringify([...new Set(ph.pos)].sort((x,y)=>x-y)),name+' sorted unique positions');
        assert.ok(ph.pos.every(p=>p>=0&&p<32&&ph.mot[p]!==undefined),name+' every onset has a pitch');
        assert.equal(Object.keys(ph.mot).length,ph.pos.length);
      }
      const weigh=pos=>{let acc=0,gap=0;pos.forEach((p,i)=>{if(p%4===2)acc++;if((pos[i+1]??pos[0]+32)-p>=6)gap++;});return acc+','+gap;};
      for(const ph of [Ap,B,App])assert.equal(weigh(ph.pos),weigh(A.pos),name+' accents on the off-beat and long gaps are as many as in A (the same damage per bar)');
      const last=p=>p.mot[p.pos[p.pos.length-1]];
      assert.equal(pcOf(last(Ap),4),0,name+' A′ closes on the tonic');
      assert.equal(pcOf(last(App),4),0,name+' A″ closes on the tonic');
      assert.equal(pcOf(last(B),4),7,name+' B ends on an open tone (the fifth)');
      assert.notEqual(JSON.stringify(Ap),JSON.stringify(A),name+' A′ is a variation of A');
      const n=A.pos.length;
      for(let i=0;i<n-2;i++)assert.equal(Ap.mot[Ap.pos[i]],A.mot[A.pos[i]],name+' A′ keeps the motif and changes only the ending');
      assert.ok(JSON.stringify(B.pos)!==JSON.stringify(A.pos)||JSON.stringify(B.mot)!==JSON.stringify(A.mot),name+' B contrasts with A');
      assert.ok(mean(App)>=mean(A),name+' the return is in a higher register');
      if(genre!=='blues'&&genre!=='folkrock')for(const p of A.pos)if(p%8===0)assert.ok([0,song.mode==='minor'?3:4,7].includes(pcOf(A.mot[p],4)),name+' downbeats are chord tones of the tonic');
    }
  }
  assert.deepEqual(s.errors,[]);
});

test('hook engine: leaps are answered by a step back, and the phrase played follows the song section',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  let leaps=0,answered=0;
  for(const genre of ['pop','rock','lofi','chanson','metal','jazz'])for(let seed=1;seed<=20;seed++){
    const song=g.makeSong(null,genre,{seed,key:0}),pos=song.phrases.mel,n1=Math.ceil(pos.length/2),pitch=pos.map(p=>song.mel[p]);
    for(let i=1;i<n1-1;i++){const d=pitch[i]-pitch[i-1];if(Math.abs(d)>=6){leaps++;const back=pitch[i+1]-pitch[i];if(back*d<0||back===0)answered++;}}
  }
  assert.ok(leaps===0||answered/leaps>=.7,'leaps are compensated ('+answered+'/'+leaps+')');
  const song=g.makeSong(null,'pop',{seed:9,key:0});g.setSong(song);
  const expect=(bar,name)=>assert.equal(JSON.stringify(g.hookPhrase('mel',bar)),JSON.stringify(name==='A'?{pos:song.phrases.mel,mot:song.mel}:song.hk.mel[name]),'bar '+bar+' plays '+name);
  [[0,'A'],[3,'A'],[4,'A'],[6,'Ap'],[8,'A'],[10,'Ap'],[12,'B'],[14,'B'],[16,'App'],[20,'B'],[22,'App'],[24,'B'],[26,'Ap']].forEach(([bar,name])=>expect(bar,name));
  g.setSong({...song,form:null,climax:null});
  for(let bar=0;bar<8;bar++)assert.equal(g.phraseName(bar),['A','Ap','B','App'][bar>>1],'without a form the phrases cycle A·A′·B·A″');
  for(let bar=0;bar<48;bar++)for(let st=0;st<16;st++)g.backingEvents(bar,st); // пісня без форми (тест, стара пісня) не ламає фон
  assert.ok(Array.from({length:16},(_,st)=>g.backingEvents(5,st)).flat().some(e=>e.kind==='drum'));
  assert.deepEqual(s.errors,[]);
});

test('guitar lead, piano melody, backing hook, flute and sax all play the same phrase of the moment',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const inst of ['guitar','piano','flute','sax']){
    g.setGenre('pop');await g.pick(inst);g.setPause(true);g.SONG.have=4;
    const id={guitar:'lead',piano:'mel',flute:'melody',sax:'riff'}[inst],Ly=g.LAYERS[inst].find(l=>l.id===id),role=inst==='guitar'?'lead':'mel';
    for(const bar of [0,2,4,6,12,16,22]){
      const ph=g.hookPhrase(role,bar),half=(bar%2)*16,want=ph.pos.filter(p=>p>=half&&p<half+16).map(p=>p-half);
      const heard=[];for(let st=0;st<16;st++)if(Ly.steps(g.chordAt(bar),st,bar,1).some(e=>!e.orn))heard.push(st);
      assert.equal(JSON.stringify(heard),JSON.stringify(want),inst+' bar '+bar+' sounds exactly at the positions of '+g.phraseName(bar));
    }
  }
  g.setGenre('pop');await g.pick('guitar');g.setPause(true);g.SONG.have=4;
  for(const bar of [0,6,12,16]){const ph=g.hookPhrase('mel',bar),half=(bar%2)*16;
    const hooks=[];for(let st=0;st<16;st++)if(g.backingEvents(bar,st).some(e=>e.kind==='hook'))hooks.push(st);
    assert.equal(JSON.stringify(hooks),JSON.stringify(ph.pos.filter(p=>p>=half&&p<half+16).map(p=>p-half)),'the backing hook plays the phrase of bar '+bar);}
  assert.deepEqual(s.errors,[]);
});

test('song form: intro 4, verse 8, build-up 4, chorus 8, break 4, chorus 8, then a loop with a second verse; sections change on 4-bar boundaries',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const song=g.makeSong(null,'rock');g.setSong(song);
  const want=[['intro',4],['verse',8],['pre',4],['chorus',8],['break',4],['chorus',8],['verse',8],['pre',4],['chorus',8],['break',4],['chorus',8],['verse',8]];
  let bar=0;for(const [id,len] of want){assert.equal(bar%4,0,id+' starts on a 4-bar boundary');
    for(let i=0;i<len;i++){const sec=g.sectionAt(bar+i);assert.equal(sec.id,id,'bar '+(bar+i)+' is '+id);assert.equal(sec.i,i);}bar+=len;}
  assert.equal(g.sectionAt(4).round,0);assert.equal(g.sectionAt(36).round,1,'the loop restarts with verse 2');assert.equal(g.sectionAt(68).round,2);
  for(const id of Object.keys(g.SEC_NAME))for(const lang of ['en','de','ru'])assert.ok(s.dictionary[lang][g.SEC_NAME[id]],lang+' name of the section '+id);
  const blues=g.makeSong(null,'blues');g.setSong(blues);assert.equal(g.sectionAt(5).id,'verse');assert.equal(blues.chordForm,'twelve-bar');
  assert.deepEqual(s.errors,[]);
});

test('boss climax starts and ends on 4-bar boundaries, is the same on every client, and leaves the player parts alone',async t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  g.setGenre('pop');await g.pick('guitar');g.setPause(true);
  const song=g.SONG;song.have=4;
  const parts=()=>JSON.stringify(['strum','pick'].map(id=>Array.from({length:16*16},(_,i)=>g.LAYERS.guitar.find(l=>l.id===id).steps(g.chordAt(i>>4),i&15,i>>4,1).map(e=>[e.midi,e.dir]))));
  const before=parts();
  g.directorStep(5*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([]),'no boss, no climax');
  const boss=g.addMob('boss1',0,0);
  g.directorStep(5*16+1);assert.equal(JSON.stringify(song.climax),JSON.stringify([]),'decisions are made on the first step of a bar');
  g.directorStep(5*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([[8,null]]),'a boss in bar 5 → climax from the next 4-bar boundary (bar 8)');
  g.directorStep(6*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([[8,null]]),'no duplicate');
  assert.notEqual(g.sectionAt(7).id,'climax');for(const b of [8,9,15,20])assert.equal(g.sectionAt(b).id,'climax','bar '+b);
  boss.hp=0;g.G.mobs=g.G.mobs.filter(m=>m!==boss);
  g.directorStep(10*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([[8,12]]),'boss down in bar 10 → back to the form from bar 12');
  assert.equal(g.sectionAt(11).id,'climax');assert.notEqual(g.sectionAt(12).id,'climax');
  const guest=JSON.parse(JSON.stringify(song));
  for(let b=0;b<40;b++)assert.equal(JSON.stringify(g.sectionAt(b,guest)),JSON.stringify(g.sectionAt(b)),'a guest copy of the song agrees on bar '+b);
  assert.equal(parts(),before,'the climax never changes which notes the player parts play');
  const b2=g.addMob('boss1',0,0);g.directorStep(13*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([[8,12],[16,null]]));
  b2.hp=0;g.G.mobs=g.G.mobs.filter(m=>m!==b2);g.directorStep(14*16);assert.equal(JSON.stringify(song.climax),JSON.stringify([[8,12]]),'withdrawn before it started');
  // арранжування: кульмінація більша за куплет; перед приспівом — брейк барабанів; брейк — стоп-тайм; крэш на початку приспіву
  const count=(bar,drum)=>Array.from({length:16},(_,st)=>g.backingEvents(bar,st).filter(e=>e.drum===drum).length).reduce((a,b)=>a+b,0);
  assert.ok(count(8,'kick')>count(5,'kick'),'climax kicks more than a verse');
  assert.ok(count(15,'snare')>=5,'the bar before the chorus is a snare fill');
  const stop=Array.from({length:16},(_,st)=>g.backingEvents(24,st).length);assert.ok(stop[0]>0&&stop.slice(1).every(n=>n===0),'break: stop-time, only the downbeat sounds');
  assert.ok(g.backingEvents(16,0).some(e=>e.drum==='crash'),'crash on the first beat of a chorus');
  assert.deepEqual(s.errors,[]);
});

test('backing plays the whole progression from the start; the player part follows only the collected chords, and clashes are quieter',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const genre of ['pop','rock','jazz','blues','funk']){
    const song=g.makeSong(null,genre);song.have=1;g.setSong(song);
    const full=bar=>g.genreExpansion.chordAt(song,bar,true)||song.prog[bar%4];
    const bars=genre==='blues'?[4,5,8,10]:[4,5,6,7],all=bar=>Array.from({length:16},(_,st)=>g.backingEvents(bar,st)).flat();
    assert.equal(g.chordAt(5),g.chordAt(4),genre+': the player still has a single chord');
    let moved=0;
    for(const bar of bars){
      const evs=all(bar);
      for(const e of evs.filter(e=>e.kind==='bass'||e.kind==='chord'))assert.ok(full(bar).pcs.includes(e.midi%12),genre+' bar '+bar+' '+e.kind+' follows the full progression');
      if(full(bar).root!==g.chordAt(bar).root&&evs.some(e=>e.kind==='bass'&&e.midi%12===full(bar).root))moved++;
      for(const e of evs.filter(e=>e.kind==='hook'))assert.ok(g.chordAt(bar).pcs.includes(e.midi%12),genre+' the backing melody stays in the player chord');
    }
    assert.ok(moved>=1,genre+' the backing bass moves with the full progression while the player holds one chord');
    const top=(bar,kind)=>Math.max(0,...all(bar).filter(e=>e.kind===kind).map(e=>e.vel)),compat=b=>g.chordAt(b).pcs.every(x=>full(b).pcs.includes(x)),diff=bars.find(b=>!compat(b)),same=bars.find(compat);
    // «розбіжність» — коли акорд гравця не міститься в акорді фону (I і vi мають спільні ноти й не б'ються)
    if(diff!==undefined&&same!==undefined&&top(same,'chord')>0&&top(diff,'chord')>0){
      assert.ok(top(diff,'chord')<top(same,'chord')*.7,genre+' chords are quieter when they differ from the player harmony');
      assert.ok(top(diff,'bass')<top(same,'bass')||top(same,'bass')===0,genre+' bass is a little quieter when it differs');
    }
    song.have=4;for(const b of bars)assert.equal(g.chordAt(b),full(b),genre+' collected: the player joins the full progression');
  }
  assert.deepEqual(s.errors,[]);
});

test('the phrase that sounds changes pitch and placement, but flute and sax parts stay within 25% of the same damage per two bars',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  for(const genre of Object.keys(g.GENRES))for(let seed=1;seed<=4;seed++){
    const song=g.makeSong(null,genre,{seed,key:seed});song.have=4;g.setSong(song);
    for(const [inst,id] of [['flute','melody'],['sax','riff'],['flute','pulse'],['sax','pulse']]){
      const Ly=g.LAYERS[inst].find(l=>l.id===id),weigh=b0=>{let tot=0;for(let b=b0;b<b0+2;b++)for(let st=0;st<16;st++)for(const e of Ly.steps(g.chordAt(b),st,b,1))tot+=g.instrumentExpansion.noteWeight(e);return tot;};
      const ws=[0,6,12,16].map(weigh); // A, A′, B, A″ (за секціями: вступ, куплет, наростання, приспів)
      assert.ok(Math.max(...ws)/Math.min(...ws)<1.25,genre+' '+inst+'/'+id+' weight per phrase '+ws.join('/'));
    }
  }
  assert.deepEqual(s.errors,[]);
});

test('level → rhythm: L1–2 pattern 1, L3–4 pattern 2, L5 pattern 3; normalized damage per second follows only lv(L)',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  assert.equal(JSON.stringify([1,2,3,4,5].map(g.patOf)),'[1,1,2,2,3]');
  let differs=0,checked=0;
  for(const genre of Object.keys(g.GENRES)){
    const song=g.makeSong(null,genre);g.setSong(song);
    for(const inst of Object.keys(g.LAYERS)){
      g.setChar(inst);const bal=g.balanceTable();
      for(const Ly of g.LAYERS[inst]){
        const hps=[1,2,3].map(p=>g.hitsPerSec(genre,song.bpm,Ly,p)),dps=hps.map((h,i)=>h*bal[Ly.id][i]);
        if(hps.every(h=>h>0)){for(let i=1;i<3;i++)assert.ok(Math.abs(dps[i]-dps[0])<dps[0]*1e-6,genre+'/'+inst+'/'+Ly.id+' normalized DPS is the same at every pattern');checked++;}
        const bars=genre==='blues'?12:8,play=L=>JSON.stringify(Array.from({length:bars*16},(_,i)=>Ly.steps(g.chordAt(i>>4),i&15,i>>4,L).map(e=>[e.midi,e.drum,e.dir])));
        assert.equal(play(1),play(2),genre+'/'+Ly.id+' L1=L2');assert.equal(play(3),play(4),genre+'/'+Ly.id+' L3=L4');
        if(play(1)!==play(3)||play(3)!==play(5))differs++;
      }
    }
  }
  assert.ok(checked>800,'checked '+checked+' layers');assert.ok(differs>100,'many parts really change rhythm with the level ('+differs+')');
  // реальний підрахунок ударів «вагою 1» на кожному рівні × коефіцієнт балансу рисунка, який діє на цьому рівні (P(L)) — не алгебра таблиці
  for(const genre of ['pop','rock','metal','lofi','reggae']){
    const song=g.makeSong(null,genre);g.setSong(song);const bars=8,sec=bars*16*60/song.bpm/4;
    for(const [inst,id] of [['bass','walk'],['bass','octave'],['bass','groove'],['piano','left'],['piano','stab'],['drums','rim'],['drums','kick'],['drums','crash']]){
      g.setChar(inst);const bal=g.balanceTable(),Ly=g.LAYERS[inst].find(l=>l.id===id);
      const dps=L=>{let n=0;for(let b=0;b<bars;b++)for(let st=0;st<16;st++)n+=Ly.steps(g.chordAt(b),st,b,L).length>0?1:0;return n/sec*bal[id][g.P(L)-1];};
      for(let L=2;L<=5;L++)assert.ok(Math.abs(dps(L)-dps(1))<dps(1)*1e-6,genre+'/'+id+' damage per second at L'+L+' is the same before the lv(L) multiplier');
    }
  }
  for(const genre of ['pop','rock','metal']){
    const song=g.makeSong(null,genre);g.setSong(song);g.setChar('guitar');const strum=g.LAYERS.guitar.find(l=>l.id==='strum');
    const hits=L=>Array.from({length:16},(_,st)=>strum.steps(g.chordAt(0),st,0,L).length>0?1:0).reduce((a,b)=>a+b,0);
    assert.ok(hits(1)<hits(3)&&hits(3)<=hits(5),genre+' strum gets denser with the level: '+[1,3,5].map(hits));
  }
  assert.deepEqual(s.errors,[]);
});

test('Driving Rock: a fast major genre with eighth-note drive, snare on 2 and 4 with fills, and a beat in every part',t=>{
  const s=session('http://127.0.0.1:8080');t.after(()=>s.close());const g=s.game;
  const G=g.GENRES.rockfast;assert.ok(G,'rockfast exists');assert.equal(G.mode,'major');assert.ok(G.bpm[0]>=135&&G.bpm[1]<=150);
  for(const lang of ['en','de','ru'])assert.ok(s.dictionary[lang]['Драйвовий рок'],lang+' name');
  const song=g.makeSong(null,'rockfast');song.have=4;g.setSong(song);
  assert.ok(song.bpm>=135&&song.bpm<=150);assert.equal(song.mode,'major');assert.equal(song.prog.length,4);
  const at=(inst,id,bar,st,L=1)=>g.LAYERS[inst].find(l=>l.id===id).steps(g.chordAt(bar),st,bar,L),steps=(inst,id,bar)=>[...Array(16).keys()].filter(st=>at(inst,id,bar,st).length);
  for(let bar=0;bar<4;bar++){
    assert.deepEqual(steps('bass','root',bar),[0,2,4,6,8,10,12,14],'bass drives in eighths');
    assert.deepEqual(steps('drums','hat',bar),[0,2,4,6,8,10,12,14],'eighth hats');
    const sn=steps('drums','snare',bar);assert.ok(sn.includes(4)&&sn.includes(12),'snare on 2 and 4');
    if(bar===3)assert.ok(sn.length>2,'the snare fills the last bar of the phrase');else assert.deepEqual(sn,[4,12]);
  }
  for(const inst of ['guitar','drums','bass','piano','flute','violin','sax','accordion'])for(const Ly of g.LAYERS[inst]){
    let n=0;for(let bar=0;bar<8;bar++)for(let st=0;st<16;st++)n+=Ly.steps(g.chordAt(bar),st,bar,1).length;assert.ok(n>0,inst+'/'+Ly.id+' has a beat in rockfast (never a drone)');
  }
  const be=Array.from({length:64},(_,i)=>g.backingEvents(i>>4,i&15)).flat();
  assert.deepEqual([...new Set(be.map(e=>e.kind))].sort(),['bass','chord','drum','hook'],'the backing has the whole band');
  assert.deepEqual(s.errors,[]);
});

test('mobile: viewport meta, screen sound controls mute the final gain only', async t => {
  const html = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
  const vp = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
  assert.ok(/width=device-width/.test(vp) && /initial-scale=1/.test(vp) && /viewport-fit=cover/.test(vp));
  assert.ok(/id="mute"/.test(html) && /id="vol"/.test(html));
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  await s.game.pick('guitar');
  const u = () => s.game.userSound;
  assert.ok(u().gain, 'user gain node exists after audio init');
  const master = s.game.masterReact.master.gain.value;
  s.game.setUserSound(1, true); assert.equal(u().gain.gain.value, 0);
  s.game.setUserSound(.5, false); assert.equal(u().gain.gain.value, .25);
  assert.equal(s.game.masterReact.master.gain.value, master, 'master gain untouched');
  assert.deepEqual(s.errors, []);
});

// ---- тюнінг SF2, баланс рівнів героїв, рух висоти в стартових партіях ----
test('SF2 renders are in tune: sustained A4 within ±3 cents, staccato tenor sax onset corrected across its whole range', () => {
  require('./assets/sf2-bank.js');
  const raw = fs.readFileSync(path.join(__dirname, 'assets/soundfonts/A320U.sf2'));
  const bank = globalThis.SF2Bank.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)), sr = 44100;
  const cents = (f, hz) => 1200 * Math.log2(f / hz);
  const dft = (d, hz, from, to) => { // піки спектра з кроком 0.04% — точніше за автокореляцію на довгому вікні
    let best = 0, bf = hz; const a = Math.floor(sr * from), z = Math.floor(sr * to);
    for (let f = hz * .97; f <= hz * 1.03; f += hz * .0004) { let re = 0, im = 0; const w = 2 * Math.PI * f / sr;
      for (let i = a; i < z; i++) { const h = .5 - .5 * Math.cos(2 * Math.PI * (i - a) / (z - a)); re += d[i] * h * Math.cos(w * i); im += d[i] * h * Math.sin(w * i); }
      if (re * re + im * im > best) { best = re * re + im * im; bf = f; } }
    return bf;
  };
  const acorr = (d, hz, from, to) => { // середня висота короткого вікна (як у стакато-нотах гри)
    const a = Math.floor(sr * from), w = Math.floor(sr * (to - from)), ac = L => { let c = 0; for (let i = a; i < a + w && i + L < d.length; i++) c += d[i] * d[i + L]; return c; };
    let bl = 0, best = -Infinity; for (let L = Math.floor(sr / hz * .93); L <= Math.ceil(sr / hz * 1.07); L++) { const c = ac(L); if (c > best) { best = c; bl = L; } }
    const p = ac(bl - 1), m = ac(bl), n = ac(bl + 1); return sr / (bl + .5 * (p - n) / (p - 2 * m + n));
  };
  for (const [name, program, key] of [['tenor_sax', 66, 69], ['flute', 73, 69], ['bass', 33, 57], ['piano', 0, 69]]) {
    const hz = 440 * Math.pow(2, (key - 69) / 12), d = bank.render(0, program, key, { sampleRate: sr, seconds: 1.6 });
    const c = cents(dft(d, hz, .3, 1.3), hz); assert.ok(Math.abs(c) <= 3, name + ' sustained pitch ' + c.toFixed(1) + ' cents');
  }
  // 75 мс стакато-нота сакса звучить лише в «плавучому» початку семпла: до виправлення середня висота на всьому діапазоні ≈ -10…-15 центів
  const early = (opt, key, from, to) => { const hz = 440 * Math.pow(2, (key - 69) / 12); return cents(acorr(bank.render(0, 66, key, { sampleRate: sr, seconds: .4, ...opt }), hz, from, to), hz); };
  const mean = opt => { let sum = 0, n = 0; for (let key = 58; key <= 73; key++) { sum += early(opt, key, .01, .075); n++; } return sum / n; };
  const fixed = mean({}), plain = mean({ pitchFix: false });
  assert.ok(plain < -8, 'the raw A320U tenor sax starts flat: ' + plain.toFixed(1) + ' cents');
  assert.ok(Math.abs(fixed) <= 5, 'a staccato sax note is in tune (58…73): ' + fixed.toFixed(1) + ' cents');
  for (const key of [74, 75, 76]) { const a = early({}, key, .03, .09), b = early({ pitchFix: false }, key, .03, .09); assert.ok(a > b + 6 && Math.abs(a) <= 6, 'top zone ' + key + ' corrected too: ' + b.toFixed(1) + ' -> ' + a.toFixed(1)); }
});

test('hero bus levels: per-instrument gains bring every starter part into one window', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close()); const g = s.game;
  const OLD = { guitar: .95, bass: .95, piano: .85, drums: .9, flute: .95, violin: .95, sax: .9, accordion: .9 };
  const MEASURED = { bass: -10.9, guitar: -12.3, drums: -17.5, piano: -18.8, violin: -25.2, flute: -29.1, sax: -30.4, accordion: -32.4 }; // RMS шини, дБFS, до змін
  const SILENCE = { bass: 0, guitar: 0, drums: 0, piano: 0, violin: .45, flute: .62, sax: .76, accordion: .43 }; // частка тиші у 16 с партії
  assert.deepEqual({ ...g.MIX }, { guitar: .62, bass: .53, piano: 1.05, drums: .9, flute: 2.4, violin: 2.15, sax: 2.4, accordion: 2.6 }, 'pinned gain table');
  const now = Object.fromEntries(Object.keys(OLD).map(k => [k, MEASURED[k] + 20 * Math.log10(g.MIX[k] / OLD[k])])); // шина лінійна (компресор ratio 1)
  const active = Object.fromEntries(Object.keys(now).map(k => [k, now[k] - 10 * Math.log10(1 - SILENCE[k])]));
  const spread = o => Math.max(...Object.values(o)) - Math.min(...Object.values(o));
  assert.ok(spread(now) <= 7.5 && Math.min(...Object.values(now)) >= -24 && Math.max(...Object.values(now)) <= -15, 'bus RMS window: ' + JSON.stringify(now));
  const lead = Object.entries(active).filter(([k]) => k !== 'drums').map(([, v]) => v);
  assert.ok(Math.max(...lead) - Math.min(...lead) <= 6 && Math.min(...lead) >= -21.5 && Math.max(...lead) <= -14, 'active-note levels within about ±3 dB (flute/accordion trimmed ~2 dB to keep loud chords out of the master limiter): ' + JSON.stringify(active));
  const before = Object.fromEntries(Object.keys(OLD).map(k => [k, MEASURED[k] - 10 * Math.log10(1 - SILENCE[k])]));
  assert.ok(spread(active) < spread(before) / 2, 'spread at least halved');
  // піки: типова гучна нота (vel .75) × CFG.gain × пік семпла (розширені інструменти вирівняні levelTrim до ≤.8) × MIX × master .42 лишається під лімітером master (-2 дБ)
  for (const k of Object.keys(OLD)) { if (k === 'drums') continue; const peak = .75 * g.CFG[k].gain * (['flute', 'violin', 'sax', 'accordion'].includes(k) ? .8 : .9) * g.MIX[k] * .42; assert.ok(peak < .794, k + ' single-note peak ' + peak.toFixed(2)); }
});

test('starter parts over one chord keep their attacks but walk through the chord (no drone), deterministically', async t => {
  const s = session('http://127.0.0.1:8080'); t.after(() => s.close()); const g = s.game;
  await g.pick('flute'); g.setPause(true);
  const voiceOf = (inst, bars) => { // голос, що має рухатись: бас акорду в гітари, верхній голос у піаніно, весь звук в інших
    const pick = { guitar: a => Math.min(...a), piano: a => Math.max(...a) }[inst] || (a => a[0]);
    return new Set(bars.flatMap(b => b.filter(a => a.length).map(pick)));
  };
  for (let round = 0; round < 12; round++) for (const genre of Object.keys(g.GENRES)) {
    const song = g.makeSong(null, genre); g.setSong(song); assert.equal(song.have, 1);
    for (const inst of ['guitar', 'bass', 'piano', 'violin', 'flute', 'sax', 'accordion']) {
      const part = g.LAYERS[inst][0], play = bar => Array.from({ length: 16 }, (_, st) => part.steps(g.chordAt(bar), st, bar, 1).filter(e => !e.orn).map(e => e.midi));
      for (const bars of [[0, 1], [2, 3], [4, 5]]) {
        const all = new Set(bars.flatMap(b => play(b).flat()));
        assert.ok(all.size >= 3, genre + '/' + inst + ' bars ' + bars + ' use ' + all.size + ' pitches');
        const voice = voiceOf(inst, bars.map(play));
        assert.ok(voice.size >= 3, genre + '/' + inst + ' moving voice has ' + voice.size + ' pitches in bars ' + bars);
      }
      assert.deepEqual(play(0), play(0), genre + '/' + inst + ' is deterministic');
      assert.deepEqual(play(2).map(a => a.length > 0), play(0).map(a => a.length > 0), genre + '/' + inst + ' same attack steps in every bar');
      if (['guitar', 'bass', 'piano', 'violin'].includes(inst)) for (const m of play(0).flat()) assert.ok(song.prog[0].pcs.includes(m % 12), genre + '/' + inst + ' stays on the unlocked chord');
    }
  }
  assert.deepEqual(s.errors, []);
});

/* ================= ГІСТЬ ЗА ПОВІЛЬНИМ ПРОКСІ: черга в проксі не має робити знімки «старими» ================= */
// Проксі читає з сервера миттєво (тож сокет сервера ніколи не бачить черги), а гостю тягне ~rate Б/с і зрідка «зависає»: так поводиться мобільна мережа за Render/Cloudflare.
function trickleProxy(t, port, { rate = 80000, stallEvery = 4000, stallMs = 300 } = {}) {
  const net = require('node:net'), box = { on: false, queued: 0, sent: 0, conns: [] };
  const srv = net.createServer(client => {
    const up = net.connect({ port, host: '127.0.0.1' }), q = []; let stallUntil = 0, nextStall = Date.now() + stallEvery;
    box.conns.push(client, up); client.on('error', () => {}); up.on('error', () => {});
    client.on('data', b => up.write(b)); up.on('data', b => { if (!box.on && !q.length) { client.write(b); return; } q.push(b); box.queued += b.length; });
    client.on('close', () => up.destroy()); up.on('close', () => client.destroy());
    const timer = setInterval(() => {
      if (!box.on && !q.length) return;
      const n = Date.now(); if (n >= nextStall) { stallUntil = n + stallMs; nextStall = n + stallEvery; } if (n < stallUntil) return;
      let budget = rate / 50; while (budget > 0 && q.length) { const b = q[0], part = b.subarray(0, budget); q[0] = b.subarray(part.length); if (!q[0].length) q.shift(); budget -= part.length; box.queued -= part.length; box.sent += part.length; client.write(part); }
    }, 20);
    client.on('close', () => clearInterval(timer));
  });
  t.after(() => { box.conns.forEach(c => c.destroy()); srv.close(); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => { box.origin = 'http://127.0.0.1:' + srv.address().port; r(box); }));
}
// гість із повільною лінією: хост напряму, гість через проксі; повертає вимірювач віку знімка в момент прийому
async function slowGuestBand(t, srv, proxyOpts) {
  const proxy = await trickleProxy(t, srv.port, proxyOpts);
  const a = session(srv.origin, true); t.after(() => a.close());
  await a.click('#multiplayer'); await until(() => a.game.net.id, 'host welcome');
  const b = session(roomUrl(proxy.origin, a), true); t.after(() => b.close());
  await b.click('#multiplayer'); await until(() => b.game.net.id, 'guest welcome');
  await a.pick('guitar'); await b.pick('drums'); await until(() => a.game.net.roster.every(p => p.char), 'picks');
  await a.click('#ready'); await b.click('#ready'); await until(() => a.game.net.roster.every(p => p.ready), 'ready');
  await a.click('#start-band'); await until(() => a.game.running && b.game.running, 'both playing');
  const ws = b.game.net.ws, h = ws.onmessage, ages = [], arrivals = [], bytes = [];
  ws.onmessage = e => { if (e.data.length > 200 && e.data.includes('"k":"state"')) { const d = JSON.parse(e.data).d; if (d && d.k === 'state') { const n = performance.now(); ages.push(n - d.ts); arrivals.push(n); bytes.push(e.data.length); } } return h(e); };
  return { a, b, proxy, ages, arrivals, bytes };
}
const pct = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };

test('a guest behind a slow proxy sees fresh snapshots: age stays bounded while the proxy queue is throttled', async t => {
  const srv = await startServer(t), { a, b, proxy, ages, arrivals, bytes } = await slowGuestBand(t, srv);
  const H = a.game.G; for (const p of H.players) p.p.hp = p.p.max = 1e9;
  // пізня гра: ~150 живих ворогів поруч (кого герої добили — доповнюємо; живучі, щоб не гинули), трохи побиті й частково «спалахують»
  const types = Object.keys(a.game.MOBS).filter(k => !/^boss/.test(k)); let n = 0;
  const fill = () => { while (H.mobs.length < 150) { const m = a.game.addMob(types[n++ % types.length], H.players[0].p.x + 200 + (n % 15) * 40, H.players[0].p.y + 200 + (n / 15 % 10 | 0) * 40); m.spd = 0; m.max = 3000; m.hp = 3000 - 0.37 * (n % 5); m.flash = 0.05 * (n % 2); } };
  fill(); const refill = setInterval(fill, 50); t.after(() => clearInterval(refill));
  await delay(500);  proxy.on = true; ages.length = 0; arrivals.length = 0; bytes.length = 0;
  await delay(12000);
  const gaps = arrivals.slice(1).map((x, i) => x - arrivals[i]), kb = bytes.length ? bytes.reduce((x, y) => x + y, 0) / bytes.length / 1024 : 0;
  if (process.env.AGES) console.log(ages.map((x, i) => Math.round(x) + "@" + Math.round(arrivals[i] - arrivals[0])).join(" "));
  console.log(`  slow proxy: snapshots ${ages.length}, ${kb.toFixed(1)} KB avg, mobs ${H.mobs.length}, age max ${Math.round(Math.max(0, ...ages))} p95 ${Math.round(pct(ages, .95))} ms, max gap ${Math.round(Math.max(0, ...gaps))} ms, ip.lost ${b.game.net.ip.lost}, proxy queued ${(proxy.queued / 1024).toFixed(0)} KB`);
  assert.ok(ages.length > 20, 'guest keeps receiving snapshots');
  assert.ok(pct(ages, .95) < 700, 'p95 snapshot age < 700 ms (before flow control: ~8 s and growing), got ' + Math.round(pct(ages, .95)));
  assert.ok(Math.max(...gaps) < 1500 && Math.max(...ages) < 1500, 'no multi-second freezes, age never grows without bound');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('mobs ride the wire as compact positional arrays and unpack to the same fields on the guest', async t => {
  const srv = await startServer(t); const [a, b] = await bandOfTwo(t, srv.origin);
  const G = a.game.G, g = a.game, types = Object.keys(g.MOBS).filter(k => !/^boss/.test(k));
  G.mobs = []; for (let i = 0; i < 150; i++) { const m = g.addMob(types[i % types.length], 100 + i * 7.3137, -50 + i * 3.1); m.hp = m.max * (i % 3 ? 1 : 0.43); m.flash = i % 4 ? 0 : 0.07; m.hc = i % 5 ? 0 : 2; if (i % 9 === 0) { m.mode = 'wind'; m.ax = 0.6; m.ay = -0.8; } m.netId = i + 1; }
  // еталон: старий формат (об’єкт на ворога з назвами полів)
  const W = ['netId', 'type', 'x', 'y', 'r', 'hp', 'max', 'flash', 'wob', 'stun', 'slow', 'burn', 'mode', 'ax', 'ay', 'gen', 'age', 'hc', 'cast'];
  const oldMobs = G.mobs.map(m => { const o = {}; for (const k of W) { const v = m[k]; if (v === undefined || (v === 0 && k !== 'x' && k !== 'y')) continue; if (k === 'r' && g.MOBS[m.type] && v === g.MOBS[m.type].r) continue; if (k === 'max' && Math.round(m.max * 100) === Math.round(m.hp * 100)) continue; o[k] = v; } return o; });
  const oldSize = JSON.stringify(JSON.parse(JSON.stringify(oldMobs), (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v)).length;
  const wire = g.cleanState().mobs, size = JSON.stringify(wire).length;
  console.log(`  mobs payload: ${(oldSize / 1024).toFixed(1)} KB -> ${(size / 1024).toFixed(1)} KB for ${wire.length} mobs (${(oldSize / size).toFixed(2)}x)`);
  assert.ok(Array.isArray(wire[0]), 'positional arrays'); assert.ok(size * 2 <= oldSize, 'at least 2x smaller than named-field objects');
  const un = { mobs: JSON.parse(JSON.stringify(wire)) }; b.game.unpackMobs(un);
  un.mobs.forEach((o, i) => { const m = G.mobs[i]; assert.equal(o.netId, m.netId); assert.equal(o.type, m.type); assert.ok(Math.abs(o.x - m.x) <= 0.5 && Math.abs(o.y - m.y) <= 0.5);
    const t1 = v => Math.max(.1, Math.round(v * 10) / 10); assert.ok(o.hp > 0 && Math.abs(o.hp - m.hp) <= .06, 'hp survives to a tenth'); assert.ok(Math.abs((o.max === undefined ? o.hp : o.max) - m.max) <= .06 || Math.round(m.max * 100) === Math.round(m.hp * 100), 'max is restored');
    assert.equal(o.flash || 0, Math.round((m.flash || 0) * 100) / 100); assert.equal(o.hc || 0, m.hc || 0); assert.equal(o.mode || 0, m.mode || 0); assert.equal(o.ax || 0, Math.round((m.ax || 0) * 100) / 100); });
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

/* ================= ПІДСУМОК ЗАБІГУ ТА КАРТКИ НОТ ================= */
const stripTags = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const killMob = async (g, type, by) => {
  g.addMob(type, g.G.p.x + 80, g.G.p.y, { age: 5 }); const m = g.G.mobs.filter(x => x.type === type).pop();
  const hit = () => g.hurtMob(m, 5, 0, 0); if (by) g.withPlayer(by, hit); else hit();
  m.hp = 0; await until(() => !g.G.mobs.includes(m), type + ' dies'); return m;
};

test('run summary: solo game over shows time, level, kills, bosses, damage and the build', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G;
  G.mobs = []; G.p.hp = G.p.max; G.t = 125; G.level = 7;
  const lv0 = G.level; await killMob(g, 'fal'); await killMob(g, 'boss1'); await takeBossReward([s], lv0); G.p.hp = G.p.max; G.pedals = {};
  assert.equal(G.level, 8, 'the boss reward is one free level'); G.level = 7; // далі рахуємо підсумок на рівні 7 без картки нагороди
  assert.equal(G.bosses, 1, 'boss kill is counted'); assert.equal(G.kills, 2); assert.ok(G.dmgTotal > 0, 'damage dealt is counted');
  const pedal = g.PEDALS.find(p => p.inst === 'guitar'); G.pedals[pedal.id] = 2;
  G.mobs = []; G.p.hp = 0; await until(() => !g.running, 'game over');
  const r = g.runRecap();
  assert.equal(r.time, 125); assert.equal(r.level, 7); assert.equal(r.kills, 2); assert.equal(r.bosses, 1); assert.ok(r.dmg > 0);
  assert.equal(r.players.length, 1); assert.equal(r.players[0].char, 'guitar');
  assert.ok(r.players[0].parts.length >= 1 && r.players[0].parts.every(x => x.lvl >= 1), 'held parts with levels');
  assert.equal(JSON.stringify(r.players[0].gear.map(x => [x.id, x.lvl])), JSON.stringify([[pedal.id, 2]]), 'gear with levels');
  assert.equal(r.song.have, g.SONG.have || g.SONG.prog.length); assert.equal(r.song.chords.length, r.song.have); assert.equal(r.song.genre, g.GENRES.pop.name);
  const text = stripTags(s.elements.get('#recap').innerHTML);
  assert.ok(text.includes('2:05'), 'time survived'); assert.ok(text.includes(g.GENRES.pop.name)); assert.ok(text.includes(pedal.name) || /class="hic" title="[^"]*"/.test(s.elements.get('#recap').innerHTML));
  for (const c of r.song.chords) assert.ok(text.includes(c.name), 'chord ' + c.name);
  assert.ok(/class="hic"/.test(s.elements.get('#recap').innerHTML), 'pixel icons are reused');
  assert.equal(s.elements.get('#over').classList.contains('hide'), false);
  for (const w of ['Час', 'Рівень', 'Вороги', 'Боси']) for (const lang of ['en', 'de', 'ru']) assert.ok(dictionary[lang][w], lang + ': ' + w);
  assert.deepEqual(s.errors, []);
});

test('run summary: in co-op the guest sees the same recap with a row per player', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const host = a.game, guest = b.game, H = host.G;
  H.mobs = []; H.level = 60; for (const p of H.players) p.p.hp = p.p.max; // високий рівень: кристали босів не дадуть нового рівня
  const [hp, gp] = [H.players.find(p => p.id === host.net.id), H.players.find(p => p.id === guest.net.id)];
  await killMob(host, 'fal', hp); await killMob(host, 'fal', gp); const lv0 = H.level; await killMob(host, 'boss1', gp); await takeBossReward([a, b], lv0); H.level = 60;
  for (const p of H.players) p.p.hp = p.p.max;
  assert.equal(gp.st.kills, 2); assert.equal(hp.st.kills, 1); assert.equal(H.bosses, 1); assert.ok(gp.st.dmg > 0 && hp.st.dmg > 0);
  H.t = 61; H.level = 4; H.xp = 0; H.gems = []; H.mobs = []; for (const p of H.players) p.p.hp = 0; // без кристалів: рівень воскресив би загиблих
  await until(() => !host.running, 'host ends'); await until(() => !guest.running, 'guest stops: ' + host.running + guest.G.players.map(p => p.p.hp)); await until(() => !b.elements.get('#over').classList.contains('hide'), 'guest sees the screen');
  await until(() => guest.G.bosses === 1 && guest.G.players.every(p => p.st), 'guest has the final counters');
  const norm = r => ({ ...r, players: r.players.map(({ you, ...q }) => q) });
  const hr = host.runRecap(), gr = guest.runRecap();
  assert.equal(JSON.stringify(norm(gr)), JSON.stringify(norm(hr)), 'the guest recap equals the host recap');
  assert.equal(gr.players.length, 2); assert.equal(gr.bosses, 1); assert.equal(gr.kills, 3); assert.equal(gr.time, 61); assert.equal(gr.level, 4);
  assert.equal(gr.players.map(q => q.char).sort().join(), 'drums,guitar');
  assert.equal(gr.players.find(q => q.you).kills, 2, 'the guest row is his own');
  const html = b.elements.get('#recap').innerHTML;
  assert.equal((html.match(/class="rp"/g) || []).length, 2, 'a row per player'); assert.ok(stripTags(html).includes('☠ 2'), 'per-player kills');
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('note cards say how far the note takes the next chord', async t => {
  const s = session('http://127.0.0.1:8080', true); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, song = g.SONG;
  const slot = song.have, need = g.chordTones(slot, 1).length;
  for (let k = 1; k <= need; k++) {
    const card = g.noteCards().find(o => o.lvl === 1); assert.ok(card && card.slot === slot);
    const text = g.noteCardText(card);
    assert.ok(text.includes(`${k}/${need}`), 'progress ' + k + '/' + need + ': ' + text);
    assert.ok(text.includes(song.prog[slot].name), 'names the chord: ' + text);
    assert.ok(k < need ? !text.includes('долучиться') : text.includes('долучиться до пісні'), text);
    g.applyUpgrade(card);
  }
  assert.equal(song.have, slot + 1, 'the chord joined the song');
  for (const key of ['Нота {0} — {1}/{2} до акорду {3} (такт {4} з 4).', 'Нота {0} — {1}/{2} до акорду {3}: остання, акорд долучиться до пісні (такт {4} з 4).'])
    for (const lang of ['en', 'de', 'ru']) assert.ok(dictionary[lang][key], lang + ' translation');
  assert.deepEqual(s.errors, []);
});

const memoryStore = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; };
const hintsRun = async (t, store, char = 'guitar') => { const s = session('http://127.0.0.1:8080', false, { localStorage: store }); t.after(() => s.close()); await s.game.pick(char); return s; };

test('first-run hints: start, gem, level-up, note and boss each show once and the flag persists', async t => {
  const store = memoryStore(), s = await hintsRun(t, store), g = s.game, h = g.hints, banner = { classList: { contains: c => s.elements.get('#hint').classList.contains(c) } };
  assert.ok(h.on); assert.ok(g.running);
  g.G.t = 1; h.tick(); assert.equal(h.current, 'start');
  assert.match(h.text, /Атакуєш автоматично/); assert.ok(!banner.classList.contains('hide'), 'banner visible, game not paused');
  assert.equal(g.paused, false); assert.equal(g.choosing, false);
  h.tick(); assert.equal(h.current, 'start', 'one hint at a time');
  h.expire(); h.tick(); assert.equal(h.current, null); assert.ok(banner.classList.contains('hide'), 'auto-hides');
  g.G.gems.push({ x: g.G.p.x + 100, y: g.G.p.y, v: 1, mag: false }); g.G.t = 4; h.tick();
  assert.equal(h.current, 'gem'); assert.match(h.text, /кристали/); h.expire(); h.tick();
  // екран вибору: додатковий рядок лише вперше
  g.G.t = 10; g.G.xp = g.need(g.G.level); g.levelUp();
  if (g.choosing) { assert.ok(!s.elements.get('#lvl-hint').classList.contains('hide')); await s.elements.get('#opts').children[0].onclick(); }
  assert.ok(h.seen.includes('level') || !g.choosing, 'level hint is marked seen');
  g.applyUpgrade(g.noteCards()[0]); h.want('note'); g.G.t = 11; h.tick();
  assert.equal(h.current, 'note'); assert.match(h.text, /акорди/); h.expire(); h.tick();
  g.G.t = 290; g.G.bossNext = 0; h.tick(); assert.equal(h.current, 'boss'); assert.equal(h.text, 'Скоро бос!'); h.expire(); h.tick();
  for (const k of ['start', 'gem', 'note', 'boss']) assert.ok(h.seen.includes(k), k);
  for (let i = 0; i < 3; i++) { g.G.t = 291 + i; h.tick(); assert.equal(h.current, null, 'no repeats'); h.expire(); }
  assert.match(store.m.get('bandhero.hintsSeen'), /start/); assert.equal(store.m.get('bandhero.hints'), '1');
  assert.deepEqual(s.errors, []);
  // новий забіг у новій сторінці з тим самим сховищем: підказки вже не показуються
  const s2 = await hintsRun(t, store); s2.game.G.t = 1; s2.game.hints.tick(); assert.equal(s2.game.hints.current, null);
  // скидання повертає їх
  s2.game.hints.reset(); s2.game.G.t = 1; s2.game.hints.tick(); assert.equal(s2.game.hints.current, 'start');
  assert.deepEqual(s2.errors, []);
});

test('first-run hints: the level-up screen explains the cards once and the menu toggle/reset work', async t => {
  const store = memoryStore(), s = await hintsRun(t, store), g = s.game, lvl = { get textContent() { return s.elements.get('#lvl-hint').textContent; }, classList: { contains: c => s.elements.get('#lvl-hint').classList.contains(c) } };
  assert.equal(s.elements.get('#hints-toggle').textContent, 'Підказки: увімк');
  g.G.t = 20; g.G.xp = g.need(g.G.level); g.levelUp();
  if (g.choosing) { assert.ok(!lvl.classList.contains('hide')); assert.match(lvl.textContent, /Q \/ E/); assert.match(lvl.textContent, /ноти/); assert.ok(g.hints.seen.includes('level')); await s.elements.get('#opts').children[0].onclick(); }
  else assert.ok(g.hints.seen.includes('level') === false, 'auto-level skips the card screen');
  // вимкнення з меню гасить усе й запам’ятовується
  await s.click('#hints-toggle'); assert.equal(g.hints.on, false); assert.equal(s.elements.get('#hints-toggle').textContent, 'Підказки: вимк');
  assert.equal(store.m.get('bandhero.hints'), '0');
  g.G.t = 1; g.hints.tick(); assert.equal(g.hints.current, null); assert.ok(s.elements.get('#hint').classList.contains('hide'));
  g.hints.want('note'); g.hints.tick(); assert.equal(g.hints.current, null, 'wanted hints are ignored while off');
  await s.click('#hints-reset'); assert.equal(g.hints.on, true); assert.equal(g.hints.seen.length, 0);
  assert.match(s.elements.get('#menu-notice').textContent, /Підказки скинуто/);
  g.G.t = 1; g.hints.tick(); assert.equal(g.hints.current, 'start');
  assert.deepEqual(s.errors, []);
});

test('first-run hints: persisted off flag is respected and throwing storage never crashes the game', async t => {
  const off = await hintsRun(t, memoryStore({ 'bandhero.hints': '0' })); off.game.G.t = 1; off.game.hints.tick();
  assert.equal(off.game.hints.on, false); assert.equal(off.game.hints.current, null);
  const boom = () => { throw new Error('storage blocked'); };
  for (const store of [{ getItem: boom, setItem: boom }, null]) {
    const s = await hintsRun(t, store), h = s.game.hints;
    assert.equal(h.on, true, 'works without storage'); s.game.G.t = 1; h.tick(); assert.equal(h.current, 'start');
    h.expire(); h.tick(); s.game.G.t = 2; h.tick(); assert.equal(h.current, null, 'still once per page without storage');
    h.setOn(false); h.reset(); await s.click('#hints-toggle'); await s.click('#hints-reset');
    assert.deepEqual(s.errors, []);
  }
});

test('first-run hints: a co-op guest gets them from its own snapshot state', async t => {
  const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stdout.on('data', b => output += b); server.stderr.on('data', b => output += b);
  const sessions = []; t.after(() => { sessions.forEach(s => s.close()); server.kill(); });
  await until(() => output.includes('http://localhost:'), 'server startup');
  const origin = 'http://127.0.0.1:' + output.match(/http:\/\/localhost:(\d+)/)[1];
  const store = memoryStore();
  const host = session(origin, true); sessions.push(host); await host.click('#multiplayer'); await until(() => host.game.net.id, 'host welcome');
  const guest = session(roomUrl(origin, host), true, { localStorage: store }); sessions.push(guest); await guest.click('#multiplayer'); await until(() => guest.game.net.id, 'guest welcome');
  await host.pick('guitar'); await until(() => guest.game.net.roster[0].char === 'guitar', 'host pick'); await guest.pick('drums');
  await until(() => host.game.net.roster.every(p => p.char), 'both picked');
  await host.click('#ready'); await guest.click('#ready'); host.game.net.ws.send(JSON.stringify({ t: 'begin' }));
  await until(() => guest.game.running && guest.game.G, 'guest running', 15000);
  await until(() => guest.game.G.t > 0.4, 'snapshot time');
  await until(() => { guest.game.hints.tick(); return guest.game.hints.current === 'start'; }, 'guest start hint');
  assert.match(guest.game.hints.text, /Атакуєш автоматично/);
  assert.equal(host.game.hints.current, null, 'host has hints off here and nothing was sent over the wire');
  assert.deepEqual(guest.errors, []);
});

/* ================= бос як концерт: фази, механіки, нагорода ================= */
const bossMix = (g, b) => { const o = { burst: 0, spiral: 0 }; for (let st = 0; st < 64; st++) { const n = g.bossNotes(b, st, { off: 0 }); if (n && n.atk && o[n.atk.k] !== undefined) o[n.atk.k]++; } return o; };

test('boss concert: crossing 66% and 35% starts a 1.5 s invulnerable section change; sections cannot be skipped and each has a bigger attack mix', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p; G.mobs = []; G.eshots = []; p.hp = p.max;
  const b = g.addMob('boss3', p.x + 400, p.y, { age: 5, ph: 1, inv: 0 }); b.spd = 0; b.hp = b.max = 10000;
  assert.deepEqual([...g.PHASE_AT], [.66, .35]); assert.equal(g.bossPhase(b), 1);
  const m1 = bossMix(g, b);
  g.hurtMob(b, 9000, 0, 0); // удар на 90% HP не перестрибує частину: бос зупиняється трохи нижче 66%
  assert.equal(b.ph, 2); assert.ok(b.hp >= b.max * .65 && b.hp < b.max * .66, 'clamped just under 66%: ' + b.hp);
  assert.ok(Math.abs(b.inv - g.PHASE_INV) < 1e-9 && g.PHASE_INV === 1.5, 'invulnerable for 1.5 s');
  const hp2 = b.hp; g.hurtMob(b, 500, 0, 0); assert.equal(b.hp, hp2, 'no damage during the section change');
  G.eshots = []; g.bossFire(b, { k: 'burst', n: 12 }); assert.equal(G.eshots.length, 0, 'the boss is silent while changing sections');
  const m2 = bossMix(g, b); assert.ok(m2.burst > m1.burst, 'chorus fires more bursts than the verse: ' + m1.burst + ' → ' + m2.burst);
  for (let i = 0; i < 4; i++) { p.hp = p.max; g.update(.4); }
  assert.equal(b.inv, 0, 'invulnerability ends'); g.hurtMob(b, 100, 0, 0); assert.ok(b.hp < hp2, 'vulnerable again');
  g.hurtMob(b, 9000, 0, 0); assert.equal(b.ph, 3); assert.ok(b.inv > 1.4); assert.ok(g.bossEnraged(b), 'phase III is the existing enrage');
  assert.ok(b.hp >= b.max * .34 && b.hp < b.max * .35);
  const m3 = bossMix(g, b); assert.ok(m3.burst > m2.burst, 'finale fires even more: ' + m2.burst + ' → ' + m3.burst);
  // фаза не повертається назад від лікування, а смерть працює завжди
  b.hp = b.max * .5; g.bossPhaseCheck(b); assert.equal(b.ph, 3);
  b.inv = 0; b.hp = 0; g.update(.016); assert.ok(!G.mobs.includes(b), 'the boss still dies');
  g.draw(); assert.deepEqual(s.errors, []);
});

test('Фонограма: amps shield the boss until every amp is destroyed, and every new section brings a new set', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p; G.mobs = []; p.hp = p.max;
  G.t = 299.99; G.bossNext = 0; g.update(.02); p.hp = p.max;
  const b = G.mobs.find(m => m.type === 'boss1'); assert.ok(b, 'boss spawns on schedule'); b.spd = 0;
  const amps = () => G.mobs.filter(m => m.type === 'amp' && m.hp > 0);
  assert.equal(amps().length, 2, 'solo: two amps'); assert.equal(b.sh, 1); assert.equal(b.ph, 1);
  for (const a of amps()) assert.ok(Math.hypot(a.x - p.x, a.y - p.y) < 400, 'amps stand around the player, on screen');
  const hp0 = b.hp; g.hurtMob(b, 5000, 0, 0); assert.equal(b.hp, hp0, 'shielded: no damage');
  b.burn = 2; b.burnDmg = 500; g.update(.5); p.hp = p.max; assert.equal(b.hp, hp0, 'burn does not pierce the shield either');
  amps()[0].hp = 0; g.update(.016); assert.equal(b.sh, 1, 'one amp left: still shielded'); assert.equal(amps().length, 1);
  amps()[0].hp = 0; g.update(.016); assert.equal(b.sh, 0, 'last amp down: shield drops'); assert.ok(b.daze > 0, 'and the boss is staggered');
  g.hurtMob(b, 100, 0, 0); assert.ok(b.hp < hp0, 'damage goes through');
  g.hurtMob(b, 1e5, 0, 0); assert.equal(b.ph, 2, 'section II'); assert.equal(amps().length, 2, 'new amps arrive with the chorus'); assert.equal(b.sh, 1);
  const hp1 = b.hp; g.update(.016); g.hurtMob(b, 100, 0, 0); assert.equal(b.hp, hp1, 'shield is back');
  // 3–4 героя: 4 колонки; кільце навколо центру гурту
  const fake = [{ p: { x: 0, y: 0, hp: 5 } }, { p: { x: 100, y: 0, hp: 5 } }, { p: { x: 0, y: 100, hp: 5 } }];
  const saved = G.players; G.players = fake; const wasActive = g.net.active; g.net.active = true;
  try { const before = amps().length; g.bossAmps(b); assert.equal(amps().length - before, 4, 'three heroes: four amps'); } finally { G.players = saved; g.net.active = wasActive; }
  b.hp = 0; g.update(.016); assert.equal(amps().length, 0, 'amps vanish with the boss');
  g.draw(); assert.deepEqual(s.errors, []);
});

test('Автотюн: a ring zone damages and staggers the boss only if someone stands in it on the downbeat', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p; G.mobs = []; G.zones = []; p.hp = p.max;
  const b = g.addMob('boss2', p.x + 300, p.y, { age: 5, ph: 1, inv: 0 }); b.spd = 0; b.hp = b.max = 10000;
  b.zCd = 0; g.bossMech(b, .1);
  assert.equal(G.zones.length, 1); const z = G.zones[0]; assert.equal(z.k, 'beat'); assert.ok(z.r >= 100 && z.life > 4);
  assert.ok(Math.abs(Math.hypot(z.x - b.x, z.y - b.y) - (b.r + 170)) < 1e-6, 'the ring is marked next to the boss');
  g.bossMech(b, .1); assert.equal(G.zones.length, 1, 'one ring at a time');
  p.x = z.x; p.y = z.y;
  g.bossBeat(b, 0); assert.equal(b.hp, b.max, 'the ring is only a warning for the first moments');
  z.age = 1; g.bossBeat(b, 3); g.bossBeat(b, 8); assert.equal(b.hp, b.max, 'off-beat steps do not count');
  g.bossBeat(b, 16); assert.ok(Math.abs(b.hp - b.max * (1 - g.BEAT_DMG)) < 1e-6, 'a hit on the downbeat takes 2% of max HP');
  assert.ok(b.daze > 1 && z.hits === 1 && z.fl > 0, 'the boss is staggered and the ring flashes');
  const keep = b.hp; p.x = z.x + 1000; g.bossBeat(b, 32); assert.equal(b.hp, keep, 'standing outside does nothing');
  p.x = z.x; b.inv = 1; g.bossBeat(b, 48); assert.equal(b.hp, keep, 'no damage during a section change'); b.inv = 0;
  b.sh = 1; g.bossBeat(b, 48); assert.equal(b.hp, keep, 'a shield blocks it as well'); b.sh = 0;
  // стагер зупиняє рух
  b.spd = 70; b.daze = 1; const x0 = b.x; g.update(.1); p.hp = p.max; assert.equal(b.x, x0, 'a staggered boss does not move');
  // кільце зникає з кінцем життя, нове — за таймером
  z.age = z.life + .1; g.update(.016); assert.equal(G.zones.length, 0);
  g.draw(); assert.deepEqual(s.errors, []);
});

test('Диригент Тиші: in silence the band deals ×0.25 damage unless it stands together (solo: inside a marker)', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p; G.mobs = []; G.zones = []; p.hp = p.max;
  const b = g.addMob('boss3', p.x + 500, p.y, { age: 5, ph: 2, inv: 0 }); b.spd = 0; b.hp = b.max = 1e6; b.hp = b.max * .5; b.silCd = 0;
  g.bossMech(b, .1); assert.equal(b.sil, 5, 'silence starts'); const mark = G.zones.find(z => z.k === 'mark'); assert.ok(mark, 'solo: a marker appears');
  const hit = () => { const before = b.hp; g.hurtMob(b, 1000, 0, 0); return before - b.hp; };
  p.x = mark.x + 600; p.y = mark.y; assert.equal(g.harmony(p), false); const lone = hit();
  p.x = mark.x + 20; p.y = mark.y; assert.equal(g.harmony(p), true); const tuned = hit();
  assert.ok(lone > 0 && Math.abs(tuned / lone - 1 / g.SIL_K) < 1e-6, 'outside the marker the damage is ×0.25: ' + lone + ' vs ' + tuned);
  g.draw(); assert.deepEqual(s.errors, []);
  b.sil = .05; g.bossMech(b, .1); assert.equal(b.sil, 0, 'silence ends'); assert.ok(!G.zones.some(z => z.k === 'mark'), 'marker is removed'); assert.ok(b.silCd > 5, 'next silence later');
  p.x = mark.x + 600;
  const calm = hit(); assert.ok(Math.abs(calm / tuned - 1) < 1e-6, 'full damage again');
  // перша фаза без тиші
  b.ph = 1; b.hp = b.max; b.silCd = 0; g.bossMech(b, .1); assert.ok(!(b.sil > 0), 'no silence in section I');
});

test('boss kill is rewarded with a free level-up pick and 30% HP; the final boss just wins', async t => {
  const s = session('http://127.0.0.1:8080', false); t.after(() => s.close());
  s.game.setGenre('pop'); await s.game.pick('guitar');
  const g = s.game, G = g.G, p = G.p; G.mobs = []; G.level = 7; G.xp = 0; p.hp = 10;
  const b = g.addMob('boss2', p.x + 300, p.y, { age: 5 }); b.hp = 0; g.update(.016);
  assert.equal(G.bosses, 1); assert.equal(G.level, 8, 'free level'); assert.ok(p.hp >= 10 + p.max * .3 - 1e-6, 'healed 30%');
  assert.ok(g.choosing || G.texts.some(x => /Авто/.test(String(x.v))), 'a card pick (or the auto-pick) follows');
  assert.equal(G.bossReward, 0);
  if (g.choosing) { await s.elements.get('#opts').children[0].onclick(); assert.equal(g.choosing, false); }
  G.mobs = []; const f = g.addMob('boss3', p.x + 300, p.y, { age: 5 }); f.hp = 0; g.update(.016);
  assert.equal(G.won, true); assert.equal(G.level, 8, 'no reward after the final boss');
  assert.deepEqual(s.errors, []);
});

test('co-op: the guest sees the boss phase, invulnerability, shield, ring and silence in the snapshot; the reward pick goes to both players', async t => {
  const srv = await startServer(t);
  const [a, b] = await bandOfTwo(t, srv.origin);
  const host = a.game, guest = b.game, H = host.G, keep = () => { for (const q of H.players) { q.p.hp = q.p.max; } };
  keep(); H.mobs = [];
  // Фонограма: у двох — 3 колонки, щит їде в знімку
  H.t = 299.98; H.bossNext = 0;
  await until(() => guest.G.mobs.some(m => m.type === 'boss1'), 'guest sees Фонограма');
  const hb = H.mobs.find(m => m.type === 'boss1'); hb.spd = 0;
  const amps = () => H.mobs.filter(m => m.type === 'amp' && m.hp > 0);
  assert.equal(amps().length, 3, 'two heroes: three amps');
  await until(() => { const gb = guest.G.mobs.find(m => m.type === 'boss1'); return gb && gb.sh === 1 && gb.ph === 1 && guest.G.mobs.filter(m => m.type === 'amp').length === 3; }, 'guest sees the shield and its amps');
  guest.draw();
  const before = hb.hp; host.hurtMob(hb, 1000, 0, 0); assert.equal(hb.hp, before, 'shielded in co-op too');
  for (const m of amps()) m.hp = 0;
  await until(() => guest.G.mobs.find(m => m.type === 'boss1').sh !== 1, 'guest sees the shield drop');
  keep(); host.hurtMob(hb, 1e6, 0, 0);
  await until(() => { const gb = guest.G.mobs.find(m => m.type === 'boss1'); return gb && gb.ph === 2 && gb.inv > 0; }, 'guest sees section II and the invulnerability window');
  guest.draw(); assert.deepEqual(b.errors, []);
  // винагорода: обидва обирають картку
  keep(); const lv0 = H.level; hb.inv = 0; hb.sh = 0; hb.hp = 0;
  await until(() => host.choosing && guest.choosing && host.net.pending.size === 2, 'both players get the reward pick');
  assert.equal(H.level, lv0 + 1); await takeBossReward([a, b], lv0);
  // Автотюн: кільце видно гостю
  keep(); H.mobs = []; H.zones = [];
  const b2 = host.addMob('boss2', H.players[0].p.x + 300, H.players[0].p.y, { age: 5, ph: 1, inv: 0 }); b2.spd = 0; b2.hp = b2.max = 1e6; b2.zCd = 0;
  await until(() => (guest.G.zones || []).some(z => z.k === 'beat' && z.r >= 100), 'guest sees the beat ring');
  guest.draw();
  // Диригент: тиша, гармонія за відстанню між героями (без маркера)
  keep(); H.mobs = []; H.zones = [];
  const b3 = host.addMob('boss3', H.players[0].p.x + 500, H.players[0].p.y, { age: 5, ph: 2, inv: 0 }); b3.spd = 0; b3.hp = b3.max = 1e6; b3.hp = b3.max * .5; b3.silCd = 0;
  await until(() => { const gb = guest.G.mobs.find(m => m.type === 'boss3'); return gb && gb.sil > 0 && gb.ph === 2; }, 'guest sees the silence');
  assert.ok(!H.zones.some(z => z.k === 'mark'), 'two heroes need no marker');
  const [p1, p2] = H.players.map(q => q.p); p1.x = 0; p1.y = 0; p2.x = 900; p2.y = 0;
  assert.equal(host.harmony(p1), false, 'far apart: no harmony');
  const hpA = b3.hp; host.withPlayer(H.players[0], () => host.hurtMob(b3, 1000, 0, 0)); const apart = hpA - b3.hp;
  p2.x = 100; assert.equal(host.harmony(p1), true, 'close together: harmony');
  const hpB = b3.hp; host.withPlayer(H.players[0], () => host.hurtMob(b3, 1000, 0, 0)); const together = hpB - b3.hp;
  assert.ok(apart > 0 && Math.abs(together / apart - 1 / host.SIL_K) < 1e-6, 'silence cuts the damage of lone heroes to ×0.25');
  guest.draw(); host.draw();
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});
