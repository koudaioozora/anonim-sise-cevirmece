(() => {
  'use strict';

  const DEFAULT_AVATARS = [
    { id: 'fox', emoji: '🦊', label: 'Tilki' },
    { id: 'wolf', emoji: '🐺', label: 'Kurt' },
    { id: 'owl', emoji: '🦉', label: 'Baykuş' },
    { id: 'eagle', emoji: '🦅', label: 'Kartal' },
    { id: 'cat', emoji: '🐱', label: 'Kedi' },
    { id: 'panda', emoji: '🐼', label: 'Panda' },
    { id: 'tiger', emoji: '🐯', label: 'Kaplan' },
    { id: 'bat', emoji: '🦇', label: 'Gece' },
    { id: 'mask', emoji: '🎭', label: 'Maske' },
    { id: 'moon', emoji: '🌙', label: 'Ay' },
    { id: 'crystal', emoji: '🔮', label: 'Kahin' },
    { id: 'leaf', emoji: '🌿', label: 'Lokal' }
  ];

  const ADJECTIVES = ['Mistik', 'Gölge', 'Gece', 'Kozmik', 'Sessiz', 'Dingin', 'Kuzey', 'Gizemli'];
  const ANIMALS = ['Tilki', 'Kurt', 'Baykuş', 'Kuzgun', 'Vaşak', 'Panter', 'Kartal', 'Kedi'];

  const CHAT_MODE_LABELS = {
    both: '🎙️ + 💬 Sesli & Yazılı',
    text: '💬 Sadece Yazılı',
    voice: '🎙️ Sadece Sesli'
  };

  const state = {
    ws: null,
    connected: false,
    authenticated: false,
    playerId: null,
    avatars: DEFAULT_AVATARS,
    selectedAvatarId: 'fox',
    account: {
      accountKey: null,
      alias: 'Mistik Tilki',
      avatarId: 'fox',
      emoji: '🦊',
      score: 100,
      dmTickets: 1,
      unlockedDecks: ['classic', 'midnight', 'flirt', 'psychology'],
      preferredDeckId: 'classic'
    },
    decks: [],
    publicRooms: [],
    room: null,
    dmStore: {},
    lastClickedPlayer: null,
    pendingDmUnlock: null,
    activeGameDmId: null,
    activeLobbyDmId: null,
    drawnCard: null,
    askerTab: 'custom',
    modalDismissedForRound: -1,
    spinAnimatingUntil: 0,
    countdownTimer: null,
    lastCountdownTickSec: -1,
    micActive: false,
    deafened: false,
    pttMode: false,
    pttHolding: false,
    pendingInviteCode: null,
    pendingWsQueue: [],
    deferredPrompt: null
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const box = $('toastBox');
    $('toastMessage').textContent = msg;
    box.classList.remove('opacity-0', 'translate-y-2');
    box.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.add('opacity-0', 'translate-y-2');
      box.classList.remove('opacity-100', 'translate-y-0');
    }, 3300);
  }

  function randomAlias() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const anim = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(10 + Math.random() * 89);
    return `${adj} ${anim} #${num}`;
  }

  // Realistic Glass Bottle Sound Engine
  const BottleAudio = {
    ctx: null,
    init() {
      try {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      } catch {
        this.ctx = null;
      }
      return this.ctx;
    },
    playClick(time = null, intensity = 1) {
      const ctx = this.init();
      if (!ctx) return;
      const t = time !== null ? time : ctx.currentTime;

      const woodOsc = ctx.createOscillator();
      const woodGain = ctx.createGain();
      woodOsc.type = 'triangle';
      woodOsc.frequency.setValueAtTime(135 + Math.random() * 35, t);
      woodOsc.frequency.exponentialRampToValueAtTime(42, t + 0.045);
      woodGain.gain.setValueAtTime(0.24 * intensity, t);
      woodGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      woodOsc.connect(woodGain);
      woodGain.connect(ctx.destination);
      woodOsc.start(t);
      woodOsc.stop(t + 0.045);

      const glassOsc = ctx.createOscillator();
      const glassGain = ctx.createGain();
      glassOsc.type = 'sine';
      glassOsc.frequency.setValueAtTime(1950 + Math.random() * 250, t);
      glassOsc.frequency.exponentialRampToValueAtTime(980, t + 0.035);
      glassGain.gain.setValueAtTime(0.12 * intensity, t);
      glassGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.035);
      glassOsc.connect(glassGain);
      glassGain.connect(ctx.destination);
      glassOsc.start(t);
      glassOsc.stop(t + 0.035);
    },
    playSpinSequence(durationSec = 4.2) {
      const ctx = this.init();
      if (!ctx) return;
      const now = ctx.currentTime;

      const bufferSize = Math.floor(ctx.sampleRate * durationSec);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + durationSec);
      filter.Q.setValueAtTime(4.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, now);
      noiseGain.gain.linearRampToValueAtTime(0.1, now + 0.25);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      whiteNoise.start(now);
      whiteNoise.stop(now + durationSec);

      let offset = 0.04;
      while (offset < durationSec - 0.15) {
        const progress = offset / durationSec;
        const stepDelay = 0.05 + Math.pow(progress, 2.25) * 0.42;
        const vol = Math.max(0.15, 1 - Math.pow(progress, 1.35));
        this.playClick(now + offset, vol);
        offset += stepDelay;
      }
    },
    playBuzzVibrationSound() {
      const ctx = this.init();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.setValueAtTime(120, now + 0.08);
      osc.frequency.setValueAtTime(85, now + 0.16);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  };

  // WebRTC Mesh Voice Manager
  const VoiceManager = {
    peers: new Map(),
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
        showToast('Bu masa Sadece Yazılı modda.');
        return;
      }
      const next = forceState !== null ? forceState : !state.micActive;
      if (next) await this.enableMic();
      else this.disableMic();
    },

    async enableMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.showWarning('Mikrofon için güvenli bağlantı (localhost veya HTTPS) gerekir. Yazılı sohbeti kullanabilirsin.');
        return;
      }
      try {
        if (!this.localStream) {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
        }
        state.micActive = true;
        this.hideWarning();
        this._applyTrackEnabled();
        this._startSpeakingMonitor();
        await this.syncPeers();
        this.sendVoiceState();
        updateVoiceUI();
        showToast('🎙️ Mikrofonun açıldı (Anonim Ses Kanalı)');
      } catch {
        state.micActive = false;
        this.showWarning('Mikrofon izni alınamadı veya cihaz bulunamadı. Yazılı sohbetle devam edebilirsin.');
        updateVoiceUI();
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
        for (const track of this.localStream.getTracks()) track.stop();
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
            try { entry.pc.removeTrack(sender); } catch {}
          }
        }
      }
      this.lastSpeaking = false;
      this.sendVoiceState();
      updateVoiceUI();
    },

    _applyTrackEnabled() {
      if (!this.localStream) return;
      const enabled = state.micActive && (!state.pttMode || state.pttHolding);
      for (const track of this.localStream.getAudioTracks()) track.enabled = enabled;
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
      updateVoiceUI();
    },

    _startSpeakingMonitor() {
      if (!this.localStream) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (this.audioCtx) this.audioCtx.close().catch(() => {});
      this.audioCtx = new Ctx();
      const src = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
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
        const speaking = (sum / data.length) > 14;
        if (speaking !== this.lastSpeaking) {
          this.lastSpeaking = speaking;
          this.sendVoiceState();
        }
      }, 140);
    },

    sendVoiceState() {
      const effective = state.micActive && (!state.pttMode || state.pttHolding);
      sendWs({
        type: 'voice_state',
        micEnabled: state.micActive,
        speaking: effective && this.lastSpeaking
      });
    },

    async syncPeers() {
      if (!state.room || !this.isRoomVoiceAllowed()) {
        this.closeAllPeers();
        return;
      }
      const humanIds = new Set(
        state.room.players.filter((p) => !p.isBot && p.id !== state.playerId).map((p) => p.id)
      );
      for (const peerId of Array.from(this.peers.keys())) {
        if (!humanIds.has(peerId)) this.closePeer(peerId);
      }
      for (const peerId of humanIds) {
        const entry = this.getOrCreatePeer(peerId);
        if (this.localStream) {
          const senders = entry.pc.getSenders();
          for (const track of this.localStream.getAudioTracks()) {
            if (!senders.some((s) => s.track && s.track.id === track.id)) {
              entry.pc.addTrack(track, this.localStream);
            }
          }
        }
      }
    },

    getOrCreatePeer(peerId) {
      if (this.peers.has(peerId)) return this.peers.get(peerId);
      const pc = new RTCPeerConnection(this.rtcConfig);
      const entry = { pc, makingOffer: false, ignoreOffer: false, audioEl: null };
      this.peers.set(peerId, entry);

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) sendWs({ type: 'webrtc_signal', targetId: peerId, signal: { candidate } });
      };

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          sendWs({ type: 'webrtc_signal', targetId: peerId, signal: { description: pc.localDescription } });
        } catch {
          // ignore
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
        if (pc.connectionState === 'failed') pc.restartIce();
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
            sendWs({ type: 'webrtc_signal', targetId: fromId, signal: { description: pc.localDescription } });
          }
        } else if (signal.candidate) {
          try {
            await pc.addIceCandidate(signal.candidate);
          } catch (err) {
            if (!entry.ignoreOffer) throw err;
          }
        }
      } catch {
        // ignore transient race
      }
    },

    setDeafened(deafened) {
      state.deafened = deafened;
      for (const entry of this.peers.values()) {
        if (entry.audioEl) entry.audioEl.muted = deafened;
      }
      updateVoiceUI();
    },

    closePeer(peerId) {
      const entry = this.peers.get(peerId);
      if (!entry) return;
      try { entry.pc.close(); } catch {}
      if (entry.audioEl) entry.audioEl.remove();
      this.peers.delete(peerId);
    },

    closeAllPeers() {
      for (const id of Array.from(this.peers.keys())) this.closePeer(id);
    },

    resetAll() {
      this.disableMic();
      this.closeAllPeers();
      this.hideWarning();
    },

    showWarning(text) {
      const el = $('voiceSecureWarn');
      el.textContent = text;
      el.classList.remove('hidden');
    },

    hideWarning() {
      $('voiceSecureWarn').classList.add('hidden');
    }
  };

  // Persistent DM storage scoped by accountKey
  function dmStorageKey() {
    const k = state.account.accountKey || 'guest';
    return k.startsWith('sec_') ? `lokal_dms_${k}` : 'lokal_dms_visitor';
  }

  function loadDmStore() {
    try {
      const raw = localStorage.getItem(dmStorageKey());
      state.dmStore = raw ? JSON.parse(raw) : {};
    } catch {
      state.dmStore = {};
    }
  }

  function saveDmStore() {
    try {
      localStorage.setItem(dmStorageKey(), JSON.stringify(state.dmStore));
    } catch {}
  }

  function findContactKeyForPlayer(player) {
    if (!player) return null;
    if (state.dmStore[player.accountKey]) return player.accountKey;
    if (state.dmStore[player.id]) return player.id;
    return null;
  }

  function getDisplayedAlias(player) {
    const key = findContactKeyForPlayer(player);
    return key ? state.dmStore[key].customAlias : player.alias;
  }

  // Server URL & Native Detection
  let wsReconnectTimer = null;

  function isNativeApp() {
    return !!(
      (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
      location.protocol === 'capacitor:'
    );
  }

  function normalizeServerUrl(raw) {
    let val = String(raw || '').trim();
    if (!val) return '';
    if (!/^https?:\/\//i.test(val)) val = `http://${val}`;
    val = val.replace(/\/+$/, '');
    try {
      const u = new URL(val);
      if (u.protocol === 'http:' && !u.port && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) {
        u.port = '3000';
      }
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }

  function getServerBaseUrl() {
    const saved = normalizeServerUrl(localStorage.getItem('lokal_server_url'));
    if (saved) return saved;
    if (isNativeApp() || location.protocol === 'file:') {
      return 'http://10.0.2.2:3000';
    }
    return location.origin;
  }

  function formatShortServerHost(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  }

  function openServerConfigModal() {
    $('serverUrlInput').value = getServerBaseUrl();
    const statusEl = $('serverTestStatus');
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
    $('serverConfigModal').classList.remove('hidden');
    $('serverConfigModal').classList.add('flex');
  }

  function closeServerConfigModal() {
    $('serverConfigModal').classList.add('hidden');
    $('serverConfigModal').classList.remove('flex');
  }

  async function testAndSaveServerUrl() {
    const normalized = normalizeServerUrl($('serverUrlInput').value);
    const statusEl = $('serverTestStatus');
    statusEl.classList.remove('hidden', 'bg-pastel-rose/70', 'text-pastel-roseDark', 'bg-pastel-sage/70', 'text-pastel-sageDark');

    if (!normalized) {
      statusEl.classList.add('bg-pastel-rose/70', 'text-pastel-roseDark');
      statusEl.textContent = 'Geçerli bir adres girin (Örn: http://192.168.1.35:3000).';
      return;
    }

    $('serverUrlInput').value = normalized;
    statusEl.classList.add('bg-pastel-butter/70', 'text-pastel-butterDark');
    statusEl.textContent = `${normalized} test ediliyor...`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`${normalized}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('health failed');

      localStorage.setItem('lokal_server_url', normalized);
      statusEl.classList.remove('bg-pastel-butter/70', 'text-pastel-butterDark');
      statusEl.classList.add('bg-pastel-sage/70', 'text-pastel-sageDark');
      statusEl.textContent = `Bağlantı başarılı! (${data.rooms} masa aktif)`;

      state.authenticated = false;
      connectWs(true);
      setTimeout(closeServerConfigModal, 600);
    } catch {
      localStorage.setItem('lokal_server_url', normalized);
      statusEl.classList.remove('bg-pastel-butter/70', 'text-pastel-butterDark');
      statusEl.classList.add('bg-pastel-rose/70', 'text-pastel-roseDark');
      statusEl.textContent = `Sunucuya ulaşılamadı (${normalized}). Adres kaydedildi; aynı Wi-Fi'da sunucuyu başlatıp tekrar dene.`;
      connectWs(true);
    }
  }

  // WebSocket setup
  function connectWs(forceRestart = false) {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (forceRestart && state.ws) {
      const prev = state.ws;
      state.ws = null;
      state.connected = false;
      try { prev.close(); } catch {}
    }

    const baseUrl = getServerBaseUrl();
    const wsUrl = baseUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:') + '/ws';

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setConnDot('offline');
      wsReconnectTimer = setTimeout(() => connectWs(false), 2000);
      return;
    }

    state.ws = ws;
    setConnDot('connecting');

    ws.addEventListener('open', () => {
      if (state.ws !== ws) return;
      state.connected = true;
      setConnDot('online');
      while (state.pendingWsQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(state.pendingWsQueue.shift()));
      }
    });

    ws.addEventListener('message', (ev) => {
      if (state.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleWsMessage(msg);
    });

    ws.addEventListener('close', () => {
      if (state.ws !== ws) return;
      state.connected = false;
      setConnDot('offline');
      if (state.room) {
        VoiceManager.resetAll();
        stopClientCountdown();
        state.room = null;
        showLobbyView();
        showToast('Bağlantı koptu, yeniden bağlanılıyor...');
      }
      wsReconnectTimer = setTimeout(() => connectWs(false), 2000);
    });
  }

  function setConnDot(status) {
    const dot = $('wsConnDot');
    const authDot = $('authServerDot');
    const authSummary = $('authServerSummary');
    const shortHost = formatShortServerHost(getServerBaseUrl());

    if (status === 'online') {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
      dot.title = `Sunucuya bağlı (${shortHost})`;
      if (authDot) authDot.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
      if (authSummary) authSummary.textContent = `Sunucu bağlı (${shortHost})`;
    } else if (status === 'connecting') {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      dot.title = `Bağlanıyor (${shortHost})...`;
      if (authDot) authDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0';
      if (authSummary) authSummary.textContent = `Bağlanıyor: ${shortHost}`;
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-rose-500';
      dot.title = `Bağlantı yok (${shortHost}) — Tıklayıp ayarla`;
      if (authDot) authDot.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0';
      if (authSummary) authSummary.textContent = `Bağlanılamadı (${shortHost}) • Ayarla`;
    }
  }

  function sendWs(payload) {
    if (!state.ws) {
      state.pendingWsQueue.push(payload);
      showToast('Sunucuya bağlanılıyor, işlem sıraya alındı...');
      return true;
    }
    if (state.ws.readyState === WebSocket.CONNECTING) {
      state.pendingWsQueue.push(payload);
      return true;
    }
    if (state.ws.readyState !== WebSocket.OPEN) {
      state.pendingWsQueue.push(payload);
      showToast('Sunucu bağlantısı yenileniyor, lütfen bekleyin...');
      return false;
    }
    state.ws.send(JSON.stringify(payload));
    return true;
  }

  // Message dispatcher
  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        state.playerId = msg.playerId;
        if (Array.isArray(msg.avatars)) state.avatars = msg.avatars;
        if (Array.isArray(msg.decks)) state.decks = msg.decks;
        state.publicRooms = msg.publicRooms || [];
        renderAuthAvatars();
        renderLobbyRooms();
        renderRoomDeckOptions();
        break;
      }

      case 'auth_ok': {
        state.authenticated = true;
        state.account = msg.account;
        state.publicRooms = msg.publicRooms || [];
        loadDmStore();
        $('authScreen').classList.add('hidden');
        updateHeaderUI();
        renderLobbyRooms();
        renderAllDmInboxes();
        renderRoomDeckOptions();
        showToast(
          msg.restored
            ? `Hoş geldin ${state.account.alias}! (${state.account.score} Puan • ${state.account.dmTickets} DM Hakkı)`
            : `Ziyaretçi girişi tamamlandı! 100 Puan + 1 Özel DM Hakkı tanımlandı.`
        );
        if (state.pendingInviteCode) {
          const code = state.pendingInviteCode;
          state.pendingInviteCode = null;
          sendWs({ type: 'join_room', code });
        }
        break;
      }

      case 'account_update': {
        state.account = msg.account;
        updateHeaderUI();
        renderDecksList();
        renderRoomDeckOptions();
        if (msg.ticketsEarned > 0) {
          showToast(`🎉 ${state.account.score} Puana Ulaştın! +${msg.ticketsEarned} Özel DM Hakkı Kazandın!`);
        }
        break;
      }

      case 'deck_selected': {
        state.account = msg.account;
        updateHeaderUI();
        renderDecksList();
        renderRoomDeckOptions();
        showToast(`🃏 Aktif deste: ${msg.deckName}`);
        break;
      }

      case 'dm_no_tickets': {
        state.pendingDmUnlock = null;
        closeCustomDmModal();
        showToast(msg.error || 'Özel Mektup Hakkın kalmadı! Her 100 puanda +1 hak kazanırsın.');
        break;
      }

      case 'public_rooms': {
        state.publicRooms = msg.rooms || [];
        renderLobbyRooms();
        break;
      }

      case 'room_joined': {
        state.room = msg.room;
        state.lastClickedPlayer = null;
        state.drawnCard = null;
        state.modalDismissedForRound = -1;
        state.spinAnimatingUntil = 0;
        showGameView();
        renderRoom(true);
        syncBottleImmediate(state.room.bottleAngle);
        VoiceManager.syncPeers();
        checkSecureVoiceContext();
        break;
      }

      case 'left_room': {
        VoiceManager.resetAll();
        stopClientCountdown();
        closeTurnModal();
        hideCenterTaskCard();
        state.room = null;
        state.publicRooms = msg.publicRooms || [];
        showLobbyView();
        renderLobbyRooms();
        renderAllDmInboxes();
        break;
      }

      case 'room_state': {
        state.room = msg.room;
        renderRoom(false);
        if (state.room.phase !== 'spinning' && Date.now() >= state.spinAnimatingUntil) {
          syncBottleImmediate(state.room.bottleAngle);
        }
        VoiceManager.syncPeers();
        break;
      }

      case 'turn_expired': {
        state.room = msg.room;
        BottleAudio.playBuzzVibrationSound();
        showToast('⏰ 30 saniyelik süre doldu!');
        renderRoom(false);
        break;
      }

      case 'bottle_spun': {
        state.room = msg.room;
        state.drawnCard = null;
        state.modalDismissedForRound = -1;
        closeTurnModal();
        hideCenterTaskCard();
        stopClientCountdown();
        renderRoom(false);
        animateBottleSpin(msg.spin);
        BottleAudio.playSpinSequence(4.2);
        break;
      }

      case 'card_drawn': {
        state.drawnCard = msg.card;
        $('drawnCardText').textContent = `[${msg.card.category}] ${msg.card.text}`;
        $('sendDrawnCardBtn').classList.remove('hidden');
        break;
      }

      case 'chat_message': {
        if (!state.room) break;
        state.room.chat.push(msg.message);
        if (state.room.chat.length > 80) state.room.chat.shift();
        appendRoomChatMessage(msg.message);
        if (Array.isArray(msg.message.mentionedIds) && msg.message.mentionedIds.length > 0) {
          for (const targetId of msg.message.mentionedIds) {
            const idx = state.room.players.findIndex((p) => p.id === targetId);
            if (idx !== -1) triggerPlayerVibration(idx);
          }
        }
        break;
      }

      case 'dm_unlocked': {
        state.account = msg.account;
        updateHeaderUI();
        if (state.pendingDmUnlock) {
          const { targetKey, alias, customAlias, emoji } = state.pendingDmUnlock;
          state.pendingDmUnlock = null;
          if (!state.dmStore[targetKey]) {
            state.dmStore[targetKey] = {
              id: targetKey,
              originalAlias: alias,
              customAlias,
              emoji,
              messages: [
                { sender: 'sys', text: `🔒 "${customAlias}" ile kalıcı özel mektup kutun açıldı.` }
              ]
            };
          } else {
            state.dmStore[targetKey].customAlias = customAlias;
          }
          saveDmStore();
          renderTableSeats();
          renderAllDmInboxes();
          closeCustomDmModal();
          openGameDmConversation(targetKey);
          showToast(`🔓 "${customAlias}" mektup kutuna kalıcı olarak eklendi!`);
        }
        break;
      }

      case 'private_dm_received': {
        const key = msg.fromAccountKey;
        if (!state.dmStore[key]) {
          state.dmStore[key] = {
            id: key,
            originalAlias: msg.fromAlias,
            customAlias: msg.fromAlias,
            emoji: msg.fromEmoji,
            messages: [
              { sender: 'sys', text: `💌 ${msg.fromAlias} sana özel bir mektup bıraktı.` }
            ]
          };
        }
        state.dmStore[key].messages.push({ sender: 'other', text: msg.text });
        saveDmStore();
        renderAllDmInboxes();
        if (state.activeGameDmId === key) renderGameDmMessages();
        if (state.activeLobbyDmId === key) renderLobbyDmMessages();
        showToast(`💌 Yeni özel mesaj: ${state.dmStore[key].customAlias}`);
        break;
      }

      case 'voice_state': {
        if (!state.room) break;
        const p = state.room.players.find((pl) => pl.id === msg.playerId);
        if (p) {
          p.micEnabled = msg.micEnabled;
          p.speaking = msg.speaking;
          renderTableSeats();
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

      case 'error': {
        state.pendingDmUnlock = null;
        showToast(msg.error || 'Bir hata oluştu.');
        break;
      }

      default:
        break;
    }
  }

  // View switches
  function showLobbyView() {
    $('gameScreen').classList.add('hidden');
    $('gameScreen').classList.remove('flex');
    $('lobbyScreen').classList.remove('hidden');
    $('backToLobbyBtn').classList.add('hidden');
    $('backToLobbyBtn').classList.remove('flex');
    $('headerLocationBadge').textContent = 'Lobi';
  }

  function showGameView() {
    $('lobbyScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');
    $('gameScreen').classList.add('flex');
    $('backToLobbyBtn').classList.remove('hidden');
    $('backToLobbyBtn').classList.add('flex');
    $('headerLocationBadge').textContent = state.room ? state.room.name : 'Masa';
  }

  function updateHeaderUI() {
    $('headerAlias').textContent = state.account.alias;
    $('headerAvatar').textContent = state.account.emoji;
    $('headerScore').textContent = state.account.score;
    $('headerDmTickets').textContent = state.account.dmTickets;
  }

  // Ücretsiz Soru Desteleri Seçimi
  function openDecksModal() {
    renderDecksList();
    const modal = $('decksModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeDecksModal() {
    const modal = $('decksModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function renderDecksList() {
    const container = $('decksListContainer');
    if (!container) return;
    const decks = state.decks || [];
    const activeId = state.room ? state.room.deckId : (state.account.preferredDeckId || 'classic');

    container.innerHTML = '';
    for (const deck of decks) {
      const selected = activeId === deck.id;

      const card = document.createElement('div');
      card.className = `p-4 rounded-[1.75rem] border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
        selected
          ? 'bg-pastel-peach/45 border-pastel-peachDark/40'
          : 'bg-cream-100/80 border-cream-200'
      }`;

      card.innerHTML = `
        <div class="min-w-0">
          <p class="text-sm font-bold text-pastel-ink flex items-center gap-1.5 flex-wrap">
            <span>${escapeHtml(deck.emoji)}</span>
            <span class="truncate">${escapeHtml(deck.name)}</span>
            <span class="px-2 py-0.5 rounded-full bg-pastel-sage/70 text-pastel-sageDark text-[10px] font-bold">${deck.cardCount || 0} Kart</span>
          </p>
          <p class="text-[11px] text-pastel-muted mt-0.5 leading-snug">${escapeHtml(deck.description)}</p>
        </div>
      `;

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      if (selected) {
        actionBtn.disabled = true;
        actionBtn.className = 'w-full sm:w-auto px-4 py-2 rounded-full bg-pastel-sage text-pastel-sageDark font-bold text-xs shrink-0';
        actionBtn.textContent = 'Seçili ✓';
      } else {
        actionBtn.className = 'w-full sm:w-auto px-4 py-2 rounded-full bg-pastel-ink hover:bg-neutral-800 text-cream-50 font-bold text-xs shrink-0 transition';
        actionBtn.textContent = 'Bu Desteyi Seç';
        actionBtn.addEventListener('click', () => sendWs({ type: 'select_deck', deckId: deck.id }));
      }

      card.appendChild(actionBtn);
      container.appendChild(card);
    }
  }

  function renderRoomDeckOptions() {
    const select = $('newRoomDeckSelect');
    if (!select) return;
    const decks = state.decks || [];
    const prev = select.value || state.account.preferredDeckId || 'classic';

    select.innerHTML = '';
    for (const deck of decks) {
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = `${deck.emoji} ${deck.name} (${deck.cardCount || 0} Kart)`;
      select.appendChild(opt);
    }
    if (!select.options.length) {
      const opt = document.createElement('option');
      opt.value = 'classic';
      opt.textContent = '🌿 Klasik Samimi Deste';
      select.appendChild(opt);
    }
    if (Array.from(select.options).some((o) => o.value === prev)) {
      select.value = prev;
    }
  }

  // Auth Screen
  function renderAuthAvatars() {
    const grid = $('authAvatarPicker');
    grid.innerHTML = '';
    for (const av of state.avatars) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const active = state.selectedAvatarId === av.id;
      btn.className = `h-10 rounded-2xl text-lg flex items-center justify-center transition border ${
        active
          ? 'bg-pastel-lavender border-pastel-lavenderDark scale-105 shadow-sm'
          : 'bg-cream-100 border-cream-200 hover:bg-cream-200/70'
      }`;
      btn.textContent = av.emoji;
      btn.title = av.label;
      btn.addEventListener('click', () => {
        state.selectedAvatarId = av.id;
        renderAuthAvatars();
      });
      grid.appendChild(btn);
    }
  }

  // Lobby Rooms
  function renderLobbyRooms() {
    const grid = $('lobbyRoomsGrid');
    grid.innerHTML = '';

    if (!state.publicRooms.length) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-8 px-4 rounded-[2rem] bg-cream-100/70 border border-cream-200/70 text-xs text-pastel-muted">
          Şu anda açık bir masa yok. "Yeni Masa Aç" butonuna tıklayarak ilk çemberi başlatabilirsin!
        </div>
      `;
      return;
    }

    const badgeThemes = [
      'bg-pastel-lavender text-pastel-lavenderDark',
      'bg-pastel-peach text-pastel-peachDark',
      'bg-pastel-sage text-pastel-sageDark',
      'bg-pastel-butter text-pastel-butterDark'
    ];

    state.publicRooms.forEach((room, idx) => {
      const badgeStyle = badgeThemes[idx % badgeThemes.length];
      const card = document.createElement('div');
      card.className = 'p-5 rounded-[2rem] bg-cream-100/70 hover:bg-cream-100 border border-cream-200/80 transition flex flex-col justify-between gap-4 group';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <span class="inline-block text-[10px] font-bold px-3 py-1 rounded-full ${badgeStyle}">
              ${escapeHtml(CHAT_MODE_LABELS[room.chatMode] || room.chatMode)}
            </span>
            <h4 class="font-display text-base font-bold text-pastel-ink mt-2 truncate">${escapeHtml(room.name)}</h4>
          </div>
          <span class="text-xs font-bold px-3 py-1 rounded-full bg-cream-50 text-pastel-ink shadow-sm shrink-0">
            ${room.playerCount}/${room.maxPlayers} Kişi
          </span>
        </div>
        <div class="flex items-center justify-between pt-3 border-t border-cream-200/60">
          <span class="text-[11px] text-pastel-muted">Kod: ${escapeHtml(room.code)}</span>
          <button type="button" class="join-room-btn px-4 py-2 rounded-full bg-pastel-ink group-hover:bg-neutral-800 text-cream-50 font-semibold text-xs transition flex items-center gap-1.5 disabled:opacity-45" ${room.isFull ? 'disabled' : ''}>
            <span>${room.isFull ? 'Masa Dolu' : 'Masaya Otur'}</span>
            <i class="fa-solid fa-arrow-right text-[10px]"></i>
          </button>
        </div>
      `;
      if (!room.isFull) {
        card.querySelector('.join-room-btn').addEventListener('click', () => {
          sendWs({ type: 'join_room', code: room.code });
        });
      }
      grid.appendChild(card);
    });
  }

  // Room Rendering
  const renderedChatIds = new Set();

  function renderRoom(fullReset) {
    const room = state.room;
    if (!room) return;

    $('activeRoomTitleDisplay').textContent = room.name;
    $('activeRoomCodeBadge').textContent = room.code;
    $('activeRoomChatModePill').textContent = CHAT_MODE_LABELS[room.chatMode] || room.chatMode;
    $('activeRoomDeckEmoji').textContent = room.deckEmoji || '🌿';
    $('activeRoomDeckName').textContent = room.deckName || 'Klasik Samimi';
    $('tablePlayerCount').textContent = room.players.length;
    $('tableMaxCount').textContent = room.maxPlayers;
    $('headerLocationBadge').textContent = room.name;
    renderDecksList();

    const isHost = room.hostId === state.playerId;
    $('addBotBtn').classList.toggle('hidden', !isHost);

    // Chat mode rules
    const chatNote = $('roomChatModeNote');
    const chatInput = $('roomChatInput');
    const chatSend = $('roomChatSendBtn');
    if (room.chatMode === 'voice') {
      chatNote.textContent = '🎙️ Bu masa Sadece Sesli modda. Mikrofonunu açıp konuşabilirsin.';
      chatNote.classList.remove('hidden');
      chatInput.disabled = true;
      chatInput.placeholder = 'Sadece sesli modda yazılı sohbet kapalı';
      chatSend.disabled = true;
    } else if (room.chatMode === 'text') {
      chatNote.textContent = '💬 Bu masa Sadece Yazılı modda. Mikrofon kapalı.';
      chatNote.classList.remove('hidden');
      chatInput.disabled = false;
      chatInput.placeholder = 'Birine dokun veya mesaj yaz...';
      chatSend.disabled = false;
    } else {
      chatNote.classList.add('hidden');
      chatInput.disabled = false;
      chatInput.placeholder = 'Birine dokun veya mesaj yaz...';
      chatSend.disabled = false;
    }

    if (room.chatMode === 'text' && state.micActive) {
      VoiceManager.disableMic();
    }

    updateVoiceUI();
    renderTableSeats();
    renderPhaseControls();

    if (fullReset) {
      $('roomChatFeed').innerHTML = '';
      renderedChatIds.clear();
    }
    for (const m of room.chat || []) {
      appendRoomChatMessage(m);
    }
  }

  function updateVoiceUI() {
    const room = state.room;
    const toolbar = $('voiceToolbar');
    if (!room || room.chatMode === 'text') {
      toolbar.classList.add('hidden');
      return;
    }
    toolbar.classList.remove('hidden');

    const icon = $('micIcon');
    const text = $('micText');
    if (state.micActive) {
      icon.className = 'fa-solid fa-microphone text-emerald-500 animate-pulse';
      text.textContent = state.pttMode ? (state.pttHolding ? 'Konuşuyor' : 'Bas-Konuş Hazır') : 'Ses Açık';
    } else {
      icon.className = 'fa-solid fa-microphone-slash text-pastel-roseDark';
      text.textContent = 'Mikrofon Kapalı';
    }

    $('deafenIcon').className = state.deafened ? 'fa-solid fa-volume-xmark text-pastel-roseDark' : 'fa-solid fa-volume-high';
    $('pttToggleBtn').className = `px-3 py-2 rounded-full text-[11px] font-semibold transition ${
      state.pttMode ? 'bg-pastel-butter text-pastel-butterDark' : 'soft-card hover:bg-cream-50 text-pastel-muted'
    }`;
  }

  function checkSecureVoiceContext() {
    if (state.room && state.room.chatMode !== 'text' && !window.isSecureContext) {
      VoiceManager.showWarning('Yerel ağ IP adresi (HTTP) üzerinden mikrofon tarayıcı tarafından engellenebilir. Sesli sohbet için localhost veya HTTPS gerekir; yazılı sohbet aktiftir.');
    } else {
      VoiceManager.hideWarning();
    }
  }

  function renderTableSeats() {
    const room = state.room;
    if (!room) return;
    const container = $('seatsContainer');
    container.innerHTML = '';

    const total = room.players.length;
    const surface = $('tableSurface');
    const fallbackSize = window.innerWidth < 640 ? 264 : (window.innerWidth < 1024 ? 390 : 440);
    const tableSize = (surface && surface.offsetWidth > 0) ? surface.offsetWidth : fallbackSize;
    const radius = Math.round(tableSize * 0.44);
    const avatarBgColors = ['bg-pastel-lavender', 'bg-pastel-peach', 'bg-pastel-sage', 'bg-pastel-rose', 'bg-pastel-butter', 'bg-cream-200'];
    const turn = room.currentTurn;
    const showRoles = turn && room.phase !== 'spinning';

    room.players.forEach((p, idx) => {
      const angleDeg = (360 / total) * idx - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const x = Math.round(radius * Math.cos(angleRad));
      const y = Math.round(radius * Math.sin(angleRad));

      const isMe = p.id === state.playerId;
      const hasCustomDm = !!findContactKeyForPlayer(p);
      const shownName = getDisplayedAlias(p);
      const bgTone = avatarBgColors[idx % avatarBgColors.length];
      const isTarget = showRoles && turn.targetId === p.id;
      const isAsker = showRoles && turn.askerId === p.id;

      const borderClass = isTarget
        ? 'border-pastel-sageDark ring-4 ring-pastel-sage/70'
        : isAsker
          ? 'border-pastel-peachDark ring-4 ring-pastel-peach/70'
          : isMe
            ? 'border-pastel-ink shadow-md'
            : 'border-cream-50 group-hover:border-pastel-peachDark/40';

      const seat = document.createElement('div');
      seat.id = `player-seat-${idx}`;
      seat.className = 'absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto cursor-pointer group select-none';
      seat.style.left = `calc(50% + ${x}px)`;
      seat.style.top = `calc(50% + ${y}px)`;

      seat.addEventListener('click', () => handlePlayerSeatClick(idx));

      seat.innerHTML = `
        <div class="relative flex items-center justify-center group-hover:scale-105 transition-transform">
          <div id="seat-ring-${idx}" class="absolute -inset-2 rounded-full bg-pastel-peach/0 transition-all pointer-events-none"></div>
          ${hasCustomDm ? '<span class="absolute -top-1 -right-1 z-10 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-pastel-butter text-pastel-butterDark text-[9px] sm:text-[10px] font-bold flex items-center justify-center shadow-sm" title="Özel İsimli DM Açık"><i class="fa-solid fa-heart"></i></span>' : ''}
          <div class="w-11 h-11 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-full ${bgTone} border-[3px] sm:border-4 ${borderClass} ${p.speaking ? 'speaking-halo' : ''} flex items-center justify-center text-lg sm:text-2xl lg:text-3xl shadow-sm">
            ${escapeHtml(p.emoji)}
          </div>
          <span class="absolute -bottom-1 -right-1 bg-pastel-ink text-cream-50 text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full shadow-sm">
            ${p.score}P
          </span>
          ${room.chatMode !== 'text' && !p.isBot ? `<span class="absolute -bottom-1 -left-1 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-cream-50 border border-cream-200 text-[8px] sm:text-[9px] flex items-center justify-center shadow-sm">${p.micEnabled ? (p.speaking ? '🔊' : '🎙️') : '🔇'}</span>` : ''}
        </div>
        <span class="mt-0.5 sm:mt-1 px-2 sm:px-2.5 py-0.5 rounded-full bg-cream-50/95 border ${hasCustomDm ? 'border-pastel-peachDark/40 text-pastel-peachDark' : 'border-cream-200 text-pastel-ink'} text-[10px] sm:text-[11px] font-bold max-w-[78px] sm:max-w-[105px] truncate shadow-sm">
          ${escapeHtml(shownName)}${isMe ? ' (Sen)' : ''}
        </span>
        ${isTarget ? '<span class="mt-0.5 px-1.5 sm:px-2 py-0.5 rounded-full bg-pastel-sage text-pastel-sageDark text-[8px] sm:text-[9px] font-extrabold whitespace-nowrap">🎯 Cevaplayan</span>' : ''}
        ${isAsker ? '<span class="mt-0.5 px-1.5 sm:px-2 py-0.5 rounded-full bg-pastel-peach text-pastel-peachDark text-[8px] sm:text-[9px] font-extrabold whitespace-nowrap">❓ Soran</span>' : ''}
      `;
      container.appendChild(seat);
    });
  }

  function handlePlayerSeatClick(index) {
    const room = state.room;
    if (!room) return;
    const target = room.players[index];
    if (!target) return;

    if (target.id === state.playerId) {
      showToast(`Senin Profilin: ${target.alias} (${state.account.score} Puan)`);
      return;
    }

    state.lastClickedPlayer = target;
    const shownName = getDisplayedAlias(target);
    switchSideTab('room');

    const chatInput = $('roomChatInput');
    if (!chatInput.disabled) {
      chatInput.value = `@${shownName} `;
      chatInput.focus();
    }

    const dmBtn = $('openCustomAliasBtn');
    dmBtn.classList.remove('hidden');
    dmBtn.innerHTML = `<i class="fa-solid fa-tag text-[10px]"></i> ${escapeHtml(shownName)} Adlandır`;

    showToast(`@${shownName} seçildi; mesaj gönderdiğinde koltuğu titreyecek!`);
  }

  function triggerPlayerVibration(playerIndex) {
    const room = state.room;
    if (!room || !room.players[playerIndex]) return;
    const seatEl = document.getElementById(`player-seat-${playerIndex}`);
    const ringEl = document.getElementById(`seat-ring-${playerIndex}`);
    const target = room.players[playerIndex];
    const shownName = getDisplayedAlias(target);

    if (seatEl) {
      seatEl.classList.remove('shake-vibrate');
      void seatEl.offsetWidth;
      seatEl.classList.add('shake-vibrate');

      if (ringEl) {
        ringEl.className = 'absolute -inset-3 rounded-full border-2 border-pastel-peachDark bg-pastel-peach/50 animate-ping pointer-events-none';
        setTimeout(() => {
          ringEl.className = 'absolute -inset-2 rounded-full bg-pastel-peach/0 transition-all pointer-events-none';
        }, 850);
      }

      setTimeout(() => seatEl.classList.remove('shake-vibrate'), 750);
    }

    if (navigator.vibrate) navigator.vibrate([120, 50, 160]);
    BottleAudio.playBuzzVibrationSound();
    showToast(`📳 ${shownName} titretildi!`);
  }

  // Bottle animation
  function syncBottleImmediate(angle) {
    const pivot = $('bottlePivot');
    pivot.style.transition = 'none';
    pivot.style.transform = `rotate(${angle}deg)`;
  }

  function animateBottleSpin(spin) {
    state.spinAnimatingUntil = Date.now() + 4300;
    const pivot = $('bottlePivot');
    pivot.style.transition = 'none';
    pivot.style.transform = `rotate(${spin.startAngle}deg)`;
    void pivot.offsetWidth;
    pivot.style.transition = 'transform 4.3s cubic-bezier(0.12, 0.85, 0.22, 1)';
    pivot.style.transform = `rotate(${spin.endAngle}deg)`;
  }

  // Phase controls, Modals, and 30s Center Task Card
  function renderPhaseControls() {
    const room = state.room;
    if (!room) return;

    const spinBtn = $('spinTriggerBtn');
    const spinLabel = $('spinTriggerLabel');
    const findP = (id) => room.players.find((p) => p.id === id);
    const isHost = room.hostId === state.playerId;

    if (room.phase === 'waiting') {
      spinBtn.disabled = true;
      spinLabel.textContent = `En az 2 Kişi (${room.players.length}/${room.maxPlayers})`;
      closeTurnModal();
      hideCenterTaskCard();
      stopClientCountdown();
      return;
    }

    if (room.phase === 'ready_to_spin') {
      const canSpin = !room.nextSpinnerId || room.nextSpinnerId === state.playerId || isHost;
      spinBtn.disabled = !canSpin;
      const spinner = room.nextSpinnerId ? findP(room.nextSpinnerId) : null;
      spinLabel.textContent = canSpin
        ? 'Şişeyi Çevir'
        : `Sıra: ${spinner ? getDisplayedAlias(spinner) : 'Bekleniyor'}`;
      closeTurnModal();
      hideCenterTaskCard();
      stopClientCountdown();
      return;
    }

    spinBtn.disabled = true;
    const turn = room.currentTurn;
    if (!turn) return;

    if (room.phase === 'spinning') {
      spinLabel.textContent = 'Dönüyor...';
      closeTurnModal();
      hideCenterTaskCard();
      return;
    }

    const target = findP(turn.targetId);
    const asker = findP(turn.askerId);

    if (room.phase === 'choosing_mode') {
      hideCenterTaskCard();
      stopClientCountdown();
      spinLabel.textContent = 'Seçim Yapılıyor';

      if (state.modalDismissedForRound === turn.roundNumber) return;

      const amTarget = turn.targetId === state.playerId;
      const targetName = target ? getDisplayedAlias(target) : 'Oyuncu';
      const askerName = asker ? getDisplayedAlias(asker) : 'Soran';

      $('turnTargetBadge').textContent = `🎯 Şişe Durdu: ${targetName} ${target ? target.emoji : ''}`;
      $('turnModalHeading').textContent = amTarget ? 'Doğruluk mu, Cesaret mi?' : `${targetName} Seçim Yapıyor`;
      $('turnModalSub').textContent = `❓ Şişenin Arkası (Soran): ${askerName}`;
      $('turnQuestionBox').classList.add('hidden');

      if (amTarget) {
        $('turnChoiceButtons').classList.remove('hidden');
        $('turnWaitingBox').classList.add('hidden');
      } else {
        $('turnChoiceButtons').classList.add('hidden');
        $('turnWaitingBox').classList.remove('hidden');
        $('turnWaitingBox').textContent = `⏳ ${targetName} Doğruluk veya Cesaret seçiyor...`;
      }

      const modal = $('turnModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      return;
    }

    if (room.phase === 'asking_question') {
      hideCenterTaskCard();
      stopClientCountdown();
      spinLabel.textContent = 'Soru Hazırlanıyor';

      if (state.modalDismissedForRound === turn.roundNumber) return;

      const amAsker = turn.askerId === state.playerId;
      const targetName = target ? getDisplayedAlias(target) : 'Oyuncu';
      const askerName = asker ? getDisplayedAlias(asker) : 'Soran';
      const modeLabel = turn.mode === 'truth' ? '💎 Doğruluk' : '🔥 Cesaret';

      $('turnTargetBadge').textContent = `${modeLabel} Seçildi!`;
      $('turnChoiceButtons').classList.add('hidden');

      if (amAsker) {
        $('turnModalHeading').textContent = `${targetName} İçin Soru/Görev Belirle`;
        $('turnModalSub').textContent = 'İster kendi sorunu yaz, ister hazır kartlardan seç!';
        $('turnActiveDeckLabel').textContent = `${room.deckEmoji || '🌿'} ${room.deckName || 'Klasik Samimi'} Destesi`;
        $('turnWaitingBox').classList.add('hidden');
        $('turnQuestionBox').classList.remove('hidden');
        $('askerVoiceTabBtn').classList.toggle('hidden', room.chatMode === 'text');
        if (room.chatMode === 'text' && state.askerTab === 'voice') state.askerTab = 'custom';
        updateAskerComposerTab();
      } else {
        $('turnModalHeading').textContent = `${modeLabel} • ${targetName}`;
        $('turnModalSub').textContent = `❓ Soran: ${askerName}`;
        $('turnQuestionBox').classList.add('hidden');
        $('turnWaitingBox').classList.remove('hidden');
        $('turnWaitingBox').textContent = `✍️ ${askerName}, ${targetName} için soru veya görev hazırlıyor...`;
      }

      const modal = $('turnModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      return;
    }

    if (room.phase === 'answering') {
      closeTurnModal();
      spinLabel.textContent = 'Süre İşliyor';
      showCenterTaskCard(room, turn, target, asker);
    }
  }

  function updateAskerComposerTab() {
    document.querySelectorAll('.asker-tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === state.askerTab;
      btn.className = `asker-tab-btn px-3.5 py-1.5 rounded-full text-[11px] font-bold ${
        active ? 'bg-pastel-ink text-cream-50' : 'bg-cream-100 text-pastel-muted'
      }`;
    });
    $('askerCustomPane').classList.toggle('hidden', state.askerTab !== 'custom');
    $('askerCardPane').classList.toggle('hidden', state.askerTab !== 'card');
    $('askerVoicePane').classList.toggle('hidden', state.askerTab !== 'voice');
  }

  function showCenterTaskCard(room, turn, target, asker) {
    const card = $('centerActiveTaskCard');
    const badge = $('centerTaskTypeBadge');
    const isHost = room.hostId === state.playerId;
    const amTarget = turn.targetId === state.playerId;
    const amAsker = turn.askerId === state.playerId;
    const targetIsBot = target && target.isBot;

    if (turn.mode === 'truth') {
      badge.textContent = '💎 DOĞRULUK';
      badge.className = 'px-3 py-1 rounded-full bg-pastel-lavender text-pastel-lavenderDark text-[10px] font-bold';
    } else {
      badge.textContent = '🔥 CESARET';
      badge.className = 'px-3 py-1 rounded-full bg-pastel-peach text-pastel-peachDark text-[10px] font-bold';
    }

    const targetName = target ? getDisplayedAlias(target) : 'Oyuncu';
    const askerName = asker ? getDisplayedAlias(asker) : 'Soran';
    $('centerTaskPlayerName').textContent = `${askerName} ➔ ${targetName} ${target ? target.emoji : ''}`;
    $('centerTaskQuestionText').textContent = `"${turn.question ? turn.question.text : ''}"`;

    const ansEl = $('centerTaskAnswerText');
    if (turn.answerText) {
      ansEl.textContent = `💬 ${turn.answerText}`;
      ansEl.classList.remove('hidden');
    } else {
      ansEl.classList.add('hidden');
    }

    // Written reply input for target
    const showTargetReply = amTarget && room.chatMode !== 'voice' && !turn.answerText;
    $('centerTargetAnswerRow').classList.toggle('hidden', !showTargetReply);

    // Replace question input for asker, host, or solo bot play
    const canReplace = amAsker || isHost || targetIsBot;
    $('centerReplaceRow').classList.toggle('hidden', !canReplace);

    // Complete/skip buttons
    const canFinish = amTarget || amAsker || isHost || targetIsBot;
    $('centerCompleteRow').classList.toggle('hidden', !canFinish);
    $('centerWaitFinishNote').classList.toggle('hidden', canFinish);

    card.classList.remove('hidden');
    card.classList.add('flex');

    startClientCountdown(turn.answerDeadline, turn.answerTimeoutMs || 30000);
  }

  function hideCenterTaskCard() {
    const card = $('centerActiveTaskCard');
    card.classList.add('hidden');
    card.classList.remove('flex');
  }

  function startClientCountdown(deadlineMs, totalMs) {
    stopClientCountdown();
    if (!deadlineMs) return;

    const tick = () => {
      const remMs = Math.max(0, deadlineMs - Date.now());
      const sec = Math.ceil(remMs / 1000);
      const pct = Math.max(0, Math.min(100, (remMs / totalMs) * 100));

      $('centerCountdownText').textContent = `${sec}sn`;
      $('centerTimerBar').style.width = `${pct}%`;

      const pill = $('centerTimerPill');
      if (sec <= 10) {
        pill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-pastel-rose text-pastel-roseDark text-xs font-extrabold animate-pulse';
      } else {
        pill.className = 'flex items-center gap-1.5 px-3 py-1 rounded-full bg-pastel-peach text-pastel-peachDark text-xs font-extrabold';
      }

      if (sec > 0 && sec <= 5 && sec !== state.lastCountdownTickSec) {
        state.lastCountdownTickSec = sec;
        BottleAudio.playClick(null, 0.45);
      }
    };

    state.lastCountdownTickSec = -1;
    tick();
    state.countdownTimer = setInterval(tick, 250);
  }

  function stopClientCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function closeTurnModal() {
    const modal = $('turnModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  // Room Chat
  function appendRoomChatMessage(m) {
    if (renderedChatIds.has(m.id)) return;
    renderedChatIds.add(m.id);

    const feed = $('roomChatFeed');
    const div = document.createElement('div');

    if (m.type === 'system') {
      div.innerHTML = `<div class="px-3.5 py-2 rounded-2xl bg-pastel-sage/40 text-pastel-sageDark text-[11px] font-medium text-center">${escapeHtml(m.text)}</div>`;
    } else {
      const isMe = m.playerId === state.playerId;
      const playerObj = state.room ? state.room.players.find((p) => p.id === m.playerId) : null;
      const author = playerObj ? getDisplayedAlias(playerObj) : m.alias;
      const safeText = escapeHtml(m.text).replace(/(@[^\s<]+)/g, '<span class="text-pastel-peachDark font-bold underline">$1</span>');
      div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
      div.innerHTML = `
        <span class="text-[10px] font-semibold text-pastel-muted mb-0.5 px-1">${escapeHtml(author)}</span>
        <div class="px-3.5 py-2 rounded-[1.35rem] ${isMe ? 'bg-pastel-ink text-cream-50 rounded-tr-sm' : 'bg-cream-100 text-pastel-ink rounded-tl-sm'} max-w-[88%] break-words leading-relaxed">
          ${safeText}
        </div>
      `;
    }
    feed.appendChild(div);
    feed.scrollTop = feed.scrollHeight;
  }

  // Permanent DM Inbox (Lobby + In-Game)
  function openCustomDmModalFor(player) {
    state.lastClickedPlayer = player;
    const key = findContactKeyForPlayer(player) || player.accountKey || player.id;
    $('dmModalAvatar').textContent = player.emoji;
    $('dmModalOriginalName').textContent = player.alias;

    const input = $('dmModalCustomAliasInput');
    const btn = $('dmModalConfirmBtn');
    if (state.dmStore[key]) {
      input.value = state.dmStore[key].customAlias;
      btn.textContent = 'Özel Adı Güncelle & DM Kutusuna Git';
    } else {
      input.value = player.alias;
      btn.textContent = `1 DM Hakkı Kullan & Kalıcı Kaydet (${state.account.dmTickets} Hakkın Var)`;
    }

    const modal = $('customDmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeCustomDmModal() {
    const modal = $('customDmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function renderAllDmInboxes() {
    const ids = Object.keys(state.dmStore);
    $('gameDmCountBadge').textContent = ids.length;
    $('lobbyDmCountBadge').textContent = ids.length;

    const gameList = $('gameDmContactsList');
    const lobbyList = $('lobbyDmListContainer');

    if (ids.length === 0) {
      const emptyHtml = `
        <div class="text-center py-10 px-4 text-pastel-muted text-xs">
          <div class="w-12 h-12 rounded-full bg-cream-100 flex items-center justify-center mx-auto mb-3 text-pastel-muted">
            <i class="fa-regular fa-paper-plane text-lg"></i>
          </div>
          Henüz kayıtlı özel bir mektup kutun yok.<br>
          <span class="text-[11px] opacity-80 mt-1 block">Masada bir oyuncuya dokunup özel bir isim vererek kalıcı sohbet başlatabilirsin.</span>
        </div>
      `;
      gameList.innerHTML = emptyHtml;
      lobbyList.innerHTML = emptyHtml;
      return;
    }

    gameList.innerHTML = '';
    lobbyList.innerHTML = '';

    for (const id of ids) {
      const item = state.dmStore[id];
      const lastMsg = item.messages[item.messages.length - 1]?.text || 'Sohbet açık';

      const gCard = document.createElement('div');
      gCard.className = 'p-3 rounded-[1.5rem] bg-cream-100/80 hover:bg-cream-100 cursor-pointer transition flex items-center justify-between';
      gCard.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-10 h-10 rounded-full bg-cream-50 flex items-center justify-center text-lg shadow-sm">${escapeHtml(item.emoji)}</span>
          <div class="min-w-0">
            <p class="text-xs font-bold text-pastel-ink truncate">${escapeHtml(item.customAlias)}</p>
            <p class="text-[10px] text-pastel-muted truncate max-w-[160px]">${escapeHtml(lastMsg)}</p>
          </div>
        </div>
        <i class="fa-solid fa-chevron-right text-[10px] text-pastel-muted mr-1"></i>
      `;
      gCard.addEventListener('click', () => openGameDmConversation(id));
      gameList.appendChild(gCard);

      const lCard = document.createElement('div');
      lCard.className = 'p-3.5 rounded-[1.75rem] bg-cream-100/70 hover:bg-cream-100 cursor-pointer transition flex items-center justify-between';
      lCard.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-11 h-11 rounded-full bg-cream-50 flex items-center justify-center text-xl shadow-sm">${escapeHtml(item.emoji)}</span>
          <div class="min-w-0">
            <p class="text-xs font-bold text-pastel-ink truncate">${escapeHtml(item.customAlias)}</p>
            <p class="text-[10px] text-pastel-muted truncate max-w-[160px]">${escapeHtml(lastMsg)}</p>
          </div>
        </div>
        <span class="text-[10px] bg-pastel-peach text-pastel-peachDark px-3 py-1 rounded-full font-bold">Aç</span>
      `;
      lCard.addEventListener('click', () => openLobbyDmChat(id));
      lobbyList.appendChild(lCard);
    }
  }

  function openGameDmConversation(id) {
    state.activeGameDmId = id;
    const contact = state.dmStore[id];
    if (!contact) return;

    switchSideTab('dm');
    $('dmContactsListView').classList.add('hidden');
    $('dmConversationView').classList.remove('hidden');
    $('dmConversationView').classList.add('flex');
    $('activeDmAvatar').textContent = contact.emoji;
    $('activeDmCustomName').textContent = contact.customAlias;
    renderGameDmMessages();
  }

  function backToGameDmList() {
    state.activeGameDmId = null;
    $('dmConversationView').classList.add('hidden');
    $('dmConversationView').classList.remove('flex');
    $('dmContactsListView').classList.remove('hidden');
    renderAllDmInboxes();
  }

  function renderGameDmMessages() {
    const feed = $('gameDmMessagesFeed');
    feed.innerHTML = '';
    const contact = state.dmStore[state.activeGameDmId];
    if (!contact) return;

    for (const m of contact.messages) {
      const div = document.createElement('div');
      if (m.sender === 'sys') {
        div.className = 'text-center my-1.5';
        div.innerHTML = `<span class="text-[10px] bg-pastel-butter/60 text-pastel-butterDark px-3 py-1 rounded-full inline-block font-medium">${escapeHtml(m.text)}</span>`;
      } else if (m.sender === 'me') {
        div.className = 'flex flex-col items-end';
        div.innerHTML = `<span class="bg-pastel-ink text-cream-50 font-medium px-3.5 py-2 rounded-[1.25rem] rounded-tr-sm max-w-[85%] break-words">${escapeHtml(m.text)}</span>`;
      } else {
        div.className = 'flex flex-col items-start';
        div.innerHTML = `<span class="text-[10px] text-pastel-muted font-bold mb-0.5 ml-1">${escapeHtml(contact.customAlias)}</span><span class="bg-cream-100 text-pastel-ink px-3.5 py-2 rounded-[1.25rem] rounded-tl-sm max-w-[85%] break-words">${escapeHtml(m.text)}</span>`;
      }
      feed.appendChild(div);
    }
    feed.scrollTop = feed.scrollHeight;
  }

  function openLobbyDmChat(id) {
    state.activeLobbyDmId = id;
    const contact = state.dmStore[id];
    if (!contact) return;
    $('lobbyActiveDmBox').classList.remove('hidden');
    $('lobbyActiveDmBox').classList.add('flex');
    $('lobbyDmActiveAvatar').textContent = contact.emoji;
    $('lobbyDmActiveName').textContent = contact.customAlias;
    renderLobbyDmMessages();
  }

  function closeLobbyDmChat() {
    state.activeLobbyDmId = null;
    $('lobbyActiveDmBox').classList.add('hidden');
    $('lobbyActiveDmBox').classList.remove('flex');
  }

  function renderLobbyDmMessages() {
    const box = $('lobbyDmMessages');
    box.innerHTML = '';
    const contact = state.dmStore[state.activeLobbyDmId];
    if (!contact) return;
    for (const m of contact.messages) {
      const d = document.createElement('div');
      if (m.sender === 'sys') {
        d.className = 'text-[10px] text-pastel-muted text-center';
        d.textContent = m.text;
      } else if (m.sender === 'me') {
        d.className = 'text-right';
        d.innerHTML = `<span class="inline-block bg-pastel-ink text-cream-50 px-3 py-1.5 rounded-[1.1rem] rounded-tr-sm">${escapeHtml(m.text)}</span>`;
      } else {
        d.className = 'text-left';
        d.innerHTML = `<span class="inline-block bg-cream-50 text-pastel-ink border border-cream-200 px-3 py-1.5 rounded-[1.1rem] rounded-tl-sm">${escapeHtml(m.text)}</span>`;
      }
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  }

  function sendDmMessageCommon(contactId, text) {
    const contact = state.dmStore[contactId];
    if (!contact) return;
    contact.messages.push({ sender: 'me', text });
    saveDmStore();
    renderAllDmInboxes();

    if (String(contactId).startsWith('bot_')) {
      setTimeout(() => {
        const replies = [
          'Bana verdiğin özel isimle DM kutunda hep duracağım 😉',
          'Sırrın bende güvende!',
          'Yeni bir masaya geçelim mi yoksa burası iyi mi?',
          'Hahaha kesinlikle katılıyorum!'
        ];
        contact.messages.push({ sender: 'other', text: replies[Math.floor(Math.random() * replies.length)] });
        saveDmStore();
        renderAllDmInboxes();
        if (state.activeGameDmId === contactId) renderGameDmMessages();
        if (state.activeLobbyDmId === contactId) renderLobbyDmMessages();
      }, 950);
    } else {
      sendWs({ type: 'private_dm', targetKey: contactId, text });
    }
  }

  function switchSideTab(tab) {
    const roomPanel = $('roomChatPanel');
    const dmPanel = $('dmInboxPanel');
    const roomBtn = $('tabRoomChatBtn');
    const dmBtn = $('tabDmInboxBtn');

    if (tab === 'room') {
      roomPanel.classList.remove('hidden');
      roomPanel.classList.add('flex');
      dmPanel.classList.add('hidden');
      dmPanel.classList.remove('flex');
      roomBtn.className = 'flex-1 py-2.5 rounded-full text-xs font-bold bg-cream-50 text-pastel-ink shadow-sm flex items-center justify-center gap-1.5 transition';
      dmBtn.className = 'flex-1 py-2.5 rounded-full text-xs font-semibold text-pastel-muted hover:text-pastel-ink flex items-center justify-center gap-1.5 transition';
    } else {
      roomPanel.classList.add('hidden');
      roomPanel.classList.remove('flex');
      dmPanel.classList.remove('hidden');
      dmPanel.classList.add('flex');
      dmBtn.className = 'flex-1 py-2.5 rounded-full text-xs font-bold bg-cream-50 text-pastel-ink shadow-sm flex items-center justify-center gap-1.5 transition';
      roomBtn.className = 'flex-1 py-2.5 rounded-full text-xs font-semibold text-pastel-muted hover:text-pastel-ink flex items-center justify-center gap-1.5 transition';
      renderAllDmInboxes();
    }
  }

  // Event bindings
  function bindEvents() {
    $('authShuffleBtn').addEventListener('click', () => {
      $('authAliasInput').value = randomAlias();
    });

    $('visitorLoginBtn').addEventListener('click', () => {
      BottleAudio.init();
      sendWs({
        type: 'authenticate',
        auth: { mode: 'visitor', avatarId: state.selectedAvatarId }
      });
    });

    $('secretLoginBtn').addEventListener('click', () => {
      const alias = $('authAliasInput').value.trim();
      const secretKey = $('authSecretInput').value.trim();
      if (secretKey.length < 3) {
        showToast('Lütfen en az 3 karakterlik bir kurtarma kelimesi gir!');
        return;
      }
      BottleAudio.init();
      sendWs({
        type: 'authenticate',
        auth: { mode: 'secret', alias, avatarId: state.selectedAvatarId, secretKey }
      });
    });

    $('brandHomeBtn').addEventListener('click', () => {
      if (state.room) sendWs({ type: 'leave_room' });
    });
    $('backToLobbyBtn').addEventListener('click', () => {
      if (state.room) sendWs({ type: 'leave_room' });
    });

    // Create Room Modal
    $('openCreateRoomBtn').addEventListener('click', () => {
      renderRoomDeckOptions();
      $('createRoomModal').classList.remove('hidden');
      $('createRoomModal').classList.add('flex');
    });
    $('closeCreateRoomBtn').addEventListener('click', () => {
      $('createRoomModal').classList.add('hidden');
      $('createRoomModal').classList.remove('flex');
    });
    $('createRoomSubmitBtn').addEventListener('click', () => {
      const roomName = $('newRoomNameInput').value.trim();
      const maxPlayers = Number($('newRoomMaxSelect').value) || 6;
      const chatMode = $('newRoomChatModeSelect').value;
      const isPublic = $('newRoomVisibilitySelect').value === 'public';
      const deckId = $('newRoomDeckSelect').value || 'classic';
      $('createRoomModal').classList.add('hidden');
      $('createRoomModal').classList.remove('flex');
      sendWs({
        type: 'create_room',
        options: { roomName, maxPlayers, chatMode, isPublic, deckId }
      });
    });

    // Ücretsiz Soru Desteleri & Mektup Hakkı Bilgisi
    $('openDecksHeaderBtn').addEventListener('click', openDecksModal);
    $('headerDmPillBtn').addEventListener('click', () => {
      showToast(`Her 100 puanda +1 Özel Mektup Hakkı kazanırsın! (${state.account.score} Puan • ${state.account.dmTickets} Hak)`);
    });
    $('lobbyDecksPromoBtn').addEventListener('click', openDecksModal);
    $('lobbyOpenDecksBtn').addEventListener('click', openDecksModal);
    $('activeRoomDeckPill').addEventListener('click', openDecksModal);
    $('closeDecksBtn').addEventListener('click', closeDecksModal);

    $('quickJoinBtn').addEventListener('click', () => {
      sendWs({ type: 'join_random' });
    });

    $('joinByCodeBtn').addEventListener('click', () => {
      const code = $('joinByCodeInput').value.trim().toUpperCase();
      if (!code) {
        showToast('Lütfen oda kodunu gir!');
        return;
      }
      sendWs({ type: 'join_room', code });
    });

    $('refreshLobbyBtn').addEventListener('click', () => {
      sendWs({ type: 'list_rooms' });
    });

    $('copyRoomLinkBtn').addEventListener('click', async () => {
      if (!state.room) return;
      const baseUrl = getServerBaseUrl();
      const shareText = isNativeApp()
        ? `${baseUrl}/?room=${encodeURIComponent(state.room.code)} (Oda Kodu: ${state.room.code})`
        : `${baseUrl}/?room=${encodeURIComponent(state.room.code)}`;
      try {
        await navigator.clipboard.writeText(shareText);
        showToast(`Davet bilgisi kopyalandı! (Kod: ${state.room.code})`);
      } catch {
        showToast(`Oda Kodu: ${state.room.code}`);
      }
    });

    $('addBotBtn').addEventListener('click', () => sendWs({ type: 'add_bot' }));

    // Bottle Spin
    $('bottlePivot').addEventListener('click', () => {
      BottleAudio.init();
      sendWs({ type: 'spin_bottle' });
    });
    $('spinTriggerBtn').addEventListener('click', () => {
      BottleAudio.init();
      sendWs({ type: 'spin_bottle' });
    });

    // Turn Modal
    $('chooseTruthBtn').addEventListener('click', () => sendWs({ type: 'choose_mode', mode: 'truth' }));
    $('chooseDareBtn').addEventListener('click', () => sendWs({ type: 'choose_mode', mode: 'dare' }));

    document.querySelectorAll('.asker-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.askerTab = btn.dataset.tab;
        updateAskerComposerTab();
      });
    });

    $('sendCustomQuestionBtn').addEventListener('click', () => {
      const text = $('customQuestionInput').value.trim();
      if (text.length < 3) {
        showToast('En az 3 karakterlik bir soru veya görev yaz!');
        return;
      }
      $('customQuestionInput').value = '';
      sendWs({ type: 'submit_question', question: { text, source: 'custom' } });
    });

    $('drawCardBtn').addEventListener('click', () => {
      sendWs({ type: 'draw_card', category: 'Tümü' });
    });

    $('sendDrawnCardBtn').addEventListener('click', () => {
      if (!state.drawnCard) return;
      const c = state.drawnCard;
      state.drawnCard = null;
      $('drawnCardText').textContent = 'Hazır kart çekmek için aşağıdaki butona dokun.';
      $('sendDrawnCardBtn').classList.add('hidden');
      sendWs({ type: 'submit_question', question: { text: c.text, source: 'card', category: c.category } });
    });

    $('sendVoiceQuestionBtn').addEventListener('click', () => {
      sendWs({ type: 'submit_question', question: { source: 'voice', text: '🎙️ Soruyu sesli olarak sordu!' } });
    });

    $('closeTurnModalBtn').addEventListener('click', () => {
      if (state.room && state.room.currentTurn) {
        state.modalDismissedForRound = state.room.currentTurn.roundNumber;
      }
      closeTurnModal();
    });

    // Center Active Task Card actions
    $('centerTargetAnswerBtn').addEventListener('click', () => {
      const text = $('centerTargetAnswerInput').value.trim();
      if (!text) return;
      $('centerTargetAnswerInput').value = '';
      sendWs({ type: 'submit_answer', text });
    });

    $('centerReplaceBtn').addEventListener('click', () => {
      const text = $('centerCustomQuestionInput').value.trim();
      if (text.length < 3) return;
      $('centerCustomQuestionInput').value = '';
      sendWs({ type: 'replace_question', text });
    });

    $('centerDoneBtn').addEventListener('click', () => sendWs({ type: 'complete_turn', success: true }));
    $('centerSkipBtn').addEventListener('click', () => sendWs({ type: 'complete_turn', success: false }));

    // Room Chat & @Mention vibration
    $('roomChatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('roomChatInput');
      const text = input.value.trim();
      if (!text || !state.room) return;

      const mentionedIds = [];
      for (const p of state.room.players) {
        const customName = getDisplayedAlias(p);
        if (text.includes(`@${customName}`) || text.includes(`@${p.alias}`)) {
          mentionedIds.push(p.id);
        }
      }

      if (sendWs({ type: 'chat_message', text, mentionedIds })) {
        input.value = '';
      }
    });

    document.querySelectorAll('.quick-emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sendWs({ type: 'chat_message', text: btn.dataset.emoji, mentionedIds: [] });
      });
    });

    // Custom Alias & Permanent DM Modal
    $('openCustomAliasBtn').addEventListener('click', () => {
      if (!lastClickedPlayerGuard()) return;
      openCustomDmModalFor(state.lastClickedPlayer);
    });

    function lastClickedPlayerGuard() {
      if (!state.lastClickedPlayer) {
        showToast('Önce masadan bir oyuncuya tıkla!');
        return false;
      }
      return true;
    }

    $('closeCustomDmBtn').addEventListener('click', closeCustomDmModal);

    $('dmModalConfirmBtn').addEventListener('click', () => {
      if (!state.lastClickedPlayer) return;
      const player = state.lastClickedPlayer;
      const targetKey = findContactKeyForPlayer(player) || player.accountKey || player.id;
      const customAlias = $('dmModalCustomAliasInput').value.trim() || player.alias;

      if (state.dmStore[targetKey]) {
        state.dmStore[targetKey].customAlias = customAlias;
        saveDmStore();
        renderTableSeats();
        renderAllDmInboxes();
        closeCustomDmModal();
        openGameDmConversation(targetKey);
        showToast(`Özel ad "${customAlias}" olarak güncellendi!`);
        return;
      }

      state.pendingDmUnlock = {
        targetKey,
        alias: player.alias,
        customAlias,
        emoji: player.emoji
      };
      sendWs({ type: 'unlock_dm', targetKey });
    });

    $('tabRoomChatBtn').addEventListener('click', () => switchSideTab('room'));
    $('tabDmInboxBtn').addEventListener('click', () => switchSideTab('dm'));
    $('backToDmListBtn').addEventListener('click', backToGameDmList);
    $('renameDmContactBtn').addEventListener('click', () => {
      if (!state.activeGameDmId) return;
      const c = state.dmStore[state.activeGameDmId];
      if (!c) return;
      openCustomDmModalFor({ id: c.id, accountKey: c.id, alias: c.originalAlias, emoji: c.emoji });
    });

    $('gameDmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('gameDmInput');
      const text = input.value.trim();
      if (!text || !state.activeGameDmId) return;
      sendDmMessageCommon(state.activeGameDmId, text);
      input.value = '';
      renderGameDmMessages();
    });

    $('closeLobbyDmBtn').addEventListener('click', closeLobbyDmChat);
    $('lobbyDmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('lobbyDmInput');
      const text = input.value.trim();
      if (!text || !state.activeLobbyDmId) return;
      sendDmMessageCommon(state.activeLobbyDmId, text);
      input.value = '';
      renderLobbyDmMessages();
    });

    // Voice Controls
    $('micToggleBtn').addEventListener('click', () => VoiceManager.toggleMic());
    $('deafenBtn').addEventListener('click', () => VoiceManager.setDeafened(!state.deafened));
    $('pttToggleBtn').addEventListener('click', () => {
      state.pttMode = !state.pttMode;
      state.pttHolding = false;
      VoiceManager._applyTrackEnabled();
      VoiceManager.sendVoiceState();
      updateVoiceUI();
      showToast(state.pttMode ? 'Bas-Konuş açıldı (Space tuşu).' : 'Sürekli mikrofon modu.');
    });

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
      if (e.code === 'Space' && state.pttHolding) VoiceManager.setPttHolding(false);
    });

    window.addEventListener('resize', () => {
      if (state.room) renderTableSeats();
    });
    const tableSurfaceEl = $('tableSurface');
    if (tableSurfaceEl && typeof ResizeObserver !== 'undefined') {
      let lastObservedWidth = 0;
      const tableResizeObserver = new ResizeObserver(() => {
        const w = tableSurfaceEl.offsetWidth;
        if (state.room && w > 0 && w !== lastObservedWidth) {
          lastObservedWidth = w;
          renderTableSeats();
        }
      });
      tableResizeObserver.observe(tableSurfaceEl);
    }

    // Server Config Modal (Android & Web)
    $('openServerConfigAuthBtn').addEventListener('click', openServerConfigModal);
    $('openServerConfigHeaderBtn').addEventListener('click', openServerConfigModal);
    $('closeServerConfigBtn').addEventListener('click', closeServerConfigModal);
    document.querySelectorAll('.server-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('serverUrlInput').value = btn.dataset.url || '';
      });
    });
    $('resetServerUrlBtn').addEventListener('click', () => {
      localStorage.removeItem('lokal_server_url');
      $('serverUrlInput').value = getServerBaseUrl();
      connectWs(true);
      showToast('Varsayılan sunucu adresine dönüldü.');
    });
    $('saveServerUrlBtn').addEventListener('click', testAndSaveServerUrl);

    // PWA Install
    window.addEventListener('beforeinstallprompt', (e) => {
      if (isNativeApp()) return;
      e.preventDefault();
      state.deferredPrompt = e;
      $('installPwaBtn').classList.remove('hidden');
      $('installPwaBtn').classList.add('flex');
    });
    $('installPwaBtn').addEventListener('click', async () => {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
      $('installPwaBtn').classList.add('hidden');
    });
  }

  window.__handleAndroidBack = () => {
    const modals = ['serverConfigModal', 'decksModal', 'customDmModal', 'createRoomModal', 'turnModal'];
    for (const id of modals) {
      const el = $(id);
      if (el && !el.classList.contains('hidden')) {
        el.classList.add('hidden');
        el.classList.remove('flex');
        return true;
      }
    }
    if (state.room) {
      $('backToLobbyBtn').click();
      return true;
    }
    return false;
  };

  function init() {
    renderAuthAvatars();
    bindEvents();

    const params = new URLSearchParams(location.search);
    const serverParam = params.get('server');
    if (serverParam) {
      const norm = normalizeServerUrl(serverParam);
      if (norm) localStorage.setItem('lokal_server_url', norm);
    }

    const invite = params.get('room');
    if (invite) {
      state.pendingInviteCode = invite.toUpperCase().slice(0, 10);
      $('joinByCodeInput').value = state.pendingInviteCode;
      showToast(`Davet kodu algılandı (${state.pendingInviteCode}). Giriş yapınca masaya katılacaksın!`);
    }

    if (!isNativeApp() && location.protocol !== 'file:' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    connectWs();
  }

  init();
})();
