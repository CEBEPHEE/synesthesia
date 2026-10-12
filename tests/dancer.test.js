import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector, estimateBeat, fitTempo, planFromMovement, applyMovementPlan, analyzeMovement, LEVELS } from '../src/core/dancer.js';
import { movementSample, bodyView, handOpenness, armLift, BODY } from '../src/vision/movement.js';

/** A mover hitting a move every `period` s; `energy(t)` scales how hard. */
function mover({ period = 0.5, start = 0.13, seconds = 16, rate = 12, energy = () => 1, lift = () => 0.5 } = {}) {
  const out = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const hits = [];
  for (let t = start; t < seconds; t += period) hits.push(t);
  for (let t = 0; t < seconds; t += 1 / rate) {
    let s = 0.05 + 0.02 * rnd();
    for (const h of hits) { const d = t - h; if (d >= 0 && d < 0.3) s += 1.5 * energy(h) * Math.exp(-d / 0.12); }
    out.push({ t, speed: s, lift: lift(t), present: true });
  }
  return out;
}

describe('dancer: tempo', () => {
  it('finds a 120 BPM mover from 12 frames per second', () => {
    const a = analyzeMovement(mover(), { duration: 16, styleTempo: [100, 130] });
    assert.ok(a.beat && Math.abs(a.beat.bpm - 120) <= 1.5, JSON.stringify(a.beat));
    assert.equal(a.tempo, a.beat.bpm);
    assert.ok(a.offset >= 0 && a.offset < 60 / a.tempo);
  });
  it('no steady beat → keeps the music\'s own tempo', () => {
    let seed = 5;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const samples = Array.from({ length: 200 }, (_, i) => ({ t: i / 12, speed: rnd() < 0.08 ? 1.5 : 0.05, lift: 0.5, present: true }));
    const a = analyzeMovement(samples, { duration: 17, styleTempo: [90, 110] });
    assert.ok(a.beat === null || a.beat.confidence >= 0.45);
  });
  it('folds tempo into the style range', () => {
    assert.equal(fitTempo(60, [100, 130]), 120);
    assert.equal(fitTempo(200, [100, 130]), 100);
    assert.equal(fitTempo(115, [100, 130]), 115);
  });
  it('needs a few moves', () => assert.equal(estimateBeat([{ t: 1, strength: 1 }]), null));
  it('a still signal gives no onsets', () => {
    const d = new OnsetDetector(); let n = 0;
    for (let t = 0; t < 5; t += 1 / 12) if (d.push(t, 0.05)) n++;
    assert.equal(n, 0);
  });
});

describe('dancer: the shape of the piece', () => {
  // calm for 8 bars, then dancing hard for 8 bars, at 120 BPM (a bar = 2 s)
  const samples = mover({ seconds: 32, energy: (t) => (t < 16 ? 0.15 : 1.2), lift: (t) => (t > 24 ? 0.9 : 0.4) });
  const a = analyzeMovement(samples, { duration: 32, styleTempo: [100, 130] });
  const plan = planFromMovement(samples, { duration: 32, tempo: 120, offset: a.offset, onsets: a.onsets });

  it('phrases are 4 bars and follow the energy', () => {
    assert.equal(plan.phrases[0].startBar, 0);
    plan.phrases.forEach((p, i) => { if (i < plan.phrases.length - 1) assert.equal(p.bars, 4); });
    assert.ok(plan.phrases.every((p) => LEVELS.includes(p.level)));
    assert.equal(plan.phrases[0].level, 'calm');
    assert.ok(['groove', 'peak'].includes(plan.phrases.at(-1).level), plan.phrases.map((p) => p.level).join());
  });
  it('raised arms are a "high" phrase', () => {
    assert.equal(plan.phrases.at(-1).lift, 'high');
  });
  it('accents are few, far apart, and not in calm phrases', () => {
    assert.ok(plan.accents.length >= 1 && plan.accents.length <= 5);
    for (let i = 1; i < plan.accents.length; i++) assert.ok(plan.accents[i] - plan.accents[i - 1] >= 64);
    for (const s of plan.accents) assert.notEqual(plan.phrases[Math.floor(s / 64)].level, 'calm');
  });
  it('stillness holds the music', () => {
    const still = Array.from({ length: 12 * 16 }, (_, i) => ({ t: i / 12, speed: 0.01, lift: 0.5, present: true }));
    const p = planFromMovement(still, { duration: 16, tempo: 120, offset: 0, onsets: [] });
    assert.equal(p.phrases[0].level, 'still');
  });

  it('applying the plan never invents notes: it mutes layers, lifts the melody, adds crashes', () => {
    const ev = (step, extra = {}) => ({ step, dur: 2, vel: 0.6, notes: [64], ...extra });
    const arrangement = { tracks: {
      chords: [ev(0), ev(64 * 3)], bass: [ev(0), ev(64 * 3)], kick: [ev(0), ev(64 * 3)], snare: [ev(64 * 3 + 4)], hat: [], tom: [], crash: [],
      melody: [ev(2), ev(64 * 3 + 2)], pointDrums: [],
    } };
    const out = applyMovementPlan(arrangement, plan, { hasDrums: true });
    assert.equal(out.tracks.chords.length, 2);                       // harmony always plays
    assert.ok(!out.tracks.kick.some((e) => e.step < 64));            // calm start: no drums
    assert.ok(!out.tracks.bass.some((e) => e.step < 64));
    assert.ok(out.tracks.kick.some((e) => e.step >= 64 * 3));        // later: the beat comes in
    const lateMelody = out.tracks.melody.find((e) => e.step > 64 * 3);
    assert.equal(lateMelody.notes[0], 76);                           // arms up: an octave higher
    assert.equal(out.tracks.crash.length, plan.accents.length);
  });
});

// ─── landmarks ───
function body({ hands = 0.45, legs = true, dx = 0 } = {}) {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const set = (i, x, y) => { p[i] = { x: x + dx, y, visibility: 0.95 }; };
  set(BODY.nose, 0.5, 0.15); set(BODY.lShoulder, 0.44, 0.3); set(BODY.rShoulder, 0.56, 0.3);
  set(BODY.lElbow, 0.4, 0.4); set(BODY.rElbow, 0.6, 0.4); set(BODY.lWrist, 0.38, hands); set(BODY.rWrist, 0.62, hands);
  set(BODY.lHip, 0.47, 0.55); set(BODY.rHip, 0.53, 0.55);
  if (legs) { set(BODY.lKnee, 0.47, 0.72); set(BODY.rKnee, 0.53, 0.72); set(BODY.lAnkle, 0.47, 0.9); set(BODY.rAnkle, 0.53, 0.9); }
  return p;
}
function hand({ open = 1, x = 0.5, y = 0.6, size = 0.15 } = {}) {
  const h = Array.from({ length: 21 }, () => ({ x, y }));
  h[9] = { x, y: y - size };
  [4, 8, 12, 16, 20].forEach((i, k) => { const r = size * (1.1 + 0.9 * open); h[i] = { x: x + (k - 2) * 0.02 * (open + 0.3), y: y - r }; });
  return h;
}

describe('movement from what is visible', () => {
  it('full body, upper body, hands only', () => {
    assert.equal(bodyView(body()), 'full body');
    assert.equal(bodyView(body({ legs: false })), 'upper body');
    const s = movementSample(null, { bodies: [], hands: [hand()] }, 1 / 12);
    assert.equal(s.view, 'hands'); assert.ok(s.present);
    assert.equal(movementSample(null, { bodies: [], hands: [] }, 1 / 12).present, false);
  });
  it('a half body still moves', () => {
    const a = movementSample(null, { bodies: [body({ legs: false })] }, 1 / 12);
    const b = movementSample({ bodies: [body({ legs: false })] }, { bodies: [body({ legs: false, hands: 0.2 })] }, 1 / 12);
    assert.equal(a.speed, 0); assert.ok(b.speed > 0.5);
  });
  it('moving fingers count, even with the hand in place', () => {
    const s = movementSample({ bodies: [], hands: [hand({ open: 0 })] }, { bodies: [], hands: [hand({ open: 1 })] }, 1 / 12);
    assert.ok(s.speed > 0.3, String(s.speed));
  });
  it('lift: raised arms and open hands are high', () => {
    assert.ok(armLift(body({ hands: 0.1 })) > armLift(body({ hands: 0.5 })));
    assert.ok(handOpenness(hand({ open: 1 })) > 0.7 && handOpenness(hand({ open: 0 })) < 0.3);
  });
});
