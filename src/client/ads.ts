// Banners (Adsterra) in the pauses only: the start screen and the end of a campaign level, never over a
// match. Nothing loads before the visitor agrees to ads in the cookie banner (public/consent.js), and
// only on madorbs.com (test browsers and localhost would count fake views; localStorage
// "madorbs.adtest" = "1" shows them anywhere, for testing the layout).
//
// Each banner is public/ad-frame.html in an iframe from another origin (ads.madorbs.com; in
// development 127.0.0.1 instead of localhost): the ad's script can't reach this page, its storage or
// the sign-in session. The sandbox also keeps it from navigating the game away (its links open tabs).

export type AdSlot = 'sky' | 'rect' | 'wide';

/** The ad units of madorbs.com: 160x600 (start screen, left), 300x250 (start screen, right), 728x90 (end of a level). */
const UNITS: Record<AdSlot, { key: string; width: number; height: number }> = {
  sky: { key: '992b66ac49db73941bad42a4f37a3c97', width: 160, height: 600 },
  rect: { key: 'ccc8588a45fc8a199609e7c962ff0463', width: 300, height: 250 },
  wide: { key: '637e3348b0a4e4eeb97c653c2202151e', width: 728, height: 90 },
};

/** Where the banners' page is served: an origin that isn't this page's. */
function frameOrigin(): string {
  if (/(^|\.)madorbs\.com$/.test(location.hostname)) return 'https://ads.madorbs.com';
  if (location.hostname === 'localhost') return `${location.protocol}//127.0.0.1${location.port ? ':' + location.port : ''}`;
  return '';
}

interface ConsentApi {
  allows(kind: 'ads' | 'analytics'): boolean;
}

function consented(): boolean {
  return !!(window as { madorbsConsent?: ConsentApi }).madorbsConsent?.allows('ads');
}

function rightHost(): boolean {
  if (/(^|\.)madorbs\.com$/.test(location.hostname)) return true;
  try {
    return localStorage.getItem('madorbs.adtest') === '1';
  } catch {
    return false;
  }
}

/** The frames' origin answers (checked once, at load): until it does (its DNS, say), no banner. */
let reachable = false;
/** An ad blocker was found (adBlocked): no banner, their space would stay empty. */
let blocked = false;
const listeners: (() => void)[] = [];
const frameCheck: Promise<boolean> =
  rightHost() && frameOrigin()
    ? fetch(`${frameOrigin()}/ad-frame.html`, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' }).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);
void frameCheck.then((ok) => {
  reachable = ok;
  if (!ok) console.warn('[ads] the banners origin does not answer');
  else if (adsAllowed()) for (const fn of listeners) fn();
});

/** Google's ad script, which every blocker refuses (loaded anyway by consent.js once ads are agreed to). */
const GOOGLE_ADS = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4734295007084792';

/** A request the browser refuses (a blocker; or no network). */
function refused(url: string): Promise<boolean> {
  return fetch(url, { mode: 'no-cors', credentials: 'omit' }).then(
    () => false,
    () => true,
  );
}

/** A box with the class names of ads: the blockers' page rules hide it. */
function baitHidden(): Promise<boolean> {
  const bait = document.createElement('div');
  bait.className = 'adsbox ad-banner ad-placement textads banner_ad pub_300x250 adsbygoogle';
  bait.setAttribute('aria-hidden', 'true');
  bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:300px;height:250px;pointer-events:none';
  bait.innerHTML = '&nbsp;';
  document.body.append(bait);
  return new Promise((done) =>
    setTimeout(() => {
      const style = getComputedStyle(bait);
      done(bait.offsetHeight === 0 || style.display === 'none' || style.visibility === 'hidden');
      bait.remove();
    }, 500),
  );
}

let blockCheck: Promise<boolean> | null = null;
/**
 * An ad blocker is on: checked once per page, only where banners would show and the visitor agreed to
 * ads (so the requests don't go out before consent). Any of: the bait box hidden, Google's ad script
 * refused, the banners' own origin refused.
 */
export function adBlocked(): Promise<boolean> {
  if (!rightHost() || !consented() || !frameOrigin()) return Promise.resolve(false);
  blockCheck ??= Promise.all([baitHidden(), refused(GOOGLE_ADS), frameCheck.then((ok) => !ok)]).then((found) => {
    blocked = found.some(Boolean);
    return blocked;
  });
  return blockCheck;
}

/** Banners may show here and now (agreed to, on madorbs.com, and the frames' origin answers). */
export function adsAllowed(): boolean {
  return reachable && !blocked && rightHost() && consented();
}

/** Calls `fn` when banners become possible later: the visitor agrees to ads, or the frames' origin answers. */
export function onAdsAllowed(fn: () => void): void {
  listeners.push(fn);
  window.addEventListener('madorbs:consent', () => {
    if (adsAllowed()) fn();
  });
}

/**
 * Puts the banner of `slot` in `host` (emptying it). Returns false when ads aren't allowed (the host
 * stays empty: hide its frame).
 */
export function mountAd(host: HTMLElement, slot: AdSlot): boolean {
  host.replaceChildren();
  if (!adsAllowed()) return false;
  const u = UNITS[slot];
  const frame = document.createElement('iframe');
  frame.width = String(u.width);
  frame.height = String(u.height);
  frame.title = 'Advertisement';
  frame.loading = 'eager';
  frame.setAttribute('scrolling', 'no');
  frame.style.cssText = `display:block;width:${u.width}px;height:${u.height}px;border:0;overflow:hidden`;
  // Its own origin keeps it apart from this page; the sandbox adds: no navigating the game away
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.src = `${frameOrigin()}/ad-frame.html?key=${u.key}&w=${u.width}&h=${u.height}`;
  host.append(frame);
  return true;
}
