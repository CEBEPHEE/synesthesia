/**
 * Audio engine (Tone.js, bundled locally in /vendor). Plays an arrangement
 * produced by core/arranger.js; contains no musical decisions of its own.
 * Instruments are mostly real recordings (see instruments.js).
 *
 * Signal flow (rebuilt whenever the style changes):
 *
 *   chords → [distortion] → [chorus] ─┐
 *   points (melody or drums) ─────────┼─► dry ───────────────┐
 *   bass ─────────────────────────────┤                      ├─► tone (lowpass) → [tape wobble] → compressor → limiter → out
 *   drum kit ─────────────────────────┘                      │
 *   chords/melody/drums ─► reverb send ─► reverb ────────────┤
 *   chords/melody ───────► delay send ──► dotted-8th delay ──┘
 *
 * Events: 'chord' {index}, 'note' {pointIndex}, 'state' {state}, 'loading' / 'loaded' {style}.
 */
import Tone from '../../vendor/tone.mjs';
import { CHORD_INSTRUMENTS, MELODY_INSTRUMENTS, BASS_INSTRUMENTS, createKit } from './instruments.js';
import { mixFor } from './mix.js';

const TICKS_PER_STEP = 48;                            // Tone's default PPQ (192) / 4
const ticks = (step) => `${Math.round(step * TICKS_PER_STEP)}i`;

export class AudioEngine extends EventTarget {
  #master = null;      // compressor + limiter, created once
  #rig = null;         // per-style instruments and effects
  #rigStyleId = null;
  #parts = [];
  #reverbOverride = null;
  #loadTicket = 0;
  /** Tracks to silence: 'chords' | 'bass' | 'drums' | 'melody'. */
  mutedTracks = new Set();

  get ready() { return this.#master !== null; }
  get state() { return Tone.getTransport().state; }
  /** Musical position in 16th steps (independent of tempo changes). */
  get step() { return Tone.getTransport().ticks / TICKS_PER_STEP; }
  /** Jump to a position (16th steps), e.g. to preview one scene of a film. */
  seek(step) { Tone.getTransport().ticks = Math.round(step * TICKS_PER_STEP); }

  /** Must be called from a user gesture (browser autoplay policy). */
  async init() {
    if (this.#master) return;
    await Tone.start();
    // Output safety: Tone's Limiter is a fast compressor, not a brick wall, so
    // sharp drum transients can still overshoot. A soft clipper at the very end
    // is perfectly linear below -2 dBFS and rounds anything louder off smoothly,
    // so the output can never exceed -0.2 dBFS (no harsh digital clipping).
    const softClip = new Tone.WaveShaper((x) => {
      const knee = 0.8, ceiling = 0.977;
      const a = Math.abs(x);
      if (a <= knee) return x;
      return Math.sign(x) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
    }, 4096).toDestination();
    softClip.oversample = '4x';
    // Output fader: lets stop({ hard: true }) silence everything at once,
    // including reverb and echo tails that would otherwise ring on.
    const fader = new Tone.Gain(1).connect(softClip);
    const limiter = new Tone.Limiter(-2).connect(fader);
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.005, release: 0.2 }).connect(limiter);
    this.#master = { limiter, compressor, softClip, fader };
  }

  /**
   * Loads a new arrangement. Safe to call while playing: the transport keeps
   * running, so a new photo or style takes over without a gap.
   */
  async load(arrangement, style, { anchorStep = 0, loopOffset = 0 } = {}) {
    if (!this.#master) throw new Error('AudioEngine.init() must be called first');
    // Every load gets a ticket. Building a rig is async (the reverb is rendered),
    // so if a newer load starts meanwhile, this one must not install anything —
    // otherwise two sets of instruments would play on top of each other.
    const ticket = ++this.#loadTicket;
    this.#disposeParts();
    // Notes already sounding are only cut when the instruments change; small edits
    // (dragging a point, the mood slider) swap the parts without a hiccup.
    const rigKey = `${style.id}|${arrangement.pointsAs}`;
    if (this.#rigStyleId !== rigKey) {
      this.#releaseAll();
      this.#rig?.dispose();
      this.#rig = null;
      this.#rigStyleId = null;
      this.#emit('loading', { style: style.name });
      const rig = await this.#buildRig(style, arrangement.pointsAs);
      this.#emit('loaded', { style: style.name });
      if (ticket !== this.#loadTicket) { rig.dispose(); return; }
      this.#rig = rig;
      this.#rigStyleId = rigKey;
    }
    if (ticket !== this.#loadTicket || !this.#rig) return;
    this.#disposeParts();
    const transport = Tone.getTransport();
    this.#rampTempo(arrangement.tempo, 0.4);
    const loopEnd = ticks(arrangement.loopSteps);
    const sps = () => 60 / transport.bpm.value / 4;    // seconds per 16th step
    const draw = Tone.getDraw();
    const rig = this.#rig;

    const makePart = (events, play, track) => {
      const part = new Tone.Part((time, ev) => { if (!this.mutedTracks.has(track)) play(time, ev); }, events.map((e) => ({ ...e, time: ticks(e.step) })));
      part.loop = true;
      part.loopEnd = loopEnd;
      // anchorStep: the loop starts on that bar (live camera); loopOffset: …from that point of the loop
      part.start(anchorStep ? ticks(anchorStep) : 0, loopOffset ? ticks(loopOffset % arrangement.loopSteps) : undefined);
      this.#parts.push(part);
      return part;
    };

    const { tracks, segments } = arrangement;
    const segmentStarts = new Set(segments.map((s) => s.startStep));
    makePart(tracks.chords, (time, ev) => {
      rig.chords.play(time, ev, sps());
      if (segmentStarts.has(Math.round(ev.step))) draw.schedule(() => this.#emit('chord', { index: ev.chordIndex, section: ev.section ?? 0 }), time);
    }, 'chords');
    if (rig.bass) makePart(tracks.bass, (time, ev) => rig.bass.play(time, ev, sps()), 'bass');
    if (rig.kit) {
      makePart(tracks.kick, (time, ev) => { rig.kit.kick(time, ev.vel); if (rig.pump) this.#pump(time); }, 'drums');
      makePart(tracks.snare, (time, ev) => rig.kit.snare(time, ev.vel), 'drums');
      makePart(tracks.hat, (time, ev) => rig.kit.hat(time, ev.vel, ev.open), 'drums');
      if (tracks.tom?.length) makePart(tracks.tom, (time, ev) => rig.kit.tom(time, ev.vel, ev.notes[0]), 'drums');
      if (tracks.crash?.length) makePart(tracks.crash, (time, ev) => rig.kit.crash(time, ev.vel), 'drums');
    }
    if (rig.melody) {
      makePart(tracks.melody, (time, ev) => {
        rig.melody.play(time, ev, sps());
        draw.schedule(() => this.#emit('note', { pointIndex: ev.pointIndex, section: ev.section ?? 0 }), time);
      }, 'melody');
    }
    if (rig.pointKit) {
      const pk = rig.pointKit;
      const VOICES = {
        tom: (t, e) => pk.tom(t, e.vel, e.notes[0]), snare: (t, e) => pk.snare(t, e.vel),
        kick: (t, e) => pk.kick(t, e.vel), crash: (t, e) => pk.crash(t, e.vel), ride: (t, e) => pk.ride(t, e.vel),
        clap: (t, e) => pk.clap(t, e.vel),
      };
      makePart(tracks.pointDrums, (time, ev) => {
        (VOICES[ev.voice] ?? VOICES.tom)(time, ev);
        draw.schedule(() => this.#emit('note', { pointIndex: ev.pointIndex, section: ev.section ?? 0 }), time);
      }, 'melody');
    }
  }

  async #buildRig(style, pointsAs = 'melody') {
    const { fx, sound } = style;
    const nodes = [];
    const n = (node) => { nodes.push(node); return node; };

    const tone = n(new Tone.Filter({ frequency: fx.lowpass ?? 12000, type: 'lowpass' }));
    if (fx.vibrato) {
      const wobble = n(new Tone.Vibrato({ frequency: 0.6, depth: fx.vibrato }));
      tone.connect(wobble); wobble.connect(this.#master.compressor);
    } else {
      tone.connect(this.#master.compressor);
    }
    const mix = mixFor(style.id);
    const db = (x) => 10 ** (x / 20);
    const master = n(new Tone.Gain(db(mix.master))).connect(tone);
    const dry = n(new Tone.Gain(1)).connect(master);
    const reverb = n(new Tone.Reverb({ decay: fx.reverb[0], preDelay: 0.02, wet: 1 }));
    await reverb.ready;
    reverb.connect(master);
    const reverbSend = n(new Tone.Gain(this.#reverbOverride ?? fx.reverb[1])).connect(reverb);
    const delay = n(new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 1 })).connect(master);
    const delaySend = n(new Tone.Gain(fx.delay ?? 0)).connect(delay);

    // Chords bus with optional distortion and chorus
    const chordsBus = n(new Tone.Gain(1));
    let chain = chordsBus;
    if (fx.distortion) { const d = n(new Tone.Distortion({ distortion: fx.distortion, wet: 1 })); chain.connect(d); chain = d; }
    if (fx.chorus) { const c = n(new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.6, wet: fx.chorus }).start()); chain.connect(c); chain = c; }
    chain.connect(dry); chain.connect(reverbSend); chain.connect(delaySend);

    // Recorded instruments load in parallel (cached after the first time)
    // Only what this arrangement needs is loaded: the melody instrument when the
    // points play a melody, an extra drum kit for the points when they play drums.
    const [chords, melody, bass, kit, pointKit] = await Promise.all([
      (CHORD_INSTRUMENTS[sound.chords] ?? CHORD_INSTRUMENTS.piano)(Tone),
      pointsAs === 'melody' ? (MELODY_INSTRUMENTS[sound.melody] ?? MELODY_INSTRUMENTS.piano)(Tone) : null,
      sound.bass ? (BASS_INSTRUMENTS[sound.bass] ?? BASS_INSTRUMENTS.electricBass)(Tone) : null,
      sound.kit ? createKit(Tone, sound.kit) : null,
      pointsAs === 'drums' ? createKit(Tone, sound.kit ?? 'soft', { forPoints: true }) : null,
    ]);
    // Per-style group trims from the calibrated mix table
    const trim = (node, dB) => { const g = n(new Tone.Gain(db(dB))); node.connect(g); return g; };
    trim(chords.output, mix.chords).connect(chordsBus);
    // The points (melody instrument or point drums) share the "melody" group trim
    const pointsOut = (melody ?? pointKit)?.output;
    if (pointsOut) {
      const mel = trim(pointsOut, pointsAs === 'drums' ? mix.points ?? mix.melody : mix.melody);
      mel.connect(dry); mel.connect(reverbSend);
      if (pointsAs === 'melody') mel.connect(delaySend);
    }
    if (bass) trim(bass.output, mix.bass).connect(dry);

    if (kit) {
      const drums = trim(kit.output, mix.drums);
      drums.connect(dry);
      const kitSend = n(new Tone.Gain(kit.reverbSend)).connect(reverb);
      drums.connect(kitSend);
    }

    return {
      chords, melody, bass, kit, pointKit, chordsBus, reverbSend, pump: !!fx.pump,
      dispose: () => {
        [chords, melody, bass, kit, pointKit].forEach((x) => x?.dispose());
        nodes.forEach((node) => node.dispose());
      },
    };
  }

  /** Sidechain-style "pump": the chords duck on every kick and swell back. */
  #pump(time) {
    const g = this.#rig.chordsBus.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0.35, time);
    g.linearRampToValueAtTime(1, time + 0.22);
  }

  play() {
    const now = Tone.now();
    this.#master?.fader.gain.cancelScheduledValues(now);
    this.#master?.fader.gain.setValueAtTime(1, now);
    Tone.getTransport().start('+0.05');
    this.#emit('state', { state: 'started' });
  }

  pause() {
    Tone.getTransport().pause();
    this.#releaseAll();
    this.#emit('state', { state: 'paused' });
  }

  /**
   * @param {{hard?: boolean}} options  hard: also fade the whole output to silence
   *   in 60 ms, cutting reverb/echo tails (used when a new photo replaces the music).
   */
  stop({ hard = false } = {}) {
    Tone.getTransport().stop();
    this.#releaseAll();
    if (hard && this.#master) {
      const g = this.#master.fader.gain, now = Tone.now();
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.06);
    }
    this.#emit('state', { state: 'stopped' });
  }

  /** The final mix as a MediaStream (for recording the live camera with its music). */
  outputStream() {
    if (!this.#master) return null;
    if (!this.#master.stream) {
      const raw = Tone.getContext().rawContext;
      const dest = raw.createMediaStreamDestination();
      Tone.connect(this.#master.softClip, dest);
      this.#master.stream = dest.stream;
    }
    return this.#master.stream;
  }

  setReverb(wet) {
    this.#reverbOverride = wet;
    this.#rig?.reverbSend.gain.rampTo(wet, 0.2);
  }

  setTempo(bpm) { this.#rampTempo(bpm, 0.3); }

  /**
   * One tempo change at a time: frequent changes (the tempo slider, a new arrangement
   * each bar in camera mode) must not stack ramps on the transport clock, which would corrupt it.
   */
  #rampTempo(bpm, seconds) {
    const p = Tone.getTransport().bpm;
    if (Math.abs(p.value - bpm) < 0.05) return;
    const now = Tone.now();
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(bpm, now + seconds);
  }

  dispose() {
    this.stop();
    this.#disposeParts();
    this.#rig?.dispose();
    this.#rig = null;
    this.#rigStyleId = null;
  }

  #releaseAll() {
    for (const inst of [this.#rig?.chords, this.#rig?.melody, this.#rig?.bass]) inst?.release?.();
  }

  #disposeParts() {
    this.#parts.forEach((p) => p.dispose());
    this.#parts = [];
  }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
