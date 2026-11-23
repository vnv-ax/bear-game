// Рельеф: визуальный меш + cannon-es heightfield
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { terrainHeight, WORLD, POND } from './config';

export class Terrain {
  mesh!: THREE.Mesh;
  body!: CANNON.Body;

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.buildVisual(scene);
    this.buildPhysics(world);
  }

  private buildVisual(scene: THREE.Scene) {
    const seg = 150;
    const size = WORLD.size;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x7aa85e);
    const cGrass2 = new THREE.Color(0x5c8c48);
    const cGrassDry = new THREE.Color(0xa8b860);
    const cSand = new THREE.Color(0xd8c793);
    const cDeep = new THREE.Color(0x4e6e44);
    const cDirt = new THREE.Color(0x8a6d4f);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);

      // покраска: луга с вариациями, песок у воды, тёмное дно
      const n =
        Math.sin(x * 0.31 + 4.2) * Math.cos(z * 0.27 - 1.3) * 0.5 +
        Math.sin(x * 0.83 - z * 0.71) * 0.3 +
        Math.sin(x * 1.7 + z * 1.3) * 0.12;
      if (h < POND.waterLevel - 0.25) {
        c.copy(cDeep).lerp(cDirt, Math.max(0, 0.4 + n * 0.5));
      } else if (h < POND.waterLevel + 0.35) {
        c.copy(cSand).lerp(cGrassDry, Math.max(0, 0.35 + n * 0.4));
      } else {
        c.copy(cGrass).lerp(cGrass2, Math.max(0, 0.5 + n * 0.75));
        if (n > 0.55) c.lerp(cGrassDry, Math.min(0.6, (n - 0.55) * 1.6));
        if (n < -0.5) c.lerp(cDirt, Math.min(0.3, (-n - 0.5) * 0.5));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);
  }

  private buildPhysics(world: CANNON.World) {
    // heightfield: data[i][j], локальный X -> мир X, локальный Y -> мир -Z (поворот -90° по X)
    const N = 64;
    const half = WORLD.size / 2;
    const es = WORLD.size / (N - 1);
    const data: number[][] = [];
    for (let i = 0; i < N; i++) {
      const col: number[] = [];
      for (let j = 0; j < N; j++) {
        const wx = -half + i * es;
        const wz = half - j * es;
        col.push(terrainHeight(wx, wz));
      }
      data.push(col);
    }
    const hf = new CANNON.Heightfield(data, { elementSize: es });
    this.body = new CANNON.Body({ mass: 0, material: new CANNON.Material('ground') });
    this.body.addShape(hf);
    this.body.position.set(-half, 0, half);
    this.body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.body.allowSleep = false;
    world.addBody(this.body);
  }
}
