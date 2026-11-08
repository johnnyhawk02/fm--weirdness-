# FM/STEP: one FM voice, seven free-running operator sequencers

Browser prototype (plain JS, Web Audio, AudioWorklet). All DSP lives in `dsp/` as plain ES modules
with no DOM use, ready to port to C++/JUCE.

## Run
    node tools/serve.mjs 8080      # then open http://localhost:8080/  (?fresh ignores the saved patch)
    npm test                        # Node tests (clock ratios/sync/drift, 4-bar WAV, seed determinism, mutate)
    node tools/render.mjs 4 out/render.wav [seed]
    node tools/screenshots.mjs      # 1440x900 and 1280x800 with the voice running

## Layout
- `dsp/engine.js`: master saw, slave saws (sync / free / drift / scatter / jumps), note trigger, mods, crossfades
- `dsp/voice.js`: 4-op phase-modulation voice, 8 algorithms, D feedback, anti-alias index scaling
- `dsp/sequencer.js`: step state machine (prob, ratchet, skip, repeat, locks, jitter, direction) and mutate
- `dsp/shapes.js`, `dsp/random.js` (seeded randomisers, fill styles, morph), `dsp/params.js`, `dsp/rng.js`
- `worklet/processor.js`: AudioWorklet host, posts state about 60 times a second over the MessagePort
- `ui/`: LCD interface

## Presets and randomiser
- RANDOMISE (top bar, or the R key) randomises everything, ignoring section locks: voice, operators, steps, locks,
  clocks, jump sets, gate row and modulators, and gives the patch a new generated name. RND ALL respects the locks.
- On phones (under 760px wide, e.g. Pixel 9a portrait) everything fits one screen with no scrolling: tabs A B C D
  (one operator each), VOICE, LFO and RND. The top bar (start, randomise, name, master saw) is always visible.
- MAIN page (opens by default; MAIN button or M key on desktop, MAIN tab on the phone): long-throw pitch faders, and under each one that operator's level, self-feedback and its own pitch slew (slew × scales them all), two cross-feedback paths (any operator into any other, carriers included, with amount) and the algorithm.
- Feedback: every operator has self-feedback (fb knob; G's is the old global feedback). LFO targets fb1, fb2 and A.fb..G.fb. RANDOMISE sets a few ops' feedback and the paths.
- ALTER (or the A key) nudges every continuous setting a tiny amount (levels, decays, pans, LFOs, rates, step depths and chances, a few cents of fine tune) and leaves the algorithm, ratios and patterns alone. Undo works.
- Seven operators, A to G, with 32 seven-operator algorithms (◂ ▸ or ALL to pick); feedback is on G.
- Stereo: every carrier is a left/right pair. Each operator's pan sets which side of the pair it modulates
  (a modulator panned left bends only the left carrier), and for carriers it is their placement. On top, the
  stereo mode places the carriers of the current algorithm: spread, alt (hard L/R), mirror (pairs), random
  (fixed per seed and algorithm), rotate (carriers circle the field at the rotate rate) or mono, scaled by
  width. LFOs can target width and every operator's pan (A.pan..G.pan). On desktop the operator rows
  scroll inside their area (four visible at once); on a phone each operator has its own tab.
- Presets on a phone: the name, previous/next and SAVE sit at the top of every tab. SAVE is filled when there are
  unsaved changes and reads SAVED when stored; a banner confirms each save and load. The PRESETS tab lists all
  presets (tap to load) with save as new, delete (tap twice), export and import.
- PITCH page (PITCH button on desktop, PITCH tab on phones): seven long-throw faders for operator pitch
  (ratio 0.5-16, or Hz for fixed operators). Pitch changes glide with the slew time; the orange line shows the
  pitch the engine is playing right now. Snap quantises ratios to harmonic steps; multi-touch works.
- Clock per sequencer: `link` (follows the master saw x mult, with sync/reset) or `free` (default: runs on its
  own rate in Hz, unlinked from the master and from the other sequencers). A free sequencer retriggers its own
  operator's envelope on every fired step, so each one plays as its own part.
- Sequencer speed: master 10-999 bpm or 0.01-50 Hz, with 1-16 beats per cycle; each operator's rate
  (multiplier) runs from 1/64 to 64 (presets 1/16 to 64, or the rate knob for anything in between).
- Amp source per operator (the "amp" box under the operator letter): env = note envelope, hold = steady level,
  lfo1-4 = level follows that LFO. Operator A defaults to hold, so the carrier sounds steadily and you hear the
  modulators' sequencers change the timbre.
- LFOs: each of the four modulators is a sine, triangle, saw, square or smooth random walk. Targets include
  `clock` (master rate) and `A.rate`..`D.rate` (each sequencer's saw rate, +-3 octaves at depth 1).
  Synced saws stay locked to the master while their rate is modulated.
- Preset names are spliced from small chunks of words: ancient Greece, Chinese food, mountains,
  English village names and astronomy (`ui/names.js`).
- The name field in the top bar is editable; ctrl-s or SAVE stores the preset (same name overwrites).
  The preset row has previous/next, new name, delete, export and import (JSON). Presets are kept in the
  browser's local storage, so use export to back them up or move them. 12 factory presets ship on first run.

## Behaviour notes
- Level destination: gain = (1 - amt) + amt x g, where g = depth x shape for positive steps,
  1 - |depth| x shape for negative steps (ducking), and 0 for empty or unfired steps.
- Ratio destination: up to +-2 octaves, pitch destination: up to +-24 semitones (range knob).
- Synced saws are computed from the master position, so wraps land on the master wrap sample exactly.
  "reset" = reset every N master cycles. Every wrap reports its sub-sample offset.
- One seed drives every runtime random stream; the same patch and seed render bit-identically at any block size.
- Controls: shift-click any knob/selector = rnd (by rnd amount), dbl-click = default, alt-drag = fine.
  Steps: drag = lane value, right-click/long-press = shape, shift-click = skip, alt-click = repeat, dbl-click = clear.
  Snapshots: click empty slot = store, click full = recall, shift = overwrite, right = clear.
