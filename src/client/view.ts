// Shape of the game view. Every player sees the same area of the map, whatever the screen: the
// view keeps this aspect ratio and the rest of the window gets black bars. The original was 4:3
// (r_widescreen 2); the remake shows a wider slice of the map.
export const VIEW_ASPECT = 16 / 9;

/** The original's aspect ratio: the camera limits and the HUD layout were made for it. */
export const ORIGINAL_ASPECT = 4 / 3;

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The largest VIEW_ASPECT rectangle centred in a w x h window (CSS pixels). */
export function fitView(w: number, h: number): ViewRect {
  const vw = Math.min(w, h * VIEW_ASPECT);
  const vh = Math.min(h, w / VIEW_ASPECT);
  return { x: (w - vw) / 2, y: (h - vh) / 2, w: vw, h: vh };
}
