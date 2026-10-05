// The waves mode's crates (src/client/wavesRun.ts): wooden boxes on the floor that bullets, blasts,
// flames and knives break; what a broken one drops is up to the mode. Solid for the babos (they roll
// around them) and for the bullets. Only where a mode adds them, offline: online games have none.
import type { Vec3 } from './vec';

/** Life of a crate, in weapon damage (an SMG bullet does 0.1). */
export const CRATE_LIFE = 0.6;
/** Size for the bullets and the babos (a babo is 0.25). */
export const CRATE_RADIUS = 0.32;

export class Crate {
  life = CRATE_LIFE;

  constructor(
    readonly id: number,
    /** Centre, at a babo's height (z = 0.25) so the bullets meet it. */
    readonly position: Vec3,
  ) {}
}
