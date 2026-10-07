// Binary form of the messages that go out many times a second: the server's 'tick' (players' states,
// projectiles, events) and the client's coordinates ('cf') and shots ('shoot'). In JSON most of their
// bytes were field names and decimals. Here positions and speeds travel as hundredths in 16 bits (the
// original sent shorts too), normals in 8 bits and ids in a byte; a dead player is 5 bytes. Every
// other message stays JSON (protocol.ts).
//
// An event this file doesn't describe (a new type, or a new field in one) still arrives: it travels
// as JSON inside the binary message, and the server logs it once. Add it to EVENT_LIST then.
import { PLAYER_STATUS_ALIVE } from '../sim/constants';
import type { ClientMessage, NetEvent, NetPlayerState, NetProjectile, NetProjectileState, ServerMessage, V3 } from './protocol';

export type TickMessage = Extract<ServerMessage, { t: 'tick' }>;

/** The first byte of a binary message. */
const WIRE_TICK = 1;
const WIRE_CF = 2;
const WIRE_SHOOT = 3;

/** Hundredths in an int16: the largest position or speed sent (the maps are at most 63 cells). */
const Q_MAX = 327.67;
/** The original's "nowhere" (a dead babo's position), sent as the int16's lowest value. */
const NOWHERE = -999;
const Q_NOWHERE = -32768;

// --------------------------------------------------------------------------- writer / reader

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Writer {
  private buf = new Uint8Array(512);
  private view = new DataView(this.buf.buffer);
  private n = 0;

  /** Makes room for k more bytes and returns where they go (the buffer may have been replaced). */
  private room(k: number): number {
    const at = this.n;
    if (at + k > this.buf.length) {
      let size = this.buf.length * 2;
      while (size < at + k) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buf.subarray(0, at));
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
    this.n += k;
    return at;
  }

  u8(v: number): void {
    const at = this.room(1);
    this.view.setUint8(at, v);
  }
  i8(v: number): void {
    const at = this.room(1);
    this.view.setInt8(at, v);
  }
  u16(v: number): void {
    const at = this.room(2);
    this.view.setUint16(at, v, true);
  }
  i16(v: number): void {
    const at = this.room(2);
    this.view.setInt16(at, v, true);
  }
  i32(v: number): void {
    const at = this.room(4);
    this.view.setInt32(at, v, true);
  }
  u32(v: number): void {
    const at = this.room(4);
    this.view.setUint32(at, v, true);
  }
  f32(v: number): void {
    const at = this.room(4);
    this.view.setFloat32(at, v, true);
  }
  /** A position or speed, in hundredths (saturated). */
  q(v: number): void {
    this.i16(v === NOWHERE ? Q_NOWHERE : Math.max(-32767, Math.min(32767, Math.round(v * 100))));
  }
  vec(v: V3): void {
    this.q(v[0]);
    this.q(v[1]);
    this.q(v[2]);
  }
  /** A unit vector, in 127ths. */
  nrm(v: V3): void {
    for (const c of v) this.i8(Math.max(-127, Math.min(127, Math.round(c * 127))));
  }
  /** UTF-8 with its length before it (a u32 for `long` texts: an event sent as JSON). */
  str(s: string, long = false): void {
    const b = encoder.encode(s);
    if (long) this.u32(b.length);
    else this.u16(Math.min(b.length, 65535));
    const at = this.room(b.length);
    this.buf.set(b, at);
  }
  bytes(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  private readonly view: DataView;
  private n = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(): number {
    return this.view.getUint8(this.n++);
  }
  i8(): number {
    return this.view.getInt8(this.n++);
  }
  u16(): number {
    const v = this.view.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.n, true);
    this.n += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.n, true);
    this.n += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.n, true);
    this.n += 4;
    return v;
  }
  /** Rounded to what a float32 can tell (no 0.30000001192092896). */
  f32(): number {
    const v = this.view.getFloat32(this.n, true);
    this.n += 4;
    return Number(v.toPrecision(7));
  }
  q(): number {
    const v = this.i16();
    return v === Q_NOWHERE ? NOWHERE : v / 100;
  }
  vec(): V3 {
    return [this.q(), this.q(), this.q()];
  }
  nrm(): V3 {
    return [this.i8(), this.i8(), this.i8()].map((c) => Math.round((c / 127) * 1000) / 1000) as V3;
  }
  str(long = false): string {
    const len = long ? this.u32() : this.u16();
    if (this.n + len > this.buf.length) throw new RangeError('string past the end');
    const s = decoder.decode(this.buf.subarray(this.n, this.n + len));
    this.n += len;
    return s;
  }
  get done(): boolean {
    return this.n === this.buf.length;
  }
}

// --------------------------------------------------------------------------- events

type Kind = 'i8' | 'i16' | 'i32' | 'f32' | 'pos' | 'nrm' | 'bool' | 'str' | 'proj';

/**
 * The events the server sends, each with its fields in order ("name?:" is optional). The position in
 * this list is the event's code: changing the list changes the protocol (PROTOCOL_VERSION).
 */
const EVENT_LIST: [type: string, fields: string][] = [
  ['shoot', 'playerID:i8 weaponID:i8 nuzzleID:i8 p1:pos p2:pos normal:nrm hitPlayerID:i8'],
  ['hit', 'playerID:i8 fromID:i8 weaponID:i8 damage:f32 life:f32 position:pos dot?:bool'],
  ['death', 'playerID:i8 fromID:i8 weaponID:i8 friendlyFire:bool position:pos'],
  ['spawn', 'playerID:i8 position:pos weaponID:i8 meleeID:i8'],
  ['projectileSpawn', 'uniqueID:i32 nuzzleID:i8 launchPosition:pos launchVel:pos proj?:proj'],
  ['projectileRemoved', 'uniqueID:i32'],
  ['grenadeRebound', 'position:pos'],
  ['explosion', 'position:pos normal:nrm radius:f32 playerID:i8'],
  ['sound', 'soundID:i16 position:pos volume:f32 range:f32 playerID?:i8'],
  ['melee', 'playerID:i8 weaponID:i8'],
  ['pickup', 'playerID:i8 itemType:i8 itemFlag:i16'],
  ['photonCharge', 'playerID:i8 position:pos'],
  ['overheat', 'playerID:i8 position:pos'],
  ['shotgunReload', 'playerID:i8 position:pos'],
  ['feat', 'playerID:i8 feat:str victimID:i8 n?:i16'],
  ['flag', 'flagID:i8 state:i8 playerID:i8 position:pos reason:str'],
  ['teamChange', 'playerID:i8 teamID:i8'],
  ['roundState', 'state:i8'],
  ['mapChange', 'mapName:str'],
  ['chat', 'playerID:i8 text:str sys?:str team?:i8'],
  ['crate', 'crateID:i32 position:pos broken:bool fromID:i8'],
];

interface Field {
  name: string;
  kind: Kind;
  /** Bit in the event's mask of optional fields; -1: always there. */
  bit: number;
}
interface EventSpec {
  code: number;
  type: string;
  fields: Field[];
  optional: number;
}

const SPECS = new Map<string, EventSpec>();
const BY_CODE: EventSpec[] = [];
EVENT_LIST.forEach(([type, list], i) => {
  let optional = 0;
  const fields = list.split(' ').map((f) => {
    const [name, kind] = f.split(':');
    const opt = name.endsWith('?');
    return { name: opt ? name.slice(0, -1) : name, kind: kind as Kind, bit: opt ? optional++ : -1 };
  });
  const spec = { code: i + 1, type, fields, optional };
  SPECS.set(type, spec);
  BY_CODE[spec.code] = spec;
});

const LIMITS: Partial<Record<Kind, [number, number]>> = { i8: [-128, 127], i16: [-32768, 32767], i32: [-2147483648, 2147483647] };

function isVec(v: unknown, max: number): v is V3 {
  return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && (Math.abs(c) <= max || (max === Q_MAX && c === NOWHERE)));
}

function isProj(v: unknown): v is NetProjectile {
  const p = v as NetProjectile;
  return (
    !!p &&
    typeof p === 'object' &&
    fits('i32', p.id) &&
    fits('i8', p.k) &&
    fits('i8', p.from) &&
    fits('i8', p.w) &&
    isVec(p.p, Q_MAX) &&
    isVec(p.v, Q_MAX) &&
    fits('f32', p.a) &&
    fits('f32', p.r)
  );
}

function fits(kind: Kind, v: unknown): boolean {
  const range = LIMITS[kind];
  if (range) return Number.isInteger(v) && (v as number) >= range[0] && (v as number) <= range[1];
  switch (kind) {
    case 'f32':
      return typeof v === 'number' && Number.isFinite(v);
    case 'pos':
      return isVec(v, Q_MAX);
    case 'nrm':
      return isVec(v, 1.001);
    case 'bool':
      return typeof v === 'boolean';
    case 'str':
      return typeof v === 'string' && v.length <= 4000;
    case 'proj':
      return isProj(v);
  }
  return false;
}

/** Why this event can't use its binary form ('' when it can). */
function mismatch(spec: EventSpec | undefined, e: NetEvent): string {
  if (!spec) return 'unknown type';
  for (const [k, v] of Object.entries(e)) {
    if (k !== 'type' && v !== undefined && !spec.fields.some((f) => f.name === k)) return `field ${k}`;
  }
  for (const f of spec.fields) {
    const v = e[f.name];
    if (v === undefined) {
      if (f.bit < 0) return `no ${f.name}`;
    } else if (!fits(f.kind, v)) return `${f.name} = ${JSON.stringify(v)}`;
  }
  return '';
}

function writeField(w: Writer, kind: Kind, v: unknown): void {
  switch (kind) {
    case 'i8':
      return w.i8(v as number);
    case 'i16':
      return w.i16(v as number);
    case 'i32':
      return w.i32(v as number);
    case 'f32':
      return w.f32(v as number);
    case 'pos':
      return w.vec(v as V3);
    case 'nrm':
      return w.nrm(v as V3);
    case 'bool':
      return w.u8(v ? 1 : 0);
    case 'str':
      return w.str(v as string);
    case 'proj': {
      const p = v as NetProjectile;
      w.i32(p.id);
      w.i8(p.k);
      w.i8(p.from);
      w.i8(p.w);
      w.vec(p.p);
      w.vec(p.v);
      w.f32(p.a);
      w.f32(p.r);
      return;
    }
  }
}

function readField(r: Reader, kind: Kind): unknown {
  switch (kind) {
    case 'i8':
      return r.i8();
    case 'i16':
      return r.i16();
    case 'i32':
      return r.i32();
    case 'f32':
      return r.f32();
    case 'pos':
      return r.vec();
    case 'nrm':
      return r.nrm();
    case 'bool':
      return r.u8() !== 0;
    case 'str':
      return r.str();
    case 'proj':
      return { id: r.i32(), k: r.i8(), from: r.i8(), w: r.i8(), p: r.vec(), v: r.vec(), a: r.f32(), r: r.f32() } satisfies NetProjectile;
  }
}

/** Called when an event goes as JSON instead (unknown type, new field, value out of range). */
export type FallbackReport = (type: string, why: string) => void;

function writeEvent(w: Writer, e: NetEvent, onFallback?: FallbackReport): void {
  const spec = SPECS.get(e.type);
  const why = mismatch(spec, e);
  if (why || !spec) {
    onFallback?.(e.type, why);
    w.u8(0);
    w.str(JSON.stringify(e), true);
    return;
  }
  w.u8(spec.code);
  if (spec.optional) {
    let mask = 0;
    for (const f of spec.fields) if (f.bit >= 0 && e[f.name] !== undefined) mask |= 1 << f.bit;
    w.u8(mask);
  }
  for (const f of spec.fields) {
    const v = e[f.name];
    if (v !== undefined) writeField(w, f.kind, v);
  }
}

function readEvent(r: Reader): NetEvent {
  const code = r.u8();
  if (code === 0) return JSON.parse(r.str(true)) as NetEvent;
  const spec = BY_CODE[code];
  if (!spec) throw new RangeError(`unknown event ${code}`);
  const mask = spec.optional ? r.u8() : 0;
  const e: NetEvent = { type: spec.type };
  for (const f of spec.fields) {
    if (f.bit >= 0 && !(mask & (1 << f.bit))) continue;
    e[f.name] = readField(r, f.kind);
  }
  return e;
}

// --------------------------------------------------------------------------- players, projectiles

/** Flags of NetPlayerState: 2 = the player has a nuke bot (its position follows). */
const FLAG_MINIBOT = 2;
/** A flag of the binary form only: the babo is on the ground (z = 0.25, a babo's radius), z is not sent. */
const WIRE_ON_GROUND = 0x40;
const GROUND_Z = 0.25;

function writePlayer(w: Writer, s: NetPlayerState): void {
  const [id, status, frameID, x, y, z, vx, vy, mx, my, life, weaponID, meleeID, flags, bx, by] = s;
  const alive = status === PLAYER_STATUS_ALIVE;
  const onGround = alive && Math.abs(z - GROUND_Z) < 0.005;
  w.u8(id);
  w.i8(status);
  w.u16(Math.max(0, Math.min(65535, Math.round(life * 1000))));
  w.u8((flags & ~WIRE_ON_GROUND) | (onGround ? WIRE_ON_GROUND : 0));
  // A dead player's position and weapons are not used by the pages
  if (alive) {
    w.i32(frameID);
    w.q(x);
    w.q(y);
    if (!onGround) w.q(z);
    w.q(vx);
    w.q(vy);
    w.q(mx);
    w.q(my);
    w.i8(weaponID);
    w.i8(meleeID);
  }
  if (flags & FLAG_MINIBOT) {
    w.q(bx);
    w.q(by);
  }
}

function readPlayer(r: Reader): NetPlayerState {
  const id = r.u8();
  const status = r.i8();
  const life = r.u16() / 1000;
  const wireFlags = r.u8();
  const flags = wireFlags & ~WIRE_ON_GROUND;
  let frameID = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let vx = 0;
  let vy = 0;
  let mx = 0;
  let my = 0;
  let weaponID = -1;
  let meleeID = -1;
  if (status === PLAYER_STATUS_ALIVE) {
    frameID = r.i32();
    x = r.q();
    y = r.q();
    z = wireFlags & WIRE_ON_GROUND ? GROUND_Z : r.q();
    vx = r.q();
    vy = r.q();
    mx = r.q();
    my = r.q();
    weaponID = r.i8();
    meleeID = r.i8();
  }
  const bot = flags & FLAG_MINIBOT;
  const bx = bot ? r.q() : 0;
  const by = bot ? r.q() : 0;
  return [id, status, frameID, x, y, z, vx, vy, mx, my, life, weaponID, meleeID, flags, bx, by];
}

function writeProjectile(w: Writer, s: NetProjectileState): void {
  w.i32(s[0]);
  for (let i = 1; i <= 6; i++) w.q(s[i]);
  w.f32(s[7]);
}

function readProjectile(r: Reader): NetProjectileState {
  return [r.i32(), r.q(), r.q(), r.q(), r.q(), r.q(), r.q(), r.f32()];
}

// --------------------------------------------------------------------------- messages

// What a tick carries
const HAS_PLAYERS = 1;
const HAS_PROJECTILES = 2;
const HAS_EVENTS = 4;
const HAS_TIME = 8;
const HAS_ROUND = 16;

/** The server's frame message in binary. */
export function encodeTick(msg: TickMessage, onFallback?: FallbackReport): Uint8Array<ArrayBuffer> {
  const w = new Writer();
  w.u8(WIRE_TICK);
  w.u32(msg.f);
  const has =
    (msg.p ? HAS_PLAYERS : 0) | (msg.pr ? HAS_PROJECTILES : 0) | (msg.e ? HAS_EVENTS : 0) | (msg.gt !== undefined ? HAS_TIME : 0) | (msg.rs !== undefined ? HAS_ROUND : 0);
  w.u8(has);
  if (msg.gt !== undefined) w.f32(msg.gt);
  if (msg.rs !== undefined) w.i8(msg.rs);
  if (msg.p) {
    w.u8(msg.p.length);
    for (const s of msg.p) writePlayer(w, s);
  }
  if (msg.pr) {
    w.u16(msg.pr.length);
    for (const s of msg.pr) writeProjectile(w, s);
  }
  if (msg.e) {
    w.u16(msg.e.length);
    for (const e of msg.e) writeEvent(w, e, onFallback);
  }
  return w.bytes();
}

/** A binary message from the server (the frame message); throws on a malformed one. */
export function decodeServerMessage(bytes: Uint8Array): ServerMessage {
  const r = new Reader(bytes);
  if (r.u8() !== WIRE_TICK) throw new RangeError('unknown message');
  const msg: TickMessage = { t: 'tick', f: r.u32() };
  const has = r.u8();
  if (has & HAS_TIME) msg.gt = r.f32();
  if (has & HAS_ROUND) msg.rs = r.i8();
  if (has & HAS_PLAYERS) {
    const n = r.u8();
    msg.p = [];
    for (let i = 0; i < n; i++) msg.p.push(readPlayer(r));
  }
  if (has & HAS_PROJECTILES) {
    const n = r.u16();
    msg.pr = [];
    for (let i = 0; i < n; i++) msg.pr.push(readProjectile(r));
  }
  if (has & HAS_EVENTS) {
    const n = r.u16();
    msg.e = [];
    for (let i = 0; i < n; i++) msg.e.push(readEvent(r));
  }
  if (!r.done) throw new RangeError('bytes left over');
  return msg;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Q_MAX;

/**
 * The client's coordinates and shots in binary; null for the other messages, or when a value
 * doesn't fit (then the message goes as JSON, which the server still reads).
 */
export function encodeClientMessage(msg: ClientMessage): Uint8Array<ArrayBuffer> | null {
  const w = new Writer();
  if (msg.t === 'cf') {
    const nums = [...msg.p, ...msg.v, ...msg.m, msg.z];
    if (!Number.isInteger(msg.f) || msg.f < 0 || msg.f > 2147483647 || !nums.every(finite)) return null;
    w.u8(WIRE_CF);
    w.i32(msg.f);
    for (const v of nums) w.q(v);
    return w.bytes();
  }
  if (msg.t === 'shoot') {
    const ok =
      [...msg.o].every(finite) &&
      fits('i8', msg.n) &&
      fits('i8', msg.w) &&
      msg.b.length <= 255 &&
      msg.b.every((b) => b.length >= 3 && b.length - 3 <= 255 && b.slice(0, 3).every(finite) && b.slice(3).every((id) => Number.isInteger(id) && id >= 0 && id <= 255));
    if (!ok) return null;
    w.u8(WIRE_SHOOT);
    w.vec(msg.o);
    w.i8(msg.n);
    w.i8(msg.w);
    w.u8(msg.b.length);
    for (const b of msg.b) {
      w.q(b[0]);
      w.q(b[1]);
      w.q(b[2]);
      w.u8(b.length - 3);
      for (let i = 3; i < b.length; i++) w.u8(b[i]);
    }
    return w.bytes();
  }
  return null;
}

/** A binary message from a client; throws on a malformed one (the server's checks come after). */
export function decodeClientMessage(bytes: Uint8Array): ClientMessage {
  const r = new Reader(bytes);
  const kind = r.u8();
  let msg: ClientMessage;
  if (kind === WIRE_CF) {
    const f = r.i32();
    const p = r.vec();
    const v = r.vec();
    const m: [number, number] = [r.q(), r.q()];
    msg = { t: 'cf', f, p, v, m, z: r.q() };
  } else if (kind === WIRE_SHOOT) {
    const o = r.vec();
    const n = r.i8();
    const w = r.i8();
    const b: number[][] = [];
    for (let i = r.u8(); i > 0; i--) {
      const bullet = [r.q(), r.q(), r.q()];
      for (let k = r.u8(); k > 0; k--) bullet.push(r.u8());
      b.push(bullet);
    }
    msg = { t: 'shoot', o, n, w, b };
  } else throw new RangeError('unknown message');
  if (!r.done) throw new RangeError('bytes left over');
  return msg;
}
