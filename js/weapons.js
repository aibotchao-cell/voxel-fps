import * as THREE from 'three';
import { LavaWall, IceBlast } from './gadgets.js';

// ---------------------------------------------------------------------------
// Weapons: pistol / machine gun / knife. Hitscan raycast against world + enemies.
// ---------------------------------------------------------------------------

export const WEAPONS = [
  { name: '手槍',   kind: 'semi',  damage: 34, rate: 0.30, mag: 12, reload: 1.15, range: 60, spread: 0.010, recoil: 0.055, auto: false },
  { name: '機槍',   kind: 'auto',  damage: 17, rate: 0.085, mag: 45, reload: 2.10, range: 60, spread: 0.030, recoil: 0.030, auto: true  },
  { name: '小刀',   kind: 'melee', damage: 65, rate: 0.55, mag: Infinity, reload: 0, range: 2.4, spread: 0, recoil: 0.03, auto: false },

  // ---- buyable at the supply shop (locked until purchased) ----------------
  { name: '突擊步槍', kind: 'auto', damage: 26, rate: 0.09, mag: 30, reload: 1.55, range: 70, spread: 0.016, recoil: 0.032, auto: true,
    price: 150, locked: true, desc: '傷害 26 · 彈匣 30 · 全自動' },
  { name: '霰彈槍',   kind: 'semi', damage: 15, pellets: 8, rate: 0.78, mag: 6, reload: 2.10, range: 26, spread: 0.075, recoil: 0.16, auto: false,
    price: 170, locked: true, desc: '8 顆彈丸 × 15 · 近距離一發必殺' },
  { name: '狙擊槍',   kind: 'semi', damage: 150, rate: 1.30, mag: 5, reload: 2.40, range: 120, spread: 0.0006, recoil: 0.20, auto: false,
    price: 200, locked: true, desc: '傷害 150 · 幾乎一槍一殺 · 射速慢' },

  // ---- 超強武器：只在「BOSS 前的那個補給站」開賣 -------------------------
  { name: '火焰噴射器', kind: 'flame', damage: 5, rate: 0.05, mag: 200, reload: 2.60, range: 8.5, spread: 0.05, recoil: 0.010, auto: true,
    price: 200, locked: true, bossOnly: true, desc: '近距離錐形火牆 · 每秒約 100 傷害 · 一次燒一整群' },
  { name: '冰凍榴彈槍', kind: 'lob', damage: 55, rate: 1.05, mag: 8, reload: 2.30, range: 26, spread: 0.012, recoil: 0.09, auto: false,
    price: 220, locked: true, bossOnly: true, freeze: 3.2, blast: 5.5, desc: '拋射冰榴彈 · 爆炸凍住一整群敵人 3 秒' },
  { name: '岩漿牆',     kind: 'deploy', damage: 42, rate: 1.60, mag: 3, reload: 3.40, range: 4.4, spread: 0, recoil: 0.06, auto: false,
    price: 240, locked: true, bossOnly: true, desc: '在面前放一道噴岩漿的牆 · 敵人靠近會被燒 16 秒' },

  // ---- 大範圍武器（普通補給站就買得到，$100～150）-------------------------
  // kind:'lob' = 拋射炸彈／火箭，命中或撞牆後爆炸，半徑內所有敵人一起吃傷害。
  // 放在陣列最後面，前面的武器編號（鍵盤 1～9、HUD 按鈕、火焰噴射器 models[6]）才不會跑掉。
  { name: '榴彈發射器', kind: 'lob', damage: 48, rate: 1.00, mag: 6, reload: 2.30, range: 30, spread: 0.012, recoil: 0.10, auto: false,
    blast: 5.0, projSpeed: 26, projLift: 1.6, projGrav: 20, projSize: 0.22,
    projColor: 0xffd27a, blastColor: 0xffb347, aoe: true,
    price: 120, locked: true, desc: '拋射榴彈 · 爆炸半徑 5 格 · 傷害 48 · 一次炸一整群' },
  { name: '火箭筒', kind: 'lob', damage: 78, rate: 1.55, mag: 4, reload: 2.70, range: 46, spread: 0.006, recoil: 0.19, auto: false,
    blast: 6.2, projSpeed: 44, projLift: 0.4, projGrav: 8, projSize: 0.26,
    projColor: 0xff8a3a, blastColor: 0xff6a1e, aoe: true,
    price: 150, locked: true, desc: '直射火箭 · 爆炸半徑 6 格 · 傷害 78 · 對 BOSS 也有效' },
];

function lam(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z);
  return m;
}

export class WeaponManager {
  constructor(camera, world, enemyManager) {
    this.camera = camera;
    this.world = world;
    this.enemies = enemyManager;
    this.index = 0;
    this.ammo = WEAPONS.map((w) => w.mag);
    this.cooldown = 0;
    this.reloading = 0;
    this.pitchKick = 0;
    this.yawKick = 0;
    this.kick = 0;
    this.swapT = 0;
    this.onHit = null;    // (kind) => void   kind: 'enemy' | 'world' | 'kill'
    this.onAmmo = null;

    // 特殊武器（火焰／冰榴彈／岩漿牆）用的場景物件
    this.scene = (enemyManager && enemyManager.scene) || camera.parent || null;
    this.projectiles = [];
    this.walls = [];
    this.blasts = [];
    this.flameT = 0;

    this.group = new THREE.Group();
    camera.add(this.group);

    this.models = WEAPONS.map((_, i) => this.buildModel(i));
    this.models.forEach((m) => { m.visible = false; this.group.add(m); });
    this.models[0].visible = true;

    this.flashes = this.models.map((m) => {
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      f.position.copy(m.userData.muzzle);
      f.visible = false;
      m.add(f); // child of the weapon model so the flash sits at the barrel, not screen-centre
      return f;
    });
    this.flashT = 0;
  }

  buildModel(i) {
    const g = new THREE.Group();
    const gun = 0x3b3f45, dark = 0x24272b, wood = 0x6b4a2a, steel = 0x8a9099;

    if (i === 0) { // pistol
      g.add(box(0.09, 0.09, 0.34, 0, 0.02, -0.10, gun));
      g.add(box(0.07, 0.06, 0.10, 0, 0.02, -0.30, dark));
      const grip = box(0.08, 0.17, 0.10, 0, -0.11, 0.02, dark);
      grip.rotation.x = 0.25; g.add(grip);
      g.position.set(0.26, -0.22, -0.46);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.37);
    } else if (i === 1) { // machine gun
      g.add(box(0.11, 0.13, 0.62, 0, 0, -0.18, gun));
      g.add(box(0.06, 0.06, 0.26, 0, 0.01, -0.55, steel));
      g.add(box(0.07, 0.24, 0.12, 0, -0.19, -0.02, dark));
      const stock = box(0.08, 0.11, 0.20, 0, -0.03, 0.16, wood);
      g.add(stock);
      g.add(box(0.05, 0.05, 0.14, 0, 0.06, -0.30, dark));
      g.position.set(0.30, -0.26, -0.50);
      g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.70);
    } else if (i === 2) { // knife
      const blade = box(0.025, 0.12, 0.40, 0, 0.04, -0.24, steel);
      blade.rotation.x = -0.12; g.add(blade);
      const handle = box(0.06, 0.07, 0.16, 0, -0.03, 0.02, wood);
      g.add(handle);
      g.add(box(0.10, 0.03, 0.05, 0, 0.0, -0.06, dark));
      g.position.set(0.30, -0.30, -0.42);
      g.rotation.z = -0.28;
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.44);
    } else if (i === 3) { // assault rifle
      g.add(box(0.10, 0.12, 0.70, 0, 0, -0.20, gun));
      g.add(box(0.05, 0.05, 0.34, 0, 0.01, -0.68, steel));      // barrel
      g.add(box(0.06, 0.14, 0.22, 0, -0.10, -0.30, dark));      // magazine
      g.add(box(0.07, 0.22, 0.11, 0, -0.16, -0.02, dark));      // grip
      g.add(box(0.06, 0.10, 0.14, 0, 0.06, -0.42, dark));       // sight
      g.add(box(0.07, 0.10, 0.24, 0, -0.02, 0.16, dark));       // stock
      g.add(box(0.05, 0.24, 0.12, 0, -0.16, 0.02, gun));        // rear grip
      g.position.set(0.30, -0.25, -0.50);
      g.userData.muzzle = new THREE.Vector3(0, 0.01, -0.86);
    } else if (i === 4) { // shotgun
      g.add(box(0.12, 0.14, 0.60, 0, 0, -0.16, gun));
      g.add(box(0.09, 0.09, 0.46, 0, 0.03, -0.60, steel));      // wide barrel
      g.add(box(0.08, 0.09, 0.34, 0, -0.06, -0.44, dark));      // pump
      g.add(box(0.08, 0.12, 0.22, 0, -0.03, 0.16, wood));       // stock
      const pump = box(0.09, 0.12, 0.20, 0, -0.07, -0.34, wood);
      g.add(pump);
      g.position.set(0.30, -0.26, -0.50);
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.86);
    } else if (i === 6) { // flamethrower
      g.add(box(0.14, 0.16, 0.66, 0, 0, -0.16, gun));
      g.add(box(0.24, 0.24, 0.40, 0, -0.05, 0.06, 0x8a2f16));      // 燃料槽
      g.add(box(0.26, 0.26, 0.16, 0, -0.05, 0.30, 0xc4441c));
      g.add(box(0.07, 0.07, 0.34, 0, 0.03, -0.52, steel));         // 噴嘴管
      g.add(box(0.13, 0.13, 0.10, 0, 0.03, -0.72, 0xff8a2a));      // 噴嘴口
      g.add(box(0.07, 0.22, 0.11, 0, -0.16, -0.02, dark));         // 握把
      g.position.set(0.28, -0.26, -0.46);
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.80);

      // 火焰錐（遊戲性視覺，開火時才顯示）
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 8.5, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      flame.rotation.x = Math.PI / 2;   // 尖端朝自己、開口朝前方
      flame.position.set(0, 0.03, -4.7);
      flame.visible = false;
      g.add(flame);
      const core = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 5.2, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      core.rotation.x = Math.PI / 2;
      core.position.set(0, 0.03, -3.1);
      core.visible = false;
      g.add(core);
      g.userData.flame = flame;
      g.userData.flameCore = core;
    } else if (i === 7) { // ice grenade launcher
      g.add(box(0.14, 0.16, 0.60, 0, 0, -0.14, gun));
      g.add(box(0.20, 0.20, 0.30, 0, 0.04, -0.44, 0x3b6f8f));       // 發射筒
      g.add(box(0.26, 0.26, 0.12, 0, 0.04, -0.60, 0x7fd4ff));       // 筒口
      g.add(box(0.14, 0.14, 0.26, 0, 0.04, 0.10, 0x9fe4ff));        // 冰瓶
      g.add(box(0.07, 0.22, 0.11, 0, -0.15, -0.02, dark));
      g.add(box(0.05, 0.06, 0.16, 0, 0.14, -0.30, steel));
      g.position.set(0.29, -0.25, -0.48);
      g.userData.muzzle = new THREE.Vector3(0, 0.04, -0.70);
    } else if (i === 9) { // grenade launcher
      g.add(box(0.15, 0.17, 0.58, 0, 0, -0.14, gun));                  // 機匣
      g.add(box(0.21, 0.21, 0.46, 0, 0.03, -0.52, 0x4f5a3a));         // 粗砲管
      g.add(box(0.25, 0.25, 0.12, 0, 0.03, -0.76, 0x6e7d4a));         // 砲口
      const drum = box(0.26, 0.26, 0.14, 0, -0.13, -0.22, 0x3a4030);   // 彈鼓
      drum.rotation.x = 0.15; g.add(drum);
      g.add(box(0.30, 0.06, 0.30, 0, -0.03, -0.30, 0x8a9099));         // 提把
      g.add(box(0.08, 0.20, 0.11, 0, -0.14, 0.06, dark));              // 握把
      g.add(box(0.07, 0.11, 0.20, 0, -0.01, 0.16, dark));              // 後握
      g.position.set(0.29, -0.26, -0.48);
      g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.84);
    } else if (i === 10) { // rocket launcher
      g.add(box(0.20, 0.20, 1.06, 0, 0.02, -0.30, 0x3d4a3a));          // 發射管
      g.add(box(0.27, 0.27, 0.18, 0, 0.02, -0.78, 0x2f3a2d));          // 後喇叭口
      g.add(box(0.23, 0.23, 0.16, 0, 0.02, 0.20, 0x2f3a2d));           // 尾焰口
      g.add(box(0.16, 0.16, 0.30, 0, 0.02, -0.98, 0xd8452a));          // 火箭彈頭
      g.add(box(0.09, 0.09, 0.12, 0, 0.02, -1.14, 0xffa24a));          // 彈尖
      g.add(box(0.06, 0.13, 0.30, 0, 0.16, -0.42, steel));             // 瞄具座
      g.add(box(0.08, 0.20, 0.11, 0, -0.16, -0.10, dark));             // 握把
      g.add(box(0.09, 0.26, 0.30, 0, -0.06, 0.24, dark));              // 肩托
      g.position.set(0.27, -0.24, -0.40);
      g.userData.muzzle = new THREE.Vector3(0, 0.02, -1.18);
    } else { // lava wall sprayer
      g.add(box(0.16, 0.18, 0.58, 0, 0, -0.12, gun));
      g.add(box(0.30, 0.30, 0.34, 0, -0.02, 0.10, 0x50301c));       // 岩漿槽
      g.add(box(0.30, 0.10, 0.30, 0, 0.14, 0.10, 0xff6a1a));        // 熔岩口
      g.add(box(0.08, 0.08, 0.30, 0, 0.08, -0.42, 0x8a9099));
      g.add(box(0.16, 0.16, 0.12, 0, 0.08, -0.58, 0xff8a3a));
      g.add(box(0.08, 0.22, 0.12, 0, -0.17, -0.02, dark));
      g.position.set(0.28, -0.26, -0.46);
      g.userData.muzzle = new THREE.Vector3(0, 0.08, -0.66);
    }
    return g;
  }

  get current() { return WEAPONS[this.index]; }

  switchTo(i) {
    if (i === this.index || i < 0 || i >= WEAPONS.length) return;
    if (WEAPONS[i].locked) return;          // shop guns must be bought first
    this.models[this.index].visible = false;
    this.index = i;
    this.models[i].visible = true;
    this.reloading = 0;
    this.swapT = 0.22;
  }

  startReload() {
    const w = this.current;
    if (w.kind === 'melee') return;
    if (this.reloading > 0 || this.ammo[this.index] >= w.mag) return;
    this.reloading = w.reload;
  }

  fire(auto) {
    const w = this.current;
    if (this.cooldown > 0 || this.reloading > 0) return false;
    if (w.kind !== 'melee' && this.ammo[this.index] <= 0) { this.startReload(); return false; }

    this.cooldown = w.rate;
    if (w.kind !== 'melee') this.ammo[this.index]--;

    // recoil & effects
    this.pitchKick -= w.recoil;
    this.yawKick += (Math.random() - 0.5) * w.recoil * 0.8;
    this.kick = 0.05;
    this.flashT = 0.045;

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

    // ---- 超強武器 ----
    if (w.kind === 'flame') {
      this.flameT = 0.09;
      const hit = this.burnCone(origin, dir, w);
      if (this.onHit) this.onHit(hit ? 'enemy' : 'world');
      return true;
    }
    if (w.kind === 'lob') {
      const d = dir.clone();
      d.x += (Math.random() - 0.5) * w.spread * 2;
      d.y += (Math.random() - 0.5) * w.spread * 2;
      d.z += (Math.random() - 0.5) * w.spread * 2;
      d.normalize();
      const start = origin.clone().add(d.clone().multiplyScalar(0.9));
      this.spawnGrenade(start, d, w);
      return true;
    }
    if (w.kind === 'deploy') {
      this.placeWall(origin, dir, w);
      return true;
    }

    if (w.kind === 'melee') {
      // cone check in front
      let hitAny = false;
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        const to = new THREE.Vector3(e.pos.x - origin.x, e.pos.y + 1.0 - origin.y, e.pos.z - origin.z);
        const dist = to.length();
        if (dist > w.range) continue;
        to.normalize();
        if (to.dot(dir) > 0.55) { e.takeDamage(w.damage, dir); hitAny = true; if (this.onHit) this.onHit('enemy'); }
      }
      if (!hitAny && this.onHit) this.onHit('world');
      return true;
    }

    // hitscan: one ray for most guns, a cone of pellets for the shotgun
    const pellets = w.pellets || 1;
    let hitSomething = false;
    for (let p = 0; p < pellets; p++) {
      const kind = this.fireRay(origin, dir, w);
      if (kind === 'enemy' || kind === 'kill') { hitSomething = true; if (this.onHit) this.onHit(kind); }
    }
    if (!hitSomething && this.onHit) this.onHit('world');
    return true;
  }

  // one hitscan ray: nearest of (enemy AABB, world voxel) wins — walls block shots
  fireRay(origin, base, w) {
    const dir = base.clone();
    const sp = w.spread;
    dir.x += (Math.random() - 0.5) * sp * 2;
    dir.y += (Math.random() - 0.5) * sp * 2;
    dir.z += (Math.random() - 0.5) * sp * 2;
    dir.normalize();

    // nearest enemy along the ray
    let enemyHit = null, enemyDist = w.range;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const bb = e.aabb();
      const t = rayBox(origin, dir, bb.min, bb.max);
      if (t !== null && t < enemyDist) { enemyDist = t; enemyHit = e; }
    }

    // nearest world block
    const worldHit = raycastWorld(this.world, origin, dir, w.range);

    if (enemyHit && (!worldHit || enemyDist < worldHit.dist)) {
      enemyHit.takeDamage(w.damage, dir);
      return enemyHit.alive ? 'enemy' : 'kill';
    }
    if (worldHit) return 'world';
    return 'none';
  }

  // ---------------- 超強武器：火焰 / 冰榴彈 / 岩漿牆 ----------------------

  // 火焰：朝前一個圓錐，牆會擋火
  burnCone(origin, base, w) {
    const cosLimit = Math.cos(0.5); // 約 ±29°
    let any = false;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const cy = e.pos.y + (e.isBoss ? 2.0 : 1.0);
      const dx = e.pos.x - origin.x, dy = cy - origin.y, dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > w.range || d < 0.001) continue;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      if (ux * base.x + uy * base.y + uz * base.z < cosLimit) continue;
      if (raycastWorld(this.world, origin, { x: ux, y: uy, z: uz }, d - 0.4)) continue; // 被牆擋住
      e.takeDamage(w.damage, null);
      any = true;
    }
    return any;
  }

  spawnGrenade(start, dir, w) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(w.projSize || 0.20, 10, 8),
      new THREE.MeshBasicMaterial({ color: w.projColor || 0xcdf1ff })
    );
    mesh.position.copy(start);
    if (this.scene) this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(w.projSpeed || 24);
    vel.y += w.projLift !== undefined ? w.projLift : 1.4;
    this.projectiles.push({ mesh, pos: start.clone(), vel, life: 3.0, w });
  }

  // 爆炸：半徑內所有敵人一起吃傷害（冰榴彈另外會凍住敵人）
  explodeIce(pos, w) {
    const r = w.blast || 5.5;
    if (this.scene) {
      this.blasts.push(new IceBlast(this.scene, pos.x, pos.y, pos.z, r, w.blastColor ? { core: w.blastColor, ring: 0xfff0c0 } : null));
    }
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const cy = e.pos.y + (e.isBoss ? 2.0 : 1.0);
      const d = Math.hypot(e.pos.x - pos.x, cy - pos.y, e.pos.z - pos.z);
      if (d > r) continue;
      e.takeDamage(w.damage, null);
      // 只有真的帶 freeze 的武器（冰榴彈）才凍人
      if (w.freeze && e.alive && e.freeze !== undefined) e.freeze = Math.max(e.freeze, w.freeze);
    }
  }

  placeWall(origin, dir, w) {
    if (!this.scene) return;
    if (this.walls.length >= 4) { const old = this.walls.shift(); old.dispose(); }  // 同時最多 4 道
    const yaw = Math.atan2(-dir.x, -dir.z);        // dir 就是玩家正面
    const feet = Math.max(0, origin.y - 1.62);     // 眼睛高度 → 腳底
    this.walls.push(new LavaWall(this.scene, origin.x, feet, origin.z, yaw, 16));
  }

  updateEffects(dt) {
    // 拋射物飛行 + 爆炸（榴彈／火箭／冰榴彈共用）
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= (p.w.projGrav !== undefined ? p.w.projGrav : 22) * dt;
      let boom = false;
      const total = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(total / 0.25));
      for (let s = 0; s < steps && !boom; s++) {
        p.pos.x += (p.vel.x * dt) / steps;
        p.pos.y += (p.vel.y * dt) / steps;
        p.pos.z += (p.vel.z * dt) / steps;
        if (this.world.isSolid(p.pos.x, p.pos.y, p.pos.z)) { boom = true; break; }
        for (const e of this.enemies.list) {
          if (!e.alive) continue;
          const bb = e.aabb();
          if (p.pos.x > bb.min.x && p.pos.x < bb.max.x &&
              p.pos.y > bb.min.y && p.pos.y < bb.max.y &&
              p.pos.z > bb.min.z && p.pos.z < bb.max.z) { boom = true; break; }
        }
      }
      p.mesh.position.copy(p.pos);
      if (p.life <= 0) boom = true;
      if (boom) {
        this.explodeIce(p.pos, p.w);
        if (this.scene) this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // 岩漿牆：燒靠近的敵人 + 到期消失
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const wall = this.walls[i];
      wall.update(dt, this.enemies.list);
      if (wall.removeMe) { wall.dispose(); this.walls.splice(i, 1); }
    }

    // 冰爆視覺
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.update(dt);
      if (b.removeMe) { b.dispose(); this.blasts.splice(i, 1); }
    }

    // 火焰噴嘴的火焰
    this.flameT = Math.max(0, this.flameT - dt);
    const fm = this.models[6];
    if (fm && fm.userData && fm.userData.flame) {
      const on = this.flameT > 0;
      fm.userData.flame.visible = on;
      fm.userData.flameCore.visible = on;
      if (on) {
        fm.userData.flame.scale.set(0.85 + Math.random() * 0.3, 0.85 + Math.random() * 0.3, 0.9 + Math.random() * 0.25);
        fm.userData.flameCore.scale.set(0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.2);
      }
    }
  }

  // 換關時清掉場上的榴彈／岩漿牆／冰爆
  clearEffects() {
    for (const p of this.projectiles) {
      if (this.scene) this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    for (const wall of this.walls) wall.dispose();
    this.walls.length = 0;
    for (const b of this.blasts) b.dispose();
    this.blasts.length = 0;
    this.flameT = 0;
    const fm = this.models[6];
    if (fm && fm.userData && fm.userData.flame) { fm.userData.flame.visible = false; fm.userData.flameCore.visible = false; }
  }

  update(dt, firing, firingEdge) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swapT = Math.max(0, this.swapT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.kick *= Math.pow(0.001, dt);
    this.pitchKick *= Math.pow(0.0025, dt);
    this.yawKick *= Math.pow(0.0025, dt);

    // 場上物件（榴彈／岩漿牆／冰爆／火焰）永遠要更新，即使正在換彈
    this.updateEffects(dt);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo[this.index] = this.current.mag;
        if (this.onAmmo) this.onAmmo();
      }
    }

    const w = this.current;
    if (w.auto) { if (firing) this.fire(true); }
    else if (firingEdge) this.fire(false);

    // viewmodel sway + kick + swap raise
    const g = this.group;
    const models = this.models[this.index];
    const base = models.userData.base || (models.userData.base = models.position.clone());
    g.position.x = 0;
    g.position.y = 0;
    g.position.z = this.kick * 1.2;
    const raise = this.swapT > 0 ? -(this.swapT / 0.22) * 0.35 : 0;
    g.position.y += raise;

    for (let i = 0; i < this.flashes.length; i++) {
      this.flashes[i].visible = (i === this.index && this.flashT > 0);
      if (this.flashes[i].visible) {
        this.flashes[i].rotation.z = Math.random() * Math.PI;
        this.flashes[i].scale.setScalar(0.7 + Math.random() * 0.6);
      }
    }
  }
}

// ---------------------------- ray helpers ---------------------------------
export function raycastWorld(world, origin, dir, range) {
  const step = 0.1;
  let t = 0;
  while (t < range) {
    t += step;
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (world.isSolid(x, y, z)) {
      return { dist: t, point: new THREE.Vector3(x, y, z) };
    }
  }
  return null;
}

export function rayBox(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  const axes = ['x', 'y', 'z'];
  for (const ax of axes) {
    if (Math.abs(d[ax]) < 1e-8) {
      if (o[ax] < min[ax] || o[ax] > max[ax]) return null;
    } else {
      let t1 = (min[ax] - o[ax]) / d[ax];
      let t2 = (max[ax] - o[ax]) / d[ax];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}
