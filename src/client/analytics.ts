// Google Analytics 4 events: which modes and campaign levels are played, how matches end, what is
// chosen in the menus. public/consent.js defines gtag only when statistics are allowed (and GA counts
// only on madorbs.com), so without it nothing is sent. Names follow GA's style (snake_case); the
// parameters must be registered in GA (Admin > Custom definitions) to show in its reports.

type Params = Record<string, string | number | boolean | undefined>;
type Gtag = (...args: unknown[]) => void;

const gtag = (): Gtag | undefined => (window as { gtag?: Gtag }).gtag;

/** Sends one event; never breaks the game. */
export function track(event: string, params: Params = {}): void {
  const g = gtag();
  if (!g) return;
  try {
    g('event', event, params);
  } catch {
    /* analytics must never stop the game */
  }
}

/** A property of the visitor, kept on the next events (signed in or a guest). */
export function setUserProperty(name: string, value: string): void {
  const g = gtag();
  if (!g) return;
  try {
    g('set', 'user_properties', { [name]: value });
  } catch {
    /* as above */
  }
}
