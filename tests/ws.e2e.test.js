'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createAppServer } = require('../server');

class TestWsClient {
  constructor(urlStr) {
    this.url = new URL(urlStr);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: this.url.hostname,
        port: Number(this.url.port),
        path: this.url.pathname,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13'
        }
      });

      req.on('upgrade', (_res, socket, head) => {
        this.socket = socket;
        socket.on('data', (chunk) => this._onData(chunk));
        if (head && head.length) this._onData(head);
        resolve();
      });
      req.on('error', reject);
      req.end();
    });
  }

  sendJson(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x81;
      header[1] = 0x80 | len;
    } else {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    }
    const masked = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  nextMessage(predicate = () => true, timeoutMs = 2500) {
    const idx = this.queue.findIndex(predicate);
    if (idx !== -1) return Promise.resolve(this.queue.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const wIdx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx !== -1) this.waiters.splice(wIdx, 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); }
      });
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      let len = this.buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        len = this.buffer.readUInt32BE(6);
        offset = 10;
      }
      if (this.buffer.length < offset + len) return;
      const payload = this.buffer.subarray(offset, offset + len);
      this.buffer = this.buffer.subarray(offset + len);
      if (opcode === 0x1) {
        const parsed = JSON.parse(payload.toString('utf8'));
        const wIdx = this.waiters.findIndex((w) => w.predicate(parsed));
        if (wIdx !== -1) {
          const [w] = this.waiters.splice(wIdx, 1);
          w.resolve(parsed);
        } else {
          this.queue.push(parsed);
        }
      }
    }
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

function httpGet(port, reqPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: reqPath }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('Lokal E2E: auth, spin, 30s question replace, +25P reward, @mention vibration, and live private DM', async () => {
  const { httpServer, shutdown } = createAppServer({
    spinDurationMs: 25,
    answerTimeoutMs: 5000,
    botDelayMs: 20,
    seedRooms: false
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  const c1 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const c2 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);

  try {
    const indexRes = await httpGet(port, '/');
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.body, /Mekan'a Hoş Geldin/);
    assert.equal((await httpGet(port, '/../package.json')).status, 403);

    await Promise.all([c1.connect(), c2.connect()]);
    const w1 = await c1.nextMessage((m) => m.type === 'welcome');
    const w2 = await c2.nextMessage((m) => m.type === 'welcome');

    c1.sendJson({ type: 'authenticate', auth: { mode: 'secret', alias: 'Mistik Tilki', secretKey: 'anahtar1' } });
    const a1 = await c1.nextMessage((m) => m.type === 'auth_ok');
    assert.equal(a1.account.score, 100);
    assert.equal(a1.account.dmTickets, 1);

    c2.sendJson({ type: 'authenticate', auth: { mode: 'visitor' } });
    const a2 = await c2.nextMessage((m) => m.type === 'auth_ok');

    // c1 creates room, c2 joins via join_random
    c1.sendJson({ type: 'create_room', options: { roomName: 'Gece Kahvesi', maxPlayers: 4, chatMode: 'both', isPublic: true } });
    await c1.nextMessage((m) => m.type === 'room_joined');

    c2.sendJson({ type: 'join_random' });
    const joined2 = await c2.nextMessage((m) => m.type === 'room_joined');
    assert.equal(joined2.room.players.length, 2);
    assert.equal(joined2.room.phase, 'ready_to_spin');

    // Spin -> choose_mode -> submit_question -> replace_question -> complete_turn
    c1.sendJson({ type: 'spin_bottle' });
    const choosing = await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'choosing_mode');
    const { targetId, askerId } = choosing.room.currentTurn;
    const byId = { [w1.playerId]: c1, [w2.playerId]: c2 };

    byId[targetId].sendJson({ type: 'choose_mode', mode: 'truth' });
    await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'asking_question');

    byId[askerId].sendJson({ type: 'submit_question', question: { text: 'İlk soru nedir?', source: 'custom' } });
    await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'answering');

    byId[askerId].sendJson({ type: 'replace_question', text: 'Güncellenmiş soru nedir?' });
    const replaced = await c2.nextMessage((m) => m.type === 'room_state' && m.room.currentTurn?.question?.text === 'Güncellenmiş soru nedir?');
    assert.ok(replaced.room.currentTurn.answerDeadline > Date.now());

    // @mention triggers mentionedIds broadcast
    c2.sendJson({ type: 'chat_message', text: '@Mistik Tilki selam!', mentionedIds: [w1.playerId] });
    const chat = await c1.nextMessage((m) => m.type === 'chat_message');
    assert.deepEqual(chat.message.mentionedIds, [w1.playerId]);

    // Complete turn -> +25P
    byId[targetId].sendJson({ type: 'complete_turn', success: true });
    await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'ready_to_spin' && m.room.roundNumber === 1);
    const upd = await byId[targetId].nextMessage((m) => m.type === 'account_update');
    assert.equal(upd.account.score, 125);

    // c1 unlocks DM with c2 and sends live private DM
    c1.sendJson({ type: 'unlock_dm', targetKey: a2.account.accountKey });
    const unlocked = await c1.nextMessage((m) => m.type === 'dm_unlocked');
    assert.equal(unlocked.account.dmTickets, 0);

    c1.sendJson({ type: 'private_dm', targetKey: a2.account.accountKey, text: 'Gizli mektup geldi!' });
    const dmRecv = await c2.nextMessage((m) => m.type === 'private_dm_received');
    assert.equal(dmRecv.text, 'Gizli mektup geldi!');
    assert.equal(dmRecv.fromAccountKey, a1.account.accountKey);
  } finally {
    c1.close();
    c2.close();
    shutdown();
  }
});

test('Lokal E2E: starter rooms stay alive and abrupt ECONNRESET does not crash server', async () => {
  const { httpServer, shutdown } = createAppServer({ spinDurationMs: 25, answerTimeoutMs: 5000, botDelayMs: 10, seedRooms: true });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  const c1 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const c2 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);

  try {
    await c1.connect();
    const w1 = await c1.nextMessage((m) => m.type === 'welcome');
    assert.ok(w1.publicRooms.length >= 3);

    c1.sendJson({ type: 'authenticate', auth: { mode: 'visitor' } });
    await c1.nextMessage((m) => m.type === 'auth_ok');
    c1.sendJson({ type: 'join_random' });
    const joined = await c1.nextMessage((m) => m.type === 'room_joined');
    assert.ok(joined.room.players.length >= 2);

    // Force abrupt TCP RST (ECONNRESET)
    c1.socket.resetAndDestroy();
    await new Promise((r) => setTimeout(r, 40));

    // Server remains healthy and serves subsequent client
    await c2.connect();
    const w2 = await c2.nextMessage((m) => m.type === 'welcome');
    assert.ok(w2.publicRooms.length >= 3);
    const health = await httpGet(port, '/api/health');
    assert.equal(health.status, 200);
  } finally {
    c1.close();
    c2.close();
    shutdown();
  }
});

test('Lokal E2E: all decks free in room, no ad/payment modals in UI, and dm_no_tickets prompt', async () => {
  const { httpServer, shutdown } = createAppServer({
    spinDurationMs: 20,
    answerTimeoutMs: 5000,
    botDelayMs: 10,
    seedRooms: false
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  const c1 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const c2 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);

  try {
    const indexRes = await httpGet(port, '/');
    assert.equal(indexRes.status, 200);
    assert.doesNotMatch(indexRes.body, /adSimulatorModal|shopModal|watchAdHeaderBtn|₺49|₺129|₺199/);

    await Promise.all([c1.connect(), c2.connect()]);
    const w1 = await c1.nextMessage((m) => m.type === 'welcome');
    assert.equal(w1.decks.length, 4);
    assert.ok(w1.decks.reduce((s, d) => s + d.cardCount, 0) >= 400);

    c1.sendJson({ type: 'authenticate', auth: { mode: 'visitor' } });
    await c1.nextMessage((m) => m.type === 'auth_ok');
    c2.sendJson({ type: 'authenticate', auth: { mode: 'visitor' } });
    const a2 = await c2.nextMessage((m) => m.type === 'auth_ok');

    c1.sendJson({ type: 'create_room', options: { maxPlayers: 4, chatMode: 'both', isPublic: true } });
    await c1.nextMessage((m) => m.type === 'room_joined');
    c2.sendJson({ type: 'join_random' });
    await c2.nextMessage((m) => m.type === 'room_joined');

    // Use 1 starting ticket, then trigger dm_no_tickets without ad/shop wording
    c1.sendJson({ type: 'unlock_dm', targetKey: a2.account.accountKey });
    await c1.nextMessage((m) => m.type === 'dm_unlocked');
    c1.sendJson({ type: 'unlock_dm', targetKey: 'another_key' });
    const fomo = await c1.nextMessage((m) => m.type === 'dm_no_tickets');
    assert.match(fomo.error, /Özel Mektup Hakkın kalmadı/i);
    assert.doesNotMatch(fomo.error, /reklam|dükkan/i);

    // Select psychology deck directly for free
    c1.sendJson({ type: 'select_deck', deckId: 'psychology' });
    const deckBroadcast = await c2.nextMessage((m) => m.type === 'room_state' && m.room.deckId === 'psychology');
    assert.equal(deckBroadcast.room.deckId, 'psychology');
  } finally {
    c1.close();
    c2.close();
    shutdown();
  }
});
