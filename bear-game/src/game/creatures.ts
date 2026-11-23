// Обитатели леса: рыбы в пруду, мыши-шалунишки и бабочки (GLB-модель)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { POND, terrainHeight, isWalkable, makeRand, asset } from './config';

const rand = makeRand(555);

// ---------------- рыбы ----------------

interface Fish {
  group: THREE.Group;
  tail: THREE.Mesh;
  a: number;
  b: number;
  theta: number;
  speed: number;
  phase: number;
  scare: number;
  scareDir: THREE.Vector3;
  hidden: number;
}

export class FishSystem {
  fish: Fish[] = [];
  private jumps: { mesh: THREE.Group; t: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; hiddenFish?: Fish }[] = [];
  onSplash?: (pos: THREE.Vector3, s: number) => void;
  onFishEaten?: () => void;

  constructor(private scene: THREE.Scene) {
    const bodyGeo = new THREE.SphereGeometry(0.16, 8, 6);
    bodyGeo.scale(1, 0.7, 2.1);
    const tailGeo = new THREE.ConeGeometry(0.09, 0.18, 5);
    tailGeo.rotateX(Math.PI / 2);
    const colors = [0x8fa8b8, 0x7c93a6, 0xe88a4c, 0x9db4c2, 0x6f8a9c, 0xd97f3c];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5, metalness: 0.15 });
      const body = new THREE.Mesh(bodyGeo, mat);
      const tail = new THREE.Mesh(tailGeo, mat);
      tail.position.z = -0.36;
      tail.scale.set(1, 1, 1.4);
      g.add(body, tail);
      const a = 2.2 + rand() * 5.5;
      const b = 1.6 + rand() * 3.8;
      const f: Fish = {
        group: g,
        tail,
        a,
        b,
        theta: rand() * Math.PI * 2,
        speed: 0.5 + rand() * 0.7,
        phase: rand() * 10,
        scare: 0,
        scareDir: new THREE.Vector3(),
        hidden: 0,
      };
      this.fish.push(f);
      scene.add(g);
    }
  }

  scare(point: THREE.Vector3) {
    let scared = false;
    for (const f of this.fish) {
      if (f.hidden > 0) continue;
      const fx = POND.center.x + Math.cos(f.theta) * f.a;
      const fz = POND.center.y + Math.sin(f.theta) * f.b;
      const d = Math.hypot(fx - point.x, fz - point.z);
      if (d < 6) {
        f.scare = 3.6 + rand() * 1.5;
        f.scareDir.set(fx - point.x, 0, fz - point.z);
        if (f.scareDir.lengthSq() < 0.001) f.scareDir.set(rand() - 0.5, 0, rand() - 0.5);
        f.scareDir.normalize();
        scared = true;
      }
    }
    return scared;
  }

  /** рыба выпрыгивает к медведю (при рыбалке) */
  jump(target: THREE.Vector3) {
    // ближайшая к берегу рыба
    let best: Fish | null = null;
    let bd = Infinity;
    for (const f of this.fish) {
      if (f.hidden > 0 || f.scare > 0) continue;
      const fx = POND.center.x + Math.cos(f.theta) * f.a;
      const fz = POND.center.y + Math.sin(f.theta) * f.b;
      const d = Math.hypot(fx - target.x, fz - target.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (!best) best = this.fish[0];
    const start = new THREE.Vector3(
      POND.center.x + Math.cos(best.theta) * best.a,
      POND.waterLevel,
      POND.center.y + Math.sin(best.theta) * best.b
    );
    const g = best.group.clone();
    g.position.copy(start);
    this.scene.add(g);
    const to = target.clone().setY(target.y + 0.7);
    this.jumps.push({ mesh: g, t: 0, dur: 0.75, from: start.clone(), to, hiddenFish: best });
    best.hidden = 24;
    best.group.visible = false;
    this.onSplash?.(start, 0.7);
  }

  update(dt: number, t: number) {
    for (const f of this.fish) {
      if (f.hidden > 0) {
        f.hidden -= dt;
        if (f.hidden <= 0) f.group.visible = true;
        continue;
      }
      if (f.scare > 0) {
        f.scare -= dt;
        const p = f.group.position;
        const nx = p.x + f.scareDir.x * 4.2 * dt;
        const nz = p.z + f.scareDir.z * 4.2 * dt;
        const d = Math.hypot(nx - POND.center.x, nz - POND.center.y);
        if (d < POND.radius - 1.2) {
          p.x = nx;
          p.z = nz;
        } else {
          // отскок к центру
          f.scareDir.set(POND.center.x - nx, 0, POND.center.y - nz).normalize();
        }
        p.y = POND.waterLevel - 0.1;
        f.group.rotation.y = Math.atan2(f.scareDir.x, f.scareDir.z);
        f.tail.rotation.y = Math.sin(t * 22) * 0.6;
      } else {
        // плавание по эллипсу
        f.theta += (f.speed * dt) / Math.max(0.7, (f.a + f.b) * 0.28);
        const x = POND.center.x + Math.cos(f.theta) * f.a;
        const z = POND.center.y + Math.sin(f.theta) * f.b;
        f.phase += dt;
        f.group.position.set(x, POND.waterLevel - 0.13 + Math.sin(f.phase * 1.7) * 0.03, z);
        // направление по касательной
        const dx = -Math.sin(f.theta) * f.a * f.speed;
        const dz = Math.cos(f.theta) * f.b * f.speed;
        f.group.rotation.y = Math.atan2(dx, dz);
        f.tail.rotation.y = Math.sin(t * 8 + f.phase * 3) * 0.45;
      }
    }
    // прыжки
    for (let i = this.jumps.length - 1; i >= 0; i--) {
      const j = this.jumps[i];
      j.t += dt;
      const k = j.t / j.dur;
      if (k >= 1) {
        this.scene.remove(j.mesh);
        this.onSplash?.(j.to, 0.5);
        this.onFishEaten?.();
        this.jumps.splice(i, 1);
        continue;
      }
      const p = j.from.clone().lerp(j.to, k);
      p.y += Math.sin(k * Math.PI) * 1.5;
      j.mesh.position.copy(p);
      // ориентация по параболе
      const tan = j.to.clone().sub(j.from);
      tan.y = Math.cos(k * Math.PI) * 4.7;
      j.mesh.rotation.y = Math.atan2(tan.x, tan.z);
      j.mesh.rotation.x = -Math.atan2(tan.y, Math.hypot(tan.x, tan.z));
    }
  }
}

// ---------------- мыши ----------------

interface Mouse {
  group: THREE.Group;
  tail: THREE.Mesh;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  state: 'roam' | 'pause' | 'flee' | 'hidden';
  timer: number;
  den: THREE.Vector3;
  hidden: boolean;
}

export class MouseSystem {
  mice: Mouse[] = [];
  private t = 0;

  constructor(private scene: THREE.Scene, dens: THREE.Vector3[]) {
    const bodyGeo = new THREE.SphereGeometry(0.09, 7, 6);
    bodyGeo.scale(1, 0.85, 1.7);
    const earGeo = new THREE.SphereGeometry(0.045, 6, 5);
    const tailGeo = new THREE.CylinderGeometry(0.008, 0.014, 0.2, 4);
    tailGeo.translate(0, -0.1, 0);
    const n = Math.min(3, dens.length);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a9aa4, roughness: 0.9 });
      const body = new THREE.Mesh(bodyGeo, mat);
      const earMat = new THREE.MeshStandardMaterial({ color: 0xc9a0a8, roughness: 0.9 });
      const e1 = new THREE.Mesh(earGeo, earMat);
      e1.position.set(0.05, 0.08, 0.06);
      const e2 = new THREE.Mesh(earGeo, earMat);
      e2.position.set(-0.05, 0.08, 0.06);
      const nose = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 5, 4),
        new THREE.MeshStandardMaterial({ color: 0x443c3c })
      );
      nose.position.set(0, 0.01, 0.15);
      const tail = new THREE.Mesh(tailGeo, mat);
      tail.position.set(0, 0.02, -0.14);
      tail.rotation.x = Math.PI / 2.4;
      g.add(body, e1, e2, nose, tail);
      const den = dens[i % dens.length];
      const m: Mouse = {
        group: g,
        tail,
        pos: new THREE.Vector3(den.x + (rand() - 0.5), terrainHeight(den.x, den.z), den.z + (rand() - 0.5)),
        target: new THREE.Vector3(),
        state: 'pause',
        timer: rand() * 2,
        den: den.clone(),
        hidden: false,
      };
      g.position.copy(m.pos);
      this.mice.push(m);
      scene.add(g);
    }
  }

  update(dt: number, bearPos: THREE.Vector3, bearChasingIdx: number) {
    this.t += dt;
    for (let i = 0; i < this.mice.length; i++) {
      const m = this.mice[i];
      if (m.state === 'hidden') {
        m.timer -= dt;
        if (m.timer <= 0) {
          m.state = 'pause';
          m.timer = 0.5;
          m.hidden = false;
          m.group.visible = true;
          m.pos.set(m.den.x + (rand() - 0.5) * 1.6, terrainHeight(m.den.x, m.den.z), m.den.z + (rand() - 0.5) * 1.6);
        }
        continue;
      }
      const distBear = Math.hypot(bearPos.x - m.pos.x, bearPos.z - m.pos.z);
      const chased = bearChasingIdx === i;

      if (chased || distBear < 2.4) {
        // бегство от медведя
        m.state = 'flee';
        m.timer = 1.2;
        const away = new THREE.Vector3(m.pos.x - bearPos.x, 0, m.pos.z - bearPos.z).normalize();
        if (chased) {
          // убегает к норе
          const toDen = new THREE.Vector3(m.den.x - m.pos.x, 0, m.den.z - m.pos.z);
          if (toDen.lengthSq() > 0.04) away.lerp(toDen.normalize(), 0.55).normalize();
        }
        const sp = chased ? 5.2 : 3.4;
        const nx = m.pos.x + away.x * sp * dt;
        const nz = m.pos.z + away.z * sp * dt;
        if (isWalkable(nx, nz)) {
          m.pos.x = nx;
          m.pos.z = nz;
        }
        m.group.rotation.y = Math.atan2(away.x, away.z);
        if (chased && distBear < 1.25) {
          // нырок в куст
          m.state = 'hidden';
          m.hidden = true;
          m.group.visible = false;
          m.timer = 16 + rand() * 12;
          continue;
        }
        m.tail.rotation.z = Math.sin(this.t * 26) * 0.5;
      } else if (m.state === 'flee') {
        m.timer -= dt;
        if (m.timer <= 0) {
          m.state = 'pause';
          m.timer = 0.6 + rand();
        }
      } else if (m.state === 'pause') {
        m.timer -= dt;
        // нюхает: качается
        m.group.rotation.z = Math.sin(this.t * 6) * 0.06;
        m.tail.rotation.z = Math.sin(this.t * 3 + i) * 0.25;
        if (m.timer <= 0) {
          m.state = 'roam';
          const a = rand() * Math.PI * 2;
          const rr = 1.2 + rand() * 3.2;
          let tx = m.den.x + Math.cos(a) * rr;
          let tz = m.den.z + Math.sin(a) * rr;
          if (!isWalkable(tx, tz)) {
            tx = m.den.x;
            tz = m.den.z;
          }
          m.target.set(tx, terrainHeight(tx, tz), tz);
          m.timer = 6;
        }
      } else if (m.state === 'roam') {
        m.timer -= dt;
        const dx = m.target.x - m.pos.x;
        const dz = m.target.z - m.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15 || m.timer <= 0) {
          m.state = 'pause';
          m.timer = 0.8 + rand() * 1.6;
        } else {
          const sp = 1.5;
          m.pos.x += (dx / d) * sp * dt;
          m.pos.z += (dz / d) * sp * dt;
          m.group.rotation.y = Math.atan2(dx, dz);
          m.group.rotation.z = 0;
          m.tail.rotation.z = Math.sin(this.t * 9 + i * 2) * 0.35;
          m.group.position.y = m.pos.y + Math.abs(Math.sin(this.t * 11)) * 0.012; // семенит
        }
      }
      m.group.position.x = m.pos.x;
      m.group.position.z = m.pos.z;
      if (m.state !== 'roam') {
        m.group.position.y = terrainHeight(m.pos.x, m.pos.z) + 0.045;
      } else {
        m.group.position.y = terrainHeight(m.pos.x, m.pos.z) + 0.045 + Math.abs(Math.sin(this.t * 11)) * 0.012;
      }
    }
  }
}

// ---------------- бабочки (GLB) ----------------

interface Butterfly {
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  pos: THREE.Vector3;
  anchor: THREE.Vector3;
  tp: number;
  spd: number;
  flee: number;
}

export class ButterflySystem {
  butterflies: Butterfly[] = [];
  private t = 0;

  constructor(private scene: THREE.Scene) {}

  async load(anchors: THREE.Vector3[], onProgress?: (p: number) => void) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(asset('/models/butterfly.glb'));
    onProgress?.(1);
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const s = 0.34 / Math.max(size.x, size.z, 0.001);
    // выбираем анимацию взмаха — самую длинную
    let flap = gltf.animations[0] ?? null;
    for (const c of gltf.animations) if (c.duration > (flap?.duration ?? 0)) flap = c;

    const n = 5;
    for (let i = 0; i < n; i++) {
      // для скелетной модели обязателен SkeletonUtils.clone — обычный clone ломает привязку костей
      const root = skeletonClone(src) as THREE.Group;
      const inner = new THREE.Group();
      inner.add(root);
      inner.scale.setScalar(s);
      let mixer: THREE.AnimationMixer | null = null;
      if (flap) {
        mixer = new THREE.AnimationMixer(root);
        const act = mixer.clipAction(flap);
        act.timeScale = 0.85 + rand() * 0.5;
        act.play();
      }
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.frustumCulled = false;
        }
      });
      const anchor = anchors[i % anchors.length].clone().add(new THREE.Vector3((rand() - 0.5) * 6, 0, (rand() - 0.5) * 6));
      const b: Butterfly = {
        root: inner,
        mixer,
        pos: anchor.clone().setY(anchor.y + 1.4),
        anchor,
        tp: rand() * 100,
        spd: 0.5 + rand() * 0.4,
        flee: 0,
      };
      inner.position.copy(b.pos);
      this.butterflies.push(b);
      this.scene.add(inner);
    }
  }

  update(dt: number, bearPos: THREE.Vector3, bearChasingIdx: number) {
    this.t += dt;
    for (let i = 0; i < this.butterflies.length; i++) {
      const b = this.butterflies[i];
      b.tp += dt * b.spd;
      const chased = bearChasingIdx === i;
      const db = Math.hypot(b.pos.x - bearPos.x, b.pos.z - bearPos.z);
      if (chased || db < 2.2) {
        b.flee = 1.4;
        // якорь уводим от медведя
        const away = new THREE.Vector3(b.anchor.x - bearPos.x, 0, b.anchor.z - bearPos.z).normalize();
        b.anchor.addScaledVector(away, dt * 3.2);
        if (b.anchor.length() > 52) b.anchor.setLength(52);
      }
      if (b.flee > 0) b.flee -= dt;
      const fast = b.flee > 0;
      // порхание вокруг якоря
      const wx = Math.sin(b.tp * 1.7) * 1.6 + Math.sin(b.tp * 0.53) * 1.1;
      const wz = Math.cos(b.tp * 1.3) * 1.6 + Math.cos(b.tp * 0.61) * 1.1;
      const gh = terrainHeight(b.anchor.x + wx, b.anchor.z + wz);
      const h = gh + 1.1 + Math.sin(b.tp * 2.6) * 0.4 + (fast ? 0.5 : 0);
      const target = new THREE.Vector3(b.anchor.x + wx, h, b.anchor.z + wz);
      const k = fast ? 4.5 : 2.0;
      const prev = b.pos.clone();
      b.pos.lerp(target, Math.min(1, dt * k));
      b.root.position.copy(b.pos);
      // наклон по движению
      const vel = b.pos.clone().sub(prev);
      if (vel.lengthSq() > 1e-6) {
        const yaw = Math.atan2(vel.x, vel.z);
        b.root.rotation.y = yaw;
        b.root.rotation.z = Math.sin(this.t * 9 + i * 3) * 0.25;
      }
      b.mixer?.update(dt * (fast ? 1.6 : 1));
    }
  }
}
