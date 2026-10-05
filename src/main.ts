// Entry point: the start screen, then the online game on this server or the offline training.
import '@fontsource/lilita-one/400.css';
import '@fontsource-variable/nunito';
import './menu/menu.css';
import { audio } from './client/audio/audio';
import { ClientGame } from './client/clientGame';
import { DM_MAPS, MAP_LIST } from './client/mapList';
import { gameSounds } from './client/sounds';
import type { CampaignLevel } from './client/campaign';
import { bestKills } from './client/records';
import { Account } from './menu/account';
import { AudioPanel } from './menu/audioPanel';
import { setUserProperty, track } from './client/analytics';
import { WAVES_MAP } from './client/waves';
import { StartScreen, type PlayMode } from './menu/menu';
import { OrbStudio } from './menu/orbStudio';
import { trainingMaps } from './menu/training';
import { applyAudioSettings, loadSettings, saveSettings, skinInfo } from './menu/settings';
import type { SkinInfo } from './sim/player';
import { t, translateDom } from './i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// The page's texts in its language (each language's index.html already has them; dev and "/" may not)
translateDom();

const settings = loadSettings();
applyAudioSettings(settings);
const audioPanel = new AudioPanel(settings, () => saveSettings(settings));
const studio = new OrbStudio();
const account = new Account();
// Analytics: events say whether the visitor is signed in
setUserProperty('signed_in', 'no');
account.onChange(() => setUserProperty('signed_in', account.signedIn ? 'yes' : 'no'));
// For the screenshot tools (tools/debug/menushots.mjs fills a signed-in account)
(window as unknown as { madorbsAccount: Account }).madorbsAccount = account;
const screen = new StartScreen(
  settings,
  studio,
  account,
  (mode) => void startGame(mode),
  (level) => void startGame('offline', level),
  () => void startGame('offline', undefined, true),
);
/** What to do when the game closes, instead of the start screen (a campaign level's buttons). */
let afterQuit: (() => void) | null = null;
screen.show();
void account.restore();

/** `level`: a campaign level (offline, src/client/campaign.ts). */
async function startGame(mode: PlayMode, level?: CampaignLevel, waves = false): Promise<void> {
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
      // A campaign level's buttons: the next level, the same again, or the levels window
      if (afterQuit) {
        const then = afterQuit;
        afterQuit = null;
        then();
        return;
      }
      screen.show(reason);
      void audio.playMusic(gameSounds().menuMusic, 255);
      // The server saves the account's stats when the player leaves: read them once they are in
      if (account.signedIn) setTimeout(() => void account.refreshProfile(), 2000);
    },
    onMenuVisibility: (visible: boolean) => audioPanel.setInGame(visible),
    onToggleMusic: () => audioPanel.toggleMusic(),
    // The HUD's avatars: the same orbs as the start screen
    orbPicture: (skin: SkinInfo, size: number) => studio.picture(skin, size),
  };
  try {
    let game: ClientGame;
    if (mode === 'online') {
      // The record to beat: this browser's or the account's, the higher
      const record = Math.max(bestKills(settings.mode), account.stats[settings.mode]?.bestKills ?? 0);
      game = await ClientGame.createOnline($('game'), { ...common, authToken: await account.accessToken(), bestKills: record }, onProgress);
    } else if (waves) {
      // The waves mode (src/client/waves.ts) on its map
      game = await ClientGame.create(
        $('game'),
        {
          ...common,
          mode: 'tdm',
          mapName: WAVES_MAP,
          waves: true,
          onWavesAction: (action) => {
            afterQuit =
              action === 'menu'
                ? () => {
                    screen.show();
                    void audio.playMusic(gameSounds().menuMusic, 255);
                  }
                : () => void startGame('offline', undefined, true);
            game.quit();
          },
        },
        onProgress,
      );
    } else if (level) {
      game = await ClientGame.create(
        $('game'),
        {
          ...common,
          mode: 'tdm',
          mapName: level.map,
          campaign: level,
          signedIn: account.signedIn,
          onCampaignWin: (l, seconds) => void account.saveCampaign(l.id, seconds),
          onCampaignAction: (action, target) => {
            afterQuit =
              action === 'menu'
                ? () => {
                    screen.show();
                    screen.openCampaign(target);
                    void audio.playMusic(gameSounds().menuMusic, 255);
                  }
                : () => void startGame('offline', target);
            game.quit();
          },
        },
        onProgress,
      );
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
    track('join_failed', { mode: waves ? 'waves' : level ? 'campaign' : settings.mode, online: mode === 'online', reason: String((e as Error).message).slice(0, 100) });
    screen.show(t('menu.joinFailed', { reason: (e as Error).message }));
  } finally {
    loading.hidden = true;
  }
}

// Menu music: browsers only let a page make sound after the visitor clicks or presses a key
// (autoplay policy), except on sites they already trust. Try right away, then on the first click
// or key press anywhere; it downloads right away either way.
audio.prepareMusic(gameSounds().menuMusic);
const startMenuMusic = () => {
  audio.unlock();
  if (screen.visible) void audio.playMusic(gameSounds().menuMusic, 255);
};
const firstGesture = (e: Event) => {
  // Escape and modifier keys don't count as a gesture for the browser
  if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey)) return;
  window.removeEventListener('pointerdown', firstGesture);
  window.removeEventListener('keydown', firstGesture);
  startMenuMusic();
};
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);
startMenuMusic();
