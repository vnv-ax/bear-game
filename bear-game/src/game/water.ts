// Пруд: шейдерная вода, круги на воде, всплески, испуганная рыба зовётся наружу
import * as THREE from 'three';
import { POND, WORLD } from './config';

const WATER_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 p = position;
  // лёгкая рябь по вершинам
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float w = sin(wp.x * 1.7 + uTime * 1.4) * 0.018 + sin(wp.z * 2.1 - uTime * 1.1) * 0.015;
  wp.y += w;
  vWorld = wp.xyz;
  vNormalW = normalize(vec3(
    cos(wp.x * 1.7 + uTime * 1.4) * 0.06,
    1.0,
    cos(wp.z * 2.1 - uTime * 1.1) * 0.05
  ));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uMagic;
uniform vec3 uCam;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  float dc = length(vWorld.xz - vec2(${WORLD.pondCenter.x.toFixed(1)}, ${WORLD.pondCenter.y.toFixed(1)}));
  float depth = smoothstep(${(WORLD.pondRadius - 2.0).toFixed(1)}, 3.0, dc);
  vec3 deep = mix(uDeep, vec3(0.55, 0.25, 0.75), uMagic);
  vec3 shal = mix(uShallow, vec3(0.35, 0.9, 0.85), uMagic);
  vec3 col = mix(shal, deep, depth);

  // блики-каустики
  float c1 = sin(vWorld.x * 6.3 + uTime * 1.3) * sin(vWorld.z * 5.7 - uTime * 1.7);
  float c2 = sin(vWorld.x * 9.1 - uTime * 2.1 + vWorld.z * 7.3);
  float spark = smoothstep(0.55, 0.95, c1 * 0.6 + c2 * 0.4);
  col += vec3(1.0) * spark * (0.10 + uMagic * 0.14);

  // френель
  vec3 V = normalize(uCam - vWorld);
  float fres = pow(1.0 - max(dot(V, normalize(vNormalW)), 0.0), 3.0);
  vec3 skyRef = mix(vec3(0.78, 0.87, 0.95), vec3(0.9, 0.6, 0.9), uMagic);
  col = mix(col, skyRef, fres * 0.55);

  float alpha = 0.84 + fres * 0.1;
  gl_FragColor = vec4(col, alpha);
}
`;

interface Ripple {
  mesh: THREE.Mesh;
  t: number;
  delay: number;
  maxR: number;
}

interface Splash {
  points: THREE.Points;
  vel: Float32Array;
  t: number;
}

export class Water {
  mesh!: THREE.Mesh;
  mat!: THREE.ShaderMaterial;
  private ripples: Ripple[] = [];
  private splashes: Splash[] = [];
  private rippleGeo: THREE.RingGeometry;
  private splashGeo: THREE.BufferGeometry;
  private t = 0;
  private magicTarget = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.CircleGeometry(POND.radius - 0.7, 40);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x2d6b8e) },
        uShallow: { value: new THREE.Color(0x6fb7c9) },
        uMagic: { value: 0 },
        uCam: { value: new THREE.Vector3() },
      },
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(POND.center.x, POND.waterLevel, POND.center.y);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this.rippleGeo = new THREE.RingGeometry(0.42, 0.5, 28);
    this.splashGeo = new THREE.BufferGeometry();
    this.splashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(42 * 3), 3));
  }

  setMagic(on: boolean) {
    // цель меняется плавно в update
    this.magicTarget = on ? 1 : 0;
  }

  /** клик по воде: круги + брызги */
  splashAt(point: THREE.Vector3, strength = 1) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        this.rippleGeo,
        new THREE.MeshBasicMaterial({
          color: 0xdff1ff,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(point.x, POND.waterLevel + 0.02 + i * 0.004, point.z);
      this.mesh.parent?.add(m);
      this.ripples.push({ mesh: m, t: 0, delay: i * 0.14, maxR: 2.6 + i * 1.3 + strength });
    }
    // брызги
    const N = 26;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = point.x;
      pos[i * 3 + 1] = POND.waterLevel + 0.05;
      pos[i * 3 + 2] = point.z;
      const a = Math.random() * Math.PI * 2;
      const sp = (1.4 + Math.random() * 2.6) * strength;
      vel[i * 3] = Math.cos(a) * sp * 0.7;
      vel[i * 3 + 1] = 2.2 + Math.random() * 2.8;
      vel[i * 3 + 2] = Math.sin(a) * sp * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pm = new THREE.PointsMaterial({
      color: 0xe8f6ff,
      size: 0.09,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, pm);
    pts.frustumCulled = false;
    this.mesh.parent?.add(pts);
    this.splashes.push({ points: pts, vel, t: 0 });
  }

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
    const uMagic = this.mat.uniforms.uMagic as { value: number };
    uMagic.value += (this.magicTarget - uMagic.value) * Math.min(1, dt * 1.6);
    (this.mat.uniforms.uCam.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);

    // круги
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      if (r.t < r.delay) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.visible = true;
      const tt = r.t - r.delay;
      const life = 2.2;
      const k = tt / life;
      if (k >= 1) {
        r.mesh.parent?.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.ripples.splice(i, 1);
        continue;
      }
      const s = 0.4 + k * r.maxR;
      r.mesh.scale.set(s, s, 1);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }

    // брызги
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.t += dt;
      if (s.t > 1.4) {
        s.points.parent?.remove(s.points);
        (s.points.material as THREE.Material).dispose();
        s.points.geometry.dispose();
        this.splashes.splice(i, 1);
        continue;
      }
      const pos = s.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        s.vel[j * 3 + 1] -= 9.2 * dt;
        arr[j * 3] += s.vel[j * 3] * dt;
        arr[j * 3 + 1] += s.vel[j * 3 + 1] * dt;
        arr[j * 3 + 2] += s.vel[j * 3 + 2] * dt;
      }
      pos.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = Math.max(0, 0.95 * (1 - s.t / 1.4));
    }
  }
}
