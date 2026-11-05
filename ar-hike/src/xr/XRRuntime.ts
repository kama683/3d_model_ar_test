import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { VISUAL } from '../config';
import type { Vec2 } from '../game/state';
import type { GameStore } from '../game/store';
import type { GameRuntime } from '../runtime';
import { World } from '../scene/World';
import { AnchorManager } from './anchors';

export async function isArSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-ar')) ?? false;
  } catch {
    return false;
  }
}

/**
 * Запросить AR-сессию. Вызывать синхронно из обработчика тапа (требование WebXR).
 * dom-overlay: HTML-интерфейс (overlayRoot) рисуется поверх камеры.
 */
export function requestArSession(overlayRoot: HTMLElement): Promise<XRSession> {
  const xr = navigator.xr;
  if (!xr) return Promise.reject(new Error('WebXR недоступен'));
  return xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['anchors', 'dom-overlay', 'local-floor'],
    domOverlay: { root: overlayRoot },
  });
}

/**
 * AR-режим (WebXR immersive-ar, Android Chrome + ARCore):
 *  - hit-test от камеры, reticle на найденной поверхности, первый hit = «пол найден»;
 *  - тап (select) ставит станции, они закрепляются anchors;
 *  - позиция игрока = позиция телефона, спроецированная на пол.
 */
export class XRRuntime implements GameRuntime {
  readonly mode = 'ar' as const;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.02, 50);
  private readonly world: World;
  private readonly anchors = new AnchorManager();
  private readonly reticle: Mesh<RingGeometry, MeshBasicMaterial>;
  private hitSource: XRHitTestSource | null = null;
  private lastHit: Vector3 | null = null;
  private lastTime = 0;
  private ended = false;
  private cleaned = false;

  private readonly viewerPos = new Vector3();
  private readonly viewerQuat = new Quaternion();
  private readonly hold = new Vector3();
  private readonly floor = new Vector3();

  private constructor(
    private readonly session: XRSession,
    readonly store: GameStore,
    private readonly onEnd: () => void,
  ) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;
    this.world = new World(this.scene);
    this.reticle = new Mesh(
      new RingGeometry(0.07, 0.095, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
    );
    this.reticle.visible = false;
    this.scene.add(this.reticle);
    session.addEventListener('end', this.handleEnd);
    session.addEventListener('select', this.handleSelect);
  }

  /** Поднять рантайм для уже открытой сессии. */
  static async create(session: XRSession, store: GameStore, onEnd: () => void): Promise<XRRuntime> {
    const rt = new XRRuntime(session, store, onEnd);
    // local-floor: y = 0 на уровне пола; если не дали, работаем в local (пол берём из hit-test).
    let spaceType: XRReferenceSpaceType = 'local';
    try {
      await session.requestReferenceSpace('local-floor');
      spaceType = 'local-floor';
    } catch {
      spaceType = 'local';
    }
    rt.renderer.xr.setReferenceSpaceType(spaceType);
    await rt.renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    rt.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;
    store.startCalibration();
    rt.renderer.setAnimationLoop(rt.onFrame);
    return rt;
  }

  placeBench(): void {
    const before = this.store.getState().benches.length;
    this.store.placeBench();
    const after = this.store.getState().benches;
    if (after.length > before) {
      const bench = after[after.length - 1];
      this.anchors.request(bench.id, this.world.toWorld(bench.pos));
    }
  }

  resetStations(): void {
    this.store.resetStations();
    this.anchors.clear();
  }

  dispose(): void {
    if (!this.ended) {
      this.ended = true;
      this.session.end().catch(() => undefined);
    }
    this.cleanup();
  }

  /* ---------------- кадр ---------------- */

  private onFrame = (time: number, frame?: XRFrame) => {
    if (!frame) return;
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    const space = this.renderer.xr.getReferenceSpace();
    if (!space) return;

    // 1. Hit-test: где пол под центром экрана.
    const hitPose = this.hitSource ? frame.getHitTestResults(this.hitSource)[0]?.getPose(space) : undefined;
    if (hitPose) {
      const p = hitPose.transform.position;
      this.lastHit = (this.lastHit ?? new Vector3()).set(p.x, p.y, p.z);
    } else {
      this.lastHit = null;
    }
    const phase = this.store.getState().phase;
    if (phase === 'calibrating' && this.lastHit) {
      this.world.floorY = this.lastHit.y;
      this.store.floorFound();
    }
    const placing = phase === 'placingA' || phase === 'placingB' || phase === 'calibrating';
    this.reticle.visible = placing && this.lastHit !== null;
    if (this.lastHit && hitPose) {
      this.reticle.position.copy(this.lastHit);
    }

    // 2. Игрок = телефон, спроецированный на пол.
    const viewer = frame.getViewerPose(space);
    if (viewer) {
      const { position: p, orientation: o } = viewer.transform;
      this.viewerPos.set(p.x, p.y, p.z);
      this.viewerQuat.set(o.x, o.y, o.z, o.w);
      this.store.setPlayer({ x: p.x, z: p.z });
    }

    // 3. Якоря уточняют позиции станций и скамеек.
    const anchored = this.anchors.process(frame, space);
    if (anchored.size > 0) {
      const toVec2 = (v: Vector3 | undefined): Vec2 | undefined => (v ? { x: v.x, z: v.z } : undefined);
      const benches: Record<string, Vec2> = {};
      for (const [id, v] of anchored) if (id.startsWith('bench-')) benches[id] = { x: v.x, z: v.z };
      this.store.syncAnchors({ A: toVec2(anchored.get('A')), B: toVec2(anchored.get('B')), benches });
      const a = anchored.get('A');
      if (a) this.world.floorY = a.y;
    }

    this.store.update(dt);

    // 4. Груз висит чуть впереди и ниже камеры.
    this.hold
      .set(0, -VISUAL.cargoHoldDown, -VISUAL.cargoHoldForward)
      .applyQuaternion(this.viewerQuat)
      .add(this.viewerPos);
    this.floor.set(this.viewerPos.x, this.world.floorY, this.viewerPos.z);
    this.world.update(dt, this.store.getState(), { floor: this.floor, hold: this.hold });

    this.renderer.render(this.scene, this.camera);
  };

  /** Тап по экрану (не по кнопкам: их отсекает beforexrselect). */
  private handleSelect = (event: XRInputSourceEvent) => {
    const hit = this.lastHit;
    const space = this.renderer.xr.getReferenceSpace();
    if (!hit || !space) return;
    const before = this.store.getState();
    if (before.phase !== 'placingA' && before.phase !== 'placingB') return;
    this.store.placeStation({ x: hit.x, z: hit.z });
    const after = this.store.getState();
    this.world.floorY = hit.y;
    if (before.phase === 'placingA' && after.stationA) this.anchors.createNow('A', hit, event.frame, space);
    if (before.phase === 'placingB' && after.stationB) this.anchors.createNow('B', hit, event.frame, space);
  };

  private handleEnd = () => {
    this.ended = true;
    this.cleanup();
    this.onEnd();
  };

  private cleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.renderer.setAnimationLoop(null);
    this.session.removeEventListener('end', this.handleEnd);
    this.session.removeEventListener('select', this.handleSelect);
    try {
      this.hitSource?.cancel();
    } catch {
      // сессия уже закрыта
    }
    this.hitSource = null;
    this.anchors.clear();
    this.world.dispose();
    this.reticle.geometry.dispose();
    this.reticle.material.dispose();
    this.renderer.dispose();
  }
}
