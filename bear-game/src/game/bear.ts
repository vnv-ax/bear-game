// Медведь: GLB-модель, 81 анимация, перемещение по рельефу и «мозг» —
// потребности, сон, еда, рыбалка, обиды и характер
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { terrainHeight, isWalkable, pondDist, POND, clamp, angleLerp, damp, randomWalkPoint, makeRand, asset } from './config';
import type { Forest } from './trees';
import type { Props, PropItem } from './props';
import type { ThoughtBubble, ThoughtKind } from './thought';

const rand = makeRand(31337);

export interface BearWorld {
  camera: THREE.Camera;
  rainActive: boolean;
  forest: Forest;
  props: Props;
  mice: { pos: THREE.Vector3; hidden: boolean }[];
  butterflies: { pos: THREE.Vector3 }[];
  dustPuff: (pos: THREE.Vector3, n?: number) => void;
  dirtPuff: (pos: THREE.Vector3, n?: number) => void;
  fishJump: (target: THREE.Vector3) => void;
  eatItem: (p: PropItem) => void;
}

export type BearState =
  | 'idle'
  | 'wander'
  | 'sleep'
  | 'go_eat_apple'
  | 'eat_apple'
  | 'go_eat_berry'
  | 'eat_berry'
  | 'drink'
  | 'go_shore'
  | 'fish_wait'
  | 'fish_catch'
  | 'scratch_walk'
  | 'scratch'
  | 'claws_walk'
  | 'claws'
  | 'chase_butterfly'
  | 'chase_mouse'
  | 'dig_walk'
  | 'dig'
  | 'zoomies'
  | 'sulk_walk'
  | 'sulk'
  | 'rage'
  | 'react_swipe'
  | 'react_approach'
  | 'react_leave'
  | 'react_sit'
  | 'grabbed'
  | 'tossed'
  | 'land_react'
  | 'shelter_rain';

interface SeqStep {
  name: string;
  loop?: boolean;
  dur?: number;
  timeScale?: number;
  hold?: number;
}

const ANIM_FALLBACK: Record<string, string[]> = {
  idle: ['Stand_Idle_01', 'Stand_Idle_02', 'Stand_Breathing_01'],
  walk: ['Walk', 'WalkSlow'],
  run: ['Run', 'Trot', 'Sprint'],
  eat: ['Stand_Eating_01'],
  sit: ['Sitting_Idle_01', 'Sitting_Idle_02'],
  lying: ['Lying_Breathing_01', 'Lying_Idle_01'],
  angry: ['StandAngry_Breathing_01', 'StandAngry_Breathing_02'],
  swipe: ['Attack_StandAngry_01_Low', 'Attack_StandAngry_01_High', 'Attack_StandAngry_02_High'],
  attackRun: ['Attack_Run_01_AttackF'],
  hit: ['Hit_Stand_F01'],
  hind: ['StandHind_Idle_01', 'StandHind_Idle_02'],
};

export class Bear {
  root = new THREE.Group();
  model?: THREE.Group;
  mixer?: THREE.AnimationMixer;
  animScale = 1;
  pos = new THREE.Vector3(0, 0, 0);
  yaw = 0;
  state: BearState = 'idle';
  needs = { hunger: 42, thirst: 40, energy: 88, annoyance: 8 };
  sleeping = false;
  airborne = false;
  private blob?: THREE.Mesh;

  private clips: Record<string, THREE.AnimationClip> = {};
  private action?: THREE.AnimationAction;
  private seq: SeqStep[] = [];
  private seqT = 0;
  private stateT = 0;
  private target = new THREE.Vector3();
  private hasTarget = false;
  private walkClip: string | null = null;
  private baseYaw = 0;
  private tumbleSpin = 0;
  private vel = new THREE.Vector3();
  private bubbleSprite: ThoughtBubble;
  private pokeTimes: number[] = [];
  private pokeCount = 0;
  private reactCooldown = 0;
  private grabbedFlag = false;
  private grabPullUp = 0;
  private grabT = 0;
  private landPlan: 'grudge' | 'anger' | 'flee' = 'grudge';
  private fleeTarget = new THREE.Vector3();
  private scratchTree: { x: number; z: number } | null = null;
  private bushTarget: import('./trees').BerryBush | null = null;
  private berryIdx = 0;
  private appleTarget?: PropItem;
  private mouseIdx = -1;
  private butterflyIdx = -1;
  private zoomPts: THREE.Vector3[] = [];
  private digMoundT = 0;
  private fishTimer = 0;
  private fishCaught = false;
  private shore = new THREE.Vector3();
  private t = 0;
  private lastClip: string | null = null;
  private zzzT = 0;
  private feetOffset = 0;
  private stateBubbleShown = false;
  private walkSpeed = 1.15;
  private rng = rand;

  constructor(private w: BearWorld, bubble: ThoughtBubble, scene: THREE.Scene) {
    this.bubbleSprite = bubble;
    this.sceneRef = scene;
    scene.add(this.root);
  }

  private sceneRef: THREE.Scene;

  async load(onProgress?: (p: number) => void) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(asset('/models/bear.glb'));
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // нормализуем размер: длина тела ~2.35
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = 2.35 / Math.max(size.z, size.x);
    const inner = new THREE.Group();
    inner.add(model);
    inner.scale.setScalar(s);
    // определяем «перед»: у модели длина по Z; если морда в -Z, разворачиваем
    // (у этой модели морда смотрит в +Z после конверсии; при необходимости поменяйте знак)
    this.feetOffset = -box.min.y * s;
    this.model = inner;
    this.root.add(inner);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        // тени от скелетного меша в этой модели дают артефакты — используем мягкую «блоб»-тень
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false;
      }
    });

    // мягкая круглая тень под медведем
    const sc = document.createElement('canvas');
    sc.width = 128;
    sc.height = 128;
    const sctx = sc.getContext('2d')!;
    const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(20,25,15,0.55)');
    grad.addColorStop(0.55, 'rgba(20,25,15,0.3)');
    grad.addColorStop(1, 'rgba(20,25,15,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(sc);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 1;
    this.blob = blob;
    this.sceneRef.add(blob);

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      this.clips[clip.name] = clip;
    }
    const missing = Object.entries(ANIM_FALLBACK).filter(
      ([k, names]) => !names.some((n) => this.clips[n])
    );
    if (missing.length) {
      console.warn('[bear] нет анимаций для:', missing.map(([k]) => k).join(', '));
    }
    // старт: стоим
    this.playClip('idle', { fade: 0 });
    onProgress?.(1);
  }

  // ---------- анимации ----------

  private clipFor(kind: keyof typeof ANIM_FALLBACK): string | null {
    for (const n of ANIM_FALLBACK[kind]) if (this.clips[n]) return n;
    return null;
  }

  private playClip(
    name: string,
    opts: { fade?: number; loop?: THREE.AnimationActionLoopStyles; timeScale?: number; once?: boolean } = {}
  ) {
    if (!this.mixer) return;
    const clip = this.clips[name];
    if (!clip) return;
    if (this.lastClip === name && this.action && !opts.once) {
      this.action.timeScale = opts.timeScale ?? 1;
      return;
    }
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.timeScale = opts.timeScale ?? 1;
    next.setLoop(
      opts.loop ?? (opts.once ? THREE.LoopOnce : THREE.LoopRepeat),
      opts.once ? 1 : Infinity
    );
    next.clampWhenFinished = !!opts.once;
    next.enabled = true;
    if (this.action && this.action !== next) {
      next.crossFadeFrom(this.action, opts.fade ?? 0.26, true);
    }
    next.play();
    this.action = next;
    this.lastClip = name;
  }

  private stopSeq() {
    this.seq = [];
    this.seqT = 0;
  }

  private playSeq(steps: SeqStep[], onDone?: () => void) {
    this.seq = steps.slice();
    this.seqT = 0;
    this.seqDone = onDone;
    this.seqStep();
  }

  private seqDone?: () => void;

  private seqStep() {
    if (!this.seq.length) {
      this.seqDone?.();
      this.seqDone = undefined;
      return;
    }
    const st = this.seq[0];
    this.playClip(st.name, {
      once: !st.loop,
      loop: st.loop ? THREE.LoopRepeat : THREE.LoopOnce,
      timeScale: st.timeScale ?? 1,
      fade: 0.22,
    });
    this.seqT = 0;
  }

  private seqUpdate(dt: number) {
    if (!this.seq.length) return false;
    this.seqT += dt;
    const st = this.seq[0];
    const clip = this.clips[st.name];
    const dur = st.dur ?? (clip ? clip.duration / (st.timeScale ?? 1) : 1);
    if (this.seqT >= dur) {
      this.seq.shift();
      this.seqStep();
    }
    return true;
  }

  private bubble(kind: ThoughtKind, dur = 3) {
    this.bubbleSprite.show(kind, dur);
  }

  // ---------- события от игрока ----------

  /** клик по медведю или рядом */
  onPoked(_point: THREE.Vector3) {
    this.pokeTimes.push(this.t);
    if (this.state === 'sleep') {
      this.pokeCount++;
      this.bubble('excl', 1.2);
      if (this.pokeCount >= 3) {
        // разбудили
        this.pokeCount = 0;
        this.wakeUp(true);
      }
      return;
    }
    if (this.airborne || this.state === 'tossed' || this.state === 'grabbed') return;
    if (this.state === 'rage' || this.state === 'sulk') {
      this.needs.annoyance = clamp(this.needs.annoyance + 5, 0, 100);
      return;
    }
    if (this.reactCooldown > 0) return;
    this.reactCooldown = 3 + rand() * 3;
    this.needs.annoyance = clamp(this.needs.annoyance + 4, 0, 100);
    const r = rand();
    if (r < 0.2) {
      this.setState('react_swipe');
    } else if (r < 0.42) {
      this.setState('react_approach');
      this.target.copy(_point);
      this.target.y = 0;
      this.hasTarget = true;
    } else if (r < 0.62) {
      this.setState('react_leave');
      const dir = new THREE.Vector3(this.pos.x - _point.x, 0, this.pos.z - _point.z);
      if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
      dir.normalize();
      this.target.copy(this.pos).addScaledVector(dir, 7 + rand() * 4);
      this.target.y = 0;
      this.hasTarget = true;
    } else if (r < 0.78) {
      this.setState('react_sit');
    }
    // иначе — «не заметил»
  }

  /** начали тянуть медведя */
  onGrabStart() {
    if (this.airborne || this.state === 'sleep') {
      if (this.state === 'sleep') this.onPoked(this.pos);
      return;
    }
    this.grabbedFlag = false;
    this.grabPullUp = 0;
    this.grabT = 0;
  }

  /** тянут медведя: dy — вверх по экрану (положительное = вверх), speed px/ms */
  onGrabPull(dyUp: number, speed: number) {
    if (this.state === 'sleep') return;
    this.grabPullUp += dyUp;
    this.grabT += speed;
    if (this.grabPullUp > 70 || (dyUp > 0 && speed > 1.8 && this.grabPullUp > 30)) {
      // подброс!
      const strength = clamp(5.6 + this.grabPullUp * 0.02 + speed, 5.6, 9.2);
      this.tossUp(strength);
      return;
    }
    if (!this.grabbedFlag && this.grabPullUp < -18) {
      // тянут на себя/в сторону — вырывается
      this.grabbedFlag = true;
      this.startGrabbed();
    }
  }

  private startGrabbed() {
    if (this.airborne || this.state === 'grabbed') return;
    this.stopSeq();
    this.setState('grabbed');
  }

  onGrabRelease() {
    this.grabPullUp = 0;
  }

  /** полет после подброса */
  tossUp(strength: number) {
    if (this.airborne) return;
    this.stopSeq();
    this.setState('tossed');
    this.airborne = true;
    this.animScale = 0; // замирает в позе
    this.vel.set((rand() - 0.5) * 1.2, strength, (rand() - 0.5) * 1.2);
    this.tumbleSpin = 5.5 + rand() * 2.5;
    this.bubble('excl', 1.6);
    this.needs.annoyance = clamp(this.needs.annoyance + 14, 0, 100);
  }

  onHitByProp(kind: 'stone' | 'branch' | 'boulder' | 'log' | 'apple', speed: number, pos: THREE.Vector3) {
    if (this.airborne) return;
    if (kind === 'apple') {
      // вкусно! ищем яблоко рядом
      if (this.needs.hunger > 22) {
        this.appleTarget = this.w.props.nearestApple(pos, 3.5) ?? undefined;
        if (this.appleTarget) {
          this.setState('go_eat_apple');
          return;
        }
      }
      this.bubble('question', 2);
      return;
    }
    if (kind === 'stone') {
      this.needs.annoyance = clamp(this.needs.annoyance + 9 + speed * 0.4, 0, 100);
      this.bubble('anger', 2.4);
      if (this.state !== 'rage' && this.needs.annoyance > 62) {
        this.setState('rage');
      } else {
        // отмахнуться в сторону броска
        this.target.copy(pos);
        this.setState('react_swipe');
      }
    } else {
      this.needs.annoyance = clamp(this.needs.annoyance + 3, 0, 100);
      this.bubble('question', 1.8);
    }
  }

  onRainChange(raining: boolean) {
    if (raining) {
      if (!this.sleeping && !this.airborne && this.state !== 'sulk' && this.state !== 'rage') {
        this.setState('shelter_rain');
      }
    }
    // после дождя — просто выйдет сам
  }

  // ---------- состояния ----------

  private setState(s: BearState) {
    this.state = s;
    this.stateT = 0;
    this.stateBubbleShown = false;
    this.stopSeq();
    this.walkClip = null;
    switch (s) {
      case 'idle':
        this.playClip(this.clipFor('idle') ?? 'Stand_Idle_01', { fade: 0.3 });
        break;
      case 'sleep':
        this.sleeping = true;
        this.pokeCount = 0;
        this.playSeq([
          { name: this.clipFor('idle') ?? 'Stand_Idle_01', loop: true, dur: 0.8 },
          { name: 'Trans_Stand_to_Lying', dur: undefined },
          { name: this.clipFor('lying') ?? 'Lying_Breathing_01', loop: true },
        ]);
        this.bubble('zzz', 3.5);
        this.zzzT = 0;
        break;
      case 'sulk_walk': {
        // уходим подальше от камеры и садимся задом
        const cam = this.w.camera.position;
        const dir = new THREE.Vector3(this.pos.x - cam.x, 0, this.pos.z - cam.z).normalize();
        const p = this.pos.clone().addScaledVector(dir, 4 + rand() * 2);
        for (let i = 0; i < 16 && !isWalkable(p.x, p.z); i++) {
          p.addScaledVector(dir, 1.2);
        }
        this.target.copy(p);
        this.hasTarget = true;
        break;
      }
      case 'sulk':
        this.yaw = Math.atan2(this.w.camera.position.x - this.pos.x, this.w.camera.position.z - this.pos.z) + Math.PI;
        this.playSeq([
          { name: 'Trans_Stand_to_Sitting' },
          { name: this.clipFor('sit') ?? 'Sitting_Idle_01', loop: true },
        ]);
        this.bubble('grudge', 4);
        break;
      case 'rage': {
        this.playSeq([
          { name: 'Trans_Stand_to_StandAngry', dur: undefined },
          { name: this.clipFor('angry') ?? 'StandAngry_Breathing_01', loop: true, dur: 1.6 },
        ]);
        this.bubble('anger', 3.5);
        // точки для носится
        this.zoomPts = [];
        for (let i = 0; i < 5 + Math.floor(rand() * 3); i++) {
          this.zoomPts.push(randomWalkPoint(rand, this.pos.x, this.pos.z, 9));
        }
        break;
      }
      case 'grabbed':
        this.playSeq([
          { name: 'Trans_Stand_to_StandHind', dur: undefined },
          { name: this.clipFor('hind') ?? 'StandHind_Idle_01', loop: true },
        ]);
        this.bubble('excl', 2);
        this.needs.annoyance = clamp(this.needs.annoyance + 8, 0, 100);
        break;
      case 'tossed':
        break;
      case 'react_sit':
        this.playSeq([
          { name: 'Trans_Stand_to_Sitting' },
          { name: this.clipFor('sit') ?? 'Sitting_Idle_01', loop: true },
        ]);
        break;
      case 'fish_wait': {
        this.playSeq([
          { name: 'Trans_Stand_to_Sitting' },
          { name: this.clipFor('sit') ?? 'Sitting_Idle_01', loop: true },
        ]);
        this.bubble('fish', 4);
        this.fishTimer = 7 + rand() * 9;
        this.fishCaught = false;
        break;
      }
      case 'shelter_rain': {
        const t = this.w.forest.nearestTree(this.pos, 16);
        if (t) {
          this.target.set(t.x, 0, t.z);
          this.hasTarget = true;
        } else {
          this.setState('idle');
        }
        break;
      }
      case 'dig':
        this.bubble('dig', 3.5);
        this.digMoundT = 0;
        this.playSeq([{ name: this.clipFor('eat') ?? 'Stand_Eating_01', loop: true, dur: 4.4 }]);
        break;
      case 'scratch':
        this.bubble('paw', 3);
        break;
      case 'claws':
        this.bubble('claw', 3);
        this.playSeq([
          { name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined },
          { name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined },
        ]);
        break;
      case 'zoomies':
        this.bubble('sparkle', 2.5);
        this.zoomPts = [];
        for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) {
          this.zoomPts.push(randomWalkPoint(rand, this.pos.x, this.pos.z, 12));
        }
        break;
      case 'chase_butterfly':
        this.bubble('butterfly', 3);
        break;
      case 'chase_mouse':
        this.bubble('mouse', 3);
        break;
      default:
        break;
    }
  }

  /** проснуться (по будилке или сам) */
  private wakeUp(byForce: boolean) {
    this.sleeping = false;
    this.pokeCount = 0;
    this.energyBoost(55);
    this.playSeq([{ name: 'Trans_Lying_to_Stand', dur: undefined }], () => {
      if (byForce) {
        this.needs.annoyance = clamp(this.needs.annoyance + 15, 0, 100);
        this.bubble('anger', 2.5);
      }
      this.setState('idle');
    });
    this.state = 'idle';
    this.stateT = 0;
  }

  private energyBoost(v: number) {
    this.needs.energy = clamp(this.needs.energy + v, 0, 100);
  }

  // ---------- перемещение ----------

  private locomotion(dt: number, speed: number, target: THREE.Vector3, stopDist: number): boolean {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist) {
      this.playClip(this.clipFor('idle') ?? 'Stand_Idle_01', { fade: 0.25 });
      this.walkClip = null;
      return true;
    }
    const dirYaw = Math.atan2(dx, dz);
    this.yaw = angleLerp(this.yaw, dirYaw, Math.min(1, dt * 6.5));
    // клип
    let clipName: string;
    let ts = 1;
    if (speed <= 0.7) {
      clipName = this.clipFor('walk') === 'Walk' ? 'WalkSlow' : this.clipFor('walk') ?? 'Walk';
      ts = speed / 0.55;
    } else if (speed <= 1.6) {
      clipName = this.clipFor('walk') ?? 'Walk';
      ts = speed / 1.15;
    } else {
      clipName = this.clipFor('run') ?? 'Run';
      ts = speed / 3.2;
    }
    if (this.walkClip !== clipName) {
      this.playClip(clipName, { fade: 0.22, timeScale: clamp(ts, 0.55, 2.2) });
      this.walkClip = clipName;
    } else if (this.action) {
      this.action.timeScale = clamp(ts, 0.55, 2.2);
    }

    // шаг
    const step = Math.min(d - stopDist * 0.6, speed * dt);
    const nx = this.pos.x + (dx / d) * step;
    const nz = this.pos.z + (dz / d) * step;
    if (isWalkable(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      // пробуем скользить по одной оси
      if (isWalkable(nx, this.pos.z)) this.pos.x = nx;
      else if (isWalkable(this.pos.x, nz)) this.pos.z = nz;
      else return true; // уперлись
    }
    this.w.forest.pushFromTrunks(this.pos, 0.55);
    return false;
  }

  private standIdle() {
    this.playClip(this.clipFor('idle') ?? 'Stand_Idle_01', { fade: 0.25 });
  }

  // ---------- главный апдейт ----------

  update(dt: number) {
    this.t += dt;
    this.stateT += dt;
    this.reactCooldown = Math.max(0, this.reactCooldown - dt);

    // потребности
    if (!this.sleeping) {
      this.needs.energy = clamp(this.needs.energy - dt * 0.28, 0, 100);
      this.needs.hunger = clamp(this.needs.hunger + dt * 0.17, 0, 100);
      this.needs.thirst = clamp(this.needs.thirst + dt * 0.2, 0, 100);
      this.needs.annoyance = clamp(this.needs.annoyance - dt * 0.85, 0, 100);
    } else {
      this.needs.energy = clamp(this.needs.energy + dt * 0.5, 0, 100);
      this.needs.annoyance = clamp(this.needs.annoyance - dt * 0.5, 0, 100);
    }

    // полёт после подброса
    if (this.airborne) {
      this.vel.y -= 13.5 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.model!.rotation.x += this.tumbleSpin * dt;
      const ground = terrainHeight(this.pos.x, this.pos.z) + this.feetOffset;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.airborne = false;
        this.animScale = 1;
        this.model!.rotation.x = 0;
        this.vel.set(0, 0, 0);
        this.w.dustPuff(this.pos, 14);
        this.landPlan =
          this.needs.annoyance > 68 ? 'flee' : this.needs.annoyance > 38 ? 'anger' : 'grudge';
        this.setState('land_react');
        this.playSeq([{ name: this.clipFor('hit') ?? 'Hit_Stand_F01', dur: 1.1 }], () => {
          if (this.landPlan === 'grudge') {
            this.setState('sulk_walk');
            this.needs.annoyance = clamp(this.needs.annoyance + 2, 0, 100);
          } else if (this.landPlan === 'anger') {
            this.bubble('anger', 2.5);
            this.setState('rage');
          } else {
            // бегство
            const dir = new THREE.Vector3(
              this.pos.x - this.w.camera.position.x,
              0,
              this.pos.z - this.w.camera.position.z
            ).normalize();
            const p = this.pos.clone().addScaledVector(dir, 13);
            for (let i = 0; i < 20 && !isWalkable(p.x, p.z); i++) p.addScaledVector(dir, 1.5);
            this.target.copy(p);
            this.hasTarget = true;
            this.state = 'wander';
            this.stateT = 0;
            this.bubble('grudge', 3);
            this.needs.annoyance = clamp(this.needs.annoyance - 6, 0, 100);
          }
        });
        this.state = 'land_react';
      }
      this.applyRoot(dt);
      return;
    }

    // последовательности анимаций
    const seqActive = this.seqUpdate(dt);

    switch (this.state) {
      case 'idle': {
        if (!seqActive) {
          if (this.stateT > 2 + rand() * 4) this.decide();
        }
        break;
      }

      case 'wander': {
        if (!this.hasTarget) {
          const p = randomWalkPoint(rand, this.pos.x, this.pos.z, 18);
          this.target.copy(p);
          this.hasTarget = true;
        }
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.5);
        if (arrived || this.stateT > 14) {
          this.hasTarget = false;
          this.setState('idle');
        }
        break;
      }

      case 'sleep': {
        this.zzzT += dt;
        if (this.zzzT > 11) {
          this.zzzT = 0;
          this.bubble('zzz', 3.4);
        }
        if (this.needs.energy >= 99.5 || this.stateT > 176) {
          this.pokeCount = 0;
          this.wakeUp(false);
        }
        break;
      }

      case 'go_eat_apple': {
        if (!this.appleTarget || this.appleTarget.held) {
          this.appleTarget = undefined;
          this.setState('idle');
          break;
        }
        const ap = this.appleTarget.body.position;
        this.target.set(ap.x, 0, ap.z);
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.85);
        if (arrived) this.setState('eat_apple');
        else if (this.stateT > 16) {
          this.appleTarget = undefined;
          this.setState('idle');
        }
        break;
      }

      case 'eat_apple': {
        if (!seqActive) {
          if (this.stateT < 0.5 && !this.stateBubbleShown) {
            this.stateBubbleShown = true;
            this.bubble('apple', 3);
          }
          if (this.appleTarget) {
            // «съедаем»: яблоко исчезает
            this.w.eatItem(this.appleTarget);
            this.appleTarget = undefined;
          }
          if (this.stateT > 3.4) {
            this.needs.hunger = clamp(this.needs.hunger - 34, 0, 100);
            this.bubble('heart', 2.5);
            this.setState('idle');
          } else {
            this.playClip(this.clipFor('eat') ?? 'Stand_Eating_01', { fade: 0.25 });
          }
        }
        break;
      }

      case 'go_eat_berry': {
        if (!this.bushTarget) {
          const b = this.w.forest.nearestBush(this.pos);
          if (!b) {
            this.setState('idle');
            break;
          }
          this.bushTarget = b;
        }
        this.target.set(this.bushTarget.x, 0, this.bushTarget.z);
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 1.0);
        if (arrived) {
          this.berryIdx = 0;
          this.setState('eat_berry');
        } else if (this.stateT > 18) {
          this.bushTarget = null;
          this.setState('idle');
        }
        break;
      }

      case 'eat_berry': {
        if (!seqActive) {
          const b = this.bushTarget;
          if (!b) {
            this.setState('idle');
            break;
          }
          // найти следующую видимую ягоду
          let ate = false;
          while (this.berryIdx < b.berries.length) {
            const m = b.berries[this.berryIdx];
            this.berryIdx++;
            if (m.visible) {
              m.visible = false;
              ate = true;
              this.needs.hunger = clamp(this.needs.hunger - 7, 0, 100);
              break;
            }
          }
          const anyLeft = b.berries.some((m) => m.visible);
          if (!ate || this.needs.hunger < 16 || !anyLeft) {
            b.regrowTimer = 75;
            this.bushTarget = null;
            this.bubble('heart', 2.5);
            this.setState('idle');
          } else {
            this.playSeq([{ name: this.clipFor('eat') ?? 'Stand_Eating_01', dur: undefined }]);
            if (!this.stateBubbleShown) {
              this.stateBubbleShown = true;
              this.bubble('berry', 2.6);
            }
          }
        }
        break;
      }

      case 'go_shore': {
        if (!this.hasTarget) {
          const sp = this.shorePoint();
          if (!sp) {
            this.setState('idle');
            break;
          }
          this.shore.copy(sp);
          this.target.copy(sp);
          this.hasTarget = true;
        }
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.35);
        if (arrived) {
          this.hasTarget = false;
          // куда дальше: пить или рыбу ловить
          if (this.pendingShoreGoal === 'drink') {
            this.setState('drink');
          } else {
            this.setState('fish_wait');
          }
        } else if (this.stateT > 16) {
          this.hasTarget = false;
          this.setState('idle');
        }
        break;
      }

      case 'drink': {
        if (!seqActive) {
          if (!this.stateBubbleShown) {
            this.stateBubbleShown = true;
            this.bubble('splash', 3);
          }
          this.playSeq([{ name: this.clipFor('eat') ?? 'Stand_Eating_01', loop: true, dur: 3.2 }], () => {
            this.needs.thirst = clamp(this.needs.thirst - 55, 0, 100);
            this.bubble('heart', 2);
            this.setState('idle');
          });
        }
        // поворачиваемся к воде
        const dirYaw = Math.atan2(POND.center.x - this.pos.x, POND.center.y - this.pos.z);
        this.yaw = angleLerp(this.yaw, dirYaw, Math.min(1, dt * 3));
        break;
      }

      case 'fish_wait': {
        if (!seqActive) this.playClip(this.clipFor('sit') ?? 'Sitting_Idle_01', { fade: 0.3 });
        this.fishTimer -= dt;
        if (this.fishTimer <= 0) {
          const chance = 0.62;
          if (rand() < chance) {
            this.w.fishJump(this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.6)));
            this.setState('fish_catch');
          } else {
            this.bubble('question', 2.4);
            this.transitionToIdle('Trans_Sitting_to_Stand');
          }
        }
        break;
      }

      case 'fish_catch': {
        if (!seqActive) {
          this.playSeq([
            { name: 'Trans_Sitting_to_Stand', dur: undefined },
            { name: this.clipFor('eat') ?? 'Stand_Eating_01', loop: true, dur: 2.8 },
          ], () => {
            this.needs.hunger = clamp(this.needs.hunger - 44, 0, 100);
            this.bubble('heart', 2.5);
            this.setState('idle');
          });
          if (!this.stateBubbleShown) {
            this.stateBubbleShown = true;
            this.bubble('fish', 2.2);
          }
        }
        break;
      }

      case 'scratch_walk': {
        if (!this.scratchTree) {
          const t = this.w.forest.nearestTree(this.pos, 20);
          if (!t) {
            this.setState('idle');
            break;
          }
          this.scratchTree = { x: t.x, z: t.z };
        }
        this.target.set(this.scratchTree.x, 0, this.scratchTree.z);
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 1.25);
        if (arrived) {
          // повернуться к дереву
          const dirYaw = Math.atan2(this.scratchTree.x - this.pos.x, this.scratchTree.z - this.pos.z);
          this.yaw = dirYaw;
          this.setState('scratch');
        } else if (this.stateT > 18) {
          this.scratchTree = null;
          this.setState('idle');
        }
        break;
      }

      case 'scratch': {
        // трётся о дерево: покачиваемся
        const k = Math.sin(this.t * 3.6) * 0.14;
        this.model!.rotation.z = k;
        this.model!.position.z = Math.sin(this.t * 3.6) * 0.06;
        if (this.stateT > 3.6) {
          this.model!.rotation.z = 0;
          this.model!.position.z = 0;
          this.scratchTree = null;
          this.bubble('heart', 1.8);
          this.setState('idle');
        } else {
          this.playClip(this.clipFor('idle') ?? 'Stand_Idle_01', { fade: 0.4 });
        }
        break;
      }

      case 'claws_walk': {
        if (!this.scratchTree) {
          const t = this.w.forest.nearestTree(this.pos, 22);
          if (!t) {
            this.setState('idle');
            break;
          }
          this.scratchTree = { x: t.x, z: t.z };
        }
        this.target.set(this.scratchTree.x, 0, this.scratchTree.z);
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 1.5);
        if (arrived) {
          const dirYaw = Math.atan2(this.scratchTree.x - this.pos.x, this.scratchTree.z - this.pos.z);
          this.yaw = dirYaw;
          this.setState('claws');
        } else if (this.stateT > 18) {
          this.scratchTree = null;
          this.setState('idle');
        }
        break;
      }

      case 'claws': {
        if (!seqActive) {
          this.scratchTree = null;
          this.setState('idle');
        }
        break;
      }

      case 'chase_butterfly': {
        const b = this.w.butterflies[this.butterflyIdx];
        if (!b || this.stateT > 9) {
          this.butterflyIdx = -1;
          this.bubble('question', 2);
          this.setState('idle');
          break;
        }
        const d = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
        if (d < 1.1) {
          // прыжок-замах
          if (!seqActive) {
            this.playSeq([{ name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined }]);
          }
        } else {
          this.target.set(b.pos.x, 0, b.pos.z);
          this.locomotion(dt, 2.6, this.target, 0.6);
        }
        break;
      }

      case 'chase_mouse': {
        const m = this.w.mice[this.mouseIdx];
        if (!m || m.hidden || this.stateT > 8) {
          this.mouseIdx = -1;
          this.bubble('question', 2);
          this.setState('idle');
          break;
        }
        const d = Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z);
        if (d < 1.0) {
          if (!seqActive) {
            this.playSeq([{ name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined }]);
          }
        } else {
          this.target.set(m.pos.x, 0, m.pos.z);
          this.locomotion(dt, 3.1, this.target, 0.5);
        }
        break;
      }

      case 'dig_walk': {
        if (!this.hasTarget) {
          const p = randomWalkPoint(rand, this.pos.x, this.pos.z, 8);
          this.target.copy(p);
          this.hasTarget = true;
        }
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.4);
        if (arrived) {
          this.hasTarget = false;
          this.setState('dig');
        }
        break;
      }

      case 'dig': {
        this.digMoundT += dt;
        if (Math.floor(this.digMoundT * 2) !== Math.floor((this.digMoundT - dt) * 2)) {
          // порция земли
          const front = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.9).add(this.pos);
          this.w.dirtPuff(front, 8);
        }
        if (!seqActive) {
          // холмик
          this.spawnMound();
          this.needs.hunger = clamp(this.needs.hunger + 4, 0, 100);
          this.setState('idle');
        }
        break;
      }

      case 'zoomies': {
        if (this.zoomPts.length === 0) {
          this.needs.energy = clamp(this.needs.energy - 14, 0, 100);
          this.setState('idle');
          break;
        }
        const tp = this.zoomPts[0];
        this.target.copy(tp);
        const arrived = this.locomotion(dt, 4.1, this.target, 0.8);
        if (arrived) {
          this.zoomPts.shift();
          this.w.dustPuff(this.pos, 6);
        } else if (this.stateT > 4 && this.zoomPts.length > 1) {
          this.zoomPts.shift();
          this.stateT = 0;
        }
        break;
      }

      case 'sulk_walk': {
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.4);
        if (arrived) this.setState('sulk');
        else if (this.stateT > 9) this.setState('sulk');
        break;
      }

      case 'sulk': {
        if (!seqActive) this.playClip(this.clipFor('sit') ?? 'Sitting_Idle_01', { fade: 0.3 });
        if (this.needs.annoyance < 22 || this.stateT > 17) {
          this.transitionToIdle('Trans_Sitting_to_Stand');
        }
        break;
      }

      case 'rage': {
        if (!seqActive && this.zoomPts.length > 0) {
          const tp = this.zoomPts[0];
          this.target.copy(tp);
          const arrived = this.locomotion(dt, 4.4, this.target, 0.9);
          if (arrived) {
            this.zoomPts.shift();
            this.w.dustPuff(this.pos, 10);
            // замах в пустоту
            this.playSeq([{ name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined }]);
          }
        }
        if (this.zoomPts.length === 0 && !seqActive) {
          this.needs.annoyance = 20;
          this.needs.energy = clamp(this.needs.energy - 22, 0, 100);
          this.transitionToIdle('Trans_StandAngry_to_Stand');
        }
        break;
      }

      case 'react_swipe': {
        if (!seqActive) {
          if (this.stateT < 0.1) {
            const dx = this.target.x - this.pos.x;
            const dz = this.target.z - this.pos.z;
            if (Math.hypot(dx, dz) > 0.4) {
              this.yaw = Math.atan2(dx, dz);
            }
          }
          this.playSeq([{ name: this.clipFor('swipe') ?? 'Attack_StandAngry_01_Low', dur: undefined }], () =>
            this.setState('idle')
          );
        }
        break;
      }

      case 'react_approach': {
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 1.1);
        if (arrived) {
          this.bubble('question', 2);
          this.setState('idle');
        } else if (this.stateT > 8) this.setState('idle');
        break;
      }

      case 'react_leave': {
        const arrived = this.locomotion(dt, this.walkSpeed, this.target, 0.5);
        if (arrived) this.setState('idle');
        else if (this.stateT > 10) this.setState('idle');
        break;
      }

      case 'react_sit': {
        if (!seqActive) {
          if (this.stateT > 3 + rand() * 3) {
            this.transitionToIdle('Trans_Sitting_to_Stand');
          }
        }
        break;
      }

      case 'grabbed': {
        // смотрит на руку (в камеру) и вырывается
        const camX = this.w.camera.position.x;
        const camZ = this.w.camera.position.z;
        this.yaw = angleLerp(this.yaw, Math.atan2(camX - this.pos.x, camZ - this.pos.z), Math.min(1, dt * 4));
        this.model!.rotation.z = Math.sin(this.t * 14) * 0.09;
        if (this.stateT > 1.25) {
          this.model!.rotation.z = 0;
          this.transitionToIdle('Trans_StandHind_to_Stand');
        }
        break;
      }

      case 'land_react':
      case 'tossed':
      case 'shelter_rain':
        break;

      default:
        this.setState('idle');
        break;
    }

    // особые состояния движения обновляют hasTarget сами; подстраховка
    if (this.state === 'shelter_rain') {
      if (this.hasTarget) {
        const arrived = this.locomotion(dt, this.walkSpeed * 1.15, this.target, 1.6);
        if (arrived) {
          this.hasTarget = false;
          this.bubble('leaf', 2.5);
          this.standIdle();
        }
      }
      if (!this.w.rainActive && this.stateT > 2) {
        this.setState('idle');
      }
    }

    this.applyRoot(dt);
  }

  private applyRoot(dt: number) {
    // на земле — прижимаемся к рельефу
    if (!this.airborne) {
      const gy = terrainHeight(this.pos.x, this.pos.z) + this.feetOffset;
      this.pos.y = damp(this.pos.y, gy, 14, dt);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // блоб-тень: растёт и бледнеет в полёте
    if (this.blob) {
      const gy = terrainHeight(this.pos.x, this.pos.z);
      this.blob.position.set(this.pos.x, gy + 0.04, this.pos.z);
      const mat = this.blob.material as THREE.MeshBasicMaterial;
      if (this.airborne) {
        const h = Math.max(0, this.pos.y - gy);
        const k = Math.min(1, h / 4);
        this.blob.scale.setScalar(1 + k * 1.6);
        mat.opacity = 0.85 * (1 - k * 0.65);
      } else {
        this.blob.scale.setScalar(1);
        mat.opacity = 0.85;
      }
    }
  }

  private pendingShoreGoal: 'drink' | 'fish' = 'drink';

  /** выйти из состояния через переходную анимацию */
  private transitionToIdle(seqName: string) {
    this.playSeq([{ name: seqName, dur: undefined }], () => this.setState('idle'));
    this.state = 'idle';
    this.stateT = 0;
  }

  private shorePoint(): THREE.Vector3 | null {
    const dx = POND.center.x - this.pos.x;
    const dz = POND.center.y - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return null;
    const dir = new THREE.Vector3(dx / d, 0, dz / d);
    const p = this.pos.clone();
    let lastWalkable: THREE.Vector3 | null = null;
    for (let t = 0; t < d; t += 0.3) {
      p.set(this.pos.x + dir.x * t, 0, this.pos.z + dir.z * t);
      const h = terrainHeight(p.x, p.z);
      if (h < POND.waterLevel + 0.08) {
        break;
      }
      lastWalkable = p.clone();
    }
    if (!lastWalkable) return null;
    // точка на берегу, чуть в сторону от прямой, чтобы не в плотную к воде
    return lastWalkable;
  }

  /** decisions */
  private decide() {
    const n = this.needs;
    if (this.w.rainActive) {
      this.setState('shelter_rain');
      return;
    }
    if (n.annoyance > 72) {
      this.setState('rage');
      return;
    }
    if (n.annoyance > 40) {
      this.setState('sulk_walk');
      return;
    }
    if (n.energy < 12) {
      this.setState('sleep');
      return;
    }
    // брошенное яблоко рядом?
    const apple = this.w.props.nearestApple(this.pos, 9);
    if (apple && n.hunger > 24) {
      this.appleTarget = apple;
      this.setState('go_eat_apple');
      return;
    }
    if (n.hunger > 52) {
      const bush = this.w.forest.nearestBush(this.pos, true);
      if (bush && Math.hypot(bush.x - this.pos.x, bush.z - this.pos.z) < 26 && rand() < 0.8) {
        this.bushTarget = bush;
        this.setState('go_eat_berry');
        return;
      }
      if (rand() < 0.5) {
        this.pendingShoreGoal = rand() < 0.55 && n.hunger > 40 ? 'fish' : 'drink';
        this.setState('go_shore');
        return;
      }
    }
    if (n.thirst > 55) {
      this.pendingShoreGoal = rand() < 0.3 && n.hunger > 42 ? 'fish' : 'drink';
      this.setState('go_shore');
      return;
    }
    // развлечения
    const r = rand();
    if (r < 0.1 && this.w.butterflies.length) {
      // ближайшая бабочка
      let bi = -1;
      let bd = 11;
      this.w.butterflies.forEach((b, i) => {
        const d = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      if (bi >= 0) {
        this.butterflyIdx = bi;
        this.setState('chase_butterfly');
        return;
      }
    }
    if (r < 0.17 && this.w.mice.length) {
      let mi = -1;
      let md = 10;
      this.w.mice.forEach((m, i) => {
        if (m.hidden) return;
        const d = Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z);
        if (d < md) {
          md = d;
          mi = i;
        }
      });
      if (mi >= 0) {
        this.mouseIdx = mi;
        this.setState('chase_mouse');
        return;
      }
    }
    if (r < 0.27) {
      this.setState('scratch_walk');
      return;
    }
    if (r < 0.34) {
      this.setState('claws_walk');
      return;
    }
    if (r < 0.4) {
      this.setState('dig_walk');
      return;
    }
    if (r < 0.48 && n.energy > 62) {
      this.setState('zoomies');
      return;
    }
    if (r < 0.52) {
      this.pendingShoreGoal = 'drink';
      this.setState('go_shore');
      return;
    }
    if (r < 0.74) {
      this.setState('wander');
      return;
    }
    this.setState('idle');
  }

  private spawnMound() {
    // холмик земли — рождается у медведя (сцена передаётся через world)
    const scene = this.root.parent;
    if (!scene) return;
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8a6d4f, roughness: 1, flatShading: true })
    );
    const fx = this.pos.x + Math.sin(this.yaw) * 1.0;
    const fz = this.pos.z + Math.cos(this.yaw) * 1.0;
    mound.position.set(fx, terrainHeight(fx, fz) - 0.03, fz);
    mound.scale.y = 0.55;
    mound.castShadow = true;
    scene.add(mound);
    // ограничить количество холмиков
    const mounds = scene.children.filter((c) => c.userData.isMound);
    if (mounds.length > 7) {
      const oldest = mounds[0];
      scene.remove(oldest);
    }
    mound.userData.isMound = true;
  }

  /** для проверки «ткнули в медведя» — сфера вокруг центра */
  hitTest(p: THREE.Vector3): boolean {
    const c = new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z);
    return c.distanceTo(p) < 1.35;
  }

  capsule(): { a: THREE.Vector3; b: THREE.Vector3; r: number } {
    return {
      a: new THREE.Vector3(this.pos.x, this.pos.y + 0.25, this.pos.z),
      b: new THREE.Vector3(this.pos.x, this.pos.y + 1.15, this.pos.z),
      r: 0.95,
    };
  }

  get headY(): number {
    return this.pos.y + (this.state === 'sleep' || this.state === 'fish_wait' ? 1.0 : 1.9);
  }

  get chasingButterfly(): boolean {
    return this.state === 'chase_butterfly' && this.butterflyIdx >= 0;
  }

  get chasingMouse(): boolean {
    return this.state === 'chase_mouse' && this.mouseIdx >= 0;
  }

  get butterflyIndex(): number {
    return this.butterflyIdx;
  }

  get mouseIndex(): number {
    return this.mouseIdx;
  }
}
