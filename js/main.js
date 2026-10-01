import * as THREE from 'three';
import { World, buildLevel, buildMesh, SX, SZ } from './world.js';
import { Player } from './player.js';
import { WeaponManager, WEAPONS } from './weapons.js';
import { EnemyManager } from './enemies.js';
import { Controls } from './controls.js';
import { LEVELS, levelConfig, isBossLevel, rewardFor, layoutIndex, DIFFICULTIES, difficulty, difficultyIndex, setDifficulty } from './levels.js';
import { Ally } from './ally.js';
import { Radar } from './radar.js';
import { Boss } from './boss.js';

// ------------------------------ DOM --------------------------------------
const app = document.getElementById('app');
const hud = document.getElementById('hud');
const touch = document.getElementById('touch');
const overlay = document.getElementById('overlay');
const el = (id) => document.getElementById(id);

// iPad 上「滑動後點一下」經常不會產生 click 事件（被當成滑動手勢吃掉），
// 所以重要按鈕（商店／開始）改吃 pointerdown，click 只當備援，並用時間戳避免觸發兩次。
function onTap(target, fn) {
  let last = 0;
  const run = (e) => {
    const now = performance.now();
    if (now - last < 400) return;
    last = now;
    if (e.cancelable) e.preventDefault();
    fn(e);
  };
  target.addEventListener('pointerdown', run, { passive: false });
  target.addEventListener('click', run);
}

// ---------------------------- renderer -----------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x9a8a72);
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9a8a72);
scene.fog = new THREE.Fog(0x8f8068, 26, 78);

const camera = new THREE.PerspectiveCamera(78 /* BASE_FOV, see state below */, window.innerWidth / window.innerHeight, 0.05, 240);
scene.add(camera);

const ambient = new THREE.AmbientLight(0xffffff, 0.78);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff0d0, 0.9);
sun.position.set(0.4, 1, 0.35);
scene.add(sun);

// per-level atmosphere (sky / fog / light) — a distinct mood for each level
const ATMOS = [
  { sky: 0x9a8a72, fog: 0x8f8068, near: 26, far: 78, amb: 0.78, ambC: 0xffffff, sunC: 0xfff0d0, sunI: 0.90 },
  { sky: 0x87939c, fog: 0x7e8a93, near: 22, far: 64, amb: 0.72, ambC: 0xeaf2ff, sunC: 0xdfeaff, sunI: 0.85 },
  { sky: 0x6b4038, fog: 0x5c3832, near: 10, far: 42, amb: 0.52, ambC: 0xffd8b0, sunC: 0xffa860, sunI: 0.60 },
  { sky: 0x8d8778, fog: 0x807a6c, near: 18, far: 58, amb: 0.74, ambC: 0xfaeed2, sunC: 0xf6e8c8, sunI: 0.85 },
  { sky: 0x3c4a5e, fog: 0x35404f, near: 20, far: 68, amb: 0.58, ambC: 0xc8dcff, sunC: 0xbcd4ff, sunI: 0.70 },
];
// BOSS 關專用氣氛：血紅、霧很近，壓迫感
const BOSS_ATMOS = { sky: 0x3a1010, fog: 0x2a0c0c, near: 14, far: 58, amb: 0.76, ambC: 0xffc0b0, sunC: 0xff7a54, sunI: 0.95 };

// ----------------------------- world -------------------------------------
const spawnX = Math.floor(SX / 2) + 0.5;
const spawnZ = Math.floor(SZ / 2) + 0.5;

let world = new World();
buildLevel(world, 0);
let levelMesh = buildMesh(world);
scene.add(levelMesh);

const player = new Player(world, spawnX, 1.2, spawnZ);

// --------------------------- systems -------------------------------------
const enemyMgr = new EnemyManager(scene);
const controls = new Controls(touch, renderer.domElement);
const weapons = new WeaponManager(camera, world, enemyMgr);
const ally = new Ally(scene, world, spawnX + 2.5, spawnZ + 0.5);
const radar = new Radar(el('radar'));

// BOSS 召喚小兵時提示一下
enemyMgr.onSummon = (n) => showMsg(`☠ BOSS 召喚了 ${n} 隻增援！`, 1.8);

window.__game = {
  player, enemyMgr, weapons, ally, controls, camera, scene, renderer, radar,
  get world() { return world; },
  debug: () => ({
    levelIndex, levelActive, betweenLevels, levelTimer, running, won, frames,
    listLen: enemyMgr.list.length, alive: enemyMgr.aliveCount(),
    boss: enemyMgr.boss ? { name: enemyMgr.boss.name, hp: Math.ceil(enemyMgr.boss.health), max: enemyMgr.boss.maxHealth, state: enemyMgr.boss.state, freeze: +enemyMgr.boss.freeze.toFixed(1) } : null,
    pendingWalls: weapons.walls.length, liveGrenades: weapons.projectiles.length,
    draws: renderer.info.render.calls, tris: renderer.info.render.triangles,
    money, shopOpen, shopPending, shopBossMode, weaponIndex: weapons.index,
    paused, savedAt: lastSavedAt,
    difficulty: difficulty().name, difficultyIndex: difficultyIndex(),
    scoped, fov: +camera.fov.toFixed(1), lookScale: +lookScale.toFixed(2),
    weaponsOwned: WEAPONS.map((w) => !w.locked),
    frozen: enemyMgr.list.filter((e) => e.alive && e.freeze > 0).length,
    invuln: +(player.invuln || 0).toFixed(2),
    allyInvuln: +(ally.invuln || 0).toFixed(2),
  }),
  gotoLevel: (i) => loadLevel(i),
  gotoBoss: () => loadLevel(9),          // 第 10 關（第一隻 BOSS）
  openShop: () => openShop(),
  giveMoney: (v) => { money += v; updateHUD(); if (shopOpen) renderShop(); return money; },
  bossShop: () => { shopBossMode = true; openShop(); },   // 測試：開 BOSS 前商店
  buy: (name) => buyByName(name),
  kick: () => { for (const e of enemyMgr.list) e.takeDamage(9999, null); },
  // 存檔 / 暫停（測試與自動化用）
  save: () => saveGame(),
  loadSave: () => loadSave(),
  clearSave: () => clearSave(),
  pause: (v) => setPaused(v === undefined ? true : v),
  isPaused: () => paused,
  menu: () => backToMenu(),
  snapshot: () => snapshot(),
  difficulties: () => DIFFICULTIES.map((d) => d.name),
  pickDifficulty: (i) => pickDifficulty(i),
};

// ----------------------------- state -------------------------------------
const BASE_FOV = 78;      // normal field of view
const SCOPE_FOV = 20;     // sniper scope zoom (≈4x)
const SNIPER = 5;         // WEAPONS index of the sniper rifle

let running = false;
let prevFiring = false;
let kills = 0;
let respawning = false;
let won = false;
let levelIndex = 0;
let levelActive = false;
let betweenLevels = false;
let levelTimer = 0;
let frames = 0;
let money = 0;
let shopOpen = false;
let shopPending = false;
let shopBossMode = false;   // 下一關是 BOSS → 商店開賣超強武器
let scoped = false;       // sniper scope engaged
let lookScale = 1;        // look sensitivity scales with the zoom
let last = performance.now();

// ------------------------------ HUD --------------------------------------
const PITCH_LIMIT = Math.PI / 2 - 0.05;

controls.onLook = (dYaw, dPitch) => {
  // look sensitivity follows the scope zoom so aiming stays precise
  player.yaw += dYaw * lookScale;
  player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch + dPitch * lookScale));
};

function showHitmarker() {
  const hm = el('hitmarker');
  hm.classList.add('show');
  clearTimeout(hm._t);
  hm._t = setTimeout(() => hm.classList.remove('show'), 90);
}

function showDamage() {
  const v = el('damage-vignette');
  v.classList.add('show');
  clearTimeout(v._t);
  v._t = setTimeout(() => v.classList.remove('show'), 90);
}

let msgTimer = null;
function showMsg(text, seconds) {
  const m = el('msg');
  m.textContent = text;
  m.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('show'), (seconds || 2) * 1000);
}

weapons.onHit = (kind) => {
  if (kind === 'enemy') showHitmarker();
  else if (kind === 'kill') { showHitmarker(); kills++; el('kills').textContent = kills; }
};
weapons.onAmmo = () => updateAmmo();

function updateAmmo() {
  const w = WEAPONS[weapons.index];
  el('weapon-name').textContent = w.name;
  const a = weapons.ammo[weapons.index];
  el('ammo-cur').textContent = w.kind === 'melee' ? '∞' : a;
  el('ammo-max').textContent = w.kind === 'melee' ? '' : '/' + w.mag;
  controls.setAimAvailable(weapons.index === SNIPER);   // 瞄準 button only with the sniper
}

function updateHUD() {
  const pct = Math.max(0, player.health) / player.maxHealth;
  const bar = el('hp-bar');
  bar.style.width = (pct * 100) + '%';
  bar.style.background = pct > 0.5 ? 'linear-gradient(90deg,#38d15f,#7fe36a)'
    : pct > 0.25 ? 'linear-gradient(90deg,#e0a020,#f0c040)'
    : 'linear-gradient(90deg,#c03030,#e05050)';
  el('hp-text').textContent = Math.max(0, Math.round(player.health));
  // 重生無敵倒數
  const inv = player.invuln > 0 ? player.invuln : 0;
  el('ward').classList.toggle('hidden', inv <= 0);
  if (inv > 0) el('ward-sec').textContent = inv.toFixed(1);
  el('level').textContent = levelIndex + 1;
  el('diff-label').textContent = difficulty().name;
  el('enemies-left').textContent = enemyMgr.aliveCount();
  el('ally-hp').textContent = ally.alive ? Math.round(ally.health) : '陣亡';
  el('money').textContent = money;
  el('kills').textContent = kills;
  updateBossBar();
  updateAmmo();
}

// BOSS 血條（只有 BOSS 活著時才出現）
function updateBossBar() {
  const bar = el('bossbar');
  if (!bar) return;
  const boss = enemyMgr.boss;
  if (!boss) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  el('bb-name').textContent = `☠ ${boss.name}`;
  const pct = Math.max(0, boss.health) / boss.maxHealth;
  const fill = el('bb-fill');
  fill.style.width = (pct * 100) + '%';
  fill.style.background = pct > 0.5 ? 'linear-gradient(90deg,#ff5a3c,#ffb347)'
    : pct > 0.2 ? 'linear-gradient(90deg,#ff7a2a,#ffcf5a)'
    : 'linear-gradient(90deg,#c02020,#ff4b4b)';
  el('bb-hp').textContent = Math.ceil(boss.health) + ' / ' + boss.maxHealth;
}

function onPlayerHit() { showDamage(); }

// ------------------------- level loading ---------------------------------
function loadLevel(i) {
  levelIndex = Math.max(0, i);                 // 無盡模式：關卡一直下去
  const cfg = levelConfig(levelIndex);

  // rebuild the factory with a new layout seed
  scene.remove(levelMesh);
  levelMesh.geometry.dispose();
  levelMesh.material.dispose();
  world = new World();
  buildLevel(world, layoutIndex(levelIndex));   // 場景每 5 關循環一次
  levelMesh = buildMesh(world);
  scene.add(levelMesh);

  // apply this level's atmosphere (BOSS 關用血紅氣氛)
  const at = cfg.boss ? BOSS_ATMOS : ATMOS[layoutIndex(levelIndex) % ATMOS.length];
  scene.background = new THREE.Color(at.sky);
  scene.fog.color.setHex(at.fog);
  scene.fog.near = at.near;
  scene.fog.far = at.far;
  ambient.color.setHex(at.ambC);
  ambient.intensity = at.amb;
  sun.color.setHex(at.sunC);
  sun.intensity = at.sunI;

  // point systems at the new world
  player.world = world;
  weapons.world = world;
  weapons.clearEffects();      // 清掉上一關留下的榴彈／岩漿牆

  // reset player (full heal) + weapons
  player.respawn(spawnX, 1.2, spawnZ);
  weapons.ammo = WEAPONS.map((w) => w.mag);
  // keep the gun you were carrying (if you bought it) instead of forcing the pistol
  const keep = WEAPONS[weapons.index] && !WEAPONS[weapons.index].locked ? weapons.index : 0;
  if (keep !== weapons.index) weapons.switchTo(keep); else weapons.reloading = 0;
  controls.setActiveWeapon(weapons.index);
  radar.invalidate();

  // spawn this level's enemies (+ BOSS)
  enemyMgr.clear();
  enemyMgr.spawn(world, cfg, spawnX, spawnZ);
  if (cfg.boss) spawnBoss(world, cfg);
  ally.world = world;
  ally.reset(spawnX + 2.5, spawnZ + 0.5);

  levelActive = true;
  betweenLevels = false;
  levelTimer = 0;
  updateHUD();
  if (running) saveGame();      // 每關開始就是一個存檔點
}

// 在離玩家出生點一段距離、且夠高夠空曠的地方放 BOSS
function spawnBoss(world, cfg) {
  let bx = Math.floor(SX / 2) + 0.5, bz = Math.floor(SZ / 2) + 0.5;
  for (let tries = 0; tries < 500; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 8;
    const x = Math.round(spawnX + Math.cos(a) * r);
    const z = Math.round(spawnZ + Math.sin(a) * r);
    if (x < 4 || x > SX - 5 || z < 4 || z > SZ - 5) continue;
    if (world.get(x, 0, z) === 0) continue;
    let clear = true;
    for (let y = 1; y <= 5; y++) if (world.get(x, y, z) !== 0) { clear = false; break; }
    if (!clear) continue;
    bx = x + 0.5; bz = z + 0.5;
    break;
  }
  const boss = new Boss(world, bx, bz, cfg);
  enemyMgr.addBoss(boss);
  return boss;
}

// ------------------------- money / upgrades / shop ------------------------
const LEVEL_REWARD = 100; // $ per level cleared

const UPGRADES = [
  { name: '手槍強化', desc: '手槍傷害 +12', price: 70, apply: () => { WEAPONS[0].damage += 12; } },
  { name: '機槍強化', desc: '機槍傷害 +6', price: 70, apply: () => { WEAPONS[1].damage += 6; } },
  { name: '彈匣擴充', desc: '槍械彈匣 +50%（立刻補滿子彈）', price: 80, apply: () => { WEAPONS.forEach((w) => { if (w.kind !== 'melee') w.mag = Math.round(w.mag * 1.5); }); weapons.ammo = WEAPONS.map((w) => w.mag); } },
  { name: '小刀強化', desc: '小刀傷害 +40', price: 50, apply: () => { WEAPONS[2].damage += 40; } },
  { name: '防彈背心', desc: '最大生命 +25（立刻補滿）', price: 90, apply: () => { player.maxHealth += 25; player.health = player.maxHealth; } },
  { name: '戰術鞋', desc: '移動速度 +15%', price: 60, apply: () => { player.speed *= 1.15; } },
  { name: '槍械改裝', desc: '手槍／機槍射速 +15%', price: 100, apply: () => { WEAPONS[0].rate *= 0.85; WEAPONS[1].rate *= 0.85; } },
];

// -------- shop rows -------------------------------------------------------
function sectionTitle(text) {
  const h = document.createElement('div');
  h.className = 'shop-sec';
  h.textContent = text;
  return h;
}

function makeRow({ name, desc, price, cls, canBuy, owned, onBuy }) {
  const row = document.createElement('div');
  row.className = 'shop-item' + (cls ? ' ' + cls : '') + (owned ? ' owned' : (canBuy ? '' : ' cant'));
  const info = document.createElement('div');
  info.className = 'info';
  const nm = document.createElement('div');
  nm.className = 'nm';
  nm.textContent = name;
  if (owned) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = '已擁有';
    nm.appendChild(t);
  }
  const ds = document.createElement('div');
  ds.className = 'ds';
  ds.textContent = desc;
  info.appendChild(nm);
  info.appendChild(ds);
  const btn = document.createElement('button');
  btn.className = 'buy';
  btn.textContent = owned ? '✅ 已入手' : '$' + price;
  btn.disabled = !!owned;
  if (!owned) onTap(btn, onBuy);
  row.appendChild(info);
  row.appendChild(btn);
  return row;
}

function unlockWeaponButton(i) {
  const btn = document.querySelector(`.wbtn[data-w="${i}"]`);
  if (!btn) return;
  btn.classList.remove('locked');
  const ico = btn.dataset.ico || '🔫';
  const lbl = btn.dataset.lbl || WEAPONS[i].name;
  btn.innerHTML = ico + '<small>' + lbl + '</small>';
}

function buyWeapon(i) {
  const w = WEAPONS[i];
  if (!w || !w.locked || money < w.price) return false;
  money -= w.price;
  w.locked = false;
  weapons.ammo[i] = w.mag;
  weapons.switchTo(i);
  controls.setActiveWeapon(weapons.index);
  unlockWeaponButton(i);
  updateHUD();
  updateAmmo();
  renderShop();
  return true;
}

function buyByName(name) {
  const i = WEAPONS.findIndex((w) => w.name === name);
  return i < 0 ? false : buyWeapon(i);
}

function renderShop() {
  el('shop-money').textContent = money;
  const box = el('shop-items');
  box.innerHTML = '';

  // BOSS 前的補給站：上面掛警告，並開賣超強武器
  const bossShop = shopBossMode;
  const note = el('shop-boss-note');
  if (note) {
    note.classList.toggle('hidden', !bossShop);
    if (bossShop) note.textContent = `⚠️ 下一關是 BOSS（第 ${levelIndex + 2} 關）— 超強武器只在這裡賣！`;
  }

  // --- 0) 超強武器（只有 BOSS 前的補給站才有） ---
  if (bossShop) {
    const bossGuns = WEAPONS.map((w, i) => (w.bossOnly && w.price ? i : -1)).filter((i) => i >= 0);
    if (bossGuns.length) {
      box.appendChild(sectionTitle('⭐ 超強武器（BOSS 限定販售）'));
      for (const i of bossGuns) {
        const w = WEAPONS[i];
        box.appendChild(makeRow({
          name: w.name,
          desc: w.desc,
          price: w.price,
          cls: 'gun super',
          owned: !w.locked,
          canBuy: money >= w.price,
          onBuy: () => buyWeapon(i),
        }));
      }
    }
  }

  // --- 1) 大範圍（爆炸）武器：普通補給站就買得到 ---
  const aoeIdx = WEAPONS.map((w, i) => (w.price && !w.bossOnly && w.aoe ? i : -1)).filter((i) => i >= 0);
  if (aoeIdx.length) {
    box.appendChild(sectionTitle('💥 大範圍武器（爆炸半徑內全體受傷 · 永久擁有）'));
    for (const i of aoeIdx) {
      const w = WEAPONS[i];
      box.appendChild(makeRow({
        name: w.name,
        desc: w.desc || `傷害 ${w.damage} · 爆炸半徑 ${w.blast}`,
        price: w.price,
        cls: 'gun aoe',
        owned: !w.locked,
        canBuy: money >= w.price,
        onBuy: () => buyWeapon(i),
      }));
    }
  }

  // --- 2) 一般槍枝（永久擁有） ---
  const gunIdx = WEAPONS.map((w, i) => (w.price && !w.bossOnly && !w.aoe ? i : -1)).filter((i) => i >= 0);
  if (gunIdx.length) {
    box.appendChild(sectionTitle('🔫 買槍（永久擁有 · 用 1～0 或右上按鈕切換）'));
    for (const i of gunIdx) {
      const w = WEAPONS[i];
      box.appendChild(makeRow({
        name: w.name,
        desc: w.desc || `傷害 ${w.damage} · 彈匣 ${w.mag}`,
        price: w.price,
        cls: 'gun',
        owned: !w.locked,
        canBuy: money >= w.price,
        onBuy: () => buyWeapon(i),
      }));
    }
  }

  // --- 2) stat upgrades (repeatable) ---
  box.appendChild(sectionTitle('🔧 強化（可重複買）'));
  for (const u of UPGRADES) {
    box.appendChild(makeRow({
      name: u.name,
      desc: u.desc,
      price: u.price,
      canBuy: money >= u.price,
      onBuy: () => {
        if (money < u.price) return;
        money -= u.price;
        u.apply();
        updateHUD();
        updateAmmo();
        renderShop();
      },
    }));
  }
}

function openShop() {
  shopOpen = true;
  prevFiring = false;
  el('shop').classList.remove('hidden');
  el('touch').classList.add('hidden');
  renderShop();
  updateHUD();
}

onTap(el('btn-shop-continue'), () => {
  if (!shopOpen) return;                       // 保險：不能連點兩次
  el('shop').classList.add('hidden');
  el('touch').classList.remove('hidden');
  shopOpen = false;
  shopBossMode = false;
  loadLevel(levelIndex + 1);
  saveGame();                                  // 買完 / 進新關都存一次
  showMsg(levelBanner(), 2.6);
});

function levelBanner() {
  const cfg = levelConfig(levelIndex);
  return cfg.boss ? `⚠️ BOSS 關！第 ${levelIndex + 1} 關：${cfg.name}` : `第 ${levelIndex + 1} 關：${cfg.name}`;
}

// ---------------------------- 存檔 / 暫停 ---------------------------------
// 存檔優先寫到「這台電腦」（serve.py 的 /api/save → save.json），
// 連不到伺服器（例如之後放到 Netlify）才退回瀏覽器 localStorage。
const SAVE_API = 'api/save';
const SAVE_LS = 'voxelfactory.save.v1';

// 開局時的原始數值：升級是直接改 WEAPONS/player 的數字，所以「新遊戲」要整份還原
const BASE_WEAPONS = WEAPONS.map((w) => ({ damage: w.damage, rate: w.rate, mag: w.mag, locked: !!w.locked }));
const BASE_PLAYER = { maxHealth: player.maxHealth, speed: player.speed };

let paused = false;
let lastSavedAt = 0;
let diffPicked = false;     // 這次開主選單有沒有自己動過「敵人強度」

const DIFF_TAG = { easy: '敵人較軟', normal: '標準', hard: '敵人更硬', hell: '最兇' };

// 主選單的「敵人強度」按鈕（也會寫進存檔，讀檔會沿用）
function pickDifficulty(i) {
  setDifficulty(i);
  diffPicked = true;
  syncDifficultyUI();
  if (running) { saveGame(); showMsg(`敵人強度：${difficulty().name}`, 1.6); }
}

function syncDifficultyUI() {
  const cur = difficulty();
  document.querySelectorAll('#diff-row .dbtn').forEach((b) => {
    b.classList.toggle('active', +b.dataset.d === difficultyIndex());
  });
  const desc = el('diff-desc');
  if (desc) desc.textContent = `${cur.ico} ${cur.name}：${cur.desc}`;
  const label = el('diff-label');
  if (label) label.textContent = cur.name;
}

function buildDifficultyUI() {
  const row = el('diff-row');
  if (!row) return;
  row.innerHTML = '';
  DIFFICULTIES.forEach((d, i) => {
    const b = document.createElement('div');
    b.className = 'dbtn';
    b.dataset.d = i;
    b.innerHTML = `${d.ico}<div>${d.name}</div><small>${DIFF_TAG[d.key] || ''}</small>`;
    onTap(b, () => pickDifficulty(i));
    row.appendChild(b);
  });
  syncDifficultyUI();
}

function snapshot() {
  return {
    v: 1,
    levelIndex,
    money,
    kills,
    difficulty: difficultyIndex(),
    // 小刀的 mag 是 Infinity，JSON 會變 null，所以用 'inf' 存
    weapons: WEAPONS.map((w) => ({ damage: w.damage, rate: w.rate, mag: w.mag === Infinity ? 'inf' : w.mag, locked: !!w.locked })),
    player: { maxHealth: player.maxHealth, speed: player.speed },
    savedAt: Date.now(),
  };
}

function syncWeaponButtons() {
  document.querySelectorAll('.wbtn').forEach((btn) => {
    const i = parseInt(btn.dataset.w, 10);
    const w = WEAPONS[i];
    if (!w) return;
    if (w.locked && w.price) {
      btn.classList.add('locked');
      btn.innerHTML = '🔒<small>$' + w.price + '</small>';
    } else {
      btn.classList.remove('locked');
      btn.innerHTML = (btn.dataset.ico || '🔫') + '<small>' + (btn.dataset.lbl || w.name) + '</small>';
    }
  });
  controls.setActiveWeapon(weapons.index);
}

function setWeaponIndex(i) {
  weapons.index = i;
  weapons.reloading = 0;
  weapons.models.forEach((m, k) => { m.visible = k === i; });
  weapons.ammo = WEAPONS.map((w) => w.mag);
  controls.setActiveWeapon(i);
  updateAmmo();
}

function applySnapshot(s) {
  // 在主選單自己選過難度就以選的為準（例如讀檔後想改難度）
  if (typeof s.difficulty === 'number' && !diffPicked) setDifficulty(s.difficulty);
  (s.weapons || []).forEach((ws, i) => {
    const w = WEAPONS[i];
    if (!w || !ws) return;
    if (typeof ws.damage === 'number') w.damage = ws.damage;
    if (typeof ws.rate === 'number') w.rate = ws.rate;
    if (ws.mag === 'inf') w.mag = Infinity;
    else if (typeof ws.mag === 'number') w.mag = ws.mag;
    w.locked = !!ws.locked;
  });
  if (s.player) {
    player.maxHealth = s.player.maxHealth || BASE_PLAYER.maxHealth;
    player.speed = s.player.speed || BASE_PLAYER.speed;
  }
  money = Math.max(0, s.money | 0);
  kills = Math.max(0, s.kills | 0);
  levelIndex = Math.max(0, s.levelIndex | 0);
  setWeaponIndex(0);
  syncWeaponButtons();
}

function resetToBase() {
  WEAPONS.forEach((w, i) => {
    w.damage = BASE_WEAPONS[i].damage;
    w.rate = BASE_WEAPONS[i].rate;
    w.mag = BASE_WEAPONS[i].mag;
    w.locked = BASE_WEAPONS[i].locked;
  });
  player.maxHealth = BASE_PLAYER.maxHealth;
  player.speed = BASE_PLAYER.speed;
  money = 0;
  kills = 0;
  levelIndex = 0;
  setWeaponIndex(0);
  syncWeaponButtons();
}

async function saveGame() {
  const data = snapshot();
  const body = JSON.stringify(data);
  let onPC = false;
  // 連不到就先等一下再試一次（偶發的連線中斷不該讓存檔只留在瀏覽器）
  for (let attempt = 0; attempt < 2 && !onPC; attempt++) {
    try {
      const r = await fetch(SAVE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      onPC = r.ok;
      if (!onPC && attempt === 0) await new Promise((res) => setTimeout(res, 400));
    } catch (e) {
      if (attempt === 0) await new Promise((res) => setTimeout(res, 400));
    }
  }
  try { localStorage.setItem(SAVE_LS, body); } catch (e) {}
  lastSavedAt = data.savedAt;
  return { onPC, savedAt: data.savedAt };
}

async function loadSave() {
  let best = null;
  try {
    const r = await fetch(SAVE_API, { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && j.save) best = j.save; }
  } catch (e) {}
  try {
    const ls = JSON.parse(localStorage.getItem(SAVE_LS) || 'null');
    if (ls && (!best || (ls.savedAt || 0) > (best.savedAt || 0))) best = ls;
  } catch (e) {}
  return best;
}

async function clearSave() {
  try { await fetch(SAVE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }); } catch (e) {}
  try { localStorage.removeItem(SAVE_LS); } catch (e) {}
  lastSavedAt = 0;
}

const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// 主選單：有存檔就把主按鈕換成「繼續上次進度」
async function refreshStartMenu() {
  const s = await loadSave();
  const line = el('save-line');
  const ng = el('btn-newgame');
  // 有存檔就讓選單先顯示存檔裡的難度（自己動過就以自己選的為準）
  if (s && typeof s.difficulty === 'number' && !diffPicked) setDifficulty(s.difficulty);
  syncDifficultyUI();
  if (s) {
    el('btn-start').textContent = `▶ 繼續上次進度（第 ${(s.levelIndex | 0) + 1} 關 · $${s.money | 0}）`;
    line.textContent = '💾 存檔時間：' + fmtTime(s.savedAt);
    ng.classList.remove('hidden');
  } else {
    el('btn-start').textContent = '開始遊戲';
    line.textContent = '';
    ng.classList.add('hidden');
  }
  return s;
}

function renderPauseInfo(note) {
  const cfg = levelConfig(levelIndex);
  const owned = WEAPONS.filter((w) => w.price && !w.locked).length;
  const all = WEAPONS.filter((w) => w.price).length;
  el('pause-info').innerHTML =
    `進度：第 <b>${levelIndex + 1}</b> 關${cfg.boss ? '（BOSS）' : ` · ${cfg.name}`}<br>` +
    `敵人強度：<b>${difficulty().name}</b>（回主選單可以換）<br>` +
    `金錢：<b>$${money}</b> · 擊殺：<b>${kills}</b> · 買過的槍：<b>${owned}/${all}</b><br>` +
    `<span class="saved">${note || (lastSavedAt ? '✅ 已自動存檔 ' + fmtTime(lastSavedAt) : '進度會自動儲存')}</span>`;
}

function setPaused(on) {
  if (on) {
    if (!running || shopOpen || paused) return;
    paused = true;
    prevFiring = false;
    renderPauseInfo();
    el('pause').classList.remove('hidden');
    el('touch').classList.add('hidden');
    saveGame().then((r) => renderPauseInfo(r.onPC ? '✅ 已存到電腦 ' + fmtTime(r.savedAt) : '✅ 已存在瀏覽器 ' + fmtTime(r.savedAt)));
  } else {
    if (!paused) return;
    paused = false;
    last = performance.now();        // 避免解除暫停後 dt 爆衝
    el('pause').classList.add('hidden');
    el('touch').classList.remove('hidden');
  }
}

function backToMenu() {
  running = false;
  paused = false;
  shopOpen = false;
  shopPending = false;
  shopBossMode = false;
  levelActive = false;
  betweenLevels = false;
  levelTimer = 0;
  respawning = false;
  won = false;
  enemyMgr.clear();
  weapons.clearEffects();
  el('pause').classList.add('hidden');
  el('shop').classList.add('hidden');
  hud.classList.add('hidden');
  touch.classList.add('hidden');
  overlay.style.display = '';
  refreshStartMenu();
}

// ---------------------------- start --------------------------------------
function beginRun() {
  overlay.style.display = 'none';
  hud.classList.remove('hidden');
  touch.classList.remove('hidden');
  el('pause').classList.add('hidden');
  el('shop').classList.add('hidden');
  shopOpen = false;
  shopPending = false;
  shopBossMode = false;
  levelActive = false;
  betweenLevels = false;
  levelTimer = 0;
  respawning = false;
  won = false;
  running = true;
  loadLevel(levelIndex);            // 新遊戲 = 0；讀檔 = 存檔的那一關
  radar.draw(world, player, enemyMgr.list, ally);
  updateHUD();
  showMsg(levelBanner(), 2.4);
}

onTap(el('btn-start'), async () => {
  if (running) return;
  const s = await loadSave();
  if (s) { applySnapshot(s); showMsg(`▶ 讀取存檔：第 ${levelIndex + 1} 關`, 2); }
  else { resetToBase(); }
  beginRun();
});

onTap(el('btn-newgame'), async () => {
  if (running) return;
  await clearSave();
  resetToBase();
  beginRun();
});

onTap(el('btn-pause'), () => setPaused(!paused));
onTap(el('btn-pause-resume'), () => setPaused(false));
onTap(el('btn-pause-save'), async () => {
  const r = await saveGame();
  renderPauseInfo(r.onPC ? '✅ 已存到電腦 ' + fmtTime(r.savedAt) : '✅ 已存在瀏覽器 ' + fmtTime(r.savedAt));
});

// 回主選單但保留進度（存完才離開）
onTap(el('btn-pause-menu'), async () => {
  await saveGame();
  backToMenu();
});

// 放棄並重新開始：要點兩次（第二次才算），免得在 iPad 上誤觸
let quitArmed = 0;
onTap(el('btn-pause-quit'), async () => {
  const b = el('btn-pause-quit');
  const now = performance.now();
  if (now - quitArmed > 3000) {
    quitArmed = now;
    b.textContent = '⚠️ 再點一次就放棄進度';
    setTimeout(() => { if (performance.now() - quitArmed >= 3000) b.textContent = '🆕 放棄並重新開始'; }, 3300);
    return;
  }
  quitArmed = 0;
  b.textContent = '🆕 放棄並重新開始';
  await clearSave();
  resetToBase();
  backToMenu();
});

// Esc / P 也可以暫停（電腦）
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (!running || shopOpen) return;
  e.preventDefault();
  setPaused(!paused);
});

// 切到別的 App / 分頁自動暫停 + 先存一份到瀏覽器（保險）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (!running) return;
  try { localStorage.setItem(SAVE_LS, JSON.stringify(snapshot())); } catch (e) {}
  if (!shopOpen && !paused) setPaused(true);
});

// ---------------------------- loop ---------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  frames++;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (running && !shopOpen && !paused) {
    const input = controls.poll();

    if (controls.consumeReload()) weapons.startReload();
    const sw = controls.consumeSwitch();
    if (sw >= 0) { weapons.switchTo(sw); controls.setActiveWeapon(weapons.index); }

    player.update(dt, input);

    const firing = !!input.firing;
    const firingEdge = firing && !prevFiring;
    prevFiring = firing;
    weapons.update(dt, firing, firingEdge);

    player.applyCamera(camera, weapons.pitchKick, weapons.yawKick);

    // ---- 狙擊槍放大鏡 (sniper scope) ----
    if (weapons.index !== SNIPER) controls.clearAim();
    const wantScope = !!input.aiming && weapons.index === SNIPER && player.alive;
    if (wantScope !== scoped) {
      scoped = wantScope;
      el('scope').classList.toggle('show', scoped);
      hud.classList.toggle('scoped', scoped);
      weapons.group.visible = !scoped;    // no viewmodel while looking down the scope
    }
    const targetFov = scoped ? SCOPE_FOV : BASE_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.2) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    lookScale = camera.fov / BASE_FOV;

    enemyMgr.update(dt, player, onPlayerHit, world, ally);
    ally.update(dt, player, enemyMgr);

    if (!player.alive && !respawning) {
      respawning = true;
      showMsg('你被擊倒了… 重生中', 2);
      setTimeout(() => {
        player.respawn(spawnX, 1.2, spawnZ);
        respawning = false;
        showMsg('🛡 重生！5 秒內不會受傷', 2.2);
      }, 2000);
    }

    // ---- level progression（無盡模式：BOSS 關也照樣往下一關） ----
    if (levelActive && !betweenLevels && enemyMgr.aliveCount() === 0 && enemyMgr.list.length === 0) {
      betweenLevels = true;
      levelActive = false;
      const wasBoss = isBossLevel(levelIndex);
      const reward = rewardFor(levelIndex);
      money += reward;
      updateHUD();
      const next = levelIndex + 1;
      shopPending = next % 2 === 0 || isBossLevel(next);   // 每 2 關一次 + BOSS 前一定開
      shopBossMode = isBossLevel(next);
      showMsg(wasBoss ? `🏆 BOSS 擊破！ +$${reward}` : `第 ${levelIndex + 1} 關完成！ +$${reward}`, wasBoss ? 3.4 : 2.2);
    }
    if (betweenLevels) {
      levelTimer += dt;
      if (levelTimer > 2.4) {
        if (shopPending) {
          shopPending = false;
          openShop();
        } else {
          loadLevel(levelIndex + 1);
          showMsg(levelBanner(), 2.6);
        }
      }
    }

    // radar: every 3rd frame is plenty and keeps the iPad cool
    if (frames % 3 === 0) radar.draw(world, player, enemyMgr.list, ally);

    updateHUD();
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// ---------------------------- resize -------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }, 250);
});

// 開場：建立「敵人強度」按鈕，再看有沒有存檔（有的話主按鈕變成「▶ 繼續上次進度」）
buildDifficultyUI();
refreshStartMenu();
