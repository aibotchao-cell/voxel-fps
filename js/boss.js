import * as THREE from 'three';
import { VinePatch, IceSpikes, NovaRing, IceWall } from './bossfx.js';

// ---------------------------------------------------------------------------
// BOSS 屬性（每 10 關換一種，能力一種比一種多）：
//   steel  鋼鐵廠長：震地衝擊波
//   jungle 叢林霸主：種藤蔓（會炸裂）＋荊棘爆發＋震地
//   ice    寒冰領主：冰尖刺＋冰霜新星（減速）＋冰牆（擋子彈）
//   final  最終兵器：全部技能通通會
// 每隻 BOSS 都保留原本的：連發機砲、暴衝、召喚小兵
// ---------------------------------------------------------------------------
export const BOSS_KINDS = {
  steel:  { name: '鋼鐵廠長', tint: 0xff4422, core: [0.75, 0.20, 0.00], abilities: ['slam'] },
  jungle: { name: '叢林霸主', tint: 0x7bff5a, core: [0.25, 0.80, 0.18], abilities: ['vines', 'thornBurst', 'slam'] },
  ice:    { name: '寒冰領主', tint: 0x7fd8ff, core: [0.35, 0.72, 1.00], abilities: ['iceSpikes', 'frostNova', 'iceWall'] },
  final:  { name: '最終兵器', tint: 0xd08aff, core: [0.72, 0.35, 1.00], abilities: ['slam', 'vines', 'thornBurst', 'iceSpikes', 'frostNova', 'iceWall'] },
};

// 各技能的冷卻（秒）；越後面的關卡會再乘上 0.62~1 的倍率
const AB_CD = { slam: 9.5, vines: 8.5, thornBurst: 12, iceSpikes: 7, frostNova: 13, iceWall: 15 };

// ---------------------------------------------------------------------------
// BOSS：每 10 關出現一次的巨型機甲。介面刻意跟 Enemy 一樣
// (pos / alive / aabb() / takeDamage() / hasLOS() / update() / group / removeMe)
// 所以武器、隊友、雷達、子彈的程式碼完全不用改就能打到它。
//  行為：慢慢逼近 → 三連發機砲 → 每 5 秒暴衝一次 → 每 14 秒召喚小兵
// ---------------------------------------------------------------------------

const HALF = 0.85;          // 碰撞半寬
const HEIGHT = 4.9;         // 身高（含視覺放大）
const EYE = 3.6;
const GRAV = -26;
const SCALE = 1.18;         // 視覺放大，讓它看起來更巨大

const ARMOR = 0x8a949c;
const ARMOR_D = 0x3a4149;
const PLATE = 0xb06a22;
const METAL = 0xb8c0c8;
const GLOW = 0xff3a2a;
const WARN = 0xffc23a;

function lam(c) { return new THREE.MeshLambertMaterial({ color: c }); }

export class Boss {
  constructor(world, x, z, cfg) {
    this.isBoss = true;
    this.world = world;
    this.cfg = cfg;
    this.name = cfg.name;
    this.pos = new THREE.Vector3(x, 1, z);
    this.vel = new THREE.Vector3();
    this.maxHealth = cfg.bossHealth;
    this.health = cfg.bossHealth;
    this.alive = true;
    this.yaw = 0;
    this.state = 'walk';
    this.walkPhase = 0;
    this.shootT = 1.5;
    this.burst = 0;
    this.burstT = 0;
    this.burstSize = cfg.bossBurst || 3;
    this.chargeT = (cfg.bossChargeCd || 5.8) * 0.7;      // 開場先給一點緩衝
    this.chargeLeft = 0;
    this.summonT = 8;
    this.deadT = 0;
    this.removeMe = false;
    this.hitFlash = 0;
    this.freeze = 0;
    this.fxState = 0;
    this.kick = 0;
    this.flashT = 0;
    this.summonFlash = 0;
    this.materials = [];
    this.glows = [];        // 發光零件（不受受擊閃光影響）
    this.maxSummons = 6;    // 每隻 BOSS 最多召喚 6 隻小兵（後面的關卡不會越叫越多）
    this.summoned = 0;
    // ---- 屬性技能 ----
    this.kind = BOSS_KINDS[cfg.bossKind] || BOSS_KINDS.steel;
    this.tier = cfg.bossTier || 0;
    this.castLock = 0;
    this.abT = {};
    for (const k of Object.keys(AB_CD)) this.abT[k] = 4 + Math.random() * 4;   // 開場錯開，不會一次全丟
    this.group = this.build();
  }

  build() {
    const g = new THREE.Group();
    const mk = (w, h, d, x, y, z, c, parent) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c));
      m.position.set(x, y, z);
      this.materials.push(m.material);
      (parent || g).add(m);
      return m;
    };
    // 發光零件：不進 hitFlash 清單（才不會被閃光洗掉），自己帶 emissive
    const glow = (w, h, d, x, y, z, c, em, parent) => {
      const m = mk(w, h, d, x, y, z, c, parent);
      this.materials.pop();
      m.material.emissive.setHex(em);
      this.glows.push(m);
      return m;
    };
    this.glowList = [];   // 供閃爍動畫用

    // 重型雙腿
    this.legL = mk(0.46, 1.5, 0.46, -0.42, 0.75, 0, ARMOR_D);
    this.legR = mk(0.46, 1.5, 0.46, 0.42, 0.75, 0, ARMOR_D);
    mk(0.60, 0.26, 0.80, -0.42, 0.13, 0.06, ARMOR);
    mk(0.60, 0.26, 0.80, 0.42, 0.13, 0.06, ARMOR);

    // 腹部 + 寬胸甲
    mk(1.10, 0.60, 0.80, 0, 1.75, 0, ARMOR_D);
    mk(1.60, 1.20, 1.00, 0, 2.65, 0, ARMOR);
    mk(1.70, 0.34, 1.06, 0, 2.30, 0, PLATE);   // 腰甲
    mk(0.70, 0.70, 0.10, 0, 2.75, 0.54, ARMOR_D); // 胸口艙蓋

    // 反應爐（會發光的核心）
    this.core = glow(0.52, 0.52, 0.22, 0, 2.70, 0.60, GLOW, 0xcc3300);

    // 肩膀 + 警示條紋 + 紅色肩燈
    mk(0.80, 0.66, 0.90, -1.05, 3.05, 0, PLATE);
    mk(0.80, 0.66, 0.90, 1.05, 3.05, 0, PLATE);
    mk(0.84, 0.14, 0.94, -1.05, 3.32, 0, WARN);
    mk(0.84, 0.14, 0.94, 1.05, 3.32, 0, WARN);
    this.glowList.push(glow(0.30, 0.30, 0.30, -1.20, 3.32, 0.44, GLOW, 0xaa2200));
    this.glowList.push(glow(0.30, 0.30, 0.30, 1.20, 3.32, 0.44, GLOW, 0xaa2200));

    // 右手：巨型旋轉機砲
    const gun = new THREE.Group();
    gun.position.set(1.12, 2.55, 0.30);
    mk(0.42, 0.42, 0.90, 0, 0, 0, ARMOR_D, gun);
    mk(0.24, 0.24, 0.70, -0.16, 0, 0.72, METAL, gun);
    mk(0.24, 0.24, 0.70, 0.16, 0, 0.72, METAL, gun);
    mk(0.24, 0.24, 0.70, 0, 0, 0.72, METAL, gun);
    mk(0.60, 0.36, 0.30, 0, 0.02, -0.10, PLATE, gun);
    this.gun = gun;
    g.add(gun);

    // 左手：巨爪
    this.armL = new THREE.Group();
    this.armL.position.set(-1.12, 2.45, 0.10);
    mk(0.40, 1.10, 0.40, 0, -0.30, 0, ARMOR_D, this.armL);
    mk(0.70, 0.40, 0.60, 0, -1.00, 0.10, ARMOR, this.armL);
    mk(0.16, 0.34, 0.20, -0.20, -1.26, 0.22, METAL, this.armL);
    mk(0.16, 0.34, 0.20, 0.20, -1.26, 0.22, METAL, this.armL);
    g.add(this.armL);

    // 頭 + 紅色護目鏡
    mk(0.90, 0.80, 0.90, 0, 3.75, 0, ARMOR);
    this.visor = glow(0.76, 0.24, 0.14, 0, 3.78, 0.48, GLOW, 0xff4422);
    mk(0.20, 0.34, 0.20, -0.34, 4.20, 0, METAL);  // 天線
    mk(0.20, 0.34, 0.20, 0.34, 4.20, 0, METAL);

    // 砲口閃光
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    this.flash.position.set(1.12, 2.55, 1.35);
    this.flash.visible = false;
    g.add(this.flash);

    g.position.copy(this.pos);
    g.scale.setScalar(SCALE);       // 再放大一點，當個真正的大魔王
    return g;
  }

  aabb() {
    return {
      min: { x: this.pos.x - HALF, y: this.pos.y, z: this.pos.z - HALF },
      max: { x: this.pos.x + HALF, y: this.pos.y + HEIGHT, z: this.pos.z + HALF },
    };
  }

  collides(x, y, z) {
    const w = this.world;
    const minX = Math.floor(x - HALF + 1e-4), maxX = Math.floor(x + HALF - 1e-4);
    const minY = Math.floor(y + 1e-4), maxY = Math.floor(y + HEIGHT - 1e-4);
    const minZ = Math.floor(z - HALF + 1e-4), maxZ = Math.floor(z + HALF - 1e-4);
    for (let yy = minY; yy <= maxY; yy++)
      for (let xx = minX; xx <= maxX; xx++)
        for (let zz = minZ; zz <= maxZ; zz++)
          if (w.isSolid(xx, yy, zz)) return true;
    return false;
  }

  takeDamage(dmg, dir) {
    if (!this.alive) return;
    this.health -= dmg;
    this.hitFlash = 0.10;
    if (dir) {
      const k = new THREE.Vector3(dir.x, 0, dir.z);
      if (k.lengthSq() > 0) { k.normalize(); this.pos.x += k.x * 0.05; this.pos.z += k.z * 0.05; } // 幾乎不會被推動
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.state = 'dead';
      this.deadT = 0;
      for (const m of this.materials) { m.emissive.setHex(0x000000); m.transparent = true; }
      for (const gmesh of this.glows) gmesh.material.transparent = true;
    }
  }

  hasLOS(target) {
    const a = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
    const b = new THREE.Vector3(target.pos.x, target.pos.y + 1.3, target.pos.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.001) return true;
    d.divideScalar(len);
    for (let t = 0.5; t < len - 0.4; t += 0.4) {
      if (this.world.isSolid(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t)) return false;
    }
    return true;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const nx = this.pos.x + (axis === 'x' ? d : 0);
    const nz = this.pos.z + (axis === 'z' ? d : 0);
    if (!this.collides(nx, this.pos.y, nz)) { this.pos.x = nx; this.pos.z = nz; return; }
    // 撞牆就往上爬一階（機甲會爬過箱子）
    if (!this.collides(nx, this.pos.y + 1.02, nz)) { this.pos.x = nx; this.pos.z = nz; this.pos.y += 1.02; return; }
    if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
  }

  // ---- 屬性技能實作 ----
  castAbility(key, target, dist) {
    const m = this.manager;
    if (!m) return false;
    const cfg = this.cfg;
    const sc = m.scene;
    switch (key) {
      case 'slam': {
        // 震地衝擊波：以 BOSS 為中心的環狀衝擊（近距離才放）
        if (dist > 13) return false;
        m.addFx(new NovaRing(sc, this.pos.x, this.pos.y, this.pos.z, {
          maxR: 9.5, speed: 15, damage: cfg.bossSlamDamage || 26, knock: 6, color: this.kind.tint,
        }));
        if (m.onBossCast) m.onBossCast('⚠ 震地衝擊波！');
        return true;
      }
      case 'vines': {
        // 叢林：在玩家腳下種一片藤蔓，站上去會持續受傷，時間到炸裂
        if (dist > 32) return false;
        m.addFx(new VinePatch(sc, target.pos.x, target.pos.y, target.pos.z, {
          radius: 3.6, dps: cfg.bossVineDps || 18, burst: cfg.bossVineDamage || 36, life: 2.8,
        }));
        if (m.onBossCast) m.onBossCast('🌿 叢林藤蔓在地面蔓延…（快離開！）');
        return true;
      }
      case 'thornBurst': {
        // 荊棘爆發：一圈荊棘子彈往四面八方射
        const n = 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.25;
          const fake = { pos: { x: this.pos.x + Math.sin(a) * 24, y: this.pos.y + 1.0, z: this.pos.z + Math.cos(a) * 24 }, alive: true };
          m.spawnBullet(this, fake, { accuracy: 0.92, bulletSpeed: 27, damage: cfg.bossThornDamage || 16 });
        }
        if (m.onBossCast) m.onBossCast('🌿 荊棘爆發！');
        return true;
      }
      case 'iceSpikes': {
        // 冰尖刺：朝玩家方向冒出一排冰刺（命中受傷＋減速）
        if (dist > 28) return false;
        m.addFx(new IceSpikes(sc, this.pos.x, this.pos.y, this.pos.z, target.pos.x - this.pos.x, target.pos.z - this.pos.z, {
          count: 4 + Math.min(3, this.tier), damage: cfg.bossSpikeDamage || 20, life: 3.8,
        }));
        if (m.onBossCast) m.onBossCast('❄ 冰尖刺從地面竄出！');
        return true;
      }
      case 'frostNova': {
        // 冰霜新星：一圈會減速的冰環
        m.addFx(new NovaRing(sc, this.pos.x, this.pos.y, this.pos.z, {
          maxR: 11, speed: 11, damage: cfg.bossFrostDamage || 22, slowMul: 0.45, slowSec: 2.8, color: 0x9fe8ff,
        }));
        if (m.onBossCast) m.onBossCast('❄ 冰霜新星！被掃到會變慢');
        return true;
      }
      case 'iceWall': {
        // 冰牆：召喚一道擋子彈的冰牆（可以拿來當掩護，也會擋住你的子彈）
        if (dist < 3.5) return false;
        m.addFx(new IceWall(sc, this.pos.x, this.pos.y, this.pos.z, target.pos.x - this.pos.x, target.pos.z - this.pos.z, {
          width: 7 + Math.min(3, this.tier), height: 3, life: 9,
        }));
        if (m.onBossCast) m.onBossCast('🧊 召喚冰牆！會擋子彈');
        return true;
      }
    }
    return false;
  }

  update(dt, player, onPlayerHit, ally) {
    const cfg = this.cfg;

    if (!this.alive) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 1.4);
      this.group.rotation.z = t * Math.PI * 0.5;
      this.group.position.set(this.pos.x, this.pos.y - t * 0.4, this.pos.z);
      const fade = Math.max(0, 1 - Math.max(0, this.deadT - 1.6) / 1.2);
      for (const m of this.materials) m.opacity = fade;
      for (const gmesh of this.glows) gmesh.material.opacity = fade;
      this.flash.visible = false;
      if (this.deadT > 3.0) this.removeMe = true;
      return;
    }

    this.shootT = Math.max(0, this.shootT - dt);
    this.kick = Math.max(0, this.kick - dt * 3);
    this.flashT = Math.max(0, this.flashT - dt);
    this.summonFlash = Math.max(0, this.summonFlash - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;

    // 受擊 / 冰凍 / 召喚 特效狀態（只在變化時寫材質，省效能）
    const fx = this.hitFlash > 0 ? 1 : (this.freeze > 0 ? 2 : (this.summonFlash > 0 ? 3 : 0));
    if (fx !== this.fxState) {
      this.fxState = fx;
      const c = fx === 1 ? 0x992222 : (fx === 2 ? 0x1d3f8f : (fx === 3 ? 0x224488 : 0x000000));
      for (const m of this.materials) m.emissive.setHex(c);
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 被冰凍：機甲也動不了
    if (this.freeze > 0) {
      this.freeze -= dt;
      this.vel.x = 0; this.vel.z = 0;
      this.vel.y -= GRAV * dt;
      if (!this.collides(this.pos.x, this.pos.y + this.vel.y * dt, this.pos.z)) this.pos.y += this.vel.y * dt;
      else this.vel.y = 0;
      this.burst = 0;
      this.flash.visible = false;
      this.visor.material.emissive.setHex(0x4488ff);
      this.group.rotation.y = this.yaw;
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      return;
    }

    // 目標：最近的活著的人（玩家或隊友）
    let target = player;
    let dx = player.pos.x - this.pos.x;
    let dz = player.pos.z - this.pos.z;
    let dist = Math.hypot(dx, dz);
    if (ally && ally.alive) {
      const adx = ally.pos.x - this.pos.x, adz = ally.pos.z - this.pos.z;
      const adist = Math.hypot(adx, adz);
      if (adist < dist) { target = ally; dx = adx; dz = adz; dist = adist; }
    }

    const seen = target.alive && dist < cfg.aggro + 14 && this.hasLOS(target);
    this.yaw = Math.atan2(dx, dz);

    // --- 暴衝 ---
    this.chargeT -= dt;
    if (this.chargeT <= 0 && this.chargeLeft <= 0 && seen && dist > 6) {
      this.chargeLeft = 1.5;
      this.chargeT = cfg.bossChargeCd || 5.8;
    }

    let dirX = 0, dirZ = 0;
    if (this.chargeLeft > 0) {
      this.chargeLeft -= dt;
      this.state = 'charge';
      dirX = dx; dirZ = dz;
    } else if (seen && dist > 3.2) {
      this.state = 'walk';
      dirX = dx; dirZ = dz;
    } else {
      this.state = 'hold';
    }

    // --- 開火（三連發，用幀計時不用 setTimeout：換關時才不會噴出殘留子彈） ---
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burst--;
        this.burstT = 0.11;
        this.kick = 1;
        this.flashT = 0.06;
        if (this.manager) {
          this.manager.spawnBullet(this, target, {
            accuracy: cfg.bossAccuracy || 0.86,
            bulletSpeed: 34,
            damage: cfg.bossDamage,
          });
        }
      }
    } else if (seen && dist < 32 && this.shootT <= 0) {
      this.shootT = cfg.bossCd * (0.9 + Math.random() * 0.25);
      this.burst = this.burstSize;
      this.burstT = 0;
    }

    // --- 召喚小兵（總數上限不變，只是間隔變短）---
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = cfg.bossSummonCd || 13;
      if (this.manager && this.summoned < this.maxSummons && this.manager.list.length < 46) {
        this.summonFlash = 0.5;
        const n = this.manager.spawnMinion(this.world, cfg, this.pos.x, this.pos.z, 2);
        this.summoned += n;
        if (n > 0 && this.manager.onSummon) this.manager.onSummon(n);
      }
    }

    // --- 屬性技能（每隻 BOSS 依屬性有不同的技能組合）---
    this.castLock = Math.max(0, this.castLock - dt);
    const cdm = Math.max(0.62, 1 - 0.06 * this.tier);
    for (const key of this.kind.abilities) {
      this.abT[key] -= dt;
      if (this.abT[key] > 0) continue;
      if (!seen || this.castLock > 0) break;                 // 沒看到玩家就先憋著
      if (this.castAbility(key, target, dist)) {
        this.abT[key] = AB_CD[key] * cdm;
        this.castLock = 1.2;
      } else {
        this.abT[key] = 1.5;                                 // 條件不符（太遠…），1.5 秒後再試
      }
    }

    const dl = Math.hypot(dirX, dirZ);
    const spd = this.state === 'charge' ? cfg.bossSpeed * (cfg.bossChargeMul || 2.9) : cfg.bossSpeed;
    if (dl > 0.001) { this.vel.x = (dirX / dl) * spd; this.vel.z = (dirZ / dl) * spd; }
    else { this.vel.x = 0; this.vel.z = 0; }

    this.vel.y -= GRAV * dt;
    if (this.vel.y < -50) this.vel.y = -50;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    if (!this.collides(this.pos.x, this.pos.y + this.vel.y * dt, this.pos.z)) this.pos.y += this.vel.y * dt;
    else this.vel.y = 0;

    // 走路動畫 / 開火後座 / 核心呼吸 / 警示燈閃爍
    if (dl > 0.001) this.walkPhase += dt * (this.state === 'charge' ? 11 : 4.5);
    const sw = Math.sin(this.walkPhase) * 0.55;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.6;
    this.gun.position.z = 0.30 - this.kick * 0.12;
    const now = performance.now();
    const pulse = 0.85 + Math.sin(now * 0.006) * 0.15;
    this.core.scale.setScalar(pulse);
    const cc = this.kind.core;
    this.core.material.emissive.setRGB(cc[0] * pulse, cc[1] * pulse, cc[2] * pulse);
    const blink = Math.sin(now * 0.005) > -0.2 ? this.kind.tint : 0x201014;   // 呼吸式閃爍的肩燈（依屬性換色）
    for (const gmesh of this.glowList) gmesh.material.emissive.setHex(blink);
    this.visor.material.emissive.setHex(this.freeze > 0 ? 0x4488ff : (this.summonFlash > 0 ? 0x66aaff : this.kind.tint));

    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
  }
}
