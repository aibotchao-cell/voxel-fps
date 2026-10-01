import * as THREE from 'three';
import { T, makeAtlas, tileUV } from './textures.js';

// ---------------------------------------------------------------------------
// Voxel world: data grid + greedy-ish face mesher + collision helpers.
// ---------------------------------------------------------------------------

export const SX = 44, SY = 14, SZ = 44;

export const B = {
  AIR: 0,
  FLOOR: 1, WALL: 2, RUST: 3, DARK: 4, CRATE: 5,
  HAZARD: 6, DIRT: 7, GRATE: 8, BRICK: 9, GREEN: 10,
  BARREL: 11, CEIL: 12,
};

const BT = {
  [B.FLOOR]:  { top: T.concreteFloor, side: T.concreteFloor, bottom: T.concreteFloor },
  [B.WALL]:   { top: T.ceiling,       side: T.concreteWall,  bottom: T.concreteWall },
  [B.RUST]:   { top: T.rustyMetal,    side: T.rustyMetal,    bottom: T.rustyMetal },
  [B.DARK]:   { top: T.darkMetal,     side: T.darkMetal,     bottom: T.darkMetal },
  [B.CRATE]:  { top: T.crate,         side: T.crate,         bottom: T.crate },
  [B.HAZARD]: { top: T.hazard,        side: T.hazard,        bottom: T.hazard },
  [B.DIRT]:   { top: T.dirt,          side: T.dirt,          bottom: T.dirt },
  [B.GRATE]:  { top: T.grate,         side: T.darkMetal,     bottom: T.darkMetal },
  [B.BRICK]:  { top: T.brick,         side: T.brick,         bottom: T.brick },
  [B.GREEN]:  { top: T.greenMetal,    side: T.greenMetal,    bottom: T.greenMetal },
  [B.BARREL]: { top: T.barrel,        side: T.barrel,        bottom: T.barrel },
  [B.CEIL]:   { top: T.ceiling,       side: T.ceiling,       bottom: T.ceiling },
};

function tileForFace(blockId, faceName) {
  const t = BT[blockId];
  if (!t) return 0;
  if (faceName === 'top') return t.top;
  if (faceName === 'bottom') return t.bottom;
  return t.side;
}

export class World {
  constructor() {
    this.blocks = new Uint8Array(SX * SY * SZ);
  }
  idx(x, y, z) { return (y * SZ + z) * SX + x; }
  inBounds(x, y, z) { return x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ; }
  get(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    return this.inBounds(x, y, z) ? this.blocks[this.idx(x, y, z)] : 0;
  }
  set(x, y, z, v) {
    x |= 0; y |= 0; z |= 0;
    if (this.inBounds(x, y, z)) this.blocks[this.idx(x, y, z)] = v;
  }
  // collision query (float coords allowed)
  isSolid(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return true;                 // never fall through the world
    if (y >= SY) return false;              // open sky
    if (x < 0 || x >= SX || z < 0 || z >= SZ) return true; // invisible boundary walls
    return this.blocks[this.idx(x, y, z)] !== 0;
  }
}

// ------------------------- level generation -------------------------------
let _s = 20260814;
function r() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
function ri(a, b) { return a + Math.floor(r() * (b - a + 1)); }

// --- shared builders -------------------------------------------------------
function fillFloor(w, fn) {
  for (let x = 0; x < SX; x++)
    for (let z = 0; z < SZ; z++) w.set(x, 0, z, fn(x, z));
}

function perimeterWalls(w, h, pick) {
  for (let y = 1; y <= h; y++) {
    for (let x = 0; x < SX; x++) {
      for (const z of [0, SZ - 1]) {
        if (y > h - 3 && x % 7 !== 0 && r() < 0.5) continue; // high window gaps
        w.set(x, y, z, pick());
      }
    }
    for (let z = 0; z < SZ; z++) {
      for (const x of [0, SX - 1]) {
        if (y > h - 3 && z % 7 !== 0 && r() < 0.5) continue;
        w.set(x, y, z, pick());
      }
    }
  }
}

function roofCover(w, y, o) {
  o = o || {};
  const beamEvery = o.beamEvery || 8;
  const holeChance = o.holeChance === undefined ? 0.12 : o.holeChance;
  const openCenter = o.openCenter || 0;
  const beam = o.beam || B.DARK;
  const tile = o.tile || B.CEIL;
  const cx = SX / 2, cz = SZ / 2;
  for (let x = 1; x < SX - 1; x++)
    for (let z = 1; z < SZ - 1; z++) {
      if (openCenter && Math.abs(x - cx) < openCenter && Math.abs(z - cz) < openCenter) continue;
      if (r() < holeChance) continue;
      const isBeam = x % beamEvery === 0 || z % beamEvery === 0;
      w.set(x, y, z, isBeam ? beam : tile);
    }
}

function clearSpawn(w, rad, maxY) {
  rad = rad || 3;
  maxY = maxY || 6;
  const cx = Math.floor(SX / 2), cz = Math.floor(SZ / 2);
  for (let x = cx - rad; x <= cx + rad; x++)
    for (let z = cz - rad; z <= cz + rad; z++)
      for (let y = 1; y <= maxY; y++) w.set(x, y, z, B.AIR);
}

function scatterBarrels(w, n) {
  for (let i = 0; i < n; i++) {
    const x = ri(2, SX - 3), z = ri(2, SZ - 3);
    if (Math.abs(x - SX / 2) < 4 && Math.abs(z - SZ / 2) < 4) continue;
    if (w.get(x, 1, z) === B.AIR) w.set(x, 1, z, B.BARREL);
  }
}

function crateStacks(w, n, skip) {
  for (let i = 0; i < n; i++) {
    const cx = ri(3, SX - 5), cz = ri(3, SZ - 5);
    if (Math.abs(cx - SX / 2) < 5 && Math.abs(cz - SZ / 2) < 5) continue;
    if (skip && skip(cx, cz)) continue;
    const h = ri(1, 3);
    for (let j = 0; j < h; j++) w.set(cx, 1 + j, cz, B.CRATE);
  }
}

// --- LEVEL 1: open hall (long sightlines, easy intro) ----------------------
function layoutHall(w) {
  fillFloor(w, (x) => {
    if (x % 11 === 0 && r() < 0.5) return B.HAZARD;
    if (r() < 0.07) return B.GRATE;
    return B.FLOOR;
  });
  perimeterWalls(w, 6, () => (r() < 0.18 ? B.BRICK : B.WALL));
  roofCover(w, 7, { openCenter: 4, holeChance: 0.15 });

  for (const px of [8, 16, 24, 32, 40])
    for (const pz of [8, 16, 24, 32, 40]) {
      if (px >= SX - 1 || pz >= SZ - 1) continue;
      for (let y = 1; y <= 6; y++) w.set(px, y, pz, y === 6 ? B.RUST : B.DARK);
    }

  for (const [mx, mz] of [[5, 5], [SX - 9, 5], [5, SZ - 9], [SX - 9, SZ - 9]]) {
    for (let dx = 0; dx < 3; dx++)
      for (let dz = 0; dz < 3; dz++)
        for (let y = 1; y <= 2; y++) w.set(mx + dx, y, mz + dz, B.GREEN);
    w.set(mx + 1, 3, mz + 1, B.RUST);
  }

  crateStacks(w, 20);
  scatterBarrels(w, 20);
  clearSpawn(w, 3);
}

// --- LEVEL 2: assembly line (conveyor belts + machines) --------------------
function layoutAssembly(w) {
  fillFloor(w, () => (r() < 0.09 ? B.GRATE : B.FLOOR));
  perimeterWalls(w, 6, () => (r() < 0.22 ? B.RUST : B.WALL));
  roofCover(w, 7, { holeChance: 0.03, beamEvery: 6 });

  // long conveyor belts (1 block high) with walk-through gaps
  for (const bz of [8, 15, 22, 29, 36]) {
    for (let x = 2; x < SX - 2; x++) {
      if (x % 13 < 2) continue;
      w.set(x, 1, bz, B.DARK);
      w.set(x, 1, bz + 1, B.HAZARD);
    }
  }

  // machines between the belts
  for (let i = 0; i < 18; i++) {
    const mx = ri(3, SX - 5), mz = ri(3, SZ - 5);
    const m7 = mz % 7;
    if (m7 === 1 || m7 === 2) continue; // don't build on a belt
    for (let dx = 0; dx < 2; dx++)
      for (let dz = 0; dz < 2; dz++)
        for (let y = 1; y <= 2; y++) w.set(mx + dx, y, mz + dz, B.GREEN);
  }

  crateStacks(w, 18, (cx, cz) => cz % 7 === 1 || cz % 7 === 2);
  scatterBarrels(w, 14);
  clearSpawn(w, 3);
}

// --- LEVEL 3: boiler room (tight rooms/corridors, low ceiling, hot fog) ----
function layoutBoiler(w) {
  fillFloor(w, () => (r() < 0.45 ? B.RUST : (r() < 0.35 ? B.HAZARD : B.FLOOR)));
  perimeterWalls(w, 5, () => (r() < 0.3 ? B.BRICK : B.WALL));
  roofCover(w, 6, { holeChance: 0.07, beamEvery: 7 });

  // interior wall grid with doorways -> rooms + corridors
  const wh = 5;
  for (const gx of [8, 16, 24, 32])
    for (let z = 1; z < SZ - 1; z++) {
      if (z % 5 === 0) continue;
      for (let y = 1; y <= wh; y++) w.set(gx, y, z, r() < 0.4 ? B.BRICK : B.WALL);
    }
  for (const gz of [8, 16, 24, 32])
    for (let x = 1; x < SX - 1; x++) {
      if (x % 5 === 0) continue;
      for (let y = 1; y <= wh; y++) w.set(x, y, gz, r() < 0.4 ? B.BRICK : B.WALL);
    }

  // boilers
  for (const [bx, bz] of [[3, 3], [35, 3], [3, 35], [35, 35], [14, 28], [28, 12]]) {
    for (let dx = 0; dx < 3; dx++)
      for (let dz = 0; dz < 3; dz++)
        for (let y = 1; y <= 4; y++) {
          if (dx === 1 && dz === 1 && y <= 3) continue;
          w.set(bx + dx, y, bz + dz, B.GREEN);
        }
    w.set(bx + 1, 1, bz + 1, B.RUST);
  }

  // pipes
  for (let i = 0; i < 16; i++) {
    const px = ri(2, SX - 3), pz = ri(2, SZ - 3);
    if (px % 5 === 0 || pz % 5 === 0) continue; // keep doorways open
    if (w.get(px, 1, pz) !== B.AIR) continue;
    for (let y = 1; y <= wh; y++) w.set(px, y, pz, B.DARK);
  }

  scatterBarrels(w, 18);
  clearSpawn(w, 3);
}

// --- LEVEL 4: warehouse (tall racking = aisles / maze) --------------------
function layoutWarehouse(w) {
  fillFloor(w, () => (r() < 0.12 ? B.GRATE : B.FLOOR));
  perimeterWalls(w, 6, () => (r() < 0.25 ? B.RUST : B.WALL));
  roofCover(w, 7, { holeChance: 0.05, beamEvery: 8 });

  // racking rows
  for (const rz of [6, 12, 18, 24, 30, 36]) {
    for (let x = 2; x < SX - 2; x++) {
      if (x % 7 === 0) continue; // crossing gap
      w.set(x, 1, rz, B.DARK);
      w.set(x, 2, rz, B.CRATE);
      w.set(x, 3, rz, B.CRATE);
      if (x % 3 === 0) { w.set(x, 2, rz + 1, B.CRATE); w.set(x, 2, rz - 1, B.CRATE); }
    }
  }

  crateStacks(w, 20, (cx, cz) => cz % 6 === 0);
  scatterBarrels(w, 22);
  clearSpawn(w, 3);
}

// --- LEVEL 5: control room (multi-level: catwalk + ramp + offices) --------
function layoutControl(w) {
  fillFloor(w, () => (r() < 0.1 ? B.HAZARD : B.FLOOR));
  perimeterWalls(w, 7, () => (r() < 0.2 ? B.DARK : B.WALL));
  roofCover(w, 8, { holeChance: 0.04, beamEvery: 6 });

  // ground-floor consoles
  for (let i = 0; i < 12; i++) {
    const mx = ri(3, SX - 5), mz = ri(3, SZ - 5);
    if (mx >= 22 && mz <= 30) continue; // keep the area under the platform open
    for (let dx = 0; dx < 2; dx++)
      for (let dz = 0; dz < 2; dz++) w.set(mx + dx, 1, mz + dz, B.GREEN);
  }

  // upper platform at y=4
  for (let x = 24; x <= 42; x++)
    for (let z = 4; z <= 30; z++) {
      w.set(x, 4, z, x % 5 === 0 || z % 5 === 0 ? B.DARK : B.GRATE);
      for (let y = 5; y <= 7; y++) w.set(x, y, z, B.AIR);
    }

  // support pillars
  for (const [px, pz] of [[28, 8], [28, 16], [28, 24], [36, 8], [36, 16], [36, 24], [40, 20]])
    for (let y = 1; y <= 3; y++) w.set(px, y, pz, B.DARK);

  // staircase up to the platform
  for (let z = 9; z <= 13; z++) {
    w.set(20, 1, z, B.CRATE);
    w.set(21, 1, z, B.CRATE); w.set(21, 2, z, B.CRATE);
    w.set(22, 1, z, B.CRATE); w.set(22, 2, z, B.CRATE); w.set(22, 3, z, B.CRATE);
    w.set(23, 1, z, B.CRATE); w.set(23, 2, z, B.CRATE); w.set(23, 3, z, B.CRATE); w.set(23, 4, z, B.CRATE);
  }
  for (let x = 19; x <= 23; x++)
    for (let z = 8; z <= 14; z++)
      for (let y = 5; y <= 7; y++) w.set(x, y, z, B.AIR);

  // office walls on the platform (with window bands)
  for (let z = 4; z <= 14; z++)
    for (let y = 5; y <= 6; y++) {
      if (y === 6 && z % 3 !== 0) continue;
      w.set(40, y, z, B.WALL);
    }
  for (let x = 34; x <= 42; x++)
    for (let y = 5; y <= 6; y++) {
      if (y === 6 && x % 3 !== 0) continue;
      w.set(x, y, 16, B.WALL);
    }

  scatterBarrels(w, 12);
  clearSpawn(w, 3, 3);
}

// ------------------------- dispatch ---------------------------------------
export function buildLevel(w, index) {
  _s = (20260814 + index * 7919) >>> 0; // deterministic, distinct per level
  w.blocks.fill(0);
  switch (index) {
    case 1: layoutAssembly(w); break;
    case 2: layoutBoiler(w); break;
    case 3: layoutWarehouse(w); break;
    case 4: layoutControl(w); break;
    default: layoutHall(w);
  }
}

// --------------------------- mesher ---------------------------------------
const FACES = [
  { n: 'top',    dir: [0, 1, 0],  u: 0, v: 2, shade: 1.00, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { n: 'bottom', dir: [0, -1, 0], u: 0, v: 2, shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: 'east',   dir: [1, 0, 0],  u: 2, v: 1, shade: 0.78, corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { n: 'west',   dir: [-1, 0, 0], u: 2, v: 1, shade: 0.78, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: 'south',  dir: [0, 0, 1],  u: 0, v: 1, shade: 0.90, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: 'north',  dir: [0, 0, -1], u: 0, v: 1, shade: 0.68, corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
];
const AO_LEVELS = [0.50, 0.70, 0.86, 1.0];

export function buildMesh(world) {
  const positions = [];
  const uvs = [];
  const colors = [];

  const solid = (x, y, z) => world.isSolid(x, y, z);

  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const id = world.get(x, y, z);
        if (id === B.AIR) continue;

        for (const f of FACES) {
          const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
          if (solid(nx, ny, nz)) continue; // face hidden

          const tile = tileForFace(id, f.n);
          const [u0, v0, u1, v1] = tileUV(tile);
          const uvc = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

          // per-corner ambient occlusion
          const U = f.u, V = f.v;
          const verts = f.corners.map((c, k) => {
            const su = c[U] === 1 ? 1 : -1;
            const sv = c[V] === 1 ? 1 : -1;
            const o1 = [nx, ny, nz]; o1[U] += su;
            const o2 = [nx, ny, nz]; o2[V] += sv;
            const oc = [nx, ny, nz]; oc[U] += su; oc[V] += sv;
            const s1 = solid(o1[0], o1[1], o1[2]) ? 1 : 0;
            const s2 = solid(o2[0], o2[1], o2[2]) ? 1 : 0;
            const cc = solid(oc[0], oc[1], oc[2]) ? 1 : 0;
            const ao = (s1 && s2) ? 0 : (3 - (s1 + s2 + cc));
            return {
              p: [x + c[0], y + c[1], z + c[2]],
              uv: uvc[k],
              shade: f.shade * AO_LEVELS[ao],
            };
          });

          // ensure outward winding (three.js front face is CCW)
          const a = verts[0].p, b = verts[1].p, c = verts[2].p;
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const cr = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const dot = cr[0] * f.dir[0] + cr[1] * f.dir[1] + cr[2] * f.dir[2];
          const q = dot < 0 ? [verts[0], verts[3], verts[2], verts[1]] : verts;

          const tri = [q[0], q[1], q[2], q[0], q[2], q[3]];
          for (const vt of tri) {
            positions.push(vt.p[0], vt.p[1], vt.p[2]);
            uvs.push(vt.uv[0], vt.uv[1]);
            colors.push(vt.shade, vt.shade, vt.shade);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({
    map: makeAtlas(),
    vertexColors: true,
    fog: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
