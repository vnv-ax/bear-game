// Мишка-грустишка — общие константы мира
import * as THREE from 'three';

export const WORLD = {
  size: 160, // размер мира по X и Z (от -80 до 80)
  pondCenter: new THREE.Vector2(22, -18),
  pondRadius: 15,
  waterLevel: -0.72,
};

export const POND = {
  center: WORLD.pondCenter,
  radius: WORLD.pondRadius,
  waterLevel: WORLD.waterLevel,
};

/** Аналитическая высота рельефа — единый источник правды для three и cannon */
export function terrainHeight(x: number, z: number): number {
  // мягкие холмы
  let h =
    1.15 * Math.sin(x * 0.05 + 1.7) * Math.cos(z * 0.043 - 0.6) +
    0.6 * Math.sin(x * 0.102 - 0.4) * Math.sin(z * 0.088 + 1.1) +
    0.26 * Math.sin(x * 0.221 + z * 0.183) +
    0.14 * Math.sin(x * 0.41 - z * 0.37 + 2.0) +
    0.85;

  // чаша пруда
  const dx = x - POND.center.x;
  const dz = z - POND.center.y;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < POND.radius) {
    const t = 1 - d / POND.radius;
    h -= 2.9 * t * t * (3 - 2 * t);
  }

  // подъём к краям мира (лесная чаша)
  const r = Math.sqrt(x * x + z * z);
  if (r > 62) h += (r - 62) * 0.09;

  return h;
}

/** Можно ли медведю идти в эту точку (не глубоко в воду) */
export function isWalkable(x: number, z: number): boolean {
  return terrainHeight(x, z) > POND.waterLevel + 0.14;
}

/** Расстояние до центра пруда */
export function pondDist(x: number, z: number): number {
  const dx = x - POND.center.x;
  const dz = z - POND.center.y;
  return Math.sqrt(dx * dx + dz * dz);
}

export function inPond(x: number, z: number): boolean {
  return pondDist(x, z) < POND.radius - 0.5 && terrainHeight(x, z) < POND.waterLevel;
}

/** Случайная точка для прогулки */
export function randomWalkPoint(rand: () => number, cx = 0, cz = 0, spread = 26): THREE.Vector3 {
  for (let i = 0; i < 24; i++) {
    const x = cx + (rand() * 2 - 1) * spread;
    const z = cz + (rand() * 2 - 1) * spread;
    if (isWalkable(x, z) && Math.hypot(x, z) < 70) return new THREE.Vector3(x, terrainHeight(x, z), z);
  }
  return new THREE.Vector3(cx, terrainHeight(cx, cz), cz);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function damp(current: number, goal: number, lambda: number, dt: number): number {
  return lerp(current, goal, 1 - Math.exp(-lambda * dt));
}

export function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Детерминированный ГПСЧ (mulberry32) */
export function makeRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const assetBase = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function asset(path: string): string {
  return assetBase + path;
}
