(() => {
  'use strict';

  const DEFAULT_AVATARS = [
    { id: 'fox', emoji: '🦊', label: 'Tilki' },
    { id: 'owl', emoji: '🦉', label: 'Baykuş' },
    { id: 'wolf', emoji: '🐺', label: 'Kurt' },
    { id: 'mask', emoji: '🎭', label: 'Maske' },
    { id: 'cat', emoji: '🐱', label: 'Kedi' },
    { id: 'eagle', emoji: '🦅', label: 'Şahin' }
  ];

  const DEFAULT_COLORS = ['#00f5d4', '#ff4d8d', '#ffb703', '#8b5cf6', '#38bdf8', '#4ade80'];

  const RANDOM_ADJECTIVES = ['Gizli', 'Mistik', 'Sessiz', 'Neon', 'Gece', 'Kuzey', 'Gölge', 'Kozmik', 'Sakin', 'Parlak'];
  const RANDOM_NOUNS = ['Tilki', 'Baykuş', 'Yolcu', 'Kahin', 'Maske', 'Kartal', 'Ay', 'Yankı', 'Pusula', 'Pati'];

  const CHAT_MODE_LABELS = {
    both: '🎙️ + 💬 Sesli & Yazılı',
    text: '💬 Sadece Yazılı',
    voice: '🎙️ Sadece Sesli'
  };

  const PHASE_LABELS = {
    waiting: 'Oyuncu Bekleniyor',
    ready_to_spin: 'Şişeye Hazır',
    spinning: 'Şişe Dönüyor',
    choosing_mode: 'Seçim Yapılıyor',
    asking_question: 'Soru Hazırlanıyor',
    answering: 'Cevaplanıyor'
  };

  const state = {
    ws: null,
    connected: false,
    playerId: null,
    avatars: DEFAULT_AVATARS,
    colors: DEFAULT_COLORS,
    profile: loadProfile(),
    selectedMaxPlayers: 6,
    selectedChatMode: 'both',
    selectedVisibility: 'public',
    publicRooms: [],
    room: null,
    sfxEnabled: true,
    deafened: false,
    pttMode: false,
    pttHolding: false,
    micActive: false,
    lastStageSignature: '',
    composerTab: 'custom',
    selectedCategory: 'Tümü',
    drawnCard: null,
    customDraft: '',
    answerDraft: '',
    spinAnimatingUntil: 0,
    deferredPrompt: null
  };

  // DOM helpers
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, type = 'info') {
    const container = $('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      el.style.transition = 'all 0.2s';
      setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  function randomNickname() {
    const adj = RANDOM_ADJECTIVES[Math.floor(Math.random() * RANDOM_ADJECTIVES.length)];
    const noun = RANDOM_NOUNS[Math.floor(Math.random() * RANDOM_NOUNS.length)];
    const num = Math.floor(10 + Math.random() * 89);
    return `${adj} ${noun} #${num}`;
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem('anonim_sise_profile');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          nickname: typeof parsed.nickname === 'string' && parsed.nickname.trim() ? parsed.nickname.slice(0, 22) : randomNickname(),
          avatarId: parsed.avatarId || 'fox',
          color: parsed.color || DEFAULT_COLORS[0]
        };
      }
    } catch {
      // ignore storage errors
    }
    return {
      nickname: randomNickname(),
      avatarId: 'fox',
      color: DEFAULT_COLORS[0]
    };
  }

  function saveProfile() {
    try {
      localStorage.setItem('anonim_sise_profile', JSON.stringify(state.profile));
    } catch {
      // ignore storage errors
    }
  }

  // Synthesized Audio SFX
  const SoundFX = {
    ctx: null,
    ensureCtx() {
      if (!state.sfxEnabled) return null;
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new Ctx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    },
    tone(freq, duration = 0.08, type = 'sine', gainVal = 0.07, delay = 0) {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(gainVal, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
    },
    playSpinTicks(durationMs = 3600) {
      if (!state.sfxEnabled) return;
      const totalTicks = 22;
      for (let i = 0; i < totalTicks; i += 1) {
        const progress = i / totalTicks;
        const delay = Math.pow(progress, 1.85) * ((durationMs - 250) / 1000);
        this.tone(420 + (1 - progress) * 260, 0.045, 'triangle', 0.05, delay);
      }
      setTimeout(() => this.playLandChime(), Math.max(0, durationMs - 80));
    },
    playLandChime() {
      this.tone(523.25, 0.22, 'sine', 0.09, 0);
      this.tone(659.25, 0.28, 'sine', 0.09, 0.09);
      this.tone(783.99, 0.35, 'triangle', 0.08, 0.18);
    },
    playPop() {
      this.tone(580, 0.06, 'sine', 0.04, 0);
    }
  };

  // WebRTC Mesh Voice Manager
  const VoiceManager = {
    peers: new Map(), // peerId -> { pc, makingOffer, ignoreOffer, audioEl }
    localStream: null,
    audioCtx: null,
    analyser: null,
    meterTimer: null,
    lastSpeaking: false,

    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    },

    isRoomVoiceAllowed() {
      return state.room && state.room.chatMode !== 'text';
    },

    async toggleMic(forceState = null) {
      if (!this.isRoomVoiceAllowed()) {
        showToast('Bu oda Sadece Yazılı modda.', 'error');
        return;
      }
      const next = forceState !== null ? forceState : !state.micActive;
      if (next) {
        await this.enableMic();
      } else {
        this.disableMic();
      }
    },

    async enableMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.showVoiceWarning('Tarayıcınız sesli sohbet için güvenli bağlantı (HTTPS veya localhost) gerektiriyor. Yazılı sohbeti kullanmaya devam edebilirsiniz.');
        return;
      }

      try {
        if (!this.localStream) {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
        }
        state.micActive = true;
        this.hideVoiceWarning();
        this._applyTrackEnabled();
        this._startSpeakingMonitor();
        await this.syncPeers();
        this.sendVoiceState();
        updateVoiceButtons();
      } catch (err) {
        state.micActive = false;
        this.showVoiceWarning('Mikrofon izni alınamadı veya cihaz bulunamadı. Yazılı sohbet üzerinden oyuna devam edebilirsiniz.');
        updateVoiceButtons();
      }
    },

    disableMic() {
      state.micActive = false;
      state.pttHolding = false;
      if (this.meterTimer) {
        clearInterval(this.meterTimer);
        this.meterTimer = null;
      }
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) {
          track.stop();
        }
        this.localStream = null;
      }
      if (this.audioCtx) {
        this.audioCtx.close().catch(() => {});
        this.audioCtx = null;
        this.analyser = null;
      }
      for (const entry of this.peers.values()) {
        for (const sender of entry.pc.getSenders()) {
          if (sender.track) {
            try {
              entry.pc.removeTrack(sender);
            } catch {
              // ignore
            }
          }
        }
      }
      this.lastSpeaking = false;
      this.sendVoiceState();
      updateVoiceButtons();
    },

    _applyTrackEnabled() {
      if (!this.localStream) return;
      const canTransmit = state.micActive && (!state.pttMode || state.pttHolding);
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = canTransmit;
      }
    },

    setPttHolding(holding) {
      if (!state.pttMode || !state.micActive) return;
      if (state.pttHolding === holding) return;
      state.pttHolding = holding;
      this._applyTrackEnabled();
      if (!holding && this.lastSpeaking) {
        this.lastSpeaking = false;
        this.sendVoiceState();
      }
      updateVoiceButtons();
    },

    _startSpeakingMonitor() {
      if (!this.localStream) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (this.audioCtx) this.audioCtx.close().catch(() => {});
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);

      if (this.meterTimer) clearInterval(this.meterTimer);
      this.meterTimer = setInterval(() => {
        if (!state.micActive || (state.pttMode && !state.pttHolding)) {
          if (this.lastSpeaking) {
            this.lastSpeaking = false;
            this.sendVoiceState();
          }
          return;
        }
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const avg = sum / data.length;
        const speaking = avg > 14;
        if (speaking !== this.lastSpeaking) {
          this.lastSpeaking = speaking;
          this.sendVoiceState();
        }
      }, 140);
    },

    sendVoiceState() {
      const effectiveMic = state.micActive && (!state.pttMode || state.pttHolding);
      sendWs({
        type: 'voice_state',
        micEnabled: state.micActive,
        speaking: effectiveMic && this.lastSpeaking
      });
    },

    async syncPeers() {
      if (!state.room || !this.isRoomVoiceAllowed()) {
        this.closeAllPeers();
        return;
      }
      const activeIds = new Set(
        state.room.players.filter((p) => p.id !== state.playerId).map((p) => p.id)
      );

      for (const peerId of Array.from(this.peers.keys())) {
        if (!activeIds.has(peerId)) {
          this.closePeer(peerId);
        }
      }

      for (const peerId of activeIds) {
        const entry = this.getOrCreatePeer(peerId);
        if (this.localStream) {
          const senders = entry.pc.getSenders();
          for (const track of this.localStream.getAudioTracks()) {
            const already = senders.some((s) => s.track && s.track.id === track.id);
            if (!already) {
              entry.pc.addTrack(track, this.localStream);
            }
          }
        }
      }
    },

    getOrCreatePeer(peerId) {
      if (this.peers.has(peerId)) return this.peers.get(peerId);

      const pc = new RTCPeerConnection(this.rtcConfig);
      const entry = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        audioEl: null
      };
      this.peers.set(peerId, entry);

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendWs({
            type: 'webrtc_signal',
            targetId: peerId,
            signal: { candidate }
          });
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          sendWs({
            type: 'webrtc_signal',
            targetId: peerId,
            signal: { description: pc.localDescription }
          });
        } catch {
          // ignore negotiation error
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        let audioEl = entry.audioEl;
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.playsInline = true;
          audioEl.muted = state.deafened;
          $('remoteAudioContainer').appendChild(audioEl);
          entry.audioEl = audioEl;
        }
        audioEl.srcObject = stream;
        audioEl.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          pc.restartIce();
        }
      };

      return entry;
    },

    async handleSignal(fromId, signal) {
      if (!this.isRoomVoiceAllowed()) return;
      const entry = this.getOrCreatePeer(fromId);
      const { pc } = entry;
      const polite = String(state.playerId) > String(fromId);

      try {
        if (signal.description) {
          const offerCollision = signal.description.type === 'offer'
            && (entry.makingOffer || pc.signalingState !== 'stable');
          entry.ignoreOffer = !polite && offerCollision;
          if (entry.ignoreOffer) return;

          await pc.setRemoteDescription(signal.description);
          if (signal.description.type === 'offer') {
            if (this.localStream) {
              const senders = pc.getSenders();
              for (const track of this.localStream.getAudioTracks()) {
                if (!senders.some((s) => s.track && s.track.id === track.id)) {
                  pc.addTrack(track, this.localStream);
                }
              }
            }
            await pc.setLocalDescription();
            sendWs({
              type: 'webrtc_signal',
              targetId: fromId,
              signal: { description: pc.localDescription }
            });
          }
        } else if (signal.candidate) {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch (err) {
            if (!entry.ignoreOffer) throw err;
          }
        }
      } catch {
        // ignore transient signaling race
      }
    },

    setDeafened(deafened) {
      state.deafened = deafened;
      for (const entry of this.peers.values()) {
        if (entry.audioEl) {
          entry.audioEl.muted = deafened;
        }
      }
      updateVoiceButtons();
    },

    closePeer(peerId) {
      const entry = this.peers.get(peerId);
      if (!entry) return;
      try {
        entry.pc.close();
      } catch {
        // ignore
      }
      if (entry.audioEl) entry.audioEl.remove();
      this.peers.delete(peerId);
    },

    closeAllPeers() {
      for (const peerId of Array.from(this.peers.keys())) {
        this.closePeer(peerId);
      }
    },

    resetAll() {
      this.disableMic();
      this.closeAllPeers();
      this.hideVoiceWarning();
    },

    showVoiceWarning(msg) {
      const el = $('voiceWarningBanner');
      el.textContent = msg;
      el.classList.remove('hidden');
    },

    hideVoiceWarning() {
      $('voiceWarningBanner').classList.add('hidden');
    }
  };

  // WebSocket setup
  function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;
    setConnBadge('connecting', '● Bağlanıyor...');

    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.addEventListener('open', () => {
      state.connected = true;
      setConnBadge('connected', '● Çevrimiçi');
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      handleWsMessage(msg);
    });

    ws.addEventListener('close', () => {
      state.connected = false;
      setConnBadge('offline', '● Yeniden bağlanılıyor...');
      if (state.room) {
        VoiceManager.resetAll();
        state.room = null;
        showView('lobby');
        showToast('Sunucu bağlantısı kesildi, yeniden bağlanılıyor...', 'error');
      }
      setTimeout(connectWs, 2000);
    });
  }

  function sendWs(payload) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      showToast('Sunucu bağlantısı henüz hazır değil.', 'error');
      return false;
    }
    state.ws.send(JSON.stringify(payload));
    return true;
  }

  function setConnBadge(cls, text) {
    const badge = $('connBadge');
    badge.className = `status-pill ${cls}`;
    badge.textContent = text;
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        state.playerId = msg.playerId;
        if (Array.isArray(msg.avatars)) state.avatars = msg.avatars;
        if (Array.isArray(msg.colors)) state.colors = msg.colors;
        state.publicRooms = msg.publicRooms || [];
        renderProfileSetup();
        renderPublicRooms();
        break;
      }

      case 'public_rooms': {
        state.publicRooms = msg.rooms || [];
        renderPublicRooms();
        break;
      }

      case 'room_joined': {
        state.room = msg.room;
        state.lastStageSignature = '';
        state.drawnCard = null;
        state.customDraft = '';
        state.answerDraft = '';
        state.spinAnimatingUntil = 0;
        showView('room');
        renderRoom(true);
        syncBottleImmediate(state.room.bottleAngle);
        VoiceManager.syncPeers();
        checkSecureContextWarning();
        break;
      }

      case 'left_room': {
        VoiceManager.resetAll();
        state.room = null;
        state.publicRooms = msg.publicRooms || [];
        showView('lobby');
        renderPublicRooms();
        break;
      }

      case 'room_state': {
        const prevPhase = state.room ? state.room.phase : null;
        state.room = msg.room;
        if (prevPhase !== state.room.phase && state.room.phase === 'ready_to_spin') {
          state.drawnCard = null;
          state.answerDraft = '';
        }
        renderRoom(false);
        if (state.room.phase !== 'spinning' && Date.now() >= state.spinAnimatingUntil) {
          syncBottleImmediate(state.room.bottleAngle);
        }
        VoiceManager.syncPeers();
        break;
      }

      case 'bottle_spun': {
        state.room = msg.room;
        state.drawnCard = null;
        state.answerDraft = '';
        renderRoom(false);
        animateBottleSpin(msg.spin, state.room.currentTurn.spinDurationMs);
        SoundFX.playSpinTicks(state.room.currentTurn.spinDurationMs);
        break;
      }

      case 'card_drawn': {
        state.drawnCard = msg.card;
        state.lastStageSignature = '';
        renderTurnStage();
        SoundFX.playPop();
        break;
      }

      case 'chat_message': {
        if (!state.room) break;
        state.room.chat.push(msg.message);
        if (state.room.chat.length > 80) state.room.chat.shift();
        appendChatMessage(msg.message);
        if (msg.message.playerId !== state.playerId) SoundFX.playPop();
        break;
      }

      case 'voice_state': {
        if (!state.room) break;
        const p = state.room.players.find((pl) => pl.id === msg.playerId);
        if (p) {
          p.micEnabled = msg.micEnabled;
          p.speaking = msg.speaking;
          renderSeats();
        }
        break;
      }

      case 'peer_joined': {
        VoiceManager.syncPeers();
        break;
      }

      case 'peer_left': {
        VoiceManager.closePeer(msg.peerId);
        break;
      }

      case 'webrtc_signal': {
        VoiceManager.handleSignal(msg.fromId, msg.signal);
        break;
      }

      case 'reaction': {
        spawnFloatingReaction(msg.reaction);
        break;
      }

      case 'error': {
        showToast(msg.error || 'Bir hata oluştu.', 'error');
        break;
      }

      default:
        break;
    }
  }

  function checkSecureContextWarning() {
    if (state.room && state.room.chatMode !== 'text' && !window.isSecureContext) {
      VoiceManager.showVoiceWarning(
        'Not: Yerel ağ IP adresi (HTTP) üzerinden bağlanıldığı için tarayıcı mikrofon erişimini engelleyebilir. Sesli sohbet için localhost veya HTTPS gerekir; yazılı sohbet aktiftir.'
      );
    } else {
      VoiceManager.hideVoiceWarning();
    }
  }

  // UI View Switch
  function showView(view) {
    if (view === 'room') {
      $('lobbyView').classList.add('hidden');
      $('roomView').classList.remove('hidden');
    } else {
      $('roomView').classList.add('hidden');
      $('lobbyView').classList.remove('hidden');
    }
  }

  // Profile Setup Render
  function renderProfileSetup() {
    $('nicknameInput').value = state.profile.nickname;

    const avatarGrid = $('avatarGrid');
    avatarGrid.innerHTML = '';
    for (const av of state.avatars) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `avatar-item ${state.profile.avatarId === av.id ? 'active' : ''}`;
      btn.textContent = av.emoji;
      btn.title = av.label;
      btn.addEventListener('click', () => {
        state.profile.avatarId = av.id;
        saveProfile();
        renderProfileSetup();
      });
      avatarGrid.appendChild(btn);
    }

    const colorGrid = $('colorGrid');
    colorGrid.innerHTML = '';
    for (const c of state.colors) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `color-dot ${state.profile.color === c ? 'active' : ''}`;
      dot.style.background = c;
      dot.setAttribute('aria-label', `Renk ${c}`);
      dot.addEventListener('click', () => {
        state.profile.color = c;
        saveProfile();
        renderProfileSetup();
      });
      colorGrid.appendChild(dot);
    }

    updateProfilePreview();
  }

  function updateProfilePreview() {
    const found = state.avatars.find((a) => a.id === state.profile.avatarId) || state.avatars[0];
    const previewAvatar = $('previewAvatar');
    previewAvatar.textContent = found.emoji;
    previewAvatar.style.borderColor = state.profile.color;
    previewAvatar.style.boxShadow = `0 0 18px ${state.profile.color}55`;
    $('previewNick').textContent = state.profile.nickname.trim() || 'Anonim Oyuncu';
  }

  function renderPublicRooms() {
    const list = $('publicRoomsList');
    if (!state.publicRooms.length) {
      list.innerHTML = '<div class="empty-state">Şu anda açık oda yok. İlk anonim masayı sen kurabilirsin!</div>';
      return;
    }

    list.innerHTML = '';
    for (const r of state.publicRooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      row.innerHTML = `
        <div class="room-row-info">
          <strong>${escapeHtml(r.name)}</strong>
          <div class="room-row-meta">
            <span>👥 ${r.playerCount}/${r.maxPlayers}</span>
            <span>${escapeHtml(CHAT_MODE_LABELS[r.chatMode] || r.chatMode)}</span>
            <span>• ${escapeHtml(PHASE_LABELS[r.phase] || r.phase)}</span>
          </div>
        </div>
      `;
      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'btn btn-primary btn-sm';
      joinBtn.disabled = r.isFull;
      joinBtn.textContent = r.isFull ? 'Dolu' : 'Katıl';
      joinBtn.addEventListener('click', () => {
        sendWs({
          type: 'join_room',
          code: r.code,
          profile: getCurrentProfilePayload()
        });
      });
      row.appendChild(joinBtn);
      list.appendChild(row);
    }
  }

  function getCurrentProfilePayload() {
    return {
      nickname: $('nicknameInput').value.trim() || state.profile.nickname,
      avatarId: state.profile.avatarId,
      color: state.profile.color
    };
  }

  // Room Rendering
  function renderRoom(fullChatReset) {
    const room = state.room;
    if (!room) return;

    $('roomTitle').textContent = room.name;
    $('roomCodeText').textContent = room.code;
    $('roomCountBadge').textContent = `${room.players.length}/${room.maxPlayers} Anonim`;
    $('roomChatModeBadge').textContent = CHAT_MODE_LABELS[room.chatMode] || room.chatMode;

    const isHost = room.hostId === state.playerId;
    const hostSelect = $('hostChatModeSelect');
    const canChangeSettings = isHost && (room.phase === 'waiting' || room.phase === 'ready_to_spin');
    hostSelect.classList.toggle('hidden', !canChangeSettings);
    if (canChangeSettings) hostSelect.value = room.chatMode;

    // Chat mode rules
    const chatInfo = $('chatModeInfo');
    const chatInput = $('chatInput');
    const chatSendBtn = $('chatSendBtn');
    if (room.chatMode === 'voice') {
      chatInfo.textContent = '🎙️ Bu masa Sadece Sesli modda. Konuşmak için mikrofonunu açabilirsin.';
      chatInfo.classList.remove('hidden');
      chatInput.disabled = true;
      chatInput.placeholder = 'Sadece sesli modda yazılı sohbet kapalı';
      chatSendBtn.disabled = true;
    } else if (room.chatMode === 'text') {
      chatInfo.textContent = '💬 Bu masa Sadece Yazılı modda. Mikrofonlar devre dışı.';
      chatInfo.classList.remove('hidden');
      chatInput.disabled = false;
      chatInput.placeholder = 'Anonim mesaj yaz...';
      chatSendBtn.disabled = false;
    } else {
      chatInfo.classList.add('hidden');
      chatInput.disabled = false;
      chatInput.placeholder = 'Anonim mesaj yaz...';
      chatSendBtn.disabled = false;
    }

    if (room.chatMode === 'text' && state.micActive) {
      VoiceManager.disableMic();
    }

    updateVoiceButtons();
    renderSeats();
    renderTurnStage();
    renderHistory();

    if (fullChatReset) {
      renderAllChat();
    } else if (room.chat && room.chat.length) {
      syncLatestSystemMessages();
    }
  }

  function updateVoiceButtons() {
    const room = state.room;
    const controls = $('voiceControls');
    if (!room || room.chatMode === 'text') {
      controls.classList.add('hidden');
      return;
    }
    controls.classList.remove('hidden');

    const micBtn = $('toggleMicBtn');
    micBtn.classList.toggle('live', state.micActive);
    micBtn.textContent = state.micActive ? '🎙️ Mikrofon Açık' : '🎙️ Mikrofonu Aç';

    const deafBtn = $('toggleDeafenBtn');
    deafBtn.textContent = state.deafened ? '🔇' : '🔊';
    deafBtn.title = state.deafened ? 'Sesleri aç' : 'Gelen sesleri sustur';

    const pttBtn = $('togglePttBtn');
    pttBtn.classList.toggle('active', state.pttMode);

    const pttHold = $('pttHoldBtn');
    pttHold.classList.toggle('hidden', !state.pttMode || !state.micActive);
    pttHold.classList.toggle('holding', state.pttHolding);
  }

  function renderSeats() {
    const room = state.room;
    if (!room) return;
    const layer = $('seatsLayer');
    layer.innerHTML = '';

    const n = room.players.length;
    const turn = room.currentTurn;
    const showRoles = turn && room.phase !== 'spinning';

    room.players.forEach((p, idx) => {
      const angleDeg = (360 * idx) / n;
      const rad = (angleDeg * Math.PI) / 180;
      const radiusPct = 42;
      const leftPct = 50 + radiusPct * Math.sin(rad);
      const topPct = 50 - radiusPct * Math.cos(rad);

      const isMe = p.id === state.playerId;
      const isTarget = showRoles && turn.targetId === p.id;
      const isAsker = showRoles && turn.askerId === p.id;

      const seat = document.createElement('div');
      seat.className = 'seat-card';
      if (isTarget) seat.classList.add('is-target');
      if (isAsker) seat.classList.add('is-asker');
      if (p.speaking) seat.classList.add('is-speaking');
      seat.style.left = `${leftPct}%`;
      seat.style.top = `${topPct}%`;
      seat.style.setProperty('--seat-color', p.color);

      const micBadge = room.chatMode !== 'text'
        ? `<span class="seat-mic-badge">${p.micEnabled ? (p.speaking ? '🔊' : '🎙️') : '🔇'}</span>`
        : '';

      const roleTag = isTarget
        ? '<span class="seat-role target">🎯 Cevaplayan</span>'
        : isAsker
          ? '<span class="seat-role asker">❓ Soran</span>'
          : '';

      seat.innerHTML = `
        <div class="seat-avatar-wrap">
          <span class="seat-score-badge">⭐ ${p.score}</span>
          <span>${escapeHtml(p.avatarEmoji)}</span>
          ${micBadge}
        </div>
        <div class="seat-name" title="${escapeHtml(p.nickname)}">
          ${p.isHost ? '👑 ' : ''}${escapeHtml(p.nickname)}${isMe ? ' (Sen)' : ''}
        </div>
        ${roleTag}
      `;

      layer.appendChild(seat);
    });
  }

  function syncBottleImmediate(angle) {
    const wrapper = $('bottleWrapper');
    wrapper.style.transition = 'none';
    wrapper.style.transform = `rotate(${angle}deg)`;
  }

  function animateBottleSpin(spin, durationMs) {
    state.spinAnimatingUntil = Date.now() + durationMs;
    const wrapper = $('bottleWrapper');
    wrapper.style.transition = 'none';
    wrapper.style.transform = `rotate(${spin.startAngle}deg)`;
    // Force layout reflow so browser commits startAngle before transition
    void wrapper.offsetWidth;
    wrapper.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.86, 0.22, 1)`;
    wrapper.style.transform = `rotate(${spin.endAngle}deg)`;
  }

  function renderTurnStage() {
    const room = state.room;
    if (!room) return;

    const turn = room.currentTurn;
    const sig = JSON.stringify({
      phase: room.phase,
      count: room.players.length,
      hostId: room.hostId,
      nextSpinnerId: room.nextSpinnerId,
      chatMode: room.chatMode,
      turn,
      composerTab: state.composerTab,
      selectedCategory: state.selectedCategory,
      drawnCardId: state.drawnCard ? state.drawnCard.id : null
    });

    if (sig === state.lastStageSignature) return;
    state.lastStageSignature = sig;

    const stage = $('turnStage');
    const findPlayer = (id) => room.players.find((p) => p.id === id);
    const isHost = room.hostId === state.playerId;

    if (room.phase === 'waiting') {
      stage.innerHTML = `
        <div class="stage-header">
          <span class="stage-title">⏳ Oyuncular Bekleniyor (${room.players.length}/${room.maxPlayers})</span>
          <span class="badge">Min 2 Kişi</span>
        </div>
        <p class="muted small-note">Oyunu başlatıp şişeyi çevirmek için en az 2 anonim oyuncunun masada olması gerekiyor. Davet linkini paylaşabilirsin.</p>
        <div class="action-row">
          <button id="stageShareBtn" type="button" class="btn btn-primary">🔗 Davet Linkini Kopyala</button>
        </div>
      `;
      $('stageShareBtn').addEventListener('click', copyInviteLink);
      return;
    }

    if (room.phase === 'ready_to_spin') {
      const spinner = room.nextSpinnerId ? findPlayer(room.nextSpinnerId) : null;
      const canSpin = !room.nextSpinnerId || room.nextSpinnerId === state.playerId || isHost;
      const subtitle = spinner
        ? `Şişeyi çevirme sırası: <strong>${escapeHtml(spinner.nickname)}</strong>`
        : 'Masadaki herkes ilk tur şişeyi çevirebilir!';

      stage.innerHTML = `
        <div class="stage-header">
          <span class="stage-title">🍾 Tur ${room.roundNumber + 1} • Şişeyi Çevir</span>
          <span class="badge badge-accent">${room.players.length} Oyuncu Hazır</span>
        </div>
        <p class="muted">${subtitle}</p>
        <button id="spinBtn" type="button" class="btn btn-cta btn-lg" ${canSpin ? '' : 'disabled'}>
          ${canSpin ? '🍾 Şişeyi Çevir!' : '⏳ Sıradaki oyuncunun çevirmesi bekleniyor...'}
        </button>
      `;
      if (canSpin) {
        $('spinBtn').addEventListener('click', () => sendWs({ type: 'spin_bottle' }));
      }
      return;
    }

    if (room.phase === 'spinning') {
      stage.innerHTML = `
        <div class="stage-header">
          <span class="stage-title">🌀 Şişe Dönüyor...</span>
          <span class="badge">Tur ${room.roundNumber}</span>
        </div>
        <p class="muted">Şişenin ucu <strong>Cevaplayan</strong>ı, arkası ise <strong>Soran</strong>ı belirleyecek...</p>
      `;
      return;
    }

    const target = turn ? findPlayer(turn.targetId) : null;
    const asker = turn ? findPlayer(turn.askerId) : null;

    if (room.phase === 'choosing_mode') {
      const amTarget = turn.targetId === state.playerId;
      stage.innerHTML = `
        <div class="stage-header">
          <span class="stage-title">🎯 Şişe Durdu! • Tur ${turn.roundNumber}</span>
          <span class="badge">❓ Soran: ${escapeHtml(asker ? asker.nickname : '')}</span>
        </div>
        <p>Şişenin ucu <strong>${escapeHtml(target ? target.nickname : '')}</strong> oyuncusunu gösterdi!</p>
        ${amTarget ? `
          <div class="choice-grid">
            <button id="chooseTruthBtn" type="button" class="choice-btn truth">
              <strong>🔵 DOĞRULUK</strong>
              <small>Dürüstçe soruyu yanıtla</small>
            </button>
            <button id="chooseDareBtn" type="button" class="choice-btn dare">
              <strong>🔥 CESARET</strong>
              <small>Verilen görevi yerine getir</small>
            </button>
          </div>
        ` : `
          <div class="card-preview muted">⏳ ${escapeHtml(target ? target.nickname : 'Oyuncu')}, Doğruluk mu Cesaret mi seçiyor...</div>
        `}
      `;
      if (amTarget) {
        $('chooseTruthBtn').addEventListener('click', () => sendWs({ type: 'choose_mode', mode: 'truth' }));
        $('chooseDareBtn').addEventListener('click', () => sendWs({ type: 'choose_mode', mode: 'dare' }));
      }
      return;
    }

    if (room.phase === 'asking_question') {
      const amAsker = turn.askerId === state.playerId;
      const modeLabel = turn.mode === 'truth' ? '🔵 Doğruluk' : '🔥 Cesaret';

      if (!amAsker) {
        stage.innerHTML = `
          <div class="stage-header">
            <span class="stage-title">${modeLabel} Seçildi!</span>
            <span class="badge">🎯 ${escapeHtml(target ? target.nickname : '')}</span>
          </div>
          <div class="card-preview muted">
            ✍️ <strong>${escapeHtml(asker ? asker.nickname : 'Soran')}</strong> (şişenin arkası), <strong>${escapeHtml(target ? target.nickname : '')}</strong> için soru/görev hazırlıyor...
          </div>
        `;
        return;
      }

      if (room.chatMode === 'text' && state.composerTab === 'voice') {
        state.composerTab = 'custom';
      }

      const voiceTabHtml = room.chatMode !== 'text'
        ? `<button type="button" class="tab-chip ${state.composerTab === 'voice' ? 'active' : ''}" data-tab="voice">🎙️ Sesli Sor</button>`
        : '';

      const categories = ['Tümü', 'Eğlenceli', 'Derin', 'Cesur', 'Sosyal'];

      stage.innerHTML = `
        <div class="stage-header">
          <span class="stage-title">❓ Sıra Sende (${modeLabel})</span>
          <span class="badge">🎯 Hedef: ${escapeHtml(target ? target.nickname : '')}</span>
        </div>
        <div class="composer-tabs">
          <button type="button" class="tab-chip ${state.composerTab === 'custom' ? 'active' : ''}" data-tab="custom">✍️ Özel Yaz</button>
          <button type="button" class="tab-chip ${state.composerTab === 'card' ? 'active' : ''}" data-tab="card">🃏 Hazır Kart Seç</button>
          ${voiceTabHtml}
        </div>
        <div id="composerBody"></div>
      `;

      stage.querySelectorAll('.tab-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.composerTab = btn.dataset.tab;
          state.lastStageSignature = '';
          renderTurnStage();
        });
      });

      const body = $('composerBody');
      if (state.composerTab === 'custom') {
        body.innerHTML = `
          <div class="stack-form">
            <textarea id="customQuestionInput" rows="3" maxlength="280" placeholder="${turn.mode === 'truth' ? 'Doğruluk sorunuzu yazın...' : 'Cesaret görevinizi yazın...'}"></textarea>
            <button id="sendCustomQuestionBtn" type="button" class="btn btn-primary">🚀 Soruyu / Görevi Gönder</button>
          </div>
        `;
        const input = $('customQuestionInput');
        input.value = state.customDraft;
        input.addEventListener('input', () => { state.customDraft = input.value; });
        $('sendCustomQuestionBtn').addEventListener('click', () => {
          const text = input.value.trim();
          if (text.length < 3) {
            showToast('En az 3 karakter yazmalısın.', 'error');
            return;
          }
          state.customDraft = '';
          state.drawnCard = null;
          sendWs({ type: 'submit_question', question: { text, source: 'custom' } });
        });
      } else if (state.composerTab === 'card') {
        const catsHtml = categories.map((cat) =>
          `<button type="button" class="mini-btn ${state.selectedCategory === cat ? 'active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');

        const cardHtml = state.drawnCard
          ? `<div class="card-preview"><strong>[${escapeHtml(state.drawnCard.category)}]</strong> ${escapeHtml(state.drawnCard.text)}</div>`
          : `<div class="card-preview muted">Hazır ${turn.mode === 'truth' ? 'Doğruluk' : 'Cesaret'} kartlarından birini çekmek için "Kart Çek" butonuna bas.</div>`;

        body.innerHTML = `
          <div class="stack-form">
            <div class="composer-tabs">${catsHtml}</div>
            ${cardHtml}
            <div class="action-row">
              <button id="drawCardBtn" type="button" class="btn btn-secondary">🔄 ${state.drawnCard ? 'Başka Kart Çek' : 'Kart Çek'}</button>
              ${state.drawnCard ? '<button id="useCardBtn" type="button" class="btn btn-primary">🚀 Bu Kartı Sor</button>' : ''}
              ${state.drawnCard ? '<button id="editCardBtn" type="button" class="btn btn-ghost">✏️ Düzenle</button>' : ''}
            </div>
          </div>
        `;

        body.querySelectorAll('[data-cat]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.selectedCategory = btn.dataset.cat;
            sendWs({ type: 'draw_card', category: state.selectedCategory });
          });
        });

        $('drawCardBtn').addEventListener('click', () => {
          sendWs({ type: 'draw_card', category: state.selectedCategory });
        });

        if (state.drawnCard) {
          $('useCardBtn').addEventListener('click', () => {
            const chosen = state.drawnCard;
            state.drawnCard = null;
            sendWs({
              type: 'submit_question',
              question: {
                text: chosen.text,
                source: 'card',
                category: chosen.category
              }
            });
          });
          $('editCardBtn').addEventListener('click', () => {
            state.customDraft = state.drawnCard.text;
            state.composerTab = 'custom';
            state.lastStageSignature = '';
            renderTurnStage();
          });
        }
      } else if (state.composerTab === 'voice') {
        body.innerHTML = `
          <div class="stack-form">
            <div class="card-preview muted">Mikrofonunla soruyu veya görevi sesli olarak söyle, ardından aşağıdaki düğmeye basarak cevaplama aşamasını başlat.</div>
            <button id="sendVoiceQuestionBtn" type="button" class="btn btn-primary">🎙️ Soruyu Sesli Sorduğumu Onayla</button>
          </div>
        `;
        $('sendVoiceQuestionBtn').addEventListener('click', () => {
          state.drawnCard = null;
          sendWs({ type: 'submit_question', question: { source: 'voice', text: '🎙️ Soruyu sesli olarak sordu' } });
        });
      }
      return;
    }

    if (room.phase === 'answering') {
      const amTarget = turn.targetId === state.playerId;
      const amAsker = turn.askerId === state.playerId;
      const canFinish = amTarget || amAsker || isHost;
      const modeBadge = turn.mode === 'truth'
        ? '<span class="badge badge-privacy">🔵 Doğruluk</span>'
        : '<span class="badge badge-accent">🔥 Cesaret</span>';

      const answerBox = turn.answerText
        ? `<div class="answer-highlight">💬 <strong>${escapeHtml(target ? target.nickname : '')}:</strong> ${escapeHtml(turn.answerText)}</div>`
        : '';

      const targetReplyForm = amTarget && room.chatMode !== 'voice' && !turn.answerText
        ? `
          <div class="input-with-btn">
            <input id="stageAnswerInput" type="text" maxlength="320" placeholder="Yanıtını buraya yaz (veya sesli yanıtla)...">
            <button id="stageAnswerBtn" type="button" class="btn btn-secondary">Yanıtla</button>
          </div>
        `
        : '';

      stage.innerHTML = `
        <div class="stage-header">
          <div class="action-row" style="align-items:center;">
            ${modeBadge}
            <span class="muted small-note" style="margin:0;">${escapeHtml(asker ? asker.nickname : '')} ➔ <strong>${escapeHtml(target ? target.nickname : '')}</strong></span>
          </div>
          <span class="badge">Tur ${turn.roundNumber}</span>
        </div>
        <div class="question-spotlight">
          <span class="badge">${escapeHtml(turn.question ? turn.question.category : 'Soru')}</span>
          <p class="q-text">${escapeHtml(turn.question ? turn.question.text : '')}</p>
          ${answerBox}
        </div>
        ${targetReplyForm}
        ${canFinish ? `
          <div class="action-row">
            <button id="completeTurnBtn" type="button" class="btn btn-primary">✅ Tamamlandı • Sıradaki Tur</button>
            <button id="skipTurnBtn" type="button" class="btn btn-danger-soft">🏳️ Pas Geç</button>
          </div>
        ` : `<p class="muted small-note">⏳ ${escapeHtml(target ? target.nickname : 'Oyuncu')} yanıtlıyor...</p>`}
      `;

      if ($('stageAnswerInput')) {
        const ansInput = $('stageAnswerInput');
        ansInput.value = state.answerDraft;
        ansInput.addEventListener('input', () => { state.answerDraft = ansInput.value; });
        $('stageAnswerBtn').addEventListener('click', () => {
          const val = ansInput.value.trim();
          if (!val) return;
          state.answerDraft = '';
          sendWs({ type: 'submit_answer', text: val });
        });
      }
      if ($('completeTurnBtn')) {
        $('completeTurnBtn').addEventListener('click', () => sendWs({ type: 'complete_turn', status: 'completed' }));
      }
      if ($('skipTurnBtn')) {
        $('skipTurnBtn').addEventListener('click', () => sendWs({ type: 'complete_turn', status: 'skipped' }));
      }
    }
  }

  // Chat & History Rendering
  const renderedMessageIds = new Set();

  function renderAllChat() {
    const box = $('chatMessages');
    box.innerHTML = '';
    renderedMessageIds.clear();
    if (!state.room || !state.room.chat) return;
    for (const msg of state.room.chat) {
      appendChatMessage(msg);
    }
  }

  function syncLatestSystemMessages() {
    if (!state.room || !state.room.chat) return;
    for (const msg of state.room.chat) {
      if (!renderedMessageIds.has(msg.id)) {
        appendChatMessage(msg);
      }
    }
  }

  function appendChatMessage(msg) {
    if (renderedMessageIds.has(msg.id)) return;
    renderedMessageIds.add(msg.id);

    const box = $('chatMessages');
    const div = document.createElement('div');
    const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (msg.type === 'system') {
      div.className = 'chat-msg system';
      div.textContent = `${msg.text} (${timeStr})`;
    } else {
      div.className = 'chat-msg';
      div.innerHTML = `
        <div class="chat-msg-head">
          <strong style="color:${escapeHtml(msg.color || '#00f5d4')}">${escapeHtml(msg.avatarEmoji || '🎭')} ${escapeHtml(msg.nickname)}</strong>
          <span class="muted">${timeStr}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      `;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function renderHistory() {
    const room = state.room;
    if (!room) return;
    const history = room.history || [];
    $('historyCount').textContent = String(history.length);
    const list = $('historyList');

    if (!history.length) {
      list.innerHTML = '<div class="empty-state">Henüz tamamlanan bir tur yok.</div>';
      return;
    }

    list.innerHTML = '';
    for (const h of history) {
      const item = document.createElement('div');
      item.className = 'history-item';
      const badge = h.mode === 'truth' ? '🔵 Doğruluk' : '🔥 Cesaret';
      item.innerHTML = `
        <div class="chat-msg-head">
          <strong>Tur ${h.roundNumber} • ${badge}</strong>
          <span>${h.skipped ? '🏳️ Pas' : '✅ Tamamlandı'}</span>
        </div>
        <div class="muted">${escapeHtml(h.askerNickname)} ➔ ${escapeHtml(h.targetNickname)}</div>
        <div>"${escapeHtml(h.question)}"</div>
        ${h.answerText ? `<div class="muted">Yanıt: "${escapeHtml(h.answerText)}"</div>` : ''}
      `;
      list.appendChild(item);
    }
  }

  function spawnFloatingReaction(reaction) {
    const layer = $('reactionsLayer');
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.style.left = `${15 + Math.random() * 70}%`;
    el.textContent = reaction.emoji;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1850);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okMsg, 'success');
    } catch {
      showToast(`Kopyala: ${text}`, 'info');
    }
  }

  function copyInviteLink() {
    if (!state.room) return;
    const url = `${location.origin}/?room=${encodeURIComponent(state.room.code)}`;
    copyText(url, 'Davet linki panoya kopyalandı!');
  }

  // Event bindings
  function bindEvents() {
    $('nicknameInput').addEventListener('input', (e) => {
      state.profile.nickname = e.target.value;
      saveProfile();
      updateProfilePreview();
    });

    $('shuffleNickBtn').addEventListener('click', () => {
      state.profile.nickname = randomNickname();
      $('nicknameInput').value = state.profile.nickname;
      saveProfile();
      updateProfilePreview();
    });

    $('maxPlayersGroup').querySelectorAll('.pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('maxPlayersGroup').querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedMaxPlayers = Number(btn.dataset.val);
      });
    });

    $('chatModeGroup').querySelectorAll('.mode-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('chatModeGroup').querySelectorAll('.mode-option').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedChatMode = btn.dataset.val;
      });
    });

    $('visibilityGroup').querySelectorAll('.pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('visibilityGroup').querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedVisibility = btn.dataset.val;
      });
    });

    $('createRoomForm').addEventListener('submit', (e) => {
      e.preventDefault();
      sendWs({
        type: 'create_room',
        profile: getCurrentProfilePayload(),
        options: {
          roomName: $('roomNameInput').value.trim(),
          maxPlayers: state.selectedMaxPlayers,
          chatMode: state.selectedChatMode,
          isPublic: state.selectedVisibility === 'public'
        }
      });
    });

    $('joinByCodeBtn').addEventListener('click', () => {
      const code = $('joinCodeInput').value.trim().toUpperCase();
      if (!code) {
        showToast('Lütfen oda kodunu girin.', 'error');
        return;
      }
      sendWs({
        type: 'join_room',
        code,
        profile: getCurrentProfilePayload()
      });
    });

    $('refreshRoomsBtn').addEventListener('click', () => {
      sendWs({ type: 'list_rooms' });
    });

    $('leaveRoomBtn').addEventListener('click', () => {
      sendWs({ type: 'leave_room' });
    });

    $('copyCodeBtn').addEventListener('click', () => {
      if (state.room) copyText(state.room.code, `Oda kodu kopyalandı: ${state.room.code}`);
    });

    $('copyLinkBtn').addEventListener('click', copyInviteLink);

    $('hostChatModeSelect').addEventListener('change', (e) => {
      sendWs({ type: 'update_room_settings', settings: { chatMode: e.target.value } });
    });

    $('toggleMicBtn').addEventListener('click', () => VoiceManager.toggleMic());
    $('toggleDeafenBtn').addEventListener('click', () => VoiceManager.setDeafened(!state.deafened));

    $('togglePttBtn').addEventListener('click', () => {
      state.pttMode = !state.pttMode;
      state.pttHolding = false;
      VoiceManager._applyTrackEnabled();
      VoiceManager.sendVoiceState();
      updateVoiceButtons();
      showToast(state.pttMode ? 'Bas-Konuş modu açıldı (Space tuşu ile konuş).' : 'Sürekli mikrofon modu açıldı.', 'info');
    });

    const pttHoldBtn = $('pttHoldBtn');
    pttHoldBtn.addEventListener('mousedown', () => VoiceManager.setPttHolding(true));
    pttHoldBtn.addEventListener('mouseup', () => VoiceManager.setPttHolding(false));
    pttHoldBtn.addEventListener('mouseleave', () => VoiceManager.setPttHolding(false));
    pttHoldBtn.addEventListener('touchstart', (e) => { e.preventDefault(); VoiceManager.setPttHolding(true); });
    pttHoldBtn.addEventListener('touchend', () => VoiceManager.setPttHolding(false));

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (state.room && state.pttMode && state.micActive) {
        e.preventDefault();
        VoiceManager.setPttHolding(true);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      if (state.pttHolding) {
        VoiceManager.setPttHolding(false);
      }
    });

    $('toggleSfxBtn').addEventListener('click', () => {
      state.sfxEnabled = !state.sfxEnabled;
      $('toggleSfxBtn').textContent = state.sfxEnabled ? '🔔' : '🔕';
      showToast(state.sfxEnabled ? 'Ses efektleri açık.' : 'Ses efektleri kapatıldı.', 'info');
    });

    $('chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chatInput');
      const text = input.value.trim();
      if (!text) return;
      if (sendWs({ type: 'chat_message', text })) {
        input.value = '';
      }
    });

    $('reactionBar').querySelectorAll('.react-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sendWs({ type: 'reaction', emoji: btn.dataset.emoji });
      });
    });

    $('tabChatBtn').addEventListener('click', () => {
      $('tabChatBtn').classList.add('active');
      $('tabHistoryBtn').classList.remove('active');
      $('chatTabPane').classList.remove('hidden');
      $('historyTabPane').classList.add('hidden');
    });

    $('tabHistoryBtn').addEventListener('click', () => {
      $('tabHistoryBtn').classList.add('active');
      $('tabChatBtn').classList.remove('active');
      $('historyTabPane').classList.remove('hidden');
      $('chatTabPane').classList.add('hidden');
    });

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      $('installAppBtn').classList.remove('hidden');
    });

    $('installAppBtn').addEventListener('click', async () => {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
      $('installAppBtn').classList.add('hidden');
    });
  }

  function init() {
    renderProfileSetup();
    bindEvents();

    const params = new URLSearchParams(location.search);
    const inviteCode = params.get('room');
    if (inviteCode) {
      $('joinCodeInput').value = inviteCode.toUpperCase().slice(0, 8);
      showToast(`Davet kodu hazır: ${inviteCode.toUpperCase()}. "Katıl" butonuna basabilirsin!`, 'info');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    connectWs();
  }

  init();
})();
