'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 24;
const MAX_ROOMS = 400;
const ROOM_EXPIRY = 6 * 60 * 60 * 1000;
const KEYS = ['villager', 'doctor', 'seer', 'werewolf'];
const DEFAULT_COUNTS = Object.freeze({ villager: 5, doctor: 1, seer: 1, werewolf: 2 });
const rooms = new Map();
const publicDir = __dirname;
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function randomToken() { return crypto.randomBytes(24).toString('hex'); }
function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length: 6}, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function json(res, status, data) {
  const output = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(output),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(output);
}
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function cleanName(value) {
  if (typeof value !== 'string') fail('Enter your name to join.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 24 || /[<>\u0000-\u001F\u007F]/.test(name)) {
    fail('Names must be 1–24 characters.');
  }
  return name;
}
function getRoom(code) {
  if (typeof code !== 'string') fail('Invalid room code.');
  const room = rooms.get(code.trim().toUpperCase());
  if (!room) fail('Room not found. Check the code or ask the host for a new link.', 404);
  room.updatedAt = Date.now();
  return room;
}
function auth(data) {
  const room = getRoom(data.code);
  const player = room.players.find(p => p.token === data.token);
  if (!player) fail('You are not in this room. Rejoin using the invite link.', 401);
  return {room, player};
}
function visible(room, player) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    counts: room.counts,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.id === room.hostId })),
    you: {
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId,
      ...(room.phase === 'started' ? { role: player.role } : {}),
    },
  };
}
function joinPlayer(room, name) {
  if (room.phase !== 'lobby') fail('This game has already started. Ask the host to begin a new round.');
  if (room.players.length >= MAX_PLAYERS) fail('This room is full.');
  if (room.players.some(p => p.name.toLocaleLowerCase('en-GB') === name.toLocaleLowerCase('en-GB'))) {
    fail('Someone is already using that name in this room.');
  }
  const player = { id: crypto.randomUUID(), name, token: randomToken(), role: null };
  room.players.push(player);
  return player;
}
function shuffle(values) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
async function readBody(req) {
  let content = '';
  for await (const chunk of req) {
    content += chunk.toString('utf8');
    if (content.length > 8192) fail('Request too large.', 413);
  }
  try { return JSON.parse(content || '{}'); }
  catch { fail('Invalid request.'); }
}
async function api(req, res, pathname, searchParams) {
  if (pathname === '/api/state' && req.method === 'GET') {
    const {room, player} = auth({code: searchParams.get('code'), token: searchParams.get('token')});
    return json(res, 200, visible(room, player));
  }
  if (req.method !== 'POST') return json(res, 405, {error: 'Method not allowed.'});
  const data = await readBody(req);
  if (pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) fail('Too many active rooms. Try again shortly.', 503);
    const room = {
      code: randomCode(),
      hostId: null,
      players: [],
      counts: {...DEFAULT_COUNTS},
      phase: 'lobby',
      round: 0,
      updatedAt: Date.now(),
    };
    const player = joinPlayer(room, cleanName(data.name));
    room.hostId = player.id;
    rooms.set(room.code, room);
    return json(res, 200, {code: room.code, token: player.token, state: visible(room, player)});
  }
  if (pathname === '/api/join') {
    const room = getRoom(data.code);
    const player = joinPlayer(room, cleanName(data.name));
    return json(res, 200, {code: room.code, token: player.token, state: visible(room, player)});
  }
  const {room, player} = auth(data);
  const isHost = player.id === room.hostId;
  if (pathname === '/api/config') {
    if (!isHost) fail('Only the host can change the roles.', 403);
    if (room.phase !== 'lobby') fail('Start a new round to change roles.');
    const counts = data.counts;
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) fail('Invalid role settings.');
    const ok = Object.keys(counts).length === KEYS.length && KEYS.every(
      key => Number.isInteger(counts[key]) && counts[key] >= 0 && counts[key] <= MAX_PLAYERS
    );
    if (!ok || KEYS.reduce((n, key) => n + counts[key], 0) > MAX_PLAYERS) {
      fail(`Choose between 0 and ${MAX_PLAYERS} players in total.`);
    }
    room.counts = {...counts};
    return json(res, 200, visible(room, player));
  }
  if (pathname === '/api/start') {
    if (!isHost) fail('Only the host can deal the roles.', 403);
    if (room.phase !== 'lobby') fail('The game has already started.');
    const numberOfRoles = KEYS.reduce((sum, key) => sum + room.counts[key], 0);
    if (room.players.length < 3) fail('You need at least 3 players.');
    if (numberOfRoles !== room.players.length) {
      fail(`Set exactly ${room.players.length} roles — one for each person.`);
    }
    if (room.counts.werewolf === 0) fail('Include at least one werewolf.');
    if (room.counts.villager + room.counts.doctor + room.counts.seer === 0) fail('Include at least one good player.');
    const deck = shuffle(KEYS.flatMap(key => Array(room.counts[key]).fill(key)));
    room.players.forEach((p, i) => { p.role = deck[i]; });
    room.phase = 'started';
    room.round += 1;
    return json(res, 200, visible(room, player));
  }
  if (pathname === '/api/reset') {
    if (!isHost) fail('Only the host can start a new round.', 403);
    room.phase = 'lobby';
    room.players.forEach(p => { p.role = null; });
    return json(res, 200, visible(room, player));
  }
  if (pathname === '/api/kick') {
    if (!isHost) fail('Only the host can remove players.', 403);
    if (room.phase !== 'lobby') fail('You can only remove players before the game starts.');
    if (data.playerId === room.hostId) fail('The host cannot remove themselves.');
    const index = room.players.findIndex(p => p.id === data.playerId);
    if (index === -1) fail('Player not found.');
    room.players.splice(index, 1);
    return json(res, 200, visible(room, player));
  }
  if (pathname === '/api/leave') {
    if (isHost) {
      rooms.delete(room.code);
    } else {
      room.players = room.players.filter(p => p.id !== player.id);
    }
    return json(res, 200, {ok: true});
  }
  return json(res, 404, {error: 'Not found.'});
}

const server = http.createServer(async (req, res) => {
  try {
    const requestURL = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = requestURL.pathname;
    if (pathname === '/health') return json(res, 200, {ok: true});
    if (pathname.startsWith('/api/')) return await api(req, res, pathname, requestURL.searchParams);
    if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed.'});
    const asset = assets[pathname];
    if (!asset) return json(res, 404, {error: 'Not found.'});
    const [name, type] = asset;
    const buffer = await fs.promises.readFile(path.join(publicDir, name));
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    res.end(buffer);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, {error: error.status ? error.message : 'Something went wrong. Try again.'});
  }
});
setInterval(() => {
  for (const [code, room] of rooms) {
    if (Date.now() - room.updatedAt > ROOM_EXPIRY) rooms.delete(code);
  }
}, 15 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => console.log(`Werewolf Room listening on http://localhost:${PORT}`));
