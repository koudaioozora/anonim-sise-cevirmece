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
    for (let i = 0; i < len; i += 1) {
      masked[i] = payload[i] ^ mask[i & 3];
    }

    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  nextMessage(predicate = () => true, timeoutMs = 2000) {
    const idx = this.queue.findIndex(predicate);
    if (idx !== -1) {
      return Promise.resolve(this.queue.splice(idx, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const wIdx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (wIdx !== -1) this.waiters.splice(wIdx, 1);
        reject(new Error('Timed out waiting for WebSocket message'));
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        }
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

test('E2E HTTP + WebSocket multiplayer game flow and WebRTC signaling isolation', async () => {
  const { httpServer, shutdown } = createAppServer({ spinDurationMs: 25 });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  const c1 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const c2 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const c3 = new TestWsClient(`ws://127.0.0.1:${port}/ws`);
  const outsider = new TestWsClient(`ws://127.0.0.1:${port}/ws`);

  try {
    // Check HTTP endpoints & static serving + traversal guard
    const health = await httpGet(port, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const indexHtml = await httpGet(port, '/');
    assert.equal(indexHtml.status, 200);
    assert.match(indexHtml.body, /Anonim Şişe Çevirmece/);

    const traversal = await httpGet(port, '/../package.json');
    assert.equal(traversal.status, 403);

    await Promise.all([c1.connect(), c2.connect(), c3.connect(), outsider.connect()]);
    const w1 = await c1.nextMessage((m) => m.type === 'welcome');
    const w2 = await c2.nextMessage((m) => m.type === 'welcome');
    const w3 = await c3.nextMessage((m) => m.type === 'welcome');
    const wOut = await outsider.nextMessage((m) => m.type === 'welcome');

    // Player 1 creates room (public, max 6, both voice+text)
    c1.sendJson({
      type: 'create_room',
      profile: { nickname: 'Gizli Tilki', avatarId: 'fox' },
      options: { roomName: 'Test Masası', maxPlayers: 6, chatMode: 'both', isPublic: true }
    });
    const joined1 = await c1.nextMessage((m) => m.type === 'room_joined');
    const roomCode = joined1.room.code;
    assert.equal(joined1.room.players.length, 1);

    // Public rooms API reflects the new room
    const roomsRes = await httpGet(port, '/api/rooms');
    const roomsData = JSON.parse(roomsRes.body);
    assert.equal(roomsData.rooms.length, 1);
    assert.equal(roomsData.rooms[0].code, roomCode);

    // Players 2 & 3 join
    c2.sendJson({ type: 'join_room', code: roomCode, profile: { nickname: 'Gece Baykuşu', avatarId: 'owl' } });
    await c2.nextMessage((m) => m.type === 'room_joined');

    c3.sendJson({ type: 'join_room', code: roomCode, profile: { nickname: 'Mistik Kurt', avatarId: 'wolf' } });
    const joined3 = await c3.nextMessage((m) => m.type === 'room_joined');
    assert.equal(joined3.room.players.length, 3);
    assert.equal(joined3.room.phase, 'ready_to_spin');

    // WebRTC signaling works inside same room and is ignored for outsider
    c1.sendJson({ type: 'webrtc_signal', targetId: w2.playerId, signal: { candidate: { candidate: 'abc' } } });
    const relayed = await c2.nextMessage((m) => m.type === 'webrtc_signal');
    assert.equal(relayed.fromId, w1.playerId);

    c1.sendJson({ type: 'webrtc_signal', targetId: wOut.playerId, signal: { candidate: { candidate: 'leak' } } });

    // Spin bottle -> settles to choosing_mode
    c1.sendJson({ type: 'spin_bottle' });
    const spunMsg = await c1.nextMessage((m) => m.type === 'bottle_spun');
    assert.equal(spunMsg.room.phase, 'spinning');

    const settled = await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'choosing_mode');
    const { targetId, askerId } = settled.room.currentTurn;
    const clientsById = {
      [w1.playerId]: c1,
      [w2.playerId]: c2,
      [w3.playerId]: c3
    };

    // Target chooses truth
    clientsById[targetId].sendJson({ type: 'choose_mode', mode: 'truth' });
    await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'asking_question');

    // Asker draws a card and submits question
    clientsById[askerId].sendJson({ type: 'draw_card', category: 'Tümü' });
    const cardMsg = await clientsById[askerId].nextMessage((m) => m.type === 'card_drawn');
    assert.ok(cardMsg.card.text.length > 5);

    clientsById[askerId].sendJson({
      type: 'submit_question',
      question: { text: cardMsg.card.text, source: 'card', category: cardMsg.card.category }
    });
    await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'answering');

    // Chat message broadcasts to room
    c2.sendJson({ type: 'chat_message', text: 'Harika soru!' });
    const chatMsg = await c3.nextMessage((m) => m.type === 'chat_message');
    assert.equal(chatMsg.message.text, 'Harika soru!');

    // Complete turn
    clientsById[targetId].sendJson({ type: 'complete_turn', status: 'completed' });
    const finished = await c1.nextMessage((m) => m.type === 'room_state' && m.room.phase === 'ready_to_spin' && m.room.roundNumber === 1);
    assert.equal(finished.room.history.length, 1);

    // Ensure outsider never received any cross-room WebRTC signal
    assert.equal(outsider.queue.some((m) => m.type === 'webrtc_signal'), false);
  } finally {
    c1.close();
    c2.close();
    c3.close();
    outsider.close();
    shutdown();
  }
});
