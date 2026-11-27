'use strict';

const crypto = require('crypto');
const {
  ANONYMOUS_AVATARS,
  DECKS,
  generateAnonymousIdentity,
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
  const extraSpins = (5 + Math.floor(Math.random() * 2)) * 360;
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
  constructor({
    spinDurationMs = 4300,
    answerTimeoutMs = 30000,
    botDelayMs = 950,
    seedRooms = false
  } = {}) {
    this.rooms = new Map();
    this.playerToRoom = new Map();
    this.accounts = new Map();
    this.playerAccounts = new Map();
    this.spinDurationMs = spinDurationMs;
    this.answerTimeoutMs = answerTimeoutMs;
    this.botDelayMs = botDelayMs;
    if (seedRooms) this.seedStarterRooms();
  }

  seedStarterRooms() {
    const presets = [
      { code: 'GECE01', name: 'Gece Kuşları D-C Masası', maxPlayers: 6, chatMode: 'both', deckId: 'classic', bots: 2 },
      { code: 'SIR002', name: 'Sırlar Odası (Yazılı)', maxPlayers: 6, chatMode: 'text', deckId: 'classic', bots: 1 },
      { code: 'KAMP03', name: 'Kamp Ateşi Sohbeti', maxPlayers: 4, chatMode: 'both', deckId: 'classic', bots: 1 }
    ];
    for (const p of presets) {
      if (this.rooms.has(p.code)) continue;
      const bots = [];
      for (let i = 0; i < p.bots; i += 1) {
        const rnd = generateAnonymousIdentity();
        const botId = `bot_${p.code.toLowerCase()}_${i + 1}`;
        bots.push({
          id: botId,
          accountKey: botId,
          alias: rnd.alias,
          avatarId: rnd.avatarId,
          emoji: rnd.emoji,
          score: 60 + i * 20,
          isHost: false,
          isBot: true,
          micEnabled: false,
          speaking: false,
          joinedAt: Date.now()
        });
        this.playerToRoom.set(botId, p.code);
      }
      const room = {
        code: p.code,
        name: p.name,
        isPublic: true,
        keepAlive: true,
        maxPlayers: p.maxPlayers,
        minPlayers: MIN_PLAYERS,
        chatMode: p.chatMode,
        deckId: p.deckId,
        hostId: null,
        players: bots,
        phase: bots.length >= MIN_PLAYERS ? 'ready_to_spin' : 'waiting',
        bottleAngle: 0,
        roundNumber: 0,
        lastTargetId: null,
        nextSpinnerId: null,
        currentTurn: null,
        usedCardIds: new Set(),
        history: [],
        chat: [],
        spinTimer: null,
        answerTimer: null,
        botTimer: null,
        createdAt: Date.now()
      };
      this._addSystemMessage(room, `"${p.name}" masası açık! Katılıp şişeyi çevirebilirsin.`);
      this.rooms.set(p.code, room);
    }
  }

  authenticate(playerId, input = {}) {
    const mode = input.mode === 'secret' ? 'secret' : 'visitor';
    const rawAlias = sanitizeText(input.alias, 22);
    const foundAvatar = ANONYMOUS_AVATARS.find((a) => a.id === input.avatarId);

    if (mode === 'secret') {
      const secret = sanitizeText(input.secretKey, 64);
      if (secret.length < 3) {
        return { ok: false, error: 'Kurtarma kelimesi en az 3 karakter olmalıdır.' };
      }
      const accountKey = 'sec_' + crypto.createHash('sha256').update(secret).digest('hex').slice(0, 24);
      let account = this.accounts.get(accountKey);
      if (!account) {
        const rnd = generateAnonymousIdentity();
        account = {
          accountKey,
          alias: rawAlias.length >= 2 ? rawAlias : rnd.alias,
          avatarId: foundAvatar ? foundAvatar.id : rnd.avatarId,
          emoji: foundAvatar ? foundAvatar.emoji : rnd.emoji,
          score: 100,
          dmTickets: 1,
          lastMilestone: 1,
          unlockedIds: new Set(),
          unlockedDecks: new Set(Object.keys(DECKS)),
          preferredDeckId: 'classic'
        };
        this.accounts.set(accountKey, account);
      } else {
        if (rawAlias.length >= 2) account.alias = rawAlias;
        if (foundAvatar) {
          account.avatarId = foundAvatar.id;
          account.emoji = foundAvatar.emoji;
        }
      }
      this.playerAccounts.set(playerId, accountKey);
      return { ok: true, account: this.serializeAccount(account), restored: true };
    }

    const rnd = generateAnonymousIdentity();
    const accountKey = 'vis_' + playerId;
    const account = {
      accountKey,
      alias: rawAlias.length >= 2 ? rawAlias : rnd.alias,
      avatarId: foundAvatar ? foundAvatar.id : rnd.avatarId,
      emoji: foundAvatar ? foundAvatar.emoji : rnd.emoji,
      score: 100,
      dmTickets: 1,
      lastMilestone: 1,
      unlockedIds: new Set(),
      unlockedDecks: new Set(Object.keys(DECKS)),
      preferredDeckId: 'classic'
    };
    this.accounts.set(accountKey, account);
    this.playerAccounts.set(playerId, accountKey);
    return { ok: true, account: this.serializeAccount(account), restored: false };
  }

  getAccountByPlayer(playerId) {
    const key = this.playerAccounts.get(playerId);
    if (key && this.accounts.has(key)) return this.accounts.get(key);
    const auth = this.authenticate(playerId, { mode: 'visitor' });
    return this.accounts.get(auth.account.accountKey);
  }

  _awardPoints(account, delta) {
    if (!account || delta <= 0) return { ticketsEarned: 0 };
    account.score += delta;
    const milestone = Math.floor(account.score / 100);
    let ticketsEarned = 0;
    if (milestone > account.lastMilestone) {
      ticketsEarned = milestone - account.lastMilestone;
      account.dmTickets += ticketsEarned;
      account.lastMilestone = milestone;
    }
    return { ticketsEarned, score: account.score, dmTickets: account.dmTickets };
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

  createRoom(hostId, options = {}) {
    if (this.playerToRoom.has(hostId)) {
      this.leaveRoom(hostId);
    }

    const account = this.getAccountByPlayer(hostId);
    const code = this._generateRoomCode();
    const maxRaw = Number(options.maxPlayers);
    const maxPlayers = Number.isFinite(maxRaw)
      ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(maxRaw)))
      : MAX_PLAYERS;

    const chatMode = VALID_CHAT_MODES.includes(options.chatMode) ? options.chatMode : 'both';
    const isPublic = options.isPublic !== false;
    const reqDeck = typeof options.deckId === 'string' ? options.deckId : account.preferredDeckId;
    const deckId = DECKS[reqDeck] ? reqDeck : 'classic';
    const rawName = sanitizeText(options.roomName, 32);
    const roomName = rawName.length >= 2 ? rawName : `${account.alias.split('#')[0].trim()} Masası`;

    const hostPlayer = {
      id: hostId,
      accountKey: account.accountKey,
      alias: account.alias,
      avatarId: account.avatarId,
      emoji: account.emoji,
      score: account.score,
      isHost: true,
      isBot: false,
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
      deckId,
      hostId,
      players: [hostPlayer],
      phase: 'waiting',
      bottleAngle: 0,
      roundNumber: 0,
      lastTargetId: null,
      nextSpinnerId: null,
      currentTurn: null,
      usedCardIds: new Set(),
      history: [],
      chat: [],
      spinTimer: null,
      answerTimer: null,
      botTimer: null,
      createdAt: Date.now()
    };

    this._addSystemMessage(room, `"${roomName}" masası kuruldu! Şişe çevirmek için en az 2 kişi gerekli (Gerçek oyuncu davet edebilir veya Misafir Ekle diyebilirsin).`);
    this.rooms.set(code, room);
    this.playerToRoom.set(hostId, code);

    return { ok: true, room: this.serializeRoom(room) };
  }

  joinRoom(playerId, codeInput) {
    const code = sanitizeText(String(codeInput || '').toUpperCase(), 10);
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: 'Masa bulunamadı veya kapatılmış.' };
    }

    if (room.players.some((p) => p.id === playerId)) {
      return { ok: true, room: this.serializeRoom(room) };
    }

    if (this.playerToRoom.has(playerId)) {
      this.leaveRoom(playerId);
    }

    if (room.players.length >= room.maxPlayers) {
      return { ok: false, error: `Bu masa dolu (${room.players.length}/${room.maxPlayers}).` };
    }

    const account = this.getAccountByPlayer(playerId);
    const isFirstHuman = !room.hostId;
    const player = {
      id: playerId,
      accountKey: account.accountKey,
      alias: account.alias,
      avatarId: account.avatarId,
      emoji: account.emoji,
      score: account.score,
      isHost: isFirstHuman,
      isBot: false,
      micEnabled: false,
      speaking: false,
      joinedAt: Date.now()
    };
    if (isFirstHuman) room.hostId = playerId;

    room.players.push(player);
    this.playerToRoom.set(playerId, room.code);

    if (room.phase === 'waiting' && room.players.length >= room.minPlayers) {
      room.phase = 'ready_to_spin';
      this._addSystemMessage(room, `${player.alias} ${player.emoji} masaya katıldı! Artık şişe çevrilebilir.`);
    } else {
      this._addSystemMessage(room, `${player.alias} ${player.emoji} masaya katıldı (${room.players.length}/${room.maxPlayers}).`);
    }

    return { ok: true, room: this.serializeRoom(room) };
  }

  joinRandomPublicRoom(playerId) {
    const candidates = Array.from(this.rooms.values()).filter(
      (r) => r.isPublic && r.players.length < r.maxPlayers && !r.players.some((p) => p.id === playerId)
    );
    if (candidates.length === 0) {
      return { ok: false, error: 'Şu anda katılabileceğin boş bir açık masa yok. Yeni bir masa açabilirsin!' };
    }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    return this.joinRoom(playerId, chosen.code);
  }

  addBot(playerId) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.hostId !== playerId) return { ok: false, error: 'Sadece masa kurucusu misafir bot ekleyebilir.' };
    if (room.players.length >= room.maxPlayers) {
      return { ok: false, error: `Masa maksimum ${room.maxPlayers} kişilik olabilir!` };
    }

    const rnd = generateAnonymousIdentity();
    const botId = `bot_${crypto.randomBytes(4).toString('hex')}`;
    const bot = {
      id: botId,
      accountKey: botId,
      alias: rnd.alias,
      avatarId: rnd.avatarId,
      emoji: rnd.emoji,
      score: 50 + Math.floor(Math.random() * 5) * 10,
      isHost: false,
      isBot: true,
      micEnabled: false,
      speaking: false,
      joinedAt: Date.now()
    };

    room.players.push(bot);
    this.playerToRoom.set(botId, room.code);
    if (room.phase === 'waiting' && room.players.length >= room.minPlayers) {
      room.phase = 'ready_to_spin';
    }
    this._addSystemMessage(room, `${bot.alias} ${bot.emoji} masaya misafir olarak oturdu (${room.players.length}/${room.maxPlayers}).`);

    return { ok: true, room: this.serializeRoom(room), bot };
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
    const humansLeft = room.players.filter((p) => !p.isBot);

    if (humansLeft.length === 0) {
      this._clearRoomTimers(room);
      if (room.keepAlive) {
        room.hostId = null;
        room.currentTurn = null;
        room.nextSpinnerId = null;
        room.phase = room.players.length >= room.minPlayers ? 'ready_to_spin' : 'waiting';
        this._addSystemMessage(room, `${removed.alias} masadan kalktı.`);
        return { ok: true, roomDeleted: false, code, removedPlayer: removed, room: this.serializeRoom(room) };
      }
      for (const p of room.players) {
        this.playerToRoom.delete(p.id);
      }
      this.rooms.delete(code);
      return { ok: true, roomDeleted: true, code, removedPlayer: removed };
    }

    if (removed.isHost) {
      humansLeft[0].isHost = true;
      room.hostId = humansLeft[0].id;
      this._addSystemMessage(room, `${removed.alias} masadan kalktı. Yeni masa yöneticisi: ${humansLeft[0].alias}.`);
    } else {
      this._addSystemMessage(room, `${removed.alias} masadan kalktı.`);
    }

    if (room.nextSpinnerId === playerId) {
      room.nextSpinnerId = humansLeft[0].id;
    }

    const activeTurnInvolved = room.currentTurn
      && (room.currentTurn.targetId === playerId || room.currentTurn.askerId === playerId);

    if (room.players.length < room.minPlayers) {
      this._clearRoomTimers(room);
      room.phase = 'waiting';
      room.currentTurn = null;
      this._addSystemMessage(room, 'Masada en az 2 kişi olmalı. Yeni oyuncu bekleniyor.');
    } else if (activeTurnInvolved) {
      this._clearRoomTimers(room);
      room.phase = 'ready_to_spin';
      room.currentTurn = null;
      this._addSystemMessage(room, 'Turdaki oyuncu ayrıldığı için şişe yeniden çevrilmeye hazır.');
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
    if (room.hostId !== playerId) return { ok: false, error: 'Sadece masa kurucusu ayarları değiştirebilir.' };
    if (room.phase !== 'waiting' && room.phase !== 'ready_to_spin') {
      return { ok: false, error: 'Tur devam ederken ayar değiştirilemez.' };
    }

    if (settings.chatMode && VALID_CHAT_MODES.includes(settings.chatMode)) {
      room.chatMode = settings.chatMode;
      if (room.chatMode === 'text') {
        for (const p of room.players) {
          p.micEnabled = false;
          p.speaking = false;
        }
      }
      const labels = { both: 'Sesli & Yazılı', text: 'Sadece Yazılı', voice: 'Sadece Sesli' };
      this._addSystemMessage(room, `Sohbet modu değiştirildi: ${labels[room.chatMode]}.`);
    }

    if (typeof settings.isPublic === 'boolean') {
      room.isPublic = settings.isPublic;
    }

    return { ok: true, room: this.serializeRoom(room) };
  }

  spinBottle(playerId, callbacks = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.players.length < room.minPlayers) {
      return { ok: false, error: `Şişeyi çevirmek için masada en az ${room.minPlayers} kişi olmalı!` };
    }
    if (room.phase !== 'ready_to_spin') {
      return { ok: false, error: 'Şu anda şişe çevrilemez.' };
    }
    if (room.nextSpinnerId && room.nextSpinnerId !== playerId && room.hostId !== playerId) {
      const spinner = room.players.find((p) => p.id === room.nextSpinnerId);
      return {
        ok: false,
        error: `Şişeyi çevirme sırası ${spinner ? spinner.alias : 'sıradaki oyuncuda'}.`
      };
    }

    this._clearRoomTimers(room);
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
      answerText: null,
      answerDeadline: null,
      answerTimeoutMs: this.answerTimeoutMs
    };

    const onSettled = () => {
      room.spinTimer = null;
      if (room.phase !== 'spinning' || !room.currentTurn) return;
      room.phase = 'choosing_mode';
      this._addSystemMessage(
        room,
        `🍾 Şişe ${targetPlayer.alias} ${targetPlayer.emoji} yönünde durdu! (Soran: ${askerPlayer.alias})`
      );
      if (typeof callbacks.onChange === 'function') callbacks.onChange(room);

      if (targetPlayer.isBot) {
        this._scheduleBotStep(room, () => {
          if (room.phase !== 'choosing_mode') return;
          const mode = Math.random() < 0.5 ? 'truth' : 'dare';
          this.chooseMode(targetPlayer.id, mode, callbacks);
          if (typeof callbacks.onChange === 'function') callbacks.onChange(room);
        });
      }
    };

    if (this.spinDurationMs <= 0) {
      onSettled();
    } else {
      room.spinTimer = setTimeout(onSettled, this.spinDurationMs);
      if (room.spinTimer.unref) room.spinTimer.unref();
    }

    return { ok: true, room: this.serializeRoom(room), spinResult };
  }

  chooseMode(playerId, mode, callbacks = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'choosing_mode' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda Doğruluk/Cesaret seçimi yapılamaz.' };
    }
    if (room.currentTurn.targetId !== playerId) {
      return { ok: false, error: 'Sadece şişenin gösterdiği oyuncu seçim yapabilir.' };
    }
    if (mode !== 'truth' && mode !== 'dare') {
      return { ok: false, error: 'Geçersiz seçim.' };
    }

    room.currentTurn.mode = mode;
    room.phase = 'asking_question';
    const target = room.players.find((p) => p.id === room.currentTurn.targetId);
    const asker = room.players.find((p) => p.id === room.currentTurn.askerId);
    const label = mode === 'truth' ? 'Doğruluk' : 'Cesaret';
    this._addSystemMessage(
      room,
      `${target ? target.alias : 'Oyuncu'} "${label}" seçti! ${asker ? asker.alias : 'Soran'} soru/görev seçiyor.`
    );

    if (asker && asker.isBot) {
      this._scheduleBotStep(room, () => {
        if (room.phase !== 'asking_question') return;
        const card = this._drawUniqueRoomCard(room, mode, 'Tümü');
        this.submitQuestion(asker.id, { text: card.text, source: 'card', category: card.category }, callbacks);
        if (typeof callbacks.onChange === 'function') callbacks.onChange(room);
      });
    }

    return { ok: true, room: this.serializeRoom(room) };
  }

  _drawUniqueRoomCard(room, mode, category = 'Tümü') {
    if (!room.usedCardIds) room.usedCardIds = new Set();
    let card = getRandomCard(mode, category, room.deckId, room.usedCardIds);
    if (room.usedCardIds.has(card.id)) {
      const deck = DECKS[room.deckId] || DECKS.classic;
      const pool = mode === 'dare' ? deck.dare : deck.truth;
      for (const c of pool) room.usedCardIds.delete(c.id);
      card = getRandomCard(mode, category, room.deckId, room.usedCardIds);
    }
    room.usedCardIds.add(card.id);
    return card;
  }

  drawDeckCard(playerId, category = 'Tümü') {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'asking_question' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda kart çekilemez.' };
    }
    if (room.currentTurn.askerId !== playerId) {
      return { ok: false, error: 'Sadece şişenin arkasındaki oyuncu kart çekebilir.' };
    }

    const card = this._drawUniqueRoomCard(room, room.currentTurn.mode, category);
    return { ok: true, card };
  }

  submitQuestion(playerId, payload = {}, callbacks = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'asking_question' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda soru gönderilemez.' };
    }
    if (room.currentTurn.askerId !== playerId) {
      return { ok: false, error: 'Sadece şişenin arkasındaki oyuncu soru sorabilir.' };
    }

    const source = payload.source === 'card' || payload.source === 'voice' ? payload.source : 'custom';
    let text = sanitizeText(payload.text, 240);

    if (source === 'voice') {
      if (room.chatMode === 'text') {
        return { ok: false, error: 'Sadece yazılı odada sesli soru kullanılamaz.' };
      }
      if (!text) text = '🎙️ Soruyu sesli olarak sordu!';
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
    this._startAnswerTimer(room, callbacks);

    const target = room.players.find((p) => p.id === room.currentTurn.targetId);
    this._addSystemMessage(
      room,
      `⏳ ${target ? target.alias : 'Oyuncu'} için 30 saniye başladı! Soru: "${text}"`
    );

    return { ok: true, room: this.serializeRoom(room) };
  }

  replaceCenterQuestion(playerId, textInput, callbacks = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'answering' || !room.currentTurn) {
      return { ok: false, error: 'Aktif soru yok.' };
    }

    const { askerId, targetId } = room.currentTurn;
    const target = room.players.find((p) => p.id === targetId);
    const allowed = playerId === askerId || playerId === room.hostId || (target && target.isBot);
    if (!allowed) {
      return { ok: false, error: 'Soruyu sadece soran veya masa kurucusu değiştirebilir.' };
    }

    const text = sanitizeText(textInput, 240);
    if (text.length < 3) {
      return { ok: false, error: 'Soru en az 3 karakter olmalı.' };
    }

    room.currentTurn.question = {
      text,
      source: 'custom',
      category: 'Özel',
      askedAt: Date.now()
    };
    this._startAnswerTimer(room, callbacks);

    const sender = room.players.find((p) => p.id === playerId);
    this._addSystemMessage(room, `✍️ ${sender ? sender.alias : 'Oyuncu'} yeni soru sordu (Süre 30sn yenilendi): "${text}"`);

    return { ok: true, room: this.serializeRoom(room) };
  }

  submitWrittenAnswer(playerId, answerInput) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'answering' || !room.currentTurn) {
      return { ok: false, error: 'Şu anda yazılı yanıt gönderilemez.' };
    }
    if (room.currentTurn.targetId !== playerId) {
      return { ok: false, error: 'Sadece hedef oyuncu yanıt gönderebilir.' };
    }
    if (room.chatMode === 'voice') {
      return { ok: false, error: 'Bu oda Sadece Sesli modda.' };
    }

    const answerText = sanitizeText(answerInput, 320);
    if (!answerText) return { ok: false, error: 'Yanıt boş olamaz.' };

    room.currentTurn.answerText = answerText;
    const target = room.players.find((p) => p.id === playerId);
    this._addSystemMessage(room, `💬 ${target ? target.alias : 'Oyuncu'} yanıtladı: "${answerText}"`);

    return { ok: true, room: this.serializeRoom(room) };
  }

  completeTurn(playerId, success = true) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.phase !== 'answering' || !room.currentTurn) {
      return { ok: false, error: 'Tamamlanacak aktif bir tur yok.' };
    }

    const { targetId, askerId, spinnerId } = room.currentTurn;
    const target = room.players.find((p) => p.id === targetId);
    const asker = room.players.find((p) => p.id === askerId);

    const authorized = playerId === targetId
      || playerId === askerId
      || playerId === room.hostId
      || (target && target.isBot);

    if (!authorized) {
      return { ok: false, error: 'Turu sadece hedef oyuncu, soran veya masa kurucusu bitirebilir.' };
    }

    this._clearAnswerTimer(room);

    const rewardEvents = [];
    if (success) {
      if (target) {
        target.score += 25;
        if (!target.isBot) {
          const acc = this.accounts.get(target.accountKey);
          const res = this._awardPoints(acc, 25);
          target.score = acc ? acc.score : target.score;
          rewardEvents.push({ playerId: target.id, ...res });
        }
      }

      // If target was a bot, reward the human participant (+25P); if human vs human, reward asker (+10P)
      if (target && target.isBot) {
        const helperId = (asker && !asker.isBot) ? asker.id : spinnerId;
        const helper = room.players.find((p) => p.id === helperId && !p.isBot);
        if (helper) {
          const acc = this.accounts.get(helper.accountKey);
          const res = this._awardPoints(acc, 25);
          helper.score = acc ? acc.score : helper.score + 25;
          rewardEvents.push({ playerId: helper.id, ...res });
        }
      } else if (asker && !asker.isBot && asker.id !== targetId) {
        const acc = this.accounts.get(asker.accountKey);
        const res = this._awardPoints(acc, 10);
        asker.score = acc ? acc.score : asker.score + 10;
        rewardEvents.push({ playerId: asker.id, ...res });
      }
    }

    room.history.unshift({
      roundNumber: room.currentTurn.roundNumber,
      mode: room.currentTurn.mode,
      targetAlias: target ? target.alias : 'Anonim',
      askerAlias: asker ? asker.alias : 'Anonim',
      question: room.currentTurn.question ? room.currentTurn.question.text : '',
      answerText: room.currentTurn.answerText,
      skipped: !success,
      finishedAt: Date.now()
    });
    if (room.history.length > 20) room.history.pop();

    this._addSystemMessage(
      room,
      success
        ? `👏 ${target ? target.alias : 'Oyuncu'} 30 saniye dolmadan görevi tamamladı! (+25 Puan)`
        : `😅 ${target ? target.alias : 'Oyuncu'} bu turu pas geçti.`
    );

    const humans = room.players.filter((p) => !p.isBot);
    room.nextSpinnerId = (target && !target.isBot) ? target.id : (humans[0] ? humans[0].id : null);
    room.currentTurn = null;
    room.phase = room.players.length >= room.minPlayers ? 'ready_to_spin' : 'waiting';

    return { ok: true, room: this.serializeRoom(room), rewardEvents };
  }

  _startAnswerTimer(room, callbacks = {}) {
    this._clearAnswerTimer(room);
    if (!room.currentTurn) return;

    if (this.answerTimeoutMs <= 0) {
      room.currentTurn.answerDeadline = Date.now();
      return;
    }

    room.currentTurn.answerDeadline = Date.now() + this.answerTimeoutMs;
    room.answerTimer = setTimeout(() => {
      room.answerTimer = null;
      if (room.phase !== 'answering' || !room.currentTurn) return;

      const target = room.players.find((p) => p.id === room.currentTurn.targetId);
      const humans = room.players.filter((p) => !p.isBot);

      room.history.unshift({
        roundNumber: room.currentTurn.roundNumber,
        mode: room.currentTurn.mode,
        targetAlias: target ? target.alias : 'Anonim',
        askerAlias: 'Süre',
        question: room.currentTurn.question ? room.currentTurn.question.text : '',
        answerText: null,
        skipped: true,
        finishedAt: Date.now()
      });
      if (room.history.length > 20) room.history.pop();

      this._addSystemMessage(
        room,
        `⏰ 30 saniyelik süre doldu! ${target ? target.alias : 'Oyuncu'} zamanında tamamlayamadı.`
      );
      room.nextSpinnerId = (target && !target.isBot) ? target.id : (humans[0] ? humans[0].id : null);
      room.currentTurn = null;
      room.phase = room.players.length >= room.minPlayers ? 'ready_to_spin' : 'waiting';

      if (typeof callbacks.onExpire === 'function') {
        callbacks.onExpire(room);
      } else if (typeof callbacks.onChange === 'function') {
        callbacks.onChange(room);
      }
    }, this.answerTimeoutMs);

    if (room.answerTimer.unref) room.answerTimer.unref();
  }

  _clearAnswerTimer(room) {
    if (room.answerTimer) {
      clearTimeout(room.answerTimer);
      room.answerTimer = null;
    }
  }

  _scheduleBotStep(room, fn) {
    if (room.botTimer) clearTimeout(room.botTimer);
    if (this.botDelayMs <= 0) {
      fn();
      return;
    }
    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      fn();
    }, this.botDelayMs);
    if (room.botTimer.unref) room.botTimer.unref();
  }

  _clearRoomTimers(room) {
    if (room.spinTimer) {
      clearTimeout(room.spinTimer);
      room.spinTimer = null;
    }
    this._clearAnswerTimer(room);
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
  }

  sendChatMessage(playerId, textInput, clientMentionedIds = []) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.chatMode === 'voice') {
      return { ok: false, error: 'Bu masa Sadece Sesli modda. Yazılı sohbet kapalı.' };
    }

    const text = sanitizeText(textInput, 360);
    if (!text) return { ok: false, error: 'Boş mesaj gönderilemez.' };

    const sender = room.players.find((p) => p.id === playerId);
    if (!sender) return { ok: false, error: 'Oyuncu bulunamadı.' };

    const mentionedSet = new Set();
    for (const p of room.players) {
      if (text.includes(`@${p.alias}`)) mentionedSet.add(p.id);
    }
    if (Array.isArray(clientMentionedIds)) {
      for (const id of clientMentionedIds) {
        if (room.players.some((p) => p.id === id)) mentionedSet.add(id);
      }
    }

    const mentionedIds = Array.from(mentionedSet);
    const msg = {
      id: crypto.randomUUID(),
      type: 'user',
      playerId: sender.id,
      alias: sender.alias,
      emoji: sender.emoji,
      text,
      mentionedIds,
      timestamp: Date.now()
    };

    room.chat.push(msg);
    if (room.chat.length > 80) room.chat.shift();

    return { ok: true, message: msg, roomCode: room.code, mentionedIds };
  }

  unlockDmContact(playerId, targetId) {
    const account = this.getAccountByPlayer(playerId);
    if (!account) return { ok: false, error: 'Hesap bulunamadı.' };

    if (account.unlockedIds.has(targetId)) {
      return { ok: true, alreadyUnlocked: true, account: this.serializeAccount(account) };
    }

    if (account.dmTickets <= 0) {
      return {
        ok: false,
        noTickets: true,
        error: 'Özel Mektup Hakkın kalmadı! Masada görevleri tamamlayarak her 100 puanda +1 hak kazanabilirsin.'
      };
    }

    account.dmTickets -= 1;
    account.unlockedIds.add(targetId);

    return { ok: true, alreadyUnlocked: false, account: this.serializeAccount(account) };
  }

  selectDeck(playerId, deckId) {
    const account = this.getAccountByPlayer(playerId);
    if (!account) return { ok: false, error: 'Hesap bulunamadı.' };
    const deck = DECKS[deckId];
    if (!deck) return { ok: false, error: 'Deste bulunamadı.' };

    account.unlockedDecks.add(deck.id);
    account.preferredDeckId = deck.id;
    const room = this.getRoomByPlayer(playerId);
    let updatedRoom = null;
    if (room) {
      room.deckId = deck.id;
      const p = room.players.find((pl) => pl.id === playerId);
      this._addSystemMessage(room, `🃏 ${p ? p.alias : account.alias} masanın soru destesini "${deck.emoji} ${deck.shortName}" olarak değiştirdi!`);
      updatedRoom = this.serializeRoom(room);
    }

    return { ok: true, deck, account: this.serializeAccount(account), room: updatedRoom };
  }

  setVoiceState(playerId, { micEnabled, speaking } = {}) {
    const room = this.getRoomByPlayer(playerId);
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    if (room.chatMode === 'text') {
      return { ok: false, error: 'Bu masa Sadece Yazılı modda. Mikrofon kapalı.' };
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
    if (!room) return { ok: false, error: 'Bir masada değilsiniz.' };
    const allowed = ['✨', '🙊', '😂', '☕', '👏', '🔥', '💜'];
    if (!allowed.includes(emojiInput)) return { ok: false, error: 'Geçersiz tepki.' };
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: 'Oyuncu bulunamadı.' };
    return {
      ok: true,
      roomCode: room.code,
      reaction: { id: crypto.randomUUID(), playerId: player.id, alias: player.alias, emoji: emojiInput }
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
        deckId: room.deckId || 'classic',
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

  serializeAccount(account) {
    return {
      accountKey: account.accountKey,
      alias: account.alias,
      avatarId: account.avatarId,
      emoji: account.emoji,
      score: account.score,
      dmTickets: account.dmTickets,
      unlockedDecks: Array.from(account.unlockedDecks || Object.keys(DECKS)),
      preferredDeckId: account.preferredDeckId || 'classic'
    };
  }

  _serializePlayer(player) {
    return {
      id: player.id,
      accountKey: player.accountKey,
      alias: player.alias,
      avatarId: player.avatarId,
      emoji: player.emoji,
      score: player.score,
      isHost: player.isHost,
      isBot: player.isBot,
      micEnabled: player.micEnabled,
      speaking: player.speaking
    };
  }

  serializeRoom(room) {
    const deck = DECKS[room.deckId] || DECKS.classic;
    return {
      code: room.code,
      name: room.name,
      isPublic: room.isPublic,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      chatMode: room.chatMode,
      deckId: deck.id,
      deckName: deck.shortName,
      deckEmoji: deck.emoji,
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
  normalizeDeg
};
