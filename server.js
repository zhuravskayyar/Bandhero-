// Band Hero — HTTP і WebSocket сервер для локальної гри та публічних кімнат.
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
  ['/i18n.js', ['i18n.js', 'text/javascript; charset=utf-8']],
  ['/pixel-heroes.js', ['pixel-heroes.js', 'text/javascript; charset=utf-8']],
  ['/pixel-icons.js', ['pixel-icons.js', 'text/javascript; charset=utf-8']],
  ['/assets/expansion-audio.js', ['assets/expansion-audio.js', 'text/javascript; charset=utf-8']],
  ['/assets/sf2-bank.js', ['assets/sf2-bank.js', 'text/javascript; charset=utf-8']],
  ['/assets/soundfonts/A320U.sf2', ['assets/soundfonts/A320U.sf2', 'application/octet-stream']],
  ['/assets/expansion-genres.js', ['assets/expansion-genres.js', 'text/javascript; charset=utf-8']],
  ['/assets/expansion-instruments.js', ['assets/expansion-instruments.js', 'text/javascript; charset=utf-8']],
  ['/tools/hero-lab.html', ['tools/hero-lab.html', 'text/html; charset=utf-8']],
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
  ['/assets/fx-pack-v1.png', ['assets/fx-pack-v1.png', 'image/png']],
  ['/assets/bh-pixel.ttf', ['assets/bh-pixel.ttf', 'font/ttf']],
  ['/assets/genre-icons-v1.png', ['assets/genre-icons-v1.png', 'image/png']],
  ['/assets/Rubik.ttf', ['assets/Rubik.ttf', 'font/ttf']],
  ['/assets/guitar-harmonics.js', ['assets/guitar-harmonics.js', 'text/javascript; charset=utf-8']],
  ['/assets/RussoOne.ttf', ['assets/RussoOne.ttf', 'font/ttf']]
]);
const MAX_PLAYERS = 4;
const MAX_MSG = 512 * 1024; // захист від завеликих повідомлень
const CHARS = ['guitar', 'drums', 'bass', 'piano', 'flute', 'violin', 'sax', 'accordion'];
const rooms = new Map();
const MAX_ROOMS = 100;
const LEGACY_ROOM = '0000000000'; // старі посилання /?band=1 лишаються спільним гуртом
function newRoom(code) {
  if (!code) {
    do { code = crypto.randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(code) || code === LEGACY_ROOM);
  }
  const room = { code, clients: new Map(), hostId: null, phase: 'lobby', genre: 'rand', fsq: 0 };
  rooms.set(code, room);
  return room;
}

// ---------- Лічильник відвідувань (Neon Postgres через HTTP, без пакетів) ----------
const DB_URL = process.env.DATABASE_URL || '';
function logVisit(req) {
  if (!DB_URL) return;
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawl|spider|uptime|monitor|curl|wget/i.test(ua)) return;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const vid = require('crypto').createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 12);
    const lang = String(req.headers['accept-language'] || '').slice(0, 2).toLowerCase();
    const country = String(req.headers['cf-ipcountry'] || '').slice(0, 2);
    const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'https:')).host;
    fetch('https://' + host + '/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DB_URL },
      body: JSON.stringify({ query: 'INSERT INTO visits (path, lang, country, ua, vid) VALUES ($1,$2,$3,$4,$5)', params: [req.url.split('?')[0], lang, country, ua.slice(0, 200), vid] }),
    }).catch(() => {});
  } catch (e) {}
}

// ---------- HTTP: лише сама гра, без кешу (щоб завжди була свіжа версія) ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // семпли скрипки VSCO-2 (CC0): лише файли з білого списку імен — без виходу за межі папки
  const violin = /^\/assets\/violin\/([A-Za-z0-9_]+\.mp3|LICENSE\.txt)$/.exec(url);
  if (req.method === 'GET' && violin) {
    fs.readFile(path.join(__dirname, 'assets', 'violin', violin[1]), (err, data) => {
      if (err) { res.writeHead(404); res.end('Asset not found'); return; }
      res.writeHead(200, { 'Content-Type': violin[1].endsWith('.mp3') ? 'audio/mpeg' : 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=604800' }); res.end(data);
    }); return;
  }
  if (req.method === 'GET' && ASSETS.has(url)) {
    const [file, type] = ASSETS.get(url);
    fs.readFile(path.join(__dirname, file), (err, data) => {
      if (err) { res.writeHead(404); res.end('Asset not found'); return; }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type === 'image/png' ? 'public, max-age=3600' : type === 'application/octet-stream' ? 'public, max-age=604800' : 'no-store' });res.end(data);
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
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, room) => n + room.clients.size, 0) }));
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/game.html')) {
    logVisit(req);
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
let nextId = 1;

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
const GRACE_MS = Number(process.env.GRACE_MS || 30000); // скільки чекаємо гравця (і гостя, і хоста), у якого обірвався зв’язок посеред забігу
const DROP_BACKLOG = 128 * 1024;   // жорсткий ліміт черги знімків для повільного гравця (байти)
const DROP_AGE_MS = 200;           // і головний: якщо найстаріший недописаний запис чекає довше — свіжі знімки світу пропускаємо, а не копимо затримку
const HARD_BACKLOG = 8 * 1024 * 1024; // лише якщо зовсім нічого не приймає
// Наскрізний контроль потоку: за проксі (Render/Cloudflare) сокет сервера спорожнюється миттєво, тож черга росте в проксі, а не тут.
// Гість підтверджує кожен регулярний знімок («ack»); поки найстаріший непідтверджений їде довше за (найкращий виміряний час + запас) — нових не шлемо.
const FLOW_MARGIN_MS = 100;        // запас над найкращим виміряним часом «знімок → ack»
const FLOW_PROBE_MS = 1000;        // без жодного ack стільки часу — пропускаємо один знімок, щоб потік не заглух назавжди
const FLOW_MAX_BASE = 1500;        // верхня межа «найкращого» часу, щоб поганий старт не вимкнув контроль

function sendRaw(c, buf, droppable) {
  if (!c || !c.sock || c.sock.destroyed) return;
  const sock = c.sock, queued = sock.writableLength, pend = sock.pendingAt || (sock.pendingAt = []);
  // Вік черги: найстаріший запис ще не пішов у лінію довше за DROP_AGE_MS (callback write не спрацював) — лінія не встигає.
  const stale = queued > 0 && pend.length > 0 && Date.now() - pend[0] > DROP_AGE_MS;
  if (droppable && (queued > DROP_BACKLOG || stale)) { c.dropped = (c.dropped || 0) + 1; return; }
  if (queued > HARD_BACKLOG) { c.reason = 'не встигав приймати дані'; sock.destroy(); return; }
  pend.push(Date.now());
  sock.write(buf, () => { pend.shift(); });
  return true;
}
function flowReset(c) { c.flow = null; c.unacked = []; c.lastAck = 0; c.lastPass = 0; c.base = undefined; } // нове з’єднання чи новий хост: старі лічильники не мають сенсу
// знімки світу для гостей: нумеруємо (room.fsq), кожному гравцеві шлемо, лише якщо його лінія встигає за ack-ами
function broadcastState(room, d, exceptId) {
  const q = ++room.fsq, f = frame(JSON.stringify({ t: 'fromHost', d, q })), now = Date.now();
  for (const c of room.clients.values()) {
    if (c.id === exceptId) continue;
    const un = c.unacked || (c.unacked = []);
    if (c.flow && un.length && now - un[0].at > Math.min(FLOW_MAX_BASE, c.base) + FLOW_MARGIN_MS && now - Math.max(c.lastAck, c.lastPass) < FLOW_PROBE_MS) { c.dropped = (c.dropped || 0) + 1; continue; }
    if (sendRaw(c, f, true)) { un.push({ q, at: now }); if (un.length > 64) un.shift(); c.lastPass = now; }
  }
}
function onAck(c, q) {
  const un = c.unacked; if (!un || !un.length || !Number.isFinite(q)) return;
  const now = Date.now(); let hit = null;
  while (un.length && un[0].q <= q) { const e = un.shift(); if (e.q === q) hit = e; }
  c.lastAck = now; if (!hit) return;
  const dt = Math.min(FLOW_MAX_BASE, now - hit.at); // найкращий час тримаємо мінімумом, що повільно «забувається» (лінія може погіршитись надовго)
  c.base = c.base === undefined || dt < c.base ? dt : c.base + (dt - c.base) * 0.01;
  c.flow = true; // контроль вмикається лише для клієнтів, що справді шлють ack
}
function send(c, obj) { sendRaw(c, frame(JSON.stringify(obj))); }
function broadcast(room, obj, exceptId, droppable) { const f = frame(JSON.stringify(obj)); for (const c of room.clients.values()) if (c.id !== exceptId) sendRaw(c, f, droppable); }
function roster(room) { return [...room.clients.values()].map(c => ({ id: c.id, char: c.char || null, ready: c.ready, host: c.id === room.hostId })); }
function pushRoster(room) { broadcast(room, { t: 'roster', host: room.hostId, players: roster(room), phase: room.phase, genre: room.genre }); }

// гурт повернувся в лобі: місця для тих, хто зараз без зв’язку, більше не тримаємо.
// Повернувшись, вони зайдуть у лобі як нові учасники й побачать його, а не завислий забіг.
function dropAway(room) {
  for (const p of [...room.clients.values()]) if (!p.sock) {
    clearTimeout(p.graceTimer); room.clients.delete(p.id);
    log(`- ${p.id} прибраний (гурт повернувся в лобі, поки він був без зв’язку). Гравців: ${room.clients.size}`);
  }
}
// остаточно прибрати гравця (вийшов сам, не повернувся вчасно або це хост)
function removeClient(c, why) {
  const room = c.room, clients = room.clients;
  if (clients.get(c.id) !== c) return;
  clearTimeout(c.graceTimer);
  clients.delete(c.id);
  log(`- ${c.id} відключився (${why}). Гравців: ${clients.size}`);
  if (room.hostId === c.id) { // хост пішов — новим хостом стає найстаріший гравець; гру треба почати заново
    room.phase = 'lobby'; dropAway(room);
    room.hostId = clients.size ? [...clients.keys()][0] : null;
    for (const peer of clients.values()) { peer.ready = false; flowReset(peer); }
    broadcast(room, { t: 'hostLeft', host: room.hostId });
  } else if (room.hostId) send(clients.get(room.hostId), { t: 'left', id: c.id });
  if (clients.size) pushRoster(room);
  else rooms.delete(room.code);
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
  const requested = new URLSearchParams(query).get('room');
  const code = requested && /^[A-F0-9]{10}$/i.test(requested) ? requested.toUpperCase() : null;
  let room;
  if (!requested) room = rooms.size < MAX_ROOMS ? newRoom() : null;
  else if (code) room = rooms.get(code) || (code === LEGACY_ROOM && rooms.size < MAX_ROOMS ? newRoom(code) : null);
  if (!room) {
    sendRaw({ sock }, frame(JSON.stringify({ t: requested ? 'missing' : 'serverFull' })));
    sock.end(Buffer.from([0x88, 0]));
    return;
  }
  const clients = room.clients;

  // повернення після обриву: той самий гравець, той самий персонаж
  const token = new URLSearchParams(query).get('resume');
  let c = token ? [...clients.values()].find(p => p.token === token) : null;
  if (c) {
    const old = c.sock;
    clearTimeout(c.graceTimer); c.graceTimer = null;
    c.sock = sock; c.alive = true; c.dropped = 0; flowReset(c);
    if (old && !old.destroyed) { c.reason = null; old.destroy(); } // старе «напівмертве» з’єднання телефона
    send(c, { t: 'welcome', id: c.id, token: c.token, resumed: true, room: room.code, host: room.hostId, players: roster(room), phase: room.phase, genre: room.genre });
    if (room.hostId && room.hostId !== c.id) send(clients.get(room.hostId), { t: 'back', id: c.id });
    else if (room.hostId === c.id) broadcast(room, { t: 'hostBack' }, c.id);
    log(`↻ ${c.id} повернувся (${ip}).`);
  } else {
    if (clients.size >= MAX_PLAYERS) { sendRaw({ sock }, frame(JSON.stringify({ t: 'full' }))); sock.end(Buffer.from([0x88, 0])); return; }
    if (room.phase !== 'lobby') { sendRaw({ sock }, frame(JSON.stringify({ t: token ? 'expired' : 'busy' }))); sock.end(Buffer.from([0x88, 0])); return; }
    c = { sock, room, id: 'p' + (nextId++), token: crypto.randomBytes(12).toString('hex'), char: null, ready: false, alive: true };
    clients.set(c.id, c);
    if (!room.hostId) room.hostId = c.id;
    send(c, { t: 'welcome', id: c.id, token: c.token, room: room.code, host: room.hostId, players: roster(room), phase: room.phase, genre: room.genre });
    pushRoster(room);
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
    // гравець посеред забігу (зокрема хост): тримаємо місце й персонажа, поки він перепідключається.
    // Свідомий вихід («bye») прибирає одразу.
    if (!c.leaving && room.phase !== 'lobby' && clients.get(c.id) === c) {
      log(`… ${c.id} втратив зв’язок (${why}${c.dropped ? `, пропущено знімків: ${c.dropped}` : ''}). Чекаємо ${GRACE_MS / 1000} с.`);
      c.graceTimer = setTimeout(() => removeClient(c, 'не повернувся вчасно'), GRACE_MS);
      if (c.id === room.hostId) broadcast(room, { t: 'hostAway' }, c.id); // гості одразу зупиняються, а не бігають у застиглому світі
      return;
    }
    removeClient(c, c.leaving ? 'вийшов сам' : why);
  };
  sock.on('close', gone); sock.on('error', e => { errCode = e && e.code; gone(); }); sock.on('end', gone);
  if (head.length) receive(head);
});

function onMessage(c, text) {
  const room = c.room, clients = room.clients;
  let m; try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') { send(c, { t: 'pong' }); return; } // клієнт перевіряє, чи живий сам сервер
  if (m.t === 'bye') { c.leaving = true; return; }       // свідомий вихід — без очікування повернення
  if (m.t === 'pick') {               // вибір інструмента: один інструмент — один гравець
    if (room.phase !== 'lobby') return;
    const want = CHARS.includes(m.char) ? m.char : null;
    if (want && [...clients.values()].some(o => o.id !== c.id && o.char === want)) { send(c, { t: 'taken', char: want }); return; }
    c.char = want; c.ready = false; pushRoster(room); return;
  }
  if (m.t === 'ready' && room.phase === 'lobby') { c.ready = !!m.ready && !!c.char; pushRoster(room); return; }
  if (m.t === 'genre' && c.id === room.hostId && room.phase === 'lobby' && typeof m.genre === 'string') {
    if (!['rand', 'lofi', 'pop', 'rock', 'newwave', 'metal', 'jazz', 'chanson', 'chanson_ua', 'reggae', 'industrial', 'funk', 'synthwave', 'folkrock', 'blues', 'dnb', 'rockfast'].includes(m.genre)) return;
    room.genre = m.genre; pushRoster(room); return;
  }
  if (m.t === 'begin' && c.id === room.hostId && room.phase === 'lobby') {
    if (clients.size < 2 || [...clients.values()].some(p => !p.char || !p.ready)) { send(c, { t: 'notReady' }); return; }
    room.phase = 'loading'; broadcast(room, { t: 'begin' }); pushRoster(room); return;
  }
  if (m.t === 'phase' && c.id === room.hostId && ['lobby', 'playing', 'ended'].includes(m.phase)) {
    room.phase = m.phase;
    if (room.phase === 'lobby') { dropAway(room); for (const peer of clients.values()) peer.ready = false; }
    pushRoster(room); return;
  }
  if (m.t === 'toHost') { if (room.hostId && room.hostId !== c.id) send(clients.get(room.hostId), { t: 'fromPeer', from: c.id, d: m.d }); return; }
  if (m.t === 'ack') { onAck(c, m.q); return; }               // гість підтвердив знімок: див. broadcastState
  if (m.t === 'toAll') { if (c.id === room.hostId) { if (m.drop === 1) broadcastState(room, m.d, c.id); else broadcast(room, { t: 'fromHost', d: m.d }, c.id); } return; } // лише хост розсилає стан
  if (m.t === 'toPeer') { if (c.id === room.hostId && clients.has(m.to)) send(clients.get(m.to), { t: 'fromHost', d: m.d }); return; }
}

function log(s) { console.log(new Date().toLocaleTimeString() + '  ' + s); }
setInterval(() => {
  for (const room of rooms.values()) for (const c of room.clients.values()) {
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
