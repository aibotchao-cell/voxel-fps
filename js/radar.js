import { SX, SY, SZ } from './world.js';

// ---------------------------------------------------------------------------
// Enemy radar: rotating floor-plan minimap centred on the player.
//   * the map itself is baked once per floor into a small offscreen canvas
//   * every enemy in range gets a blip; anything further away is pinned to the
//     rim as a triangle, so you always know which way the stragglers are
//   * blips get a small chevron when the enemy is on a different floor
// ---------------------------------------------------------------------------

const RANGE = 34;    // world units from player to the radar rim
const R_PX = 68;     // radar radius in CSS px (canvas is 136x136)
const MAP_PX = 3;    // map texture pixels per voxel
const BAND = 3;      // vertical band (in voxels) sampled around the player's feet

export class Radar {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    canvas.width = R_PX * 2 * dpr;
    canvas.height = R_PX * 2 * dpr;
    canvas.style.width = R_PX * 2 + 'px';
    canvas.style.height = R_PX * 2 + 'px';

    this.map = document.createElement('canvas');
    this.map.width = SX * MAP_PX;
    this.map.height = SZ * MAP_PX;
    this.mapCtx = this.map.getContext('2d');
    this.mapFloor = null;

    this.rims = [];      // {x, y, a} off-range markers, reused between frames
    this.blips = [];
  }

  // ---- bake the floor plan around the player's feet -----------------------
  buildMap(world, feetY) {
    const W = this.map.width, H = this.map.height;
    const img = this.mapCtx.createImageData(W, H);
    const d = img.data;
    const y0 = Math.max(1, Math.floor(feetY));
    const y1 = Math.min(SY - 1, Math.floor(feetY) + BAND);

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        let solid = false;
        for (let y = y0; y <= y1; y++) {
          if (world.get(x, y, z) !== 0) { solid = true; break; }
        }
        if (!solid) continue;
        // steel-blue wall colour (kept translucent so enemy blips stay readable)
        const r = 104, g = 128, b = 148;
        for (let pz = 0; pz < MAP_PX; pz++) {
          for (let px = 0; px < MAP_PX; px++) {
            const i = ((z * MAP_PX + pz) * W + (x * MAP_PX + px)) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 120;
          }
        }
      }
    }
    this.mapCtx.putImageData(img, 0, 0);
    this.mapFloor = Math.floor(feetY);
  }

  invalidate() { this.mapFloor = null; }

  // ---- helper: world offset -> screen offset (player facing = up) ---------
  static project(dx, dz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: dx * c - dz * s, y: dx * s + dz * c };
  }

  draw(world, player, enemyList, ally) {
    const mapFloor = Math.floor(player.pos.y);
    if (this.mapFloor === null || Math.abs(mapFloor - this.mapFloor) > 0) {
      this.buildMap(world, player.pos.y);
    }

    const ctx = this.ctx;
    const R = R_PX;
    const scale = R / RANGE;              // px per world unit
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, R * 2, R * 2);

    // backdrop
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,10,14,.62)';
    ctx.fill();

    // ---- rotating floor plan ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.85;
    ctx.translate(R, R);
    ctx.rotate(player.yaw);               // forward (-sin,-cos) lands on "up"
    const k = scale / MAP_PX;
    ctx.scale(k, k);
    ctx.drawImage(this.map, -player.pos.x * MAP_PX, -player.pos.z * MAP_PX);
    ctx.restore();

    // ---- range rings + cross ----
    ctx.strokeStyle = 'rgba(190,220,240,.20)';
    ctx.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3, 1]) {
      ctx.beginPath();
      ctx.arc(R, R, (R - 3) * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(R, 4); ctx.lineTo(R, R * 2 - 4);
    ctx.moveTo(4, R); ctx.lineTo(R * 2 - 4, R);
    ctx.stroke();

    // forward cone
    const cone = ctx.createLinearGradient(R, R, R, R - R);
    cone.addColorStop(0, 'rgba(255,236,170,.35)');
    cone.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.arc(R, R, R - 3, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
    ctx.closePath();
    ctx.fillStyle = cone;
    ctx.fill();

    // ---- ally blip ----
    if (ally && ally.alive) {
      const p = Radar.project(ally.pos.x - player.pos.x, ally.pos.z - player.pos.z, player.yaw);
      const d = Math.hypot(ally.pos.x - player.pos.x, ally.pos.z - player.pos.z);
      if (d <= RANGE) {
        ctx.beginPath();
        ctx.arc(R + p.x * scale, R + p.y * scale, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#5cc8ff';
        ctx.fill();
      }
    }

    // ---- enemy blips ----
    this.rims.length = 0;
    for (const e of enemyList) {
      if (!e.alive) continue;
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);
      const p = Radar.project(dx, dz, player.yaw);
      const dy = (e.pos.y + 0.9) - (player.pos.y + 1.0);

      if (dist <= RANGE) {
        const px = R + p.x * scale, py = R + p.y * scale;
        const near = 1 - dist / RANGE;
        if (e.isBoss) {
          // BOSS：大顆紅點 + 呼吸光圈
          ctx.beginPath();
          ctx.arc(px, py, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ff2d2d';
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = 'rgba(255,220,180,.9)';
          ctx.stroke();
          const pulse = 9 + (Math.sin(performance.now() * 0.006) + 1) * 3;
          ctx.beginPath();
          ctx.arc(px, py, pulse, 0, Math.PI * 2);
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = 'rgba(255,80,60,.55)';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 3.2 + near * 1.6, 0, Math.PI * 2);
          ctx.fillStyle = '#ff4b4b';
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(30,0,0,.85)';
          ctx.stroke();
        }
        // different floor? show a chevron
        if (dy > 2.2) this.chevron(ctx, px, py - (e.isBoss ? 12 : 7), 1);
        else if (dy < -2.2) this.chevron(ctx, px, py + (e.isBoss ? 12 : 7), -1);
      } else {
        // pin to the rim so you always know the direction
        const l = Math.hypot(p.x, p.y) || 1;
        const ux = p.x / l, uy = p.y / l;
        const px = R + ux * (R - 7), py = R + uy * (R - 7);
        const a = Math.atan2(uy, ux);
        const bs = e.isBoss ? 1.9 : 1;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(5 * bs, 0); ctx.lineTo(-3 * bs, -4 * bs); ctx.lineTo(-3 * bs, 4 * bs);
        ctx.closePath();
        ctx.fillStyle = e.isBoss ? 'rgba(255,60,40,.95)' : 'rgba(255,90,90,.8)';
        ctx.fill();
        ctx.restore();
      }
    }

    // ---- player ----
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R - 4.5, R + 5);
    ctx.lineTo(R + 4.5, R + 5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // rim
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,212,121,.55)';
    ctx.stroke();
  }

  chevron(ctx, x, y, dir) {
    ctx.beginPath();
    if (dir > 0) {
      ctx.moveTo(x, y - 3.2); ctx.lineTo(x - 3.4, y + 2); ctx.lineTo(x + 3.4, y + 2);
    } else {
      ctx.moveTo(x, y + 3.2); ctx.lineTo(x - 3.4, y - 2); ctx.lineTo(x + 3.4, y - 2);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd479';
    ctx.fill();
  }
}
