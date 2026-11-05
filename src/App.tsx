import { useCallback, useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { ControlPanel } from './components/ControlPanel';
import { ModelScene, preloadModel } from './components/ModelScene';
import type { CaptureFn } from './components/ModelScene';
import { StartScreen } from './components/StartScreen';
import { useCamera } from './hooks/useCamera';
import { useGestures } from './hooks/useGestures';
import { ModelController } from './model/ModelController';
import { pickDefaultClip } from './utils/clipNames';
import { composePhoto, savePhoto } from './utils/photo';

export default function App() {
  const camera = useCamera();
  const [controller] = useState(() => new ModelController());
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

  const active = camera.status === 'active';
  const { active: loading, progress } = useProgress();

  useGestures(gestureLayer, controller, active);

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

  // Запрет системного масштабирования страницы жестами на iOS Safari.
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('dblclick', prevent);
    return () => {
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('dblclick', prevent);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleStart = useCallback(() => {
    preloadModel();
    void camera.start();
  }, [camera]);

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

  const handleSwitch = useCallback(async () => {
    if (camera.cameraCount <= 1) {
      setToast('Доступна только одна камера');
      return;
    }
    setSwitching(true);
    const ok = await camera.switchCamera();
    setSwitching(false);
    if (!ok) setToast('Не удалось переключить камеру');
  }, [camera]);

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

  return (
    <div className="app">
      <video
        ref={camera.videoRef}
        className={`camera-video${camera.mirrored ? ' is-mirrored' : ''}${active ? '' : ' is-hidden'}`}
        autoPlay
        playsInline
        muted
        data-testid="camera-video"
      />

      {active && (
        <>
          <div ref={gestureLayer} className="gesture-layer" data-testid="gesture-layer">
            <ModelScene
              controller={controller}
              activeClip={activeClip}
              paused={paused}
              onClipsLoaded={handleClipsLoaded}
              onModelError={handleModelError}
              captureRef={captureRef}
            />
          </div>

          <div className="top-bar">
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
          />
        </>
      )}

      {!active && (
        <StartScreen status={camera.status} error={camera.error} onStart={handleStart} />
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
