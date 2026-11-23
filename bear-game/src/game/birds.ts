// Птицы — классическая птица из примера three.js (canvas_geometry_birds /
// webgl_gpgpu_birds: геометрия тела и двух крыльев + взмах по фазе),
// здесь — с простым стайным поведением на CPU
import * as THREE from 'three';
import { clamp, makeRand } from './config';

const rand = makeRand(818);

const BIRD_VERT = /* glsl */ `
attribute float birdVertex;
uniform float uPhase;
uniform float uScale;
varying float vShade;
void main() {
  vec3 p = position * uScale;
  if (birdVertex == 4.0 || birdVertex == 7.0) {
    // взмах крыльев
    p.y = sin(uPhase) * 5.0 * uScale;
  }
  vShade = birdVertex <= 2.0 ? 0.85 : 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const BIRD_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShade;
void main() {
  gl_FragColor = vec4(uColor * vShade, 1.0);
}
`;

function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // тело
    0, 0, -20, 0, 4, -20, 0, 0, 30,
    // левое крыло
    0, 0, -15, -20, 0, 0, 0, 0, 15,
    // правое крыло
    0, 0, 15, 20, 0, 0, 0, 0, -15,
  ]);
  const birdVertex = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setAttribute('birdVertex', new THREE.BufferAttribute(birdVertex, 1));
  return g;
}

interface Boid {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  phase: number;
}

const BOUNDS = 58;
const ALT_MIN = 6.5;
const ALT_MAX = 12.5;

export class BirdFlock {
  birds: Boid[] = [];
  private t = 0;

  constructor(scene: THREE.Scene, n = 5) {
    const geo = birdGeometry();
    const palette = [0x6f9cc4, 0xc48a6f, 0x7fb88a, 0xc4b06f, 0x9a8cc4];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BIRD_VERT,
        fragmentShader: BIRD_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          uPhase: { value: rand() * 6.28 },
          uScale: { value: 0.0135 },
          uColor: { value: new THREE.Color(palette[i % palette.length]) },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const boid: Boid = {
        mesh,
        mat,
        pos: new THREE.Vector3((rand() - 0.5) * 30, 8 + rand() * 3, (rand() - 0.5) * 30),
        vel: new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize().multiplyScalar(3),
        phase: rand() * 6.28,
      };
      this.birds.push(boid);
      scene.add(mesh);
    }
  }

  update(dt: number) {
    this.t += dt;
    const n = this.birds.length;
    // центр стаи
    const center = new THREE.Vector3();
    for (const b of this.birds) center.add(b.pos);
    center.divideScalar(n);

    for (const b of this.birds) {
      const acc = new THREE.Vector3();
      // сплочённость
      acc.addScaledVector(center.clone().sub(b.pos), 0.25);
      // расталкивание
      for (const o of this.birds) {
        if (o === b) continue;
        const d = b.pos.distanceTo(o.pos);
        if (d < 3 && d > 0.001) {
          acc.addScaledVector(b.pos.clone().sub(o.pos).normalize(), (3 - d) * 0.9);
        }
      }
      // границы мира
      const margin = 8;
      if (b.pos.x > BOUNDS - margin) acc.x -= (b.pos.x - (BOUNDS - margin)) * 0.5;
      if (b.pos.x < -BOUNDS + margin) acc.x -= (b.pos.x + (BOUNDS - margin)) * 0.5;
      if (b.pos.z > BOUNDS - margin) acc.z -= (b.pos.z - (BOUNDS - margin)) * 0.5;
      if (b.pos.z < -BOUNDS + margin) acc.z -= (b.pos.z + (BOUNDS - margin)) * 0.5;
      if (b.pos.y > ALT_MAX) acc.y -= (b.pos.y - ALT_MAX) * 0.8;
      if (b.pos.y < ALT_MIN) acc.y += (ALT_MIN - b.pos.y) * 0.8;
      // лёгкие порывы
      acc.x += Math.sin(this.t * 0.7 + b.phase) * 0.4;
      acc.z += Math.cos(this.t * 0.6 + b.phase * 1.3) * 0.4;

      b.vel.addScaledVector(acc, dt * 2.2);
      // ограничение скорости
      const sp = b.vel.length();
      const target = clamp(sp, 2.4, 5.2);
      b.vel.multiplyScalar(target / Math.max(sp, 0.001));

      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      // ориентация по скорости
      const look = b.pos.clone().add(b.vel);
      b.mesh.lookAt(look);
      // взмах: быстрее при разгоне вверх
      const flapSpeed = 9 + Math.max(0, b.vel.y) * 1.6 + target * 1.2;
      b.phase += dt * flapSpeed;
      (b.mat.uniforms.uPhase.value as number) = b.phase;
    }
  }
}
