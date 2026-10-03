// The announcer: the voice of "WARLORD Announcer Audio Pack" by VoiceBosch (CC BY-SA 4.0,
// public/assets/sounds/announcer/LICENSE.txt) for the kill feats (src/sim/feats.ts), the start of a
// match and a Deathmatch won. Shutdown has no line in the pack: a synthesized jingle instead.
import type { FeatKind } from '../sim/feats';
import { audio, type SoundHandle } from './audio/audio';

type Line = 'start' | 'captureTheFlag' | 'lastManStanding' | Exclude<FeatKind, 'shutdown'>;

const FILES: Record<Line, string> = {
  start: 'start',
  captureTheFlag: 'capture-the-flag',
  lastManStanding: 'last-man-standing',
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

export function playFeatSound(kind: FeatKind): void {
  if (kind !== 'shutdown') {
    playAnnouncer(kind);
    return;
  }
  audio.jingle([[12, 0, 0.12], [7, 0.1, 0.12], [0, 0.2, 0.45]], { base: 392, wave: 'square', volume: 210, impact: true });
}
