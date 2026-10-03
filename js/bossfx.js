import * as THREE from 'three';

// ---------------------------------------------------------------------------
// BOSS 技能的場上危險物件（會傷害玩家）：
//   VinePatch  叢林：地上長出藤蔓 → 站在上面持續受傷 → 時間到「炸裂」
//   IceSpikes  冰系：從 BOSS 朝玩家方向冒出一排冰尖刺（刺到受傷＋減速）
//   NovaRing   通用：以 BOSS 為中心的衝擊波／冰霜新星環（掃過玩家就受傷）
//   IceWall    冰系：一道冰牆，擋住子彈（玩家靠近會被推開、並稍微減速）
// 全部都是獨立 mesh，不動世界方塊（換關時整個清掉）。
// ---------------------------------------------------------------------------

// 共用的「打到玩家」小工具：回傳 true 表示這次有造成傷害
function hurt(player, onPlayerHit, dmg) {
  if (!player || !player.alive) return false;
  if (player.damage(dmg)) {
    if (onPlayerHit) onPlayerHit(dmg);
    return true;
  }
  return false;
}

function addSlow(player, mul, sec) {
  if (!player) return;
  player.slowMul = Math.min(player.slowMul === 1 || player.slowT <= 0 ? 1 : player.slowMul, mul);
  player.slowMul = mul;
  player.slowT = Math.max(player.slowT, sec);
}

// ------------------------------- 叢林：藤蔓 --------------------------------
export class VinePatch {
  constructor(scene, x, y, z, opts = {}) {
    this.scene = scene;
    this.x = x; this.y = y; this.z = z;
    this.radius = opts.radius || 3.4;
    this.dps = opts.dps || 16;              // 站在上面的每秒傷害
    this.burst = opts.burst || 34;          // 炸裂傷害
    this.burstRadius = opts.burstRadius || this.radius + 1.4;
    this.life = opts.life || 2.6;
    this.removeMe = false;
    this.exploded = false;
    this.t = 0;
    this.warn = opts.warn || 0;

    this.group = new THREE.Group();
    this.mat = new THREE.MeshLambertMaterial({ color: 0x49a63c, emissive: 0x123a12 });
    const geo = new THREE.BoxGeometry(0.46, 0.2, 0.46);
    this.parts = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.radius;
      const m = new THREE.Mesh(geo, this.mat);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      m.position.set(px, y + 0.06, pz);
      m.rotation.y = Math.random() * Math.PI;
      this.group.add(m);
      this.parts.push({ m, baseY: y + 0.06, delay: Math.random() * 0.45, spin: Math.random() < 0.5 ? 1 : -1 });
    }
    scene.add(this.group);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x7bff5a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 28), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, y + 0.08, z);
    scene.add(this.ring);
  }

  distanceTo(player) { return Math.hypot(player.pos.x - this.x, player.pos.z - this.z); }

  update(dt, player, onPlayerHit) {
    this.t += dt;

    // 藤蔓長出來
    const grow = Math.min(1, this.t / 0.45);
    for (const p of this.parts) {
      const k = Math.min(1, Math.max(0, (this.t - p.delay) / 0.35));
      p.m.position.y = p.baseY + k * 0.42;
      p.m.rotation.z = (1 - k) * 1.1 * p.spin;
    }

    if (this.exploded) {
      // 炸裂後的收尾動畫
      const f = Math.max(0, 1 - (this.t - this.explodeAt) / 0.45);
      this.mat.opacity = f;
      this.mat.transparent = true;
      this.ringMat.opacity = 0.85 * f;
      this.ring.scale.setScalar(1 + (1 - f) * this.burstRadius);
      if (f <= 0) this.removeMe = true;
      return;
    }

    // 站在藤蔓上持續受傷
    if (player && player.alive && this.distanceTo(player) < this.radius + 0.5) {
      hurt(player, onPlayerHit, this.dps * dt * grow);
    }

    // 時間到 → 炸裂
    if (this.t >= this.life) {
      this.exploded = true;
      this.explodeAt = this.t;
      this.mat.color.setHex(0xffd24a);
      this.mat.emissive.setHex(0x8a3200);
      this.ringMat.color.setHex(0xffb347);
      // 傷害判定（一次）
      if (player && player.alive && this.distanceTo(player) < this.burstRadius) hurt(player, onPlayerHit, this.burst);
      for (const p of this.parts) { p.m.scale.setScalar(1.35); p.m.position.y = this.y + 0.5; }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.parts.forEach((p) => p.m.geometry && p.m.geometry.dispose());
    this.mat.dispose();
  }
}

// ------------------------------- 冰系：冰尖刺 ------------------------------
export class IceSpikes {
  constructor(scene, x, y, z, dirX, dirZ, opts = {}) {
    this.scene = scene;
    this.removeMe = false;
    this.t = 0;
    this.life = opts.life || 3.6;
    this.damage = opts.damage || 20;
    this.slowMul = opts.slowMul || 0.5;
    this.slowSec = opts.slowSec || 1.6;
    this.hitCool = 0.6;                      // 同一根尖刺的再次傷害間隔
    this.count = opts.count || 5;

    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len, uz = dirZ / len;
    this.spikes = [];
    this.group = new THREE.Group();
    this.mat = new THREE.MeshLambertMaterial({ color: 0xbfe9ff, emissive: 0x1d5a8a });
    for (let i = 0; i < this.count; i++) {
      const d = 2.2 + i * 1.9;
      const px = x + ux * d, pz = z + uz * d;
      const h = 1.1 + Math.random() * 1.3;
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.42, h, 4), this.mat);
      m.position.set(px, y + 0.05, pz);
      m.rotation.y = Math.atan2(ux, uz) + Math.random() * 0.4;
      m.userData = { x: px, z: pz, h, born: 0.06 * i, hit: false };   // hit：每根尖刺只打一次
      m.scale.y = 0.05;
      this.group.add(m);
      this.spikes.push(m);
    }
    scene.add(this.group);
    this.frost = [];
  }

  update(dt, player, onPlayerHit) {
    this.t += dt;
    const out = Math.min(1, this.t / 0.18);
    for (const s of this.spikes) {
      const k = Math.min(1, Math.max(0.05, (this.t - s.userData.born) / 0.2));
      s.scale.y = s.userData.h * k * out;
      if (player && player.alive) {
        const d = Math.hypot(player.pos.x - s.userData.x, player.pos.z - s.userData.z);
        if (!s.userData.hit && d < 0.9 && s.scale.y > 0.5) {
          s.userData.hit = true;
          if (hurt(player, onPlayerHit, this.damage)) addSlow(player, this.slowMul, this.slowSec);
        }
      }
    }
    if (this.t > this.life) {
      const f = Math.max(0, 1 - (this.t - this.life) / 0.5);
      this.mat.opacity = f;
      this.mat.transparent = true;
      for (const s of this.spikes) s.scale.y *= 0.92;
      if (f <= 0) this.removeMe = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.spikes.forEach((s) => s.geometry.dispose());
    this.mat.dispose();
  }
}

// ---------------------- 通用：衝擊波／冰霜新星環 --------------------------
export class NovaRing {
  constructor(scene, x, y, z, opts = {}) {
    this.scene = scene;
    this.x = x; this.y = y; this.z = z;
    this.maxR = opts.maxR || 9;
    this.speed = opts.speed || 13;           // 每秒擴散幾格
    this.damage = opts.damage || 30;
    this.slowMul = opts.slowMul || 0;        // >0 → 附帶減速（冰系）
    this.slowSec = opts.slowSec || 2.4;
    this.knock = opts.knock || 0;            // 擊退力道
    this.removeMe = false;
    this.done = false;
    this.t = 0;

    const color = opts.color || 0xffb347;
    this.mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 40), this.mat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, y + 0.12, z);
    scene.add(this.ring);
  }

  update(dt, player, onPlayerHit) {
    this.t += dt;
    const r = 1 + this.t * this.speed;
    this.ring.scale.setScalar(r);
    this.mat.opacity = 0.85 * Math.max(0, 1 - r / this.maxR);

    if (!this.done && player && player.alive) {
      const d = Math.hypot(player.pos.x - this.x, player.pos.z - this.z);
      // 環掃過玩家的位置就算命中（有 0.9 格的容錯）
      if (d >= r - 0.9 && d <= r + 0.9) {
        this.done = true;
        if (hurt(player, onPlayerHit, this.damage)) {
          if (this.slowMul > 0) addSlow(player, this.slowMul, this.slowSec);
          if (this.knock > 0) {
            const kx = player.pos.x - this.x, kz = player.pos.z - this.z;
            const kl = Math.hypot(kx, kz) || 1;
            player.vel.x += (kx / kl) * this.knock;
            player.vel.z += (kz / kl) * this.knock;
            player.vel.y = Math.max(player.vel.y, 3.2);
          }
        }
      }
    }

    if (r > this.maxR) this.removeMe = true;
  }

  dispose() {
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    this.mat.dispose();
  }
}

// ------------------------------- 冰系：冰牆 --------------------------------
export class IceWall {
  constructor(scene, x, y, z, dirX, dirZ, opts = {}) {
    this.scene = scene;
    this.removeMe = false;
    this.t = 0;
    this.life = opts.life || 9;
    this.width = opts.width || 7;
    this.height = opts.height || 3;
    this.cells = [];

    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len, uz = dirZ / len;
    const rx = uz, rz = -ux;                  // 垂直方向 = 牆的走向
    const cx = x + ux * 3.2, cz = z + uz * 3.2;
    const CELL = 1.0;

    this.group = new THREE.Group();
    this.mat = new THREE.MeshLambertMaterial({
      color: 0x9fd8f5, emissive: 0x14496e, transparent: true, opacity: 0.82,
    });
    for (let i = 0; i < this.width; i++) {
      const off = (i - (this.width - 1) / 2) * CELL;
      for (let h = 0; h < this.height; h++) {
        const px = cx + rx * off, pz = cz + rz * off, py = y + 0.5 + h * CELL;
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, CELL, CELL), this.mat);
        m.position.set(px, py, pz);
        this.group.add(m);
        this.cells.push({ x: px, y: py, z: pz, r: CELL * 0.62 });
      }
    }
    scene.add(this.group);
  }

  // 子彈撞到冰牆就消失
  blocksBullet(pos) {
    if (this.removeMe) return false;
    for (const c of this.cells) {
      if (Math.abs(pos.x - c.x) < c.r && Math.abs(pos.z - c.z) < c.r && pos.y > c.y - c.r && pos.y < c.y + c.r) return true;
    }
    return false;
  }

  update(dt, player, onPlayerHit) {
    this.t += dt;
    // 玩家靠近：輕輕往外推（不會卡住），並稍微減速
    if (player && player.alive) {
      for (const c of this.cells) {
        const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
        if (Math.abs(dx) < 0.6 && Math.abs(dz) < 0.6 && player.pos.y < c.y + 0.9 && player.pos.y > c.y - 1.1) {
          const kx = player.pos.x - c.x, kz = player.pos.z - c.z;
          const kl = Math.hypot(kx, kz);
          if (kl > 0.001) { player.pos.x += (kx / kl) * 2.2 * dt; player.pos.z += (kz / kl) * 2.2 * dt; }
          addSlow(player, 0.65, 0.35);
          break;
        }
      }
    }
    if (this.t > this.life) {
      const f = Math.max(0, 1 - (this.t - this.life) / 0.9);
      this.mat.opacity = 0.82 * f;
      if (f <= 0) this.removeMe = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.children.forEach((c) => c.geometry.dispose());
    this.mat.dispose();
  }
}
