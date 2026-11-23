// Магический режим «✦»: палитра, искры, светящиеся сферы и лёгкий сюрреализм
import * as THREE from 'three';

const SPARKLE_COUNT = 260;

function sparkleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,235,180,0.85)');
  g.addColorStop(1, 'rgba(255,180,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MagicMode {
  on = false;
  private sparkles: THREE.Points;
  private sparkVel: Float32Array;
  private orbs: THREE.Sprite[] = [];
  private mix = 0;
  private target = 0;
  private fogNormal: THREE.Color;
  private fogMagic = new THREE.Color(0xcbb3e6);
  private scene: THREE.Scene;
  private t = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fogNormal = (scene.fog as THREE.Fog)?.color.clone() ?? new THREE.Color(0xcfe3f4);

    // искры
    const pos = new Float32Array(SPARKLE_COUNT * 3);
    this.sparkVel = new Float32Array(SPARKLE_COUNT);
    const colors = new Float32Array(SPARKLE_COUNT * 3);
    const palette = [0xffd54c, 0xff8ad8, 0x8ad8ff, 0xc0ff8a, 0xd4aaff];
    const col = new THREE.Color();
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      this.sparkVel[i] = 0.25 + Math.random() * 0.55;
      col.set(palette[i % palette.length]);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.22,
      map: sparkleTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      opacity: 0,
    });
    this.sparkles = new THREE.Points(geo, mat);
    this.sparkles.frustumCulled = false;
    this.sparkles.visible = false;
    scene.add(this.sparkles);

    // большие мягкие светящиеся сферы
    for (let i = 0; i < 4; i++) {
      const m = new THREE.SpriteMaterial({
        map: sparkleTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: palette[(i + 2) % palette.length],
      });
      const s = new THREE.Sprite(m);
      s.scale.setScalar(5 + i * 2.2);
      s.position.set((Math.random() - 0.5) * 60, 10 + Math.random() * 8, (Math.random() - 0.5) * 60);
      s.userData.speed = 0.15 + Math.random() * 0.2;
      s.userData.phase = Math.random() * 10;
      this.orbs.push(s);
      scene.add(s);
    }
  }

  setOn(on: boolean) {
    this.on = on;
    this.target = on ? 1 : 0;
    this.sparkles.visible = true;
    this.orbs.forEach((o) => (o.visible = true));
  }

  update(dt: number, focus: THREE.Vector3) {
    this.t += dt;
    this.mix += (this.target - this.mix) * Math.min(1, dt * 1.4);

    // искры
    const mat = this.sparkles.material as THREE.PointsMaterial;
    mat.opacity = this.mix * 0.85;
    if (this.mix < 0.02) {
      this.sparkles.visible = false;
      this.orbs.forEach((o) => (o.visible = false));
      return;
    }
    const pos = this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      arr[i * 3 + 1] += this.sparkVel[i] * dt;
      arr[i * 3] += Math.sin(this.t * 0.8 + i) * dt * 0.18;
      if (arr[i * 3 + 1] > 15) {
        arr[i * 3] = focus.x + (Math.random() - 0.5) * 60;
        arr[i * 3 + 1] = 0.2;
        arr[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 60;
      }
    }
    pos.needsUpdate = true;

    // сферы медленно плывут вокруг
    for (const o of this.orbs) {
      const m = o.material as THREE.SpriteMaterial;
      m.opacity = this.mix * 0.32;
      o.position.x += Math.sin(this.t * 0.1 + (o.userData.phase as number)) * dt * (o.userData.speed as number) * 3;
      o.position.y += Math.cos(this.t * 0.13 + (o.userData.phase as number)) * dt * 0.22;
      if (o.position.y > 18) o.position.y = 7;
      if (o.position.distanceTo(focus) > 42) {
        const d = o.position.clone().sub(focus).setY(0).normalize().multiplyScalar(-1);
        o.position.addScaledVector(d, dt * 2);
      }
    }
  }

  /** тёплый множитель экспозиции */
  get exposureBoost() {
    return 1 + this.mix * 0.14;
  }

  /** подмешать магию в цвет тумана (вызывать с copy) */
  applyFog(baseColor: THREE.Color) {
    const fog = this.scene.fog as THREE.Fog | null;
    if (!fog) return;
    baseColor.copy(this.fogNormal).lerp(this.fogMagic, this.mix);
    fog.color.copy(baseColor);
  }

  get mixValue() {
    return this.mix;
  }
}
