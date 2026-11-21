// The game's languages: English (the default, the page at /), Portuguese (/pt/), Spanish (/es/) and French (/fr/).
// A page's language comes from its address. At / a small script in index.html first sends the
// visitors whose earlier choice (the language button) or browser speaks another one to that version.
//
// Texts: t('key', { name: value }). The dictionaries (en.ts, pt.ts, es.ts) have the same keys,
// checked by TypeScript. The newer languages (fr.ts: Erick, 20/11/2026) translate the game's interface only, a
// Partial: what they lack (the texts under the lobby, home.*; the guides' addresses, link.*) comes in English. Their
// dictionaries are written by tools/i18n-lang.ts (export / import / translate); adding one: see that file's head. Static HTML marks its texts with data-i18n="key" (the element's text) and
// data-i18n-attr="attr=key;attr=key"; translateDom() fills them in the browser and
// tools/build-langs.ts writes them into each language's index.html at build time.
import { en, type Key } from './en';
import { es } from './es';
import { fr } from './fr';
import { pt } from './pt';

export type { Key };
export type Lang = 'en' | 'pt' | 'es' | 'fr';
export const LANGS: readonly Lang[] = ['en', 'pt', 'es', 'fr'];
/** The languages the guide pages (content/pages, tools/make-pages.ts) are written in; the others link to English ones. */
export type PageLang = 'en' | 'pt' | 'es';
export const PAGE_LANGS: readonly PageLang[] = ['en', 'pt', 'es'];
/** Each language in itself, for the language menu. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', pt: 'Português', es: 'Español', fr: 'Français' };
/** localStorage: the language picked with the language button (read by the script in index.html). */
export const LANG_KEY = 'madorbs.lang';

const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, pt, es, fr };

/** The language of an address: /pt/..., /es/..., /fr/..., English otherwise. */
export function langOfPath(path: string): Lang {
  const m = /^\/([a-z]{2})(\/|$)/.exec(path);
  return m && (LANGS as readonly string[]).includes(m[1]) ? (m[1] as Lang) : 'en';
}

/** The start page of a language. */
export function homePath(l: Lang): string {
  return l === 'en' ? '/' : `/${l}/`;
}

let current: Lang = typeof location === 'undefined' ? 'en' : langOfPath(location.pathname);

export function lang(): Lang {
  return current;
}

/** Changes the language of the texts from now on (tools and tests; the page reloads instead). */
export function setLang(l: Lang): void {
  current = l;
}

export function hasKey(key: string): key is Key {
  return key in en;
}

export function t(key: Key, params?: Record<string, string | number>, l: Lang = current): string {
  const s = DICTS[l][key] ?? en[key];
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** 1.5 -> "1.5" in English, "1,5" in the others (Portuguese, Spanish, French). */
export function num(v: number, decimals = 1): string {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return current === 'en' ? String(r) : String(r).replace('.', ',');
}

/** A whole number with the language's thousands separator. */
export function bigNum(v: number): string {
  return v.toLocaleString(t('meta.htmlLang'));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fills the page's marked elements in the current language (and <html lang>). */
export function translateDom(root: ParentNode = document): void {
  if (root === document) document.documentElement.lang = t('meta.htmlLang');
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n!;
    if (hasKey(key)) el.textContent = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split('=').map((s) => s.trim());
      if (attr && hasKey(key)) el.setAttribute(attr, t(key));
    }
  }
}

/** The language button: remember the choice and open that language's page. */
export function switchLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* storage unavailable: the address alone keeps the language */
  }
  location.href = homePath(l) + location.search;
}
