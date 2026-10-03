// The game modes as the player sees them (start screen, HUD, weapon menu), in the page's language.
import { GAME_TYPE_CTF, GAME_TYPE_TDM, PLAYER_TEAM_BLUE, PLAYER_TEAM_RED } from '../sim/constants';
import type { RoomMode } from '../net/protocol';
import { t } from '../i18n';

/** Card title / HUD label. */
export function modeName(mode: RoomMode): string {
  return t(`mode.${mode}.name` as const);
}

/** One line on the start screen's card. */
export function modeTagline(mode: RoomMode): string {
  return t(`mode.${mode}.tagline` as const);
}

/** The training window's buttons. */
export function modeShort(mode: RoomMode): string {
  return t(`mode.${mode}.short` as const);
}

export function modeOfGameType(gameType: number): RoomMode {
  return gameType === GAME_TYPE_TDM ? 'tdm' : gameType === GAME_TYPE_CTF ? 'ctf' : 'dm';
}

/** "blue team" / "red team", lower case for the middle of a sentence. */
export function teamName(teamID: number): string {
  return teamID === PLAYER_TEAM_BLUE ? t('team.0') : teamID === PLAYER_TEAM_RED ? t('team.1') : '';
}

/** "the blue flag" / "the red flag" */
export function flagName(flagID: number): string {
  return flagID === 0 ? t('flag.0') : t('flag.1');
}
