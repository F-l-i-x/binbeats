/* ============================================================
   BinBeats — Binaural Beats Generator
   Two oscillators, one per ear. The perceived "beat" equals the
   frequency difference between the two channels.
   ============================================================ */

'use strict';

// --- Constants --------------------------------------------------

const FREQ_MIN = 20;
const FREQ_MAX = 1000;
const GLIDE = 0.04;        // s – smooth frequency glide
const FADE = 0.08;         // s – fade in/out to avoid clicks
const TIMER_FADE = 15;     // s – gentle fade-out at timer end
const STORAGE_KEY = 'binbeats';

// EEG frequency bands (beat frequency in Hz)
const BANDS = [
  { key: 'delta', name: 'Delta', min: 0.5, max: 4,   color: 'var(--delta)', desc: 'Tiefschlaf, Regeneration' },
  { key: 'theta', name: 'Theta', min: 4,   max: 8,   color: 'var(--theta)', desc: 'Meditation, Tiefenentspannung' },
  { key: 'alpha', name: 'Alpha', min: 8,   max: 13,  color: 'var(--alpha)', desc: 'Entspannung, ruhige Wachheit' },
  { key: 'beta',  name: 'Beta',  min: 13,  max: 30,  color: 'var(--beta)',  desc: 'Konzentration, Fokus' },
  { key: 'gamma', name: 'Gamma', min: 30,  max: 100, color: 'var(--gamma)', desc: 'Hohe kognitive Aktivität' },
];

// Presets. Band presets light up by range; Schumann lights on an exact match.
const PRESETS = [
  { band: 'delta',    name: 'Delta',    beat: 2,    color: 'var(--delta)',    match: 'range' },
  { band: 'theta',    name: 'Theta',    beat: 6,    color: 'var(--theta)',    match: 'range' },
  { band: 'schumann', name: 'Schumann', beat: 7.83, color: 'var(--schumann)', match: 'exact' },
  { band: 'alpha',    name: 'Alpha',    beat: 10,   color: 'var(--alpha)',    match: 'range' },
  { band: 'beta',     name: 'Beta',     beat: 20,   color: 'var(--beta)',     match: 'range' },
  { band: 'gamma',    name: 'Gamma',    beat: 40,   color: 'var(--gamma)',    match: 'range' },
];

const TIMER_OPTIONS = [0, 10, 20, 30, 60]; // minutes (0 = off)
const CARRIER_DEFAULT = 200;               // carrier frequency (left channel)

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Audio engine ----------------------------------------------

class BinauralEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.vizSum = null;
    this.merger = null;
    this.oscL = null;
    this.oscR = null;
    this.gainL = null;
    this.gainR = null;
    this.noiseBuffer = null;
    this.noiseSource = null;
    this.noiseGain = null;
    this.playing = false;
    this.freqL = CARRIER_DEFAULT;
    this.freqR = CARRIER_DEFAULT + 10;
    this.volume = 0.4;
    this.noiseEnabled = false;
    this.noiseLevel = 0.3;
  }

  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);

    // Analyser for the visualization (mono sum, NOT routed to output).
    // 0.5 so the sum of two full-scale sines (±2) does not clip -> beat envelope stays visible.
    this.vizSum = this.ctx.createGain();
    this.vizSum.gain.value = 0.5;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.vizSum.connect(this.analyser);
  }

  _makeNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 3);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    return buf;
  }

  _startNoise() {
    if (!this.noiseEnabled || this.noiseSource) return;
    if (!this.noiseBuffer) this.noiseBuffer = this._makeNoiseBuffer();
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = this.noiseLevel;
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain).connect(this.master);
    this.noiseSource.start();
  }

  _stopNoise() {
    if (!this.noiseSource) return;
    try { this.noiseSource.stop(); } catch (e) {}
    try { this.noiseSource.disconnect(); } catch (e) {}
    try { this.noiseGain.disconnect(); } catch (e) {}
    this.noiseSource = null;
    this.noiseGain = null;
  }

  async start() {
    this._ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.playing) return;

    const now = this.ctx.currentTime;

    this.merger = this.ctx.createChannelMerger(2);

    this.oscL = this.ctx.createOscillator();
    this.oscR = this.ctx.createOscillator();
    this.oscL.type = 'sine';
    this.oscR.type = 'sine';
    this.oscL.frequency.setValueAtTime(this.freqL, now);
    this.oscR.frequency.setValueAtTime(this.freqR, now);

    this.gainL = this.ctx.createGain();
    this.gainR = this.ctx.createGain();

    this.oscL.connect(this.gainL).connect(this.merger, 0, 0);
    this.oscR.connect(this.gainR).connect(this.merger, 0, 1);
    this.merger.connect(this.master);

    // Mirror into the mono sum for the visualization
    this.gainL.connect(this.vizSum);
    this.gainR.connect(this.vizSum);

    this.oscL.start(now);
    this.oscR.start(now);

    this._startNoise();

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.volume, now + FADE);

    this.playing = true;
  }

  stop() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const oscL = this.oscL, oscR = this.oscR;

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + FADE);

    oscL.stop(now + FADE + 0.02);
    oscR.stop(now + FADE + 0.02);
    oscL.onended = () => { try { oscL.disconnect(); } catch (e) {} };
    oscR.onended = () => { try { oscR.disconnect(); } catch (e) {} };

    this._stopNoise();

    this.oscL = this.oscR = this.gainL = this.gainR = this.merger = null;
    this.playing = false;
  }

  // Gentle fade-out over 'sec' seconds (for the timer); stop happens separately.
  beginFade(sec) {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.2, sec);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0001, now + dur);
  }

  setFrequencies(fL, fR) {
    this.freqL = fL;
    this.freqR = fR;
    if (this.playing && this.ctx) {
      const t = this.ctx.currentTime;
      this.oscL.frequency.setTargetAtTime(fL, t, GLIDE);
      this.oscR.frequency.setTargetAtTime(fR, t, GLIDE);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.playing && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
  }

  setNoiseEnabled(on) {
    this.noiseEnabled = on;
    if (!this.playing) return;
    if (on) this._startNoise();
    else this._stopNoise();
  }

  setNoiseLevel(v) {
    this.noiseLevel = v;
    if (this.noiseGain && this.ctx) {
      this.noiseGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }
}

// --- Helpers ----------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

function bandForBeat(beat) {
  for (const b of BANDS) {
    if (beat >= b.min && beat < b.max) return b;
  }
  if (beat < BANDS[0].min) return null;         // below Delta
  return BANDS[BANDS.length - 1];               // above Gamma -> Gamma
}

// --- UI wiring --------------------------------------------------

const engine = new BinauralEngine();

const el = {
  beatCard: document.getElementById('beat-card'),
  beatHz: document.getElementById('beat-hz'),
  bandName: document.getElementById('band-name'),
  bandDesc: document.getElementById('band-desc'),
  bandDot: document.getElementById('band-dot'),
  viz: document.getElementById('viz'),
  freqL: document.getElementById('freq-left'),
  freqLNum: document.getElementById('freq-left-num'),
  freqR: document.getElementById('freq-right'),
  freqRNum: document.getElementById('freq-right-num'),
  volume: document.getElementById('volume'),
  play: document.getElementById('play'),
  playIcon: document.getElementById('play-icon'),
  playLabel: document.getElementById('play-label'),
  presets: document.getElementById('presets'),
  noiseToggle: document.getElementById('noise-toggle'),
  noiseLevel: document.getElementById('noise-level'),
  timerChips: document.getElementById('timer-chips'),
  timerCountdown: document.getElementById('timer-countdown'),
  saveBtn: document.getElementById('save-settings'),
  loadBtn: document.getElementById('load-settings'),
  loadFile: document.getElementById('load-file'),
};

// Beat coupling is always on: the distance (beat) between both frequencies is kept
// constant, so moving the carrier (left) frequency carries the right one along.
let lockedBeat = 10;

// --- Beat readout & preset highlighting -------------------------

function updateBeatDisplay() {
  const fL = parseFloat(el.freqL.value);
  const fR = parseFloat(el.freqR.value);
  const beat = Math.abs(fL - fR);

  el.beatHz.textContent = beat.toFixed(2);

  const band = bandForBeat(beat);
  if (band) {
    el.bandName.textContent = band.name;
    el.bandDesc.textContent = band.desc;
    document.documentElement.style.setProperty('--band-current', band.color);
    el.bandDot.style.background = band.color;
    el.bandDot.style.boxShadow = `0 0 12px ${band.color}`;
  } else {
    el.bandName.textContent = beat === 0 ? 'Kein Beat' : 'Sub-Delta';
    el.bandDesc.textContent = beat === 0 ? 'Beide Kanäle gleich' : 'Unter 0,5 Hz';
    document.documentElement.style.setProperty('--band-current', 'var(--text-dim)');
    el.bandDot.style.background = 'var(--text-dim)';
    el.bandDot.style.boxShadow = 'none';
  }

  highlightActivePreset(beat, band);
}

// Band presets stay lit while the beat is within their range; the Schumann
// preset lights only on an (approximately) exact match of its beat value.
// When an exact preset matches, suppress the band highlight so only one lights.
function highlightActivePreset(beat, band) {
  const buttons = [...el.presets.querySelectorAll('.preset')];
  const exactMatch = buttons.some(
    (b) => b.dataset.match === 'exact' && Math.abs(parseFloat(b.dataset.beat) - beat) < 0.05
  );
  buttons.forEach((btn) => {
    let active;
    if (btn.dataset.match === 'exact') {
      active = Math.abs(parseFloat(btn.dataset.beat) - beat) < 0.05;
    } else {
      active = !exactMatch && !!band && btn.dataset.band === band.key;
    }
    btn.classList.toggle('is-active', active);
  });
}

// --- Frequency controls + coupling ------------------------------

function setLeft(raw) {
  const v = clamp(parseFloat(raw) || FREQ_MIN, FREQ_MIN, FREQ_MAX);
  el.freqL.value = round2(v);
  el.freqLNum.value = round2(v);
  // Coupling is always on: the right frequency follows, keeping the beat constant.
  const fR = clamp(v + lockedBeat, FREQ_MIN, FREQ_MAX);
  el.freqR.value = round2(fR);
  el.freqRNum.value = round2(fR);
  applyFrequencies();
}

function setRight(raw) {
  const v = clamp(parseFloat(raw) || FREQ_MIN, FREQ_MIN, FREQ_MAX);
  el.freqR.value = round2(v);
  el.freqRNum.value = round2(v);
  // Setting the right frequency (re)defines the locked beat distance.
  lockedBeat = round2(Math.abs(v - (parseFloat(el.freqL.value) || 0)));
  applyFrequencies();
}

function applyFrequencies() {
  const fL = clamp(parseFloat(el.freqL.value) || FREQ_MIN, FREQ_MIN, FREQ_MAX);
  const fR = clamp(parseFloat(el.freqR.value) || FREQ_MIN, FREQ_MIN, FREQ_MAX);
  engine.setFrequencies(fL, fR);
  updateBeatDisplay();
  persist();
}

el.freqL.addEventListener('input', () => setLeft(el.freqL.value));
el.freqLNum.addEventListener('change', () => setLeft(el.freqLNum.value));
el.freqR.addEventListener('input', () => setRight(el.freqR.value));
el.freqRNum.addEventListener('change', () => setRight(el.freqRNum.value));

el.volume.addEventListener('input', () => {
  engine.setVolume(parseInt(el.volume.value, 10) / 100);
  persist();
});

// --- Noise ------------------------------------------------------

el.noiseToggle.addEventListener('change', () => {
  const on = el.noiseToggle.checked;
  el.noiseLevel.disabled = !on;
  engine.setNoiseEnabled(on);
  persist();
});
el.noiseLevel.addEventListener('input', () => {
  engine.setNoiseLevel(parseInt(el.noiseLevel.value, 10) / 100 * 0.6);
  persist();
});

// --- Timer ------------------------------------------------------

let timerMinutes = 0;
let timerEndTime = null;   // performance.now() timestamp
let timerFading = false;

function setDim(on) {
  document.body.classList.toggle('is-dimmed', on);
}

function renderTimerChips() {
  TIMER_OPTIONS.forEach((min) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.min = String(min);
    chip.textContent = min === 0 ? 'Aus' : `${min}′`;
    if (min === 0) chip.classList.add('is-active');
    chip.addEventListener('click', () => selectTimer(min));
    el.timerChips.appendChild(chip);
  });
}

function selectTimer(min) {
  timerMinutes = min;
  el.timerChips.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('is-active', parseInt(c.dataset.min, 10) === min);
  });
  // Dim the UI as soon as a timer is active.
  setDim(min > 0);
  if (min === 0) {
    timerEndTime = null;
    timerFading = false;
    el.timerCountdown.textContent = '';
  } else if (engine.playing) {
    startTimerCountdown();
  }
  persist();
}

function startTimerCountdown() {
  if (timerMinutes <= 0) return;
  timerEndTime = performance.now() + timerMinutes * 60 * 1000;
  timerFading = false;
}

function clearTimer() {
  timerEndTime = null;
  timerFading = false;
  el.timerCountdown.textContent = '';
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function tickTimer() {
  if (!timerEndTime || !engine.playing) return;
  const remaining = (timerEndTime - performance.now()) / 1000;
  el.timerCountdown.textContent = fmtTime(remaining);

  if (!timerFading && remaining <= TIMER_FADE) {
    engine.beginFade(remaining);
    timerFading = true;
  }
  if (remaining <= 0) {
    stopPlayback();
  }
}

// --- Screen Wake Lock -------------------------------------------
// Keeps the display awake while playing so the session is not
// interrupted by auto-lock (Safari iOS >= 16.4, Chrome, Edge).
// Note: true background audio with a LOCKED screen is not possible
// on iOS this way — that requires a native app (see BUILD-NATIVE.md).

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    wakeLock = null; // e.g. denied by the system on low battery
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch (e) {}
  wakeLock = null;
}

// --- Play / Stop ------------------------------------------------

function stopPlayback() {
  engine.stop();
  setPlayUI(false);
  clearTimer();
  releaseWakeLock();
}

el.play.addEventListener('click', async () => {
  if (engine.playing) {
    stopPlayback();
  } else {
    engine.setVolume(parseInt(el.volume.value, 10) / 100);
    engine.setNoiseLevel(parseInt(el.noiseLevel.value, 10) / 100 * 0.6);
    engine.setNoiseEnabled(el.noiseToggle.checked);
    engine.setFrequencies(parseFloat(el.freqL.value), parseFloat(el.freqR.value));
    await engine.start();
    setPlayUI(true);
    startTimerCountdown();
    requestWakeLock();
  }
});

function setPlayUI(playing) {
  el.play.classList.toggle('is-playing', playing);
  el.play.setAttribute('aria-pressed', String(playing));
  el.playIcon.textContent = playing ? '■' : '▶';
  el.playLabel.textContent = playing ? 'Stop' : 'Start';
}

// --- Presets ----------------------------------------------------

function renderPresets() {
  PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.type = 'button';
    btn.style.setProperty('--pc', p.color);
    btn.dataset.beat = String(p.beat);
    btn.dataset.band = p.band;
    btn.dataset.match = p.match;
    btn.innerHTML = `
      <span class="preset__dot"></span>
      <span class="preset__name">${p.name}</span>
      <span class="preset__hz">${p.beat} Hz</span>
    `;
    btn.addEventListener('click', () => applyPreset(p.beat));
    el.presets.appendChild(btn);
  });
}

function applyPreset(beat) {
  let carrier = parseFloat(el.freqL.value);
  if (!isFinite(carrier) || carrier < FREQ_MIN) carrier = CARRIER_DEFAULT;
  if (carrier + beat > FREQ_MAX) carrier = FREQ_MAX - beat;
  el.freqL.value = round2(carrier);
  el.freqLNum.value = round2(carrier);
  el.freqR.value = round2(carrier + beat);
  el.freqRNum.value = round2(carrier + beat);
  lockedBeat = round2(beat);     // picking a preset (re)locks the beat distance
  applyFrequencies();
}

// --- Save / Load settings ---------------------------------------

function gatherSettings() {
  return {
    v: 1,
    freqL: round2(parseFloat(el.freqL.value)),
    freqR: round2(parseFloat(el.freqR.value)),
    volume: parseInt(el.volume.value, 10),
    noiseEnabled: el.noiseToggle.checked,
    noiseLevel: parseInt(el.noiseLevel.value, 10),
    timer: timerMinutes,
    lockedBeat: round2(lockedBeat),
  };
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gatherSettings())); } catch (e) {}
}

function applySettings(s) {
  if (!s || typeof s !== 'object') return;
  const num = (v, def) => (typeof v === 'number' && isFinite(v) ? v : def);

  const fL = clamp(num(s.freqL, CARRIER_DEFAULT), FREQ_MIN, FREQ_MAX);
  const fR = clamp(num(s.freqR, CARRIER_DEFAULT + 10), FREQ_MIN, FREQ_MAX);
  el.freqL.value = round2(fL); el.freqLNum.value = round2(fL);
  el.freqR.value = round2(fR); el.freqRNum.value = round2(fR);

  const vol = clamp(num(s.volume, 40), 0, 100);
  el.volume.value = vol;
  engine.setVolume(vol / 100);

  const nlvl = clamp(num(s.noiseLevel, 30), 0, 100);
  const non = !!s.noiseEnabled;
  el.noiseLevel.value = nlvl;
  el.noiseToggle.checked = non;
  el.noiseLevel.disabled = !non;
  engine.setNoiseLevel(nlvl / 100 * 0.6);
  engine.setNoiseEnabled(non);

  lockedBeat = round2(num(s.lockedBeat, Math.abs(fR - fL)));

  selectTimer(TIMER_OPTIONS.indexOf(s.timer) >= 0 ? s.timer : 0);

  applyFrequencies();
}

function downloadSettings() {
  const data = JSON.stringify(gatherSettings(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'binbeats-settings.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

el.saveBtn.addEventListener('click', downloadSettings);
el.loadBtn.addEventListener('click', () => el.loadFile.click());
el.loadFile.addEventListener('change', () => {
  const file = el.loadFile.files && el.loadFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applySettings(JSON.parse(reader.result));
    } catch (e) {
      alert('Konnte die Datei nicht lesen – ist es eine gültige BinBeats-Einstellungsdatei?');
    }
    el.loadFile.value = '';
  };
  reader.readAsText(file);
});

// --- Visualization + pulse (single rAF loop) --------------------

let vizCtx = null;
let dpr = 1;
let waveData = null;
let env = 0; // smoothed envelope -> drives the pulse

function setupViz() {
  vizCtx = el.viz.getContext('2d');
  resizeViz();
  window.addEventListener('resize', resizeViz);
}

function resizeViz() {
  dpr = window.devicePixelRatio || 1;
  const rect = el.viz.getBoundingClientRect();
  el.viz.width = Math.max(1, Math.floor(rect.width * dpr));
  el.viz.height = Math.max(1, Math.floor(rect.height * dpr));
}

function cssColor(varRef) {
  // "var(--delta)" -> actual color value
  const name = varRef.replace('var(', '').replace(')', '').trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#6ee7ff';
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!vizCtx) return;

  const w = el.viz.width;
  const h = el.viz.height;
  vizCtx.clearRect(0, 0, w, h);

  const color = cssColor(getComputedStyle(document.documentElement).getPropertyValue('--band-current') || '--alpha');

  let instPeak = 0;

  if (engine.playing && engine.analyser) {
    if (!waveData || waveData.length !== engine.analyser.fftSize) {
      waveData = new Uint8Array(engine.analyser.fftSize);
    }
    engine.analyser.getByteTimeDomainData(waveData);

    vizCtx.lineWidth = Math.max(1, 2 * dpr);
    vizCtx.strokeStyle = color;
    vizCtx.globalAlpha = 0.9;
    vizCtx.beginPath();
    const step = waveData.length / w;
    for (let x = 0; x < w; x++) {
      const v = waveData[Math.floor(x * step)] / 128 - 1; // -1..1
      const y = h / 2 + v * (h / 2) * 0.9;
      if (x === 0) vizCtx.moveTo(x, y); else vizCtx.lineTo(x, y);
      const a = Math.abs(v);
      if (a > instPeak) instPeak = a;
    }
    vizCtx.stroke();
    vizCtx.globalAlpha = 1;
  } else {
    // Idle line
    vizCtx.lineWidth = Math.max(1, 2 * dpr);
    vizCtx.strokeStyle = 'rgba(154,164,196,0.35)';
    vizCtx.beginPath();
    vizCtx.moveTo(0, h / 2);
    vizCtx.lineTo(w, h / 2);
    vizCtx.stroke();
  }

  // Smooth the envelope -> gentle pulse (fast beats get smoothed = no strobe)
  env += (instPeak - env) * 0.15;
  if (!reducedMotion) {
    document.documentElement.style.setProperty('--pulse', env.toFixed(3));
  }

  tickTimer();
}

// --- Init -------------------------------------------------------

renderPresets();
renderTimerChips();

let restored = false;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { applySettings(JSON.parse(raw)); restored = true; }
} catch (e) {}

if (!restored) {
  lockedBeat = round2(Math.abs(parseFloat(el.freqR.value) - parseFloat(el.freqL.value)));
}

updateBeatDisplay();
setupViz();
renderLoop();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.playing) {
    // The AudioContext may have been suspended while hidden
    if (engine.ctx && engine.ctx.state === 'suspended') {
      engine.ctx.resume().catch(() => {});
    }
    // The wake lock is auto-released when the page is hidden -> re-request it
    if (!wakeLock) requestWakeLock();
  }
});
