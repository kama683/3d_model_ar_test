import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VISUAL } from './config';
import { GameStore } from './game/store';
import type { GameMode, GameRuntime } from './runtime';
import { SimRuntime } from './sim/SimRuntime';
import { Hud } from './ui/Hud';
import { Joystick } from './ui/Joystick';
import { ResultScreen, StartScreen } from './ui/Screens';
import { isArSupported, requestArSession, XRRuntime } from './xr/XRRuntime';

export default function App() {
  const [store] = useState(() => new GameStore());
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const appRef = useRef<HTMLDivElement>(null);
  const simContainer = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);

  const [mode, setMode] = useState<GameMode | null>(null);
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    let alive = true;
    void isArSupported().then((ok) => alive && setArSupported(ok));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) window.__store = store;
  }, [store]);

  // Симуляция: рантайм живёт, пока mode === 'sim'.
  useEffect(() => {
    if (mode !== 'sim' || !simContainer.current) return;
    const rt = new SimRuntime(simContainer.current, store);
    runtimeRef.current = rt;
    setRuntime(rt);
    return () => {
      rt.dispose();
      runtimeRef.current = null;
      setRuntime(null);
    };
  }, [mode, store]);

  // В AR-режиме фон страницы прозрачный (dom-overlay поверх камеры) и тапы по UI не должны ставить точки.
  useEffect(() => {
    document.documentElement.classList.toggle('xr-active', mode === 'ar');
    const block = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('button, .hud-top, .actions, .screen')) e.preventDefault();
    };
    document.addEventListener('beforexrselect', block);
    return () => document.removeEventListener('beforexrselect', block);
  }, [mode]);

  // Экран результата показываем после анимации доставки.
  useEffect(() => {
    if (snap.state.phase !== 'result') {
      setShowResult(false);
      return;
    }
    const id = window.setTimeout(() => setShowResult(true), VISUAL.deliveryAnimation * 1000 + 500);
    return () => window.clearTimeout(id);
  }, [snap.state.phase]);

  const startSim = useCallback(() => {
    setError(null);
    setMode('sim');
  }, []);

  const startAr = useCallback(() => {
    const root = appRef.current;
    if (!root) return;
    setError(null);
    // requestSession вызывается синхронно в обработчике тапа.
    requestArSession(root)
      .then((session) =>
        XRRuntime.create(session, store, () => {
          runtimeRef.current = null;
          setRuntime(null);
          setMode(null);
        }),
      )
      .then((rt) => {
        runtimeRef.current = rt;
        setRuntime(rt);
        setMode('ar');
      })
      .catch((err: unknown) => {
        console.warn('AR не запустился:', err);
        setError('Не удалось запустить AR. Проверьте, что установлены «Google Play Services for AR», или попробуйте симуляцию.');
      });
  }, [store]);

  const exit = useCallback(() => {
    if (mode === 'ar') runtimeRef.current?.dispose();
    runtimeRef.current = null;
    setRuntime(null);
    setMode(null);
  }, [mode]);

  const { state } = snap;

  return (
    <div className={`app${mode === 'ar' ? ' is-ar' : ''}`} ref={appRef}>
      {mode === 'sim' && <div className="sim-view" ref={simContainer} data-testid="sim-view" />}

      {runtime && mode && (
        <>
          <Hud snap={snap} mode={mode} runtime={runtime} onExit={exit} />
          {mode === 'sim' && runtime instanceof SimRuntime && isTouch && (
            <Joystick onChange={(input) => runtime.setJoystick(input)} />
          )}
        </>
      )}

      {runtime && showResult && state.result && (
        <ResultScreen
          result={state.result}
          profile={state.profile}
          onNewOrder={store.newOrder}
          onChangePoints={() => runtime.resetStations()}
        />
      )}

      {!mode && (
        <StartScreen
          arSupported={arSupported}
          profile={state.profile}
          error={error}
          onStartAr={startAr}
          onStartSim={startSim}
        />
      )}
    </div>
  );
}
