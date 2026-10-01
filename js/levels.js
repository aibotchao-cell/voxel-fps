// Per-level difficulty & enemy count. Each level also uses a distinct layout + atmosphere.
// 無盡模式：每 5 關循環一次場景，但難度會一輪一輪往上疊；每 10 關是 BOSS 關。
export const LEVELS = [
  { name: '工廠大廳', enemies: 10, health: 70,  speed: 2.0, aggro: 26, shootRange: 18, shootCd: 1.55, accuracy: 0.52, damage: 7,  bulletSpeed: 34 },
  { name: '裝配車間', enemies: 15, health: 80,  speed: 2.2, aggro: 28, shootRange: 20, shootCd: 1.45, accuracy: 0.60, damage: 8,  bulletSpeed: 36 },
  { name: '鍋爐房',   enemies: 21, health: 90,  speed: 2.4, aggro: 30, shootRange: 22, shootCd: 1.35, accuracy: 0.66, damage: 8,  bulletSpeed: 38 },
  { name: '倉庫區',   enemies: 28, health: 100, speed: 2.5, aggro: 32, shootRange: 24, shootCd: 1.25, accuracy: 0.72, damage: 9,  bulletSpeed: 40 },
  { name: '控制室',   enemies: 36, health: 110, speed: 2.7, aggro: 34, shootRange: 26, shootCd: 1.15, accuracy: 0.78, damage: 10, bulletSpeed: 42 },
];

export const BOSS_EVERY = 10;   // 第 10、20、30… 關是 BOSS 關
export const BOSS_NAMES = ['鋼鐵廠長', '熔爐巨獸', '鐵衛團長', '最終兵器'];

// 敵人強度（主選單可選）：只動「每隻敵人的數值」，人數完全不變
//   hp 血量倍率 · dmg 傷害倍率 · acc 準度加減 · rate 開火間隔倍率(越小越快)
//   bossHp/bossDmg BOSS 專用倍率 · reward 清關獎金倍率
export const DIFFICULTIES = [
  { key: 'easy',   name: '簡單', ico: '🟢', hp: 0.65, dmg: 0.55, acc: -0.14, rate: 1.30, bossHp: 0.70, bossDmg: 0.55, reward: 0.8,
    desc: '敵人比較軟、比較不準、開槍比較慢 · 獎金 ×0.8' },
  { key: 'normal', name: '普通', ico: '🟡', hp: 1.00, dmg: 1.00, acc: 0,     rate: 1.00, bossHp: 1.00, bossDmg: 1.00, reward: 1.0,
    desc: '原本的難度 · 獎金 ×1' },
  { key: 'hard',   name: '困難', ico: '🟠', hp: 1.40, dmg: 1.30, acc: 0.06,  rate: 0.85, bossHp: 1.30, bossDmg: 1.30, reward: 1.3,
    desc: '更硬、更痛、更準、開火更快 · 獎金 ×1.3' },
  { key: 'hell',   name: '地獄', ico: '🔴', hp: 1.85, dmg: 1.60, acc: 0.10,  rate: 0.72, bossHp: 1.70, bossDmg: 1.60, reward: 1.7,
    desc: '血量傷害準度全拉滿，BOSS 更誇張 · 獎金 ×1.7（想被電就選這個）' },
];

let diffIndex = 1;                                       // 預設「普通」
export const difficulty = () => DIFFICULTIES[diffIndex];
export const difficultyIndex = () => diffIndex;
export function setDifficulty(i) {
  diffIndex = Math.max(0, Math.min(DIFFICULTIES.length - 1, i | 0));
  return DIFFICULTIES[diffIndex];
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roundTag = (n) => (n <= ROMAN.length ? ROMAN[n - 1] : `R${n}`);

export const cycleOf = (i) => Math.floor(i / LEVELS.length);          // 第幾輪（0 起算）
export const isBossLevel = (i) => (i + 1) % BOSS_EVERY === 0;
export const bossTier = (i) => Math.floor(i / BOSS_EVERY);            // 第幾隻 BOSS（0 起算）
export const layoutIndex = (i) => i % LEVELS.length;                 // 用哪個場景

// 清關獎金：BOSS 關給大包，其餘每輪加一點（再乘上難度倍率）
export function rewardFor(i) {
  const base = isBossLevel(i) ? 500 : 100 + 25 * cycleOf(i);
  return Math.round((base * DIFFICULTIES[diffIndex].reward) / 5) * 5;
}

// 依關卡序號產生難度設定（0 起算）
export function levelConfig(i) {
  const base = LEVELS[layoutIndex(i)];
  const c = cycleOf(i);
  const boss = isBossLevel(i);
  const tier = bossTier(i);
  const d = DIFFICULTIES[diffIndex];

  const cfg = {
    ...base,
    index: i,
    boss,
    name: boss ? BOSS_NAMES[tier % BOSS_NAMES.length] : `${base.name} ${roundTag(c + 1)}`,
    // 敵人數量：一開始多少就一直是多少（後面的關卡只變硬、不變多）
    // BOSS 關只留少量小兵（3～6 隻），才不會被小兵淹沒
    enemies: boss ? 3 + Math.min(3, c) : base.enemies,
    health: Math.max(10, Math.round(base.health * (1 + 0.18 * c) * d.hp)),
    speed: Math.min(3.4, +(base.speed * (1 + 0.05 * c)).toFixed(2)),
    accuracy: Math.min(0.97, Math.max(0.15, +(base.accuracy + 0.035 * c + d.acc).toFixed(2))),
    damage: Math.max(1, Math.round(base.damage * Math.min(2.8, 1 + 0.14 * c) * d.dmg)),
    shootCd: +Math.max(0.45, base.shootCd * (1 - 0.05 * c) * d.rate).toFixed(2),
    aggro: Math.min(46, base.aggro + 2 * c),
    difficulty: d.name,
    rewardMul: d.reward,
    // BOSS 本體數值（變強版：血超厚、傷害高、四連發、暴衝更頻繁）
    bossHealth: boss ? Math.round((10000 + 2500 * tier) * d.bossHp) : 0,   // 第 10 關 10000 起（再乘難度）
    bossSpeed: 1.85,
    bossChargeMul: 2.8,                                  // 暴衝速度倍率（1.85 × 2.8 ≈ 5.2，比沒升級的玩家快一點）
    bossDamage: Math.round(40 * d.bossDmg),              // 每發子彈打到玩家 −40 血（簡單 22 / 困難 52 / 地獄 64）
    bossCd: Math.max(0.68, 1.22 - 0.09 * tier),          // 開火間隔縮短（原本 1.25 起）
    bossBurst: 4 + Math.min(2, tier),                    // 一次幾連發：4 → 最多 6
    bossAccuracy: Math.min(0.94, +(0.86 + 0.02 * tier).toFixed(2)),
    bossChargeCd: Math.max(4.4, 5.8 - 0.35 * tier),      // 暴衝間隔（原本固定 6.5 秒）
    bossSummonCd: Math.max(9.5, 13 - 0.7 * tier),        // 召喚間隔（小兵總數上限不變）
  };
  return cfg;
}
