'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { SimpleWebSocketServer } = require('./src/ws');
const { GameManager, MIN_PLAYERS, MAX_PLAYERS } = require('./src/gameEngine');
const { ANONYMOUS_AVATARS, getDeckList } = require('./src/questions');

const PUBLIC_DIR = path.join(__dirname, 'public');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function serveStatic(req, res) {
  const urlPath = (req.url || '/').split('?')[0];
  let relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  try {
    relPath = decodeURIComponent(relPath);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const resolved = path.resolve(PUBLIC_DIR, relPath);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      if (!urlPath.includes('.') && fs.existsSync(fallback)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(fallback).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

function createAppServer({
  spinDurationMs = 4300,
  answerTimeoutMs = 30000,
  botDelayMs = 950,
  seedRooms = true
} = {}) {
  const game = new GameManager({ spinDurationMs, answerTimeoutMs, botDelayMs, seedRooms });
  const connections = new Map(); // playerId -> wsClient

  const httpServer = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        rooms: game.rooms.size,
        players: connections.size
      });
    }

    if (req.method === 'GET' && urlPath === '/api/config') {
      return sendJson(res, 200, {
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        avatars: ANONYMOUS_AVATARS,
        decks: getDeckList()
      });
    }

    if (req.method === 'GET' && urlPath === '/api/rooms') {
      return sendJson(res, 200, { rooms: game.getPublicRooms() });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res);
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  });

  const wss = new SimpleWebSocketServer(httpServer, { path: '/ws' });

  function broadcastToRoom(roomCode, payload, excludePlayerId = null) {
    const room = game.rooms.get(roomCode);
    if (!room) return;
    for (const player of room.players) {
      if (player.isBot) continue;
      if (excludePlayerId && player.id === excludePlayerId) continue;
      const client = connections.get(player.id);
      if (client) client.sendJson(payload);
    }
  }

  function broadcastPublicRooms() {
    const publicRooms = game.getPublicRooms();
    for (const [pid, client] of connections.entries()) {
      if (!game.getRoomByPlayer(pid)) {
        client.sendJson({ type: 'public_rooms', rooms: publicRooms });
      }
    }
  }

  function sendAccountUpdate(playerId, extra = {}) {
    const client = connections.get(playerId);
    if (!client) return;
    const acc = game.getAccountByPlayer(playerId);
    client.sendJson({
      type: 'account_update',
      account: game.serializeAccount(acc),
      ...extra
    });
  }

  function makeRoomCallbacks() {
    return {
      onChange: (updatedRoom) => {
        broadcastToRoom(updatedRoom.code, {
          type: 'room_state',
          room: game.serializeRoom(updatedRoom)
        });
      },
      onExpire: (expiredRoom) => {
        broadcastToRoom(expiredRoom.code, {
          type: 'turn_expired',
          room: game.serializeRoom(expiredRoom)
        });
      }
    };
  }

  wss.on('connection', (ws) => {
    ws.on('error', () => {});
    const playerId = crypto.randomUUID();
    connections.set(playerId, ws);

    ws.sendJson({
      type: 'welcome',
      playerId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      avatars: ANONYMOUS_AVATARS,
      decks: getDeckList(),
      publicRooms: game.getPublicRooms()
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        ws.sendJson({ type: 'error', error: 'Geçersiz JSON mesajı.' });
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'authenticate': {
          const res = game.authenticate(playerId, msg.auth);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({
            type: 'auth_ok',
            account: res.account,
            restored: res.restored,
            publicRooms: game.getPublicRooms()
          });
          break;
        }

        case 'list_rooms': {
          ws.sendJson({ type: 'public_rooms', rooms: game.getPublicRooms() });
          break;
        }

        case 'create_room': {
          const res = game.createRoom(playerId, msg.options);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({ type: 'room_joined', room: res.room });
          broadcastPublicRooms();
          break;
        }

        case 'join_room': {
          const res = game.joinRoom(playerId, msg.code);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({ type: 'room_joined', room: res.room });
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room }, playerId);
          broadcastToRoom(res.room.code, { type: 'peer_joined', peerId: playerId }, playerId);
          broadcastPublicRooms();
          break;
        }

        case 'join_random': {
          const res = game.joinRandomPublicRoom(playerId);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({ type: 'room_joined', room: res.room });
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room }, playerId);
          broadcastToRoom(res.room.code, { type: 'peer_joined', peerId: playerId }, playerId);
          broadcastPublicRooms();
          break;
        }

        case 'add_bot': {
          const res = game.addBot(playerId);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          broadcastPublicRooms();
          break;
        }

        case 'leave_room': {
          const res = game.leaveRoom(playerId);
          ws.sendJson({ type: 'left_room', publicRooms: game.getPublicRooms() });
          if (res.ok && !res.roomDeleted) {
            broadcastToRoom(res.code, { type: 'room_state', room: res.room });
            broadcastToRoom(res.code, { type: 'peer_left', peerId: playerId });
          }
          broadcastPublicRooms();
          break;
        }

        case 'update_room_settings': {
          const res = game.updateRoomSettings(playerId, msg.settings);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          broadcastPublicRooms();
          break;
        }

        case 'spin_bottle': {
          const res = game.spinBottle(playerId, makeRoomCallbacks());
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, {
            type: 'bottle_spun',
            room: res.room,
            spin: res.spinResult
          });
          break;
        }

        case 'choose_mode': {
          const res = game.chooseMode(playerId, msg.mode, makeRoomCallbacks());
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          break;
        }

        case 'draw_card': {
          const res = game.drawDeckCard(playerId, msg.category);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({ type: 'card_drawn', card: res.card });
          break;
        }

        case 'submit_question': {
          const res = game.submitQuestion(playerId, msg.question, makeRoomCallbacks());
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          break;
        }

        case 'replace_question': {
          const res = game.replaceCenterQuestion(playerId, msg.text, makeRoomCallbacks());
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          break;
        }

        case 'submit_answer': {
          const res = game.submitWrittenAnswer(playerId, msg.text);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          break;
        }

        case 'complete_turn': {
          const res = game.completeTurn(playerId, msg.success !== false);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
          for (const ev of res.rewardEvents || []) {
            sendAccountUpdate(ev.playerId, { ticketsEarned: ev.ticketsEarned });
          }
          break;
        }

        case 'chat_message': {
          const res = game.sendChatMessage(playerId, msg.text, msg.mentionedIds);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.roomCode, {
            type: 'chat_message',
            message: res.message
          });

          // If a bot was mentioned, let the bot reply playfully after a short pause
          const room = game.rooms.get(res.roomCode);
          if (room && res.mentionedIds.length > 0) {
            for (const mId of res.mentionedIds) {
              const bot = room.players.find((p) => p.id === mId && p.isBot);
              if (bot) {
                const sender = room.players.find((p) => p.id === playerId);
                const senderAlias = sender ? sender.alias : 'Dostum';
                const replyTimer = setTimeout(() => {
                  const rCheck = game.rooms.get(res.roomCode);
                  if (!rCheck) return;
                  const replies = [
                    `Hop @${senderAlias} koltuğum sallandı, duydum seni! 😄`,
                    `Beni mi dürttün @${senderAlias}? Sıra bana mı geliyor yoksa 👀`,
                    `Mesajınla titredim, buradayım! ✨`
                  ];
                  const botMsg = {
                    id: crypto.randomUUID(),
                    type: 'user',
                    playerId: bot.id,
                    alias: bot.alias,
                    emoji: bot.emoji,
                    text: replies[Math.floor(Math.random() * replies.length)],
                    mentionedIds: [],
                    timestamp: Date.now()
                  };
                  rCheck.chat.push(botMsg);
                  if (rCheck.chat.length > 80) rCheck.chat.shift();
                  broadcastToRoom(res.roomCode, { type: 'chat_message', message: botMsg });
                }, Math.min(900, Math.max(50, botDelayMs)));
                if (replyTimer.unref) replyTimer.unref();
              }
            }
          }
          break;
        }

        case 'unlock_dm': {
          const targetId = typeof msg.targetKey === 'string' ? msg.targetKey : '';
          if (!targetId) return;
          const res = game.unlockDmContact(playerId, targetId);
          if (!res.ok) {
            if (res.noTickets) {
              ws.sendJson({ type: 'dm_no_tickets', error: res.error });
            } else {
              ws.sendJson({ type: 'error', error: res.error });
            }
            return;
          }
          ws.sendJson({
            type: 'dm_unlocked',
            targetKey: targetId,
            alreadyUnlocked: res.alreadyUnlocked,
            account: res.account
          });
          break;
        }

        case 'select_deck': {
          const res = game.selectDeck(playerId, msg.deckId);
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          ws.sendJson({
            type: 'deck_selected',
            deckId: res.deck.id,
            deckName: res.deck.shortName,
            account: res.account
          });
          if (res.room) {
            broadcastToRoom(res.room.code, { type: 'room_state', room: res.room });
            broadcastPublicRooms();
          }
          break;
        }

        case 'private_dm': {
          const targetKey = typeof msg.targetKey === 'string' ? msg.targetKey : '';
          const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 220) : '';
          if (!targetKey || !text) return;

          const senderAcc = game.getAccountByPlayer(playerId);
          // Find live recipient connection matching accountKey or playerId
          let delivered = false;
          for (const [otherId, otherClient] of connections.entries()) {
            if (otherId === playerId) continue;
            const otherAccKey = game.playerAccounts.get(otherId);
            if (otherId === targetKey || otherAccKey === targetKey) {
              otherClient.sendJson({
                type: 'private_dm_received',
                fromAccountKey: senderAcc.accountKey,
                fromAlias: senderAcc.alias,
                fromEmoji: senderAcc.emoji,
                text,
                timestamp: Date.now()
              });
              delivered = true;
            }
          }
          ws.sendJson({
            type: 'private_dm_sent',
            targetKey,
            text,
            delivered,
            timestamp: Date.now()
          });
          break;
        }

        case 'voice_state': {
          const res = game.setVoiceState(playerId, {
            micEnabled: msg.micEnabled,
            speaking: msg.speaking
          });
          if (!res.ok) {
            ws.sendJson({ type: 'error', error: res.error });
            return;
          }
          broadcastToRoom(res.roomCode, {
            type: 'voice_state',
            ...res.voiceUpdate
          });
          break;
        }

        case 'webrtc_signal': {
          const room = game.getRoomByPlayer(playerId);
          if (!room || room.chatMode === 'text') return;
          if (typeof msg.targetId !== 'string' || !msg.signal) return;
          const sameRoom = room.players.some((p) => p.id === msg.targetId && !p.isBot);
          if (!sameRoom) return;
          const targetClient = connections.get(msg.targetId);
          if (targetClient) {
            targetClient.sendJson({
              type: 'webrtc_signal',
              fromId: playerId,
              signal: msg.signal
            });
          }
          break;
        }

        case 'reaction': {
          const res = game.sendReaction(playerId, msg.emoji);
          if (!res.ok) return;
          broadcastToRoom(res.roomCode, { type: 'reaction', reaction: res.reaction });
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      connections.delete(playerId);
      const res = game.leaveRoom(playerId);
      if (res.ok) {
        if (!res.roomDeleted) {
          broadcastToRoom(res.code, { type: 'room_state', room: res.room });
          broadcastToRoom(res.code, { type: 'peer_left', peerId: playerId });
        }
        broadcastPublicRooms();
      }
    });
  });

  function shutdown() {
    for (const room of game.rooms.values()) {
      game._clearRoomTimers(room);
    }
    wss.close();
    httpServer.close();
  }

  return { httpServer, wss, game, shutdown };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const { httpServer } = createAppServer();

  httpServer.listen(PORT, HOST, () => {
    console.log(`Lokal — Anonim Sosyal Masa sunucusu çalışıyor: http://localhost:${PORT}`);
  });
}

module.exports = { createAppServer };
