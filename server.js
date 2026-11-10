'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { SimpleWebSocketServer } = require('./src/ws');
const { GameManager, MIN_PLAYERS, MAX_PLAYERS } = require('./src/gameEngine');
const { ANONYMOUS_AVATARS, ANONYMOUS_COLORS } = require('./src/questions');

const PUBLIC_DIR = path.join(__dirname, 'public');

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
      const indexFallback = path.join(PUBLIC_DIR, 'index.html');
      if (!urlPath.includes('.') && fs.existsSync(indexFallback)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        });
        fs.createReadStream(indexFallback).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' || resolved.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

function createAppServer({ spinDurationMs = 3600 } = {}) {
  const game = new GameManager({ spinDurationMs });
  const connections = new Map(); // playerId -> wsClient

  const httpServer = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

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
        colors: ANONYMOUS_COLORS
      });
    }

    if (req.method === 'GET' && urlPath === '/api/rooms') {
      return sendJson(res, 200, {
        rooms: game.getPublicRooms()
      });
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

  wss.on('connection', (ws) => {
    const playerId = crypto.randomUUID();
    connections.set(playerId, ws);

    ws.sendJson({
      type: 'welcome',
      playerId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      avatars: ANONYMOUS_AVATARS,
      colors: ANONYMOUS_COLORS,
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
        case 'list_rooms': {
          ws.sendJson({ type: 'public_rooms', rooms: game.getPublicRooms() });
          break;
        }

        case 'create_room': {
          const result = game.createRoom(playerId, msg.profile, msg.options);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          ws.sendJson({ type: 'room_joined', room: result.room });
          broadcastPublicRooms();
          break;
        }

        case 'join_room': {
          const result = game.joinRoom(playerId, msg.code, msg.profile);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          ws.sendJson({ type: 'room_joined', room: result.room });
          broadcastToRoom(result.room.code, {
            type: 'room_state',
            room: result.room
          }, playerId);
          broadcastToRoom(result.room.code, {
            type: 'peer_joined',
            peerId: playerId
          }, playerId);
          broadcastPublicRooms();
          break;
        }

        case 'leave_room': {
          const result = game.leaveRoom(playerId);
          ws.sendJson({ type: 'left_room', publicRooms: game.getPublicRooms() });
          if (result.ok && !result.roomDeleted) {
            broadcastToRoom(result.code, { type: 'room_state', room: result.room });
            broadcastToRoom(result.code, { type: 'peer_left', peerId: playerId });
          }
          broadcastPublicRooms();
          break;
        }

        case 'update_room_settings': {
          const result = game.updateRoomSettings(playerId, msg.settings);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, { type: 'room_state', room: result.room });
          broadcastPublicRooms();
          break;
        }

        case 'spin_bottle': {
          const result = game.spinBottle(playerId, (settledRoom) => {
            broadcastToRoom(settledRoom.code, {
              type: 'room_state',
              room: game.serializeRoom(settledRoom)
            });
          });
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, {
            type: 'bottle_spun',
            room: result.room,
            spin: result.spinResult
          });
          break;
        }

        case 'choose_mode': {
          const result = game.chooseMode(playerId, msg.mode);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, { type: 'room_state', room: result.room });
          break;
        }

        case 'draw_card': {
          const result = game.drawDeckCard(playerId, msg.category);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          ws.sendJson({ type: 'card_drawn', card: result.card });
          break;
        }

        case 'submit_question': {
          const result = game.submitQuestion(playerId, msg.question);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, { type: 'room_state', room: result.room });
          break;
        }

        case 'submit_answer': {
          const result = game.submitWrittenAnswer(playerId, msg.text);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, { type: 'room_state', room: result.room });
          break;
        }

        case 'complete_turn': {
          const result = game.completeTurn(playerId, msg.status);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.room.code, { type: 'room_state', room: result.room });
          break;
        }

        case 'chat_message': {
          const result = game.sendChatMessage(playerId, msg.text);
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.roomCode, {
            type: 'chat_message',
            message: result.message
          });
          break;
        }

        case 'voice_state': {
          const result = game.setVoiceState(playerId, {
            micEnabled: msg.micEnabled,
            speaking: msg.speaking
          });
          if (!result.ok) {
            ws.sendJson({ type: 'error', error: result.error });
            return;
          }
          broadcastToRoom(result.roomCode, {
            type: 'voice_state',
            ...result.voiceUpdate
          });
          break;
        }

        case 'webrtc_signal': {
          const room = game.getRoomByPlayer(playerId);
          if (!room || room.chatMode === 'text') return;
          if (typeof msg.targetId !== 'string' || !msg.signal) return;
          const isSameRoom = room.players.some((p) => p.id === msg.targetId);
          if (!isSameRoom) return;
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
          const result = game.sendReaction(playerId, msg.emoji);
          if (!result.ok) return;
          broadcastToRoom(result.roomCode, {
            type: 'reaction',
            reaction: result.reaction
          });
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      connections.delete(playerId);
      const result = game.leaveRoom(playerId);
      if (result.ok) {
        if (!result.roomDeleted) {
          broadcastToRoom(result.code, { type: 'room_state', room: result.room });
          broadcastToRoom(result.code, { type: 'peer_left', peerId: playerId });
        }
        broadcastPublicRooms();
      }
    });
  });

  function shutdown() {
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
    console.log(`Anonim Şişe Çevirmece sunucusu çalışıyor: http://localhost:${PORT}`);
  });
}

module.exports = { createAppServer };
