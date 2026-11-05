import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { ControlPanel } from './components/ControlPanel';
import { ModelScene, preloadModel } from './components/ModelScene';
import type { ArMode, CaptureFn } from './components/ModelScene';
import { StartScreen } from './components/StartScreen';
import { useCamera } from './hooks/useCamera';
import { useDeviceOrientation } from './hooks/useDeviceOrientation';
import type { OrientationStatus } from './hooks/useDeviceOrientation';
import { useGestures } from './hooks/useGestures';
import { ModelController } from './model/ModelController';
import { pickDefaultClip } from './utils/clipNames';
import { composePhoto, savePhoto } from './utils/photo';

const MODE_LABEL: Record<ArMode, string> = {
  xr: 'AR',
  gyro: 'Гироскоп',
  screen: 'Экран',
};

const GYRO_NOTE = 'Модель привязана к направлению, а не к полу: при ходьбе она будет смещаться.';
const XR_HINT = 'Наведите камеру на пол, дождитесь кольца и коснитесь экрана.';

export default function App() {
  const camera = useCamera();
  const orientation = useDeviceOrientation();
  const [controller] = useState(() => new ModelController());
  const appRef = useRef<HTMLDivElement>(null);
  const gestureLayer = useRef<HTMLDivElement>(null);
  const captureRef = useRef<CaptureFn | null>(null);

  const [clips, setClips] = useState<string[]>([]);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [dance, setDance] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [switching, setSwitching] = useState(false);

  // WebXR
  const [xrSupported, setXrSupported] = useState(false);
  const [xrSession, setXrSession] = useState<XRSession | null>(null);
  const [xrPlaced, setXrPlaced] = useState(false);
  const [xrResetToken, setXrResetToken] = useState(0);
  // Гироскоп
  const [gyroPlaced, setGyroPlaced] = useState(false);
  const [gyroRecenterToken, setGyroRecenterToken] = useState(0);

  // Режим выбирается автоматически: XR-сессия > датчики + задняя камера > «на экране».
  const mode: ArMode = xrSession
    ? 'xr'
    : orientation.status === 'active' && camera.facing === 'environment'
      ? 'gyro'
      : 'screen';
  const active = xrSession !== null || camera.status === 'active';
  const { active: loading, progress } = useProgress();

  useGestures(gestureLayer, controller, active, mode);

  // Только в dev: доступ к контроллеру для e2e-тестов.
  useEffect(() => {
    if (import.meta.env.DEV) window.__arDebug = controller;
  }, [controller]);

  useEffect(() => {
    controller.autoRotate = autoRotate;
  }, [controller, autoRotate]);
  useEffect(() => {
    controller.dance = dance;
  }, [controller, dance]);

  // Поддержка WebXR AR (Android Chrome + ARCore).
  useEffect(() => {
    let alive = true;
    navigator.xr
      ?.isSessionSupported('immersive-ar')
      .then((supported) => alive && setXrSupported(supported))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // В AR фон страницы должен быть прозрачным: dom-overlay рисуется поверх видео камеры.
  useEffect(() => {
    document.documentElement.classList.toggle('xr-active', xrSession !== null);
  }, [xrSession]);

  // Запрет системного масштабирования страницы жестами на iOS Safari +
  // тапы по кнопкам в AR не должны ставить модель (beforexrselect).
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    const blockXrSelect = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('button, .panel, .top-bar, .mode-badge')) {
        e.preventDefault();
      }
    };
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('dblclick', prevent);
    document.addEventListener('beforexrselect', blockXrSelect);
    return () => {
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('dblclick', prevent);
      document.removeEventListener('beforexrselect', blockXrSelect);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200 + toast.length * 35);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** Обычный старт: видео-камера + (на телефонах) датчики ориентации. */
  const handleStart = useCallback(() => {
    preloadModel();
    const wantGyro =
      window.matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window;
    // Оба запроса стартуют синхронно в обработчике тапа: iOS требует жест для requestPermission.
    const orientationPromise: Promise<OrientationStatus> = wantGyro
      ? orientation.request()
      : Promise.resolve('off');
    const cameraPromise = camera.start(wantGyro ? 'environment' : 'user');
    setGyroPlaced(false);
    void Promise.all([orientationPromise, cameraPromise]).then(([status]) => {
      if (!wantGyro) return;
      if (status === 'denied') {
        setToast('Доступ к датчикам движения отклонён: модель закреплена на экране');
      } else if (status === 'unavailable') {
        setToast('Датчики ориентации недоступны: модель закреплена на экране');
      }
    });
  }, [camera, orientation]);

  /** Старт WebXR immersive-ar (только по тапу). */
  const handleStartXr = useCallback(() => {
    preloadModel();
    const xr = navigator.xr;
    const root = appRef.current;
    if (!xr || !root) return;
    xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['anchors', 'dom-overlay'],
      domOverlay: { root },
    })
      .then((session) => {
        camera.stop();
        orientation.stop();
        controller.reset();
        setXrPlaced(false);
        session.addEventListener('end', () => {
          setXrSession(null);
          setXrPlaced(false);
        });
        setXrSession(session);
      })
      .catch((err: unknown) => {
        console.warn('WebXR не запустился:', err);
        setToast('AR не запустился, включаю обычный режим');
        handleStart();
      });
  }, [camera, orientation, controller, handleStart]);

  const handleExitXr = useCallback(() => {
    void xrSession?.end();
  }, [xrSession]);

  const handleClipsLoaded = useCallback((names: string[]) => {
    setClips(names);
    setActiveClip((current) => current ?? pickDefaultClip(names));
  }, []);

  const handleModelError = useCallback(() => {
    setToast('Модель не найдена, показываю заглушку');
  }, []);

  const handleReset = useCallback(() => {
    setAutoRotate(false);
    controller.reset();
  }, [controller]);

  const handleXrPlaced = useCallback(() => setXrPlaced(true), []);

  const handleSwitch = useCallback(async () => {
    if (camera.cameraCount <= 1) {
      setToast('Доступна только одна камера');
      return;
    }
    setSwitching(true);
    const ok = await camera.switchCamera();
    setSwitching(false);
    if (!ok) setToast('Не удалось переключить камеру');
    else if (orientation.status === 'active' && camera.facing === 'environment') {
      setToast('Фронтальная камера: модель закреплена на экране');
    }
  }, [camera, orientation.status]);

  const handlePhoto = useCallback(async () => {
    const video = camera.videoRef.current;
    const capture = captureRef.current;
    if (!video || !capture) return;
    try {
      // Рендер и чтение canvas в одной задаче: буфер ещё не очищен.
      const blob = await composePhoto(video, capture(), camera.mirrored);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 180);
      const result = await savePhoto(blob);
      if (result === 'downloaded') setToast('Фото сохранено');
    } catch (err) {
      console.error(err);
      setToast('Не удалось сделать фото');
    }
  }, [camera]);

  // Кнопка размещения и подсказка для текущего режима.
  let anchorAction: { label: string; onClick: () => void; primary?: boolean } | null = null;
  let note: string | null = null;
  if (mode === 'xr') {
    if (xrPlaced) {
      anchorAction = {
        label: 'Переставить',
        onClick: () => {
          setXrPlaced(false);
          setXrResetToken((t) => t + 1);
        },
      };
    } else {
      note = XR_HINT;
    }
  } else if (mode === 'gyro') {
    anchorAction = gyroPlaced
      ? { label: 'Центрировать', onClick: () => setGyroRecenterToken((t) => t + 1) }
      : {
          label: 'Поставить модель',
          primary: true,
          onClick: () => {
            setGyroPlaced(true);
            setGyroRecenterToken((t) => t + 1);
          },
        };
    note = GYRO_NOTE;
  }

  return (
    <div className={`app${xrSession ? ' is-xr' : ''}`} ref={appRef}>
      <video
        ref={camera.videoRef}
        className={`camera-video${camera.mirrored ? ' is-mirrored' : ''}${active && !xrSession ? '' : ' is-hidden'}`}
        autoPlay
        playsInline
        muted
        data-testid="camera-video"
      />

      {active && (
        <>
          <div ref={gestureLayer} className="gesture-layer" data-testid="gesture-layer">
            <ModelScene
              mode={mode}
              controller={controller}
              activeClip={activeClip}
              paused={paused}
              onClipsLoaded={handleClipsLoaded}
              onModelError={handleModelError}
              captureRef={captureRef}
              videoRef={camera.videoRef}
              orientation={orientation.sample}
              gyroPlaced={gyroPlaced}
              gyroRecenterToken={gyroRecenterToken}
              xrSession={xrSession}
              xrPlaced={xrPlaced}
              onXrPlaced={handleXrPlaced}
              xrResetToken={xrResetToken}
            />
          </div>

          <div className={`mode-badge mode-${mode}`} data-testid="mode-badge" aria-label={`Режим: ${MODE_LABEL[mode]}`}>
            {MODE_LABEL[mode]}
          </div>

          <div className="top-bar">
            {xrSession ? (
              <button
                type="button"
                className="round-btn"
                onClick={handleExitXr}
                aria-label="Выйти из AR"
                title="Выйти из AR"
                data-testid="exit-xr"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="round-btn"
                  onClick={handleSwitch}
                  disabled={switching}
                  aria-label="Переключить камеру"
                  title="Переключить камеру"
                  data-testid="switch-camera"
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <path d="M9 13a3 3 0 0 1 5-2.2M15 13a3 3 0 0 1-5 2.2M14 9v2h-2M10 17v-2h2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="round-btn shutter"
                  onClick={handlePhoto}
                  aria-label="Сделать фото"
                  title="Сделать фото"
                  data-testid="take-photo"
                >
                  <span className="shutter-dot" />
                </button>
              </>
            )}
          </div>

          {loading && (
            <div className="loading" role="status">
              Загрузка модели… {Math.round(progress)}%
            </div>
          )}

          <ControlPanel
            controller={controller}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((v) => !v)}
            autoRotate={autoRotate}
            onToggleAutoRotate={() => setAutoRotate((v) => !v)}
            onReset={handleReset}
            clips={clips}
            activeClip={activeClip}
            onSelectClip={(name) => {
              setActiveClip(name);
              setPaused(false);
            }}
            paused={paused}
            onTogglePaused={() => setPaused((v) => !v)}
            dance={dance}
            onToggleDance={() => setDance((v) => !v)}
            anchorAction={anchorAction}
            note={note}
          />
        </>
      )}

      {!active && (
        <StartScreen
          status={camera.status}
          error={camera.error}
          xrSupported={xrSupported}
          onStart={handleStart}
          onStartXr={handleStartXr}
        />
      )}

      {flash && <div className="flash" />}
      {toast && (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
