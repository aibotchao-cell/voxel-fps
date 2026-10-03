import * as THREE from 'three';
import { T, makeAtlas, tileUV } from './textures.js';

// ---------------------------------------------------------------------------
// Voxel world: data grid + face-culling mesher + collision helpers
// + **procedural level generator**：每一關都用種子即時生成，地圖不重複。
//   主題（theme）決定材質與天空/霧/燈光，結構（structure）決定地形長相。
// ---------------------------------------------------------------------------

export const SX = 44, SY = 14, SZ = 44;

export const B = {
  AIR: 0,
  FLOOR: 1, WALL: 2, RUST: 3, DARK: 4, CRATE: 5,
  HAZARD: 6, DIRT: 7, GRATE: 8, BRICK: 9, GREEN: 10,
  BARREL: 11, CEIL: 12, LEAF: 13, LOG: 14,
};

// block id → 材質角色（角色再由主題對應到圖集裡的圖）
const ROLE = {
  [B.FLOOR]:  { top: 'floor',    side: 'floor',    bottom: 'ground' },
  [B.WALL]:   { top: 'wall',     side: 'wall',     bottom: 'wall' },
  [B.RUST]:   { top: 'wall2',    side: 'wall2',    bottom: 'wall2' },
  [B.DARK]:   { top: 'pillar',   side: 'pillar',   bottom: 'pillar' },
  [B.CRATE]:  { top: 'prop',     side: 'prop',     bottom: 'prop' },
  [B.BARREL]: { top: 'prop2',    side: 'prop2',    bottom: 'prop2' },
  [B.HAZARD]: { top: 'accent',   side: 'accent',   bottom: 'accent' },
  [B.GREEN]:  { top: 'block',    side: 'block',    bottom: 'block' },
  [B.GRATE]:  { top: 'detail',   side: 'detail',   bottom: 'detail' },
  [B.DIRT]:   { top: 'ground',   side: 'ground',   bottom: 'ground' },
  [B.BRICK]:  { top: 'wall2',    side: 'wall2',    bottom: 'wall2' },
  [B.CEIL]:   { top: 'roof',     side: 'roof',     bottom: 'roof' },
  [B.LEAF]:   { top: 'foliage',  side: 'foliage',  bottom: 'foliage' },
  [B.LOG]:    { top: 'trunkTop', side: 'trunk',    bottom: 'trunkTop' },
};

function tileForFace(theme, blockId, faceName) {
  const r = ROLE[blockId];
  if (!r) return 0;
  const role = faceName === 'top' ? r.top : faceName === 'bottom' ? r.bottom : r.side;
  const tile = theme.tiles[role];
  return tile === undefined ? theme.tiles.floor : tile;
}

export class World {
  constructor() {
    this.blocks = new Uint8Array(SX * SY * SZ);
    this.reach = null;      // 從出生點可走到的格子（敵人只生在這裡）
    this.theme = null;
  }
  idx(x, y, z) { return (y * SZ + z) * SX + x; }
  inBounds(x, y, z) { return x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ; }
  get(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    return this.inBounds(x, y, z) ? this.blocks[this.idx(x, y, z)] : 0;
  }
  set(x, y, z, v) {
    x |= 0; y |= 0; z |= 0;
    // 防呆：不小心傳了不存在的方塊 id（例如把「材質角色」當成方塊 id 用）就直接忽略，
    // 免得整塊地形默默變成空氣
    if (typeof v !== 'number' || !isFinite(v)) {
      if (typeof console !== 'undefined') console.warn('World.set: 無效的方塊 id', v);
      return;
    }
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
  // 這一格可不可以站人（地板 + 兩格空間）
  standable(x, z) {
    if (x < 1 || x >= SX - 1 || z < 1 || z >= SZ - 1) return false;
    if (this.get(x, 0, z) === 0) return false;
    return this.get(x, 1, z) === 0 && this.get(x, 2, z) === 0;
  }
  // 敵人/道具能不能放在這一格：可站人 + 從出生點走得到
  placeable(x, z) {
    if (!this.standable(x, z)) return false;
    if (!this.reach) return true;
    return this.reach[this.idx(x, 0, z)] === 1;
  }
}

// ======================= 主題（材質＋天空＋地形風格） =======================
export const THEMES = [
  {
    key: 'forest', name: '綠光森林', outdoor: true, trees: 16, pools: 'accent', roofHeight: 9,
    structs: ['trees', 'trees', 'boulders', 'pools', 'pools', 'rings', 'terraces', 'arches'],
    tiles: { floor: T.grassTop, ground: T.dirt, wall: T.logSide, wall2: T.planks, pillar: T.logSide,
      prop: T.logTop, prop2: T.leaves, accent: T.grassSide, block: T.mossy, detail: T.dirt,
      foliage: T.leaves, trunk: T.logSide, trunkTop: T.logTop, roof: T.leaves },
    atmos: { sky: 0x8ec9f0, fog: 0x9fd6ee, near: 36, far: 105, amb: 0.88, ambC: 0xffffff, sunC: 0xfff4d8, sunI: 0.95 },
    words: ['森林', '林地', '綠谷', '樹海'],
  },
  {
    key: 'desert', name: '黃沙神殿', outdoor: true, trees: 0, pools: 'none', roofHeight: 9,
    structs: ['arches', 'pillars', 'terraces', 'cross', 'boulders', 'pools', 'towers'],
    tiles: { floor: T.sand, ground: T.sand, wall: T.sandstone, wall2: T.sandstone, pillar: T.sandstone,
      prop: T.gold, prop2: T.sand, accent: T.sandstone, block: T.stone, detail: T.stone,
      foliage: T.sand, trunk: T.sandstone, trunkTop: T.gold, roof: T.sandstone },
    atmos: { sky: 0xf2d79a, fog: 0xe8cf9a, near: 26, far: 92, amb: 0.92, ambC: 0xfff2d0, sunC: 0xfff0c0, sunI: 1.0 },
    words: ['神殿', '沙丘', '古墓', '綠洲'],
  },
  {
    key: 'snow', name: '冰晶雪原', outdoor: true, trees: 12, pools: 'accent', roofHeight: 9,
    structs: ['trees', 'boulders', 'crystals', 'rings', 'pools', 'terraces'],
    tiles: { floor: T.snow, ground: T.snow, wall: T.stone, wall2: T.marble, pillar: T.stone,
      prop: T.ice, prop2: T.snow, accent: T.ice, block: T.marble, detail: T.ice,
      foliage: T.snow, trunk: T.logSide, trunkTop: T.snow, roof: T.snow },
    atmos: { sky: 0xcfe6f5, fog: 0xdcecf8, near: 18, far: 74, amb: 0.92, ambC: 0xeaf4ff, sunC: 0xe6f2ff, sunI: 0.9 },
    words: ['雪原', '冰河', '極地', '霜谷'],
  },
  {
    key: 'volcano', name: '熔岩地獄', outdoor: false, trees: 0, pools: 'accent', roofHeight: 7,
    structs: ['cross', 'pillars', 'rings', 'towers', 'pools', 'boulders'],
    tiles: { floor: T.basalt, ground: T.basalt, wall: T.basalt, wall2: T.obsidian, pillar: T.obsidian,
      prop: T.basalt, prop2: T.obsidian, accent: T.lava, block: T.lava, detail: T.basalt,
      foliage: T.basalt, trunk: T.obsidian, trunkTop: T.lava, roof: T.basalt },
    atmos: { sky: 0x3a1010, fog: 0x2c0d0c, near: 8, far: 48, amb: 0.72, ambC: 0xffc0a8, sunC: 0xff7a3c, sunI: 0.95 },
    words: ['熔岩', '火山', '煉獄', '焦土'],
  },
  {
    key: 'ruins', name: '苔石遺跡', outdoor: true, trees: 10, pools: 'none', roofHeight: 8,
    structs: ['arches', 'arches', 'rooms', 'cross', 'boulders', 'trees', 'pillars'],
    tiles: { floor: T.mossy, ground: T.mossy, wall: T.cobble, wall2: T.stone, pillar: T.cobble,
      prop: T.mossy, prop2: T.stone, accent: T.mossy, block: T.cobble, detail: T.stone,
      foliage: T.leaves, trunk: T.logSide, trunkTop: T.logTop, roof: T.stone },
    atmos: { sky: 0x7c8f80, fog: 0x8ca08c, near: 16, far: 64, amb: 0.82, ambC: 0xe0eee0, sunC: 0xf0ffe8, sunI: 0.8 },
    words: ['遺跡', '廢墟', '古廟', '石陣'],
  },
  {
    key: 'space', name: '霓虹太空站', outdoor: false, trees: 0, pools: 'accent', roofHeight: 8,
    structs: ['rooms', 'aisles', 'catwalk', 'towers', 'maze', 'pools'],
    tiles: { floor: T.darkMetal, ground: T.darkMetal, wall: T.concreteWall, wall2: T.darkMetal, pillar: T.concreteWall,
      prop: T.neonCyan, prop2: T.neonPink, accent: T.neonCyan, block: T.neonPink, detail: T.grate,
      foliage: T.neonCyan, trunk: T.darkMetal, trunkTop: T.neonCyan, roof: T.concreteWall },
    atmos: { sky: 0x05060c, fog: 0x090d18, near: 12, far: 62, amb: 0.66, ambC: 0xbfd8ff, sunC: 0xa8c8ff, sunI: 0.85 },
    words: ['太空站', '太空艙', '軌道站', '星艦'],
  },
  {
    key: 'temple', name: '黃金神殿', outdoor: false, trees: 0, pools: 'accent', roofHeight: 9,
    structs: ['pillars', 'aisles', 'rings', 'terraces', 'arches', 'towers'],
    tiles: { floor: T.marble, ground: T.marble, wall: T.gold, wall2: T.sandstone, pillar: T.marble,
      prop: T.gold, prop2: T.marble, accent: T.gold, block: T.marble, detail: T.marble,
      foliage: T.marble, trunk: T.sandstone, trunkTop: T.gold, roof: T.gold },
    atmos: { sky: 0xf0c98a, fog: 0xe8c48a, near: 22, far: 84, amb: 0.94, ambC: 0xfff0c8, sunC: 0xfff2c0, sunI: 1.0 },
    words: ['神殿', '神殿', '神域', '寶庫'],
  },
  {
    key: 'cave', name: '地下晶洞', outdoor: false, trees: 0, pools: 'accent', roofHeight: 6,
    structs: ['crystals', 'crystals', 'maze', 'pillars', 'boulders', 'pools', 'rooms'],
    tiles: { floor: T.stone, ground: T.stone, wall: T.cobble, wall2: T.basalt, pillar: T.basalt,
      prop: T.ice, prop2: T.obsidian, accent: T.ice, block: T.basalt, detail: T.stone,
      foliage: T.ice, trunk: T.basalt, trunkTop: T.ice, roof: T.stone },
    atmos: { sky: 0x0a0c12, fog: 0x0d1219, near: 7, far: 36, amb: 0.58, ambC: 0xbcd0ff, sunC: 0x90b0e0, sunI: 0.8 },
    words: ['晶洞', '地窟', '礦坑', '深穴'],
  },
  {
    key: 'classroom', name: '晚自習教室', outdoor: false, trees: 0, pools: 'accent', roofHeight: 8,
    structs: ['desks', 'desks', 'rooms', 'pillars', 'aisles'],
    tiles: { floor: T.floorGray, ground: T.floorGray, wall: T.wallPanelBlue, wall2: T.whiteBoard, pillar: T.wallPanelBlue,
      prop: T.deskTop, prop2: T.chairBlue, accent: T.boardGreen, block: T.deskSide, detail: T.ceilingWhite,
      foliage: T.boardGreen, trunk: T.deskSide, trunkTop: T.deskTop, roof: T.ceilingWhite },
    atmos: { sky: 0x9fb0c0, fog: 0xa8b8c6, near: 18, far: 68, amb: 0.86, ambC: 0xf0f6ff, sunC: 0xfff8e8, sunI: 0.85 },
    words: ['教室', '演講廳', '自習室', '講堂'],
  },
  {
    key: 'badminton', name: '羽球館', outdoor: false, trees: 0, pools: 'accent', roofHeight: 8,
    structs: ['courts', 'courts', 'aisles', 'towers'],
    tiles: { floor: T.courtGreen, ground: T.courtWall, wall: T.courtWall, wall2: T.bannerWhite, pillar: T.trussDark,
      prop: T.bannerWhite, prop2: T.courtWall, accent: T.courtLine, block: T.trussDark, detail: T.courtLine,
      foliage: T.bannerWhite, trunk: T.trussDark, trunkTop: T.bannerWhite, roof: T.trussDark },
    atmos: { sky: 0x707a84, fog: 0x78828c, near: 20, far: 76, amb: 0.84, ambC: 0xffffff, sunC: 0xfff4e0, sunI: 0.8 },
    words: ['羽球館', '體育館', '球館', '羽球場'],
  },
  {
    key: 'stadium', name: '城市足球場', outdoor: true, trees: 8, pools: 'none', roofHeight: 10,
    structs: ['stadium', 'stadium', 'towers', 'boulders'],
    tiles: { floor: T.pitchGreen, ground: T.asphalt, wall: T.bleacherWhite, wall2: T.bleacherBlue, pillar: T.buildingFacade,
      prop: T.buildingFacade, prop2: T.bleacherBlue, accent: T.whiteBoard, block: T.canopyWhite, detail: T.asphalt,
      foliage: T.leaves, trunk: T.buildingFacade, trunkTop: T.canopyWhite, roof: T.canopyWhite },
    atmos: { sky: 0x9dc4e8, fog: 0xb4d0ea, near: 34, far: 110, amb: 0.96, ambC: 0xffffff, sunC: 0xfff6e0, sunI: 1.0 },
    words: ['足球場', '球場', '主場', '綠茵場'],
  },
  {
    key: 'market', name: '夜市大街', outdoor: false, trees: 0, pools: 'none', roofHeight: 9,
    structs: ['market', 'market', 'stalls', 'towers'],
    tiles: { floor: T.asphalt, ground: T.asphalt, wall: T.buildingFacade, wall2: T.awningBlue, pillar: T.stallWood,
      prop: T.stallWood, prop2: T.lanternRed, accent: T.neonPurple, block: T.awningRed, detail: T.neonGreen,
      foliage: T.lanternRed, trunk: T.stallWood, trunkTop: T.awningBlue, roof: T.trussDark },
    atmos: { sky: 0x121016, fog: 0x1a1622, near: 10, far: 52, amb: 0.72, ambC: 0xffd8c0, sunC: 0xffb070, sunI: 0.75 },
    words: ['夜市', '大街', '市集', '攤販街'],
  },
  {
    key: 'school', name: '小學校門', outdoor: true, trees: 10, pools: 'none', roofHeight: 10,
    structs: ['school', 'school', 'trees', 'boulders'],
    tiles: { floor: T.plazaTile, ground: T.asphalt, wall: T.brickRed, wall2: T.schoolWindow, pillar: T.brickRed,
      prop: T.hedgeGreen, prop2: T.canopyWhite, accent: T.ledSign, block: T.canopyWhite, detail: T.barrierOrange,
      foliage: T.leaves, trunk: T.stallWood, trunkTop: T.logTop, roof: T.canopyWhite },
    atmos: { sky: 0x8fc4ea, fog: 0xbcd8ee, near: 42, far: 125, amb: 1.0, ambC: 0xffffff, sunC: 0xfff6e0, sunI: 1.0 },
    words: ['小學校門', '忠孝樓', '校園前庭', '大門口'],
  },
];

// 第 i 關用哪個主題（照順序輪，所以相鄰關卡一定不同主題）
export function themeOf(index) { return THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length]; }

// BOSS 關專用主題：魔法城堡村（參考 AlbertC 提供的魔法村照片：灰石砌牆、積雪斜屋頂、
// 紅磚煙囪、暖黃色店窗、石板街道，天空是明亮的藍天帶一點魔法粉紫）
export const BOSS_THEME = {
  key: 'castle', name: '魔法村城堡', outdoor: true, trees: 0, pools: 'none', roofHeight: 10, boss: true,
  tiles: { floor: T.cobbleStreet, ground: T.plazaTile, wall: T.cobble, wall2: T.shingleRoof, pillar: T.chimneyBrick,
    prop: T.shopWindow, prop2: T.stallWood, accent: T.plazaTile, block: T.snowRoof, detail: T.cobble,
    foliage: T.snowRoof, trunk: T.woodDoor, trunkTop: T.shingleRoof, roof: T.snowRoof },
  atmos: { sky: 0xa9c8e8, fog: 0xd8c8e8, near: 30, far: 104, amb: 0.98, ambC: 0xfff2ff, sunC: 0xfff4d8, sunI: 1.0 },
  words: ['魔法村', '活米村', '魔法城堡', '巫師村'],
};

// ============================== 隨機（可重現） ==============================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================== 共用工具 ==================================
const CX = Math.floor(SX / 2), CZ = Math.floor(SZ / 2);
let R = mulberry32(1);
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (arr) => arr[Math.floor(R() * arr.length)];
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillFloor(w, fn) {
  for (let x = 0; x < SX; x++)
    for (let z = 0; z < SZ; z++) w.set(x, 0, z, fn(x, z));
}

function perimeterWalls(w, h, blockId) {
  const gapChance = 0.18 + R() * 0.3;
  for (let y = 1; y <= h; y++) {
    for (let x = 0; x < SX; x++) {
      for (const z of [0, SZ - 1]) {
        if (y > h - 3 && R() < gapChance) continue;
        w.set(x, y, z, R() < 0.12 ? B.BRICK : blockId);
      }
    }
    for (let z = 0; z < SZ; z++) {
      for (const x of [0, SX - 1]) {
        if (y > h - 3 && R() < gapChance) continue;
        w.set(x, y, z, R() < 0.12 ? B.BRICK : blockId);
      }
    }
  }
}

function roofCover(w, y, holeChance) {
  for (let x = 1; x < SX - 1; x++)
    for (let z = 1; z < SZ - 1; z++) {
      if (R() < holeChance) continue;
      const beam = x % 7 === 0 || z % 7 === 0;
      w.set(x, y, z, beam ? B.DARK : B.CEIL);
    }
}

function clearArea(w, cx, cz, rad, maxY) {
  for (let x = cx - rad; x <= cx + rad; x++)
    for (let z = cz - rad; z <= cz + rad; z++)
      for (let y = 1; y <= maxY; y++) w.set(x, y, z, B.AIR);
}

function box(w, x, y, z, sw, sh, sd, id, hollow) {
  for (let dx = 0; dx < sw; dx++)
    for (let dy = 0; dy < sh; dy++)
      for (let dz = 0; dz < sd; dz++) {
        if (hollow && dx > 0 && dx < sw - 1 && dz > 0 && dz < sd - 1 && dy < sh - 1) continue;
        w.set(x + dx, y + dy, z + dz, id);
      }
}

function scatterBlocks(w, n, id, maxH) {
  for (let i = 0; i < n; i++) {
    const x = ri(2, SX - 3), z = ri(2, SZ - 3);
    if (Math.abs(x - CX) < 5 && Math.abs(z - CZ) < 5) continue;
    const h = ri(1, maxH || 2);
    for (let y = 1; y <= h; y++) if (w.get(x, y, z) === B.AIR || y === 1) w.set(x, y, z, id);
  }
}

function towerOf(w, x, z, h, id, capId) {
  for (let y = 1; y <= h; y++) w.set(x, y, z, id);
  if (capId) w.set(x, h + 1, z, capId);
}

function tree(w, x, z, h) {
  for (let y = 1; y <= h; y++) w.set(x, y, z, B.LOG);
  const top = h + 1;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = 0; dy <= 2; dy++) {
        const d = Math.abs(dx) + Math.abs(dz) + dy;
        if (d > 3 || (dx === 0 && dz === 0 && dy < 2)) continue;
        if (R() < 0.22) continue;
        if (w.get(x + dx, top + dy, z + dz) === B.AIR) w.set(x + dx, top + dy, z + dz, B.LEAF);
      }
}

// ============================== 結構產生器 ================================
// 每個結構都吃 (w, theme) 並用模組層級的 R 產生隨機形狀

function stPillars(w) {
  const step = ri(5, 9);
  const h = ri(3, 7);
  const id = R() < 0.3 ? B.BRICK : B.DARK;
  for (let x = 3; x < SX - 3; x += step)
    for (let z = 3; z < SZ - 3; z += step) {
      if (R() < 0.25) continue;
      towerOf(w, x, z, h + ri(-1, 1), id, R() < 0.3 ? B.HAZARD : null);
    }
}

function stAisles(w) {
  const vertical = R() < 0.5;
  const gapEvery = ri(5, 9);
  const rows = ri(3, 6);
  const h = ri(2, 4);
  const step = Math.floor((SX - 8) / rows);
  for (let i = 0; i < rows; i++) {
    const base = 4 + i * step + ri(0, 1);
    for (let t = 2; t < (vertical ? SX : SZ) - 2; t++) {
      if (t % gapEvery < 2) continue;                 // 走道缺口
      for (let y = 1; y <= h; y++) {
        const x = vertical ? t : base, z = vertical ? base : t;
        w.set(x, y, z, y === h ? B.CRATE : (R() < 0.3 ? B.BRICK : B.WALL));
      }
    }
  }
}

function stRoomGrid(w) {
  const step = ri(8, 12);
  const h = ri(3, 5);
  for (let gx = step; gx < SX - 2; gx += step)
    for (let z = 1; z < SZ - 1; z++) {
      if (z % ri(4, 6) === 0) continue;               // 門
      for (let y = 1; y <= h; y++) w.set(gx, y, z, R() < 0.4 ? B.BRICK : B.WALL);
    }
  for (let gz = step; gz < SZ - 2; gz += step)
    for (let x = 1; x < SX - 1; x++) {
      if (x % ri(4, 6) === 0) continue;
      for (let y = 1; y <= h; y++) w.set(x, y, gz, R() < 0.4 ? B.BRICK : B.WALL);
    }
}

function stMaze(w) {
  const cell = 4;                                     // 迷宮格
  const h = ri(2, 3);
  for (let gx = cell; gx < SX - 3; gx += cell)
    for (let z = 1; z < SZ - 1; z += cell) {
      const seg = ri(1, 3);
      for (let k = 0; k < seg; k++) {
        const zz = z + k;
        if (zz >= SZ - 1) break;
        for (let y = 1; y <= h; y++) w.set(gx, y, zz, B.WALL);
      }
    }
  for (let gz = cell; gz < SZ - 3; gz += cell)
    for (let x = 1; x < SX - 1; x += cell) {
      const seg = ri(1, 3);
      for (let k = 0; k < seg; k++) {
        const xx = x + k;
        if (xx >= SX - 1) break;
        for (let y = 1; y <= h; y++) w.set(xx, y, gz, B.WALL);
      }
    }
}

function stCatwalk(w) {
  const y = ri(3, 5);
  const wdt = ri(8, 16), dpt = ri(8, 14);
  const x0 = ri(3, SX - wdt - 4), z0 = ri(3, SZ - dpt - 4);
  for (let x = x0; x < x0 + wdt; x++)
    for (let z = z0; z < z0 + dpt; z++) {
      if (R() < 0.16) continue;                        // 破洞
      w.set(x, y, z, R() < 0.18 ? B.HAZARD : B.GRATE);
      for (let yy = y + 1; yy <= y + 3; yy++) w.set(x, yy, z, B.AIR);
    }
  // 支撐柱
  for (let x = x0; x < x0 + wdt; x += 5)
    for (let z = z0; z < z0 + dpt; z += 5)
      for (let yy = 1; yy < y; yy++) w.set(x, yy, z, B.DARK);
  // 上樓的階梯（從平台邊緣往中心走）
  const sx = x0 - 1, sz = z0 + Math.floor(dpt / 2);
  for (let s = 0; s < y; s++) {
    w.set(sx - s, s + 1, sz, B.CRATE);
    w.set(sx - s, s + 1, sz + 1, B.CRATE);
  }
}

function stTerraces(w) {
  const levels = ri(2, 4);
  const id = pick([B.WALL, B.BRICK, B.DARK]);
  for (let k = 0; k < levels; k++) {
    const pad = 3 + k * 3;
    const h = k + 1;
    for (let x = pad; x < SX - pad; x++)
      for (let z = pad; z < SZ - pad; z++) {
        if (R() < 0.1) continue;
        for (let y = 1; y <= h; y++) w.set(x, y, z, y === h ? id : B.FLOOR);
      }
  }
}

function stBoulders(w, theme) {
  const n = ri(10, 22);
  const id = pick([B.CRATE, B.BARREL, B.DARK]);
  for (let i = 0; i < n; i++) {
    const x = ri(3, SX - 4), z = ri(3, SZ - 4);
    if (Math.abs(x - CX) < 4 && Math.abs(z - CZ) < 4) continue;
    const s = ri(1, 3);
    box(w, x, 1, z, s, ri(1, 3), s, id);
  }
}

function stRings(w) {
  const rings = ri(2, 3);
  const id = pick([B.WALL, B.BRICK, B.DARK]);
  for (let k = 1; k <= rings; k++) {
    const rad = k * ri(5, 8);
    const h = ri(2, 4);
    const gapAngle = R() * Math.PI * 2;
    for (let a = 0; a < Math.PI * 2; a += 0.06) {
      const x = Math.round(CX + Math.cos(a) * rad);
      const z = Math.round(CZ + Math.sin(a) * rad);
      if (x < 1 || x >= SX - 1 || z < 1 || z >= SZ - 1) continue;
      let da = Math.abs(a - gapAngle);
      if (da > Math.PI) da = Math.PI * 2 - da;
      if (da < 0.35) continue;                         // 缺口
      for (let y = 1; y <= h; y++) w.set(x, y, z, id);
    }
  }
}

function stCrossWalls(w) {
  const h = ri(3, 5);
  const thick = ri(1, 2);
  for (let i = 0; i < 2; i++) {
    const vertical = i === 0;
    const pos = ri(8, (vertical ? SX : SZ) - 9);
    const gap = ri(4, (vertical ? SZ : SX) - 5);
    for (let t = 1; t < (vertical ? SZ : SX) - 1; t++) {
      if (Math.abs(t - gap) < 2) continue;             // 中間留門
      for (let k = 0; k < thick; k++) {
        const x = vertical ? pos + k : t, z = vertical ? t : pos + k;
        for (let y = 1; y <= h; y++) w.set(x, y, z, y === h ? B.CRATE : B.WALL);
      }
    }
  }
}

function stTowers(w) {
  const n = ri(5, 11);
  for (let i = 0; i < n; i++) {
    const x = ri(3, SX - 4), z = ri(3, SZ - 4);
    if (Math.abs(x - CX) < 5 && Math.abs(z - CZ) < 5) continue;
    towerOf(w, x, z, ri(2, 6), pick([B.CRATE, B.DARK, B.GREEN]), R() < 0.4 ? B.HAZARD : null);
  }
}

function stArches(w) {
  const n = ri(3, 6);
  for (let i = 0; i < n; i++) {
    const x = ri(4, SX - 8), z = ri(4, SZ - 8);
    const span = ri(3, 5), h = ri(3, 5);
    for (const dx of [0, span]) for (let y = 1; y <= h; y++) w.set(x + dx, y, z, B.WALL);
    for (let dx = 0; dx <= span; dx++) w.set(x + dx, h + 1, z, B.BRICK);
  }
}

function stPools(w) {
  const n = ri(3, 7);
  for (let i = 0; i < n; i++) {
    const x0 = ri(3, SX - 8), z0 = ri(3, SZ - 8);
    const sw = ri(3, 6), sd = ri(3, 6);
    for (let x = x0; x < x0 + sw; x++)
      for (let z = z0; z < z0 + sd; z++) {
        if (Math.abs(x - CX) < 4 && Math.abs(z - CZ) < 4) continue;
        if (R() < 0.2) continue;
        w.set(x, 0, z, B.HAZARD);                        // 地面換成主題的「強調材質」（岩漿／霓虹／水光）
      }
  }
}

function stTrees(w, theme) {
  const n = theme.trees || 0;
  for (let i = 0; i < n; i++) {
    const x = ri(3, SX - 4), z = ri(3, SZ - 4);
    if (Math.abs(x - CX) < 6 && Math.abs(z - CZ) < 6) continue;
    tree(w, x, z, ri(3, 5));
  }
}

function stCrystals(w) {
  const n = ri(6, 14);
  for (let i = 0; i < n; i++) {
    const x = ri(3, SX - 4), z = ri(3, SZ - 4);
    if (Math.abs(x - CX) < 4 && Math.abs(z - CZ) < 4) continue;
    towerOf(w, x, z, ri(1, 4), R() < 0.6 ? B.BARREL : B.CRATE, R() < 0.3 ? B.HAZARD : null);
  }
}

// --- 小學校門（參考 AlbertC 提供的校門口照片）：紅磚校舍＋鐘塔＋白色雨遮＋LED 跑馬燈＋橘色護欄＋綠籬 ---
function stSchool(w) {
  const zFront = 10;                        // 校舍正面（朝南）
  const zBack = 3;
  const x0 = 4, x1 = SX - 6;
  // 主校舍（兩層樓的紅磚量體，正面開窗帶）
  for (let x = x0; x <= x1; x++)
    for (let z = zBack; z < zFront; z++)
      for (let y = 1; y <= 6; y++) {
        const face = z === zFront - 1 || x === x0 || x === x1;
        if (!face && y < 6) continue;                       // 內部留空（省方塊）
        const win = face && (y === 2 || y === 4) && (x - x0) % 2 === 0;
        w.set(x, y, z, win ? B.BRICK : B.WALL);
      }
  // 屋頂白雨遮（校舍前緣伸出的白色遮雨棚）
  for (let x = 2; x <= SX - 3; x++)
    for (let z = zFront - 1; z <= zFront + 2; z++) w.set(x, 7, z, B.GREEN);
  // 入口雨遮＋支柱
  for (let x = CX - 8; x <= CX + 8; x++)
    for (let z = zFront + 1; z <= zFront + 5; z++) w.set(x, 5, z, B.GREEN);
  for (const px of [CX - 7, CX + 7])
    for (let y = 1; y <= 4; y++) w.set(px, y, zFront + 4, B.DARK);
  // 紅色 LED 跑馬燈（掛在入口雨遮下緣）
  for (let x = CX - 6; x <= CX + 6; x++)
    for (let y = 2; y <= 3; y++) w.set(x, y, zFront + 4, B.HAZARD);
  // 鐘塔（校舍右側，帶垂直窗縫）
  const tx = SX - 10, tz = zBack + 1;
  for (let x = tx; x <= tx + 3; x++)
    for (let z = tz; z <= tz + 3; z++)
      for (let y = 1; y <= 12; y++) {
        const edge = x === tx || x === tx + 3 || z === tz || z === tz + 3;
        if (!edge && y < 11) continue;
        const slit = (z === tz || z === tz + 3) && (y === 4 || y === 7) && (x === tx + 1);
        w.set(x, y, z, slit ? B.BRICK : B.WALL);
      }
  for (let x = tx - 1; x <= tx + 4; x++)
    for (let z = tz - 1; z <= tz + 4; z++) w.set(x, 13, z, B.GREEN);
  // 橘色施工護欄（橫在校門前，中間留一個出入口）
  for (let x = 3; x <= SX - 4; x++) {
    if (Math.abs(x - CX) < 3) continue;                      // 大門
    w.set(x, 1, zFront + 9, B.GRATE);
    if ((x - 3) % 6 === 0) w.set(x, 2, zFront + 9, B.GRATE);
  }
  // 綠籬與交通錐
  for (let x = 3; x < SX - 3; x += 1) {
    if (Math.abs(x - CX) < 4) continue;
    if (R() < 0.5) continue;
    w.set(x, 1, zFront + 7, B.CRATE);
    if (R() < 0.4) w.set(x, 2, zFront + 7, B.CRATE);
  }
  for (let i = 0; i < 10; i++) {
    const x = ri(4, SX - 5), z = ri(zFront + 10, SZ - 5);
    if (Math.abs(x - CX) < 3) continue;
    w.set(x, 1, z, B.BARREL);                                 // 白橘交通錐
  }
  // 門前柏油車道
  for (let x = 2; x < SX - 2; x++)
    for (let z = SZ - 7; z < SZ - 2; z++) w.set(x, 0, z, B.DIRT);
}

// 檢查一塊矩形區域是不是空的（避免房子/看台互相重疊）
function areaFree(w, x0, z0, sw, sd, maxY) {
  for (let x = x0; x < x0 + sw; x++)
    for (let z = z0; z < z0 + sd; z++)
      for (let y = 1; y <= maxY; y++) if (w.get(x, y, z) !== B.AIR) return false;
  return true;
}

// --- 教室：一排排課桌椅、講台、大黑板 ---
function stDesks(w) {
  const aisle = ri(5, 7);
  const rows = ri(4, 6);
  const dz = Math.max(2, Math.floor((SZ - 12) / rows));
  for (let r = 0; r < rows; r++) {
    const z = 5 + r * dz;
    if (z > SZ - 4) break;
    for (let x = 4; x < SX - 4; x++) {
      if (x % aisle < 1) continue;                  // 走道
      w.set(x, 1, z, B.CRATE);                      // 桌面
      w.set(x, 1, z + 1, B.BARREL);                 // 椅子
    }
  }
  // 黑板（貼在其中一面內牆）
  const bx = ri(2, 3) === 2 ? 2 : SX - 3;
  for (let z = 8; z < SZ - 8; z++)
    for (let y = 2; y <= 4; y++) w.set(bx, y, z, B.HAZARD);
  // 講桌
  const px = bx === 2 ? 5 : SX - 8;
  box(w, px, 1, CZ - 1, 3, 2, 3, B.GREEN);
  // 天花板燈板
  for (let x = 5; x < SX - 5; x += 6)
    for (let z = 5; z < SZ - 5; z += 6) w.set(x, 7, z, B.GRATE);
}

// --- 羽球館：多面綠色球場 + 白線 + 球網 + 場邊長椅 ---
function stCourts(w) {
  const cw = 9, cl = 15;
  for (let i = 0; i < 4; i++) {
    const x0 = 3 + (i % 2) * (cw + 3);
    const z0 = 3 + Math.floor(i / 2) * (cl + 3);
    if (x0 + cw >= SX - 2 || z0 + cl >= SZ - 2) continue;
    if (Math.abs(x0 + cw / 2 - CX) < 6 && Math.abs(z0 + cl / 2 - CZ) < 6) continue;
    const zc = z0 + Math.floor(cl / 2);
    for (let x = x0; x < x0 + cw; x++)
      for (let z = z0; z < z0 + cl; z++) {
        const line = x === x0 || x === x0 + cw - 1 || z === z0 || z === z0 + cl - 1 || z === zc;
        w.set(x, 0, z, line ? B.HAZARD : B.FLOOR);
      }
    for (let x = x0; x < x0 + cw; x++) w.set(x, 1, zc, B.CRATE);      // 球網
    w.set(x0, 2, zc, B.DARK); w.set(x0 + cw - 1, 2, zc, B.DARK);      // 網柱
    for (let z = z0; z < z0 + cl; z += 4) {                            // 場邊長椅
      w.set(x0 - 1, 1, z, B.BARREL); w.set(x0 - 1, 2, z, B.BARREL);
    }
  }
}

// --- 城市足球場：中央草皮＋球門，四周看台與白色頂棚，外圍高樓 ---
function stStadium(w) {
  const px0 = 10, pz0 = 10, pw = SX - 20, pd = SZ - 20;
  for (let x = px0 - 1; x <= px0 + pw; x++)
    for (let z = pz0 - 1; z <= pz0 + pd; z++) {
      const inPitch = x >= px0 && x < px0 + pw && z >= pz0 && z < pz0 + pd;
      if (!inPitch) { w.set(x, 0, z, B.DIRT); continue; }               // 場外跑道
      const line = x === px0 || x === px0 + pw - 1 || z === pz0 || z === pz0 + pd - 1 ||
        x === Math.floor(SX / 2) || z === Math.floor(SZ / 2);
      w.set(x, 0, z, line ? B.HAZARD : B.FLOOR);
    }
  for (const zz of [pz0, pz0 + pd - 1])                                 // 球門
    for (let x = CX - 2; x <= CX + 2; x++) {
      w.set(x, 1, zz, B.WALL); w.set(x, 2, zz, B.WALL);
    }
  // 看台：四周階梯座位（離球場越遠越高）
  for (let k = 1; k <= 3; k++) {
    const lo = 9 - k * 2, hi = SX - 9 + k * 2;
    for (let t = lo; t <= hi; t++) {
      for (const x of [lo, hi]) {
        if (x < 1 || x >= SX - 1 || t < 1 || t >= SZ - 1) continue;
        for (let y = 1; y <= k + 1; y++) w.set(x, y, t, y === k + 1 ? B.WALL : B.BARREL);
      }
      for (const z of [lo, hi]) {
        if (z < 1 || z >= SZ - 1 || t < 1 || t >= SX - 1) continue;
        for (let y = 1; y <= k + 1; y++) w.set(t, y, z, y === k + 1 ? B.WALL : B.BARREL);
      }
    }
  }
  // 外圍高樓（城市天際線）
  for (let i = 0; i < 16; i++) {
    const x = pick([ri(1, 3), ri(SX - 4, SX - 2), ri(4, SX - 5)]);
    const z = pick([ri(1, 3), ri(SZ - 4, SZ - 2), ri(4, SZ - 5)]);
    if (!areaFree(w, x, z, 2, 2, 4)) continue;
    const h = ri(5, 9);
    box(w, x, 1, z, 2, h, 2, B.DARK);
    w.set(x, h + 1, z, B.CRATE);
  }
  // 白色頂棚（看台上方）
  for (let t = 1; t <= 6; t++) {
    for (let x = 1; x < SX - 1; x++) { w.set(x, 8, t, B.GRATE); w.set(x, 8, SZ - 1 - t, B.GRATE); }
    for (let z = 1; z < SZ - 1; z++) { w.set(t, 8, z, B.GRATE); w.set(SX - 1 - t, 8, z, B.GRATE); }
  }
}

// --- 魔法村：一間間石屋（積雪斜屋頂＋煙囪＋暖黃窗）＋中央廣場 ---
function stVillage(w, count) {
  const n = count || ri(4, 7);
  let placed = 0, tries = 0;
  while (placed < n && tries < 80) {
    tries++;
    const hw = ri(3, 5), hd = ri(3, 4);
    const x0 = ri(3, SX - hw - 4), z0 = ri(3, SZ - hd - 4);
    if (Math.abs(x0 + hw / 2 - CX) < 8 && Math.abs(z0 + hd / 2 - CZ) < 8) continue;  // 中央留廣場
    if (!areaFree(w, x0 - 1, z0 - 1, hw + 2, hd + 2, 8)) continue;
    const h = ri(3, 5);
    // 石牆（中空）
    for (let y = 1; y <= h; y++)
      for (let x = x0; x < x0 + hw; x++)
        for (let z = z0; z < z0 + hd; z++) {
          const edge = x === x0 || x === x0 + hw - 1 || z === z0 || z === z0 + hd - 1;
          if (edge) w.set(x, y, z, B.WALL);
        }
    // 斜屋頂（往兩側收，積雪）
    for (let k = 0; k <= Math.floor(hw / 2); k++) {
      const y = h + 1 + k;
      for (let z = z0 - k; z < z0 + hd + k; z++) {
        const xl = x0 + k, xr = x0 + hw - 1 - k;
        if (xl <= xr) { w.set(xl, y, z, B.GREEN); w.set(xr, y, z, B.GREEN); }
        if (xl === xr) w.set(xl, y, z, B.GREEN);
      }
    }
    // 暖黃色店窗
    for (let x = x0 + 1; x < x0 + hw - 1; x += 2) {
      w.set(x, 2, z0, B.CRATE);
      w.set(x, 2, z0 + hd - 1, B.CRATE);
    }
    // 煙囪
    const cxp = x0 + 1, czp = z0 + 1;
    for (let y = h + 1; y <= h + 3; y++) w.set(cxp, y, czp, B.DARK);
    placed++;
  }
}

// --- 夜市：兩排攤位夾著一條街，遮雨棚＋紅燈籠＋霓虹招牌 ---
function stMarket(w) {
  const laneA = CX - 5, laneB = CX + 4;
  let alt = 0;
  for (let z = 3; z < SZ - 4; z += 5) {
    alt++;
    if (Math.abs(z - CZ) < 5) continue;                 // 出生點前留空
    for (const side of [laneA, laneB]) {
      const x0 = side <= CX ? side - 1 : side;
      box(w, x0, 1, z, 2, 2, 3, B.CRATE);               // 攤位櫃台
      for (let dx = 0; dx < 3; dx++)                     // 遮雨棚（紅藍交替）
        for (let dz = 0; dz < 4; dz++) w.set(x0 + dx, 3, z + dz, alt % 2 ? B.GREEN : B.BRICK);
      w.set(side <= CX ? x0 + 2 : x0 - 1, 3, z + 1, B.BARREL);   // 紅燈籠
    }
  }
  // 霓虹招牌柱
  for (let i = 0; i < 10; i++) {
    const x = ri(4, SX - 5), z = ri(4, SZ - 5);
    if (Math.abs(x - CX) < 3 && Math.abs(z - CZ) < 4) continue;
    towerOf(w, x, z, ri(2, 5), B.DARK, B.HAZARD);
  }
}

// --- 魔法村 BOSS 場地：中央廣場＋環繞的石屋村落＋四面城堡主塔 ---
function stCastleVillage(w) {
  // 中央廣場（石板）
  for (let x = CX - 9; x <= CX + 9; x++)
    for (let z = CZ - 9; z <= CZ + 9; z++)
      if (Math.hypot(x - CX, z - CZ) < 9.5) w.set(x, 0, z, B.HAZARD);
  // 四面城堡塔樓（高塔＋斜屋頂）
  for (const [tx, tz] of [[CX - 13, CZ - 13], [CX + 13, CZ - 13], [CX - 13, CZ + 13], [CX + 13, CZ + 13]]) {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) < 2 && Math.abs(dz) < 2 && (dx !== 0 || dz !== 0)) continue;
        if (tx + dx < 1 || tx + dx >= SX - 1 || tz + dz < 1 || tz + dz >= SZ - 1) continue;
        for (let y = 1; y <= 11; y++) w.set(tx + dx, y, tz + dz, y > 8 ? B.BRICK : B.WALL);
      }
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) w.set(tx + dx, 12, tz + dz, B.GREEN);
    w.set(tx, 13, tz, B.DARK);
  }
  // 村落房屋
  stVillage(w, ri(3, 5));
  // 廣場上的木箱/攤車
  for (let i = 0; i < 8; i++) {
    const a = R() * Math.PI * 2, rad = 6 + R() * 6;
    const x = Math.round(CX + Math.cos(a) * rad), z = Math.round(CZ + Math.sin(a) * rad);
    if (Math.hypot(x - CX, z - CZ) < 4) continue;
    box(w, x, 1, z, 2, 1, 2, B.BARREL);
  }
}

// 從出生點往三個方向開路，保證一定走得出去（不會有走不到的敵人）
function carveRoads(w) {
  const dirs = shuffled([[1, 0], [-1, 0], [0, 1], [0, -1]]).slice(0, ri(2, 4));
  for (const [dx, dz] of dirs) {
    let x = CX, z = CZ;
    while (x > 1 && x < SX - 2 && z > 1 && z < SZ - 2) {
      for (let ox = 0; ox < 2; ox++)
        for (let oz = 0; oz < 2; oz++)
          for (let y = 1; y <= 3; y++) w.set(x + ox, y, z + oz, B.AIR);   // 只挖到 3 格高（像走道穿過去，不會把房子挖一個大洞）
      if (R() < 0.22) { const sw = R() < 0.5 ? 0 : 1; x += sw ? dx : 0; z += sw ? 0 : dz; }
      x += dx; z += dz;
    }
  }
}

// 從出生點洪水填充，標出真正走得到的格子
function computeReach(w) {
  w.reach = new Uint8Array(SX * SY * SZ);
  // 出生點必須站得住（buildLevel 最後有清空），否則整張圖當作全通
  if (!w.standable(CX, CZ)) {
    w.reach.fill(1);
    return;
  }
  const q = [[CX, CZ]];
  const seen = new Set([CX + ',' + CZ]);
  w.reach[w.idx(CX, 0, CZ)] = 1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of DIRS) {
      // 直接走過去，或跨過一格高的台階
      const nx = x + dx, nz = z + dz;
      const stepUp = w.get(nx, 1, nz) !== 0 && w.get(nx, 2, nz) === 0 && w.get(nx, 3, nz) === 0;
      const ok = w.standable(nx, nz) || stepUp;
      if (!ok) continue;
      const key = nx + ',' + nz;
      if (seen.has(key)) continue;
      seen.add(key);
      w.reach[w.idx(nx, 0, nz)] = 1;
      q.push([nx, nz]);
    }
  }
}

// ============================== 關卡入口 ==================================
export function buildLevel(w, index, boss) {
  R = mulberry32((0x9e3779b9 ^ (index * 2654435761) ^ (index << 13)) >>> 0);
  const theme = boss ? BOSS_THEME : themeOf(index);
  w.blocks.fill(0);
  w.theme = theme;

  // 地板（主題材質 + 隨機斑塊）
  fillFloor(w, () => (R() < 0.08 ? B.DIRT : (R() < 0.06 ? B.GRATE : B.FLOOR)));
  perimeterWalls(w, theme.roofHeight, B.WALL);
  if (!theme.outdoor) roofCover(w, theme.roofHeight, 0.03 + R() * 0.06);

  // ---- BOSS 關：迪士尼風格的魔法城堡中庭 ----
  if (boss) {
    clearArea(w, CX, CZ, 5, 8);
    stCastleVillage(w);
    scatterBlocks(w, ri(6, 10), B.CRATE, 2);
    carveRoads(w);
    clearArea(w, CX, CZ, 4, 7);
    computeReach(w);
    return theme;
  }

  // 挑 3~5 種結構（每個主題只用自己的地形風格：森林長樹、太空站長房間…）
  const pool = shuffled(theme.structs || ['pillars', 'aisles', 'rooms', 'boulders', 'rings', 'towers', 'pools']);
  const want = 3 + Math.floor(R() * 3);
  const used = [];
  for (const key of pool) {
    if (used.length >= want) break;
    if (key === 'rooms' && used.includes('maze')) continue;
    if (key === 'maze' && used.includes('rooms')) continue;
    if (key === 'rings' && used.includes('terraces')) continue;
    used.push(key);
  }

  clearArea(w, CX, CZ, 4, 7);              // 出生點先淨空
  for (const key of used) {
    switch (key) {
      case 'pillars': stPillars(w); break;
      case 'aisles': stAisles(w); break;
      case 'rooms': stRoomGrid(w); break;
      case 'maze': stMaze(w); break;
      case 'catwalk': stCatwalk(w); break;
      case 'terraces': stTerraces(w); break;
      case 'boulders': stBoulders(w, theme); break;
      case 'rings': stRings(w); break;
      case 'cross': stCrossWalls(w); break;
      case 'towers': stTowers(w); break;
      case 'arches': stArches(w); break;
      case 'trees': stTrees(w, theme); break;
      case 'crystals': stCrystals(w); break;
      case 'pools': stPools(w); break;
      case 'desks': stDesks(w); break;
      case 'courts': stCourts(w); break;
      case 'stadium': stStadium(w); break;
      case 'village': stVillage(w); break;
      case 'market': stMarket(w); break;
      case 'stalls': stMarket(w); break;
      case 'school': stSchool(w); break;
    }
  }

  if (theme.pools === 'accent') stPools(w);          // 主題性地板裝飾（岩漿/霓虹/水光）
  scatterBlocks(w, ri(8, 20), pick([B.CRATE, B.BARREL]), 3);
  carveRoads(w);
  clearArea(w, CX, CZ, 3, 6);
  computeReach(w);
  return theme;
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
  const theme = world.theme || THEMES[0];

  const solid = (x, y, z) => world.isSolid(x, y, z);

  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const id = world.get(x, y, z);
        if (id === B.AIR) continue;

        for (const f of FACES) {
          const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
          if (solid(nx, ny, nz)) continue; // face hidden

          const tile = tileForFace(theme, id, f.n);
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
