// The game modes as the player sees them (start screen, HUD, weapon menu).
import { GAME_TYPE_CTF, GAME_TYPE_TDM, PLAYER_TEAM_BLUE, PLAYER_TEAM_RED } from '../sim/constants';
import type { RoomMode } from '../net/protocol';

export interface ModeInfo {
  /** Card title / HUD label. */
  name: string;
  /** One line on the start screen's card. */
  tagline: string;
}

export const MODE_INFO: Record<RoomMode, ModeInfo> = {
  dm: { name: 'Deathmatch', tagline: 'Todos contra todos' },
  tdm: { name: 'Team Deathmatch', tagline: 'Em equipes' },
  ctf: { name: 'Capture a Bandeira', tagline: 'Pegue a bandeira' },
};

export function modeOfGameType(gameType: number): RoomMode {
  return gameType === GAME_TYPE_TDM ? 'tdm' : gameType === GAME_TYPE_CTF ? 'ctf' : 'dm';
}

/** "azul" / "vermelho" (with the article for sentences like "o time azul"). */
export function teamName(teamID: number): string {
  return teamID === PLAYER_TEAM_BLUE ? 'azul' : teamID === PLAYER_TEAM_RED ? 'vermelho' : 'espectador';
}

/** "a bandeira azul" / "a bandeira vermelha" */
export function flagName(flagID: number): string {
  return flagID === 0 ? 'a bandeira azul' : 'a bandeira vermelha';
}
