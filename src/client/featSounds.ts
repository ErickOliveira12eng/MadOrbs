// The jingles of the kill feats (src/sim/feats.ts), synthesized by the audio system: the bigger the
// feat, the longer and fuller. Notes: [semitones, start s, length s].
import type { FeatKind } from '../sim/feats';
import { audio } from './audio/audio';

type Notes = readonly (readonly [number, number, number])[];

const CHORD = (root: number, at: number, len: number): Notes => [
  [root, at, len],
  [root + 4, at, len],
  [root + 7, at, len],
];

const SPREE_BASE: Partial<Record<FeatKind, number>> = { spree: 330, rampage: 349, unstoppable: 370, dominating: 392, godlike: 415, legendary: 440 };

export function playFeatSound(kind: FeatKind): void {
  switch (kind) {
    case 'double':
      return audio.jingle([[0, 0, 0.12], [7, 0.1, 0.3]], { base: 523, wave: 'square', volume: 190 });
    case 'triple':
      return audio.jingle([[0, 0, 0.1], [4, 0.09, 0.1], [7, 0.18, 0.35]], { base: 523, wave: 'square', volume: 200 });
    case 'quadra':
      return audio.jingle([[0, 0, 0.09], [4, 0.08, 0.09], [7, 0.16, 0.09], [12, 0.24, 0.45]], { base: 523, wave: 'sawtooth', volume: 210, impact: true });
    case 'penta':
      return audio.jingle([[0, 0, 0.08], [4, 0.07, 0.08], [7, 0.14, 0.08], [12, 0.21, 0.08], [16, 0.28, 0.1], ...CHORD(12, 0.38, 0.9)], {
        base: 523,
        wave: 'sawtooth',
        volume: 230,
        impact: true,
      });
    case 'firstBlood':
      return audio.jingle([[0, 0, 0.2], [3, 0.15, 0.2], [7, 0.3, 0.5]], { base: 220, wave: 'sawtooth', volume: 210, impact: true });
    case 'shutdown':
      return audio.jingle([[12, 0, 0.12], [7, 0.1, 0.12], [0, 0.2, 0.45]], { base: 392, wave: 'square', volume: 210, impact: true });
    case 'revenge':
      return audio.jingle([[0, 0, 0.18], [3, 0, 0.18], [7, 0, 0.18], [12, 0.16, 0.4]], { base: 196, wave: 'sawtooth', volume: 210, impact: true });
    default: {
      // Sprees: a brass stab, higher at each step
      const base = SPREE_BASE[kind] ?? 330;
      return audio.jingle([...CHORD(0, 0, 0.5), [12, 0.22, 0.5]], { base, wave: 'sawtooth', volume: 215, impact: true });
    }
  }
}
