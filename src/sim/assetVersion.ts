// The version of the served game files: a hash of public/assets and the start screen background,
// set at build time (vite.config.ts, __ASSET_VERSION__). Downloads add it to the address, so a
// browser fetches a file again as soon as the files change and keeps its cached copy otherwise
// (the server lets browsers keep them for a day). Outside Vite (server, tools) there is none.
declare const __ASSET_VERSION__: string | undefined;

const VERSION = typeof __ASSET_VERSION__ === 'string' ? __ASSET_VERSION__ : '';

/** "/assets/models/SMG.DKO" -> "/assets/models/SMG.DKO?v=1a2b3c4d" (site paths only). */
export function versioned(url: string): string {
  if (!VERSION || !url.startsWith('/') || url.includes('?')) return url;
  return `${url}?v=${VERSION}`;
}
