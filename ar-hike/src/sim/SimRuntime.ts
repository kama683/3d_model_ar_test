import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { SIM } from '../config';
import type { Vec2 } from '../game/state';
import type { GameStore } from '../game/store';
import type { GameRuntime } from '../runtime';
import { World } from '../scene/World';

/** Направление движения от клавиатуры/джойстика, в осях комнаты (x вправо, z к зрителю). */
export interface MoveInput {
  x: number;
  z: number;
}

/**
 * Режим-симуляция: комната сверху-сбоку, аватар игрока, WASD / джойстик.
 * Клик по полу заменяет тап в AR. Логика та же: в store уходит только позиция игрока в метрах.
 */
export class SimRuntime implements GameRuntime {
  readonly mode = 'sim' as const;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 0.05, 100);
  private readonly world: World;
  private readonly avatar = new Group();
  private readonly reticle: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly raycaster = new Raycaster();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly keys = new Set<string>();
  private joystick: MoveInput = { x: 0, z: 0 };
  /** Автоходьба к точке (для автотестов и отладки). */
  private autoWalk: { target: Vec2; resolve: () => void } | null = null;
  private facing = 0;
  private lastTime = performance.now();
  private calibrationLeft: number = SIM.calibrationDelay;
  private pointerDown: { x: number; y: number } | null = null;
  private hover: Vector3 | null = null;
  private frameId = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    readonly store: GameStore,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color('#101216');
    // Камера симуляции далеко (5–10 м), поэтому подписи крупнее, чем в AR.
    this.world = new World(this.scene, { labelScale: 2.4 });
    this.buildRoom();
    this.reticle = new Mesh(
      new RingGeometry(0.08, 0.11, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
    );
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.disposables.push(this.reticle.geometry, this.reticle.material);

    // Игрок стартует в центре комнаты, у «входа».
    this.avatar.position.set(0, 0, SIM.roomDepth / 2 - 0.8);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    store.startCalibration();
    this.syncPlayer();
    this.frameId = requestAnimationFrame(this.loop);

    if (import.meta.env.DEV) {
      window.__sim = {
        walkTo: (x, z) => this.walkTo({ x, z }),
        screenOf: (x, z) => this.screenOf(new Vector3(x, 0, z)),
        player: () => this.store.getPlayer(),
      };
    }
  }

  setJoystick(input: MoveInput): void {
    this.joystick = input;
  }

  placeBench(): void {
    this.store.placeBench();
  }

  resetStations(): void {
    this.store.resetStations();
  }

  /** Идти к точке с обычной скоростью (честно копит время и путь). */
  walkTo(target: Vec2): Promise<void> {
    this.autoWalk?.resolve();
    return new Promise((resolve) => {
      this.autoWalk = { target, resolve };
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    this.autoWalk?.resolve();
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.world.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
    el.remove();
    if (import.meta.env.DEV) delete window.__sim;
  }

  /* ---------------- сцена ---------------- */

  private buildRoom(): void {
    const w = SIM.roomWidth;
    const d = SIM.roomDepth;
    const floorGeo = new PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const floorMat = new MeshStandardMaterial({ color: '#2a2d33', roughness: 0.95 });
    const floor = new Mesh(floorGeo, floorMat);
    const grid = new GridHelper(Math.max(w, d), Math.max(w, d) * 2, '#3b404a', '#30343c');
    grid.position.y = 0.002;
    this.scene.add(floor, grid);
    this.disposables.push(floorGeo, floorMat, grid.geometry);

    const wallMat = new MeshStandardMaterial({ color: '#3a3f48', roughness: 0.9 });
    const wallH = 0.6;
    const walls: [number, number, number, number][] = [
      [0, -d / 2, w, 0.08],
      [-w / 2, 0, 0.08, d],
      [w / 2, 0, 0.08, d],
    ];
    for (const [x, z, sx, sz] of walls) {
      const geo = new BoxGeometry(sx, wallH, sz);
      const m = new Mesh(geo, wallMat);
      m.position.set(x, wallH / 2, z);
      this.scene.add(m);
      this.disposables.push(geo);
    }
    // немного «мебели», чтобы ориентироваться
    const furniture: [number, number, number, number, number, string][] = [
      [-2.2, -1.6, 1.2, 0.75, 0.7, '#4b4037'], // стол
      [2.3, 1.4, 0.9, 0.45, 1.6, '#3c4a5a'], // диван
    ];
    for (const [x, z, sx, sy, sz, color] of furniture) {
      const geo = new BoxGeometry(sx, sy, sz);
      const mat = new MeshStandardMaterial({ color, roughness: 0.85 });
      const m = new Mesh(geo, mat);
      m.position.set(x, sy / 2, z);
      this.scene.add(m);
      this.disposables.push(geo, mat);
    }
    this.disposables.push(wallMat);

    // аватар: капсула + «нос», показывающий направление
    const bodyGeo = new CapsuleGeometry(0.18, 1.0, 6, 16);
    const bodyMat = new MeshStandardMaterial({ color: '#93c5fd', roughness: 0.5 });
    const body = new Mesh(bodyGeo, bodyMat);
    body.position.y = 0.68;
    const noseGeo = new ConeGeometry(0.07, 0.18, 12).rotateX(Math.PI / 2);
    const noseMat = new MeshStandardMaterial({ color: '#e0f2fe' });
    const nose = new Mesh(noseGeo, noseMat);
    nose.position.set(0, 1.05, -0.22);
    this.avatar.add(body, nose);
    this.scene.add(this.avatar);
    this.disposables.push(bodyGeo, bodyMat, noseGeo, noseMat);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // В портретной ориентации отодвигаем камеру, чтобы комната помещалась по ширине.
    this.camera.fov = w / h < 0.8 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- цикл ---------------- */

  private loop = (now: number) => {
    this.frameId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.store.getState().phase === 'calibrating') {
      this.calibrationLeft -= dt;
      if (this.calibrationLeft <= 0) this.store.floorFound();
    }

    this.move(dt);
    this.syncPlayer();
    this.store.update(dt);

    const p = this.avatar.position;
    const forward = new Vector3(Math.sin(this.facing), 0, -Math.cos(this.facing));
    const hold = p.clone().addScaledVector(forward, 0.35).setY(1.05);
    this.world.update(dt, this.store.getState(), { floor: p.clone().setY(0), hold });

    const phase = this.store.getState().phase;
    this.reticle.visible = (phase === 'placingA' || phase === 'placingB') && this.hover !== null;
    if (this.hover) this.reticle.position.copy(this.hover).setY(0.01);

    // Камера следует за игроком сверху-сзади (не вращается: так проще ориентироваться с WASD).
    // В портретной ориентации отъезжает дальше, чтобы комната помещалась по ширине.
    const zoom = this.camera.aspect < 1 ? Math.min(2.4, 0.95 / this.camera.aspect) : 1;
    const camTarget = new Vector3(p.x * 0.6, 0, p.z * 0.6);
    const desired = camTarget.clone().add(new Vector3(0, 5.2 * zoom, 4.6 * zoom));
    this.camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(camTarget.x, 0.3, camTarget.z - 0.4);

    this.renderer.render(this.scene, this.camera);
  };

  private move(dt: number): void {
    let x = this.joystick.x;
    let z = this.joystick.z;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    const p = this.avatar.position;
    if (this.autoWalk && x === 0 && z === 0) {
      const dx = this.autoWalk.target.x - p.x;
      const dz = this.autoWalk.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.03) {
        this.autoWalk.resolve();
        this.autoWalk = null;
      } else {
        x = dx / dist;
        z = dz / dist;
        const step = Math.min(dist, SIM.walkSpeed * dt);
        this.applyMove(x, z, step);
        return;
      }
    }

    const len = Math.hypot(x, z);
    if (len < 0.05) return;
    this.applyMove(x / len, z / len, SIM.walkSpeed * Math.min(1, len) * dt);
  }

  private applyMove(dirX: number, dirZ: number, step: number): void {
    const p = this.avatar.position;
    const hw = SIM.roomWidth / 2 - 0.25;
    const hd = SIM.roomDepth / 2 - 0.25;
    p.x = Math.min(hw, Math.max(-hw, p.x + dirX * step));
    p.z = Math.min(hd, Math.max(-hd, p.z + dirZ * step));
    this.facing = Math.atan2(dirX, -dirZ);
    this.avatar.rotation.y = -this.facing;
  }

  private syncPlayer(): void {
    const p = this.avatar.position;
    this.store.setPlayer({ x: p.x, z: p.z });
  }

  /* ---------------- ввод ---------------- */

  private floorPointAt(clientX: number, clientY: number): Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new Vector3());
    if (!hit) return null;
    const inside = Math.abs(hit.x) <= SIM.roomWidth / 2 && Math.abs(hit.z) <= SIM.roomDepth / 2;
    return inside ? hit : null;
  }

  private screenOf(p: Vector3): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent) => {
    this.hover = this.floorPointAt(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    const hit = this.floorPointAt(e.clientX, e.clientY);
    this.hover = hit;
    const phase = this.store.getState().phase;
    if (hit && (phase === 'placingA' || phase === 'placingB')) {
      this.store.placeStation({ x: hit.x, z: hit.z });
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
  };
}
