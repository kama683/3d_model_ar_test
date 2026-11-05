import {
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Object3D,
  Scene,
  Sprite,
  Vector3,
} from 'three';
import { VISUAL } from '../config';
import type { GameState, Phase, Vec2 } from '../game/state';
import { BenchObject, Burst, Cargo, COLORS, Guide, Station } from './objects';

/** Что World знает об игроке: где он стоит и где держит груз (зависит от режима). */
export interface PlayerView {
  /** Точка на полу под игроком. */
  floor: Vector3;
  /** Где висит груз во время переноски. */
  hold: Vector3;
}

type CargoAnim =
  | { kind: 'hidden' }
  | { kind: 'pickup'; t: number }
  | { kind: 'held' }
  | { kind: 'deliver'; t: number; from: Vector3 };

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Падение с отскоком. */
const easeOutBounce = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/**
 * Игровой мир в three.js: одинаковый для AR и симуляции.
 * Ничего не решает сам: только отображает GameState и проигрывает анимации на смене фаз.
 */
export class World {
  readonly root = new Group();
  private readonly stationA = new Station(COLORS.start, 'Старт A');
  private readonly stationB = new Station(COLORS.finish, 'Финиш B');
  private readonly cargo = new Cargo();
  private readonly guide = new Guide();
  private readonly burst = new Burst();
  private readonly benches = new Map<string, BenchObject>();
  private readonly lights: Group = new Group();
  private cargoAnim: CargoAnim = { kind: 'hidden' };
  private prevPhase: Phase = 'idle';
  private time = 0;
  /** Высота пола (в AR берётся из hit-test, в симуляции 0). */
  floorY = 0;

  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  private readonly labelScale: number;

  constructor(scene: Scene, options: { labelScale?: number } = {}) {
    this.labelScale = options.labelScale ?? 1;
    const hemi = new HemisphereLight('#ffffff', '#3f3a33', 1.1);
    const sun = new DirectionalLight('#ffffff', 1.4);
    sun.position.set(2, 5, 3);
    this.lights.add(hemi, sun);
    this.root.add(
      this.lights,
      this.stationA.group,
      this.stationB.group,
      this.cargo.group,
      this.guide.group,
      this.burst.points,
    );
    scene.add(this.root);
    [this.stationA.group, this.stationB.group, this.cargo.group].forEach((g) => this.scaleLabels(g));
  }

  /** Увеличить подписи (спрайты) в поддереве: симуляцию смотрят издалека. */
  private scaleLabels(root: Object3D): void {
    if (this.labelScale === 1) return;
    root.traverse((o) => {
      if (o instanceof Sprite) {
        o.scale.multiplyScalar(this.labelScale);
        o.position.y += 0.1 * (this.labelScale - 1);
      }
    });
  }

  /** Перевод точки пола (x, z) в 3D. */
  toWorld(p: Vec2, target = new Vector3()): Vector3 {
    return target.set(p.x, this.floorY, p.z);
  }

  update(dt: number, state: GameState, player: PlayerView): void {
    this.time += dt;
    this.syncStations(dt, state);
    this.syncBenches(dt, state);
    this.handlePhaseChange(state);
    this.updateCargo(dt, state, player);
    this.updateGuide(dt, state, player);
    this.burst.update(dt);
    this.prevPhase = state.phase;
  }

  private syncStations(dt: number, s: GameState): void {
    const place = (station: Station, pos: Vec2 | null, active: boolean) => {
      station.group.visible = pos !== null;
      if (pos) this.toWorld(pos, station.group.position);
      station.update(dt, active);
    };
    place(this.stationA, s.stationA, s.phase === 'toStart');
    place(this.stationB, s.stationB, s.phase === 'carrying');
  }

  private syncBenches(dt: number, s: GameState): void {
    const alive = new Set(s.benches.map((b) => b.id));
    for (const [id, obj] of this.benches) {
      if (!alive.has(id)) {
        this.root.remove(obj.group);
        obj.dispose();
        this.benches.delete(id);
      }
    }
    for (const b of s.benches) {
      let obj = this.benches.get(b.id);
      if (!obj) {
        obj = new BenchObject();
        this.scaleLabels(obj.group);
        this.benches.set(b.id, obj);
        this.root.add(obj.group);
      }
      this.toWorld(b.pos, obj.group.position);
      obj.update(dt, b.thanked);
    }
  }

  private handlePhaseChange(s: GameState): void {
    if (s.phase === this.prevPhase) return;
    if (this.prevPhase === 'toStart' && s.phase === 'carrying') {
      this.cargoAnim = { kind: 'pickup', t: 0 };
    } else if (this.prevPhase === 'carrying' && s.phase === 'result') {
      this.cargoAnim = { kind: 'deliver', t: 0, from: this.cargo.group.position.clone() };
    } else if (s.phase !== 'carrying') {
      this.cargoAnim = { kind: 'hidden' };
    }
  }

  private updateCargo(dt: number, s: GameState, player: PlayerView): void {
    const g = this.cargo.group;
    if (s.trip) this.cargo.setQuality(s.trip.quality);
    const anim = this.cargoAnim;

    switch (anim.kind) {
      case 'hidden':
        g.visible = false;
        return;

      case 'pickup': {
        // 1) ящик падает с высоты на станцию A, 2) взлетает к игроку
        anim.t += dt;
        const dropTime = VISUAL.pickupAnimation * 0.5;
        const flyTime = VISUAL.pickupAnimation - dropTime;
        const top = this.stationA.topPosition(this.tmpA);
        g.visible = true;
        if (anim.t < dropTime) {
          const k = easeOutBounce(anim.t / dropTime);
          g.position.set(top.x, MathUtils.lerp(top.y + 1.2, top.y, k), top.z);
          g.rotation.set(0, anim.t * 3, 0);
        } else {
          const k = easeInOutCubic(Math.min(1, (anim.t - dropTime) / flyTime));
          g.position.lerpVectors(top, player.hold, k);
          g.position.y += Math.sin(k * Math.PI) * 0.35; // дуга
          g.rotation.set(0, anim.t * 3, 0);
          if (k >= 1) this.cargoAnim = { kind: 'held' };
        }
        return;
      }

      case 'held': {
        g.visible = true;
        // Следует за игроком с небольшим запаздыванием и покачиванием
        g.position.lerp(player.hold, 1 - Math.exp(-14 * dt));
        g.position.y += Math.sin(this.time * 2.2) * 0.0015;
        g.rotation.y += dt * 0.6;
        return;
      }

      case 'deliver': {
        anim.t += dt;
        const k = easeOutCubic(Math.min(1, anim.t / VISUAL.deliveryAnimation));
        const top = this.stationB.topPosition(this.tmpB);
        g.visible = true;
        g.position.lerpVectors(anim.from, top, k);
        g.position.y += Math.sin(k * Math.PI) * 0.4;
        g.rotation.y += dt * 8;
        g.scale.setScalar(1 - 0.6 * k);
        if (k >= 1) {
          this.burst.fire(top, COLORS.cargo);
          g.scale.setScalar(1);
          this.cargoAnim = { kind: 'hidden' };
        }
        return;
      }
    }
  }

  private updateGuide(dt: number, s: GameState, player: PlayerView): void {
    const target = s.phase === 'toStart' ? s.stationA : s.phase === 'carrying' ? s.stationB : null;
    const color = s.phase === 'toStart' ? COLORS.start : COLORS.finish;
    this.guide.update(dt, target ? player.floor : null, target ? this.toWorld(target, this.tmpA) : null, color);
  }

  dispose(): void {
    this.stationA.dispose();
    this.stationB.dispose();
    this.cargo.dispose();
    this.guide.dispose();
    this.burst.dispose();
    this.benches.forEach((b) => b.dispose());
    this.benches.clear();
    this.root.removeFromParent();
  }
}
