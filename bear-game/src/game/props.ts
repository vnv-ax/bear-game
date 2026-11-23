// Предметы с физикой (cannon-es): камни, ветки, валуны, брёвна, яблоки.
// Захват, перенос, бросок, плавучесть, засыпание.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { terrainHeight, isWalkable, pondDist, POND, makeRand, clamp } from './config';

export type PropKind = 'stone' | 'branch' | 'boulder' | 'log' | 'apple';

export interface PropItem {
  kind: PropKind;
  mesh: THREE.Mesh;
  body: CANNON.Body;
  pickable: boolean;
  radius: number;
  floaty: number; // 0 — тонет, 1 — хорошо плавает
  held: boolean;
  wasInWater: boolean;
  hitCooldown: number;
}

interface Callbacks {
  onSplash: (pos: THREE.Vector3, strength: number) => void;
  onBearHit: (kind: PropKind, speed: number, pos: THREE.Vector3) => void;
  bearCapsule: () => { a: THREE.Vector3; b: THREE.Vector3; r: number } | null;
}

const rand = makeRand(777);

function jitterGeo(geo: THREE.BufferGeometry, amount: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const j = () => (rand() * 2 - 1) * amount;
    pos.setXYZ(i, pos.getX(i) + j(), pos.getY(i) + j(), pos.getZ(i) + j());
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class Props {
  items: PropItem[] = [];
  held?: PropItem;
  private holdDist = 2.6;
  private holdPos = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private appleTrees: THREE.Vector3[] = [];
  private appleRegrow = 0;
  private throwCooldown = 0;

  constructor(
    private scene: THREE.Scene,
    private world: CANNON.World,
    private cb: Callbacks
  ) {}

  get raycastTargets(): THREE.Object3D[] {
    return this.items.filter((p) => p.pickable && !p.held).map((p) => p.mesh);
  }

  spawnScenery() {
    // камни
    for (let i = 0; i < 10; i++) {
      const p = this.randLandSpot(1.5);
      if (!p) continue;
      const r = 0.22 + rand() * 0.22;
      this.addStone(p.x, p.z, r);
    }
    // ветки
    for (let i = 0; i < 6; i++) {
      const p = this.randLandSpot(1.5);
      if (!p) continue;
      this.addBranch(p.x, p.z);
    }
    // валуны
    for (let i = 0; i < 3; i++) {
      const p = this.randLandSpot(4);
      if (!p) continue;
      this.addBoulder(p.x, p.z, 0.85 + rand() * 0.45);
    }
    // брёвна
    for (let i = 0; i < 2; i++) {
      const p = this.randLandSpot(3);
      if (!p) continue;
      this.addLog(p.x, p.z);
    }
    // пара камней у воды, чтобы было чем плескаться
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2;
      const rr = POND.radius + 1.5 + rand() * 2.5;
      const x = POND.center.x + Math.cos(a) * rr;
      const z = POND.center.y + Math.sin(a) * rr;
      this.addStone(x, z, 0.2 + rand() * 0.2);
    }
  }

  setAppleTrees(trees: THREE.Vector3[]) {
    this.appleTrees = trees;
    for (const t of trees) {
      const n = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const rr = 0.8 + rand() * 1.6;
        this.addApple(t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr);
      }
    }
  }

  private randLandSpot(minFromTrees = 1): { x: number; z: number } | null {
    for (let i = 0; i < 40; i++) {
      const x = (rand() * 2 - 1) * 46;
      const z = (rand() * 2 - 1) * 46;
      if (!isWalkable(x, z)) continue;
      if (pondDist(x, z) < POND.radius + 0.8) continue;
      if (Math.hypot(x, z) < 3) continue;
      return { x, z };
    }
    return null;
  }

  private makeBody(shape: CANNON.Shape, mass: number, pos: THREE.Vector3): CANNON.Body {
    const body = new CANNON.Body({ mass, material: new CANNON.Material('prop') });
    body.addShape(shape);
    body.position.set(pos.x, pos.y, pos.z);
    body.linearDamping = 0.12;
    body.angularDamping = 0.4;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.22;
    body.sleepTimeLimit = 0.7;
    this.world.addBody(body);
    return body;
  }

  private finishItem(kind: PropKind, mesh: THREE.Mesh, body: CANNON.Body, opts: Partial<PropItem>) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.prop = true;
    this.scene.add(mesh);
    const item: PropItem = {
      kind,
      mesh,
      body,
      pickable: true,
      radius: 0.3,
      floaty: 0.5,
      held: false,
      wasInWater: false,
      hitCooldown: 0,
      ...opts,
    };
    this.items.push(item);
    return item;
  }

  addStone(x: number, z: number, r: number) {
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.18);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.95, flatShading: true })
    );
    const y = terrainHeight(x, z) + r * 0.6;
    const body = this.makeBody(new CANNON.Sphere(r * 0.85), r * r * 9, new THREE.Vector3(x, y + 0.3, z));
    body.quaternion.setFromEuler(rand() * 3, rand() * 3, rand() * 3);
    return this.finishItem('stone', mesh, body, { radius: r, floaty: 0.06, pickable: true });
  }

  addBoulder(x: number, z: number, r: number) {
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.16);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x7d7871, roughness: 1, flatShading: true })
    );
    const y = terrainHeight(x, z) + r * 0.45;
    const body = this.makeBody(new CANNON.Sphere(r * 0.82), r * r * 22, new THREE.Vector3(x, y, z));
    body.quaternion.setFromEuler(rand(), rand() * 3, 0);
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.4;
    return this.finishItem('boulder', mesh, body, { radius: r, floaty: 0.04, pickable: false });
  }

  addBranch(x: number, z: number) {
    const len = 0.75 + rand() * 0.65;
    const geo = new THREE.CylinderGeometry(0.035, 0.06, len, 5);
    geo.rotateZ(Math.PI / 2);
    // пара сучков
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x74553a, roughness: 1, flatShading: true })
    );
    const y = terrainHeight(x, z) + 0.1;
    const body = this.makeBody(new CANNON.Box(new CANNON.Vec3(len * 0.45, 0.05, 0.05)), 0.7, new THREE.Vector3(x, y, z));
    body.quaternion.setFromEuler(0, rand() * Math.PI * 2, 0);
    return this.finishItem('branch', mesh, body, { radius: len * 0.5, floaty: 0.85, pickable: true });
  }

  addLog(x: number, z: number) {
    const len = 1.6 + rand() * 0.5;
    const geo = new THREE.CylinderGeometry(0.26, 0.3, len, 9);
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x5e432c, roughness: 1, flatShading: true })
    );
    const y = terrainHeight(x, z) + 0.32;
    const body = this.makeBody(new CANNON.Box(new CANNON.Vec3(len * 0.48, 0.26, 0.26)), 9, new THREE.Vector3(x, y, z));
    body.quaternion.setFromEuler(0, rand() * Math.PI * 2, 0);
    return this.finishItem('log', mesh, body, { radius: len * 0.5, floaty: 1.05, pickable: false });
  }

  addApple(x: number, z: number, dropFrom = 0) {
    const geo = new THREE.SphereGeometry(0.125, 9, 7);
    geo.scale(1, 0.92, 1);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xd23b2e, roughness: 0.35 })
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.09, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a3a20 })
    );
    stem.position.y = 0.12;
    mesh.add(stem);
    const y = dropFrom > 0 ? dropFrom : terrainHeight(x, z) + 0.14;
    const body = this.makeBody(new CANNON.Sphere(0.12), 0.24, new THREE.Vector3(x, y, z));
    return this.finishItem('apple', mesh, body, { radius: 0.12, floaty: 0.95, pickable: true });
  }

  // ---------------- захват ----------------

  tryPick(raycaster: THREE.Raycaster): PropItem | null {
    const targets = this.raycastTargets;
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const mesh = hits[0].object as THREE.Mesh;
    const item = this.items.find((p) => p.mesh === mesh);
    if (!item || !item.pickable) return null;
    // валуны не поднять
    if (item.kind === 'boulder' || item.kind === 'log') return null;
    this.hold(item);
    return item;
  }

  hold(item: PropItem) {
    if (this.held) this.dropGently();
    item.held = true;
    item.body.type = CANNON.Body.KINEMATIC;
    item.body.collisionResponse = true;
    item.body.wakeUp();
    item.body.angularVelocity.set(0, 0, 0);
    this.held = item;
  }

  /** позиция удержания перед камерой */
  updateHold(camera: THREE.Camera, pointerNdc: THREE.Vector2 | null) {
    const item = this.held;
    if (!item) return;
    let ray: THREE.Ray | null = null;
    if (pointerNdc) {
      this.raycaster.setFromCamera(pointerNdc, camera);
      ray = this.raycaster.ray.clone();
    }
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const dist = clamp(this.holdDist, 1.6, 3.6);
    const p = new THREE.Vector3();
    if (ray) {
      p.copy(ray.direction).multiplyScalar(dist).add(camera.position);
    } else {
      p.copy(camera.position).addScaledVector(camDir, dist);
    }
    // чуть правее и ниже, чтобы не закрывал мишку
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    p.addScaledVector(right, 0.34);
    p.y -= 0.3;
    this.holdPos.copy(p);
    const bp = item.body.position;
    item.body.velocity.set((p.x - bp.x) / 0.016, (p.y - bp.y) / 0.016, (p.z - bp.z) / 0.016);
    item.body.position.set(p.x, p.y, p.z);
    // лёгкое покачивание
    item.body.quaternion.setFromEuler(Math.sin(performance.now() * 0.002) * 0.15, 0, Math.cos(performance.now() * 0.0017) * 0.15);
  }

  setHoldDistance(d: number) {
    this.holdDist = clamp(d, 1.8, 3.8);
  }

  /** бросок с замаха: направление и скорость из движения курсора */
  throwHeld(dirScreen: THREE.Vector3, speed: number) {
    const item = this.held;
    if (!item || this.throwCooldown > 0) return;
    this.release(item);
    const v = item.body.velocity;
    v.set(dirScreen.x * speed, dirScreen.y * speed + 1.2, dirScreen.z * speed);
    item.body.angularVelocity.set(rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2);
    this.throwCooldown = 0.3;
  }

  /** бросок в точку под курсором (баллистика) */
  throwHeldToPoint(target: THREE.Vector3) {
    const item = this.held;
    if (!item || this.throwCooldown > 0) return;
    this.release(item);
    const s = new THREE.Vector3(item.body.position.x, item.body.position.y, item.body.position.z);
    const d = target.clone().sub(s);
    const dxz = Math.hypot(d.x, d.z);
    const T = clamp(dxz / 7.5, 0.5, 1.3);
    const v = item.body.velocity;
    v.set(d.x / T, d.y / T + 0.5 * 9.82 * T, d.z / T);
    item.body.angularVelocity.set(rand() * 6 - 3, rand() * 6 - 3, rand() * 6 - 3);
    this.throwCooldown = 0.3;
  }

  dropGently() {
    const item = this.held;
    if (!item) return;
    this.release(item);
    item.body.velocity.set(0, -0.3, 0);
  }

  private release(item: PropItem) {
    item.held = false;
    item.body.type = CANNON.Body.DYNAMIC;
    item.body.wakeUp();
    if (this.held === item) this.held = undefined;
  }

  /** съесть яблоко (вызывает медведь) */
  consume(item: PropItem) {
    if (item.held) this.held = undefined;
    this.world.removeBody(item.body);
    this.scene.remove(item.mesh);
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** ближайшее яблоко к точке (для медведя) */
  nearestApple(pos: THREE.Vector3, maxDist: number): PropItem | null {
    let best: PropItem | null = null;
    let bd = maxDist;
    for (const it of this.items) {
      if (it.kind !== 'apple' || it.held) continue;
      const d = Math.hypot(it.body.position.x - pos.x, it.body.position.z - pos.z);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  countApplesNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const it of this.items) {
      if (it.kind !== 'apple') continue;
      if (Math.hypot(it.body.position.x - x, it.body.position.z - z) < r) n++;
    }
    return n;
  }

  // ---------------- обновление ----------------

  update(dt: number, camera: THREE.Camera, pointerNdc: THREE.Vector2 | null) {
    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    this.updateHold(camera, pointerNdc);

    // регроу яблок под яблонями
    this.appleRegrow -= dt;
    if (this.appleRegrow <= 0) {
      this.appleRegrow = 42;
      for (const t of this.appleTrees) {
        if (this.countApplesNear(t.x, t.z, 2.6) < 4) {
          const a = rand() * Math.PI * 2;
          const rr = 0.8 + rand() * 1.5;
          this.addApple(t.x + Math.cos(a) * rr, t.z + Math.sin(a) * rr, terrainHeight(t.x, t.z) + 1.8);
        }
      }
    }

    const cap = this.cb.bearCapsule();
    const v3a = new THREE.Vector3();
    const v3b = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ap = new THREE.Vector3();

    for (const it of this.items) {
      it.hitCooldown = Math.max(0, it.hitCooldown - dt);
      const b = it.body;
      // сетка <- физика
      it.mesh.position.set(b.position.x, b.position.y, b.position.z);
      it.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);

      if (it.held) continue;

      // плавучесть
      const pd = pondDist(b.position.x, b.position.z);
      const inWater = pd < POND.radius - 0.4 && b.position.y < POND.waterLevel;
      if (inWater) {
        const sub = clamp((POND.waterLevel - b.position.y) / 0.6, 0, 1.3);
        const F = b.mass * 9.82 * it.floaty * sub * 1.25;
        b.applyForce(new CANNON.Vec3(0, F, 0), b.position);
        b.velocity.x *= 1 - 1.6 * dt;
        b.velocity.z *= 1 - 1.6 * dt;
        b.velocity.y *= 1 - 1.2 * dt;
      }
      // всплеск при входе в воду
      if (inWater && !it.wasInWater) {
        const sp = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
        if (sp > 1.2) this.cb.onSplash(new THREE.Vector3(b.position.x, POND.waterLevel, b.position.z), clamp(sp / 6, 0.4, 1.6));
      }
      it.wasInWater = inWater;

      // не даём утонуть/провалиться сквозь рельеф за границей карты
      const th = terrainHeight(b.position.x, b.position.z);
      if (b.position.y < th - 1.5) {
        b.position.y = th + 0.4;
        b.velocity.set(0, 0, 0);
      }
      if (Math.abs(b.position.x) > 76 || Math.abs(b.position.z) > 76) {
        b.position.x = clamp(b.position.x, -75, 75);
        b.position.z = clamp(b.position.z, -75, 75);
        b.velocity.set(b.velocity.x * -0.3, b.velocity.y, b.velocity.z * -0.3);
      }

      // попадание в медведя
      if (cap && it.hitCooldown <= 0) {
        const speed = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
        if (speed > 2.4) {
          v3a.set(b.position.x, b.position.y, b.position.z);
          ab.copy(cap.b).sub(cap.a);
          const tt = clamp(v3a.clone().sub(cap.a).dot(ab) / ab.lengthSq(), 0, 1);
          ap.copy(cap.a).addScaledVector(ab, tt);
          const d = ap.distanceTo(v3a);
          if (d < cap.r + it.radius) {
            it.hitCooldown = 1.2;
            this.cb.onBearHit(it.kind, speed, v3a.clone());
          }
        }
      }
    }
  }
}
