// The announcer: the voice of "WARLORD Announcer Audio Pack" by VoiceBosch (CC BY-SA 4.0,
// public/assets/sounds/announcer/LICENSE.txt) for the kill feats (src/sim/feats.ts) and the start of
// a match.
import type { FeatKind } from '../sim/feats';
import { audio, type SoundHandle } from './audio/audio';

type Line = 'start' | FeatKind;

const FILES: Record<Line, string> = {
  start: 'start',
  firstBlood: 'first-blood',
  double: 'double-kill',
  triple: 'triple-kill',
  dominating: 'dominating',
  unstoppable: 'unstoppable',
  revenge: 'revenge-kill',
};

let lines: Record<Line, SoundHandle> | null = null;

/** Starts downloading the announcer's lines (call when a game starts). */
export function loadAnnouncer(): void {
  lines ??= Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, audio.load(`/assets/sounds/announcer/${f}.wav`)])) as Record<Line, SoundHandle>;
}

export function playAnnouncer(line: Line): void {
  loadAnnouncer();
  audio.play(lines![line], 255);
}
