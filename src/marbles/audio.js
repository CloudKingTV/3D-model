/**
 * Sound for the marble game, all synthesised with Web Audio — no files.
 *
 * Effects are tiny patches (an oscillator or filtered noise through an
 * envelope). The rolling sound is a loop of filtered noise whose level and
 * pitch follow your marble's speed. The music is a short, upbeat pattern —
 * bass, chords, a lead and hats — scheduled a little ahead of the clock.
 *
 * Browsers only allow audio after a tap, so `unlock()` is called from the
 * first pointer event; before that every call is a silent no-op.
 */

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);

export function createAudio({ sound = true, music = true } = {}) {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noise = null;
  let roll = null;
  let soundOn = sound;
  let musicOn = music;
  let musicTimer = 0;
  let nextBeat = 0;
  let beat = 0;
  let track = 'menu';
  const lastPlayed = new Map();

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = soundOn ? 1 : 0;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? 0.32 : 0;
    musicBus.connect(master);

    // One second of white noise, reused by every noisy sound.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // The rolling loop: band-passed noise, silent until the marble moves.
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 300;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(band).connect(gain).connect(sfxBus);
    source.start();
    roll = { band, gain };

    nextBeat = ctx.currentTime + 0.1;
    musicTimer = setInterval(schedule, 60);
  }

  /* -------------------------------------------------------------- voices */

  function tone(freq, { at = 0, dur = 0.15, type = 'sine', vol = 0.3, slide = null, attack = 0.005, bus = sfxBus } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function hiss({ at = 0, dur = 0.2, vol = 0.3, from = 800, to = 800, type = 'bandpass', q = 1, bus = sfxBus } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Don't stack the same sound many times in one instant. */
  function throttle(name, gap) {
    if (!ctx) return false;
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(name) ?? -1) < gap) return false;
    lastPlayed.set(name, now);
    return true;
  }

  const SFX = {
    tap: () => tone(880, { dur: 0.06, type: 'triangle', vol: 0.18, slide: 1320 }),
    back: () => tone(660, { dur: 0.07, type: 'triangle', vol: 0.15, slide: 440 }),
    tick: () => tone(1200, { dur: 0.03, type: 'square', vol: 0.05 }),
    count: () => tone(NOTE(69), { dur: 0.22, type: 'square', vol: 0.16 }),
    go: () => { tone(NOTE(81), { dur: 0.45, type: 'square', vol: 0.18 }); tone(NOTE(76), { dur: 0.45, type: 'triangle', vol: 0.15 }); },
    gate: () => hiss({ dur: 0.35, vol: 0.25, from: 400, to: 120, type: 'lowpass' }),
    coin: () => { tone(NOTE(88), { dur: 0.08, type: 'square', vol: 0.09 }); tone(NOTE(93), { at: 0.06, dur: 0.18, type: 'square', vol: 0.09 }); },
    box: () => [0, 4, 7, 12].forEach((n, i) => tone(NOTE(72 + n), { at: i * 0.05, dur: 0.12, type: 'triangle', vol: 0.16 })),
    bumper: () => tone(180, { dur: 0.25, type: 'sine', vol: 0.4, slide: 520 }),
    boost: () => hiss({ dur: 0.45, vol: 0.28, from: 300, to: 3000, q: 2 }),
    clack: (speed = 5) => tone(2400 + Math.random() * 800, { dur: 0.04, type: 'triangle', vol: Math.min(0.25, 0.05 + speed * 0.02) }),
    turbo: () => { hiss({ dur: 0.9, vol: 0.35, from: 200, to: 4000, q: 3 }); tone(110, { dur: 0.8, type: 'sawtooth', vol: 0.12, slide: 440 }); },
    ghost: () => [0, 3, 7, 10].forEach((n, i) => tone(NOTE(79 - n), { at: i * 0.07, dur: 0.3, type: 'sine', vol: 0.12 })),
    shock: () => { tone(90, { dur: 0.5, type: 'sine', vol: 0.5, slide: 40 }); hiss({ dur: 0.4, vol: 0.3, from: 2000, to: 200, type: 'lowpass' }); },
    hop: () => tone(300, { dur: 0.22, type: 'square', vol: 0.12, slide: 900 }),
    hit: () => tone(220, { dur: 0.2, type: 'sawtooth', vol: 0.15, slide: 90 }),
    fire: () => hiss({ dur: 1.6, vol: 0.4, from: 900, to: 150, type: 'lowpass' }),
    finish: () => [0, 4, 7].forEach((n, i) => tone(NOTE(76 + n), { at: i * 0.08, dur: 0.25, type: 'square', vol: 0.12 })),
    win: () => {
      [0, 4, 7, 12, 7, 12, 16].forEach((n, i) => tone(NOTE(72 + n), { at: i * 0.11, dur: 0.3, type: 'square', vol: 0.13 }));
      tone(NOTE(48), { at: 0.66, dur: 0.9, type: 'triangle', vol: 0.2 });
    },
    lose: () => [0, -3, -6, -9].forEach((n, i) => tone(NOTE(67 + n), { at: i * 0.14, dur: 0.3, type: 'triangle', vol: 0.12 })),
    coinsCount: () => tone(NOTE(96), { dur: 0.04, type: 'square', vol: 0.05 }),
    levelUp: () => [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(NOTE(67 + n), { at: i * 0.07, dur: 0.35, type: 'triangle', vol: 0.15 })),
    reveal: () => { hiss({ dur: 0.6, vol: 0.25, from: 500, to: 5000, q: 1 }); [0, 7, 12, 19].forEach((n, i) => tone(NOTE(72 + n), { at: 0.5 + i * 0.06, dur: 0.4, type: 'triangle', vol: 0.14 })); },
    shake: () => tone(140 + Math.random() * 60, { dur: 0.06, type: 'square', vol: 0.08 }),
    buy: () => { tone(NOTE(84), { dur: 0.08, type: 'square', vol: 0.1 }); tone(NOTE(91), { at: 0.07, dur: 0.2, type: 'square', vol: 0.1 }); },
    error: () => tone(160, { dur: 0.18, type: 'square', vol: 0.12, slide: 120 }),
  };

  /* --------------------------------------------------------------- music */

  // Four bars in C major-ish; the race track is quicker and busier.
  const CHORDS = [[48, 55, 64, 67], [45, 52, 60, 64], [41, 48, 57, 65], [43, 50, 59, 67]];
  const LEAD = [76, null, 79, 76, 74, null, 72, 74, 76, null, 72, null, 69, 71, 72, null];

  function schedule() {
    if (!ctx || !musicOn) {
      if (ctx) nextBeat = Math.max(nextBeat, ctx.currentTime + 0.05);
      return;
    }
    const bpm = track === 'race' ? 132 : 108;
    const step = 60 / bpm / 2; // eighth notes
    while (nextBeat < ctx.currentTime + 0.25) {
      const at = nextBeat - ctx.currentTime;
      const bar = Math.floor(beat / 8) % 4;
      const chord = CHORDS[bar];
      const inBar = beat % 8;
      // Bass on the beat, octave bounce on the off-beat.
      tone(NOTE(chord[0] - 12 + (inBar % 2 ? 12 : 0)), { at, dur: step * 0.9, type: 'triangle', vol: 0.22, bus: musicBus });
      if (inBar === 0 || inBar === 4) {
        for (const n of chord.slice(1)) tone(NOTE(n), { at, dur: step * 3.5, type: 'sine', vol: 0.05, attack: 0.02, bus: musicBus });
      }
      if (track === 'race' || inBar % 2 === 1) hiss({ at, dur: 0.04, vol: track === 'race' ? 0.05 : 0.03, from: 8000, to: 9000, type: 'highpass', bus: musicBus });
      if (track === 'race' && inBar % 4 === 0) tone(60, { at, dur: 0.15, type: 'sine', vol: 0.35, slide: 40, bus: musicBus });
      const lead = LEAD[(beat + (track === 'race' ? 8 : 0)) % 16];
      if (lead && (track === 'race' || beat % 32 >= 16)) tone(NOTE(lead), { at, dur: step * 1.6, type: 'square', vol: 0.035, bus: musicBus });
      nextBeat += step;
      beat += 1;
    }
  }

  return {
    unlock,
    play(name, arg) {
      if (!ctx || !soundOn) return;
      const gap = name === 'clack' ? 0.05 : name === 'coin' ? 0.03 : name === 'tick' || name === 'coinsCount' ? 0.03 : 0.02;
      if (!throttle(name, gap)) return;
      SFX[name]?.(arg);
    },
    /** Follow your marble's speed with the rolling sound (0 = silent). */
    setRoll(speed, touching) {
      if (!roll || !ctx) return;
      const level = soundOn && touching ? Math.min(0.22, speed * 0.008) : 0;
      roll.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
      roll.band.frequency.setTargetAtTime(160 + speed * 28, ctx.currentTime, 0.05);
    },
    setTrack(name) {
      track = name;
    },
    setSound(on) {
      soundOn = on;
      if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02);
    },
    setMusic(on) {
      musicOn = on;
      if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.32 : 0, ctx.currentTime, 0.05);
    },
    /** Hush everything while the page is hidden. */
    suspend(hidden) {
      if (!ctx) return;
      if (hidden) ctx.suspend();
      else ctx.resume();
    },
    dispose() {
      clearInterval(musicTimer);
      ctx?.close();
      ctx = null;
    },
  };
}

/** A short buzz where the phone supports it (Android; iOS ignores it). */
export function createHaptics(enabled = true) {
  let on = enabled;
  return {
    set(value) {
      on = value;
    },
    buzz(pattern = 10) {
      if (!on) return;
      try {
        navigator.vibrate?.(pattern);
      } catch {
        /* not supported */
      }
    },
  };
}
