'use strict';

const crypto = require('crypto');
const {
  ANONYMOUS_AVATARS,
  ANONYMOUS_COLORS,
  generateAnonymousNickname,
  getRandomCard
} = require('./questions');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const VALID_CHAT_MODES = ['both', 'text', 'voice'];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeDeg(deg) {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

function sanitizeText(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function sanitizeProfile(input = {}) {
  const rawNick = sanitizeText(input.nickname, 22);
  const nickname = rawNick.length >= 2 ? rawNick : generateAnonymousNickname();

  const foundAvatar = ANONYMOUS_AVATARS.find((a) => a.id === input.avatarId)
    || ANONYMOUS_AVATARS[Math.floor(Math.random() * ANONYMOUS_AVATARS.length)];

  const color = ANONYMOUS_COLORS.includes(input.color)
    ? input.color
    : ANONYMOUS_COLORS[Math.floor(Math.random() * ANONYMOUS_COLORS.length)];

  return {
    nickname,
    avatarId: foundAvatar.id,
    avatarEmoji: foundAvatar.emoji,
    color
  };
}

function computeBottleSpin(players, currentAngle = 0, lastTargetId = null) {
  const n = players.length;
  if (n < MIN_PLAYERS) {
    throw new Error('En az 2 oyuncu gerekli.');
  }

  let candidateIndices = players.map((_, idx) => idx);
  if (n >= 3 && lastTargetId) {
    const filtered = candidateIndices.filter((idx) => players[idx].id !== lastTargetId);
    if (filtered.length > 0) candidateIndices = filtered;
  }

  const targetIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
  const targetSeatAngle = (360 * targetIndex) / n;

  let askerIndex;
  let offsetDeg;

  if (n % 2 === 0) {
    askerIndex = (targetIndex + n / 2) % n;
    offsetDeg = Math.round((Math.random() * 6 - 3) * 10) / 10;
  } else {
    const ccwOpp = (targetIndex + Math.floor(n / 2)) % n;
    const cwOpp = (targetIndex + Math.ceil(n / 2)) % n;
    const useCw = Math.random() < 0.5;
    askerIndex = useCw ? cwOpp : ccwOpp;
    offsetDeg = useCw ? 10 : -10;
  }

  const desiredModAngle = normalizeDeg(targetSeatAngle + offsetDeg);
  const currentMod = normalizeDeg(currentAngle);
  const delta = normalizeDeg(desiredModAngle - currentMod);
  const extraSpins = (5 + Math.floor(Math.random() * 3)) * 360;
  const endAngle = Math.round((currentAngle + extraSpins + delta) * 10) / 10;

  return {
    targetIndex,
    askerIndex,
    targetId: players[targetIndex].id,
    askerId: players[askerIndex].id,
    startAngle: currentAngle,
    endAngle,
    desiredModAngle
  };
}

class GameManager {
  constructor({ spinDurationMs = 3600 } = {}) {
    this.rooms = new Map();
    this.playerToRoom = new Map();
    this.spinDurationMs = spinDurationMs;
  }

  _generateRoomCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let code = '';
      for (let i = 0; i < 6; i += 1) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  createRoom(hostId, profileInput, options = {}) {
    if (this.playerToRoom.has(hostId)) {
      this.leaveRoom(hostId);
    }

    const code = this._generateRoomCode();
    const maxPlayersRaw = Number(options.maxPlayers);
    const maxPlayers = Number.isFinite(maxPlayersRaw)
      ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(maxPlayersRaw)))
      : MAX_PLAYERS;

    const chatMode = VALID_CHAT_MODES.includes(options.chatMode) ? options.chatMode : 'both';
    const isPublic = options.isPublic !== false;
    const rawRoomName = sanitizeText(options.roomName, 32);
    const roomName = rawRoomName.length >= 2 ? rawRoomName : `Anonim Masa #${code.slice(0, 3)}`;

    const profile = sanitizeProfile(profileInput);
    const hostPlayer = {
      id: hostId,
      ...profile,
      isHost: true,
      score: 0,
      micEnabled: false,
      speaking: false,
      joinedAt: Date.now()
    };

    const room = {
      code,
      name: roomName,
      isPublic,
      maxPlayers,
      minPlayers: MIN_PLAYERS,
      chatMode,
      hostId,
      players: [hostPlayer],
      phase: 'waiting',
      bottleAngle: 0,
      roundNumber: 0,
      lastTargetId: null,
      nextSpinnerId: null,
      currentTurn: null,
      history: [],
      chat: [],
      spinTimer: null,
      createdAt: Date.now()
    };

    this._addSystemMessage(room, `${hostPlayer.nickname} anonim masayı kurdu. Şişe çevirmek için en az 2 kişi bekleniyor.`);
    this.rooms.set(code, room);
    this.playerToRoom.set(hostId, code);

    return { ok: true, room: this.serializeRoom(room), playerId: hostId };
  }

  joinRoom(playerId, codeInput, profileInput) {
    const code = sanitizeText(String(codeInput || '').toUpperCase(), 10);
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: 'Oda bulunamadı veya kapatılmış.' };
    }

    if (room.players.some((p) => p.id === playerId)) {
      return { ok: true, room: this.serializeRoom(room), playerId };
    }

    if (this.playerToRoom.has(playerId)) {
      this.leaveRoom(playerId);
    }

    if (room.players.length >= room.maxPlayers) {
      return { ok: false, error: `Bu oda dolu (${room.players.length}/${room.maxPlayers}).` };
    }

    const profile = sanitizeProfile(profileInput);
    const player = {
      id: playerId,
      ...profile,
      isHost: false,
      score: 0,
      micEnabled: false,
      speaking: false,
      joinedAt: Date.now()
    };

    room.players.push(player);
    this.playerToRoom.set(playerId, room.code);

    if (room.phase === 'waiting' && room.players.length >= room.minPlayers) {
      room.phase = 'ready_to_spin';
      this._addSystemMessage(room, `${player.nickname} masaya katıldı! Artık şişe çevrilebilir.`);
    } else {
      this._addSystemMessage(room, `${player.nickname} masaya katıldı (${room.players.length}/${room.maxPlayers}).`);
    }

    return { ok: true, room: this.serializeRoom(room), playerId, joinedPlayer: this._serializePlayer(player) };
  }

  leaveRoom(playerId) {
    const code = this.playerToRoom.get(playerId);
    if (!code) return { ok: false };

    this.playerToRoom.delete(playerId);
    const room = this.rooms.get(code);
    if (!room) return { ok: false };

    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return { ok: false };

    const [removed] = room.players.splice(idx, 1);

    if (room.players.length === 0) {
      if (room.spinTimer) clearTimeout(room.spinTimer);
      this.rooms.delete(code);
      return { ok: true, roomDeleted: true, code, removedPlayer: removed };
    }

    if (removed.isHost) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
      this._addSystemMessage(room, `${removed.nickname} ayrıldı. Yeni oda yöneticisi: ${room.players[0].nickname}.`);
    } else {
      this._addSystemMessage(room, `${removed.nickname} masadan ayrıldı.`);
    }

    if (room.nextSpinnerId === playerId) {
      room.nextSpinnerId = room.players[0].id;
    }

    const activeTurnInvolved = room.currentTurn
      && (room.currentTurn.targetId === playerId || room.currentTurn.askerId === playerId);

    if (room.players.length < room.minPlayers) {
      if (room.spinTimer) {
        clearTimeout(room.spinTimer);
        room.spinTimer = null;
      }
      room.phase = 'waiting';
      room.currentTurn = null;
      this._addSystemMessage(room, 'Oyuncu sayısı 2\'nin altına düştü. Yeni oyuncu bekleniyor.');
    } else if (activeTurnInvolved) {
      if (room.spinTimer) {
        clearTimeout(room.spinTimer);
        room.spinTimer = null;
      }
      room.phase = 'ready_to_spin';
      room.currentTurn = null;
      this._addSystemMessage(room, 'Turdaki bir oyuncu ayrıldığı için şişe yeniden çevrilmeye hazır.');
    }

    return {
      ok: true,
      roomDeleted: false,
      code,
      removedPlayer: removed,
      room: this.serializeRoom(room)
    };
  }

  updateRoomSettings(playerId, settings = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Odada değilsiniz.' };
    if (room.hostId !== playerId) return { ok: false, error: 'Sadece oda yöneticisi ayarları değiştirebilir.' };
    if (room.phase !== 'waiting' && room.phase !== 'ready_to_spin') {
      return { ok: false, error: 'Tur devam ederken oda ayarları değiştirilemez.' };
    }

    if (settings.chatMode && VALID_CHAT_MODES.includes(settings.chatMode)) {
      room.chatMode = settings.chatMode;
      if (room.chatMode === 'text') {
        for (const p of room.players) {
          p.micEnabled = false;
          p.speaking = false;
        }
      }
      const labels = { both: 'Sesli + Yazılı', text: 'Sadece Yazılı', voice: 'Sadece Sesli' };
      this._addSystemMessage(room, `Sohbet modu güncellendi: ${labels[room.chatMode]}.`);
    }

    if (typeof settings.isPublic === 'boolean') {
      room.isPublic = settings.isPublic;
    }

    return { ok: true, room: this.serializeRoom(room) };
  }

  spinBottle(playerId, onSpinSettled = null) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };

    if (room.players.length < room.minPlayers) {
      return { ok: false, error: `Şişeyi çevirmek için en az ${room.minPlayers} kişi gereklidir.` };
    }

    if (room.phase !== 'ready_to_spin') {
      return { ok: false, error: 'Şu anda şişe çevrilemez.' };
    }

    if (room.nextSpinnerId && room.nextSpinnerId !== playerId && room.hostId !== playerId) {
      const spinner = room.players.find((p) => p.id === room.nextSpinnerId);
      return {
        ok: false,
        error: `Şişe çevirme sırası ${spinner ? spinner.nickname : 'sıradaki oyuncuda'}.`
      };
    }

    const spinResult = computeBottleSpin(room.players, room.bottleAngle, room.lastTargetId);
    room.roundNumber += 1;
    room.phase = 'spinning';
    room.bottleAngle = spinResult.endAngle;
    room.lastTargetId = spinResult.targetId;

    const targetPlayer = room.players[spinResult.targetIndex];
    const askerPlayer = room.players[spinResult.askerIndex];

    room.currentTurn = {
      roundNumber: room.roundNumber,
      spinnerId: playerId,
      targetId: targetPlayer.id,
      askerId: askerPlayer.id,
      spinStartAngle: spinResult.startAngle,
      spinEndAngle: spinResult.endAngle,
      spinDurationMs: this.spinDurationMs,
      mode: null,
      question: null,
      answerText: null
    };

    const settle = () => {
      room.spinTimer = null;
      if (room.phase !== 'spinning' || !room.currentTurn) return;
      room.phase = 'choosing_mode';
      this._addSystemMessage(
        room,
        `🍾 Tur ${room.roundNumber}: Şişenin ucu ${targetPlayer.nickname}'i, arkası ${askerPlayer.nickname}'i gösterdi!`
      );
      if (typeof onSpinSettled === 'function') {
        onSpinSettled(room);
      }
    };

    if (this.spinDurationMs <= 0) {
      settle();
    } else {
      room.spinTimer = setTimeout(settle, this.spinDurationMs);
      if (room.spinTimer.unref) room.spinTimer.unref();
    }

    return { ok: true, room: this.serializeRoom(room), spinResult };
  }

  chooseMode(playerId, mode) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.phase !== 'choosing_mode' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda Doğruluk/Cesaret seçimi yapılamaz.' };
    }
    if (room.currentTurn.targetId !== playerId) {
      return { ok: false, error: 'Sadece şişenin ucunun gösterdiği oyuncu seçim yapabilir.' };
    }
    if (mode !== 'truth' && mode !== 'dare') {
      return { ok: false, error: 'Geçersiz seçim. Doğruluk veya Cesaret seçin.' };
    }

    room.currentTurn.mode = mode;
    room.phase = 'asking_question';
    const target = room.players.find((p) => p.id === room.currentTurn.targetId);
    const asker = room.players.find((p) => p.id === room.currentTurn.askerId);
    const label = mode === 'truth' ? 'Doğruluk' : 'Cesaret';
    this._addSystemMessage(
      room,
      `${target ? target.nickname : 'Oyuncu'} "${label}" seçti! ${asker ? asker.nickname : 'Soran'} soru/görev hazırlıyor.`
    );

    return { ok: true, room: this.serializeRoom(room) };
  }

  drawDeckCard(playerId, category = 'Tümü') {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.phase !== 'asking_question' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda kart çekilemez.' };
    }
    if (room.currentTurn.askerId !== playerId) {
      return { ok: false, error: 'Sadece şişenin arkasındaki oyuncu kart çekebilir.' };
    }

    const card = getRandomCard(room.currentTurn.mode, category);
    return { ok: true, card };
  }

  submitQuestion(playerId, payload = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.phase !== 'asking_question' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda soru gönderilemez.' };
    }
    if (room.currentTurn.askerId !== playerId) {
      return { ok: false, error: 'Sadece şişenin arkasındaki oyuncu soru sorabilir.' };
    }

    const source = payload.source === 'card' || payload.source === 'voice' ? payload.source : 'custom';
    let text = sanitizeText(payload.text, 280);

    if (source === 'voice') {
      if (room.chatMode === 'text') {
        return { ok: false, error: 'Sadece yazılı odada sesli soru seçeneği kullanılamaz.' };
      }
      if (!text) {
        text = '🎙️ Soru / görev sesli olarak soruluyor!';
      }
    } else if (text.length < 3) {
      return { ok: false, error: 'Lütfen en az 3 karakterlik bir soru veya görev yazın.' };
    }

    room.currentTurn.question = {
      text,
      source,
      category: sanitizeText(payload.category, 30) || (source === 'custom' ? 'Özel' : 'Kart'),
      askedAt: Date.now()
    };
    room.phase = 'answering';

    const asker = room.players.find((p) => p.id === room.currentTurn.askerId);
    this._addSystemMessage(room, `❓ ${asker ? asker.nickname : 'Soran'}: "${text}"`);

    return { ok: true, room: this.serializeRoom(room) };
  }

  submitWrittenAnswer(playerId, answerInput) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.phase !== 'answering' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda yazılı yanıt gönderilemez.' };
    }
    if (room.currentTurn.targetId !== playerId) {
      return { ok: false, error: 'Sadece soruya muhatap olan oyuncu yanıt gönderebilir.' };
    }
    if (room.chatMode === 'voice') {
      return { ok: false, error: 'Bu oda Sadece Sesli modda. Cevabını mikrofon ile verip Tamamladım butonuna basabilirsin.' };
    }

    const answerText = sanitizeText(answerInput, 320);
    if (!answerText) {
      return { ok: false, error: 'Yanıt boş olamaz.' };
    }

    room.currentTurn.answerText = answerText;
    const target = room.players.find((p) => p.id === playerId);
    this._addSystemMessage(room, `💬 ${target ? target.nickname : 'Oyuncu'} yanıtladı: "${answerText}"`);

    return { ok: true, room: this.serializeRoom(room) };
  }

  completeTurn(playerId, status = 'completed') {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.phase !== 'answering' || !room.currentTurn) {
      return { ok: false, error: 'Tamamlanacak aktif bir tur yok.' };
    }

    const { targetId, askerId } = room.currentTurn;
    if (playerId !== targetId && playerId !== askerId && playerId !== room.hostId) {
      return { ok: false, error: 'Turu sadece cevaplayan, soran veya oda yöneticisi bitirebilir.' };
    }

    const skipped = status === 'skipped';
    const target = room.players.find((p) => p.id === targetId);
    const asker = room.players.find((p) => p.id === askerId);

    if (target && !skipped) {
      target.score += 1;
    }

    room.history.unshift({
      roundNumber: room.currentTurn.roundNumber,
      mode: room.currentTurn.mode,
      targetNickname: target ? target.nickname : 'Anonim',
      askerNickname: asker ? asker.nickname : 'Anonim',
      question: room.currentTurn.question ? room.currentTurn.question.text : '',
      answerText: room.currentTurn.answerText,
      skipped,
      finishedAt: Date.now()
    });
    if (room.history.length > 20) room.history.pop();

    const modeLabel = room.currentTurn.mode === 'truth' ? 'Doğruluk' : 'Cesaret';
    this._addSystemMessage(
      room,
      skipped
        ? `🏳️ ${target ? target.nickname : 'Oyuncu'} ${modeLabel} turunu pas geçti.`
        : `✅ ${target ? target.nickname : 'Oyuncu'} ${modeLabel} turunu tamamladı! Sıradaki çeviren: ${target ? target.nickname : 'Oda'}.`
    );

    room.nextSpinnerId = target ? target.id : room.players[0].id;
    room.currentTurn = null;
    room.phase = room.players.length >= room.minPlayers ? 'ready_to_spin' : 'waiting';

    return { ok: true, room: this.serializeRoom(room) };
  }

  sendChatMessage(playerId, textInput) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };

    if (room.chatMode === 'voice') {
      return { ok: false, error: 'Bu oda Sadece Sesli modda. Yazılı sohbet kapalı.' };
    }

    const text = sanitizeText(textInput, 400);
    if (!text) return { ok: false, error: 'Boş mesaj gönderilemez.' };

    const sender = room.players.find((p) => p.id === playerId);
    if (!sender) return { ok: false, error: 'Oyuncu bulunamadı.' };

    const msg = {
      id: crypto.randomUUID(),
      type: 'user',
      playerId: sender.id,
      nickname: sender.nickname,
      avatarEmoji: sender.avatarEmoji,
      color: sender.color,
      text,
      timestamp: Date.now()
    };

    room.chat.push(msg);
    if (room.chat.length > 80) room.chat.shift();

    return { ok: true, message: msg, roomCode: room.code };
  }

  setVoiceState(playerId, { micEnabled, speaking } = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    if (room.chatMode === 'text') {
      return { ok: false, error: 'Bu oda Sadece Yazılı modda. Sesli sohbet kapalı.' };
    }

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: 'Oyuncu bulunamadı.' };

    if (typeof micEnabled === 'boolean') {
      player.micEnabled = micEnabled;
      if (!micEnabled) player.speaking = false;
    }
    if (typeof speaking === 'boolean') {
      player.speaking = player.micEnabled ? speaking : false;
    }

    return {
      ok: true,
      roomCode: room.code,
      voiceUpdate: {
        playerId: player.id,
        micEnabled: player.micEnabled,
        speaking: player.speaking
      }
    };
  }

  sendReaction(playerId, emojiInput) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir odada değilsiniz.' };
    const allowed = ['👏', '😂', '🔥', '😱', '🤫', '👀', '💜'];
    if (!allowed.includes(emojiInput)) return { ok: false, error: 'Geçersiz tepki.' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: 'Oyuncu bulunamadı.' };

    return {
      ok: true,
      roomCode: room.code,
      reaction: {
        id: crypto.randomUUID(),
        playerId: player.id,
        nickname: player.nickname,
        emoji: emojiInput
      }
    };
  }

  getRoomByPlayer(playerId) {
    const code = this.playerToRoom.get(playerId);
    return code ? this.rooms.get(code) || null : null;
  }

  getPublicRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic) continue;
      list.push({
        code: room.code,
        name: room.name,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        minPlayers: room.minPlayers,
        chatMode: room.chatMode,
        phase: room.phase,
        isFull: room.players.length >= room.maxPlayers
      });
    }
    return list.sort((a, b) => b.playerCount - a.playerCount);
  }

  _addSystemMessage(room, text) {
    const msg = {
      id: crypto.randomUUID(),
      type: 'system',
      text,
      timestamp: Date.now()
    };
    room.chat.push(msg);
    if (room.chat.length > 80) room.chat.shift();
    return msg;
  }

  _serializePlayer(player) {
    return {
      id: player.id,
      nickname: player.nickname,
      avatarId: player.avatarId,
      avatarEmoji: player.avatarEmoji,
      color: player.color,
      isHost: player.isHost,
      score: player.score,
      micEnabled: player.micEnabled,
      speaking: player.speaking
    };
  }

  serializeRoom(room) {
    return {
      code: room.code,
      name: room.name,
      isPublic: room.isPublic,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      chatMode: room.chatMode,
      hostId: room.hostId,
      phase: room.phase,
      bottleAngle: room.bottleAngle,
      roundNumber: room.roundNumber,
      nextSpinnerId: room.nextSpinnerId,
      currentTurn: room.currentTurn ? { ...room.currentTurn } : null,
      players: room.players.map((p) => this._serializePlayer(p)),
      history: room.history.slice(0, 12),
      chat: room.chat.slice(-50)
    };
  }
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  VALID_CHAT_MODES,
  GameManager,
  computeBottleSpin,
  sanitizeProfile,
  normalizeDeg
};
