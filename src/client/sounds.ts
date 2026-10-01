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
  /** CTF (Game.cpp sfx_fcapture / sfx_ecapture / sfx_return): our team / the enemy took a flag, a flag went home. */
  flagTookFriend: SoundHandle;
  flagTookEnemy: SoundHandle;
  flagReturn: SoundHandle;
  /** The cheering of the team that scored (sfx_win = red, sfx_loose = blue). */
  cheer: [blue: SoundHandle, red: SoundHandle];
  menuMusic: string;
  gameMusic: string;
}

let sounds: GameSounds | null = null;

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
    flagTookFriend: S('ftook.wav'),
    flagTookEnemy: S('etook.wav'),
    flagReturn: S('return.wav'),
    cheer: [S('cheerBlueTeam.wav'), S('cheerRedTeam.wav')],
    menuMusic: '/assets/sounds/Menu.ogg',
    gameMusic: '/assets/sounds/Music.ogg',
  };
  return sounds;
}
