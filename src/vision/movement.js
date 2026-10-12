/**
 * How a person moves, from whatever is visible: the whole body, only the upper body,
 * or only the hands (close-ups, down to the fingers). Pure, unit-tested.
 *
 * Input per frame: MediaPipe landmarks
 *   bodies: arrays of 33 body points {x, y, visibility}; hands: arrays of 21 hand points {x, y}
 * Output per frame: { speed, lift, present, view }
 *   speed  how fast it moves, in "sizes per second" (body height, or hand size for hands)
 *   lift   0…1: arms raised / hands open (1) versus arms down / fists (0)
 *   view   'full body' | 'upper body' | 'hands' | null
 */

export const BODY = Object.freeze({
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
});
const BODY_MOVERS = [0, 13, 14, 15, 16, 25, 26, 27, 28];
const TIPS = [4, 8, 12, 16, 20];           // thumb … little finger tips
const WRIST = 0, MIDDLE_BASE = 9;

const vis = (p, min = 0.5) => p && (p.visibility ?? 1) >= min && p.x > -0.05 && p.x < 1.05 && p.y > -0.05 && p.y < 1.05;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Size of a body in the frame from what is visible (works for half bodies too). */
export function bodyScale(body) {
  const pts = body.filter((p) => vis(p, 0.4));
  if (pts.length < 3) return null;
  const ys = pts.map((p) => p.y);
  const h = Math.max(...ys) - Math.min(...ys);
  const sw = vis(body[BODY.lShoulder]) && vis(body[BODY.rShoulder]) ? dist(body[BODY.lShoulder], body[BODY.rShoulder]) : 0;
  return Math.max(0.12, h, sw * 3);          // a shoulder-width is about a third of a body height
}

export function bodyView(body) {
  if (!body) return null;
  if (vis(body[BODY.lAnkle]) || vis(body[BODY.rAnkle]) || vis(body[BODY.lKnee]) || vis(body[BODY.rKnee])) return 'full body';
  if (vis(body[BODY.lShoulder]) || vis(body[BODY.rShoulder])) return 'upper body';
  return null;
}

/** The largest visible body. */
export function mainBody(bodies) {
  let best = null, bestS = 0;
  for (const b of bodies ?? []) { const s = bodyScale(b); if (s && s > bestS) { best = b; bestS = s; } }
  return best;
}

export const handSize = (hand) => Math.max(0.02, dist(hand[WRIST], hand[MIDDLE_BASE]));

/** 0 = fist, 1 = wide open hand. */
export function handOpenness(hand) {
  const size = handSize(hand);
  const reach = TIPS.reduce((s, i) => s + dist(hand[i], hand[WRIST]), 0) / TIPS.length / size;
  return clamp01((reach - 1.15) / 0.8);
}

/** Raised arms: wrists above the shoulders. Arms hanging down are an ordinary (middle) pose, not a "closed" one. */
export function armLift(body) {
  const out = [];
  for (const [w, s] of [[BODY.lWrist, BODY.lShoulder], [BODY.rWrist, BODY.rShoulder]]) {
    if (!vis(body[w]) || !vis(body[s])) continue;
    const scale = bodyScale(body) ?? 0.5;
    out.push(clamp01(0.55 + ((body[s].y - body[w].y) / scale) * 1.5));   // hands by the hips ≈ 0.3, at the shoulders 0.55, overhead ≈ 1
  }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}

function bodySpeed(prev, cur, dt) {
  const scale = bodyScale(cur);
  if (!prev || !scale) return 0;
  let sum = 0, n = 0;
  for (const i of BODY_MOVERS) {
    if (!vis(prev[i], 0.4) || !vis(cur[i], 0.4)) continue;
    sum += dist(prev[i], cur[i]); n++;
  }
  return n ? sum / n / scale / dt : 0;
}

/** Fingers and hands: tip movement (relative to the hand) plus the hand's own movement, per hand size. */
function handSpeed(prevHands, hands, dt) {
  let best = 0;
  for (const h of hands) {
    const size = handSize(h);
    // the same hand in the previous frame: the nearest wrist
    let prev = null, d = Infinity;
    for (const p of prevHands ?? []) { const dd = dist(p[WRIST], h[WRIST]); if (dd < d) { d = dd; prev = p; } }
    if (!prev || d > size * 3) continue;
    let fingers = 0;
    for (const i of TIPS) {
      const a = { x: h[i].x - h[WRIST].x, y: h[i].y - h[WRIST].y }, b = { x: prev[i].x - prev[WRIST].x, y: prev[i].y - prev[WRIST].y };
      fingers += Math.hypot(a.x - b.x, a.y - b.y);
    }
    const move = (fingers / TIPS.length + dist(h[WRIST], prev[WRIST])) / size / dt;
    best = Math.max(best, move);
  }
  return best;
}

/**
 * One frame of movement. `prev` is the previous frame's detection (or null).
 * Hands only count as the main signal when the body is not visible or is far away,
 * so a close-up of fingers drives the music as much as a whole dancer does.
 */
export function movementSample(prev, cur, dt) {
  const body = mainBody(cur.bodies);
  const prevBody = prev ? mainBody(prev.bodies) : null;
  const hands = cur.hands ?? [];
  const view = bodyView(body) ?? (hands.length ? 'hands' : null);
  if (!view) return { speed: 0, lift: 0.5, present: false, view: null };
  const bs = body ? bodySpeed(prevBody, body, dt) : 0;
  // hand sizes per second are much bigger numbers than body heights per second
  const hs = handSpeed(prev?.hands, hands, dt) * 0.12;
  const closeUp = !body || view === 'hands' || (hands.length && handSize(hands[0]) > 0.08);
  const speed = closeUp ? Math.max(bs, hs) : bs + 0.3 * hs;
  const arms = body ? armLift(body) : null;
  const open = hands.length ? hands.reduce((s, h) => s + handOpenness(h), 0) / hands.length : null;
  const lift = arms ?? open ?? 0.5;
  return { speed, lift, present: true, view: closeUp && !body ? 'hands' : view };
}
