// WebAudio port of the original sound module (Engine/DukZeven/Code/dks.cpp, FMOD based).
//
// Semantics kept from the original:
//  - volumes are 0..255 (FSOUND_SetVolume scale)
//  - 3D sounds use FMOD's inverse rolloff: full volume up to `range`, then volume = range / distance
//  - the listener sits at the camera position (Client.cpp: FSOUND_3D_Listener_SetAttributes(camPos, ...))

import { Vec3 } from '../../sim/vec';
import { versioned } from '../../sim/assetVersion';

export type SoundHandle = { buffer: AudioBuffer | null; url: string };

/** Where a sound plays: the effects (weapons, hits...) or the ambience (rain, wind, lava). */
export type SoundBus = 'sfx' | 'ambient';

/**
 * A crowd of effects at once (the waves with many orbs and cards) got louder and louder until it clipped
 * (Erick, 13/10/2026). The first answer refused a sound past 6 of the same one playing and squeezed the
 * effects with a compressor from -20 dB; but one SMG alone has 8 of its shots ringing (0.82 s of sound every
 * 0.1 s), so the player's own fire skipped shots, and the compressor's automatic makeup gain (+4.6 dB on the
 * quiet sounds, measured) changed the whole mix even with one sound ("bugging even with few orbs", 14/10/2026).
 * Now:
 *  - a new sound always plays: past MAX_SAME_SOUND of the same one (or MAX_SFX in all), the oldest fades out
 *    in STEAL_FADE seconds (its tail, which the new shot covers anyway);
 *  - the crowd: the effects' loudness is measured (an analyser on their sum, every CROWD_TICK seconds, its
 *    power smoothed: up over CROWD_RISE seconds, down over CROWD_FALL, so one shot alone doesn't count) and
 *    past CROWD_RMS (the loud moments of one SMG firing) the effects go down by (CROWD_RMS / loudness)^CROWD_EXP:
 *    a crowd 10 dB louder plays 3 dB louder (it adds texture, and a little loudness);
 *  - a limiter near the top (from -3 dB, ratio 20) only catches the peaks, its own makeup gain taken back.
 * One sound alone plays as before the limits, a few orbs fighting nearly so (measured: the crowd's level stays at
 * 1 on wave 1, with dips on its loudest moments; on wave 30 with the shot cards the effects sound ~5 dB louder
 * than on wave 1 and peak under -2 dB).
 */
const MAX_SAME_SOUND = 8;
const MAX_SFX = 64;
const STEAL_FADE = 0.05;
const CROWD_TICK = 0.05;
const CROWD_RISE = 0.15;
const CROWD_FALL = 0.6;
const CROWD_RMS = 10 ** (-18 / 20);
const CROWD_EXP = 0.7;
/**
 * The limiter's makeup gain taken back: Web Audio raises a compressor's output by (1 / full range gain)^0.6,
 * +1.37 dB with these settings (measured with an OfflineAudioContext, 14/10/2026).
 */
const LIMITER_TRIM = 10 ** (-1.37 / 20);

/** An effect playing (not the loops nor the ambience). */
interface Voice {
  sound: SoundHandle;
  src: AudioBufferSourceNode;
  gain: GainNode;
  done: boolean;
}

/** A music track streamed by an <audio> element, routed into the music bus once audio is unlocked. */
interface MusicTrack {
  el: HTMLAudioElement;
  gain: GainNode | null;
}

class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /**
   * The effects: their sum (sfxIn, measured by sfxMeter), the crowd's level (sfxCrowd), the player's volume
   * (sfxBus), the limiter for the peaks.
   */
  private sfxIn!: GainNode;
  private sfxMeter!: AnalyserNode;
  private meterBuf = new Float32Array(2048);
  private sfxCrowd!: GainNode;
  private sfxBus!: GainNode;
  private sfxLimiter!: DynamicsCompressorNode;
  /** The effects' smoothed power, and the crowd's level now. */
  private crowdPower = 0;
  private crowdLevel = 1;
  /** The effects playing now, oldest first (MAX_SAME_SOUND, MAX_SFX). */
  private voices: Voice[] = [];
  private musicBus!: GainNode;
  /** The map's own sounds (rain, wind, lava), with their own volume. */
  private ambientBus!: GainNode;
  private cache = new Map<string, SoundHandle>();
  private pending = new Map<string, Promise<SoundHandle>>();
  private tracks = new Map<string, MusicTrack>();
  private music: MusicTrack | null = null;
  private musicUrl = '';
  private listener = new Vec3();
  masterVolume = 1;
  // Player settings (not in the original): music, effects and ambience volume, 0..1, and mute
  private musicLevel = 1;
  private sfxLevel = 1;
  private ambientLevel = 1;
  private allOff = false;
  private musicOff = false;
  private sfxOff = false;
  private ambientOff = false;

  /** Must be called from a user gesture at least once (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.allOff ? 0 : this.masterVolume;
    this.master.connect(this.ctx.destination);
    this.sfxIn = this.ctx.createGain();
    this.sfxMeter = this.ctx.createAnalyser();
    this.sfxMeter.fftSize = this.meterBuf.length;
    this.sfxIn.connect(this.sfxMeter);
    this.sfxCrowd = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.sfxLimiter = this.ctx.createDynamicsCompressor();
    this.sfxLimiter.threshold.value = -3;
    this.sfxLimiter.knee.value = 2;
    this.sfxLimiter.ratio.value = 20;
    this.sfxLimiter.attack.value = 0.002;
    this.sfxLimiter.release.value = 0.1;
    const trim = this.ctx.createGain();
    trim.gain.value = LIMITER_TRIM;
    this.sfxIn.connect(this.sfxCrowd).connect(this.sfxBus).connect(this.sfxLimiter).connect(trim).connect(this.master);
    window.setInterval(() => this.updateCrowd(), CROWD_TICK * 1000);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.ambientBus = this.ctx.createGain();
    this.ambientBus.connect(this.master);
    this.applyVolumes();
    // Decode anything that was requested before the context existed.
    for (const [url, handle] of this.cache) if (!handle.buffer) void this.decodeInto(url, handle);
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setMasterVolume(v: number): void {
    this.masterVolume = v;
    this.applyVolumes();
  }

  /** Every sound off, music, effects and ambience levels (0..1, applied on top of each sound's own volume) and mute. */
  setVolumes(v: { muted: boolean; music: number; sfx: number; ambient: number; musicMuted: boolean; sfxMuted: boolean; ambientMuted: boolean }): void {
    this.allOff = v.muted;
    this.musicLevel = Math.max(0, Math.min(1, v.music));
    this.sfxLevel = Math.max(0, Math.min(1, v.sfx));
    this.ambientLevel = Math.max(0, Math.min(1, v.ambient));
    this.musicOff = v.musicMuted;
    this.sfxOff = v.sfxMuted;
    this.ambientOff = v.ambientMuted;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.allOff ? 0 : this.masterVolume, t, 0.03);
    this.musicBus.gain.setTargetAtTime(this.musicOff ? 0 : this.musicLevel, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.sfxOff ? 0 : this.sfxLevel, t, 0.03);
    this.ambientBus.gain.setTargetAtTime(this.ambientOff ? 0 : this.ambientLevel, t, 0.03);
  }

  private bus(kind: SoundBus): GainNode {
    return kind === 'ambient' ? this.ambientBus : this.sfxIn;
  }

  /** Loads (and caches) a sound. Safe to call before `unlock()`; decoding happens once a context exists. */
  load(url: string): SoundHandle {
    let handle = this.cache.get(url);
    if (handle) return handle;
    handle = { buffer: null, url };
    this.cache.set(url, handle);
    if (this.ctx) void this.decodeInto(url, handle);
    return handle;
  }

  /** Loads a sound and resolves once decoded (or failed). */
  loadAsync(url: string): Promise<SoundHandle> {
    const handle = this.load(url);
    if (handle.buffer) return Promise.resolve(handle);
    let p = this.pending.get(url);
    if (!p) {
      p = this.decodeInto(url, handle);
      this.pending.set(url, p);
    }
    return p;
  }

  private rawCache = new Map<string, Promise<ArrayBuffer>>();

  private async decodeInto(url: string, handle: SoundHandle): Promise<SoundHandle> {
    try {
      let raw = this.rawCache.get(url);
      if (!raw) {
        raw = fetch(versioned(url)).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        });
        this.rawCache.set(url, raw);
      }
      const data = await raw;
      if (!this.ctx) return handle; // decoded later in init()
      if (!handle.buffer) handle.buffer = await this.ctx.decodeAudioData(data.slice(0));
    } catch (e) {
      console.warn('sound load failed', url, e);
    }
    return handle;
  }

  setListener(pos: Vec3): void {
    this.listener.copy(pos);
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      // Looking down at the ground (-Z), screen-up is +Y: sounds to the right of the screen pan right.
      l.forwardX.value = 0;
      l.forwardY.value = 0;
      l.forwardZ.value = -1;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  /**
   * An effect starts (loops and the ambience aren't counted): the oldest of the same sound past
   * MAX_SAME_SOUND, then the oldest of all past MAX_SFX, fade out to make room; the crowd's level follows.
   */
  private addVoice(sound: SoundHandle, src: AudioBufferSourceNode, gain: GainNode): void {
    const now = this.ctx!.currentTime;
    let same = 0;
    for (const v of this.voices) if (v.sound === sound) same++;
    if (same >= MAX_SAME_SOUND) this.release(this.voices.find((v) => v.sound === sound)!, now);
    if (this.voices.length >= MAX_SFX) this.release(this.voices[0], now);
    const voice: Voice = { sound, src, gain, done: false };
    this.voices.push(voice);
    src.addEventListener('ended', () => this.dropVoice(voice));
  }

  /** Makes room: the sound fades out in STEAL_FADE seconds and stops. */
  private release(v: Voice, now: number): void {
    v.gain.gain.setTargetAtTime(0, now, STEAL_FADE / 4);
    v.src.stop(now + STEAL_FADE);
    this.dropVoice(v);
  }

  private dropVoice(v: Voice): void {
    if (v.done) return;
    v.done = true;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /**
   * The crowd's level for the effects' loudness, measured now: their power smoothed (up quickly, down
   * slowly: no pumping), and past CROWD_RMS the level goes down.
   */
  private updateCrowd(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const buf = this.meterBuf;
    this.sfxMeter.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const power = sum / buf.length;
    const tau = power > this.crowdPower ? CROWD_RISE : CROWD_FALL;
    this.crowdPower += (power - this.crowdPower) * (1 - Math.exp(-CROWD_TICK / tau));
    const rms = Math.sqrt(this.crowdPower);
    const target = rms > CROWD_RMS ? (CROWD_RMS / rms) ** CROWD_EXP : 1;
    if (Math.abs(target - this.crowdLevel) < 0.005) return;
    this.sfxCrowd.gain.setTargetAtTime(target, ctx.currentTime, CROWD_TICK);
    this.crowdLevel = target;
  }

  /** The effects playing now, the crowd's level and its loudness (the tests). */
  get voiceStats(): { voices: number; level: number; rms: number } {
    return { voices: this.voices.length, level: this.crowdLevel, rms: Math.sqrt(this.crowdPower) };
  }

  /** 2D sound (dksPlaySound). Returns the source so loops can be stopped (null: not played). */
  play(sound: SoundHandle | null | undefined, volume = 255, loop = false, bus: SoundBus = 'sfx'): AudioBufferSourceNode | null {
    if (!this.ctx || !sound?.buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop = loop;
    const g = this.ctx.createGain();
    const v = Math.max(0, Math.min(255, volume)) / 255;
    g.gain.value = v;
    src.connect(g).connect(this.bus(bus));
    src.start();
    if (!loop && bus === 'sfx') this.addVoice(sound, src, g);
    return src;
  }

  /** 3D sound (dksPlay3DSound(sound, channel, range, position, volume)). */
  play3D(
    sound: SoundHandle | null | undefined,
    range: number,
    position: Vec3,
    volume = 255,
    loop = false,
    bus: SoundBus = 'sfx',
  ): { source: AudioBufferSourceNode; panner: PannerNode; gain: GainNode } | null {
    if (!this.ctx || !sound?.buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop = loop;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(0.0001, range);
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }
    const g = this.ctx.createGain();
    const v = Math.max(0, Math.min(255, volume)) / 255;
    g.gain.value = v;
    src.connect(g).connect(panner).connect(this.bus(bus));
    src.start();
    if (!loop && bus === 'sfx') this.addVoice(sound, src, g);
    return { source: src, panner, gain: g };
  }

  /**
   * Starts downloading a music track without playing it (allowed before any user gesture), so
   * playMusic() can start it right away. Tracks are streamed: playback begins after the first
   * seconds arrive, and the whole song is never decoded into memory.
   */
  prepareMusic(url: string): void {
    this.track(url);
  }

  private track(url: string): MusicTrack {
    let t = this.tracks.get(url);
    if (!t) {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = true;
      el.src = versioned(url);
      t = { el, gain: null };
      this.tracks.set(url, t);
    }
    // Through the music bus (settings volume, mute) as soon as there is an audio context
    if (this.ctx && !t.gain) {
      t.gain = this.ctx.createGain();
      this.ctx.createMediaElementSource(t.el).connect(t.gain).connect(this.musicBus);
    }
    return t;
  }

  /** Looping music (dksPlayMusic), streamed. */
  async playMusic(url: string, volume = 255): Promise<void> {
    if (this.musicUrl === url && this.music && !this.music.el.paused) return;
    this.stopMusic();
    this.musicUrl = url;
    const t = this.track(url);
    this.music = t;
    const v = Math.max(0, Math.min(255, volume)) / 255;
    if (t.gain) t.gain.gain.value = v;
    else t.el.volume = v; // no Web Audio: plain element volume
    t.el.currentTime = 0;
    try {
      await t.el.play();
    } catch (e) {
      // Autoplay refused before the first click (main.ts starts the menu music on it) or a load error
      if ((e as DOMException).name !== 'NotAllowedError' && (e as DOMException).name !== 'AbortError') console.warn('music failed', url, e);
    }
  }

  stopMusic(): void {
    this.music?.el.pause();
    this.music = null;
    this.musicUrl = '';
  }
}

export const audio = new AudioSystem();
