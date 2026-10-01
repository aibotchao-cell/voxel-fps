import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 補給站超強武器的場上物件：
//   LavaWall — 岩漿牆（放一道噴岩漿的牆，敵人靠近會被燒）
//   IceBlast — 冰凍榴彈的爆炸視覺（敵人本體會被凍住，狀態在 enemies.js）
// ---------------------------------------------------------------------------

const CELL = 0.95;
const WALL_W = 6;      // 幾格寬
const WALL_H = 2;      // 幾格高

export class LavaWall {
  constructor(scene, x, y, z, yaw, life = 16) {
    this.scene = scene;
    this.life = life;
    this.maxLife = life;
    this.removeMe = false;
    this.cells = [];
    this.t = Math.random() * 10;

    // 牆面垂直於玩家朝向：forward = (-sin, -cos)，right = (cos, -sin)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const cx = x + fx * 4.4, cz = z + fz * 4.4;

    const geo = new THREE.BoxGeometry(CELL, CELL, CELL);
    this.mat = new THREE.MeshLambertMaterial({ color: 0xff7a1e, emissive: 0x8a1c00, transparent: true, opacity: 1 });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffb050, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });

    this.group = new THREE.Group();
    for (let h = 0; h < WALL_H; h++) {
      for (let i = 0; i < WALL_W; i++) {
        const off = (i - (WALL_W - 1) / 2) * CELL;
        const px = cx + rx * off;
        const pz = cz + rz * off;
        const py = y + 0.5 + h * CELL;
        const m = new THREE.Mesh(geo, this.mat);
        m.position.set(px, py, pz);
        m.rotation.y = yaw;
        this.group.add(m);
        this.cells.push({ x: px, y: py, z: pz });
        // 每格外貼一片發光面，看起來像在冒岩漿
        const g = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.05, CELL * 1.05), glowMat);
        g.position.set(px, py, pz);
        g.rotation.y = yaw;
        g.position.x += Math.sin(yaw) * -0.02;
        g.position.z += Math.cos(yaw) * -0.02;
        this.group.add(g);
      }
    }
    scene.add(this.group);
    this.glowMat = glowMat;
  }

  // 敵人碰到牆就持續被燒
  update(dt, enemyList) {
    this.t += dt;
    this.life -= dt;
    const flick = 0.55 + Math.sin(this.t * 9) * 0.2 + Math.random() * 0.1;
    this.mat.emissive.setRGB(0.55 * flick, 0.13 * flick, 0);
    this.glowMat.opacity = 0.28 + flick * 0.25;

    if (!this.removeMe) {
      const dps = 42 * dt;
      const yTop = this.cells[0].y + CELL;
      const yBot = this.cells[0].y - CELL;
      for (const e of enemyList) {
        if (!e.alive) continue;
        const eTop = e.pos.y + (e.isBoss ? 4.0 : 1.8);
        if (eTop < yBot || e.pos.y > yTop) continue;
        for (const c of this.cells) {
          const d = Math.hypot(c.x - e.pos.x, c.z - e.pos.z);
          if (d < CELL * 1.15) { e.takeDamage(dps, null); break; }
        }
      }
    }

    if (this.life <= 0) {
      const f = Math.max(0, 1 + this.life); // 最後 1 秒淡出
      this.mat.opacity = f;
      this.glowMat.opacity *= f;
      if (this.life < -0.2) this.removeMe = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.children.forEach((c) => c.geometry && c.geometry.dispose && c.geometry.dispose());
    this.mat.dispose();
    this.glowMat.dispose();
  }
}

export class IceBlast {
  constructor(scene, x, y, z, radius = 5.5, colors = null) {
    this.scene = scene;
    this.radius = radius;
    this.t = 0;
    this.removeMe = false;
    const core = (colors && colors.core) || 0xaee6ff;   // 冰榴彈預設冰藍色，榴彈／火箭傳橘色進來
    const ringC = (colors && colors.ring) || 0xdff6ff;
    this.mat = new THREE.MeshBasicMaterial({
      color: core, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.mat);
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(0.4);
    scene.add(this.mesh);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 6, 20),
      new THREE.MeshBasicMaterial({ color: ringC, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.ring.position.set(x, y, z);
    this.ring.rotation.x = Math.PI / 2;
    scene.add(this.ring);
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 0.45);
    const s = 0.4 + k * this.radius;
    this.mesh.scale.setScalar(s);
    this.mat.opacity = 0.55 * (1 - k);
    this.ring.scale.setScalar(0.5 + k * this.radius);
    this.ring.material.opacity = 0.7 * (1 - k);
    if (this.t > 0.5) this.removeMe = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.ring);
    this.mesh.geometry.dispose();
    this.ring.geometry.dispose();
    this.mat.dispose();
    this.ring.material.dispose();
  }
}

export { CELL as WALL_CELL };
