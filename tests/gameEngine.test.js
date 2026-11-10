'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  GameManager,
  computeBottleSpin,
  sanitizeProfile,
  normalizeDeg
} = require('../src/gameEngine');

function angularDist(a, b) {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return diff > 180 ? 360 - diff : diff;
}

test('sanitizeProfile ignores any personal/gender fields and uses anonymous defaults', () => {
  const profile = sanitizeProfile({ nickname: 'Gece Tilkisi', avatarId: 'fox', gender: 'ignored', email: 'nope' });
  assert.equal(profile.nickname, 'Gece Tilkisi');
  assert.equal(profile.avatarId, 'fox');
  assert.equal('gender' in profile, false);
  assert.equal('email' in profile, false);
});

test('room enforces min 2 and max 6 players strictly', () => {
  const gm = new GameManager({ spinDurationMs: 0 });

  const c1 = gm.createRoom('p1', { nickname: 'Birinci' }, { maxPlayers: 99 });
  assert.equal(c1.ok, true);
  assert.equal(c1.room.maxPlayers, MAX_PLAYERS);
  assert.equal(c1.room.minPlayers, MIN_PLAYERS);
  assert.equal(c1.room.phase, 'waiting');

  const spinTooEarly = gm.spinBottle('p1');
  assert.equal(spinTooEarly.ok, false);

  for (let i = 2; i <= 6; i += 1) {
    const j = gm.joinRoom(`p${i}`, c1.room.code, { nickname: `Oyuncu ${i}` });
    assert.equal(j.ok, true);
    assert.equal(j.room.players.length, i);
  }

  const seventh = gm.joinRoom('p7', c1.room.code, { nickname: 'Yedinci' });
  assert.equal(seventh.ok, false);
  assert.match(seventh.error, /dolu/i);

  // Also check clamping below 2 -> 2
  const c2 = gm.createRoom('x1', { nickname: 'İkili Masa' }, { maxPlayers: 1 });
  assert.equal(c2.room.maxPlayers, 2);
  assert.equal(gm.joinRoom('x2', c2.room.code, { nickname: 'İkinci' }).ok, true);
  assert.equal(gm.joinRoom('x3', c2.room.code, { nickname: 'Üçüncü' }).ok, false);
});

test('computeBottleSpin aligns tip to target and tail unambiguously to asker for 2..6 players', () => {
  for (let count = 2; count <= 6; count += 1) {
    const players = Array.from({ length: count }, (_, i) => ({ id: `u${i}` }));
    for (let trial = 0; trial < 15; trial += 1) {
      const spin = computeBottleSpin(players, trial * 137, null);
      assert.notEqual(spin.targetIndex, spin.askerIndex);
      assert.ok(spin.endAngle > trial * 137 + 1440);

      const tipAngle = normalizeDeg(spin.endAngle);
      const tailAngle = normalizeDeg(spin.endAngle + 180);
      const targetSeatAngle = (360 * spin.targetIndex) / count;
      const askerSeatAngle = (360 * spin.askerIndex) / count;

      assert.ok(angularDist(tipAngle, targetSeatAngle) <= 10.5);

      const askerDist = angularDist(tailAngle, askerSeatAngle);
      for (let other = 0; other < count; other += 1) {
        if (other === spin.askerIndex) continue;
        const otherSeatAngle = (360 * other) / count;
        assert.ok(
          askerDist < angularDist(tailAngle, otherSeatAngle),
          `N=${count}: tail=${tailAngle} should be closer to asker=${askerSeatAngle} than other=${otherSeatAngle}`
        );
      }
    }
  }
});

test('full turn lifecycle works with custom question, deck card, and completion', () => {
  const gm = new GameManager({ spinDurationMs: 0 });
  const created = gm.createRoom('p1', { nickname: 'Alfa' }, { chatMode: 'both' });
  const code = created.room.code;
  gm.joinRoom('p2', code, { nickname: 'Beta' });
  gm.joinRoom('p3', code, { nickname: 'Gama' });

  const spin = gm.spinBottle('p1');
  assert.equal(spin.ok, true);
  assert.equal(spin.room.phase, 'choosing_mode');

  const { targetId, askerId } = spin.room.currentTurn;
  assert.notEqual(targetId, askerId);

  // Wrong player cannot choose mode
  assert.equal(gm.chooseMode(askerId, 'truth').ok, false);

  const chosen = gm.chooseMode(targetId, 'truth');
  assert.equal(chosen.ok, true);
  assert.equal(chosen.room.phase, 'asking_question');

  // Asker can draw card and submit custom or card question
  const cardRes = gm.drawDeckCard(askerId, 'Eğlenceli');
  assert.equal(cardRes.ok, true);
  assert.ok(cardRes.card.text.length > 5);

  assert.equal(gm.submitQuestion(targetId, { text: 'Yetkisiz', source: 'custom' }).ok, false);
  const asked = gm.submitQuestion(askerId, { text: 'En son ne zaman kahkaha attın?', source: 'custom' });
  assert.equal(asked.ok, true);
  assert.equal(asked.room.phase, 'answering');

  const answered = gm.submitWrittenAnswer(targetId, 'Az önce!');
  assert.equal(answered.ok, true);
  assert.equal(answered.room.currentTurn.answerText, 'Az önce!');

  const done = gm.completeTurn(targetId, 'completed');
  assert.equal(done.ok, true);
  assert.equal(done.room.phase, 'ready_to_spin');
  assert.equal(done.room.history.length, 1);
  assert.equal(done.room.nextSpinnerId, targetId);

  const targetPlayer = done.room.players.find((p) => p.id === targetId);
  assert.equal(targetPlayer.score, 1);
});

test('chat modes enforce text-only and voice-only boundaries properly', () => {
  const gm = new GameManager({ spinDurationMs: 0 });

  // Text-only room blocks voice
  const textRoom = gm.createRoom('t1', { nickname: 'Yazıcı1' }, { chatMode: 'text' });
  gm.joinRoom('t2', textRoom.room.code, { nickname: 'Yazıcı2' });
  assert.equal(gm.sendChatMessage('t1', 'Selam').ok, true);
  assert.equal(gm.setVoiceState('t1', { micEnabled: true }).ok, false);

  // Voice-only room blocks casual text chat, allows voice
  const voiceRoom = gm.createRoom('v1', { nickname: 'Sesli1' }, { chatMode: 'voice' });
  gm.joinRoom('v2', voiceRoom.room.code, { nickname: 'Sesli2' });
  assert.equal(gm.sendChatMessage('v1', 'Selam').ok, false);
  assert.equal(gm.setVoiceState('v1', { micEnabled: true, speaking: true }).ok, true);
});

test('disconnect mid-turn migrates host and resets phase gracefully', () => {
  const gm = new GameManager({ spinDurationMs: 0 });
  const r = gm.createRoom('p1', { nickname: 'Kurucu' }, { isPublic: true });
  gm.joinRoom('p2', r.room.code, { nickname: 'Misafir1' });
  gm.joinRoom('p3', r.room.code, { nickname: 'Misafir2' });

  const spin = gm.spinBottle('p1');
  const { targetId } = spin.room.currentTurn;
  gm.chooseMode(targetId, 'dare');

  // Target leaves mid-turn -> phase resets to ready_to_spin with 2 players
  const leave1 = gm.leaveRoom(targetId);
  assert.equal(leave1.ok, true);
  assert.equal(leave1.roomDeleted, false);
  assert.equal(leave1.room.phase, 'ready_to_spin');
  assert.equal(leave1.room.players.length, 2);

  // Another player leaves -> <2 players -> phase goes to waiting
  const remaining = leave1.room.players[0].id;
  const leave2 = gm.leaveRoom(remaining);
  assert.equal(leave2.room.phase, 'waiting');
  assert.equal(leave2.room.players.length, 1);

  // Last player leaves -> room deleted
  const lastId = leave2.room.players[0].id;
  const leave3 = gm.leaveRoom(lastId);
  assert.equal(leave3.roomDeleted, true);
  assert.equal(gm.getPublicRooms().length, 0);
});
