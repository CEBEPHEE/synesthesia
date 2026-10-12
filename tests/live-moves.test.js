import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveMoves, LIVE_THRESHOLDS, PHRASE_BARS } from '../src/core/live-moves.js';
import { applyMovementPlan } from '../src/core/dancer.js';

const feedBar = (m, speed, lift = 0.5, present = true) => { for (let i = 0; i < 20; i++) m.push({ speed, lift, present, view: 'full body' }); return m.bar(); };
const feedPhrase = (m, ...a) => { let r; for (let i = 0; i < PHRASE_BARS; i++) r = feedBar(m, ...a); return r; };

test('live moves: levels follow how much you move', () => {
  const m = new LiveMoves();
  assert.equal(feedPhrase(m, 0.3).level, 'groove');
  assert.equal(feedPhrase(m, 0.8).level, 'peak');
  assert.equal(feedPhrase(m, 0.12).level, 'calm');
  assert.equal(feedPhrase(m, 0.03).level, 'still');
});

test('live moves: the level only changes on phrase boundaries (every two bars)', () => {
  const m = new LiveMoves();
  feedPhrase(m, 0.12);
  const r = feedBar(m, 0.8);
  assert.equal(r.changed, false);
  assert.equal(r.level, 'calm');
  assert.equal(feedBar(m, 0.8).level, 'peak');
});

test('live moves: hysteresis keeps the level near a border', () => {
  const m = new LiveMoves();
  feedPhrase(m, 0.3);                                         // groove
  assert.equal(feedPhrase(m, LIVE_THRESHOLDS.calm * 0.95).level, 'groove');
  assert.equal(feedPhrase(m, LIVE_THRESHOLDS.calm * 0.5).level, 'calm');
});

test('live moves: arms up raise the melody; nobody in the picture keeps it calm', () => {
  const m = new LiveMoves();
  assert.equal(feedPhrase(m, 0.3, 0.9).lift, 'high');
  const r = feedPhrase(m, 0, 0.5, false);
  assert.equal(r.level, 'calm');
  assert.equal(r.lift, 'mid');
});

test('live moves: the plan shapes any part of a looping arrangement', () => {
  const m = new LiveMoves();
  feedPhrase(m, 0.03);                                        // still → chords only
  const arr = { tracks: { chords: [{ step: 0, notes: [60] }], melody: [{ step: 300, notes: [72], vel: 0.8 }], kick: [{ step: 4000 }], snare: [], hat: [], crash: [] } };
  const out = applyMovementPlan(arr, m.plan(), { hasDrums: true });
  assert.equal(out.tracks.chords.length, 1);
  assert.equal(out.tracks.melody.length, 0);
  assert.equal(out.tracks.kick.length, 0);
});
