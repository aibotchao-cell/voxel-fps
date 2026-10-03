import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Human enemies that carry a gun and SHOOT at the player.
// Model: blocky human w/ tactical vest, arms forward holding a rifle.
// AI: wander -> spot (LOS) -> close distance -> hold & shoot -> bullets hurt player.
// ---------------------------------------------------------------------------

const SKIN = 0xd8a273;
const HAIR = 0x33251a;
const VEST = 0x47513c;
const SHIRT = 0x6a6f5a;
const PANTS = 0x2b2f36;
const BOOT = 0x15171b;
const GUNM = 0x2a2d33;

// 敵人的頭＝單純的膚色方塊（v2.2 起移除照片臉：AlbertC 要求不要把真人照片放進遊戲）
const HALF = 0.34;
const HEIGHT = 1.9;

function lam(c) { return new THREE.MeshLambertMaterial({ color: c }); }

export class Enemy {
  constructor(world, x, z, spawn, cfg) {
    this.world = world;
    this.pos = new THREE.Vector3(x, 1, z);
    this.vel = new THREE.Vector3();
    this.spawn = spawn ? spawn.clone() : new THREE.Vector3(x, 1, z);

    this.cfg = cfg;
    this.maxHealth = cfg.health;
    this.health = cfg.health;
    this.alive = true;
    this.state = 'idle';
    this.shootTimer = cfg.shootCd * (0.5 + Math.random());
    this.walkPhase = 0;
    this.wanderT = 0;
    this.wanderTarget = this.spawn.clone();
    this.deadT = 0;
    this.removeMe = false;
    this.hitFlash = 0;
    this.freeze = 0;        // 被冰凍剩餘秒數（冰凍榴彈）
    this.fxState = 0;       // 只在狀態變化時才寫材質，省效能
    this.yaw = 0;
    this.materials = [];
    this.kick = 0;
    this.flashT = 0;
    this.group = this.build();
    this.manager = null; // set by manager (to spawn bullets)
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

    // legs + boots
    this.legL = mk(0.22, 0.72, 0.22, -0.13, 0.36, 0, PANTS);
    this.legR = mk(0.22, 0.72, 0.22, 0.13, 0.36, 0, PANTS);
    mk(0.24, 0.14, 0.30, -0.13, 0.07, 0.03, BOOT);
    mk(0.24, 0.14, 0.30, 0.13, 0.07, 0.03, BOOT);

    // torso + vest
    mk(0.60, 0.70, 0.30, 0, 1.12, 0, SHIRT);
    mk(0.64, 0.44, 0.34, 0, 1.16, 0, VEST);

    // arms forward holding the gun (local +Z faces the player)
    mk(0.16, 0.16, 0.62, -0.20, 1.24, 0.28, SHIRT);
    mk(0.16, 0.16, 0.62, 0.20, 1.24, 0.28, SHIRT);
    mk(0.15, 0.15, 0.16, -0.20, 1.24, 0.60, SKIN); // hands
    mk(0.15, 0.15, 0.16, 0.20, 1.24, 0.60, SKIN);

    // gun
    const gun = new THREE.Group();
    gun.position.set(0.16, 1.22, 0.60);
    mk(0.09, 0.11, 0.54, 0, 0, 0, GUNM, gun);
    mk(0.05, 0.05, 0.24, 0, 0.01, 0.36, GUNM, gun);
    mk(0.06, 0.20, 0.10, 0, -0.14, -0.06, GUNM, gun);
    this.gun = gun;
    g.add(gun);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffcc55, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    this.flash.position.set(0.16, 1.24, 1.02);
    this.flash.visible = false;
    g.add(this.flash);

    // head + hair（單純的方塊頭：膚色方塊＋頭髮，沒有照片）
    this.head = mk(0.46, 0.46, 0.46, 0, 1.66, 0, SKIN);
    mk(0.48, 0.13, 0.48, 0, 1.85, 0, HAIR);

    g.position.copy(this.pos);
    return g;
  }

  aabb() {
    return {
      min: { x: this.pos.x - 0.36, y: this.pos.y, z: this.pos.z - 0.36 },
      max: { x: this.pos.x + 0.36, y: this.pos.y + HEIGHT, z: this.pos.z + 0.36 },
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
    this.hitFlash = 0.12;
    if (dir) {
      const k = new THREE.Vector3(dir.x, 0, dir.z);
      if (k.lengthSq() > 0) { k.normalize(); this.pos.x += k.x * 0.26; this.pos.z += k.z * 0.26; }
    }
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.state = 'dead'; this.deadT = 0;
      for (const m of this.materials) m.emissive.setHex(0x000000); // clear hit-flash on death
    }
  }

  hasLOS(target) {
    const a = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const b = new THREE.Vector3(target.pos.x, target.pos.y + 1.5, target.pos.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.001) return true;
    d.divideScalar(len);
    const step = 0.35;
    for (let t = step; t < len - 0.25; t += step) {
      if (this.world.isSolid(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t)) return false;
    }
    return true;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const nx = this.pos.x + (axis === 'x' ? d : 0);
    const nz = this.pos.z + (axis === 'z' ? d : 0);
    if (!this.collides(nx, this.pos.y, nz)) { this.pos.x = nx; this.pos.z = nz; return; }
    if (!this.collides(nx, this.pos.y + 1.02, nz) && !this.collides(this.pos.x, this.pos.y + 1.02, this.pos.z)) {
      this.pos.x = nx; this.pos.z = nz; this.pos.y += 1.02; return;
    }
    if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
  }

  update(dt, player, onPlayerHit, ally) {
    if (!this.alive) {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.6);
      this.group.rotation.z = t * Math.PI * 0.5;
      this.group.position.y = this.pos.y - t * 0.1;
      this.group.position.x = this.pos.x;
      this.group.position.z = this.pos.z;
      if (this.deadT > 1.3) this.removeMe = true;
      return;
    }

    this.shootTimer = Math.max(0, this.shootTimer - dt);
    this.kick = Math.max(0, this.kick - dt * 3);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;

    if (this.hitFlash > 0) this.hitFlash -= dt;

    // 受擊紅光 / 冰凍藍光（只在變化時寫材質）
    const fx = this.hitFlash > 0 ? 1 : (this.freeze > 0 ? 2 : 0);
    if (fx !== this.fxState) {
      this.fxState = fx;
      const col = fx === 1 ? 0x882222 : (fx === 2 ? 0x1d3f8f : 0x000000);
      for (const m of this.materials) m.emissive.setHex(col);
    }

    // 被凍住：不能動、不能開槍（仍受重力）
    if (this.freeze > 0) {
      this.freeze -= dt;
      this.vel.x = 0; this.vel.z = 0;
      this.vel.y -= 26 * dt;
      if (!this.collides(this.pos.x, this.pos.y + this.vel.y * dt, this.pos.z)) this.pos.y += this.vel.y * dt;
      else this.vel.y = 0;
      this.group.rotation.y = this.yaw;
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      return;
    }

    const cfg = this.cfg;
    // target the nearest live thing: the player, or the ally
    let target = player;
    let dx = player.pos.x - this.pos.x;
    let dz = player.pos.z - this.pos.z;
    let dist = Math.hypot(dx, dz);
    if (ally && ally.alive) {
      const adx = ally.pos.x - this.pos.x;
      const adz = ally.pos.z - this.pos.z;
      const adist = Math.hypot(adx, adz);
      if (adist < dist) { target = ally; dx = adx; dz = adz; dist = adist; }
    }

    let moving = false;
    const seen = target.alive && dist < cfg.aggro && this.hasLOS(target);

    let dirX = 0, dirZ = 0;

    if (seen && dist <= cfg.shootRange) {
      // hold position and shoot
      this.state = 'shoot';
      this.yaw = Math.atan2(dx, dz);
      if (this.shootTimer <= 0) {
        this.shootTimer = cfg.shootCd * (0.85 + Math.random() * 0.3);
        this.kick = 1;
        this.flashT = 0.06;
        if (this.manager) this.manager.spawnBullet(this, target, cfg);
      }
    } else if (seen) {
      // close in
      this.state = 'chase';
      dirX = dx; dirZ = dz;
      moving = true;
      this.yaw = Math.atan2(dirX, dirZ);
    } else {
      this.state = 'wander';
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 3 + Math.random() * 4;
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 6;
        this.wanderTarget.set(this.spawn.x + Math.cos(a) * r, this.pos.y, this.spawn.z + Math.sin(a) * r);
      }
      const wx = this.wanderTarget.x - this.pos.x;
      const wz = this.wanderTarget.z - this.pos.z;
      if (Math.hypot(wx, wz) > 0.6) { dirX = wx; dirZ = wz; moving = true; this.yaw = Math.atan2(dirX, dirZ); }
    }

    const dl = Math.hypot(dirX, dirZ);
    const spd = this.state === 'chase' ? cfg.speed : cfg.speed * 0.45;
    if (dl > 0.001) { this.vel.x = (dirX / dl) * spd; this.vel.z = (dirZ / dl) * spd; }
    else { this.vel.x = 0; this.vel.z = 0; }

    this.vel.y -= 26 * dt;
    if (this.vel.y < -45) this.vel.y = -45;

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    if (!this.collides(this.pos.x, this.pos.y + this.vel.y * dt, this.pos.z)) this.pos.y += this.vel.y * dt;
    else this.vel.y = 0;

    // walk animation
    if (moving) this.walkPhase += dt * 7;
    const sw = Math.sin(this.walkPhase) * 0.7 * (moving ? 1 : 0);
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;

    // gun kick on shoot
    this.gun.position.z = 0.60 - this.kick * 0.06;

    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
  }
}

// ---------------------------------------------------------------------------
export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.bullets = [];
    this.fx = [];                 // BOSS 技能的場上危險物件（藤蔓／冰尖刺／衝擊波／冰牆）
    this.bulletGeo = new THREE.BoxGeometry(0.05, 0.05, 0.42);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  }

  // BOSS 丟技能時把危險物件加進來（統一在這裡更新／清除，換關不會殘留）
  addFx(f) { this.fx.push(f); return f; }

  clearFx() {
    for (const f of this.fx) { if (f.dispose) f.dispose(); }
    this.fx.length = 0;
  }

  spawn(world, cfg, centerX, centerZ) {
    let placed = 0, guard = 0;
    while (placed < cfg.enemies && guard < 12000) {
      guard++;
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 15;
      const x = Math.round(centerX + Math.cos(a) * r);
      const z = Math.round(centerZ + Math.sin(a) * r);
      if (x < 2 || x > 41 || z < 2 || z > 41) continue;
      if (Math.abs(x - centerX) < 8 && Math.abs(z - centerZ) < 8) continue;
      if (world.get(x, 0, z) === 0) continue;
      if (world.get(x, 1, z) !== 0 || world.get(x, 2, z) !== 0) continue;
      // 程序生成的關卡：只生在「從出生點走得到」的格子，不然敵人會卡在牆後面打不到
      if (!world.placeable(x, z)) continue;
      const e = new Enemy(world, x + 0.5, z + 0.5, new THREE.Vector3(x + 0.5, 1, z + 0.5), cfg);
      e.manager = this;
      this.scene.add(e.group);
      this.list.push(e);
      placed++;
    }
    // 萬一真的找不到足夠的合法位置（地形太擠），退而求其次：找任何站得住的格子
    if (placed < cfg.enemies) {
      let g2 = 0;
      while (placed < cfg.enemies && g2 < 8000) {
        g2++;
        const x = 2 + Math.floor(Math.random() * 39);
        const z = 2 + Math.floor(Math.random() * 39);
        if (Math.abs(x - centerX) < 8 && Math.abs(z - centerZ) < 8) continue;
        if (!world.standable(x, z)) continue;
        if (this.list.some((o) => Math.abs(o.pos.x - (x + 0.5)) < 1 && Math.abs(o.pos.z - (z + 0.5)) < 1)) continue;
        const e = new Enemy(world, x + 0.5, z + 0.5, new THREE.Vector3(x + 0.5, 1, z + 0.5), cfg);
        e.manager = this;
        this.scene.add(e.group);
        this.list.push(e);
        placed++;
      }
    }
    return placed;
  }

  // enemy -> player bullet
  spawnBullet(enemy, tgt, cfg) {
    const yaw = enemy.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const origin = new THREE.Vector3(
      enemy.pos.x + fx * 1.02,
      enemy.pos.y + 1.24,
      enemy.pos.z + fz * 1.02
    );
    const aim = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z);
    const dir = new THREE.Vector3().subVectors(aim, origin).normalize();
    const sp = (1 - cfg.accuracy) * 0.16;
    dir.x += (Math.random() - 0.5) * sp;
    dir.y += (Math.random() - 0.5) * sp;
    dir.z += (Math.random() - 0.5) * sp;
    dir.normalize();

    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(origin);
    mesh.lookAt(origin.clone().add(dir));
    this.scene.add(mesh);
    this.bullets.push({ mesh, pos: origin.clone(), dir, speed: cfg.bulletSpeed, life: 2.2, damage: cfg.damage });
  }

  // 當前活著的 BOSS（沒有就 null）
  get boss() { return this.list.find((e) => e.isBoss && e.alive) || null; }
  get anyBoss() { return this.list.find((e) => e.isBoss) || null; }

  addBoss(boss) {
    boss.manager = this;
    this.scene.add(boss.group);
    this.list.push(boss);
    return boss;
  }

  // BOSS 召喚小兵（在 BOSS 附近找合法的地板位置）
  spawnMinion(world, cfg, x, z, count = 2) {
    let placed = 0;
    for (let i = 0; i < count; i++) {
      let guard = 0;
      while (guard++ < 200) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 4;
        const mx = Math.round(x + Math.cos(a) * r);
        const mz = Math.round(z + Math.sin(a) * r);
        if (mx < 2 || mx > 41 || mz < 2 || mz > 41) continue;
        if (world.get(mx, 0, mz) === 0) continue;
        if (world.get(mx, 1, mz) !== 0 || world.get(mx, 2, mz) !== 0) continue;
        const e = new Enemy(world, mx + 0.5, mz + 0.5, new THREE.Vector3(mx + 0.5, 1, mz + 0.5), cfg);
        e.manager = this;
        this.scene.add(e.group);
        this.list.push(e);
        placed++;
        break;
      }
    }
    return placed;
  }

  aliveCount() { return this.list.filter((e) => e.alive).length; }

  clear() {
    for (const e of this.list) this.scene.remove(e.group);
    for (const b of this.bullets) this.scene.remove(b.mesh);
    this.list.length = 0;
    this.bullets.length = 0;
    this.clearFx();
  }

  updateBullets(dt, player, onPlayerHit, ally) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      let dead = false;
      // substep to avoid tunnelling
      const total = b.speed * dt;
      const steps = Math.max(1, Math.ceil(total / 0.4));
      for (let s = 0; s < steps && !dead; s++) {
        b.pos.x += b.dir.x * (total / steps);
        b.pos.y += b.dir.y * (total / steps);
        b.pos.z += b.dir.z * (total / steps);
        b.mesh.position.copy(b.pos);

        if (this.worldRef && this.worldRef.isSolid(b.pos.x, b.pos.y, b.pos.z)) { dead = true; break; }

        // 冰牆擋子彈（BOSS 技能）
        for (const f of this.fx) {
          if (f.blocksBullet && f.blocksBullet(b.pos)) { dead = true; break; }
        }
        if (dead) break;

        if (player.alive) {
          const dx = Math.abs(b.pos.x - player.pos.x);
          const dz = Math.abs(b.pos.z - player.pos.z);
          const dy = b.pos.y - player.pos.y;
          if (dx < 0.45 && dz < 0.45 && dy > -0.2 && dy < 1.9) {
            // damage() 回傳 false = 重生無敵中，就不閃受傷紅光
            if (player.damage(b.damage) && onPlayerHit) onPlayerHit(b.damage);
            dead = true;
            break;
          }
        }

        if (ally && ally.alive) {
          const ax = Math.abs(b.pos.x - ally.pos.x);
          const az = Math.abs(b.pos.z - ally.pos.z);
          const ay = b.pos.y - ally.pos.y;
          if (ax < 0.5 && az < 0.5 && ay > -0.2 && ay < 1.9) {
            ally.takeDamage(b.damage);
            dead = true;
            break;
          }
        }
      }
      if (b.life <= 0) dead = true;
      if (dead) { this.scene.remove(b.mesh); this.bullets.splice(i, 1); }
    }
  }

  update(dt, player, onPlayerHit, world, ally) {
    this.worldRef = world || this.worldRef;
    // BOSS 技能的危險物件（會打到玩家）
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.update(dt, player, onPlayerHit);
      if (f.removeMe) { if (f.dispose) f.dispose(); this.fx.splice(i, 1); }
    }
    for (const e of this.list) e.update(dt, player, onPlayerHit, ally);
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].removeMe) { this.scene.remove(this.list[i].group); this.list.splice(i, 1); }
    }
    this.updateBullets(dt, player, onPlayerHit, ally);
  }
}
