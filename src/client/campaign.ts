// The campaign: chapters of levels against bots, one weapon per chapter. Like Team Deathmatch with the
// player alone on the blue team and the bots on the red one; nobody respawns: the level is won when
// every bot is down, lost when the player dies. Each level of a chapter has one bot more; each chapter
// has smarter bots; the last level is a boss (a bigger, tougher orb) with bots joining now and then.
// The stars come from the time. Progress is kept in this browser and, signed in, in the account
// (campaign_progress, merged by src/menu/account.ts).
import {
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_DUAL_MACHINE_GUN,
  WEAPON_FLAME_THROWER,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHOTGUN,
  WEAPON_SMG,
  WEAPON_SNIPER,
} from '../sim/constants';

export interface CampaignChapter {
  /** 1-based. */
  n: number;
  weaponID: number;
  /** The weapon's key in the texts (w.<key>.name, campaign.boss.<key>) and its picture in /guia/. */
  weaponKey: 'smg' | 'shotgun' | 'dmg' | 'chaingun' | 'sniper' | 'bazooka' | 'flame' | 'photon';
  picture: string;
  /** The bots' skill (BotController), rising from chapter to chapter. */
  skill: number;
  /** Maps of levels 1..5 and of the boss. */
  maps: [string, string, string, string, string, string];
  /** Slower weapons get more time for the stars. */
  pace: number;
}

export interface CampaignLevel {
  /** "c3l2": chapter 3, level 2 (level 6 is the boss). */
  id: string;
  chapter: CampaignChapter;
  /** 1..6 */
  n: number;
  boss: boolean;
  map: string;
  /** Bots at the start (the boss level: its guards, without the boss). */
  bots: number;
  skill: number;
  /** Seconds for 3 and 2 stars (1 star: just win). */
  stars3: number;
  stars2: number;
}

/** Boss: radius (a babo is 0.25), share of the damage taken, guards at the start, most guards at once, seconds between guards. */
export const BOSS = { radius: 0.45, damageScale: 0.2, guards: 2, maxGuards: 3, guardEvery: 10 };

export const LEVELS_PER_CHAPTER = 6;

const CHAPTERS: CampaignChapter[] = [
  { n: 1, weaponID: WEAPON_SMG, weaponKey: 'smg', picture: 'sub-machine-gun.png', skill: 0.15, pace: 1, maps: ['DM-MiniArena', 'DM-Arena', 'DM-Bubble', 'DM-Fort', 'DM-Brutus', 'DM-Arena'] },
  { n: 2, weaponID: WEAPON_SHOTGUN, weaponKey: 'shotgun', picture: 'shotgun.png', skill: 0.25, pace: 1, maps: ['DM-MiniMess', 'DM-NoSnipe', 'DM-Fort', 'DM-Bubble', 'DM-HellOnEarth', 'DM-MiniArena'] },
  { n: 3, weaponID: WEAPON_DUAL_MACHINE_GUN, weaponKey: 'dmg', picture: 'dual-machine-gun.png', skill: 0.35, pace: 1, maps: ['DM-Arena', 'DM-Pong', 'DM-Brutus', 'DM-Highway', 'DM-Field', 'DM-Fort'] },
  { n: 4, weaponID: WEAPON_CHAIN_GUN, weaponKey: 'chaingun', picture: 'chain-gun.png', skill: 0.45, pace: 1, maps: ['DM-Bubble', 'DM-Fort', 'DM-Arena', 'DM-HellOnEarth', 'DM-Highway', 'DM-Brutus'] },
  { n: 5, weaponID: WEAPON_SNIPER, weaponKey: 'sniper', picture: 'sniper-rifle.png', skill: 0.55, pace: 1.3, maps: ['DM-Field', 'DM-Highway', 'DM-Pong', 'DM-Arena', 'DM-Brutus', 'DM-Field'] },
  { n: 6, weaponID: WEAPON_BAZOOKA, weaponKey: 'bazooka', picture: 'bazooka.png', skill: 0.65, pace: 1.15, maps: ['DM-Fort', 'DM-Arena', 'DM-Bubble', 'DM-MiniArena', 'DM-HellOnEarth', 'DM-Arena'] },
  { n: 7, weaponID: WEAPON_FLAME_THROWER, weaponKey: 'flame', picture: 'flame-thrower.png', skill: 0.75, pace: 1.1, maps: ['DM-MiniMess', 'DM-MiniArena', 'DM-NoSnipe', 'DM-Bubble', 'DM-Fort', 'DM-HellOnEarth'] },
  { n: 8, weaponID: WEAPON_PHOTON_RIFLE, weaponKey: 'photon', picture: 'photon-rifle.png', skill: 0.85, pace: 1.2, maps: ['DM-Pong', 'DM-Highway', 'DM-Field', 'DM-Brutus', 'DM-Arena', 'DM-Highway'] },
];

function makeLevel(chapter: CampaignChapter, n: number): CampaignLevel {
  const boss = n === LEVELS_PER_CHAPTER;
  const bots = boss ? BOSS.guards : n + 1;
  // About 9 s per bot for 3 stars and 16 s for 2 (the boss: as much as 6 bots), slower weapons more
  const size = boss ? 6 : bots;
  return {
    id: `c${chapter.n}l${n}`,
    chapter,
    n,
    boss,
    map: chapter.maps[n - 1],
    bots,
    skill: chapter.skill,
    stars3: Math.round((10 + 9 * size) * chapter.pace),
    stars2: Math.round((20 + 16 * size) * chapter.pace),
  };
}

export const CAMPAIGN: { chapter: CampaignChapter; levels: CampaignLevel[] }[] = CHAPTERS.map((chapter) => ({
  chapter,
  levels: Array.from({ length: LEVELS_PER_CHAPTER }, (_, i) => makeLevel(chapter, i + 1)),
}));

export function levelById(id: string): CampaignLevel | undefined {
  for (const c of CAMPAIGN) for (const l of c.levels) if (l.id === id) return l;
  return undefined;
}

/** The level after this one (the next chapter's first after a boss), or null at the very end. */
export function nextLevel(level: CampaignLevel): CampaignLevel | null {
  const c = CAMPAIGN[level.chapter.n - 1];
  if (level.n < LEVELS_PER_CHAPTER) return c.levels[level.n];
  return CAMPAIGN[level.chapter.n]?.levels[0] ?? null;
}

export function starsFor(level: CampaignLevel, seconds: number): 1 | 2 | 3 {
  return seconds <= level.stars3 ? 3 : seconds <= level.stars2 ? 2 : 1;
}

// ------------------------------------------------------------------ progress (this browser)

const KEY = 'madorbs.campaign';

/** Best time (seconds) of each level won. */
export type CampaignProgress = Record<string, number>;

export function loadProgress(): CampaignProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)) as CampaignProgress;
  } catch {
    return {};
  }
}

/** Saves a win; true when it is the level's best time. */
export function saveWin(level: CampaignLevel, seconds: number): boolean {
  const p = loadProgress();
  const best = p[level.id];
  if (best !== undefined && best <= seconds) return false;
  p[level.id] = Math.round(seconds * 10) / 10;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the win lasts for this page */
  }
  return true;
}

/**
 * The account's progress merged into this browser's (the better time of each level wins). Returns
 * this browser's times the account doesn't have yet, or has worse, to send to it.
 */
export function mergeProgress(remote: CampaignProgress): CampaignProgress {
  const local = loadProgress();
  const merged: CampaignProgress = { ...local };
  const upload: CampaignProgress = {};
  for (const [id, s] of Object.entries(remote)) if (merged[id] === undefined || s < merged[id]) merged[id] = s;
  for (const [id, s] of Object.entries(local)) if (remote[id] === undefined || s < remote[id]) upload[id] = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable */
  }
  return upload;
}

/** A level can be played once the one before it is won (the first of chapter 1 always). */
export function isUnlocked(level: CampaignLevel, progress: CampaignProgress): boolean {
  if (level.chapter.n === 1 && level.n === 1) return true;
  const c = CAMPAIGN[level.chapter.n - 1];
  const before = level.n > 1 ? c.levels[level.n - 2] : CAMPAIGN[level.chapter.n - 2]?.levels[LEVELS_PER_CHAPTER - 1];
  return !!before && progress[before.id] !== undefined;
}

export function chapterStars(chapter: number, progress: CampaignProgress): number {
  return CAMPAIGN[chapter - 1].levels.reduce((n, l) => n + (progress[l.id] !== undefined ? starsFor(l, progress[l.id]) : 0), 0);
}
