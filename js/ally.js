import * as THREE from 'three';
import { rayBox, raycastWorld } from './weapons.js';
import { RESPAWN_WARD } from './player.js';

// ---------------------------------------------------------------------------
// Friendly teammate: blocky human in BLUE, follows the player, auto-engages
// the nearest visible enemy with hitscan fire. Can be shot by enemies.
// ---------------------------------------------------------------------------

const SKIN = 0xd8a273;
const HAIR = 0x2a2018;
const VEST = 0x2f679b;
const SHIRT = 0x3d7db5;
const PANTS = 0x33383f;
const BOOT = 0x15171b;
const GUNM = 0x2a2d33;
const MARKER = 0x49b6ff;

const HALF = 0.34;
const HEIGHT = 1.9;

function lam(c) { return new THREE.MeshLambertMaterial({ color: c }); }

export class Ally {
  constructor(scene, world, x, z) {
    this.scene = scene;
    this.world = world;
    this.pos = new THREE.Vector3(x, 1, z);
    this.vel = new THREE.Vector3();
    this.maxHealth = 100;
    this.health = 100;
    this.alive = true;
    this.invuln = RESPAWN_WARD;      // 開場 5 秒不受傷
    this.yaw = 0;
    this.walkPhase = 0;
    this.shootTimer = 1.0;
    this.kick = 0;
    this.flashT = 0;
    this.hitFlash = 0;
    this.deadT = 0;
    this.kills = 0;
    this.materials = [];

    this.range = 26;
    this.fireCd = 0.6;
    this.damage = 22;
    this.speed = 4.4;
    this.followDist = 4.5;

    this.group = this.build();
    scene.add(this.group);

    this.tracer = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.03, 1),
      new THREE.MeshBasicMaterial({ color: 0xcdeeff })
    );
    this.tracer.visible = false;
    scene.add(this.tracer);
    this.tracerT = 0;
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

    this.legL = mk(0.22, 0.72, 0.22, -0.13, 0.36, 0, PANTS);
    this.legR = mk(0.22, 0.72, 0.22, 0.13, 0.36, 0, PANTS);
    mk(0.24, 0.14, 0.30, -0.13, 0.07, 0.03, BOOT);
    mk(0.24, 0.14, 0.30, 0.13, 0.07, 0.03, BOOT);

    mk(0.60, 0.70, 0.30, 0, 1.12, 0, SHIRT);
    mk(0.64, 0.44, 0.34, 0, 1.16, 0, VEST);

    mk(0.16, 0.16, 0.62, -0.20, 1.24, 0.28, SHIRT);
    mk(0.16, 0.16, 0.62, 0.20, 1.24, 0.28, SHIRT);
    mk(0.15, 0.15, 0.16, -0.20, 1.24, 0.60, SKIN);
    mk(0.15, 0.15, 0.16, 0.20, 1.24, 0.60, SKIN);

    const gun = new THREE.Group();
    gun.position.set(0.16, 1.22, 0.60);
    mk(0.09, 0.11, 0.54, 0, 0, 0, GUNM, gun);
    mk(0.05, 0.05, 0.24, 0, 0.01, 0.36, GUNM, gun);
    mk(0.06, 0.20, 0.10, 0, -0.14, -0.06, GUNM, gun);
    this.gun = gun;
    g.add(gun);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    this.flash.position.set(0.16, 1.24, 1.02);
    this.flash.visible = false;
    g.add(this.flash);

    mk(0.46, 0.46, 0.46, 0, 1.66, 0, SKIN);
    mk(0.48, 0.13, 0.48, 0, 1.85, 0, HAIR);

    // friendly marker above head (helps you spot him)
    this.marker = mk(0.26, 0.26, 0.26, 0, 2.15, 0, MARKER);

    g.position.copy(this.pos);
    return g;
  }

  reset(x, z) {
    this.pos.set(x, 1, z);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.invuln = RESPAWN_WARD;      // 跟玩家一樣：重生後 5 秒不受傷
    this.deadT = 0;
    this.shootTimer = 0.6;
    this.group.rotation.z = 0;
    this.group.position.copy(this.pos);
    this.group.visible = true;
    this.tracer.visible = false;
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    if (this.invuln > 0) return;     // 重生保護：5 秒內不受傷
    this.health = Math.max(0, this.health - dmg);
    this.hitFlash = 0.12;
    if (this.health === 0) {
      this.alive = false; this.deadT = 0;
      for (const m of this.materials) m.emissive.setHex(0x000000); // clear hit-flash on death
    }
  }

  hasLOS(target) {
    const a = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const b = new THREE.Vector3(target.pos.x, target.pos.y + 1.2, target.pos.z);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.001) return true;
    d.divideScalar(len);
    for (let t = 0.4; t < len - 0.3; t += 0.35) {
      if (this.world.isSolid(a.x + d.x * t, a.y + d.y * t, a.z + d.z * t)) return false;
    }
    return true;
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

  findTarget(enemyMgr) {
    let best = null, bestDist = this.range;
    for (const e of enemyMgr.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < bestDist && this.hasLOS(e)) { best = e; bestDist = d; }
    }
    return best;
  }

  shootAt(target) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const from = new THREE.Vector3(this.pos.x + fx * 1.0, this.pos.y + 1.24, this.pos.z + fz * 1.0);
    const to = new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z);
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    dir.x += (Math.random() - 0.5) * 0.05;
    dir.y += (Math.random() - 0.5) * 0.05;
    dir.z += (Math.random() - 0.5) * 0.05;
    dir.normalize();

    let best = null, bestT = this.range;
    // scan enemies for the nearest hit along the ray
    const list = this._enemyList || [];
    for (const e of list) {
      if (!e.alive) continue;
      const bb = e.aabb();
      const t = rayBox(from, dir, bb.min, bb.max);
      if (t !== null && t < bestT) { bestT = t; best = e; }
    }
    const wh = raycastWorld(this.world, from, dir, this.range);

    let hitPoint;
    if (best && (!wh || bestT < wh.dist)) {
      best.takeDamage(this.damage, dir);
      hitPoint = from.clone().add(dir.clone().multiplyScalar(bestT));
      if (!best.alive) this.kills++;
    } else {
      hitPoint = wh ? wh.point : from.clone().add(dir.clone().multiplyScalar(this.range));
    }

    // tracer
    const mid = from.clone().add(hitPoint).multiplyScalar(0.5);
    const len = from.distanceTo(hitPoint);
    this.tracer.position.copy(mid);
    this.tracer.lookAt(hitPoint);
    this.tracer.scale.set(1, 1, Math.max(0.1, len));
    this.tracer.visible = true;
    this.tracerT = 0.05;

    this.flashT = 0.05;
    this.kick = 1;
  }

  update(dt, player, enemyMgr) {
    this._enemyList = enemyMgr ? enemyMgr.list : [];
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    if (this.tracerT > 0) { this.tracerT -= dt; if (this.tracerT <= 0) this.tracer.visible = false; }

    if (!this.alive) {
      // lie down, then respawn near the player after a few seconds
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.6);
      this.group.rotation.z = t * Math.PI * 0.5;
      this.group.position.y = this.pos.y - t * 0.1;
      if (this.deadT > 4) {
        const off = Math.random() * Math.PI * 2;
        this.reset(player.pos.x + Math.cos(off) * 2.5, player.pos.z + Math.sin(off) * 2.5);
      }
      return;
    }

    this.shootTimer = Math.max(0, this.shootTimer - dt);
    this.kick = Math.max(0, this.kick - dt * 3);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.rotation.z = Math.random() * Math.PI;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const e = this.hitFlash > 0 ? 0x884444 : 0x000000;
      for (const m of this.materials) m.emissive.setHex(e);
    }

    const target = this.findTarget(enemyMgr);
    let dirX = 0, dirZ = 0, moving = false;

    if (target) {
      // engage: face and shoot
      this.yaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      const d = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
      if (d > this.range * 0.7) { dirX = target.pos.x - this.pos.x; dirZ = target.pos.z - this.pos.z; moving = true; }
      if (this.shootTimer <= 0) { this.shootTimer = this.fireCd * (0.85 + Math.random() * 0.3); this.shootAt(target); }
    } else {
      // follow the player
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.followDist) {
        dirX = dx; dirZ = dz; moving = true;
        this.yaw = Math.atan2(dirX, dirZ);
      } else {
        this.yaw = player.yaw;
      }
    }

    const dl = Math.hypot(dirX, dirZ);
    const spd = this.speed;
    if (dl > 0.001) { this.vel.x = (dirX / dl) * spd; this.vel.z = (dirZ / dl) * spd; }
    else { this.vel.x = 0; this.vel.z = 0; }

    this.vel.y -= 26 * dt;
    if (this.vel.y < -45) this.vel.y = -45;
    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    if (!this.collides(this.pos.x, this.pos.y + this.vel.y * dt, this.pos.z)) this.pos.y += this.vel.y * dt;
    else this.vel.y = 0;

    if (moving) this.walkPhase += dt * 7;
    const sw = Math.sin(this.walkPhase) * 0.7 * (moving ? 1 : 0);
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.gun.position.z = 0.60 - this.kick * 0.06;

    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.marker) this.marker.position.y = 2.15 + Math.sin(performance.now() * 0.004) * 0.06;
  }
}
