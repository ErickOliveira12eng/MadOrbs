// Entry point: the start screen, then the online game on this server or the offline training.
import '@fontsource/lilita-one/400.css';
import '@fontsource-variable/nunito';
import './menu/menu.css';
import { audio } from './client/audio/audio';
import { ClientGame } from './client/clientGame';
import { DM_MAPS, MAP_LIST } from './client/mapList';
import { gameSounds } from './client/sounds';
import { AudioPanel } from './menu/audioPanel';
import { StartScreen, type PlayMode } from './menu/menu';
import { OrbStudio } from './menu/orbStudio';
import { trainingMaps } from './menu/training';
import { applyAudioSettings, loadSettings, saveSettings, skinInfo } from './menu/settings';
import type { SkinInfo } from './sim/player';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const settings = loadSettings();
applyAudioSettings(settings);
const audioPanel = new AudioPanel(settings, () => saveSettings(settings));
const studio = new OrbStudio();
const screen = new StartScreen(settings, studio, (mode) => void startGame(mode));
screen.show();

async function startGame(mode: PlayMode): Promise<void> {
  audio.unlock();
  // The game music streams while the models and the map load
  audio.prepareMusic(gameSounds().gameMusic);
  screen.hide();
  const loading = $('loading');
  loading.hidden = false;
  const onProgress = (text: string) => ($('loadingText').textContent = text);
  const common = {
    playerName: settings.name,
    skin: skinInfo(settings),
    mode: settings.mode,
    onQuit: (reason?: string) => {
      audioPanel.setInGame(false);
      screen.show(reason);
      void audio.playMusic(gameSounds().menuMusic, 255);
    },
    onMenuVisibility: (visible: boolean) => audioPanel.setInGame(visible),
    onToggleMusic: () => audioPanel.toggleMusic(),
    // The HUD's avatars: the same orbs as the start screen
    orbPicture: (skin: SkinInfo, size: number) => studio.picture(skin, size),
  };
  try {
    let game: ClientGame;
    if (mode === 'online') {
      game = await ClientGame.createOnline($('game'), common, onProgress);
    } else {
      // Maps played in rotation, starting with the chosen one (the flag maps in Capture the Flag)
      const chosen = settings.mode === 'ctf' ? settings.ctfMap : settings.map;
      const list = settings.mode === 'ctf' ? trainingMaps('ctf') : DM_MAPS.includes(chosen) ? DM_MAPS : MAP_LIST;
      const first = Math.max(0, list.indexOf(chosen));
      const mapRotation = [...list.slice(first), ...list.slice(0, first)];
      game = await ClientGame.create($('game'), { ...common, mapName: mapRotation[0], botCount: settings.bots, botSkill: settings.skill, mapRotation }, onProgress);
    }
    (window as unknown as { madorbs: ClientGame }).madorbs = game;
  } catch (e) {
    console.error(e);
    screen.show(`Não foi possível entrar: ${(e as Error).message}`);
  } finally {
    loading.hidden = true;
  }
}

// Menu music starts on the first interaction (browser autoplay policy); it downloads right away
audio.prepareMusic(gameSounds().menuMusic);
window.addEventListener(
  'pointerdown',
  () => {
    audio.unlock();
    if (screen.visible) void audio.playMusic(gameSounds().menuMusic, 255);
  },
  { once: true },
);
