/** Процедурные 3D-объекты игры: станции, груз, скамейки, подсказка пути, частицы. */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import { VISUAL } from '../config';
import { Label } from './label';

export const COLORS = {
  start: '#4ade80',
  finish: '#fb923c',
  bench: '#c08457',
  cargo: '#facc15',
  guide: '#e5e7eb',
} as const;

/** Станция: светящийся цилиндр + кольцо на полу + подпись. */
export class Station {
  readonly group = new Group();
  private readonly core: Mesh<CylinderGeometry, MeshStandardMaterial>;
  private readonly glow: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly label: Label;
  private time = Math.random() * 10;

  constructor(color: string, text: string) {
    const h = VISUAL.stationHeight;
    const r = VISUAL.stationRadius;
    this.core = new Mesh(
      new CylinderGeometry(r, r, h, 32, 1, true),
      new MeshStandardMaterial({
        color,
        emissive: new Color(color),
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
      }),
    );
    this.core.position.y = h / 2;

    this.glow = new Mesh(
      new CylinderGeometry(r * 2.2, r * 2.2, h, 32, 1, true),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.glow.position.y = h / 2;

    this.ring = new Mesh(
      new RingGeometry(0.85, 1.0, 64).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.ring.position.y = 0.005;

    this.label = new Label(text, color, 0.14);
    this.label.sprite.position.y = h + 0.2;

    this.group.add(this.core, this.glow, this.ring, this.label.sprite);
    this.group.visible = false;
  }

  /** Верх станции: сюда падает груз и сюда его сдают. */
  topPosition(target: Vector3): Vector3 {
    return target.copy(this.group.position).setY(this.group.position.y + VISUAL.stationHeight + 0.05);
  }

  update(dt: number, active: boolean): void {
    this.time += dt;
    const pulse = active ? 0.5 + 0.5 * Math.sin(this.time * 4) : 0.3;
    this.core.material.emissiveIntensity = 0.6 + pulse * 0.8;
    this.glow.material.opacity = 0.1 + pulse * 0.2;
    this.ring.material.opacity = active ? 0.35 + pulse * 0.45 : 0.25;
    this.ring.scale.setScalar(active ? 1 + 0.04 * Math.sin(this.time * 4) : 1);
  }

  dispose(): void {
    this.core.geometry.dispose();
    this.core.material.dispose();
    this.glow.geometry.dispose();
    this.glow.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.label.dispose();
  }
}

/** Груз: светящийся ящик с рёбрами и подписью качества. */
export class Cargo {
  readonly group = new Group();
  private readonly box: Mesh<BoxGeometry, MeshStandardMaterial>;
  private readonly edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  readonly label: Label;

  constructor() {
    const s = VISUAL.cargoSize;
    const geometry = new BoxGeometry(s, s, s);
    this.box = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: '#a16207',
        emissive: new Color(COLORS.cargo),
        emissiveIntensity: 0.35,
        roughness: 0.6,
      }),
    );
    this.edges = new LineSegments(
      new EdgesGeometry(geometry),
      new LineBasicMaterial({ color: COLORS.cargo, transparent: true, opacity: 0.95 }),
    );
    this.label = new Label('100%', COLORS.cargo, 0.06);
    this.label.sprite.position.y = s * 0.5 + 0.06;
    this.group.add(this.box, this.edges, this.label.sprite);
    this.group.visible = false;
  }

  /** Цвет свечения по качеству: жёлтый → оранжевый ближе к 80%. */
  setQuality(quality: number): void {
    this.label.setText(`${Math.round(quality)}%`);
    const t = Math.min(1, Math.max(0, (quality - 80) / 20));
    this.box.material.emissive.setRGB(0.98, 0.45 + 0.35 * t, 0.08 * t);
  }

  dispose(): void {
    this.box.geometry.dispose();
    this.box.material.dispose();
    this.edges.geometry.dispose();
    this.edges.material.dispose();
    this.label.dispose();
  }
}

/** Скамейка: сиденье, спинка, ножки + кольцо, пока волонтёров не поблагодарили. */
export class BenchObject {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly label: Label;
  private readonly wood = new MeshStandardMaterial({ color: COLORS.bench, roughness: 0.8 });
  private readonly metal = new MeshStandardMaterial({ color: '#4b5563', roughness: 0.5, metalness: 0.4 });
  private time = 0;

  constructor() {
    const add = (geo: BoxGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      this.meshes.push(m);
      this.group.add(m);
    };
    add(new BoxGeometry(0.9, 0.05, 0.32), this.wood, 0, 0.42, 0); // сиденье
    add(new BoxGeometry(0.9, 0.2, 0.04), this.wood, 0, 0.62, -0.15); // спинка
    for (const x of [-0.38, 0.38]) {
      for (const z of [-0.12, 0.12]) add(new BoxGeometry(0.04, 0.42, 0.04), this.metal, x, 0.21, z);
    }
    this.ring = new Mesh(
      new RingGeometry(0.55, 0.62, 48).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: COLORS.bench, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }),
    );
    this.ring.position.y = 0.005;
    this.label = new Label('Скамейка', '#f5d0a9', 0.1);
    this.label.sprite.position.y = 0.95;
    this.group.add(this.ring, this.label.sprite);
  }

  update(dt: number, thanked: boolean): void {
    this.time += dt;
    this.ring.visible = !thanked;
    this.ring.material.opacity = 0.35 + 0.3 * Math.sin(this.time * 3);
    this.label.setText(thanked ? 'Скамейка ✓' : 'Скамейка');
  }

  dispose(): void {
    this.meshes.forEach((m) => m.geometry.dispose());
    this.wood.dispose();
    this.metal.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.label.dispose();
  }
}

/** Подсказка пути: пунктир по полу от игрока к цели + стрелка над целью. */
export class Guide {
  readonly group = new Group();
  private readonly line: Line<BufferGeometry, LineDashedMaterial>;
  private readonly arrow: Mesh<ConeGeometry, MeshBasicMaterial>;
  private time = 0;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    this.line = new Line(
      geometry,
      new LineDashedMaterial({ color: COLORS.guide, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 }),
    );
    this.arrow = new Mesh(
      new ConeGeometry(0.07, 0.16, 16).rotateX(Math.PI),
      new MeshBasicMaterial({ color: COLORS.guide }),
    );
    this.group.add(this.line, this.arrow);
    this.group.visible = false;
  }

  update(dt: number, from: Vector3 | null, to: Vector3 | null, color: string): void {
    this.group.visible = Boolean(from && to);
    if (!from || !to) return;
    this.time += dt;
    const pos = this.line.geometry.getAttribute('position') as BufferAttribute;
    pos.setXYZ(0, from.x, from.y + 0.01, from.z);
    pos.setXYZ(1, to.x, to.y + 0.01, to.z);
    pos.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
    this.line.computeLineDistances();
    this.line.material.color.set(color);
    this.arrow.material.color.set(color);
    this.arrow.position.set(to.x, to.y + VISUAL.stationHeight + 0.55 + 0.06 * Math.sin(this.time * 4), to.z);
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.arrow.geometry.dispose();
    this.arrow.material.dispose();
  }
}

/** Вспышка частиц при доставке. */
export class Burst {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  private readonly velocities: Float32Array;
  private age = Infinity;
  private static readonly COUNT = 90;
  private static readonly LIFE = 1.1;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(Burst.COUNT * 3), 3));
    this.velocities = new Float32Array(Burst.COUNT * 3);
    this.points = new Points(
      geometry,
      new PointsMaterial({
        color: COLORS.cargo,
        size: 0.035,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.visible = false;
    this.points.frustumCulled = false;
  }

  fire(at: Vector3, color: string): void {
    const pos = this.points.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < Burst.COUNT; i++) {
      pos.setXYZ(i, at.x, at.y, at.z);
      const theta = Math.random() * Math.PI * 2;
      const up = 0.6 + Math.random() * 1.6;
      const out = 0.4 + Math.random() * 0.9;
      this.velocities.set([Math.cos(theta) * out, up, Math.sin(theta) * out], i * 3);
    }
    pos.needsUpdate = true;
    this.points.material.color.set(color);
    this.age = 0;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (this.age > Burst.LIFE) {
      this.points.visible = false;
      return;
    }
    this.age += dt;
    const pos = this.points.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < Burst.COUNT; i++) {
      this.velocities[i * 3 + 1] -= 2.5 * dt; // гравитация
      pos.setXYZ(
        i,
        pos.getX(i) + this.velocities[i * 3] * dt,
        pos.getY(i) + this.velocities[i * 3 + 1] * dt,
        pos.getZ(i) + this.velocities[i * 3 + 2] * dt,
      );
    }
    pos.needsUpdate = true;
    this.points.material.opacity = Math.max(0, 1 - this.age / Burst.LIFE);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
