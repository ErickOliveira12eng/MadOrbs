// WebAudio port of the original sound module (Engine/DukZeven/Code/dks.cpp, FMOD based).
//
// Semantics kept from the original:
//  - volumes are 0..255 (FSOUND_SetVolume scale)
//  - 3D sounds use FMOD's inverse rolloff: full volume up to `range`, then volume = range / distance
//  - the listener sits at the camera position (Client.cpp: FSOUND_3D_Listener_SetAttributes(camPos, ...))

import { Vec3 } from '../../sim/vec';

export type SoundHandle = { buffer: AudioBuffer | null; url: string };

/** Where a sound plays: the effects (weapons, hits...) or the ambience (rain, wind, lava). */
export type SoundBus = 'sfx' | 'ambient';

/** A music track streamed by an <audio> element, routed into the music bus once audio is unlocked. */
interface MusicTrack {
  el: HTMLAudioElement;
  gain: GainNode | null;
}

class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
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
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
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
    if (this.ctx) this.master.gain.value = v;
  }

  /** Music, effects and ambience levels (0..1, applied on top of each sound's own volume) and mute. */
  setVolumes(v: { music: number; sfx: number; ambient: number; musicMuted: boolean; sfxMuted: boolean; ambientMuted: boolean }): void {
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
    this.musicBus.gain.setTargetAtTime(this.musicOff ? 0 : this.musicLevel, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.sfxOff ? 0 : this.sfxLevel, t, 0.03);
    this.ambientBus.gain.setTargetAtTime(this.ambientOff ? 0 : this.ambientLevel, t, 0.03);
  }

  private bus(kind: SoundBus): GainNode {
    return kind === 'ambient' ? this.ambientBus : this.sfxBus;
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
        raw = fetch(url).then((r) => {
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

  /** 2D sound (dksPlaySound). Returns the source so loops can be stopped. */
  play(sound: SoundHandle | null | undefined, volume = 255, loop = false, bus: SoundBus = 'sfx'): AudioBufferSourceNode | null {
    if (!this.ctx || !sound?.buffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = sound.buffer;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0, Math.min(255, volume)) / 255;
    src.connect(g).connect(this.bus(bus));
    src.start();
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
    g.gain.value = Math.max(0, Math.min(255, volume)) / 255;
    src.connect(g).connect(panner).connect(this.bus(bus));
    src.start();
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
      el.src = url;
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
