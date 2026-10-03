# Assets: where the game data comes from

Everything in `public/assets/` (models, textures, orb skins, sounds, music, maps) is original
Babo Violent 2 content, except the announcer's voice (`sounds/announcer/`, below).

## Announcer voice (CC BY-SA 4.0)

`public/assets/sounds/announcer/` is the
[WARLORD Announcer Audio Pack](https://voicebosch.itch.io/warlord-announcer-audio-pack) by
**VoiceBosch** (part of the SoundBiter SFX library), released under
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
("Preferred Attribution: VoiceBosch"). Seven of its 29 lines are used (Start, Double Kill, Triple
Kill, Dominating, Unstoppable, First Blood, Revenge Kill); the files were only renamed (the list is in `LICENSE.txt` next to them). What the license asks:
credit (VoiceBosch, the pack, its link, the license; in this file, in `public/assets/NOTICE.txt`
and in the Terms of use, "Source code and license"), and that edited versions of these sounds be
shared under CC BY-SA 4.0 too. Edit a file? Say so in `LICENSE.txt`.

## Original Babo Violent 2 content (GPL v3)

David St-Louis ("Daivuk"), one of the game's creators at RndLabs, published the whole content
folder (models, textures, sounds, music, maps) in the game's source code repository,
[github.com/Daivuk/BaboViolent2](https://github.com/Daivuk/BaboViolent2): commit `a6596d1`
("Merged Engine + Added content", 2012-12-07), two days after adding the GNU GPL v3 as the
repository's license (`LICENSE.txt`, commit `35f1b42`). Mad Orbs uses these files under the GPL v3.

`public/assets/ORIGINAL-LICENSE.txt` is the end-user license that shipped with the 2006 freeware
game (personal use only). It is part of the content folder as published.

Obligations that come with the GPL v3, for the whole game (its code is derived from the GPL code
too): players must be able to get the source code of what they receive, and the license notices
stay with the files (`public/assets/NOTICE.txt`, this page). The game that runs in the browser is
published at [github.com/ErickOliveira12eng/MadOrbs](https://github.com/ErickOliveira12eng/MadOrbs),
with the full GPL v3 text in `LICENSE`. The online game server only runs on madorbs.com's machine
and is never distributed, so it is not part of that repository.

## Changes

- `models/LifePack.DKO`: the cross is green (material "02 - Default", ambient and diffuse colour)
  instead of red. A red cross on white is the Red Cross emblem, protected by the Geneva Conventions
  and national laws; the Red Cross asks games not to use it.
- `skins/skin16.tga`: the original company's name ("RndLabs") replaced with "MAD ORBS", in the
  same pixel lettering (2 px strokes, 18 rows, blue on red, between the same green octagons).
- Files of the original folder that the game doesn't use (old menus, medals, arrows, cursors, the
  original company's logo, the bitmap font, `Bomb.DKO`, `FlagPole.DKO`, `ControlOver.wav`...) were
  deleted: 43 files.

## History

From 2026-09-30 to 2026-10-02 the project took `ORIGINAL-LICENSE.txt` as the license of the files
and replaced the orb skins, effect textures, HUD pictures, map theme textures, 3D models and sounds
with new ones made by scripts (`tools/assets/`, commits `bc90a15`, `ee4292e`, `45d1aea`,
`6ae489d`, `e1ed2ab`). On 2026-10-01 the GPL release above was found: the sounds came back that
day and everything else on 2026-10-02 (the scripts were removed then; they are in the git history).

The start screen background (`public/menu-bg.webp`, `tools/make-menu-bg.mjs`), the link previews
(`public/og-image*.jpg`, `tools/make-og-image.mjs`) and the guide pages' pictures
(`public/guia/`, `tools/make-guide.mjs`) are rendered by the game; rerun those tools when the
models or textures change (they live in the private repository with the other browser-driven tools).
