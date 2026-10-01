// DKO ("duk object") model loader + renderer.
// Port of the original engine library Engine/dko/Code/* (dko.cpp, CdkoModel.cpp, CdkoMesh.cpp,
// CdkoMaterial.cpp, eHierarchic.cpp, "DKO Chunk Info.txt") and its public API (dko.h).
//
// File format (little endian, no chunk lengths — every chunk is parsed by its ID):
//   chunk ID = int16. A block ends with CHUNK_DKO_END (0x0900).
//   The whole file is a block: VERSION, TIME_INFO {start, end, duration}, PROPERTIES,
//   MATLIST, TRI_MESH*, DUMMY*, END.
//   Every TRI_MESH holds material groups; a material group is a plain triangle list
//   (GL_TRIANGLES, nbVertex vertices, no index buffer) with one vertex/normal array per frame
//   (TIME_INFO duration = number of frames) and one UV array (or one per frame if animated).
//
// Units / axes (observed on the BV2 assets): models are exported from 3D Studio in their own
// units and are Z-up like the game world. The game scales them itself, e.g. weapons with
// glScalef(.005f) (babo radius .25 = 50 model units), rockets/grenades with .0025f, the 3D map
// with .1f. Weapons point their barrel along +Y (the babo's facing direction; Player.cpp rotates
// by currentCF.angle about Z), the grip is near the origin. See tools/test-dko.ts output for
// per-model bounding boxes.
//
// Rendering (createDkoObject3D) reproduces dkoRender() -> CdkoMesh::drawIt() ->
// CdkoMaterial::setDiffusePass() with fixed-function-like lighting on top of MeshPhongMaterial.
import * as THREE from 'three';
import { Vec3 } from '../../sim/vec';
import { assetUrl, loadTexture } from './textures';

// --- Chunk IDs (CdkoModel.h / "DKO Chunk Info.txt") ---
export const DKO_VERSION = 0x0002;

export const CHUNK_DKO_VERSION = 0x0000; // short
export const CHUNK_DKO_TIME_INFO = 0x0001; // short[3]

export const CHUNK_DKO_PROPERTIES = 0x0100; // ...
export const CHUNK_DKO_NAME = 0x0110; // char*
export const CHUNK_DKO_POSITION = 0x0120; // float[3]
export const CHUNK_DKO_MATRIX = 0x0130; // float[9]

export const CHUNK_DKO_MATLIST = 0x0200; // short (nb de material)
export const CHUNK_DKO_MATNAME = 0x0210; // char*
export const CHUNK_DKO_TEX_DKT = 0x0220; // char*
export const CHUNK_DKO_AMBIENT = 0x0230; // float[4]
export const CHUNK_DKO_DIFFUSE = 0x0240; // float[4]
export const CHUNK_DKO_SPECULAR = 0x0250; // float[4]
export const CHUNK_DKO_EMISSIVE = 0x0260; // float[4]
export const CHUNK_DKO_SHININESS = 0x0270; // short
export const CHUNK_DKO_TRANSPARENCY = 0x0280; // float
export const CHUNK_DKO_TWO_SIDED = 0x0290; // char
export const CHUNK_DKO_WIRE_FRAME = 0x02a0; // char
export const CHUNK_DKO_WIRE_WIDTH = 0x02b0; // float
export const CHUNK_DKO_TEX_DIFFUSE = 0x02c0; // char*
export const CHUNK_DKO_TEX_BUMP = 0x02d0; // char*
export const CHUNK_DKO_TEX_SPECULAR = 0x02e0; // char*
export const CHUNK_DKO_TEX_SELFILL = 0x02f0; // char*

export const CHUNK_DKO_TRI_MESH = 0x0300; // ...
export const CHUNK_DKO_NB_MAT_GROUP = 0x0340; // short
export const CHUNK_DKO_MAT_ID = 0x0341; // short
export const CHUNK_DKO_NB_VERTEX = 0x0342; // long
export const CHUNK_DKO_VERTEX_ARRAY = 0x0343; // float* x NbFrame
export const CHUNK_DKO_NORMAL_ARRAY = 0x0344; // float* x NbFrame
export const CHUNK_DKO_TEXCOORD_ARRAY = 0x0345; // float*
export const CHUNK_DKO_TEXCOORD_ARRAY_ANIM = 0x0346; // float* x NbFrame

export const CHUNK_DKO_DUMMY = 0x0400;

export const CHUNK_DKO_END = 0x0900;

// --- Data (CdkoMaterial, _typMatGroup, CdkoMesh, _typDummy, CDkoModel) ---

export type Color4 = [number, number, number, number];
/** 3x3 matrix as stored by the exporter: [right(0..2), front(3..5), up(6..8)] (CMatrix3x3f layout). */
export type Mat9 = number[];

/** CdkoMaterial */
export interface DkoMaterial {
  matName: string;
  /** Texture file names as stored in the file (relative to the .DKO's folder). */
  texDktFile: string | null; // CHUNK_DKO_TEX_DKT (ePTexture .dkt material, unused by BV2 assets)
  texDiffuseFile: string | null;
  texBumpFile: string | null;
  texSpecularFile: string | null;
  texSelfIllFile: string | null;
  /** Same, resolved like the original: `path + filename` where path is the .DKO's folder. */
  texDkt: string | null;
  texDiffuse: string | null;
  texBump: string | null;
  texSpecular: string | null;
  texSelfIll: string | null;
  ambient: Color4;
  diffuse: Color4;
  specular: Color4;
  emissive: Color4;
  /** GL_SHININESS (0..128). */
  shininess: number;
  /** Loaded but never used by the original renderer. */
  transparency: number;
  twoSided: boolean;
  wire: boolean;
  wireSize: number;
}

/** _typMeshAtFrame */
export interface DkoMeshAtFrame {
  vertexArray: Float32Array | null; // nbVertex * 3
  normalArray: Float32Array | null; // nbVertex * 3
  texCoordArray: Float32Array | null; // nbVertex * 2 (only frame 0 unless animatedUV)
}

/** _typMatGroup: one triangle list drawn with one material. */
export interface DkoMatGroup {
  /** Index into DkoModel.materials (CHUNK_DKO_MAT_ID), -1 if none. */
  matId: number;
  material: DkoMaterial | null;
  nbVertex: number;
  /** One entry per frame (length = DkoModel.timeInfo[2]). */
  meshAtFrame: DkoMeshAtFrame[];
  animatedUV: boolean;
}

/** CdkoMesh */
export interface DkoMesh {
  name: string;
  /** eHierarchic::position / matrix: vertex' = right*x + front*y + up*z + position. */
  position: [number, number, number];
  matrix: Mat9;
  matGroups: DkoMatGroup[];
}

/** _typDummy: a named helper point (muzzle flash, casing ejection, camera, flag tip...). */
export interface DkoDummy {
  name: string;
  /** One position per frame. */
  position: Vec3[];
  /** One 3x3 matrix per frame, [right, front, up] (CMatrix3x3f layout, 9 floats). */
  matrix: Mat9[];
}

/** CDkoModel */
export interface DkoModel {
  sourcePath: string;
  /** Folder of sourcePath with trailing '/', prefix of texture paths (dkoLoadFile). */
  path: string;
  version: number;
  name: string;
  /** Model node transform (CHUNK_DKO_PROPERTIES); applied when rendering only, like drawAll(). */
  position: [number, number, number];
  matrix: Mat9;
  /** [start frame, end frame, duration (= number of frames)]. */
  timeInfo: [number, number, number];
  /** materialArray (stored in reverse file order, like the original). */
  materials: DkoMaterial[];
  meshes: DkoMesh[];
  dummies: DkoDummy[];
  /** Largest distance of a frame-0 vertex from the origin (model units). */
  radius: number;
  /** [center x,y,z, half size x,y,z] of frame 0 (model units). */
  OABB: [number, number, number, number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Number of triangles (the original's counter used nbVertex/2 by mistake; this is the real count). */
  nbFace: number;
  /** Unknown chunk IDs met while parsing (the original silently skips them the same way). */
  warnings: string[];
}

// --- Parsing ---

class Reader {
  private view: DataView;
  pos = 0;
  constructor(
    buffer: ArrayBuffer,
    private sourcePath: string,
  ) {
    this.view = new DataView(buffer);
  }
  private need(n: number): void {
    if (this.pos + n > this.view.byteLength) {
      throw new Error(`DKO ${this.sourcePath}: unexpected end of file at byte ${this.pos}`);
    }
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  floats(n: number): Float32Array {
    this.need(n * 4);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.view.getFloat32(this.pos + i * 4, true);
    this.pos += n * 4;
    return out;
  }
  /** readString(): NUL terminated. */
  string(): string {
    let s = '';
    for (;;) {
      const c = this.u8();
      if (c === 0) return s;
      s += String.fromCharCode(c);
    }
  }
  /** readChunk() */
  chunk(): number {
    return this.i16();
  }
}

function color4(r: Reader): Color4 {
  return [r.f32(), r.f32(), r.f32(), r.f32()];
}

function identity9(): Mat9 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function newMaterial(): DkoMaterial {
  // CdkoMaterial::CdkoMaterial()
  return {
    matName: '',
    texDktFile: null,
    texDiffuseFile: null,
    texBumpFile: null,
    texSpecularFile: null,
    texSelfIllFile: null,
    texDkt: null,
    texDiffuse: null,
    texBump: null,
    texSpecular: null,
    texSelfIll: null,
    ambient: [0, 0, 0, 1],
    diffuse: [1, 1, 1, 1],
    specular: [0, 0, 0, 1],
    emissive: [0, 0, 0, 1],
    shininess: 0,
    transparency: 0,
    twoSided: false,
    wire: false,
    wireSize: 1,
  };
}

function unknownChunk(model: DkoModel, where: string, id: number, r: Reader): void {
  model.warnings.push(`unknown chunk 0x${(id & 0xffff).toString(16).padStart(4, '0')} in ${where} at byte ${r.pos - 2}`);
}

/** CdkoMaterial::loadFromFile */
function loadMaterial(r: Reader, model: DkoModel): DkoMaterial {
  const mat = newMaterial();
  const resolve = (file: string) => model.path + file.replace(/\\/g, '/');
  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_MATNAME:
        mat.matName = r.string();
        break;
      case CHUNK_DKO_TEX_DKT:
        mat.texDktFile = r.string();
        mat.texDkt = resolve(mat.texDktFile);
        break;
      case CHUNK_DKO_TEX_DIFFUSE:
        mat.texDiffuseFile = r.string();
        mat.texDiffuse = resolve(mat.texDiffuseFile);
        break;
      case CHUNK_DKO_TEX_BUMP:
        mat.texBumpFile = r.string();
        mat.texBump = resolve(mat.texBumpFile);
        break;
      case CHUNK_DKO_TEX_SPECULAR:
        mat.texSpecularFile = r.string();
        mat.texSpecular = resolve(mat.texSpecularFile);
        break;
      case CHUNK_DKO_TEX_SELFILL:
        mat.texSelfIllFile = r.string();
        mat.texSelfIll = resolve(mat.texSelfIllFile);
        break;
      case CHUNK_DKO_AMBIENT:
        mat.ambient = color4(r);
        break;
      case CHUNK_DKO_DIFFUSE:
        mat.diffuse = color4(r);
        break;
      case CHUNK_DKO_SPECULAR:
        mat.specular = color4(r);
        break;
      case CHUNK_DKO_EMISSIVE:
        mat.emissive = color4(r);
        break;
      case CHUNK_DKO_SHININESS:
        mat.shininess = r.i16();
        break;
      case CHUNK_DKO_TRANSPARENCY:
        mat.transparency = r.f32();
        break;
      case CHUNK_DKO_TWO_SIDED:
        mat.twoSided = r.u8() !== 0;
        break;
      case CHUNK_DKO_WIRE_FRAME:
        mat.wire = r.u8() !== 0;
        break;
      case CHUNK_DKO_WIRE_WIDTH:
        mat.wireSize = r.f32();
        break;
      default:
        unknownChunk(model, 'material', chunkID, r);
    }
    chunkID = r.chunk();
  }
  return mat;
}

/** Mesh-local -> model space, like CdkoMesh (right*x + front*y + up*z + position). */
function transformPoint(mesh: DkoMesh, x: number, y: number, z: number, out: number[]): void {
  const m = mesh.matrix;
  const p = mesh.position;
  out[0] = m[0] * x + m[3] * y + m[6] * z + p[0];
  out[1] = m[1] * x + m[4] * y + m[7] * z + p[1];
  out[2] = m[2] * x + m[5] * y + m[8] * z + p[2];
}

interface ParseState {
  firstVertex: boolean;
}

/** CdkoMesh::loadMatGroup */
function loadMatGroup(r: Reader, model: DkoModel, mesh: DkoMesh, st: ParseState): DkoMatGroup {
  const duration = model.timeInfo[2];
  const group: DkoMatGroup = {
    matId: -1,
    material: null,
    nbVertex: 0,
    meshAtFrame: [],
    animatedUV: false,
  };
  for (let f = 0; f < duration; f++) group.meshAtFrame.push({ vertexArray: null, normalArray: null, texCoordArray: null });

  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_MAT_ID: {
        group.matId = r.i16();
        group.material = model.materials[group.matId] ?? null;
        break;
      }
      case CHUNK_DKO_NB_VERTEX:
        group.nbVertex = r.i32();
        break;
      case CHUNK_DKO_VERTEX_ARRAY: {
        for (let f = 0; f < duration; f++) group.meshAtFrame[f].vertexArray = r.floats(group.nbVertex * 3);
        // Original: owner->nbFace += nbVertex/2 (bug, allocation only). We keep the real count.
        model.nbFace += Math.floor(group.nbVertex / 3);
        // OABB + radius from frame 0, in model space (mesh matrix applied, model matrix not).
        const va = group.meshAtFrame[0].vertexArray!;
        const cur = [0, 0, 0];
        for (let i = 0; i < group.nbVertex; i++) {
          transformPoint(mesh, va[i * 3], va[i * 3 + 1], va[i * 3 + 2], cur);
          if (st.firstVertex) {
            model.min = [cur[0], cur[1], cur[2]];
            model.max = [cur[0], cur[1], cur[2]];
            st.firstVertex = false;
          }
          for (let j = 0; j < 3; j++) {
            if (model.min[j] > cur[j]) model.min[j] = cur[j];
            if (model.max[j] < cur[j]) model.max[j] = cur[j];
          }
          const dis = Math.sqrt(cur[0] * cur[0] + cur[1] * cur[1] + cur[2] * cur[2]);
          if (dis > model.radius) model.radius = dis;
        }
        break;
      }
      case CHUNK_DKO_NORMAL_ARRAY:
        for (let f = 0; f < duration; f++) group.meshAtFrame[f].normalArray = r.floats(group.nbVertex * 3);
        break;
      case CHUNK_DKO_TEXCOORD_ARRAY:
        group.animatedUV = false;
        group.meshAtFrame[0].texCoordArray = r.floats(group.nbVertex * 2);
        break;
      case CHUNK_DKO_TEXCOORD_ARRAY_ANIM:
        group.animatedUV = true;
        for (let f = 0; f < duration; f++) group.meshAtFrame[f].texCoordArray = r.floats(group.nbVertex * 2);
        break;
      default:
        unknownChunk(model, `mat group of mesh "${mesh.name}"`, chunkID, r);
    }
    chunkID = r.chunk();
  }
  return group;
}

/** CdkoMesh::loadFromFile */
function loadMesh(r: Reader, model: DkoModel, st: ParseState): DkoMesh {
  const mesh: DkoMesh = { name: '', position: [0, 0, 0], matrix: identity9(), matGroups: [] };
  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_NAME:
        mesh.name = r.string();
        break;
      case CHUNK_DKO_POSITION:
        mesh.position = [r.f32(), r.f32(), r.f32()];
        break;
      case CHUNK_DKO_MATRIX:
        mesh.matrix = Array.from(r.floats(9));
        break;
      case CHUNK_DKO_NB_MAT_GROUP: {
        const nbMatGroup = r.i16();
        mesh.matGroups = [];
        for (let i = 0; i < nbMatGroup; i++) mesh.matGroups.push(loadMatGroup(r, model, mesh, st));
        break;
      }
      default:
        unknownChunk(model, `mesh "${mesh.name}"`, chunkID, r);
    }
    chunkID = r.chunk();
  }
  return mesh;
}

/** CDkoModel::loadDummy */
function loadDummy(r: Reader, model: DkoModel): DkoDummy {
  const duration = model.timeInfo[2];
  const dum: DkoDummy = { name: '', position: [], matrix: [] };
  // _typDummy(duration) leaves the arrays uninitialized; we default to origin/identity.
  for (let i = 0; i < duration; i++) {
    dum.position.push(new Vec3());
    dum.matrix.push(identity9());
  }
  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_NAME:
        dum.name = r.string();
        break;
      case CHUNK_DKO_POSITION:
        for (let i = 0; i < duration; i++) dum.position[i] = new Vec3(r.f32(), r.f32(), r.f32());
        break;
      case CHUNK_DKO_MATRIX:
        for (let i = 0; i < duration; i++) dum.matrix[i] = Array.from(r.floats(9));
        break;
      default:
        unknownChunk(model, `dummy "${dum.name}"`, chunkID, r);
    }
    chunkID = r.chunk();
  }
  return dum;
}

/** CDkoModel::loadProperties */
function loadProperties(r: Reader, model: DkoModel): void {
  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_NAME:
        model.name = r.string();
        break;
      case CHUNK_DKO_POSITION:
        model.position = [r.f32(), r.f32(), r.f32()];
        break;
      case CHUNK_DKO_MATRIX:
        model.matrix = Array.from(r.floats(9));
        break;
      default:
        unknownChunk(model, 'properties', chunkID, r);
    }
    chunkID = r.chunk();
  }
}

/** Folder part of a path, with trailing '/' (dkoLoadFile: "On efface le string jusqu'au /"). */
function folderOf(path: string): string {
  const p = path.replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i + 1) : '';
}

/**
 * Parses a .DKO file (CDkoModel::loadFromFile). Pure: no three.js, no DOM.
 * `sourcePath` is used to resolve texture paths (same folder as the model) and in errors.
 */
export function parseDko(buffer: ArrayBuffer, sourcePath: string): DkoModel {
  const r = new Reader(buffer, sourcePath);
  const model: DkoModel = {
    sourcePath,
    path: folderOf(sourcePath),
    version: 0,
    name: '',
    position: [0, 0, 0],
    matrix: identity9(),
    timeInfo: [0, 0, 1],
    materials: [],
    meshes: [],
    dummies: [],
    radius: 0,
    OABB: [0, 0, 0, 0, 0, 0],
    min: [0, 0, 0],
    max: [0, 0, 0],
    nbFace: 0,
    warnings: [],
  };
  const st: ParseState = { firstVertex: true };

  let chunkID = r.chunk();
  while (chunkID !== CHUNK_DKO_END) {
    switch (chunkID) {
      case CHUNK_DKO_VERSION:
        model.version = r.i16();
        if (model.version > DKO_VERSION) throw new Error(`DKO ${sourcePath}: Incorrect version of file (${model.version})`);
        break;
      case CHUNK_DKO_TIME_INFO:
        model.timeInfo = [r.i16(), r.i16(), r.i16()];
        if (model.timeInfo[2] < 1) throw new Error(`DKO ${sourcePath}: invalid frame count ${model.timeInfo[2]}`);
        break;
      case CHUNK_DKO_PROPERTIES:
        loadProperties(r, model);
        break;
      case CHUNK_DKO_MATLIST: {
        const nbMat = r.i16();
        if (nbMat <= 0) throw new Error(`DKO ${sourcePath}: There is no material set in the file`);
        model.materials = new Array<DkoMaterial>(nbMat);
        // The original fills materialArray backward: materialArray[nbMat-i-1].
        for (let i = 0; i < nbMat; i++) model.materials[nbMat - i - 1] = loadMaterial(r, model);
        break;
      }
      case CHUNK_DKO_TRI_MESH:
        model.meshes.push(loadMesh(r, model, st));
        break;
      case CHUNK_DKO_DUMMY:
        model.dummies.push(loadDummy(r, model));
        break;
      default:
        unknownChunk(model, 'model', chunkID, r);
    }
    chunkID = r.chunk();
  }

  if (r.pos !== buffer.byteLength) model.warnings.push(`${buffer.byteLength - r.pos} trailing bytes after CHUNK_DKO_END`);

  // On calcul son OABB
  for (let i = 0; i < 3; i++) {
    model.OABB[i] = (model.max[i] + model.min[i]) / 2;
    model.OABB[3 + i] = (model.max[i] - model.min[i]) / 2;
  }
  return model;
}

// --- Loading (dkoLoadFile) ---

const modelCache = new Map<string, Promise<DkoModel>>();

/**
 * Fetches and parses a model, cached by URL. Accepts original-style paths
 * ("main/models/SMG.DKO") or served URLs ("/assets/models/SMG.DKO").
 */
export function loadDko(path: string): Promise<DkoModel> {
  const url = assetUrl(path);
  let p = modelCache.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`DKO ${url}: HTTP ${res.status}`);
      return parseDko(await res.arrayBuffer(), url);
    });
    p.catch(() => modelCache.delete(url));
    modelCache.set(url, p);
  }
  return p;
}

// --- Queries (dko.cpp) ---

/** dkoGetRadius */
export function dkoGetRadius(model: DkoModel): number {
  return model.radius;
}

/** dkoGetTotalFrame: number of frames (timeInfo[2]). */
export function dkoGetTotalFrame(model: DkoModel): number {
  return model.timeInfo[2];
}

/** dkoGetOABB: [center x,y,z, half size x,y,z]. */
export function dkoGetOABB(model: DkoModel): [number, number, number, number, number, number] {
  return [...model.OABB];
}

/** Frame index used by the dkoGetDummy*(..., short frameID) overloads. */
function dummyFrame(model: DkoModel, frame: number | undefined): number {
  if (frame === undefined) return 0;
  let f = Math.trunc(frame); // (short) cast in the callers
  if (f < 0) f = 0;
  if (f >= model.timeInfo[2]) f = f % model.timeInfo[2];
  return f;
}

function findDummy(model: DkoModel, name: string): DkoDummy | null {
  const lower = name.toLowerCase(); // stricmp
  for (const d of model.dummies) if (d.name.toLowerCase() === lower) return d;
  return null;
}

/** dkoGetDummy: 1-based dummy ID, 0 if not found (case-insensitive name). */
export function dkoGetDummy(model: DkoModel, name: string): number {
  const lower = name.toLowerCase();
  for (let i = 0; i < model.dummies.length; i++) if (model.dummies[i].name.toLowerCase() === lower) return i + 1;
  return 0;
}

/** dkoGetDummyName: name of the dummy at 0-based index, null past the end (used to enumerate). */
export function dkoGetDummyName(model: DkoModel, index: number): string | null {
  return model.dummies[index]?.name ?? null;
}

function dummyByRef(model: DkoModel, ref: string | number): DkoDummy | null {
  if (typeof ref === 'number') return ref >= 1 ? (model.dummies[ref - 1] ?? null) : null; // 1-based ID
  return findDummy(model, ref);
}

/**
 * dkoGetDummyPosition: dummy position (model units, model space) at `frame` (default 0;
 * negative -> 0, past the end wraps). `nameOrId` is a case-insensitive name or a 1-based ID.
 * Returns null where the original would leave `pos` untouched.
 */
export function dkoGetDummyPosition(model: DkoModel, nameOrId: string | number, frame?: number): Vec3 | null {
  const d = dummyByRef(model, nameOrId);
  return d ? d.position[dummyFrame(model, frame)].clone() : null;
}

/**
 * dkoGetDummyMatrix: the dummy's 3x3 rotation at `frame`, 9 floats in the original CMatrix3x3f
 * layout: [0..2] = right (X axis), [3..5] = front (Y axis), [6..8] = up (Z axis), so
 * `getRight() = m[0..2]`, `getFront() = m[3..5]`, `getUp() = m[6..8]`.
 * (The original only writes these 9 floats; use dkoGetDummyMatrix4 for a 4x4.)
 */
export function dkoGetDummyMatrix(model: DkoModel, nameOrId: string | number, frame?: number): number[] | null {
  const d = dummyByRef(model, nameOrId);
  return d ? d.matrix[dummyFrame(model, frame)].slice() : null;
}

/**
 * The dummy's full transform as a 16-float column-major 4x4 matrix (OpenGL / THREE.Matrix4.fromArray
 * layout): columns = right, front, up, position — same composition as eHierarchic::drawAll.
 */
export function dkoGetDummyMatrix4(model: DkoModel, nameOrId: string | number, frame?: number): number[] | null {
  const d = dummyByRef(model, nameOrId);
  if (!d) return null;
  const f = dummyFrame(model, frame);
  return mat9ToMat4(d.matrix[f], d.position[f]);
}

function mat9ToMat4(m: Mat9, p: { x: number; y: number; z: number } | number[]): number[] {
  const [px, py, pz] = Array.isArray(p) ? p : [p.x, p.y, p.z];
  return [m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, px, py, pz, 1];
}

/** Frame selection of dkoRender(modelID, float frameID): returns [currentFrame, framef]. */
function renderFrame(model: DkoModel, frame: number | undefined): [number, number] {
  const duration = model.timeInfo[2];
  if (frame === undefined || !Number.isFinite(frame)) return [0, -1]; // dkoRender(modelID)
  let framef = frame;
  if (framef > duration - 1) framef = -1;
  if (framef <= 0) framef = -1;
  let currentFrame = Math.trunc(frame) % duration;
  if (currentFrame < 0) currentFrame = 0; // UB in the original
  return [currentFrame, framef];
}

interface FrameArrays {
  va: Float32Array | null;
  na: Float32Array | null;
  uv: Float32Array | null;
}

/** CdkoMesh::drawIt — picks or interpolates the arrays of one material group. */
function groupArrays(model: DkoModel, group: DkoMatGroup, frame: number | undefined, out?: FrameArrays): FrameArrays {
  const [currentFrame, framef] = renderFrame(model, frame);
  const res: FrameArrays = out ?? { va: null, na: null, uv: null };
  if (framef > -1) {
    // Ha ah!! on interpolate
    const frameFrom = Math.trunc(framef);
    let frameTo = frameFrom + 1;
    if (frameTo >= model.timeInfo[2]) frameTo = 0;
    const percent = framef - frameFrom;
    const from = group.meshAtFrame[frameFrom];
    const to = group.meshAtFrame[frameTo];
    res.va = lerpArray(from.vertexArray, to.vertexArray, percent, res.va);
    res.na = lerpArray(from.normalArray, to.normalArray, percent, res.na);
    if (group.animatedUV) res.uv = lerpArray(from.texCoordArray, to.texCoordArray, percent, res.uv);
    else res.uv = group.meshAtFrame[0].texCoordArray;
  } else {
    const cur = group.meshAtFrame[currentFrame];
    if (out) {
      // `out` is reused by the next frames (setDkoFrame): copy, never keep the model's own arrays
      // in it, or the next interpolation would write into them (every babo shares the model)
      res.va = copyArray(cur.vertexArray, res.va);
      res.na = copyArray(cur.normalArray, res.na);
      res.uv = group.animatedUV ? copyArray(cur.texCoordArray, res.uv) : group.meshAtFrame[0].texCoordArray;
    } else {
      res.va = cur.vertexArray;
      res.na = cur.normalArray;
      res.uv = group.animatedUV ? cur.texCoordArray : group.meshAtFrame[0].texCoordArray;
    }
  }
  return res;
}

/** `src` copied into `dst` when it fits (a new array otherwise). */
function copyArray(src: Float32Array | null, dst: Float32Array | null): Float32Array | null {
  if (!src) return null;
  const o = dst && dst.length === src.length && dst !== src ? dst : new Float32Array(src.length);
  o.set(src);
  return o;
}

function lerpArray(a: Float32Array | null, b: Float32Array | null, t: number, out: Float32Array | null): Float32Array | null {
  if (!a) return null;
  if (!b) return a;
  const o = out && out.length === a.length && out !== a && out !== b ? out : new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * t;
  return o;
}

/**
 * dkoGetVertexArray: all triangle vertices of the model at `frame` (same frame rules as
 * dkoRender with a float frame), in model space (mesh matrices applied), 3 floats per vertex.
 */
export function dkoGetVertexArray(model: DkoModel, frame?: number): Float32Array {
  let total = 0;
  for (const mesh of model.meshes) for (const g of mesh.matGroups) total += g.nbVertex;
  const out = new Float32Array(total * 3);
  const cur = [0, 0, 0];
  let n = 0;
  for (const mesh of model.meshes) {
    for (const g of mesh.matGroups) {
      const va = groupArrays(model, g, frame).va;
      if (!va) continue;
      for (let j = 0; j < g.nbVertex; j++) {
        transformPoint(mesh, va[j * 3], va[j * 3 + 1], va[j * 3 + 2], cur);
        out[n++] = cur[0];
        out[n++] = cur[1];
        out[n++] = cur[2];
      }
    }
  }
  return out;
}

/** dkoGetNbVertex (real count; see DkoModel.nbFace). */
export function dkoGetNbVertex(model: DkoModel): number {
  return model.nbFace * 3;
}

// --- Rendering (dkoRender) ---

export interface DkoRenderOptions {
  /**
   * Emulate GL_COLOR_MATERIAL (default true). In BV2, GL_COLOR_MATERIAL is left enabled
   * (Player.cpp babo sphere, end of Map::renderMisc) when weapons, projectiles, casings, gibs and
   * flags are drawn, so setDiffusePass()'s glColor overrides the material ambient+diffuse:
   * untextured -> ambient = diffuse = material diffuse; textured -> ambient = diffuse = white.
   * Pass false for flag pods (drawn before Map::renderMisc enables it) to use the file's ambient/diffuse.
   */
  colorMaterial?: boolean;
  /** Emulate the caller's glBlendFunc: 'additive' = (GL_SRC_ALPHA, GL_ONE), 'alpha' = (SRC_ALPHA, ONE_MINUS_SRC_ALPHA). */
  blending?: 'none' | 'additive' | 'alpha';
  /** Caller's glDepthMask (default true). */
  depthWrite?: boolean;
  /** Caller's GL_ALPHA_TEST with glAlphaFunc(GL_GREATER, alphaTest), e.g. .3 for the knives. */
  alphaTest?: number;
  /** DKO_TEXTURE_MAP render flag (default true). */
  textures?: boolean;
  /** DKO_CLAMP_TEXTURE render flag (default false). */
  clampTexture?: boolean;
  /** DKO_FORCE_WIREFRAME render flag (default false). */
  forceWireframe?: boolean;
  /** DKO_DYNAMIC_LIGHTING render flag (default true). False draws unlit (GL_LIGHTING disabled). */
  lighting?: boolean;
}

interface DkoGroupRef {
  mesh: THREE.Mesh;
  group: DkoMatGroup;
  arrays: FrameArrays;
}

interface DkoObjectData {
  model: DkoModel;
  groups: DkoGroupRef[];
  frame: number | undefined;
}

/** Animation state of the objects built by createDkoObject3D (kept out of userData so that
 * Object3D.clone(), which JSON-copies userData, stays cheap; clones share geometry/materials). */
const dkoObjects = new WeakMap<THREE.Object3D, DkoObjectData>();

/** Bounding sphere of a material group over all its frames (for frustum culling while animating). */
function groupBoundingSphere(group: DkoMatGroup): THREE.Sphere {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const f of group.meshAtFrame) {
    const va = f.vertexArray;
    if (!va) continue;
    for (let i = 0; i < va.length; i += 3) box.expandByPoint(v.set(va[i], va[i + 1], va[i + 2]));
  }
  const sphere = new THREE.Sphere();
  box.getCenter(sphere.center);
  let r2 = 0;
  for (const f of group.meshAtFrame) {
    const va = f.vertexArray;
    if (!va) continue;
    for (let i = 0; i < va.length; i += 3) r2 = Math.max(r2, sphere.center.distanceToSquared(v.set(va[i], va[i + 1], va[i + 2])));
  }
  sphere.radius = Math.sqrt(r2);
  return sphere;
}

/**
 * Builds a three.js object that draws `model` like dkoRender(model, frame): one THREE.Mesh per
 * material group, grouped under a node per CdkoMesh with its position/matrix, under a root that
 * carries the model's own PROPERTIES transform. Model units are kept (apply the game's
 * glScalef yourself). `frame` follows dkoRender(modelID, float frameID): undefined/<=0 -> frame 0,
 * fractional -> interpolated, > last frame -> trunc(frame) % frames. Use setDkoFrame() to animate.
 */
export function createDkoObject3D(model: DkoModel, frame?: number, opts: DkoRenderOptions = {}): THREE.Object3D {
  const root = new THREE.Group();
  root.name = model.name || model.sourcePath;
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(mat9ToMat4(model.matrix, model.position));

  const data: DkoObjectData = { model, groups: [], frame };
  const materialCache = new Map<DkoMaterial | null, THREE.Material>();

  for (const mesh of model.meshes) {
    const node = new THREE.Group();
    node.name = mesh.name;
    node.matrixAutoUpdate = false;
    node.matrix.fromArray(mat9ToMat4(mesh.matrix, mesh.position));
    root.add(node);

    for (const group of mesh.matGroups) {
      if (group.nbVertex <= 0) continue;
      const arrays = groupArrays(model, group, frame);
      if (!arrays.va) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(arrays.va.slice(), 3));
      if (arrays.na) geom.setAttribute('normal', new THREE.BufferAttribute(arrays.na.slice(), 3));
      else geom.computeVertexNormals(); // the original would use the current glNormal
      if (arrays.uv) geom.setAttribute('uv', new THREE.BufferAttribute(arrays.uv.slice(), 2));
      geom.boundingSphere = groupBoundingSphere(group);

      let mat = materialCache.get(group.material);
      if (!mat) {
        mat = createDkoMaterial(group.material, opts);
        materialCache.set(group.material, mat);
      }
      const m = new THREE.Mesh(geom, mat);
      m.name = `${mesh.name}/${group.material?.matName ?? ''}`;
      node.add(m);
      data.groups.push({ mesh: m, group, arrays: { va: null, na: null, uv: null } });
    }
  }
  dkoObjects.set(root, data);
  return root;
}

/**
 * Re-poses an object made by createDkoObject3D at another frame (same rules as its `frame`).
 * Only works on the object returned by createDkoObject3D (not on its clones, which share geometry).
 */
export function setDkoFrame(object: THREE.Object3D, frame?: number): void {
  const data = dkoObjects.get(object);
  if (!data || data.frame === frame) return;
  data.frame = frame;
  for (const ref of data.groups) {
    const arrays = groupArrays(data.model, ref.group, frame, ref.arrays);
    const geom = ref.mesh.geometry;
    copyAttr(geom, 'position', arrays.va);
    copyAttr(geom, 'normal', arrays.na);
    copyAttr(geom, 'uv', arrays.uv);
  }
}

function copyAttr(geom: THREE.BufferGeometry, name: string, src: Float32Array | null): void {
  const attr = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!src || !attr) return;
  (attr.array as Float32Array).set(src);
  attr.needsUpdate = true;
}

/** Disposes the geometries/materials created by createDkoObject3D (textures are shared, kept). */
export function disposeDkoObject3D(object: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      mats.add(o.material as THREE.Material);
    }
  });
  for (const m of mats) m.dispose();
}

/**
 * CdkoMaterial::setDiffusePass as a three.js material.
 *
 * Fixed-function GL (single color, GL_MODULATE) computes per vertex
 *   lit = emission + ambient_mat * (global ambient + light ambient) + diffuse_mat * L * max(N.L,0)
 *         + specular_mat * L * (N.L > 0 ? max(N.H,0)^shininess : 0)
 *   fragment = texture * lit, alpha = texture.a * diffuse_mat.a.
 * MeshPhongMaterial is patched (onBeforeCompile) so that ambient uses its own colour, the
 * specular term is GL's un-normalized Blinn-Phong, and the texture modulates the whole sum. The
 * lights stay three.js lights (scaled by PI, see engine/renderer.ts).
 */
function createDkoMaterial(mat: DkoMaterial | null, opts: DkoRenderOptions): THREE.Material {
  const useTextures = opts.textures ?? true;
  const colorMaterial = opts.colorMaterial ?? true;
  const texPath = useTextures && mat ? mat.texDiffuse : null;

  if (!mat) {
    // No material: drawn with whatever GL state is current; plain white lit.
    return new THREE.MeshLambertMaterial({ color: 0xffffff });
  }

  // glColor after the glMaterial calls: tracked into ambient+diffuse with GL_COLOR_MATERIAL.
  const glColor: Color4 = texPath ? [1, 1, 1, 1] : mat.diffuse;
  const diffuse: Color4 = colorMaterial ? glColor : mat.diffuse;
  const ambient: Color4 = colorMaterial ? glColor : mat.ambient;

  const lighting = opts.lighting ?? true;
  let material: THREE.MeshPhongMaterial | THREE.MeshBasicMaterial;
  if (lighting) {
    material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
      emissive: new THREE.Color(mat.emissive[0], mat.emissive[1], mat.emissive[2]),
      specular: new THREE.Color(mat.specular[0], mat.specular[1], mat.specular[2]),
      shininess: mat.shininess,
    });
    patchFixedFunction(material, ambient);
  } else {
    // GL_LIGHTING disabled: fragment = texture * glColor.
    material = new THREE.MeshBasicMaterial({ color: new THREE.Color(glColor[0], glColor[1], glColor[2]) });
  }
  material.name = mat.matName;
  material.opacity = lighting ? diffuse[3] : glColor[3];
  if (texPath) material.map = loadTexture(texPath, { clamp: opts.clampTexture });
  material.side = mat.twoSided ? THREE.DoubleSide : THREE.FrontSide;
  material.wireframe = mat.wire || (opts.forceWireframe ?? false); // glLineWidth(wireSize) not supported by WebGL
  material.depthWrite = opts.depthWrite ?? true;
  if (opts.alphaTest !== undefined) material.alphaTest = opts.alphaTest;
  const blending = opts.blending ?? 'none';
  if (blending === 'additive') {
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneFactor;
    material.blendEquation = THREE.AddEquation;
  } else if (blending === 'alpha') {
    material.transparent = true;
    material.blending = THREE.NormalBlending;
  }
  return material;
}

const GL_LIGHTS_PARS = /* glsl */ `
varying vec3 vViewPosition;
uniform vec3 dkoAmbient;

struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};

// Fixed-function GL lighting (see createDkoMaterial). Light colours carry three's PI factor.
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = dot( geometryNormal, directLight.direction );
	reflectedLight.directDiffuse += saturate( dotNL ) * directLight.color * BRDF_Lambert( material.diffuseColor );
	if ( dotNL > 0.0 ) {
		vec3 halfDir = normalize( directLight.direction + geometryViewDir );
		float dotNH = saturate( dot( geometryNormal, halfDir ) );
		float spec = material.specularShininess > 0.0 ? pow( dotNH, material.specularShininess ) : 1.0;
		reflectedLight.directSpecular += directLight.color * RECIPROCAL_PI * material.specularColor * spec * material.specularStrength;
	}
}

void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( dkoAmbient );
}

#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong
`;

const GL_MAP_FRAGMENT = /* glsl */ `
vec4 dkoTexel = vec4( 1.0 );
#ifdef USE_MAP
	dkoTexel = texture2D( map, vMapUv );
	diffuseColor.a *= dkoTexel.a;
#endif
`;

const GL_OPAQUE_FRAGMENT = /* glsl */ `
outgoingLight = saturate( outgoingLight ) * dkoTexel.rgb; // GL clamps the lit colour, then GL_MODULATE
#include <opaque_fragment>
`;

// GL without GL_LIGHT_MODEL_TWO_SIDE lights back faces with the front normal: undo three's flip.
const GL_NORMAL_FRAGMENT = /* glsl */ `
#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
	normal *= faceDirection;
#endif
`;

function patchFixedFunction(material: THREE.MeshPhongMaterial, ambient: Color4): void {
  const dkoAmbient = { value: new THREE.Color(ambient[0], ambient[1], ambient[2]) };
  material.onBeforeCompile = (shader) => {
    const src = shader.fragmentShader;
    const parts = ['#include <lights_phong_pars_fragment>', '#include <map_fragment>', '#include <opaque_fragment>', '#include <normal_fragment_begin>'];
    if (!parts.every((p) => src.includes(p))) {
      console.warn('dko: unexpected MeshPhongMaterial shader, fixed-function patch skipped');
      return;
    }
    shader.uniforms.dkoAmbient = dkoAmbient;
    shader.fragmentShader = src
      .replace('#include <lights_phong_pars_fragment>', GL_LIGHTS_PARS)
      .replace('#include <map_fragment>', GL_MAP_FRAGMENT)
      .replace('#include <opaque_fragment>', GL_OPAQUE_FRAGMENT)
      .replace('#include <normal_fragment_begin>', GL_NORMAL_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'dko-fixed-function';
}
