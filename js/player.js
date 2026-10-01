import * as THREE from 'three';

const HALF = 0.3;      // player half-width
const HEIGHT = 1.8;    // player height
const EYE = 1.62;      // eye height from feet
const GRAVITY = -26;
const JUMP = 8.6;
const SPEED = 5.2;
const AIR_CONTROL = 0.6;
export const RESPAWN_WARD = 5;   // 重生後幾秒無敵（不然一重生就被秒）
export class Player {
  constructor(world, x, y, z) {
    this.world = world;
    this.pos = new THREE.Vector3(x, y, z); // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.invuln = RESPAWN_WARD;   // 開場也給一次，讓玩家有時間看清楚
    this.bob = 0;
    this.moveX = 0; this.moveZ = 0;
    this.speed = SPEED; // upgradable at the shop
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

  update(dt, input) {
    if (!this.alive) return;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // camera-relative basis (three.js: forward is -Z, rotated by yaw)
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = rx * input.moveX + fx * input.moveZ;
    let mz = rz * input.moveX + fz * input.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    this.moveX = mx; this.moveZ = mz;

    const ctrl = this.grounded ? 1 : AIR_CONTROL;
    this.vel.x = mx * this.speed * ctrl;
    this.vel.z = mz * this.speed * ctrl;

    this.vel.y += GRAVITY * dt;
    if (this.vel.y < -45) this.vel.y = -45;

    if (input.jump && this.grounded) { this.vel.y = JUMP; this.grounded = false; }

    this.moveAxis('x', this.vel.x * dt);
    this.moveAxis('z', this.vel.z * dt);
    this.grounded = false;
    this.moveY(this.vel.y * dt);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 0.5) this.bob += dt * 12; else this.bob *= 0.9;
  }

  moveAxis(axis, d) {
    if (d === 0) return;
    const nx = this.pos.x + (axis === 'x' ? d : 0);
    const nz = this.pos.z + (axis === 'z' ? d : 0);
    if (!this.collides(nx, this.pos.y, nz)) { this.pos.x = nx; this.pos.z = nz; return; }
    // step up one block (keeps blocky factory navigable)
    if (this.grounded && !this.collides(nx, this.pos.y + 1.02, nz)) {
      this.pos.x = nx; this.pos.z = nz; this.pos.y += 1.02; return;
    }
    if (axis === 'x') this.vel.x = 0; else this.vel.z = 0;
  }

  moveY(d) {
    const ny = this.pos.y + d;
    if (!this.collides(this.pos.x, ny, this.pos.z)) this.pos.y = ny;
    else {
      if (d < 0) this.grounded = true;
      this.vel.y = 0;
    }
  }

  applyCamera(camera, extraPitch = 0, extraYaw = 0) {
    const bobY = Math.sin(this.bob) * 0.045;
    camera.rotation.order = 'YXZ';
    camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    camera.rotation.y = this.yaw + extraYaw;
    camera.rotation.x = this.pitch + extraPitch;
    camera.rotation.z = 0;
  }

  damage(amount) {
    if (!this.alive) return false;
    if (this.invuln > 0) return false;      // 重生保護：這 5 秒內完全不會受傷
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) this.alive = false;
    return true;
  }

  respawn(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.invuln = RESPAWN_WARD;             // 重生 → 5 秒無敵
    this.yaw = 0;
    this.pitch = 0;
  }
}
