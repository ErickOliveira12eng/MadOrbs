// The Steam start screen to try (Erick, 18/11/2026: mockup R1 of the canvas "Mad Orbs · telas da Steam", the Waves
// only): a menu down the left (Continue from the highest checkpoint, New run from wave 1, the Workshop, the Collection
// of Orbs, the Stats, the Tutorial), your Orb on its pedestal in the middle, the ranking on the right with Friends, Global
// and This week (only Global works on the web: the friends are Steam's, the week's challenge not made yet) and the
// player to pass next under it (src/menu/lobbyRanking.ts). Opened with ?ui=steam on the start screen's address; the
// official screen stays as it is. The lobby's own pieces (index.html #steamMenu, the lobby's pedestal and ranking; the
// CSS under #start.steam in menu.css), its buttons calling the lobby's own actions (src/menu/menu.ts).
import { loadWavesRecord } from '../client/waves';
import { affordable, checkpoints, dailyState, loadProgress } from '../client/wavesProgress';
import { t } from '../i18n';
import { SKIN_ORDER, availableSkins } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** This page asked for the Steam start screen (?ui=steam). */
export const steamUi = (): boolean => new URLSearchParams(location.search).get('ui') === 'steam';

export interface SteamMenuActions {
  /** A waves run from `startWave` (the first time, the tutorial question first). */
  play(startWave: number): void;
  workshop(): void;
  orbs(): void;
  stats(): void;
  tutorial(): void;
}

export class SteamMenu {
  constructor(actions: SteamMenuActions) {
    $('start').classList.add('steam');
    $('steamMenu').hidden = false;
    $('smContinue').addEventListener('click', () => actions.play(this.continueWave()));
    $('smNew').addEventListener('click', () => actions.play(1));
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
    // Nothing to continue yet: Play, from wave 1, and no New run beside it
    $('smContinueLabel').textContent = t(wave > 1 ? 'steam.continue' : 'steam.play');
    $('smContinueSub').textContent = wave > 1 ? t(p.builds[wave] ? 'steam.continueSub' : 'steam.continueNoBuild', { n: wave }) : t('steam.fromOne');
    $('smNew').hidden = wave <= 1;
    // The Workshop: today's reward waiting first, else how many upgrades the Cores pay for
    const canBuy = affordable(p);
    $('smShopHint').textContent = dailyState(p).ready ? t('menu.dailyReady') : canBuy > 0 ? t(canBuy === 1 ? 'menu.wavesCanBuyOne' : 'menu.wavesCanBuy', { n: canBuy }) : '';
    $('smOrbsHint').textContent = t('steam.collectionHint', { n: availableSkins().length, m: SKIN_ORDER.length });
  }
}
