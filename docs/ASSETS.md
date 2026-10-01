# Assets: where the game data comes from

`public/assets/` holds two kinds of files.

## Original Babo Violent 2 content (GPL v3)

The sounds, the music and the maps are the original game's. David St-Louis ("Daivuk"), one of
the game's creators at RndLabs, published the whole content folder (models, textures, sounds,
music, maps) in the game's source code repository,
[github.com/Daivuk/BaboViolent2](https://github.com/Daivuk/BaboViolent2): commit `a6596d1`
("Merged Engine + Added content", 2012-12-07), two days after adding the GNU GPL v3 as the
repository's license (`LICENSE.txt`, commit `35f1b42`). Mad Orbs uses these files under the GPL v3.

`public/assets/ORIGINAL-LICENSE.txt` is the end-user license that shipped with the 2006 freeware
game (personal use only). It is part of the content folder as published. Until 2026-09-30 the
project took it as the license of the files and started replacing them (next section); on
2026-10-01 the GPL release above was found and the original sounds came back.

Obligations that come with the GPL v3, for the whole game (its code is derived from the GPL code
too): players must be able to get the source code of what they receive, and the license notices
stay with the files (`public/assets/NOTICE.txt`, this page). The game that runs in the browser is
published at [github.com/ErickOliveira12eng/MadOrbs](https://github.com/ErickOliveira12eng/MadOrbs),
with the full GPL v3 text in `LICENSE`. The online game server only runs on madorbs.com's machine
and is never distributed, so it is not part of that repository.

## Files made for Mad Orbs

Made while the old license was taken as binding, with the same formats, names and look as the
originals so the game code didn't change. They stay in use. Each group is rebuilt by a script in
`tools/assets/` (plain Node or `tsx`, no dependencies).

| Group | Files | Source |
|---|---|---|
| Orb skins | `skins/skin01..23.tga` (23) | `node tools/assets/make-skins.mjs` (drawn by code) |
| Effect textures | `textures/` Smoke1, Smoke2, shotGlow, nuzzleFlash, BaboShadow, BaboHalo, snowflake, screenHit, blood01..10, ExplosionMark, drip, glowTrail (21) | `node tools/assets/make-effects.mjs` |
| HUD pictures | `textures/` GrenadeIcon, molotovIcon, BlueFlag, RedFlag | `node tools/assets/make-effects.mjs` |
| Map themes | `textures/themes/*/tex_floor, tex_floor_dirt, tex_wall_center.tga` (23 x 3) | `node tools/assets/make-themes.mjs` (procedural materials tuned to each original theme's colour and contrast) |
| 3D models | `models/*.DKO` (24) + `Knife.tga`, `Shieldtga.tga` | `npx tsx tools/assets/make-models.ts` (modelling kit + DKO writer; muzzle and shell dummies from `src/sim/weaponDummies.ts`) |

The sound effects were synthesized too for a while, but they sounded dated, so the originals were
restored.

## Current status

| Group | Files | In use |
|---|---|---|
| Orb skins, effect textures, HUD pictures, map themes, 3D models | see above | made for Mad Orbs |
| Sounds | `sounds/*.wav`, `Siren.WAV` (47) | original (GPL v3) |
| Music | `sounds/Menu.ogg`, `sounds/Music.ogg` | original (GPL v3); AI-made tracks from Erick may replace them |
| Maps | `maps/*.bvm` (81) | original (GPL v3) |

Deleted because the remake doesn't use them (old menus, medals, arrows, cursors, the original
company's logo, the bitmap font, `Bomb.DKO`, `FlagPole.DKO`, `ControlOver.wav`...): 43 files.

The start screen background (`public/menu-bg.webp`, `tools/make-menu-bg.mjs`) and the link preview
(`public/og-image.jpg`, `tools/make-og-image.mjs`) are rendered by the game; rerun those tools when
the skins, textures or models change (they live in the private repository with the other
browser-driven tools).
