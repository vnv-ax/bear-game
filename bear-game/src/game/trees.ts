// Лес: деревья из GLB-сцены (23 варианта коры/листвы), инстансинг,
// трава, кусты с ягодами, яблони
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { terrainHeight, isWalkable, pondDist, POND, makeRand, asset } from './config';

export interface TreePlacement {
  x: number;
  z: number;
  y: number;
  scale: number;
  height: number;
  crownR: number;
}

export interface BerryBush {
  x: number;
  z: number;
  y: number;
  berries: THREE.Mesh[];
  regrowTimer: number;
}

const rand = makeRand(20241123);

export class Forest {
  trees: TreePlacement[] = [];
  appleTrees: THREE.Vector3[] = [];
  bushes: BerryBush[] = [];
  treeMeshes: THREE.InstancedMesh[] = [];
  private tintables: THREE.InstancedMesh[] = [];
  private bushGroups: THREE.Group[] = [];

  async load(scene: THREE.Scene, onProgress?: (p: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(asset('/models/tree_scene.glb'));
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // --- сборка геометрий деревьев: ствол (Bark) + крона (Leaves), 23 варианта ---
    interface TreeVariant {
      trunk: THREE.BufferGeometry | null;
      leaves: THREE.BufferGeometry | null;
      trunkMat: THREE.Material | null;
      leavesMat: THREE.Material | null;
    }
    const variants: TreeVariant[] = [];
    const grassGeos: THREE.BufferGeometry[] = [];
    let grassMat: THREE.Material | null = null;

    const bake = (m: THREE.Mesh, recenterXZ: boolean, baseY: 'zero' | 'keep') => {
      const geo = m.geometry.clone();
      // запекаем мировую матрицу (учитывает поворот Z-up -> Y-up и масштаб)
      m.updateWorldMatrix(true, false);
      geo.applyMatrix4(m.matrixWorld);
      if (geo.getIndex() === null) geo.setIndex([...Array(geo.getAttribute('position').count).keys()]);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      if (recenterXZ) {
        const cx = (bb.min.x + bb.max.x) / 2;
        const cz = (bb.min.z + bb.max.z) / 2;
        geo.translate(-cx, baseY === 'zero' ? -bb.min.y : -bb.min.y, -cz);
      }
      geo.computeBoundingBox();
      return geo;
    };

    root.traverse((o) => {
      const name = o.name;
      const isBark = name.startsWith('Bark');
      const isGrass = name.startsWith('Grass_B_');
      if (!isBark && !isGrass) return;
      if (isBark) {
        // у группы Bark: потомок с материалом Bark — ствол; с Leaves — крона
        const variant: TreeVariant = { trunk: null, leaves: null, trunkMat: null, leavesMat: null };
        o.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (!mesh.isMesh) return;
          const matName = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          const baked = bake(mesh, true, 'zero');
          if (matName.name === 'Leaves') {
            if (!variant.leaves) {
              variant.leaves = baked;
              variant.leavesMat = matName;
            }
          } else if (!variant.trunk) {
            variant.trunk = baked;
            variant.trunkMat = matName;
          }
        });
        if (variant.trunk || variant.leaves) variants.push(variant);
      } else {
        // трава: берём несколько уникальных пучков
        if (grassGeos.length < 8) {
          o.traverse((c) => {
            const mesh = c as THREE.Mesh;
            if (!mesh.isMesh || grassGeos.length >= 8) return;
            const matName = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
            grassGeos.push(bake(mesh, true, 'zero'));
            if (!grassMat) grassMat = matName;
          });
        }
      }
    });

    const trunkVariant = variants.find((v) => v.trunk);
    if (!trunkVariant || !trunkVariant.trunkMat) {
      console.warn('[forest] не удалось извлечь деревья из GLB');
      return;
    }

    // материалы: ствол — непрозрачный; крона — маска по альфе, двусторонняя
    const trunkMat = trunkVariant.trunkMat as THREE.MeshStandardMaterial;
    trunkMat.side = THREE.FrontSide;
    // текстура коры очень тёмная — слегка подсвечиваем
    trunkMat.color.setRGB(1.85, 1.85, 1.85);
    if (trunkMat.map) trunkMat.map.anisotropy = 4;
    let leafMat: THREE.MeshStandardMaterial | null = null;
    let leafDepth: THREE.MeshDepthMaterial | null = null;
    const leafVariant = variants.find((v) => v.leaves && v.leavesMat);
    if (leafVariant) {
      const lm = leafVariant.leavesMat as THREE.MeshStandardMaterial;
      lm.side = THREE.DoubleSide;
      lm.alphaTest = 0.45;
      lm.transparent = false;
      lm.color.setRGB(1.3, 1.3, 1.2);
      if (lm.map) lm.map.anisotropy = 4;
      leafMat = lm;
      // правильные тени для альфа-маскированной листвы
      leafDepth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: lm.map ?? null,
        alphaTest: 0.45,
      });
    }

    // --- расстановка деревьев ---
    const variantsCount = variants.length;
    const perVariant = Math.ceil(112 / variantsCount);
    const order: number[] = [];
    for (let v = 0; v < variantsCount; v++) for (let k = 0; k < perVariant; k++) order.push(v);
    // перемешать
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const spots: TreePlacement[] = [];
    let tries = 0;
    let placed = 0;
    while (placed < order.length && tries < 6000) {
      tries++;
      const x = (rand() * 2 - 1) * 64;
      const z = (rand() * 2 - 1) * 64;
      const r = Math.hypot(x, z);
      if (r > 66 || r < 7) continue;
      if (pondDist(x, z) < POND.radius + 5) continue;
      let ok = true;
      for (const s of spots) {
        if (Math.hypot(s.x - x, s.z - z) < 3.4) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const scale = 0.72 + rand() * 0.5;
      const y = terrainHeight(x, z) - 0.18 * scale;
      const geo = variants[order[placed]].trunk;
      geo?.computeBoundingBox();
      const h = ((geo?.boundingBox!.max.y ?? 10) - (geo?.boundingBox!.min.y ?? 0)) * scale;
      const pl: TreePlacement = { x, z, y, scale, height: h, crownR: h * 0.32 };
      spots.push(pl);
      placed++;
    }
    this.trees = spots;

    // инстансинг по вариантам: ствол + крона одним индексом
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const counts = new Array(variantsCount).fill(0) as number[];
    for (let i = 0; i < spots.length; i++) counts[order[i]]++;

    for (let v = 0; v < variantsCount; v++) {
      if (counts[v] === 0) continue;
      const vr = variants[v];
      if (!vr.trunk && !vr.leaves) continue;
      // собираем матрицы экземпляров один раз
      const matsArr: THREE.Matrix4[] = [];
      for (let i = 0; i < spots.length; i++) {
        if (order[i] !== v) continue;
        const pl = spots[i];
        pv.set(pl.x, pl.y, pl.z);
        eu.set(0, rand() * Math.PI * 2, 0);
        q.setFromEuler(eu);
        sc.set(pl.scale, pl.scale, pl.scale);
        m4.compose(pv, q, sc);
        matsArr.push(m4.clone());
      }
      if (vr.trunk) {
        const inst = new THREE.InstancedMesh(vr.trunk, vr.trunkMat as THREE.Material, matsArr.length);
        inst.castShadow = true;
        inst.receiveShadow = false;
        inst.frustumCulled = false;
        matsArr.forEach((mm, i) => inst.setMatrixAt(i, mm));
        inst.instanceMatrix.needsUpdate = true;
        this.tintables.push(inst);
        this.treeMeshes.push(inst);
        scene.add(inst);
      }
      if (vr.leaves) {
        const linst = new THREE.InstancedMesh(vr.leaves, (vr.leavesMat ?? leafMat) as THREE.Material, matsArr.length);
        linst.castShadow = true;
        linst.receiveShadow = false;
        linst.frustumCulled = false;
        if (leafDepth) linst.customDepthMaterial = leafDepth;
        matsArr.forEach((mm, i) => linst.setMatrixAt(i, mm));
        linst.instanceMatrix.needsUpdate = true;
        this.tintables.push(linst);
        this.treeMeshes.push(linst);
        scene.add(linst);
      }
    }

    // --- яблони: 4 выбранных дерева ---
    const shuffled = [...spots].sort(() => rand() - 0.5);
    for (let i = 0; i < Math.min(4, shuffled.length); i++) {
      const t = shuffled[i];
      if (Math.hypot(t.x, t.z) < 55) this.appleTrees.push(new THREE.Vector3(t.x, t.y, t.z));
    }

    // --- трава ---
    if (grassMat && grassGeos.length) {
      const gm = grassMat as THREE.MeshStandardMaterial;
      gm.side = THREE.DoubleSide;
      gm.alphaTest = 0.45;
      const perGeo = Math.ceil(430 / grassGeos.length);
      for (let g = 0; g < grassGeos.length; g++) {
        const inst = new THREE.InstancedMesh(grassGeos[g], gm, perGeo);
        inst.frustumCulled = false;
        inst.receiveShadow = true;
        let k = 0;
        for (let i = 0; i < perGeo * 3 && k < perGeo; i++) {
          const x = (rand() * 2 - 1) * 58;
          const z = (rand() * 2 - 1) * 58;
          if (!isWalkable(x, z) || pondDist(x, z) < POND.radius + 1) continue;
          const s = 0.85 + rand() * 0.9;
          pv.set(x, terrainHeight(x, z) - 0.02, z);
          eu.set(0, rand() * Math.PI * 2, 0);
          q.setFromEuler(eu);
          sc.set(s, s * (0.8 + rand() * 0.5), s);
          m4.compose(pv, q, sc);
          inst.setMatrixAt(k++, m4);
        }
        inst.count = k;
        inst.instanceMatrix.needsUpdate = true;
        this.tintables.push(inst);
        scene.add(inst);
      }
    }

    // --- кусты с ягодами ---
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 1, flatShading: true });
    const berryMat = new THREE.MeshStandardMaterial({
      color: 0xc2478f,
      roughness: 0.4,
      emissive: 0x4a1030,
      emissiveIntensity: 0.25,
    });
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 1);
    const berryGeo = new THREE.SphereGeometry(0.075, 6, 5);
    let placedBushes = 0;
    let btries = 0;
    while (placedBushes < 8 && btries < 800) {
      btries++;
      const x = (rand() * 2 - 1) * 42;
      const z = (rand() * 2 - 1) * 42;
      if (!isWalkable(x, z) || pondDist(x, z) < POND.radius + 2.5) continue;
      if (Math.hypot(x, z) < 5) continue;
      let ok = true;
      for (const b of this.bushes) if (Math.hypot(b.x - x, b.z - z) < 6) ok = false;
      for (const t of this.trees) if (Math.hypot(t.x - x, t.z - z) < 2) ok = false;
      if (!ok) continue;

      const g = new THREE.Group();
      const y = terrainHeight(x, z);
      g.position.set(x, y, z);
      const blobs = 3 + Math.floor(rand() * 2);
      for (let j = 0; j < blobs; j++) {
        const b = new THREE.Mesh(bushGeo, bushMat);
        b.position.set((rand() - 0.5) * 0.7, 0.3 + rand() * 0.25, (rand() - 0.5) * 0.7);
        const s = 0.7 + rand() * 0.5;
        b.scale.set(s, s * 0.8, s);
        b.castShadow = true;
        g.add(b);
      }
      const bush: BerryBush = { x, z, y, berries: [], regrowTimer: 0 };
      const nb = 5 + Math.floor(rand() * 3);
      for (let j = 0; j < nb; j++) {
        const ber = new THREE.Mesh(berryGeo, berryMat);
        const a = rand() * Math.PI * 2;
        const rr = 0.42 + rand() * 0.25;
        ber.position.set(Math.cos(a) * rr, 0.35 + rand() * 0.4, Math.sin(a) * rr);
        g.add(ber);
        bush.berries.push(ber);
      }
      this.bushes.push(bush);
      this.bushGroups.push(g);
      scene.add(g);
      placedBushes++;
    }

    onProgress?.(1);
  }

  /** ближайшее дерево (для чесания спины, укрытия от дождя) */
  nearestTree(pos: THREE.Vector3, maxDist = 12): TreePlacement | null {
    let best: TreePlacement | null = null;
    let bd = maxDist * maxDist;
    for (const t of this.trees) {
      const d = (t.x - pos.x) * (t.x - pos.x) + (t.z - pos.z) * (t.z - pos.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** отталкивание от стволов: возвращает скорректированную позицию */
  pushFromTrunks(pos: THREE.Vector3, radius = 1.1): boolean {
    let pushed = false;
    for (const t of this.trees) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const d = Math.hypot(dx, dz);
      const tr = 0.5 * t.scale + radius;
      if (d < tr && d > 0.0001) {
        pos.x = t.x + (dx / d) * tr;
        pos.z = t.z + (dz / d) * tr;
        pushed = true;
      }
    }
    return pushed;
  }

  nearestBush(pos: THREE.Vector3, withBerries = true): BerryBush | null {
    let best: BerryBush | null = null;
    let bd = Infinity;
    for (const b of this.bushes) {
      if (withBerries && b.berries.every((m) => !m.visible)) continue;
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  update(dt: number) {
    // ягоды отрастают
    for (const b of this.bushes) {
      if (b.regrowTimer > 0) {
        b.regrowTimer -= dt;
        if (b.regrowTimer <= 0) {
          for (const m of b.berries) m.visible = true;
        }
      }
    }
  }

  magicTint(on: boolean) {
    const c = new THREE.Color();
    // подкрашиваем только деревья (кусты/трава остаются естественными)
    const trees = this.treeMeshes;
    for (const inst of trees) {
      const n = inst.count;
      for (let i = 0; i < n; i++) {
        if (on) {
          c.setHSL(rand() * 0.85 + 0.45, 0.35, 0.78);
          inst.setColorAt(i, c);
        } else {
          inst.setColorAt(i, c.setRGB(1, 1, 1));
        }
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }
}
