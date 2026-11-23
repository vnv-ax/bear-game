// Мишка-грустишка — главный класс: сцена, камера-орбита, ввод, частицы
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { terrainHeight, clamp, damp, POND, asset } from './config';
import { Terrain } from './terrain';
import { Water } from './water';
import { Sky } from './sky';
import { Forest } from './trees';
import { Props } from './props';
import { Bear } from './bear';
import type { BearWorld } from './bear';
import { ThoughtBubble } from './thought';
import { FishSystem, MouseSystem, ButterflySystem } from './creatures';
import { BirdFlock } from './birds';
import { MagicMode } from './magic';

export interface GameCallbacks {
  onProgress?: (p: number, label: string) => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
  onMagic?: (on: boolean) => void;
}

// ---- частицы (пыль, земля) ----
interface Burst {
  pts: THREE.Points;
  vel: Float32Array;
  t: number;
  life: number;
}

class Puffs {
  private bursts: Burst[] = [];
  constructor(private scene: THREE.Scene) {}

  spawn(pos: THREE.Vector3, color: number, count: number, opts: { spread?: number; up?: number; size?: number; life?: number } = {}) {
    const spread = opts.spread ?? 0.5;
    const up = opts.up ?? 2.2;
    const life = opts.life ?? 0.9;
    const posArr = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      posArr[i * 3] = pos.x + (Math.random() - 0.5) * spread;
      posArr[i * 3 + 1] = pos.y + 0.15 + Math.random() * 0.3;
      posArr[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.6;
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = up * (0.5 + Math.random() * 0.8);
      vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: opts.size ?? 0.14,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.bursts.push({ pts, vel, t: 0, life });
  }

  update(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t > b.life) {
        this.scene.remove(b.pts);
        b.pts.geometry.dispose();
        (b.pts.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const pos = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        b.vel[j * 3 + 1] -= 6 * dt;
        arr[j * 3] += b.vel[j * 3] * dt;
        arr[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
        arr[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
      }
      pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = 0.9 * (1 - b.t / b.life);
    }
  }
}

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private t = 0;

  private world!: CANNON.World;
  private terrain!: Terrain;
  private water!: Water;
  private sky!: Sky;
  private forest!: Forest;
  private props!: Props;
  private bear!: Bear;
  private fish!: FishSystem;
  private mice!: MouseSystem;
  private butterflies!: ButterflySystem;
  private birds!: BirdFlock;
  private magic!: MagicMode;
  private bubble!: ThoughtBubble;
  private puffs!: Puffs;

  // камера-орбита
  private az = Math.PI * 0.12;
  private pol = 0.95;
  private dist = 9.5;
  private azCur = Math.PI * 0.12;
  private polCur = 0.95;
  private distCur = 9.5;
  private camTarget = new THREE.Vector3(0, 1, 0);

  // ввод
  private mode: 'none' | 'orbit' | 'hold' | 'bear' | 'pinch' = 'none';
  private pointers = new Map<number, { x: number; y: number }>();
  private pointerNdc = new THREE.Vector2();
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private totalDrag = 0;
  private flickHist: { x: number; y: number; t: number }[] = [];
  private pinchStart = 0;
  private pinchDistStart = 0;
  private bearHitPoint = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  private container: HTMLElement;
  private cb: GameCallbacks;
  private ready = false;

  constructor(container: HTMLElement, cb: GameCallbacks = {}) {
    this.container = container;
    this.cb = cb;
  }

  async init() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe3f4, 60, 210);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 700);
    this.updateCamera(0, true);

    // физика
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    // базовые модули
    this.terrain = new Terrain(this.scene, this.world);
    this.water = new Water(this.scene);
    this.sky = new Sky(this.scene);
    this.bubble = new ThoughtBubble();
    this.scene.add(this.bubble.sprite);
    this.puffs = new Puffs(this.scene);
    this.magic = new MagicMode(this.scene);

    const propMat = new CANNON.Material('prop');
    const groundMat = new CANNON.Material('ground');
    this.world.addContactMaterial(new CANNON.ContactMaterial(groundMat, propMat, { friction: 0.45, restitution: 0.12 }));
    this.world.defaultContactMaterial.friction = 0.4;
    this.world.defaultContactMaterial.restitution = 0.1;

    this.props = new Props(this.scene, this.world, {
      onSplash: (pos, s) => {
        this.water.splashAt(pos, s);
        this.fish.scare(pos);
      },
      onBearHit: (kind, speed, pos) => this.bear.onHitByProp(kind, speed, pos),
      bearCapsule: () => (this.bear.airborne ? null : this.bear.capsule()),
    });

    this.attachInput();

    // ---- загрузка моделей ----
    try {
      this.cb.onProgress?.(0.02, 'лес');
      this.forest = new Forest();
      await this.loadWithProgress(asset('/models/tree_scene.glb'), 0.05, 0.7, 'лес', 41_000_000, (p) => {
        this.cb.onProgress?.(p, 'лес');
      });
      await this.forest.load(this.scene);
      this.props.setAppleTrees(this.forest.appleTrees);
      this.props.spawnScenery();

      this.cb.onProgress?.(0.72, 'мишка');
      this.bw = {
        camera: this.camera,
        rainActive: false,
        forest: this.forest,
        props: this.props,
        mice: [],
        butterflies: [],
        dustPuff: (pos, n = 10) => this.puffs.spawn(pos, 0xd9cdb6, n, { spread: 0.7, up: 1.2, size: 0.13 }),
        dirtPuff: (pos, n = 8) => this.puffs.spawn(pos, 0x8a6d4f, n, { spread: 0.5, up: 2.4, size: 0.11 }),
        fishJump: (target) => this.fish?.jump(target),
        eatItem: (p) => this.props.consume(p),
      };
      this.bear = new Bear(this.bw, this.bubble, this.scene);
      await this.loadWithProgress(asset('/models/bear.glb'), 0.72, 0.92, 'мишка', 14_000_000, (p) => {
        this.cb.onProgress?.(p, 'мишка');
      });
      await this.bear.load();
      this.bear.pos.set(-4, terrainHeight(-4, -3), -3);
      this.bear.yaw = 0.6;

      this.cb.onProgress?.(0.93, 'бабочки');
      this.butterflies = new ButterflySystem(this.scene);
      await this.loadWithProgress(asset('/models/butterfly.glb'), 0.93, 0.99, 'бабочки', 2_200_000, (p) => {
        this.cb.onProgress?.(p, 'бабочки');
      });
      const anchors = this.forest.bushes.map((b) => new THREE.Vector3(b.x, b.y, b.z));
      if (!anchors.length) anchors.push(new THREE.Vector3(6, 0, 6));
      await this.butterflies.load(anchors);

      this.fish = new FishSystem(this.scene);
      this.fish.onSplash = (pos, s) => this.water.splashAt(pos, s);
      const dens = this.forest.bushes.slice(0, 3).map((b) => new THREE.Vector3(b.x, b.y, b.z));
      if (!dens.length) dens.push(new THREE.Vector3(8, 0, 4));
      this.mice = new MouseSystem(this.scene, dens);
      this.birds = new BirdFlock(this.scene, 5);

      this.sky.onRainChange = (raining) => {
        this.bear.onRainChange(raining);
      };

      this.cb.onProgress?.(1, 'готово');
      this.ready = true;
      this.cb.onReady?.();
      this.clock.start();
      this.loop();
    } catch (e) {
      console.error('[game] ошибка загрузки:', e);
      this.cb.onError?.(String((e as Error)?.message ?? e));
    }
  }

  private async loadWithProgress(
    url: string,
    from: number,
    to: number,
    _label: string,
    approxSize: number,
    onProg: (p: number) => void
  ) {
    await new Promise<void>((resolve, reject) => {
      const loader = new THREE.FileLoader();
      loader.setResponseType('arraybuffer');
      loader.load(
        url,
        () => resolve(),
        (e) => {
          const loaded = (e as ProgressEvent).loaded ?? 0;
          const total = (e as ProgressEvent).total || approxSize;
          const k = clamp(loaded / total, 0, 1);
          onProg(from + (to - from) * k);
        },
        (err) => reject(err)
      );
    });
  }

  private bw!: BearWorld;

  // ---------------- ввод ----------------

  private attachInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.onResize);
  }

  private detachInput() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onResize);
  }

  private ndcFrom(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.ready) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pointerNdc.copy(this.ndcFrom(e));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downT = performance.now();
    this.totalDrag = 0;
    this.flickHist = [{ x: e.clientX, y: e.clientY, t: this.downT }];

    if (this.pointers.size === 2) {
      // щипок
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchDistStart = this.dist;
      this.mode = 'pinch';
      if (this.props.held) this.props.dropGently();
      return;
    }

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    // предмет?
    const picked = this.props.tryPick(this.raycaster);
    if (picked) {
      this.mode = 'hold';
      return;
    }

    // медведь?
    const bearHits = this.bear ? this.raycaster.intersectObject(this.bear.root, true) : [];
    if (bearHits.length > 0) {
      this.mode = 'bear';
      this.bearHitPoint.copy(bearHits[0].point);
      this.bear.onGrabStart();
      return;
    }

    // вода?
    const waterHit = this.raycaster.intersectObject(this.water.mesh, false);
    if (waterHit.length > 0) {
      const p = waterHit[0].point;
      p.y = POND.waterLevel;
      this.water.splashAt(p, 0.9);
      this.fish.scare(p);
    }

    this.mode = 'orbit';
  };

  private onMove = (e: PointerEvent) => {
    if (!this.ready) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) this.dist = clamp(this.pinchDistStart * (this.pinchStart / d), 4, 24);
      return;
    }

    this.pointerNdc.copy(this.ndcFrom(e));
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    const now = performance.now();
    const dtms = Math.max(1, now - this.lastMoveT);
    this.lastMoveT = now;

    if (this.mode === 'orbit') {
      this.az -= dx * 0.0052;
      this.pol = clamp(this.pol - dy * 0.0042, 0.22, 1.5);
    } else if (this.mode === 'hold') {
      this.flickHist.push({ x: e.clientX, y: e.clientY, t: now });
      if (this.flickHist.length > 12) this.flickHist.shift();
    } else if (this.mode === 'bear') {
      this.totalDrag += Math.hypot(dx, dy);
      const dyUp = -dy; // вверх по экрану — положительное
      const speed = Math.hypot(dx, dy) / dtms;
      this.bear.onGrabPull(dyUp, speed);
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private lastMoveT = 0;

  private onUp = (e: PointerEvent) => {
    if (!this.ready) return;
    this.pointers.delete(e.pointerId);
    const now = performance.now();
    const dur = now - this.downT;
    const drag = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);

    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) this.mode = 'none';
      return;
    }

    if (this.mode === 'hold' && this.props.held) {
      // замах?
      const hist = this.flickHist;
      let flickSpeed = 0;
      let fdx = 0;
      let fdy = 0;
      const cutoff = now - 90;
      let first = hist[0];
      for (const h of hist) {
        if (h.t >= cutoff) {
          first = h;
          break;
        }
      }
      const last = hist[hist.length - 1];
      const dt2 = Math.max(1, last.t - first.t);
      fdx = last.x - first.x;
      fdy = last.y - first.y;
      flickSpeed = Math.hypot(fdx, fdy) / dt2;
      if (flickSpeed > 0.5) {
        // бросок по направлению взмаха
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        const dir = new THREE.Vector3()
          .addScaledVector(right, fdx)
          .addScaledVector(up, -fdy)
          .addScaledVector(fwd, 1.4);
        dir.normalize();
        this.props.throwHeld(dir, clamp(4.5 + flickSpeed * 6.5, 4.5, 16));
      } else if (drag < 9 && dur < 320) {
        // клик при удержании — бросок в точку под курсором
        const target = this.aimPoint();
        if (target) this.props.throwHeldToPoint(target);
      } else {
        this.props.dropGently();
      }
      this.mode = 'none';
      return;
    }

    if (this.mode === 'bear') {
      if (drag < 7 && dur < 350) {
        // клик по медведю
        this.bear.onPoked(this.bearHitPoint.clone());
      }
      this.bear.onGrabRelease();
      this.mode = 'none';
      return;
    }

    if (this.mode === 'orbit' && drag < 7 && dur < 350) {
      // клик по земле рядом с медведем?
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
      if (hits.length > 0) {
        const p = hits[0].point;
        if (this.bear && Math.hypot(p.x - this.bear.pos.x, p.z - this.bear.pos.z) < 2.4) {
          this.bear.onPoked(p.clone());
        } else {
          // лёгкое шелестение травы
          this.puffs.spawn(p, 0x9fc46a, 6, { spread: 0.4, up: 0.8, size: 0.09, life: 0.6 });
        }
      }
    }
    this.mode = 'none';
  };

  /** точка прицела: медведь / вода / земля */
  private aimPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const bearHits = this.bear ? this.raycaster.intersectObject(this.bear.root, true) : [];
    if (bearHits.length > 0) return bearHits[0].point.clone();
    const waterHit = this.raycaster.intersectObject(this.water.mesh, false);
    if (waterHit.length > 0) {
      const p = waterHit[0].point.clone();
      p.y = POND.waterLevel;
      return p;
    }
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (hits.length > 0) return hits[0].point.clone();
    return null;
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.ready) return;
    e.preventDefault();
    this.dist = clamp(this.dist * (1 + e.deltaY * 0.0011), 4, 24);
  };

  private onResize = () => {
    if (!this.renderer) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ---------------- магия ----------------

  setMagic(on: boolean) {
    this.magic.setOn(on);
    this.sky.setMagic(on);
    this.water.setMagic(on);
    this.forest?.magicTint(on);
    this.cb.onMagic?.(on);
    // в магическом режиме пара камней levитирует
    if (this.props) {
      const stones = this.props.items.filter((p) => p.kind === 'stone').slice(0, 3);
      stones.forEach((s) => {
        if (s.held) return;
        s.body.type = on ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC;
        s.body.wakeUp();
      });
      this.floatStones = on ? stones : [];
    }
  }
  private floatStones: import('./props').PropItem[] = [];

  // ---------------- камера ----------------

  private updateCamera(dt: number, snap = false) {
    const k = snap ? 1 : Math.min(1, dt * 7);
    this.azCur = snap ? this.az : damp(this.azCur, this.az, 12, dt);
    this.polCur = snap ? this.pol : damp(this.polCur, this.pol, 12, dt);
    this.distCur = snap ? this.dist : damp(this.distCur, this.dist, 8, dt);
    if (this.bear) {
      this.camTarget.x = damp(this.camTarget.x, this.bear.pos.x, 5, dt);
      this.camTarget.y = damp(this.camTarget.y, this.bear.pos.y + 1.05, 5, dt);
      this.camTarget.z = damp(this.camTarget.z, this.bear.pos.z, 5, dt);
    }
    let dist = this.distCur;
    // камера не проваливается в кроны/стволы деревьев
    if (this.forest?.treeMeshes.length) {
      const sinP = Math.sin(this.polCur);
      const dir = new THREE.Vector3(
        sinP * Math.sin(this.azCur),
        Math.cos(this.polCur),
        sinP * Math.cos(this.azCur)
      );
      this.raycaster.set(this.camTarget, dir);
      this.raycaster.far = dist;
      const hits = this.raycaster.intersectObjects(this.forest.treeMeshes, false);
      if (hits.length > 0) {
        dist = Math.max(2.6, hits[0].distance - 0.6);
      }
      this.raycaster.far = Infinity;
    }
    const sinP = Math.sin(this.polCur);
    const x = this.camTarget.x + dist * sinP * Math.sin(this.azCur);
    const y = this.camTarget.y + dist * Math.cos(this.polCur);
    const z = this.camTarget.z + dist * sinP * Math.cos(this.azCur);
    const minY = terrainHeight(x, z) + 0.5;
    this.camera.position.set(x, Math.max(y, minY), z);
    this.camera.lookAt(this.camTarget);
  }

  // ---------------- цикл ----------------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = clamp(this.clock.getDelta(), 0.0001, 0.05);
    this.t += dt;

    // левитация камней в магическом режиме
    if (this.floatStones.length) {
      for (let i = 0; i < this.floatStones.length; i++) {
        const s = this.floatStones[i];
        if (s.held) continue;
        const bx = s.body.position.x;
        const bz = s.body.position.z;
        const gy = terrainHeight(bx, bz);
        s.body.position.y = gy + 0.9 + Math.sin(this.t * 1.2 + i * 2.1) * 0.35;
        s.body.quaternion.setFromEuler(Math.sin(this.t * 0.7 + i) * 0.6, this.t * 0.5 + i, Math.cos(this.t * 0.6 + i) * 0.5);
        s.body.velocity.set(0, 0, 0);
      }
    }

    this.world.step(1 / 60, dt, 3);
    this.water.update(dt, this.camera);
    this.sky.update(dt, this.bear?.pos ?? this.camTarget, this.camera);
    this.forest?.update(dt);
    this.props?.update(dt, this.camera, this.props.held ? this.pointerNdc : null);
    this.puffs.update(dt);

    // медведь
    if (this.bw && this.bear) {
      this.bw.rainActive = this.sky.rainTarget > 0.5;
      this.bw.mice = this.mice?.mice ?? [];
      this.bw.butterflies = this.butterflies?.butterflies ?? [];
      this.bear.update(dt);
    }

    // существа
    this.fish?.update(dt, this.t);
    this.mice?.update(dt, this.bear?.pos ?? new THREE.Vector3(), this.bear?.chasingMouse ? this.bear.mouseIndex : -1);
    this.butterflies?.update(dt, this.bear?.pos ?? new THREE.Vector3(), this.bear?.chasingButterfly ? this.bear.butterflyIndex : -1);
    this.birds?.update(dt);

    this.bubble?.update(dt, this.bear?.pos ?? this.camTarget, this.bear?.headY ?? 2);
    this.magic.update(dt, this.bear?.pos ?? this.camTarget);

    // туман с учётом магии и дождя
    const fogBase = new THREE.Color(0xcfe3f4);
    fogBase.lerp(new THREE.Color(0x8fa9b8), this.sky.rainIntensity * 0.75);
    this.magic.applyFog(fogBase);

    // солнце следует за медведем (тени)
    if (this.bear) {
      const sp = this.bear.pos;
      this.sky.sun.position.set(sp.x + this.sky.sunDir.x * 55, sp.y + this.sky.sunDir.y * 55, sp.z + this.sky.sunDir.z * 55);
      this.sky.sun.target.position.set(sp.x, sp.y, sp.z);
      this.sky.sun.target.updateMatrixWorld();
    }

    this.renderer.toneMappingExposure = 1.05 * this.magic.exposureBoost;
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachInput();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement?.remove();
    }
  }
}
