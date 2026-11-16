// Sounds used by the game logic (GameVar::loadSounds, Client.cpp). Effect sounds (impacts,
// explosions, casings...) are loaded by src/client/fx.
import { audio, type SoundHandle } from './audio/audio';
import { weaponDefs } from '../sim/gameVar';

const S = (name: string) => audio.load(`/assets/sounds/${name}`);

export interface GameSounds {
  weapon: SoundHandle[];
  hit: SoundHandle[];
  baboCreve: SoundHandle[];
  hitConfirm: SoundHandle;
  equip: SoundHandle;
  lifePack: SoundHandle;
  grenadeRebond: SoundHandle;
  cocktailMolotov: SoundHandle;
  overHeat: SoundHandle;
  photonStart: SoundHandle;
  shotgunReload: SoundHandle;
  siren: SoundHandle;
  chat: SoundHandle;
  button: SoundHandle;
  /** The Horde's energy taken (src/client/horde.ts): a short bright "pling" made in code, no file. */
  energy: SoundHandle;
  /** CTF (Game.cpp sfx_fcapture / sfx_ecapture / sfx_return): our team / the enemy took a flag, a flag went home. */
  flagTookFriend: SoundHandle;
  flagTookEnemy: SoundHandle;
  flagReturn: SoundHandle;
  /** The cheering of the team that scored (sfx_win = red, sfx_loose = blue). */
  cheer: [blue: SoundHandle, red: SoundHandle];
  menuMusic: string;
  gameMusic: string;
}

/**
 * The menu's music, apart from the rest: the start page plays it without loading the game's sounds (gameSounds loads
 * them all, ~3 MB of WAV that every visitor of the start page downloaded until 20/10/2026, the crawlers too).
 */
export const MENU_MUSIC = '/assets/sounds/Menu.ogg';

let sounds: GameSounds | null = null;

/** The energy's "pling": a sine gliding up from 900 to 1500 Hz in 40 ms with its octave, a fast fade. */
function pling(t: number): number {
  const f0 = 900;
  const f1 = 1500;
  const glide = 0.04;
  const phase = 2 * Math.PI * (t < glide ? f0 * t + ((f1 - f0) * t * t) / (2 * glide) : f0 * glide + ((f1 - f0) * glide) / 2 + f1 * (t - glide));
  const env = Math.min(1, t / 0.004) * Math.exp(-t * 36);
  return env * (0.55 * Math.sin(phase) + 0.18 * Math.sin(2 * phase));
}

export function gameSounds(): GameSounds {
  if (sounds) return sounds;
  const weapon: SoundHandle[] = [];
  for (const d of weaponDefs) if (d) weapon[d.id] = audio.load(`/assets/${d.sound.replace(/^main\//, '')}`);
  sounds = {
    weapon,
    hit: [S('hit1.wav'), S('hit2.wav')],
    baboCreve: [S('BaboCreve1.wav'), S('BaboCreve2.wav'), S('BaboCreve3.wav')],
    hitConfirm: S('hit.wav'),
    equip: S('equip.wav'),
    lifePack: S('LifePack.wav'),
    grenadeRebond: S('GrenadeRebond.wav'),
    cocktailMolotov: S('cocktailmolotov.wav'),
    overHeat: S('overHeat.wav'),
    photonStart: S('PhotonStart.wav'),
    shotgunReload: S('shotgunReload.wav'),
    siren: S('Siren.WAV'),
    chat: S('Chat.wav'),
    button: S('Button.wav'),
    energy: audio.synth('energy', 0.13, pling),
    flagTookFriend: S('ftook.wav'),
    flagTookEnemy: S('etook.wav'),
    flagReturn: S('return.wav'),
    cheer: [S('cheerBlueTeam.wav'), S('cheerRedTeam.wav')],
    menuMusic: MENU_MUSIC,
    gameMusic: '/assets/sounds/Music.ogg',
  };
  return sounds;
}
