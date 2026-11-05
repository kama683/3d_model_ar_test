import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import type { ErrorInfo, MutableRefObject, ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import {
  Box3,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  PMREMGenerator,
  SkinnedMesh,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ANIMATION_CROSSFADE,
  CAMERA_FOV,
  CAMERA_Z,
  MAX_DPR,
  MODEL_BASE_Y,
  MODEL_MAX_WIDTH_FRACTION,
  MODEL_TARGET_HEIGHT,
  MODEL_URL,
  VISIBLE_HEIGHT,
} from '../config';
import type { ModelController } from '../model/ModelController';
import { disposeObject } from '../utils/dispose';

export type CaptureFn = () => HTMLCanvasElement;

interface ModelSceneProps {
  controller: ModelController;
  activeClip: string | null;
  paused: boolean;
  onClipsLoaded: (names: string[]) => void;
  onModelError: () => void;
  captureRef: MutableRefObject<CaptureFn | null>;
}

export function ModelScene(props: ModelSceneProps) {
  const { controller, captureRef, onModelError } = props;
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

      <Rig controller={controller}>
        <ModelErrorBoundary onError={onModelError} fallback={<PlaceholderModel />}>
          <Suspense fallback={null}>
            <GltfModel
              activeClip={props.activeClip}
              paused={props.paused}
              onClipsLoaded={props.onClipsLoaded}
            />
          </Suspense>
        </ModelErrorBoundary>
      </Rig>
    </Canvas>
  );
}

/** Внешняя группа: позиция/поворот/масштаб из контроллера + процедурный танец. */
function Rig({ controller, children }: { controller: ModelController; children: ReactNode }) {
  const rig = useRef<Group>(null);
  const dance = useRef<Group>(null);
  const danceState = useRef({ weight: 0, time: 0 });

  useFrame((_, rawDt) => {
    // Ограничиваем dt, чтобы после сворачивания вкладки модель не «прыгала».
    const dt = Math.min(rawDt, 0.1);
    controller.update(dt);
    const c = controller.current;
    const r = rig.current;
    if (r) {
      r.position.set(c.x, MODEL_BASE_Y + c.y, c.z);
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
      const h = MODEL_TARGET_HEIGHT;
      g.position.set(
        w * Math.sin(t * 2.6) * 0.12 * h,
        w * Math.abs(Math.sin(t * 5.2)) * 0.15 * h,
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
    <group ref={rig} position={[0, MODEL_BASE_Y, 0]}>
      <group ref={dance}>{children}</group>
    </group>
  );
}

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
  activeClip: string | null;
  paused: boolean;
  onClipsLoaded: (names: string[]) => void;
}

function GltfModel({ activeClip, paused, onClipsLoaded }: GltfModelProps) {
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

  // Масштаб: ~40% высоты экрана, но не шире 80% ширины (важно для портретного телефона).
  const { scale, offset } = useMemo(() => {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const byHeight = size.y > 0 ? MODEL_TARGET_HEIGHT / size.y : 1;
    const maxWidth = VISIBLE_HEIGHT * aspect * MODEL_MAX_WIDTH_FRACTION;
    const footprint = Math.max(size.x, size.z);
    const byWidth = footprint > 0 ? maxWidth / footprint : byHeight;
    return {
      scale: Math.min(byHeight, byWidth),
      offset: new Vector3(-center.x, -box.min.y, -center.z),
    };
  }, [box, aspect]);

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
function PlaceholderModel() {
  const h = MODEL_TARGET_HEIGHT;
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
