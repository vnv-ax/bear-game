// Небо, солнце, облака, дождь и радуга
import * as THREE from 'three';
import { terrainHeight } from './config';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uMagic;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float t = pow(max(d.y, 0.0), 0.55);
  vec3 zen = mix(uZenith, vec3(0.42, 0.23, 0.55), uMagic);
  vec3 hor = mix(uHorizon, vec3(1.0, 0.72, 0.82), uMagic);
  vec3 col = mix(hor, zen, t);
  // солнце и гало
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(s, 320.0) * 1.4 + pow(s, 8.0) * 0.18);
  // звёзды в магическом режиме
  if (uMagic > 0.01 && d.y > 0.05) {
    vec2 grid = floor(d.xz * 60.0 + d.y * 37.0);
    float h = hash(grid);
    if (h > 0.985) {
      float tw = 0.5 + 0.5 * sin(h * 90.0);
      col += vec3(1.0, 0.95, 0.8) * uMagic * tw * 0.85 * (0.4 + 0.6 * d.y);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

interface CloudPuff {
  mesh: THREE.Mesh;
  baseX: number;
  speed: number;
}

export class Sky {
  group = new THREE.Group();
  sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  hemi = new THREE.HemisphereLight(0xbfd9ff, 0x93ad78, 1.15);
  ambient = new THREE.AmbientLight(0xffffff, 0.3);
  sunDir = new THREE.Vector3(0.55, 0.72, -0.42).normalize();

  private skyMat: THREE.ShaderMaterial;
  private clouds: CloudPuff[] = [];
  private cloudGroup = new THREE.Group();

  // дождь
  rainPoints!: THREE.Points;
  rainVel!: Float32Array;
  rainIntensity = 0;
  rainTarget = 0;
  rainTimer = 90 + Math.random() * 90;
  rainDuration = 0;
  private rainAfter = 0;
  onRainChange?: (raining: boolean) => void;

  // радуга
  rainbow?: THREE.Group;
  rainbowLife = 0;
  rainbowOpacity = 0;
  rainPending = false;

  private magicMix = 0;
  private magicTarget = 0;
  private t = 0;

  constructor(scene: THREE.Scene) {
    // небесный купол
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0x4a7fc1) },
        uHorizon: { value: new THREE.Color(0xcfe3f4) },
        uSunDir: { value: this.sunDir.clone() },
        uSunColor: { value: new THREE.Color(0xfff0d0) },
        uMagic: { value: 0 },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), this.skyMat);
    dome.frustumCulled = false;
    this.group.add(dome);

    // солнце
    this.sun.position.copy(this.sunDir).multiplyScalar(60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 140;
    const sh = this.sun.shadow.camera as THREE.OrthographicCamera;
    sh.left = -32;
    sh.right = 32;
    sh.top = 32;
    sh.bottom = -32;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.group.add(this.sun);
    this.sun.target.position.set(0, 0, 0);

    this.group.add(this.hemi);
    this.group.add(this.ambient);

    // облака — мягкие низкополигональные комки
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    const rand = () => Math.random();
    for (let i = 0; i < 9; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        const p = new THREE.Mesh(puffGeo, puffMat);
        const s = 1.6 + rand() * 2.6;
        p.scale.set(s * (1 + rand()), s * 0.55, s);
        p.position.set((rand() - 0.5) * 6, (rand() - 0.5) * 1.2, (rand() - 0.5) * 3.4);
        cl.add(p);
      }
      cl.position.set((rand() - 0.5) * 190, 34 + rand() * 14, (rand() - 0.5) * 190);
      this.cloudGroup.add(cl);
      this.clouds.push({ mesh: cl as unknown as THREE.Mesh, baseX: cl.position.x, speed: 0.35 + rand() * 0.5 });
    }
    this.group.add(this.cloudGroup);

    // дождь
    this.initRain();
    scene.add(this.group);
  }

  private initRain() {
    const N = 1100;
    const pos = new Float32Array(N * 3);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 46;
      this.rainVel[i] = 9 + Math.random() * 5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaecbe8,
      size: 0.09,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.group.add(this.rainPoints);
  }

  setMagic(on: boolean) {
    this.magicTarget = on ? 1 : 0;
  }

  /** прогноз дождя — вызывается из Game.update */
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.t += dt;
    // магия
    this.magicMix += (this.magicTarget - this.magicMix) * Math.min(1, dt * 1.6);
    this.skyMat.uniforms.uMagic.value = this.magicMix;
    this.hemi.intensity = 1.15 - this.rainIntensity * 0.45;
    this.sun.intensity = (2.6 - this.rainIntensity * 1.9) * (1 + this.magicMix * 0.15);
    this.ambient.intensity = 0.3 + this.rainIntensity * 0.16;

    // затухание/усиление дождя
    this.rainIntensity += (this.rainTarget - this.rainIntensity) * Math.min(1, dt * 0.8);
    const pm = this.rainPoints.material as THREE.PointsMaterial;
    pm.opacity = this.rainIntensity * 0.75;
    this.rainPoints.visible = this.rainIntensity > 0.02;
    const pos = this.rainPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (this.rainPoints.visible) {
      const arr = pos.array as Float32Array;
      const n = this.rainVel.length;
      for (let i = 0; i < n; i++) {
        arr[i * 3 + 1] -= this.rainVel[i] * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3] = (Math.random() - 0.5) * 46;
          arr[i * 3 + 1] = 20 + Math.random() * 4;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 46;
        }
      }
      pos.needsUpdate = true;
      this.rainPoints.position.set(focus.x, terrainHeight(focus.x, focus.z), focus.z);
    }

    // расписание дождя
    if (this.rainTarget === 0) {
      this.rainTimer -= dt;
      if (this.rainTimer <= 0 && Math.random() < 0.55) {
        this.rainTarget = 1;
        this.rainDuration = 22 + Math.random() * 20;
        this.onRainChange?.(true);
      } else if (this.rainTimer <= 0) {
        this.rainTimer = 150 + Math.random() * 200;
      }
    } else {
      this.rainDuration -= dt;
      if (this.rainDuration <= 0) {
        this.rainTarget = 0;
        this.rainTimer = 170 + Math.random() * 230;
        this.onRainChange?.(false);
        this.rainPending = Math.random() < 0.6;
      }
    }

    // радуга после дождя
    if (this.rainPending) {
      this.rainPending = false;
      this.spawnRainbow(focus, camera);
    }
    if (this.rainbow) {
      this.rainbowLife -= dt;
      const inT = Math.min(1, (50 - this.rainbowLife) / 5);
      const outT = Math.min(1, this.rainbowLife / 6);
      const o = Math.max(0, Math.min(inT, outT)) * 0.3;
      this.rainbow.traverse((o2) => {
        const m = (o2 as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (m && m.opacity !== undefined) m.opacity = o;
      });
      this.rainbow.rotation.y += dt * 0.01;
      if (this.rainbowLife <= 0) {
        this.group.remove(this.rainbow);
        this.rainbow = undefined;
      }
    }

    // облака плывут
    for (const c of this.clouds) {
      c.baseX += c.speed * dt * (1 + this.magicMix * 0.8);
      if (c.baseX > 130) c.baseX = -130;
      const m = c.mesh as unknown as THREE.Group;
      m.position.x = c.baseX;
      m.position.y += Math.sin(this.t * 0.12 + c.baseX) * dt * 0.08;
    }
    // магическая подсветка облаков
    (this.cloudGroup.children[0] as THREE.Group)?.children.forEach(() => undefined);
    const cloudMat = (this.clouds[0].mesh as unknown as THREE.Group).children[0] as THREE.Mesh;
    if (cloudMat) {
      const mm = cloudMat.material as THREE.MeshLambertMaterial;
      mm.color.setRGB(1, 1 - this.magicMix * 0.25, 1 - this.magicMix * 0.1);
    }
  }

  private spawnRainbow(focus: THREE.Vector3, camera: THREE.Camera) {
    const group = new THREE.Group();
    const colors = [0xff5b4c, 0xffa14c, 0xffe14c, 0x7fd94c, 0x4cc3ff, 0x4c6bff, 0xa44cff];
    for (let i = 0; i < colors.length; i++) {
      const R = 40 + i * 0.55;
      const geo = new THREE.TorusGeometry(R, 0.5, 4, 60, Math.PI * 0.62);
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const arc = new THREE.Mesh(geo, mat);
      arc.rotation.z = Math.PI - Math.PI * 0.62 + Math.PI * 0.31;
      group.add(arc);
    }
    // направление: противоположно солнцу, красиво над горизонтом
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const az = Math.atan2(dir.x, dir.z) + Math.PI * (0.55 + Math.random() * 0.35);
    group.position.set(focus.x + Math.sin(az) * 85, 6, focus.z + Math.cos(az) * 85);
    group.rotation.y = az + Math.PI;
    this.rainbow = group;
    this.rainbowLife = 50;
    this.group.add(group);
  }

  get magicMixValue() {
    return this.magicMix;
  }
}
