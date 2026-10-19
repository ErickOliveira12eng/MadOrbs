// Mad Orbs' profiles (Erick, 18/10/2026): TikTok @madorbs, YouTube and Instagram @playmadorbs. The start page has them
// in its markup (index.html: the footer, "Follow Mad Orbs"); the guide pages (tools/make-pages.ts) and the structured
// data's sameAs (tools/build-langs.ts) take them from here: a new profile goes in both places.
export const SOCIAL = [
  { id: 'tiktok', name: 'TikTok', handle: '@madorbs', url: 'https://www.tiktok.com/@madorbs' },
  { id: 'youtube', name: 'YouTube', handle: '@playmadorbs', url: 'https://www.youtube.com/@playmadorbs' },
  { id: 'instagram', name: 'Instagram', handle: '@playmadorbs', url: 'https://www.instagram.com/playmadorbs' },
] as const;
