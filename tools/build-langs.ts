// After `vite build`: writes the start page in each language from dist/index.html (the English one,
// with Vite's bundle tags): dist/index.html (English, "/"), dist/pt/index.html and dist/es/index.html.
// Each gets its texts (data-i18n / data-i18n-attr, see src/i18n), <html lang>, canonical address,
// Open Graph locale and structured data, so crawlers read every language without running the game.
// Usage: npx tsx tools/build-langs.ts [dist]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, hasKey, setLang, t, type Lang } from '../src/i18n';

const dist = process.argv[2] ?? 'dist';
const template = readFileSync(join(dist, 'index.html'), 'utf8');

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function key(k: string): Parameters<typeof t>[0] {
  if (!hasKey(k)) throw new Error(`index.html uses a text that is in no dictionary: ${k}`);
  return k;
}

/** Sets (or adds) an attribute in an opening tag. */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${esc(value)}$2`);
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${esc(value)}"$1>`);
}

function structuredData(l: Lang): string {
  const url = t('meta.url');
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Mad Orbs', url, inLanguage: t('meta.htmlLang') },
      {
        '@type': 'VideoGame',
        name: 'Mad Orbs',
        url,
        description: t('meta.ldDescription'),
        image: 'https://madorbs.com/og-image.jpg',
        genre: t('meta.ldGenres').split('|'),
        gamePlatform: t('meta.ldPlatform'),
        applicationCategory: 'Game',
        operatingSystem: 'Windows, macOS, Linux',
        playMode: ['MultiPlayer', 'SinglePlayer'],
        inLanguage: LANGS.map((x) => t('meta.htmlLang', undefined, x)),
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: l === 'pt' ? 'BRL' : 'USD' },
        author: { '@type': 'Person', name: 'Érick Matheus de Oliveira' },
      },
    ],
  };
  // No "</script>" can end the block early
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

function page(l: Lang): string {
  setLang(l);
  let html = template.replace(/<html lang="[^"]*">/, `<html lang="${t('meta.htmlLang')}">`);
  // Attributes first (an element may have both)
  html = html.replace(/<[a-zA-Z][^>]*\sdata-i18n-attr="([^"]*)"[^>]*>/g, (tag, pairs: string) => {
    for (const pair of pairs.split(';')) {
      const [attr, k] = pair.split('=').map((s) => s.trim());
      tag = setAttr(tag, attr, t(key(k)));
    }
    return tag;
  });
  // Texts: only elements that hold text alone (no child elements)
  const marked = (html.match(/\sdata-i18n="/g) ?? []).length;
  let done = 0;
  html = html.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*\sdata-i18n="([^"]+)"[^>]*)>[^<]*<\/\1>/g, (_m, tag: string, attrs: string, k: string) => {
    done++;
    return `<${tag}${attrs}>${esc(t(key(k)))}</${tag}>`;
  });
  if (done !== marked) throw new Error(`index.html: ${marked - done} data-i18n element(s) hold other elements; mark a text-only element instead`);
  html = html.replace(/(<script type="application\/ld\+json" id="ld-json">)[\s\S]*?(<\/script>)/, `$1\n${structuredData(l)}\n    $2`);
  html = html.replace(/(<span id="langCode"[^>]*>)[^<]*(<\/span>)/, `$1${l.toUpperCase()}$2`);
  html = html.replace(new RegExp(`(<a [^>]*data-lang="${l}")`), '$1 aria-current="true"');
  return html;
}

for (const l of LANGS) {
  const dir = l === 'en' ? dist : join(dist, l);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(l));
  console.log(`wrote ${join(dir, 'index.html')}`);
}
