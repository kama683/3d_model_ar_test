import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import type { ErrorInfo, MutableRefObject, ReactNode, RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import {
  Box3,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  RingGeometry,
  SkinnedMesh,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ANIMATION_CROSSFADE,
  CAMERA_FOV,
  CAMERA_Z,
  GYRO_DISTANCE,
  GYRO_MODEL_HEIGHT,
  GYRO_SMOOTHING,
  MAX_DPR,
  MODEL_BASE_Y,
  MODEL_MAX_WIDTH_FRACTION,
  MODEL_TARGET_HEIGHT,
  MODEL_URL,
  REAR_CAMERA_FOV_LONG_SIDE,
  VISIBLE_HEIGHT,
  XR_MODEL_HEIGHT,
} from '../config';
import type { OrientationSample } from '../hooks/useDeviceOrientation';
import type { ModelController } from '../model/ModelController';
import { disposeObject } from '../utils/dispose';

export type CaptureFn = () => HTMLCanvasElement;

/**
 * screen: модель приклеена к экрану (десктоп / нет датчиков)
 * gyro:   камера three.js вращается по датчикам, модель стоит в мире
 * xr:     WebXR immersive-ar: hit-test + anchor
 */
export type ArMode = 'screen' | 'gyro' | 'xr';

interface ModelSceneProps {
  mode: ArMode;
  controller: ModelController;
  activeClip: string | null;
  paused: boolean;
  onClipsLoaded: (names: string[]) => void;
  onModelError: () => void;
  captureRef: MutableRefObject<CaptureFn | null>;
  videoRef: RefObject<HTMLVideoElement>;
  // gyro
  orientation: MutableRefObject<OrientationSample>;
  gyroPlaced: boolean;
  gyroRecenterToken: number;
  // xr
  xrSession: XRSession | null;
  xrPlaced: boolean;
  onXrPlaced: () => void;
  xrResetToken: number;
}

const MODEL_HEIGHT: Record<ArMode, number> = {
  screen: MODEL_TARGET_HEIGHT,
  gyro: GYRO_MODEL_HEIGHT,
  xr: XR_MODEL_HEIGHT,
};

export function ModelScene(props: ModelSceneProps) {
  const { mode, controller, captureRef, onModelError } = props;
  const height = MODEL_HEIGHT[mode];

  return (
    <Canvas
      className="scene-canvas"
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, MAX_DPR]}
      camera={{ fov: CAMERA_FOV, position: [0, 0, CAMERA_Z], near: 0.05, far: 100 }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      style={{ touchAction: 'none' }}
    >
      <hemisphereLight args={['#ffffff', '#5a5040', 0.9]} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} />
      <SoftEnvironment />
      <CaptureBridge captureRef={captureRef} />
      <CameraDriver
        mode={mode}
        orientation={props.orientation}
        gyroPlaced={props.gyroPlaced}
        recenterToken={props.gyroRecenterToken}
        videoRef={props.videoRef}
      />

      {/* Один и тот же элемент во всех режимах: модель не перемонтируется при смене режима. */}
      <Placement
        mode={mode}
        height={height}
        session={props.xrSession}
        placed={props.xrPlaced}
        onPlaced={props.onXrPlaced}
        resetToken={props.xrResetToken}
      >
        <Rig controller={controller} height={height}>
          <ModelErrorBoundary onError={onModelError} fallback={<PlaceholderModel height={height} />}>
            <Suspense fallback={null}>
              <GltfModel
                targetHeight={height}
                fitWidth={mode === 'screen'}
                activeClip={props.activeClip}
                paused={props.paused}
                onClipsLoaded={props.onClipsLoaded}
              />
            </Suspense>
          </ModelErrorBoundary>
        </Rig>
      </Placement>
    </Canvas>
  );
}

/* ------------------------------------------------------------------ */
/* Камера: фиксированная (screen), по датчикам (gyro), XR сам управляет */
/* ------------------------------------------------------------------ */

const Y_AXIS = new Vector3(0, 1, 0);

/** Курс (yaw) взгляда камеры: угол направления «вперёд» в горизонтальной плоскости. */
function yawOf(q: Quaternion): number {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-forward.x, -forward.z);
}

/** Вертикальный FOV, при котором three.js совпадает с видео, растянутым через object-fit: cover. */
function matchVideoFov(video: HTMLVideoElement | null, width: number, height: number): number {
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  if (!vw || !vh || !width || !height) return 60;
  const focal = Math.max(vw, vh) / 2 / Math.tan(((REAR_CAMERA_FOV_LONG_SIDE / 2) * Math.PI) / 180);
  const cover = Math.max(width / vw, height / vh);
  const visibleVideoHeight = height / cover;
  return (2 * Math.atan(visibleVideoHeight / 2 / focal) * 180) / Math.PI;
}

function CameraDriver({
  mode,
  orientation,
  gyroPlaced,
  recenterToken,
  videoRef,
}: {
  mode: ArMode;
  orientation: MutableRefObject<OrientationSample>;
  gyroPlaced: boolean;
  recenterToken: number;
  videoRef: RefObject<HTMLVideoElement>;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const yawOffset = useRef(0);
  const recenterPending = useRef(false);
  const target = useRef(new Quaternion());
  const initialized = useRef(false);

  // Возврат в обычный режим: камера снова неподвижна в (0, 0, 5).
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    if (mode === 'gyro') {
      camera.position.set(0, 0, 0);
      initialized.current = false;
    } else if (mode === 'screen') {
      camera.position.set(0, 0, CAMERA_Z);
      camera.quaternion.identity();
      camera.fov = CAMERA_FOV;
      camera.updateProjectionMatrix();
    }
  }, [camera, mode]);

  useEffect(() => {
    recenterPending.current = true;
  }, [recenterToken]);

  useFrame((_, rawDt) => {
    if (mode !== 'gyro' || !(camera instanceof PerspectiveCamera)) return;
    const dt = Math.min(rawDt, 0.1);

    const fov = matchVideoFov(videoRef.current, size.width, size.height);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const sample = orientation.current;
    if (!sample.hasData) return;
    const deviceYaw = yawOf(sample.quaternion);
    // Пока модель не поставлена, она «едет» за взглядом по горизонтали.
    // «Поставить» / «Центрировать»: текущий курс становится нулевым, модель оказывается прямо перед камерой.
    if (!gyroPlaced || recenterPending.current) {
      yawOffset.current = deviceYaw;
      recenterPending.current = false;
    }
    target.current
      .setFromAxisAngle(Y_AXIS, -yawOffset.current)
      .multiply(sample.quaternion);

    if (!initialized.current) {
      camera.quaternion.copy(target.current);
      initialized.current = true;
    } else {
      camera.quaternion.slerp(target.current, 1 - Math.exp(-GYRO_SMOOTHING * dt));
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Размещение модели в мире                                            */
/* ------------------------------------------------------------------ */

interface PlacementProps {
  mode: ArMode;
  height: number;
  session: XRSession | null;
  placed: boolean;
  onPlaced: () => void;
  resetToken: number;
  children: ReactNode;
}

/** XR-ресурсы после завершения сессии бросают InvalidStateError: это не ошибка приложения. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // сессия уже закрыта
  }
}

const tmpPos = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3(1, 1, 1);
const tmpCam = new Vector3();

function Placement({ mode, height, session, placed, onPlaced, resetToken, children }: PlacementProps) {
  const gl = useThree((s) => s.gl);
  const group = useRef<Group>(null);
  const reticle = useRef<Mesh>(null);
  const hitSource = useRef<XRHitTestSource | null>(null);
  const anchor = useRef<XRAnchor | null>(null);
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;
  // Кольцо в плоскости XZ (поверхность из hit-test: Y смотрит вверх).
  const reticleGeometry = useMemo(() => new RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), []);
  useEffect(() => () => reticleGeometry.dispose(), [reticleGeometry]);

  // Только в dev: экранные координаты (NDC) точки модели, для e2e-тестов привязки к миру.
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__arModelNdc = () => {
      const g = group.current;
      if (!g) return null;
      const v = g.getWorldPosition(new Vector3()).project(camera);
      return { x: v.x, y: v.y };
    };
  }, [camera]);

  // screen / gyro: фиксированная точка в мире
  useEffect(() => {
    const g = group.current;
    if (!g || mode === 'xr') return;
    g.matrixAutoUpdate = true;
    g.visible = true;
    g.quaternion.identity();
    if (mode === 'gyro') g.position.set(0, -height / 2, -GYRO_DISTANCE);
    else g.position.set(0, MODEL_BASE_Y, 0);
  }, [mode, height]);

  // xr: сессия, hit-test, тап для размещения, anchor
  useEffect(() => {
    if (mode !== 'xr' || !session) return;
    const g = group.current;
    if (g) {
      g.matrixAutoUpdate = false;
      g.visible = false;
    }
    let cancelled = false;

    gl.xr.enabled = true;
    gl.xr.setReferenceSpaceType('local');
    void gl.xr
      .setSession(session)
      .then(async () => {
        const viewer = await session.requestReferenceSpace('viewer');
        const source = await session.requestHitTestSource?.({ space: viewer });
        if (cancelled) source?.cancel();
        else hitSource.current = source ?? null;
      })
      .catch((err: unknown) => console.error('WebXR: не удалось запустить hit-test', err));

    const onSelect = (event: XRInputSourceEvent) => {
      if (placedRef.current) return;
      const source = hitSource.current;
      const refSpace = gl.xr.getReferenceSpace();
      const target = group.current;
      if (!source || !refSpace || !target) return;
      const hit = event.frame.getHitTestResults(source)[0];
      const pose = hit?.getPose(refSpace);
      if (!pose) return;

      // Позиция: точка на поверхности. Поворот: лицом к пользователю (только yaw).
      const p = pose.transform.position;
      tmpPos.set(p.x, p.y, p.z);
      gl.xr.getCamera().getWorldPosition(tmpCam);
      const yaw = Math.atan2(tmpCam.x - p.x, tmpCam.z - p.z);
      tmpQuat.setFromAxisAngle(Y_AXIS, yaw);
      target.matrix.compose(tmpPos, tmpQuat, tmpScale);
      target.matrixWorldNeedsUpdate = true;
      target.visible = true;
      placedRef.current = true;
      onPlacedRef.current();

      // Anchor стабилизирует позицию, когда ARCore уточняет карту окружения.
      const transform = new XRRigidTransform(
        { x: p.x, y: p.y, z: p.z },
        { x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w },
      );
      event.frame
        .createAnchor?.(transform, refSpace)
        ?.then((created) => {
          if (placedRef.current && !anchor.current) anchor.current = created;
          else created.delete();
        })
        .catch(() => undefined); // anchors: опциональная фича, без неё модель просто стоит в local-пространстве
    };

    session.addEventListener('select', onSelect);
    return () => {
      cancelled = true;
      session.removeEventListener('select', onSelect);
      safely(() => hitSource.current?.cancel());
      hitSource.current = null;
      safely(() => anchor.current?.delete());
      anchor.current = null;
    };
  }, [gl, mode, session]);

  // «Переставить»
  useEffect(() => {
    if (resetToken === 0) return;
    safely(() => anchor.current?.delete());
    anchor.current = null;
    if (group.current && mode === 'xr') group.current.visible = false;
  }, [resetToken, mode]);

  useFrame((_, __, frame) => {
    if (mode !== 'xr' || !frame) return;
    const refSpace = gl.xr.getReferenceSpace();
    const g = group.current;
    const r = reticle.current;
    if (!refSpace || !g || !r) return;

    if (!placedRef.current) {
      g.visible = false;
      const source = hitSource.current;
      const pose = source ? frame.getHitTestResults(source)[0]?.getPose(refSpace) : undefined;
      r.visible = Boolean(pose);
      if (pose) {
        r.matrix.fromArray(pose.transform.matrix);
        r.matrixWorldNeedsUpdate = true;
      }
      return;
    }

    r.visible = false;
    g.visible = true;
    const a = anchor.current;
    if (a && frame.trackedAnchors?.has(a)) {
      const pose = frame.getPose(a.anchorSpace, refSpace);
      if (pose) {
        g.matrix.fromArray(pose.transform.matrix);
        g.matrixWorldNeedsUpdate = true;
      }
    }
  });

  return (
    <>
      <mesh ref={reticle} geometry={reticleGeometry} matrixAutoUpdate={false} visible={false}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} />
      </mesh>
      <group ref={group}>{children}</group>
    </>
  );
}

/** Смещения от контроллера + процедурный танец. */
function Rig({
  controller,
  height,
  children,
}: {
  controller: ModelController;
  height: number;
  children: ReactNode;
}) {
  const rig = useRef<Group>(null);
  const dance = useRef<Group>(null);
  const danceState = useRef({ weight: 0, time: 0 });

  useFrame((_, rawDt) => {
    // Ограничиваем dt, чтобы после сворачивания вкладки модель не «прыгала».
    const dt = Math.min(rawDt, 0.1);
    controller.update(dt);
    const c = controller.current;
    // Смещения кнопок/жестов масштабируются под размер модели в текущем режиме.
    const unit = height / MODEL_TARGET_HEIGHT;
    const r = rig.current;
    if (r) {
      r.position.set(c.x * unit, c.y * unit, c.z * unit);
      r.rotation.set(0, c.rotY, 0);
      r.scale.setScalar(c.scale);
    }

    const d = danceState.current;
    d.weight = MathUtils.damp(d.weight, controller.dance ? 1 : 0, 4, dt);
    if (d.weight > 0.001) d.time += dt;
    else d.time = 0;
    const g = dance.current;
    if (g) {
      const w = d.weight;
      const t = d.time;
      g.position.set(
        w * Math.sin(t * 2.6) * 0.12 * height,
        w * Math.abs(Math.sin(t * 5.2)) * 0.15 * height,
        0,
      );
      g.rotation.set(
        w * Math.sin(t * 5.2) * 0.05,
        w * Math.sin(t * 1.3) * 0.9,
        w * Math.sin(t * 2.6) * 0.14,
      );
    }
  });

  return (
    <group ref={rig}>
      <group ref={dance}>{children}</group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Модель                                                              */
/* ------------------------------------------------------------------ */

/** Ограничивающий бокс поддерева в локальных координатах root (без учёта трансформации самого root). */
function computeLocalBox(root: Object3D): Box3 {
  root.updateWorldMatrix(true, true);
  const inverseRoot = new Matrix4().copy(root.matrixWorld).invert();
  const relative = new Matrix4();
  const box = new Box3();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const geometry = obj.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    relative.multiplyMatrices(inverseRoot, obj.matrixWorld);
    box.union(geometry.boundingBox.clone().applyMatrix4(relative));
  });
  return box;
}

interface GltfModelProps {
  targetHeight: number;
  /** Ограничить ширину долей экрана (только для режима «на экране»). */
  fitWidth: boolean;
  activeClip: string | null;
  paused: boolean;
  onClipsLoaded: (names: string[]) => void;
}

function GltfModel({ targetHeight, fitWidth, activeClip, paused, onClipsLoaded }: GltfModelProps) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const animRoot = useRef<Group>(null);
  const { actions, mixer, names } = useAnimations(animations, animRoot);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));

  // Бокс считаем один раз для модели.
  const box = useMemo(() => {
    scene.traverse((obj) => {
      if (obj instanceof SkinnedMesh) obj.frustumCulled = false;
    });
    return computeLocalBox(scene);
  }, [scene]);

  // Масштаб: заданная высота; в режиме «на экране» ещё и не шире 80% экрана.
  const { scale, offset } = useMemo(() => {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const byHeight = size.y > 0 ? targetHeight / size.y : 1;
    const footprint = Math.max(size.x, size.z);
    const maxWidth = VISIBLE_HEIGHT * aspect * MODEL_MAX_WIDTH_FRACTION;
    const byWidth = fitWidth && footprint > 0 ? maxWidth / footprint : Infinity;
    return {
      scale: Math.min(byHeight, byWidth),
      offset: new Vector3(-center.x, -box.min.y, -center.z),
    };
  }, [box, aspect, targetHeight, fitWidth]);

  useEffect(() => {
    onClipsLoaded(names);
  }, [names, onClipsLoaded]);

  // Плавный crossfade: новая анимация fadeIn, предыдущая fadeOut (в cleanup).
  useEffect(() => {
    if (!activeClip) return;
    const action = actions[activeClip];
    if (!action) return;
    action.reset().fadeIn(ANIMATION_CROSSFADE).play();
    return () => {
      action.fadeOut(ANIMATION_CROSSFADE);
    };
  }, [activeClip, actions]);

  useEffect(() => {
    mixer.timeScale = paused ? 0 : 1;
  }, [paused, mixer]);

  // Освобождаем GPU-ресурсы модели при размонтировании.
  useEffect(() => {
    return () => {
      mixer.stopAllAction();
      disposeObject(scene);
      useGLTF.clear(MODEL_URL);
    };
  }, [scene, mixer]);

  return (
    <group scale={scale}>
      <group ref={animRoot}>
        <primitive object={scene} position={offset} />
      </group>
    </group>
  );
}

/** Заглушка, если модель не загрузилась (или её ещё нет в public/models). */
function PlaceholderModel({ height }: { height: number }) {
  const h = height;
  return (
    <group>
      <mesh position={[0, h * 0.35, 0]}>
        <boxGeometry args={[h * 0.6, h * 0.7, h * 0.6]} />
        <meshStandardMaterial color="#6c8cff" roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, h * 0.85, 0]}>
        <sphereGeometry args={[h * 0.15, 32, 16]} />
        <meshStandardMaterial color="#ffcc4d" roughness={0.3} />
      </mesh>
    </group>
  );
}

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}

class ModelErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('Модель не загрузилась, показываю заглушку:', error.message, info.componentStack);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* Окружение и фото                                                    */
/* ------------------------------------------------------------------ */

/** Мягкое окружение без внешних HDR-файлов: генерируется локально из RoomEnvironment. */
function SoftEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.7;
    return () => {
      scene.environment = null;
      env.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Даёт снаружи функцию «отрендерить кадр и вернуть canvas» для фото (без preserveDrawingBuffer). */
function CaptureBridge({ captureRef }: { captureRef: MutableRefObject<CaptureFn | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement;
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, scene, camera, captureRef]);
  return null;
}

export function preloadModel(): void {
  useGLTF.preload(MODEL_URL);
}
