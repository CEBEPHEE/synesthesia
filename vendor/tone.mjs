/**
 * ES-module wrapper around the bundled Tone.js 15.1.22 UMD build (MIT licence).
 * The UMD file attaches itself to `self.Tone`; we re-export it so the rest of
 * the app can `import Tone from '../../vendor/tone.mjs'` with no CDN and no build step.
 */
import './Tone.js';

export default self.Tone;
