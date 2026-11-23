// Облачко мыслей над головой медведя (canvas-текстура на спрайте)
import * as THREE from 'three';

export type ThoughtKind =
  | 'apple'
  | 'berry'
  | 'fish'
  | 'butterfly'
  | 'mouse'
  | 'zzz'
  | 'dig'
  | 'paw'
  | 'claw'
  | 'tree'
  | 'anger'
  | 'question'
  | 'heart'
  | 'leaf'
  | 'sparkle'
  | 'excl'
  | 'splash'
  | 'grudge';

function drawIcon(ctx: CanvasRenderingContext2D, kind: ThoughtKind, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#3a2c22';
  ctx.fillStyle = '#3a2c22';
  switch (kind) {
    case 'apple': {
      ctx.fillStyle = '#d23b2e';
      ctx.beginPath();
      ctx.arc(0, 4, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a3a20';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.34);
      ctx.quadraticCurveTo(3, -s * 0.55, 6, -s * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#5d9c3c';
      ctx.beginPath();
      ctx.ellipse(9, -s * 0.62, 8, 4.5, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'berry': {
      ctx.fillStyle = '#c2478f';
      for (const [dx, dy, r] of [
        [-10, 6, 11],
        [10, 8, 10],
        [0, -10, 10],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#2e6b34';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(4, -26);
      ctx.stroke();
      break;
    }
    case 'fish': {
      ctx.fillStyle = '#5f88a8';
      ctx.beginPath();
      ctx.ellipse(-4, 0, s * 0.45, s * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.32, 0);
      ctx.lineTo(s * 0.62, -s * 0.22);
      ctx.lineTo(s * 0.62, s * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#26333d';
      ctx.beginPath();
      ctx.arc(-s * 0.28, -2, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'butterfly': {
      ctx.fillStyle = '#e8843c';
      ctx.beginPath();
      ctx.ellipse(-11, -4, 11, 14, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(11, -4, 11, 14, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a4a1e';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mouse': {
      ctx.fillStyle = '#9c9ca4';
      ctx.beginPath();
      ctx.ellipse(0, 6, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-8, -6, 6, 0, Math.PI * 2);
      ctx.arc(4, -8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9c9ca4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(14, 6);
      ctx.quadraticCurveTo(24, 2, 28, 10);
      ctx.stroke();
      break;
    }
    case 'zzz': {
      ctx.strokeStyle = '#5a7fbf';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      const z = (x: number, y: number, sz: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + sz, y);
        ctx.lineTo(x, y + sz);
        ctx.lineTo(x + sz, y + sz);
        ctx.stroke();
      };
      z(-18, 8, 12);
      z(0, -6, 15);
      z(18, -22, 18);
      break;
    }
    case 'dig': {
      ctx.fillStyle = '#8a6d4f';
      ctx.beginPath();
      ctx.arc(0, 8, 16, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#3a2c22';
      for (const [dx, dy] of [
        [-14, -12],
        [0, -18],
        [14, -10],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'paw': {
      ctx.fillStyle = '#6b4a32';
      ctx.beginPath();
      ctx.arc(0, 6, 12, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy] of [
        [-10, -8],
        [0, -12],
        [10, -8],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'claw': {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 12 - 5, -16);
        ctx.lineTo(i * 12 + 5, 14);
        ctx.stroke();
      }
      break;
    }
    case 'tree': {
      ctx.fillStyle = '#6b4a32';
      ctx.fillRect(-4, -2, 8, 18);
      ctx.fillStyle = '#3e7c3a';
      ctx.beginPath();
      ctx.arc(0, -12, 16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'anger': {
      ctx.strokeStyle = '#d43a2a';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-16, -14);
      ctx.lineTo(-4, -2);
      ctx.lineTo(-14, 0);
      ctx.lineTo(0, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6, -10);
      ctx.lineTo(18, 2);
      ctx.lineTo(8, 4);
      ctx.lineTo(20, 16);
      ctx.stroke();
      break;
    }
    case 'question':
    case 'excl': {
      ctx.fillStyle = '#4a5fbf';
      ctx.font = 'bold 52px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind === 'question' ? '?' : '!', 0, 2);
      break;
    }
    case 'heart': {
      ctx.fillStyle = '#e0476c';
      ctx.beginPath();
      const sz = 16;
      ctx.moveTo(0, 10);
      ctx.bezierCurveTo(-sz, -6, -sz * 0.6, -16, 0, -6);
      ctx.bezierCurveTo(sz * 0.6, -16, sz, -6, 0, 10);
      ctx.fill();
      break;
    }
    case 'leaf': {
      ctx.fillStyle = '#4e9c46';
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 16, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2c5c28';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, 12);
      ctx.lineTo(8, -12);
      ctx.stroke();
      break;
    }
    case 'sparkle': {
      ctx.fillStyle = '#ffd54c';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 18 : 7;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'splash': {
      ctx.fillStyle = '#6fb7d9';
      ctx.beginPath();
      ctx.arc(0, 6, 13, Math.PI, 0);
      ctx.fill();
      for (const [dx, dy, r] of [
        [-14, -10, 4],
        [0, -16, 5],
        [14, -10, 4],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'grudge': {
      ctx.fillStyle = '#5a6b9c';
      ctx.beginPath();
      ctx.arc(-10, 0, 13, Math.PI * 0.1, Math.PI * 1.1, true);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(10, 0, 13, Math.PI * 1.9, Math.PI * 0.9);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

export class ThoughtBubble {
  sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private showT = 0;
  private showDur = 0;
  private kind: ThoughtKind | null = null;
  private phase = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 224;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: this.tex,
      transparent: true,
      depthTest: false,
      opacity: 0,
    });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(1.9, 1.66, 1);
    this.sprite.renderOrder = 20;
    this.sprite.visible = false;
  }

  show(kind: ThoughtKind, dur = 3.2) {
    this.kind = kind;
    this.showDur = dur;
    this.showT = 0;
    this.redraw();
    this.sprite.visible = true;
  }

  hide() {
    this.showT = this.showDur;
  }

  private redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 256, 224);
    if (!this.kind) return;
    // пузырь
    ctx.fillStyle = 'rgba(255,252,246,0.94)';
    ctx.strokeStyle = 'rgba(90,70,50,0.85)';
    ctx.lineWidth = 5;
    const bx = 38;
    const by = 14;
    const bw = 180;
    const bh = 132;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 34);
    ctx.fill();
    ctx.stroke();
    // хвостик
    ctx.beginPath();
    ctx.arc(128, 160, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(122, 184, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawIcon(ctx, this.kind, 128, 80, 60);
    this.tex.needsUpdate = true;
  }

  update(dt: number, bearPos: THREE.Vector3, headY: number) {
    if (!this.sprite.visible) return;
    this.showT += dt;
    this.phase += dt;
    const mat = this.sprite.material as THREE.SpriteMaterial;
    const fadeIn = Math.min(1, this.showT / 0.25);
    const fadeOut = Math.min(1, Math.max(0, (this.showDur - this.showT) / 0.35));
    mat.opacity = Math.min(fadeIn, fadeOut);
    this.sprite.position.set(bearPos.x, headY + 1.55 + Math.sin(this.phase * 2.2) * 0.05, bearPos.z);
    if (this.showT >= this.showDur) this.sprite.visible = false;
  }
}
