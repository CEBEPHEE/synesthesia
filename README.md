# Synesthesia — music from photos, videos and your camera

**Created by Victoria Lisitsyna.** Free for noncommercial use under the PolyForm Noncommercial License 1.0.0; commercial use needs a paid licence (see [License](#license)).

Synesthesia turns what you see into original, harmonious music, right in the browser.
Colours set the key and the chords, shapes and movement play the melody, and the look of
the picture picks one of 17 genres (from classical piano and jazz to shoegaze, house, trap, electronic and Brazilian phonk),
played with real recorded instruments. It explains every musical decision it makes,
and nothing you show it ever leaves your device.

## What you can do

| Start with | You get | Save it as |
|---|---|---|
| 🖼 **A photo** | A music loop in the genre that fits the picture. Change the genre, tempo or mood, or open **✎ Edit** to drag the points (the melody) and pick chords for each colour. | Music (WAV), notes (MIDI), separate instruments (ZIP), the photo, a “music card” (PNG) or a short video (MP4) |
| 🎬 **Several photos** | A slideshow with one continuous soundtrack: each photo gets its own key and chords, and photos change on the beat. | MP4 in 16:9, 9:16 (Reels, TikTok, Shorts), 1:1 or the original shape |
| 🎥 **A video** | A soundtrack composed scene by scene: the app finds the cuts and the music changes key with each scene. Optionally keeps the video's own sound underneath. With **🕺 Follow the dancer**, the music also takes the dancer's tempo and gets calmer or more energetic with the moves. | MP4 with the new soundtrack |
| 📷 **Your camera** | Live music that follows **the picture** (colours held up to the camera change the key) or **your moves** (body and hand tracking: dance and bass and drums come in, stand still and it holds), every change lands on the beat. | Photos and videos recorded with the music; a recording can also get a newly composed soundtrack |

Also:

* **Why it sounds like this**: for every picture, the app explains the genre, key, tempo, chords and melody in plain words, with the numbers behind them.
* **This session**: recordings and camera photos are kept in the page until you close the tab, so switching to something else never loses them. The browser's Back button returns to the previous photo, video or the camera.
* **Private by design**: no server, no account, no uploads. The page is technically blocked from sending anything anywhere.
* **Free for personal use**: make and share music and videos for yourself, study or noncommercial projects. Commercial use needs a licence (see [License](#license)). The instruments are CC BY 3.0 recordings, so credit them when you publish (the app gives you the credit line).

## Running it

1. Unzip the archive (`index.html` is at the top level).
2. Open a terminal in that folder and start the bundled server:
   ```bash
   python3 serve.py                # or: npm start   (any static server works too)
   ```
3. Open http://localhost:5173. Drop a photo, several photos or a video, press **📷 Use camera**, or try the demo image.

Opening `index.html` by double-click (`file://`) does not work: browsers block ES modules, workers and sample loading there.
Everything is bundled (Tone.js and mp4-muxer in `vendor/`, recordings in `assets/samples/`), so the app also works offline.
To put it online for free, see **Publishing on GitHub Pages** below.

Tests: `npm test` (Node ≥ 21, no dependencies).

## Architecture

```
 FrameSource ─► VisionAnalyzer ─(Transferable)─► analyzer.worker.js
 (photo/webcam)  downscale to 192 px               ├─ color-quantizer.js  k-means++ → palette (HSV)
                                                   ├─ keypoints.js        Sobel + grid → points of interest
                                                   └─ features.js         8-value photo fingerprint
                      │ { palette, keypoints, features }
                      ▼
   core/styles.js  classifyStyle(features) ─► best style + ranking + reasons
                      ▼
   core/mapping.js  buildMusicalScore(analysis, { style }) ─► key, mode, tempo, chords, melody, decisions
                      │     └─ core/voice-leading.js
                      ▼
   core/arranger.js  arrange(score, style) ─► note events per track (chords, bass, kick, snare, hat, melody)
                      ▼
   core/explain.js   buildExplanation(...) ─► "Why it sounds like this" text
                      │
        ┌─────────────┼───────────────────────────┐
        ▼             ▼                           ▼
 ui/canvas-renderer  ui/panels          audio/audio-engine.js + audio/instruments.js (Tone.js)
```

| Layer | Knows the DOM | Knows Tone.js | Tested in Node |
|---|---|---|---|
| `src/core/*` (theory, mapping, styles, arranger, explain) | no | no | yes |
| `src/vision/color-quantizer.js`, `keypoints.js`, `features.js` | no | no | yes |
| `src/vision/vision-client.js`, `frame-source.js` | yes | no | — |
| `src/audio/*` | no | yes | wiring in Node; sound rendered offline with the real Tone.js in headless Chromium |
| `src/ui/*`, `src/app.js` | yes | no | — |

## Mapping rules

| Visual feature | Musical parameter |
|---|---|
| Hue of the largest colourful area (30° slices) | Root note on the circle of fifths: similar colours → related keys |
| Average brightness V and saturation S | Mode: Lydian → major → Mixolydian → Dorian → minor → Phrygian, then shifted by the style |
| Hue of the other colours relative to the key colour | Chord degrees (7 slices); diminished chords and repeats move a third down |
| Share of each colour in the frame | Chord length: ≥ 30% → 2 bars |
| Spread of the points of interest | Tight cluster (< 0.22) → one extra chord tone |
| Visual distance between neighbouring points (position + contour) | Interval from the consonance ladder `[0,7,4,3,5,9,8,2,10]` on a square-root curve; m2, tritone, M7 excluded |
| Point position: y / x (read relative to the points, stretched to a full phrase) | Melody contour / timing in a 2-bar phrase |
| Point brightness | Second contour source; the main one when the points form a horizontal line |
| No contour at all (flat line, identical colours) | Fallback motif through the scale, in the photo's rhythm |
| Points as drums (default in Hard Rock, Indie Rock, Jazz; switchable with “Points play”) | Same rhythm, but each point is a drum hit: upper half → high voice (high tom / brush snare), lower half → low toms, strongest point → crash or ride |
| (Contrast + saturation + sharpness) / 3 | Tempo inside the style's range |

## Styles and automatic selection

Seventeen styles: Classical Piano, Cinematic, Ambient, Shoegaze, Dream Pop, Indie Rock,
Hard Rock, Pop, Synthwave, House, Jazz, Lo-fi Hip-Hop, Boom Bap, Trap, Electronic, Brazilian Phonk, Folk / Acoustic.

Each style defines a target photo fingerprint (with signature traits weighted ×2), a tempo
range, a mode shift, a chord vocabulary (triads, sevenths, ninths, add9, power chords),
rhythm patterns for chords, bass and drums, swing, instruments and effects.
The photo's fingerprint is compared to every target with a weighted mean absolute
distance; the closest style wins. You can override it from the Style menu.

Calibration: normalisation constants were tuned on a set of real photos and edited
variants (blurred, darkened, over-saturated, black-and-white with grain) so that typical
photos spread across the 0..1 range and 14 of the original 15 styles win on at least one of them.
Electronic (sharp, contrasty, cold, busy: club and city lights) and Brazilian Phonk (dark,
gritty, saturated, contrasty) were added later; on random fingerprints each wins about as
often as any other style.

## Saving (photo mode)

**⬇ Save** (photo mode), grouped by what you get:

| Option | What you get |
|---|---|
| Audio | WAV of the full mix: whole loops, at least 30 s, plus the reverb tail. Rendered faster than real time in an offline audio context with the same instruments and mix. |
| MIDI | A standard MIDI file (type 1): tempo, chords, bass, melody or point-drums, drums on channel 10, General MIDI programs. Opens in Ableton, FL Studio, Logic, GarageBand, MuseScore. |
| Separate instruments (stems) + MIDI | ZIP with one WAV per group (chords, bass, drums, points) plus the mix, all the same length, so they line up at bar 1 in any DAW, plus the MIDI file and a README with credits. |

| Photo | JPEG of the picture only (no points, no music). |
| Music card | PNG: the picture with its points, style, key and chords. |
| Video | MP4 of the photo with its music (about 20–30 s, slow push-in, points light up on their notes). |

## Publishing on GitHub Pages (or any static host)

The app is plain static files, so any static host works. It has fewer than 100 files on purpose
(the instrument recordings are packed into one file per instrument in `assets/samples/*.bin`),
because GitHub's web upload accepts at most 100 files at once.

1. Unzip, then upload **everything** that is next to `index.html` (including the `assets` and `vendor` folders
   and the hidden `.nojekyll` file) to the root of the repository.
   Easiest: on github.com open the repository → *Add file → Upload files* → drag the **contents** of the unzipped folder.
2. *Settings → Pages → Build and deployment*: Source “Deploy from a branch”, branch `main`, folder `/ (root)`.
3. After a minute the app is at `https://<user>.github.io/<repository>/`.

If the app says the instrument recordings were not found, the `assets` folder was not uploaded.

**Search engines and AI assistants.** The pages carry a description, link-preview tags (`assets/og.png`) and
structured data (schema.org `WebApplication` and `FAQPage`). There are three landing pages for the main uses
(`photo-to-music.html`, `video-soundtrack.html`, `webcam-music.html`), a `sitemap.xml`, `robots.txt` and an `llms.txt`
summary for AI tools. After publishing, add the site to Google Search Console and Bing Webmaster Tools and submit
`sitemap.xml`. If the site moves to its own domain, update the address in those files (search for `cebephee.github.io`).
The camera works there too, because GitHub Pages uses https.

## Follow the dancer (videos)

An optional button in video mode. The person in the video **never writes the notes** (chords and melody still
come from the picture, which is what keeps it musical); the movement shapes only what changes slowly in real songs:

1. **Tempo**: one tempo for the whole video, the dancer's. Moves are found as sudden bursts of speed (onsets);
   every tempo from 70 to 160 BPM is tried and the one whose beat clock lines the moves up best wins, then it is
   folded by octaves into the style's range. The music starts on the dancer's beat. No steady beat → the music keeps its own tempo.
2. **Form**: each 4-bar phrase gets a level from how much the person moves (relative to the whole video):
   *still* (chords only, the music holds), *calm* (chords + melody), *groove* (+ bass and drums), *peak* (everything, louder).
   Levels change only between phrases, with hysteresis, so it sounds like verses and choruses, not twitching.
3. **Colour**: raised arms or open hands for a phrase → the same melody an octave higher; fists → softer.
4. **Accents**: the few biggest moves (at most 5, at least 4 bars apart, never in calm phrases) get a cymbal crash with a short snare fill, on the 16th grid.

**Partial bodies and hands.** Tracking uses MediaPipe **Pose Landmarker** (33 body points) and **Hand Landmarker**
(21 points per hand, every finger joint), so it works for a full body, an upper body (only the visible points count,
sized by the shoulders), or a close-up of hands, where finger movement and how open the hands are drive the music.
The video is watched frame by frame (12 per second), so the result does not depend on the computer's speed.
A strip under the scenes shows the energy, the phrase levels and the big moves.

Code: `vision/trackers.js` (loading, about 23 MB the first time, cached afterwards; CPU/WebAssembly in the tab),
`vision/movement.js` (speed and lift from whatever is visible) and `core/dancer.js` (tempo, plan, shaping the arrangement),
both pure and unit-tested.

## Edit mode and Mood

* **Mood slider** (always visible): moves the mode one or two steps darker (Dorian → Aeolian → Phrygian) or brighter (Ionian → Lydian).
* **✎ Edit**: drag points to reshape the melody, click the photo to add a point (max 9), double-click to remove one,
  click a colour (or a chord card) to choose another chord for it.
  Guard-rails: only chords of the key are offered, diminished chords never are, ★ marks chords that share notes
  with both neighbours, a 0–100 harmony check and tips warn about repeated chords, abrupt changes, too few points or a flat line.
  “Reset to the photo” undoes everything.

## Slideshows and videos → MP4

Drop **several photos** (up to 30) or **one video** (first 3 minutes are used) on the upload zone.

* One style and one tempo for the whole film (chosen from the average fingerprint), but each photo or scene gets its own
  key and chords from its own palette; chords are voice-led from one scene to the next (`core/timeline.js`).
* Slideshows: every photo lasts whole bars (≈ “seconds per photo”), slow Ken Burns move, cross-fade on the downbeat.
* Videos: scene cuts are detected from colour histograms of frames sampled every 0.5 s (`video/scenes.js`);
  the music changes key on the nearest beat. Optionally the video's own sound is kept quietly underneath.
* Formats 16:9, 9:16 (Reels/TikTok/Shorts), 1:1 or original; 720p or 1080p; “Fit” (whole picture over a blurred copy) or “Fill” (crop).
* Export: the soundtrack is rendered offline at 48 kHz, frames are drawn on a canvas and encoded with **WebCodecs**,
  then packed into an MP4 by [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, bundled in `vendor/`). Free, no server.
  Codecs: H.264 + AAC where the browser has them (Chrome, Edge, Safari on desktop and phones), otherwise VP9/AV1 + Opus in MP4;
  browsers without WebCodecs fall back to recording the canvas in real time (MediaRecorder).
  Slideshows encode faster than real time; videos play through once (slower on weak computers, the video is slowed down automatically so no frame is skipped).
* Keep the tab visible while exporting. The “Credits” box gives a line to paste under a published video (CC BY 3.0 samples).

## Sound

* `assets/samples/` — 13 recorded instruments and 6 drum sets (7.4 MB), packed into one `.bin` file per instrument.
  Each style loads only what it uses (about 0.5–2 MB) on the first Play, and recordings are cached
  for the session, so switching styles is quick.
* `src/audio/instruments.js` — Tone.Sampler instruments built from those recordings; electric guitars
  run through an amp chain (drive, cabinet EQ) and are double-tracked left/right. Synthesizers are used
  only where the genre is synthetic: synthwave, house bass, 808, the ambient pad.
* `src/audio/mix.js` — calibrated mix table. Every style was rendered offline with the real Tone.js;
  each instrument group was measured on its own and trimmed to target levels, then the full mix was
  normalised. Result: all styles land within about 2 dB of each other with peaks below −0.7 dBFS.
  A soft clipper at the output prevents harsh digital clipping.

### Credits

Instrument recordings are used under CC BY 3.0:
Versilian Studios VSCO 2 (piano, contrabass, violin, flute, French horn, harp, xylophone),
Karoryfer Samples (electric guitar, electric bass, saxophone), University of Iowa Musical
Instrument Samples (acoustic guitar), Freesound users quartertone (classical guitar) and
flcellogrl (cello) — all via nbrosowsky/tonejs-instruments; OLPC Berklee Sound Library
(cymbals, brushes, shaker, clap). Drum kits: Chris Wilson's web-audio-samples via the
Tone.js audio repository. Audio engine: Tone.js (MIT), bundled in `vendor/`.

## Privacy

* The photo is read with `createImageBitmap(file)` and lives only in the tab's memory.
* The Content Security Policy allows scripts and network requests only to the site's own files
  (`script-src 'self'; connect-src 'self'`): the page can load its bundled recordings, but cannot
  send anything to another server.
* No localStorage/IndexedDB, no analytics.

## Camera mode (live)

**📷 Use camera** turns the webcam into an instrument (needs `localhost` or `https://`; the picture never leaves the tab).

* Every 250 ms the frame is analysed (colours and points in the worker; the Movement meter uses frame differencing in `vision/motion.js`).
* **Music follows: 🖼 The picture | 🕺 My moves.** The same choice is used for the live music and for what gets recorded.
  * *The picture*: colours and the striking points of the frame make the music; steady and calm.
  * *My moves*: MediaPipe body and hand tracking runs live in the tab (~10 times a second, same models as Follow the dancer;
    full body, upper body or only hands). The notes still come from the picture; `core/live-moves.js` (`LiveMoves`) turns
    the moves into a level every two bars, from the two bars just played: still → only chords, calm → chords + melody,
    groove → + bass and drums, peak → everything louder; arms up / open hands → melody an octave higher. Borders
    (body heights per second): still < 0.075, calm < 0.2, groove < 0.45, with 15% hysteresis; tuned on a fake camera
    fed with a dance clip and with a motionless person plus sensor noise (≈0.05). A level change reloads the same
    arrangement shaped by `applyMovementPlan` on the bar line, continuing from the same point of the loop (`loopOffset`).
* `core/live.js` (`LiveConductor`) decides once per bar, one beat before it starts; the engine loads the new part anchored on that bar,
  so changes always land on the downbeat:
  style and tempo are fixed when the music starts (↻ re-picks them); key and chords change only after the new harmony has been
  stable for two bars; the melody follows moved points on the next bar over the same chords.
* **📸 Take photo** sends the frame to the normal photo mode. **● Record video** records the camera together with the live music
  (MediaRecorder, up to 3 minutes); the clip can be saved as is, or opened in video mode to get a composed soundtrack and an MP4.

## License

Synesthesia is © 2026 **Victoria Lisitsyna** and is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE).

**Free for noncommercial use.** Anyone may read, run, copy, change and share the code, and use the app,
for personal projects, hobby, study, teaching, research, and for noncommercial organisations
(charities, schools, public bodies). That includes sharing the music and videos you make on social media.
Copies and changed versions must keep the [LICENSE](LICENSE) and the `Required Notice` lines in [NOTICE](NOTICE)
(“Synesthesia by Victoria Lisitsyna”).

**Commercial use needs a paid licence.** Using Synesthesia or its code in a company, a commercial product or
service, client work, advertising, or anything that is sold requires a separate commercial licence.
To get one, write to **[lisitsynavictoria@gmail.com](mailto:lisitsynavictoria@gmail.com)**.

Saved videos, music cards, WAV and MIDI files carry a small “Made with Synesthesia” line; please keep it.
The **Credits for your video description** box in the app gives a ready-made text to paste.

Versions published earlier under the Apache License 2.0 stay under that licence; this licence applies from this version on.
The third-party parts keep their own licences and are not covered by it: Tone.js and mp4-muxer (MIT),
the instrument recordings (CC BY 3.0). See [NOTICE](NOTICE) and Credits above.
