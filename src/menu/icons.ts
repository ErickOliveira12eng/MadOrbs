// Icons from Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Contributors.
// Inner SVG markup of each 24x24 icon; icon() wraps it in an <svg> using currentColor.

const ICONS = {
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  bot: '<path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" />',
  volume_2: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M16 9a5 5 0 0 1 0 6" /> <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
  volume_x: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" /> <path d="m16.5 14.5 5-5" /> <path d="m16.5 9.5 5 5" />',
  music: '<path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" />',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3" /> <path d="M21 8V5a2 2 0 0 0-2-2h-3" /> <path d="M3 16v3a2 2 0 0 0 2 2h3" /> <path d="M16 21h3a2 2 0 0 0 2-2v-3" />',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3" /> <path d="M21 8h-3a2 2 0 0 1-2-2V3" /> <path d="M3 16h3a2 2 0 0 1 2 2v3" /> <path d="M16 21v-3a2 2 0 0 1 2-2h3" />',
  palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />',
  shuffle: '<path d="m18 14 4 4-4 4" /> <path d="m18 2 4 4-4 4" /> <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22" /> <path d="M2 6h1.972a4 4 0 0 1 3.6 2.2" /> <path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45" />',
  x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
  cloud_rain: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /> <path d="M16 14v6" /> <path d="M8 14v6" /> <path d="M12 16v6" />',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" />',
  crosshair: '<circle cx="12" cy="12" r="10" /> <line x1="22" x2="18" y1="12" y2="12" /> <line x1="6" x2="2" y1="12" y2="12" /> <line x1="12" x2="12" y1="6" y2="2" /> <line x1="12" x2="12" y1="22" y2="18" />',
  mouse_pointer_click: '<path d="M14 4.1 12 6" /> <path d="m5.1 8-2.9-.8" /> <path d="m6 12-1.9 2" /> <path d="M7.2 2.2 8 5.1" /> <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />',
  keyboard: '<path d="M10 8h.01" /> <path d="M12 12h.01" /> <path d="M14 8h.01" /> <path d="M16 12h.01" /> <path d="M18 8h.01" /> <path d="M6 8h.01" /> <path d="M7 16h10" /> <path d="M8 12h.01" /> <rect width="20" height="16" x="2" y="4" rx="2" />',
  message_circle: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />',
  check: '<path d="M20 6 9 17l-5-5" />',
  waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /> <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />',
  heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />',
  swords: '<path d="m13 19 6-6" /> <path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5" /> <path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586" /> <path d="m16 16 4 4" /> <path d="m19 21 2-2" /> <path d="m5 14 4 4" /> <path d="m5 21-2-2" /> <path d="M7.5 16.5 4 20" />',
  wifi_off: '<path d="M12 20h.01" /> <path d="M8.5 16.429a5 5 0 0 1 7 0" /> <path d="M5 12.859a10 10 0 0 1 5.17-2.69" /> <path d="M19 12.859a10 10 0 0 0-2.007-1.523" /> <path d="M2 8.82a15 15 0 0 1 4.177-2.643" /> <path d="M22 8.82a15 15 0 0 0-11.288-3.764" /> <path d="m2 2 20 20" />',
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" />',
  gamepad_2: '<line x1="6" x2="10" y1="11" y2="11" /> <line x1="8" x2="8" y1="9" y2="13" /> <line x1="15" x2="15.01" y1="12" y2="12" /> <line x1="18" x2="18.01" y1="10" y2="10" /> <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />',
  dices: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2" /> <path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6" /> <path d="M6 18h.01" /> <path d="M10 14h.01" /> <path d="M15 6h.01" /> <path d="M18 9h.01" />',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" />',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  log_out: '<path d="m16 17 5-5-5-5" /> <path d="M21 12H9" /> <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />',
  trash: '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  chevron_left: '<path d="m15 18-6-6 6-6" />',
  globe: '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
  chevron_right: '<path d="m9 18 6-6-6-6" />',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" />',
  // Filled pictograms of the start screen's cards (not Lucide); the dark parts are holes
  skull: '<path fill="currentColor" stroke="none" d="M12 2a8.5 8.5 0 0 0-5.3 15.14v2.36A2.5 2.5 0 0 0 9.2 22h5.6a2.5 2.5 0 0 0 2.5-2.5v-2.36A8.5 8.5 0 0 0 12 2z" /> <circle cx="8.7" cy="11.2" r="2.3" fill="#171236" stroke="none" /> <circle cx="15.3" cy="11.2" r="2.3" fill="#171236" stroke="none" /> <path d="M11.3 16.1h1.4l-.7-1.4z" fill="#171236" stroke="#171236" stroke-width="1" /> <path d="M10.2 19.2v2.4M13.8 19.2v2.4" stroke="#171236" stroke-width="1.3" />',
  team: '<circle cx="17" cy="8.4" r="2.9" fill="currentColor" stroke="none" opacity=".6" /> <path d="M15.4 13.8a6 6 0 0 1 1.6-.2c3 0 5 2.1 5 5.3v1.6h-4.3c0-2.6-.8-4.9-2.3-6.7z" fill="currentColor" stroke="none" opacity=".6" /> <circle cx="9" cy="7.6" r="3.6" fill="currentColor" stroke="none" /> <path d="M2 20.5c0-4 3.1-6.6 7-6.6s7 2.6 7 6.6z" fill="currentColor" stroke="none" />',
  flag_fill: '<path d="M5.2 22V3" stroke-width="2.2" /> <path d="M5.2 3.6c2.4-1.4 4.8-1.4 7.2 0s4.8 1.4 7.3 0v9.6c-2.5 1.4-4.9 1.4-7.3 0s-4.8-1.4-7.2 0z" fill="currentColor" stroke="none" />',
  bars: '<rect x="3.4" y="12" width="4.4" height="9" rx="1.2" fill="currentColor" stroke="none" /> <rect x="9.8" y="4" width="4.4" height="17" rx="1.2" fill="currentColor" stroke="none" /> <rect x="16.2" y="8.4" width="4.4" height="12.6" rx="1.2" fill="currentColor" stroke="none" />',
  gamepad: '<path fill="currentColor" stroke="none" d="M7.2 6h9.6a4.6 4.6 0 0 1 4.5 3.7l1.1 5.6a3.1 3.1 0 0 1-5.4 2.6L15.5 16h-7l-1.5 1.9a3.1 3.1 0 0 1-5.4-2.6l1.1-5.6A4.6 4.6 0 0 1 7.2 6z" /> <path d="M8 9.4v3.8M6.1 11.3h3.8" stroke="#171236" stroke-width="1.8" /> <circle cx="15.6" cy="10.3" r="1.15" fill="#171236" stroke="none" /> <circle cx="17.7" cy="12.5" r="1.15" fill="#171236" stroke="none" />',
  trophy: '<path fill="currentColor" stroke="none" d="M7 2.5h10a1 1 0 0 1 1 1V4h2.5a1 1 0 0 1 1 1v1.5a5 5 0 0 1-4.2 4.9A6 6 0 0 1 13 14.9V18h3a1.5 1.5 0 0 1 1.5 1.5V21h-11v-1.5A1.5 1.5 0 0 1 8 18h3v-3.1a6 6 0 0 1-4.3-3.5A5 5 0 0 1 2.5 6.5V5a1 1 0 0 1 1-1H6v-.5a1 1 0 0 1 1-1zM4.5 6v.5a3 3 0 0 0 1.7 2.7A9 9 0 0 1 6 7.4V6zm15 0H18v1.4a9 9 0 0 1-.2 1.8 3 3 0 0 0 1.7-2.7z" /> <path d="M10.2 7.2 12 5.8l1.8 1.4-.7 2.1h-2.2z" fill="#171236" stroke="none" />',
  padlock: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.6 10V7.6a5.4 5.4 0 0 1 10.8 0V10h.3A2.3 2.3 0 0 1 20 12.3v6.4a2.3 2.3 0 0 1-2.3 2.3H6.3A2.3 2.3 0 0 1 4 18.7v-6.4A2.3 2.3 0 0 1 6.3 10zm2.8 0h5.2V7.6a2.6 2.6 0 0 0-5.2 0zM12 13a1.7 1.7 0 0 0-.9 3.15V18h1.8v-1.85A1.7 1.7 0 0 0 12 13z" />',
  help: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /> <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.7-2.7 2.7" stroke="#171236" stroke-width="2.4" /> <path d="M12 17.2h.01" stroke="#171236" stroke-width="3" />',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 20): string {
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
