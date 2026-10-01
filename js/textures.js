import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural voxel texture atlas (canvas-generated, no external assets).
// A 4x4 grid of 16x16 tiles = 64x64 atlas. NearestFilter => crisp blocks.
// ---------------------------------------------------------------------------

export const TILE_PX = 16;
const COLS = 4;
const ROWS = 4;
const ATLAS_W = COLS * TILE_PX;
const ATLAS_H = ROWS * TILE_PX;

export const T = {
  concreteFloor: 0,
  concreteWall: 1,
  rustyMetal: 2,
  darkMetal: 3,
  crate: 4,
  hazard: 5,
  dirt: 6,
  grate: 7,
  brick: 8,
  greenMetal: 9,
  barrel: 10,
  ceiling: 11,
};

// deterministic RNG so the atlas looks identical every run
let _seed = 987654321;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

const c255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const css = (c) => `rgb(${c255(c[0])},${c255(c[1])},${c255(c[2])})`;
const sh = (c, d) => [c[0] + d, c[1] + d, c[2] + d];

function noise(ctx, s, base, spread, density) {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, s, s);
  const n = Math.floor(s * s * density);
  for (let i = 0; i < n; i++) {
    const x = (rnd() * s) | 0;
    const y = (rnd() * s) | 0;
    const d = Math.round((rnd() - 0.5) * spread * 2);
    ctx.fillStyle = css(sh(base, d));
    ctx.fillRect(x, y, 1, 1);
  }
}

const painters = [];
painters[T.concreteFloor] = (ctx, s) => {
  noise(ctx, s, [120, 118, 112], 26, 0.55);
  ctx.fillStyle = css([88, 86, 82]);
  ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, s - 1, s, 1);
  ctx.fillRect(0, 0, 1, s); ctx.fillRect(s - 1, 0, 1, s);
};
painters[T.concreteWall] = (ctx, s) => {
  noise(ctx, s, [142, 140, 132], 22, 0.45);
  ctx.fillStyle = css([104, 102, 96]);
  ctx.fillRect(0, 8, s, 1);
  for (let x = 0; x < s; x += 8) ctx.fillRect(x, 0, 1, s);
};
painters[T.rustyMetal] = (ctx, s) => {
  noise(ctx, s, [112, 74, 48], 24, 0.5);
  for (let i = 0; i < 28; i++) {
    const x = (rnd() * s) | 0, y = (rnd() * s) | 0, r = 1 + ((rnd() * 2) | 0);
    ctx.fillStyle = css([150 + ((rnd() * 45) | 0), 78 + ((rnd() * 34) | 0), 30]);
    ctx.fillRect(x, y, r, r);
  }
};
painters[T.darkMetal] = (ctx, s) => {
  noise(ctx, s, [60, 64, 70], 16, 0.4);
  ctx.fillStyle = css([116, 120, 126]);
  ctx.fillRect(2, 2, 2, 2); ctx.fillRect(s - 4, 2, 2, 2);
  ctx.fillRect(2, s - 4, 2, 2); ctx.fillRect(s - 4, s - 4, 2, 2);
};
painters[T.crate] = (ctx, s) => {
  noise(ctx, s, [140, 96, 52], 18, 0.35);
  ctx.fillStyle = css([96, 62, 30]);
  ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, s - 1, s, 1);
  ctx.fillRect(0, 5, s, 1); ctx.fillRect(0, 11, s, 1);
  ctx.fillRect(0, 0, 1, s); ctx.fillRect(s - 1, 0, 1, s);
  ctx.fillRect(7, 0, 1, s);
};
painters[T.hazard] = (ctx, s) => {
  ctx.fillStyle = css([222, 178, 42]);
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = css([38, 36, 34]);
  for (let i = -s; i < s * 2; i += 8) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 4, 0);
    ctx.lineTo(i + 4 - s, s); ctx.lineTo(i - s, s);
    ctx.closePath(); ctx.fill();
  }
};
painters[T.dirt] = (ctx, s) => {
  noise(ctx, s, [96, 78, 54], 22, 0.6);
  ctx.fillStyle = css([64, 50, 34]);
  for (let i = 0; i < 12; i++) ctx.fillRect((rnd() * s) | 0, (rnd() * s) | 0, 2, 1);
};
painters[T.grate] = (ctx, s) => {
  ctx.fillStyle = css([40, 42, 46]); ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = css([96, 100, 106]);
  for (let i = 1; i < s; i += 4) ctx.fillRect(i, 0, 1, s);
  for (let i = 1; i < s; i += 4) ctx.fillRect(0, i, s, 1);
};
painters[T.brick] = (ctx, s) => {
  ctx.fillStyle = css([78, 62, 54]); ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = css([142, 74, 58]);
  const bh = 4;
  for (let row = 0; row < s / bh; row++) {
    const off = row % 2 ? 4 : 0;
    for (let x = -8 + off; x < s; x += 8) ctx.fillRect(x + 1, row * bh + 1, 6, bh - 1);
  }
};
painters[T.greenMetal] = (ctx, s) => {
  noise(ctx, s, [58, 96, 76], 18, 0.4);
  ctx.fillStyle = css([110, 150, 128]);
  for (let i = 0; i < 5; i++) {
    const x = (rnd() * s) | 0, y = (rnd() * s) | 0;
    ctx.fillRect(x, y, 1, 2 + ((rnd() * 4) | 0));
  }
  ctx.fillStyle = css([34, 58, 46]);
  ctx.fillRect(2, 2, 2, 2); ctx.fillRect(s - 4, s - 4, 2, 2);
};
painters[T.barrel] = (ctx, s) => {
  noise(ctx, s, [120, 70, 40], 20, 0.45);
  ctx.fillStyle = css([70, 46, 30]);
  ctx.fillRect(0, 3, s, 2); ctx.fillRect(0, s - 5, s, 2);
  ctx.fillStyle = css([160, 96, 40]);
  ctx.fillRect(0, 7, s, 1);
};
painters[T.ceiling] = (ctx, s) => {
  noise(ctx, s, [86, 84, 82], 18, 0.5);
  ctx.fillStyle = css([58, 56, 54]);
  ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s);
  ctx.fillRect(0, 8, s, 1); ctx.fillRect(8, 0, 1, s);
};

let _atlas = null;

export function makeAtlas() {
  if (_atlas) return _atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < painters.length; i++) {
    if (!painters[i]) continue;
    const col = i % COLS, row = (i / COLS) | 0;
    ctx.save();
    ctx.translate(col * TILE_PX, row * TILE_PX);
    ctx.beginPath(); ctx.rect(0, 0, TILE_PX, TILE_PX); ctx.clip();
    painters[i](ctx, TILE_PX);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _atlas = tex;
  return tex;
}

// returns [u0, v0, u1, v1] for a tile index (three's v is bottom-up)
export function tileUV(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const inset = 0.25 / ATLAS_W;
  const u0 = (col * TILE_PX) / ATLAS_W + inset;
  const u1 = ((col + 1) * TILE_PX) / ATLAS_W - inset;
  const v1 = 1 - (row * TILE_PX) / ATLAS_H - inset;
  const v0 = 1 - ((row + 1) * TILE_PX) / ATLAS_H + inset;
  return [u0, v0, u1, v1];
}
