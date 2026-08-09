/**
 * Sound engine — retro pixel sounds synthesized with Web Audio API.
 *
 * NO external audio files. Every sound is generated procedurally from
 * oscillators + envelopes, so it loads instantly and adds zero weight to
 * the bundle.
 *
 * Sound design philosophy: short, punchy, 8-bit/16-bit era.
 *   - Blips: square wave, 50-100ms, quick decay
 *   - Tones: sine/triangle, longer sustain
 *   - Glitch: noise + detuned square, chaotic
 *   - UI clicks: very short square blip
 *
 * All sounds respect a global mute flag stored in localStorage so the user
 * can toggle audio off. Default: ON (but only after a user gesture, per
 * browser autoplay policy — we lazy-init the AudioContext on first call).
 */

let _ctx: AudioContext | null = null;

/**
 * Three independent audio channels — each can be muted separately.
 *  - sfx:   UI clicks, blips, stress rises, achievement fanfares
 *  - music: ambient background music (detective-music.mp3)
 *  - voice: TTS speech synthesis for suspect replies
 *
 * `isMuted()` is kept as a backward-compat alias meaning "sfx muted".
 */
let _sfxMuted = false;
let _musicMuted = false;
let _voiceMuted = false;

// Read initial mute states from localStorage (client-side only).
if (typeof window !== "undefined") {
  try {
    // Backward-compat: if old "sospechosos:muted" was set, treat as sfx+music mute.
    const legacy = localStorage.getItem("sospechosos:muted");
    if (legacy !== null) {
      _sfxMuted = legacy === "1";
      _musicMuted = legacy === "1";
      _voiceMuted = legacy === "1";
      localStorage.removeItem("sospechosos:muted");
      localStorage.setItem("sospechosos:sfx_muted", _sfxMuted ? "1" : "0");
      localStorage.setItem("sospechosos:music_muted", _musicMuted ? "1" : "0");
      localStorage.setItem("sospechosos:voice_muted", _voiceMuted ? "1" : "0");
    } else {
      _sfxMuted = localStorage.getItem("sospechosos:sfx_muted") === "1";
      _musicMuted = localStorage.getItem("sospechosos:music_muted") === "1";
      _voiceMuted = localStorage.getItem("sospechosos:voice_muted") === "1";
    }
  } catch {
    // ignore
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_sfxMuted) return null;
  if (!_ctx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      _ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy).
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

/* ── Per-channel mute state ── */

export function isSfxMuted(): boolean { return _sfxMuted; }
export function isMusicMuted(): boolean { return _musicMuted; }
export function isVoiceMuted(): boolean { return _voiceMuted; }

export function setSfxMuted(m: boolean): void {
  _sfxMuted = m;
  if (typeof window !== "undefined") {
    try { localStorage.setItem("sospechosos:sfx_muted", m ? "1" : "0"); } catch { /* ignore */ }
  }
  if (!m) { const ctx = getCtx(); if (ctx) void ctx.resume(); }
}

export function setMusicMuted(m: boolean): void {
  _musicMuted = m;
  if (typeof window !== "undefined") {
    try { localStorage.setItem("sospechosos:music_muted", m ? "1" : "0"); } catch { /* ignore */ }
  }
}

export function setVoiceMuted(m: boolean): void {
  _voiceMuted = m;
  if (typeof window !== "undefined") {
    try { localStorage.setItem("sospechosos:voice_muted", m ? "1" : "0"); } catch { /* ignore */ }
  }
}

export function toggleSfxMuted(): boolean { setSfxMuted(!_sfxMuted); return _sfxMuted; }
export function toggleMusicMuted(): boolean { setMusicMuted(!_musicMuted); return _musicMuted; }
export function toggleVoiceMuted(): boolean { setVoiceMuted(!_voiceMuted); return _voiceMuted; }

/* ── Backward-compat aliases (treat as SFX) ── */

export function isMuted(): boolean { return _sfxMuted; }

export function setMuted(muted: boolean): void {
  setSfxMuted(muted);
}

export function toggleMuted(): boolean {
  return toggleSfxMuted();
}

/* ─────────────────────────  Primitive helpers  ───────────────────────── */

interface ToneOpts {
  freq: number;
  duration: number; // seconds
  type?: OscillatorType; // 'square' | 'sine' | 'triangle' | 'sawtooth'
  volume?: number; // 0..1
  attack?: number; // seconds
  decay?: number; // seconds
  detune?: number; // cents
  /** If set, slide the frequency to this value over the duration. */
  slideTo?: number;
}

function playTone(opts: ToneOpts): void {
  const ctx = getCtx();
  if (!ctx) return;

  const {
    freq,
    duration,
    type = "square",
    volume = 0.15,
    attack = 0.005,
    decay = duration,
    detune = 0,
    slideTo,
  } = opts;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  osc.detune.setValueAtTime(detune, now);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, slideTo),
      now + duration
    );
  }

  // ADSR-ish envelope — quick attack, exponential decay.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.05);
}

function playNoise(opts: {
  duration: number;
  volume?: number;
  filterFreq?: number;
}): void {
  const ctx = getCtx();
  if (!ctx) return;

  const { duration, volume = 0.1, filterFreq = 1000 } = opts;
  const now = ctx.currentTime;

  // White noise buffer
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(filterFreq, now);
  filter.Q.setValueAtTime(1, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration);
}

/* ─────────────────────────  Game sounds  ───────────────────────── */

/** Short blip when the detective sends a question. Bright, ascending. */
export function soundSendQuestion(): void {
  playTone({ freq: 440, duration: 0.05, type: "square", volume: 0.12 });
  setTimeout(
    () => playTone({ freq: 660, duration: 0.06, type: "square", volume: 0.12 }),
    50
  );
}

/** Low tone when stress rises significantly. Darker = more stress. */
export function soundStressRise(stressLevel: number): void {
  // Higher stress = lower pitch (more ominous).
  const freq = Math.max(80, 220 - stressLevel * 1.2);
  playTone({
    freq,
    duration: 0.4,
    type: "sine",
    volume: 0.18,
    attack: 0.02,
    decay: 0.38,
  });
  // Add a subtle dissonant overtone at very high stress.
  if (stressLevel > 70) {
    setTimeout(
      () =>
        playTone({
          freq: freq * 1.5,
          duration: 0.3,
          type: "sawtooth",
          volume: 0.08,
        }),
      80
    );
  }
}

/** Glitchy noise burst when the AI is caught lying / flagged. */
export function soundLieDetected(): void {
  // Chaotic detuned squares + noise = digital glitch.
  playNoise({ duration: 0.15, volume: 0.15, filterFreq: 2000 });
  playTone({
    freq: 220,
    duration: 0.1,
    type: "square",
    volume: 0.12,
    detune: 50,
  });
  setTimeout(
    () =>
      playTone({
        freq: 180,
        duration: 0.08,
        type: "square",
        volume: 0.1,
        detune: -40,
      }),
    60
  );
}

/** Soft chime when evidence is unlocked. */
export function soundEvidenceUnlock(): void {
  playTone({ freq: 523, duration: 0.08, type: "triangle", volume: 0.12 });
  setTimeout(
    () =>
      playTone({ freq: 659, duration: 0.08, type: "triangle", volume: 0.12 }),
    80
  );
  setTimeout(
    () =>
      playTone({ freq: 784, duration: 0.12, type: "triangle", volume: 0.12 }),
    160
  );
}

/** Achievement unlocked — little fanfare. */
export function soundAchievement(): void {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    setTimeout(
      () => playTone({ freq: f, duration: 0.1, type: "square", volume: 0.14 }),
      i * 70
    );
  });
}

/** UI click — very short, for buttons / tabs / panel switches. */
export function soundClick(): void {
  playTone({ freq: 800, duration: 0.025, type: "square", volume: 0.06 });
}

/** UI hover — softer, even shorter. */
export function soundHover(): void {
  playTone({ freq: 1200, duration: 0.015, type: "square", volume: 0.03 });
}

/** Tab switch — slightly lower than click. */
export function soundTab(): void {
  playTone({ freq: 600, duration: 0.03, type: "square", volume: 0.07 });
  setTimeout(
    () => playTone({ freq: 900, duration: 0.03, type: "square", volume: 0.07 }),
    30
  );
}

/** Error buzz — low square, descending. */
export function soundError(): void {
  playTone({
    freq: 200,
    duration: 0.15,
    type: "square",
    volume: 0.12,
    slideTo: 100,
  });
}

/** Case generated successfully — pleasant arpeggio. */
export function soundCaseReady(): void {
  const notes = [392, 523, 659, 784];
  notes.forEach((f, i) => {
    setTimeout(
      () => playTone({ freq: f, duration: 0.12, type: "triangle", volume: 0.13 }),
      i * 80
    );
  });
}

/** Verdict revealed — dramatic low chord. */
export function soundVerdict(): void {
  playTone({ freq: 130, duration: 0.6, type: "sawtooth", volume: 0.15 });
  setTimeout(
    () => playTone({ freq: 165, duration: 0.6, type: "sawtooth", volume: 0.12 }),
    100
  );
  setTimeout(
    () => playTone({ freq: 196, duration: 0.8, type: "sawtooth", volume: 0.1 }),
    200
  );
}

/** Typewriter tick — for the AI response typewriter effect. */
export function soundTypeTick(): void {
  playTone({ freq: 1500 + Math.random() * 400, duration: 0.01, type: "square", volume: 0.025 });
}

/** Connect to room / lobby join. */
export function soundConnect(): void {
  playTone({ freq: 330, duration: 0.06, type: "triangle", volume: 0.1 });
  setTimeout(
    () => playTone({ freq: 440, duration: 0.08, type: "triangle", volume: 0.1 }),
    60
  );
}

/** Timer ticking — last 60 seconds. */
export function soundTimerTick(): void {
  playTone({ freq: 1000, duration: 0.02, type: "square", volume: 0.05 });
}

/** Phase transition whoosh. */
export function soundWhoosh(): void {
  playNoise({ duration: 0.3, volume: 0.08, filterFreq: 500 });
  playTone({
    freq: 200,
    duration: 0.3,
    type: "sine",
    volume: 0.06,
    slideTo: 600,
  });
}
