// Band Hero — локальний сервер для гри по Wi-Fi.
// Запуск: node server.js   (порт можна змінити: PORT=9000 node server.js)
// Без сторонніх пакетів: HTTP роздає game.html, WebSocket (/ws) з'єднує гравців.
// Сервер — лише «поштар»: пересилає повідомлення й тримає список гравців. Гру рахує браузер хоста.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT || 8080);
const GAME = path.join(__dirname, 'game.html');
const ASSETS = new Map([
  ['/game-effects.css', ['game-effects.css', 'text/css; charset=utf-8']],
  ['/assets/band-heroes-v1.png', ['assets/band-heroes-v1.png', 'image/png']],
  ['/assets/band-mobs-v1.png', ['assets/band-mobs-v1.png', 'image/png']],
  ['/assets/band-creatures-v2.png', ['assets/band-creatures-v2.png', 'image/png']],
  ['/assets/music-fx-v2.png', ['assets/music-fx-v2.png', 'image/png']],
  ['/assets/hero-guitar-v3.png', ['assets/hero-guitar-v3.png', 'image/png']],
  ['/assets/hero-drums-v3.png', ['assets/hero-drums-v3.png', 'image/png']],
  ['/assets/hero-drums-atk-v3.png', ['assets/hero-drums-atk-v3.png', 'image/png']],
  ['/assets/hero-bass-v3.png', ['assets/hero-bass-v3.png', 'image/png']],
  ['/assets/hero-bass-atk-v3.png', ['assets/hero-bass-atk-v3.png', 'image/png']],
  ['/assets/hero-piano-v3.png', ['assets/hero-piano-v3.png', 'image/png']],
  ['/assets/hero-piano-atk-v3.png', ['assets/hero-piano-atk-v3.png', 'image/png']],
  ['/assets/fx-guitar-v3.png', ['assets/fx-guitar-v3.png', 'image/png']],
  ['/assets/fx-drums-v3.png', ['assets/fx-drums-v3.png', 'image/png']],
  ['/assets/fx-bass-v3.png', ['assets/fx-bass-v3.png', 'image/png']],
  ['/assets/fx-piano-v3.png', ['assets/fx-piano-v3.png', 'image/png']],
  ['/assets/night-grove-floor-v2.png', ['assets/night-grove-floor-v2.png', 'image/png']],
  ['/assets/night-grove-props-v2.png', ['assets/night-grove-props-v2.png', 'image/png']],
  ['/assets/Rubik.ttf', ['assets/Rubik.ttf', 'font/ttf']],
  ['/assets/guitar-harmonics.js', ['assets/guitar-harmonics.js', 'text/javascript; charset=utf-8']],
  ['/assets/RussoOne.ttf', ['assets/RussoOne.ttf', 'font/ttf']]
]);
const MAX_PLAYERS = 4;
const MAX_MSG = 512 * 1024; // захист від завеликих повідомлень
const CHARS = ['guitar', 'drums', 'bass', 'piano'];
let phase = 'lobby';
let genre = 'rand';

// ---------- HTTP: лише сама гра, без кешу (щоб завжди була свіжа версія) ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && ASSETS.has(url)) {
    const [file, type] = ASSETS.get(url);
    fs.readFile(path.join(__dirname, file), (err, data) => {
      if (err) { res.writeHead(404); res.end('Asset not found'); return; }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type === 'image/png' ? 'public, max-age=3600' : 'no-store' });res.end(data);
    });return;
  }
  if (req.method === 'GET' && url === '/api/addresses') {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal);
    const priority = a => a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : 2;
    addresses.sort((a, b) => priority(a) - priority(b));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ urls: addresses.map(a => 'http://' + a.address + ':' + server.address().port) }));
    return;
  }
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, players: clients.size, phase }));
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/game.html')) {
    fs.readFile(GAME, (err, data) => {
      if (err) { res.writeHead(500); res.end('game.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

// ---------- WebSocket (RFC 6455), мінімальна реалізація ----------
const clients = new Map(); // id -> {sock, id, char, joined}
let nextId = 1;
let hostId = null;

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81; // FIN + text
  return Buffer.concat([head, payload]);
}
const GRACE_MS = Number(process.env.GRACE_MS || 15000); // скільки чекаємо гостя, у якого обірвався зв’язок посеред забігу
const DROP_BACKLOG = 128 * 1024;   // повільному гравцю пропускаємо чергові знімки світу, а не відключаємо його
const HARD_BACKLOG = 8 * 1024 * 1024; // лише якщо зовсім нічого не приймає

function sendRaw(c, buf, droppable) {
  if (!c || !c.sock || c.sock.destroyed) return;
  const queued = c.sock.writableLength;
  if (droppable && queued > DROP_BACKLOG) { c.dropped = (c.dropped || 0) + 1; return; }
  if (queued > HARD_BACKLOG) { c.reason = 'не встигав приймати дані'; c.sock.destroy(); return; }
  c.sock.write(buf);
}
function send(c, obj) { sendRaw(c, frame(JSON.stringify(obj))); }
function broadcast(obj, exceptId, droppable) { const f = frame(JSON.stringify(obj)); for (const c of clients.values()) if (c.id !== exceptId) sendRaw(c, f, droppable); }
function roster() { return [...clients.values()].map(c => ({ id: c.id, char: c.char || null, ready: c.ready, host: c.id === hostId })); }
function pushRoster() { broadcast({ t: 'roster', host: hostId, players: roster(), phase, genre }); }

// гурт повернувся в лобі: місця для тих, хто зараз без зв’язку, більше не тримаємо.
// Повернувшись, вони зайдуть у лобі як нові учасники й побачать його, а не завислий забіг.
function dropAway() {
  for (const p of [...clients.values()]) if (!p.sock) {
    clearTimeout(p.graceTimer); clients.delete(p.id);
    log(`- ${p.id} прибраний (гурт повернувся в лобі, поки він був без зв’язку). Гравців: ${clients.size}`);
  }
}
// остаточно прибрати гравця (вийшов сам, не повернувся вчасно або це хост)
function removeClient(c, why) {
  if (clients.get(c.id) !== c) return;
  clearTimeout(c.graceTimer);
  clients.delete(c.id);
  log(`- ${c.id} відключився (${why}). Гравців: ${clients.size}`);
  if (hostId === c.id) { // хост пішов — новим хостом стає найстаріший гравець; гру треба почати заново
    phase = 'lobby'; dropAway();
    hostId = clients.size ? [...clients.keys()][0] : null;
    for (const peer of clients.values()) peer.ready = false;
    broadcast({ t: 'hostLeft', host: hostId });
  } else if (hostId) send(clients.get(hostId), { t: 'left', id: c.id });
  pushRoster();
  if (!clients.size) { phase = 'lobby'; genre = 'rand'; }
}

server.on('upgrade', (req, sock, head) => {
  sock.on('error', () => {}); // помилка навіть відхиленого з’єднання не завершує весь сервер
  const [route, query = ''] = req.url.split('?');
  if (route !== '/ws' || !req.headers['sec-websocket-key'] || req.headers['sec-websocket-version'] !== '13') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 5000);
  const ip = req.socket.remoteAddress;

  // повернення після обриву: той самий гравець, той самий персонаж
  const token = new URLSearchParams(query).get('resume');
  let c = token ? [...clients.values()].find(p => p.token === token) : null;
  if (c) {
    const old = c.sock;
    clearTimeout(c.graceTimer); c.graceTimer = null;
    c.sock = sock; c.alive = true; c.dropped = 0;
    if (old && !old.destroyed) { c.reason = null; old.destroy(); } // старе «напівмертве» з’єднання телефона
    send(c, { t: 'welcome', id: c.id, token: c.token, resumed: true, host: hostId, players: roster(), phase, genre });
    if (hostId && hostId !== c.id) send(clients.get(hostId), { t: 'back', id: c.id });
    log(`↻ ${c.id} повернувся (${ip}).`);
  } else {
    if (clients.size >= MAX_PLAYERS) { sendRaw({ sock }, frame(JSON.stringify({ t: 'full' }))); sock.end(Buffer.from([0x88, 0])); return; }
    if (phase !== 'lobby') { sendRaw({ sock }, frame(JSON.stringify({ t: token ? 'expired' : 'busy' }))); sock.end(Buffer.from([0x88, 0])); return; }
    c = { sock, id: 'p' + (nextId++), token: crypto.randomBytes(12).toString('hex'), char: null, ready: false, alive: true };
    clients.set(c.id, c);
    if (!hostId) hostId = c.id;
    send(c, { t: 'welcome', id: c.id, token: c.token, host: hostId, players: roster(), phase, genre });
    pushRoster();
    log(`+ ${c.id} підключився (${ip}). Гравців: ${clients.size}`);
  }

  const bad = why => { if (c.sock === sock) c.reason = why; sock.destroy(); };
  let buf = Buffer.alloc(0), frag = [], fragLen = 0;
  const receive = chunk => {
    if (c.sock !== sock) return;
    buf = Buffer.concat([buf, chunk]);
    // один TCP-шматок ≠ один кадр: розбираємо, поки є повні кадри
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      if (!masked || (buf[0] & 0x70) || ![0, 1, 8, 9, 10].includes(op)) { bad('зіпсований кадр'); return; }
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) { bad('завелике повідомлення'); return; } len = Number(big); off = 10; }
      if (len > MAX_MSG) { bad('завелике повідомлення'); return; }
      if (op >= 8 && (!fin || len > 125)) { bad('зіпсований кадр'); return; }
      if ((op === 0 && !frag.length) || (op === 1 && frag.length)) { bad('зіпсований кадр'); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      buf = buf.subarray(need);
      c.alive = true; // будь-який кадр від клієнта означає, що він живий
      if (op === 0x8) { if (!c.reason) c.reason = 'браузер закрив з’єднання'; sock.end(Buffer.from([0x88, 0])); return; } // close
      if (op === 0x9) { const p = Buffer.from(payload); const h = Buffer.from([0x8a, p.length]); sock.write(Buffer.concat([h, p])); continue; } // ping→pong (≤125 байт)
      if (op === 0xa) continue;                                       // pong
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        frag.push(Buffer.from(payload)); fragLen += payload.length;
        if (fragLen > MAX_MSG) { bad('завелике повідомлення'); return; }
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8'); frag = []; fragLen = 0;
        onMessage(c, text);
        if (c.sock !== sock) return;
      }
    }
  };
  sock.on('data', receive);
  let errCode = null;
  const gone = () => {
    if (c.sock !== sock) return; // це старе з’єднання, гравець уже повернувся новим
    c.sock = null;
    const why = c.reason || (errCode ? 'помилка мережі ' + errCode : 'з’єднання обірвалося');
    c.reason = null;
    // гість посеред забігу: тримаємо місце й персонажа, поки він перепідключається
    if (!c.leaving && c.id !== hostId && phase !== 'lobby' && clients.get(c.id) === c) {
      log(`… ${c.id} втратив зв’язок (${why}${c.dropped ? `, пропущено знімків: ${c.dropped}` : ''}). Чекаємо ${GRACE_MS / 1000} с.`);
      c.graceTimer = setTimeout(() => removeClient(c, 'не повернувся вчасно'), GRACE_MS);
      return;
    }
    removeClient(c, c.leaving ? 'вийшов сам' : why);
  };
  sock.on('close', gone); sock.on('error', e => { errCode = e && e.code; gone(); }); sock.on('end', gone);
  if (head.length) receive(head);
});

function onMessage(c, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') { send(c, { t: 'pong' }); return; } // клієнт перевіряє, чи живий сам сервер
  if (m.t === 'bye') { c.leaving = true; return; }       // свідомий вихід — без очікування повернення
  if (m.t === 'pick') {               // вибір інструмента: один інструмент — один гравець
    if (phase !== 'lobby') return;
    const want = CHARS.includes(m.char) ? m.char : null;
    if (want && [...clients.values()].some(o => o.id !== c.id && o.char === want)) { send(c, { t: 'taken', char: want }); return; }
    c.char = want; c.ready = false; pushRoster(); return;
  }
  if (m.t === 'ready' && phase === 'lobby') { c.ready = !!m.ready && !!c.char; pushRoster(); return; }
  if (m.t === 'genre' && c.id === hostId && phase === 'lobby' && typeof m.genre === 'string') {
    if (!['rand', 'lofi', 'pop', 'rock', 'newwave', 'metal', 'jazz', 'chanson', 'chanson_ua', 'reggae', 'industrial'].includes(m.genre)) return;
    genre = m.genre; pushRoster(); return;
  }
  if (m.t === 'begin' && c.id === hostId && phase === 'lobby') {
    if (clients.size < 2 || [...clients.values()].some(p => !p.char || !p.ready)) { send(c, { t: 'notReady' }); return; }
    phase = 'loading'; broadcast({ t: 'begin' }); pushRoster(); return;
  }
  if (m.t === 'phase' && c.id === hostId && ['lobby', 'playing', 'ended'].includes(m.phase)) {
    phase = m.phase;
    if (phase === 'lobby') { dropAway(); for (const peer of clients.values()) peer.ready = false; }
    pushRoster(); return;
  }
  if (m.t === 'toHost') { if (hostId && hostId !== c.id) send(clients.get(hostId), { t: 'fromPeer', from: c.id, d: m.d }); return; }
  if (m.t === 'toAll') { if (c.id === hostId) broadcast({ t: 'fromHost', d: m.d }, c.id, m.drop === 1); return; } // лише хост розсилає стан
  if (m.t === 'toPeer') { if (c.id === hostId && clients.has(m.to)) send(clients.get(m.to), { t: 'fromHost', d: m.d }); return; }
}

function log(s) { console.log(new Date().toLocaleTimeString() + '  ' + s); }
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.sock) continue; // гість у режимі очікування повернення
    if (!c.alive) { c.reason = 'не відповідав 20 с'; c.sock.destroy(); continue; }
    c.alive = false; sendRaw(c, Buffer.from([0x89, 0]));
  }
}, 10000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const actualPort = server.address().port;
  console.log('\n  Band Hero сервер запущено.\n');
  console.log('  На цьому комп\'ютері:  http://localhost:' + actualPort);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('  Для друзів у Wi-Fi:   http://' + a.address + ':' + actualPort);
  console.log('\n  Якщо друг не може підключитися — дозволь Node.js у брандмауері Windows для приватних мереж.\n');
});
