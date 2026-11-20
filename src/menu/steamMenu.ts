// The Steam start screen to try (Erick, 18/11/2026: mockup R1 of the canvas "Mad Orbs · telas da Steam", the Waves
// only): a big logo over a menu down the left (Continue: the highest checkpoint with the last weapon, one click; New run:
// the wave among the checkpoints and the weapon, in the Workshop's window as its run half; the Workshop, the shop half
// alone; the Collection of Orbs, the Stats, the Tutorial), your Orb on its pedestal in the middle, the ranking on the right with Friends and
// Global (only Global works on the web: the friends are Steam's; a weekly challenge's tab waits for after the launch,
// Erick, 18/11/2026) and the player to pass next under it (src/menu/lobbyRanking.ts). Opened with ?ui=steam on the start screen's address; the
// official screen stays as it is. The lobby's own pieces (index.html #steamMenu, the lobby's pedestal and ranking; the
// CSS under #start.steam in menu.css), its buttons calling the lobby's own actions (src/menu/menu.ts).
import { loadWavesRecord } from '../client/waves';
import { weaponLook } from '../client/wavesPrize';
import { affordable, checkpoints, dailyState, loadProgress, startWeapons } from '../client/wavesProgress';
import { t } from '../i18n';
import { SKIN_ORDER, availableSkins } from './settings';
import { WavesModal } from './wavesModal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** This page asked for the Steam start screen (?ui=steam). */
export const steamUi = (): boolean => new URLSearchParams(location.search).get('ui') === 'steam';

export interface SteamMenuActions {
  /** A waves run from `startWave` with the last weapon (the first time, the tutorial question first). */
  play(startWave: number): void;
  /** The run's choice: the wave and the weapon (the Workshop's window, its run half). */
  newRun(): void;
  /** The Workshop (its window, the shop half). */
  workshop(): void;
  orbs(): void;
  stats(): void;
  tutorial(): void;
}

export class SteamMenu {
  constructor(actions: SteamMenuActions) {
    $('start').classList.add('steam');
    // (the windows and the page around the lobby: the online modes' and the web's parts hidden, .not-steam)
    document.documentElement.classList.add('steam-ui');
    // The Controls in the Waves' words: Tab shows your stats, Esc pauses, the dash and the shock are the Workshop's
    for (const [key, steam] of [
      ['controls.scores', 'steam.ctlStats'],
      ['controls.menu', 'steam.ctlPause'],
      ['controls.dash', 'steam.ctlDash'],
      ['controls.shock', 'steam.ctlShock'],
    ] as const)
      for (const el of document.querySelectorAll<HTMLElement>(`#controlsModal [data-i18n="${key}"]`)) {
        el.dataset.i18n = steam;
        el.textContent = t(steam);
      }
    $('steamMenu').hidden = false;
    $('smContinue').addEventListener('click', () => actions.play(this.continueWave()));
    $('smNew').addEventListener('click', () => actions.newRun());
    $('smShop').addEventListener('click', () => actions.workshop());
    $('smOrbs').addEventListener('click', () => actions.orbs());
    $('smStats').addEventListener('click', () => actions.stats());
    $('smTutorial').addEventListener('click', () => actions.tutorial());
    this.render();
  }

  /** Continue: the highest checkpoint the record opened (1 before the first). */
  private continueWave(): number {
    const cps = checkpoints(loadWavesRecord()?.wave ?? 0);
    return cps[cps.length - 1];
  }

  /** The buttons' lines, from this browser's record and Workshop (again whenever the lobby's numbers change). */
  render(): void {
    const wave = this.continueWave();
    const p = loadProgress();
    const record = loadWavesRecord()?.wave ?? 0;
    // Nothing to continue yet: Play, from wave 1; Continue says where and with what
    $('smContinueLabel').textContent = t(wave > 1 ? 'steam.continue' : 'steam.play');
    $('smContinueSub').textContent = wave > 1 ? t('steam.continueWeapon', { n: wave, weapon: weaponLook(WavesModal.startChoice().startWeapon).name }) : t('steam.fromOne');
    // (New run: something to choose, a checkpoint past wave 1 or a second weapon)
    $('smNew').hidden = wave <= 1 && startWeapons(record).length <= 1;
    // The Workshop: today's reward waiting first, else how many upgrades the Cores pay for
    const canBuy = affordable(p);
    $('smShopHint').textContent = dailyState(p).ready ? t('menu.dailyReady') : canBuy > 0 ? t(canBuy === 1 ? 'menu.wavesCanBuyOne' : 'menu.wavesCanBuy', { n: canBuy }) : '';
    $('smOrbsHint').textContent = t('steam.collectionHint', { n: availableSkins().length, m: SKIN_ORDER.length });
  }
}
