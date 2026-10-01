// Map rendering (three.js). Port of the original BaboViolent 2 map visuals:
//   - MapRender.cpp  Map::buildAll / buildGround / buildGroundLayer / buildShadow / buildWalls /
//                    buildWallBlock / buildWallTop / buildWallSide, renderGround / renderShadow /
//                    renderWalls
//   - Map.cpp        Map::reloadTheme (textures), reloadWeather (fog values)
//   - GameRender.cpp Game::render (fog setup, reflection pass, render order)
//   - CMeshBuilder / CMaterial / CMesh (how the meshes were drawn)
//
// How the original draws the map (all of it UNLIT: every map CMaterial has lit=false, so the
// GL point light at (-1000,1000,2000) only affects babos / models):
//   1. [r_reflection && (weather == RAIN || theme == SNOW)] reflection pass: glScalef(1,1,-1),
//      a full-screen "sky" quad in fogColor (gameVar.tex_sky = main/textures/sky.tga doesn't exist
//      in the shipped game, so the quad is untextured), then the mirrored scene (flag pods,
//      players, projectiles, casings, walls, trails, particles), then glClear(DEPTH).
//   2. renderGround: depth writes OFF. Base layer = tex_floor_dirt (opaque, or alpha .6 when the
//      reflection is on), then the splat layer = tex_floor with alpha = 1 - dirt (per grid vertex).
//      UV = world * .5 (a texture covers 2x2 cells). Texture env = GL_MODULATE (tex * colour).
//   3. floor marks, drips, projectile shadows, flag pods, players, projectiles, casings.
//   4. renderShadow: fake wall shadows, black alpha .7 -> 0 triangles skewed toward +x/-y.
//   5. renderWalls: wall blocks (tex_wall_center, opaque) with per-side brightness, then the
//      floor quad written to the depth buffer only (so later particles are hidden under it).
//   6. trails, particles, weather, ...
//
// three.js mapping (see MAP_RENDER_ORDER): the reflection lives in `reflectionGroup` (a Group
// with a low renderOrder so it is drawn first in both passes). The ground splat layer writes depth
// (equivalent to step 5's depth-only floor quad since nothing drawn in between is below z = 0),
// and the fake shadows use a polygon offset to sit on it.
//
// Colour management is disabled project-wide (engine/renderer.ts), so vertex colours and texels
// multiply raw like fixed-function GL.

import * as THREE from 'three';
import { GameMap, THEME_SNOW, WEATHER_RAIN } from '../../sim/map';
import { loadTexture } from '../engine/textures';

/** Render settings, mirroring the original gameVar values (defaults = shipped main/bv2.cfg). */
export interface MapRenderOptions {
  /** gameVar.r_terrainSplater (default true): dirt/floor splatting. */
  terrainSplater?: boolean;
  /** gameVar.r_reflection (bv2.cfg: true): reflective ground on rain maps and the snow theme. */
  reflection?: boolean;
  /** gameVar.r_shadowQuality (default 2): 0 disables fake wall shadows and side shading. */
  shadowQuality?: number;
}

/**
 * renderOrder values used by the map (all inside MapRenderer.group, a THREE.Group with
 * renderOrder 0). Suggested use for other modules, to keep the original draw order:
 *   - floor decals (floor marks, drips, babo / projectile shadows, bomb marks): between
 *     GROUND_SPLAT and SHADOW, e.g. -950, with depthWrite false and z >= .025 like the original;
 *   - babos / models: opaque, default 0;
 *   - trails, particles, weather: transparent, default 0 (after SHADOW).
 */
export const MAP_RENDER_ORDER = {
  /** reflectionGroup (a THREE.Group: sets the group order of everything inside it). */
  REFLECTION: -2000,
  /** Inside reflectionGroup: the sky quad, before the mirrored objects (which use 0). */
  REFLECTION_SKY: -1,
  /** Ground base layer (tex_floor_dirt). */
  GROUND_BASE: -1001,
  /** Ground splat layer (tex_floor, alpha = 1 - dirt). Writes the floor depth. */
  GROUND_SPLAT: -1000,
  /** Fake wall shadows. */
  SHADOW: -900,
  /** Walls (opaque pass). */
  WALLS: 0,
} as const;

// ---------------------------------------------------------------------------------------------
// CMeshBuilder port: accumulates triangles with a current colour, like the original builder.
// ---------------------------------------------------------------------------------------------

class MeshBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  private col: [number, number, number, number] = [1, 1, 1, 1];

  constructor(private readonly withAlpha: boolean) {}

  /** CMeshBuilder::colour */
  colour(r: number, g: number, b: number, a = 1): void {
    this.col = [r, g, b, a];
  }

  /** CMeshBuilder::vertex (every 3 vertices form a triangle; GL_TRIANGLES). */
  vertex(x: number, y: number, z: number, u = 0, v = 0): void {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    if (this.withAlpha) this.colors.push(this.col[0], this.col[1], this.col[2], this.col[3]);
    else this.colors.push(this.col[0], this.col[1], this.col[2]);
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** CMeshBuilder::compile */
  compile(textured: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (textured) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, this.withAlpha ? 4 : 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

type Vert = [number, number, number];

// ---------------------------------------------------------------------------------------------
// MapRenderer
// ---------------------------------------------------------------------------------------------

export class MapRenderer {
  readonly group = new THREE.Group();
  /**
   * Mirror (scale z = -1) drawn before everything else, only populated when `reflection` is true.
   * The original also mirrors flag pods, players, projectiles, casings, trails and particles:
   * add clones of those here to get the full effect (three flips their face culling itself).
   */
  readonly reflectionGroup = new THREE.Group();
  /** True when the reflection pass is active for this map (Game::render condition). */
  readonly reflection: boolean;

  private readonly opts: Required<MapRenderOptions>;
  private readonly texFloor: THREE.Texture; // tex_grass (tex_floor.tga)
  private readonly texFloorDirt: THREE.Texture; // tex_dirt (tex_floor_dirt.tga)
  private readonly texWall: THREE.Texture; // tex_wall (tex_wall_center.tga)

  private groundBase?: THREE.Mesh;
  private groundSplat?: THREE.Mesh;
  private shadowMesh?: THREE.Mesh;
  private wallMesh?: THREE.Mesh;
  private wallMirror?: THREE.Mesh;
  private skyMesh?: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private lastDirtRevision = -1;

  constructor(
    readonly map: GameMap,
    options: MapRenderOptions = {},
  ) {
    this.opts = {
      terrainSplater: options.terrainSplater ?? true,
      reflection: options.reflection ?? true,
      shadowQuality: options.shadowQuality ?? 2,
    };
    this.group.name = `map:${map.name}`;

    // Map::reloadTheme — themed textures (map.themeName already falls back to "grass").
    const theme = map.themeName;
    this.texFloor = loadTexture(`main/textures/themes/${theme}/tex_floor.tga`);
    this.texFloorDirt = loadTexture(`main/textures/themes/${theme}/tex_floor_dirt.tga`);
    this.texWall = loadTexture(`main/textures/themes/${theme}/tex_wall_center.tga`);

    // Game::render: if (gameVar.r_reflection && (map->weather == WEATHER_RAIN || map->theme == THEME_SNOW))
    this.reflection = this.opts.reflection && (map.weather === WEATHER_RAIN || map.theme === THEME_SNOW);

    this.reflectionGroup.name = 'map-reflection';
    this.reflectionGroup.scale.set(1, 1, -1); // glScalef(1,1,-1)
    this.reflectionGroup.renderOrder = MAP_RENDER_ORDER.REFLECTION;
    this.reflectionGroup.visible = this.reflection;
    this.group.add(this.reflectionGroup);

    this.buildAll();
  }

  /** Map::buildAll */
  private buildAll(): void {
    this.buildGround();
    this.buildShadow();
    this.buildWalls();
    if (this.reflection) this.buildReflection();
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  // -------------------------------------------------------------------------------------------
  // Ground (Map::buildGround / buildGroundLayer / renderGround)
  // -------------------------------------------------------------------------------------------

  /** Map::buildGroundLayer — 2 triangles per cell, uv = world * .5, alpha = 1 - splater if splat. */
  private buildGroundLayer(builder: MeshBuilder, splat: boolean): void {
    const { size, cells } = this.map;
    for (let j = 0; j < size[1]; ++j) {
      for (let i = 0; i < size[0]; ++i) {
        const x = i;
        const y = j;
        const s = cells[j * size[0] + i]!.splater;

        if (splat) builder.colour(1, 1, 1, 1 - s[0]);
        builder.vertex(x, y + 1, 0, x * 0.5, (y + 1) * 0.5);
        if (splat) builder.colour(1, 1, 1, 1 - s[1]);
        builder.vertex(x, y, 0, x * 0.5, y * 0.5);
        if (splat) builder.colour(1, 1, 1, 1 - s[2]);
        builder.vertex(x + 1, y, 0, (x + 1) * 0.5, y * 0.5);

        if (splat) builder.colour(1, 1, 1, 1 - s[2]);
        builder.vertex(x + 1, y, 0, (x + 1) * 0.5, y * 0.5);
        if (splat) builder.colour(1, 1, 1, 1 - s[3]);
        builder.vertex(x + 1, y + 1, 0, (x + 1) * 0.5, (y + 1) * 0.5);
        if (splat) builder.colour(1, 1, 1, 1 - s[0]);
        builder.vertex(x, y + 1, 0, x * 0.5, (y + 1) * 0.5);
      }
    }
  }

  /** Map::buildGround */
  private buildGround(): void {
    const reflect = this.reflection;
    if (this.opts.terrainSplater) {
      //--- Base texture (tex_dirt). With reflections: blended version, colour (1,1,1,.6).
      const base = new MeshBuilder(true);
      if (reflect) base.colour(1, 1, 1, 0.6);
      this.buildGroundLayer(base, false);
      const baseMat = this.track(
        new THREE.MeshBasicMaterial({
          map: this.texFloorDirt,
          vertexColors: true,
          transparent: reflect, // CMaterial::BLEND_ALPHA only for base_weather
          depthWrite: false, // renderGround: glDepthMask(GL_FALSE)
        }),
      );
      this.groundBase = new THREE.Mesh(this.track(base.compile(true)), baseMat);
      this.groundBase.name = 'map-ground-base';
      this.groundBase.renderOrder = MAP_RENDER_ORDER.GROUND_BASE;
      this.group.add(this.groundBase);

      //--- Splat (tex_grass, BLEND_ALPHA, alpha = 1 - dirt)
      const splat = new MeshBuilder(true);
      this.buildGroundLayer(splat, true);
      this.groundSplat = new THREE.Mesh(
        this.track(splat.compile(true)),
        this.track(
          new THREE.MeshBasicMaterial({
            map: this.texFloor,
            vertexColors: true,
            transparent: true,
            // Stands in for renderWalls' depth-only floor quad (see file header).
            depthWrite: true,
          }),
        ),
      );
      this.groundSplat.name = 'map-ground-splat';
      this.groundSplat.renderOrder = MAP_RENDER_ORDER.GROUND_SPLAT;
      this.group.add(this.groundSplat);
    } else {
      //--- No splatting, just render splat texture
      const b = new MeshBuilder(true);
      this.buildGroundLayer(b, false);
      this.groundSplat = new THREE.Mesh(
        this.track(b.compile(true)),
        this.track(new THREE.MeshBasicMaterial({ map: this.texFloor, vertexColors: true, transparent: true, depthWrite: true })),
      );
      this.groundSplat.name = 'map-ground';
      this.groundSplat.renderOrder = MAP_RENDER_ORDER.GROUND_SPLAT;
      this.group.add(this.groundSplat);
    }
    this.lastDirtRevision = this.map.dirtRevision;
  }

  /**
   * Refreshes the splat layer alpha from the map's current dirt (after set/add/removeTileDirt).
   * Only rewrites one colour attribute; skipped when map.dirtRevision didn't change.
   */
  refreshDirt(): void {
    if (this.map.dirtRevision === this.lastDirtRevision) return;
    this.lastDirtRevision = this.map.dirtRevision;
    if (!this.opts.terrainSplater || !this.groundSplat) return;
    const attr = this.groundSplat.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const { size, cells } = this.map;
    // Same vertex order as buildGroundLayer: corners 0,1,2,2,3,0.
    const order = [0, 1, 2, 2, 3, 0];
    let o = 3; // alpha component of the first vertex (RGBA)
    for (let c = 0, n = size[0] * size[1]; c < n; ++c) {
      const s = cells[c]!.splater;
      for (let k = 0; k < 6; ++k) {
        arr[o] = 1 - s[order[k]!]!;
        o += 4;
      }
    }
    attr.needsUpdate = true;
  }

  // -------------------------------------------------------------------------------------------
  // Fake wall shadows (Map::buildShadow / renderShadow)
  // -------------------------------------------------------------------------------------------

  private buildShadow(): void {
    if (this.opts.shadowQuality === 0) return; // renderShadow: if (r_shadowQuality == 0) return;
    const { size, cells } = this.map;
    const w = size[0];
    const b = new MeshBuilder(true);

    for (let j = 1; j < size[1]; ++j) {
      for (let i = 0; i < size[0] - 1; ++i) {
        if (!cells[j * w + i]!.passable) {
          if (cells[(j - 1) * w + i]!.passable) {
            b.colour(0, 0, 0, 0.7);
            b.vertex(i + 1, j, 0);
            b.vertex(i, j, 0);
            b.colour(0, 0, 0, 0);
            b.vertex(i + 1, j - 1, 0);

            b.vertex(i + 1, j - 1, 0);
            b.vertex(i + 2, j - 1, 0);
            b.colour(0, 0, 0, 0.7);
            b.vertex(i + 1, j, 0);
          }

          if (cells[j * w + i + 1]!.passable) {
            b.colour(0, 0, 0, 0.7);
            b.vertex(i + 1, j + 1, 0);
            b.vertex(i + 1, j, 0);
            b.colour(0, 0, 0, 0);
            b.vertex(i + 2, j - 1, 0);

            b.vertex(i + 2, j - 1, 0);
            b.vertex(i + 2, j, 0);
            b.colour(0, 0, 0, 0.7);
            b.vertex(i + 1, j + 1, 0);
          }
        }
      }
    }
    if (b.vertexCount === 0) return;

    // CMaterial shadow(no_texture, BLEND_ALPHA, diffuse)
    const mat = this.track(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true, // sits on the splat layer's depth (drawn after it at z = 0)
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    this.shadowMesh = new THREE.Mesh(this.track(b.compile(false)), mat);
    this.shadowMesh.name = 'map-shadow';
    this.shadowMesh.renderOrder = MAP_RENDER_ORDER.SHADOW;
    this.group.add(this.shadowMesh);
  }

  // -------------------------------------------------------------------------------------------
  // Walls (Map::buildWalls / buildWallBlock / buildWallTop / buildWallSide / renderWalls)
  // -------------------------------------------------------------------------------------------

  private buildWalls(): void {
    const { size, cells } = this.map;
    const b = new MeshBuilder(false);
    for (let j = 0; j < size[1]; ++j) {
      for (let i = 0; i < size[0]; ++i) {
        const c = cells[j * size[0] + i]!;
        if (!c.passable) this.buildWallBlock(b, i, j, c.height);
      }
    }
    if (b.vertexCount === 0) return;

    // CMaterial wall(tex_wall, BLEND_NONE, diffuse) — unlit.
    const mat = this.track(new THREE.MeshBasicMaterial({ map: this.texWall, vertexColors: true }));
    this.wallMesh = new THREE.Mesh(this.track(b.compile(true)), mat);
    this.wallMesh.name = 'map-walls';
    this.wallMesh.renderOrder = MAP_RENDER_ORDER.WALLS;
    this.group.add(this.wallMesh);
  }

  /** Map::buildWallBlock */
  private buildWallBlock(builder: MeshBuilder, x: number, y: number, h: number): void {
    const { size, cells } = this.map;
    const w = size[0];
    const fx = x;
    const fy = y;
    const fh = h;

    // the block's corners...
    const corner000: Vert = [fx, fy, 0];
    const corner001: Vert = [fx, fy, fh];
    const corner010: Vert = [fx, fy + 1, 0];
    const corner011: Vert = [fx, fy + 1, fh];
    const corner100: Vert = [fx + 1, fy, 0];
    const corner101: Vert = [fx + 1, fy, fh];
    const corner110: Vert = [fx + 1, fy + 1, 0];
    const corner111: Vert = [fx + 1, fy + 1, fh];

    let shadowL = 1.0;
    let shadowR = 1.0;
    let shadowT = 1.0;
    let shadowB = 1.0;
    if (this.opts.shadowQuality > 0) {
      shadowL = 0.8;
      shadowR = 0.4;
      shadowT = 0.7;
      shadowB = 0.35;
    }

    const self = cells[y * w + x]!;
    const cellTop = y + 1 < size[1] ? cells[(y + 1) * w + x] : undefined;
    const cellLeft = x - 1 >= 0 ? cells[y * w + x - 1] : undefined;
    const cellDiag = y + 1 < size[1] && x - 1 >= 0 ? cells[(y + 1) * w + x - 1] : undefined;
    const bTop = cellTop && !cellTop.passable ? cellTop.height > self.height : false;
    const bLeft = cellLeft && !cellLeft.passable ? cellLeft.height > self.height : false;
    const bDiag = cellDiag && !cellDiag.passable ? cellDiag.height > self.height : false;

    // top of wall
    this.buildWallTop(builder, corner001, corner101, corner111, corner011, bTop, bLeft, bDiag);

    // bottom wall side if visible
    if (y !== 0 && (cells[(y - 1) * w + x]!.passable || cells[(y - 1) * w + x]!.height < h))
      this.buildWallSide(builder, corner000, corner100, corner101, corner001, shadowB, fh);

    // right wall side if visible
    if (x < size[0] - 1 && (cells[y * w + (x + 1)]!.passable || cells[y * w + (x + 1)]!.height < h))
      this.buildWallSide(builder, corner100, corner110, corner111, corner101, shadowR, fh);

    // top wall side if visible
    if (y < size[1] - 1 && (cells[(y + 1) * w + x]!.passable || cells[(y + 1) * w + x]!.height < h))
      this.buildWallSide(builder, corner110, corner010, corner011, corner111, shadowT, fh);

    // left wall side if visible
    if (x !== 0 && (cells[y * w + (x - 1)]!.passable || cells[y * w + (x - 1)]!.height < h))
      this.buildWallSide(builder, corner010, corner000, corner001, corner011, shadowL, fh);
  }

  /** Map::buildWallTop — darkens (s = .4) the corners next to taller neighbours (left/top/diag). */
  private buildWallTop(b: MeshBuilder, vert1: Vert, vert2: Vert, vert3: Vert, vert4: Vert, top: boolean, left: boolean, diag: boolean): void {
    const s = 0.4;
    b.colour(1, 1, 1);

    if (left || diag) b.colour(s, s, s);
    b.vertex(vert4[0], vert4[1], vert4[2], 0, 1);
    if (!left && diag) b.colour(1, 1, 1);
    b.vertex(vert1[0], vert1[1], vert1[2], 0, 0);
    b.colour(1, 1, 1);
    b.vertex(vert2[0], vert2[1], vert2[2], 1, 0);

    if (top) b.colour(s, s, s);
    b.vertex(vert3[0], vert3[1], vert3[2], 1, 1);
    if (!top && diag) b.colour(s, s, s);
    b.vertex(vert4[0], vert4[1], vert4[2], 0, 1);
    b.colour(1, 1, 1);
    b.vertex(vert2[0], vert2[1], vert2[2], 1, 0);
  }

  /** Map::buildWallSide — one quad, texture repeated h times vertically. */
  private buildWallSide(b: MeshBuilder, vert1: Vert, vert2: Vert, vert3: Vert, vert4: Vert, brightness: number, h: number): void {
    b.colour(brightness, brightness, brightness);

    b.vertex(vert4[0], vert4[1], vert4[2], 0, h);
    b.vertex(vert1[0], vert1[1], vert1[2], 0, 0);
    b.vertex(vert2[0], vert2[1], vert2[2], 1, 0);

    b.vertex(vert3[0], vert3[1], vert3[2], 1, h);
    b.vertex(vert4[0], vert4[1], vert4[2], 0, h);
    b.vertex(vert2[0], vert2[1], vert2[2], 1, 0);
  }

  // -------------------------------------------------------------------------------------------
  // Reflection pass (GameRender.cpp, non-dko_map branch)
  // -------------------------------------------------------------------------------------------

  private buildReflection(): void {
    //--- Sky: glColor3fv(map->fogColor); renderTexturedQuad(0,0,10,10,tex_sky) in a 10x10 ortho
    // (dkglPushOrtho disables depth test). tex_sky is missing in the game data -> flat colour.
    const [r, g, b] = this.map.fogColor;
    const skyMat = this.track(
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Vector3(r, g, b) } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }',
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.skyMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2, 2)), skyMat);
    this.skyMesh.name = 'map-reflection-sky';
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = MAP_RENDER_ORDER.REFLECTION_SKY;
    this.reflectionGroup.add(this.skyMesh);

    //--- Mirrored walls (glCullFace(GL_FRONT) is automatic in three for mirrored objects)
    if (this.wallMesh) {
      this.wallMirror = new THREE.Mesh(this.wallMesh.geometry, this.wallMesh.material);
      this.wallMirror.name = 'map-reflection-walls';
      this.reflectionGroup.add(this.wallMirror);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /**
   * Per-frame update. The map itself has no animated visuals in the original (CLava only plays
   * main/sounds/lava.wav; the rain/snow particles belong to CRain/CSnow — not ported here).
   * Refreshes the ground if the map's dirt changed.
   */
  update(_delay: number): void {
    this.refreshDirt();
  }

  /**
   * Fog like Game::render: GL_LINEAR fog from (camPos.z - fogStart) to (camPos.z - fogEnd), only
   * when map.fogDensity > 0. The original's reloadWeather always leaves fogDensity at 0, so this
   * normally clears scene.fog (faithful: the game never showed fog).
   */
  applyFog(scene: THREE.Scene, cameraHeight: number): void {
    const m = this.map;
    if (m.fogDensity > 0) {
      const color = new THREE.Color(m.fogColor[0], m.fogColor[1], m.fogColor[2]);
      const near = cameraHeight - m.fogStart;
      const far = cameraHeight - m.fogEnd;
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.copy(color);
        scene.fog.near = near;
        scene.fog.far = far;
      } else {
        scene.fog = new THREE.Fog(color, near, far);
      }
    } else if (scene.fog) {
      scene.fog = null;
    }
  }

  /** Removes the map from its parent and frees its GPU resources (textures stay cached). */
  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
