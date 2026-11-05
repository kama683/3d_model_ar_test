import { useCallback, useEffect, useRef, useState } from 'react';
import { Euler, Quaternion, Vector3 } from 'three';
import { ORIENTATION_TIMEOUT_MS } from '../config';

export type OrientationStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unavailable';

/** Последний кватернион устройства в мировых координатах three.js (Y вверх, -Z: «вперёд» при нулевом alpha). */
export interface OrientationSample {
  quaternion: Quaternion;
  hasData: boolean;
}

interface PermissionAwareOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

const DEG = Math.PI / 180;
const Z_AXIS = new Vector3(0, 0, 1);
/** Поворот -90° вокруг X: камера смотрит из «задней» стороны телефона, а не вверх. */
const Q_MINUS_90_X = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/**
 * Перевод alpha/beta/gamma (в градусах) и угла экрана в кватернион камеры,
 * как в three.js DeviceOrientationControls.
 */
export function orientationToQuaternion(
  target: Quaternion,
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle: number,
): Quaternion {
  const euler = new Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  target.setFromEuler(euler);
  target.multiply(Q_MINUS_90_X);
  target.multiply(new Quaternion().setFromAxisAngle(Z_AXIS, -screenAngle * DEG));
  return target;
}

function screenAngle(): number {
  return screen.orientation?.angle ?? 0;
}

/**
 * Датчики ориентации. request() нужно вызывать прямо в обработчике тапа:
 * на iOS DeviceOrientationEvent.requestPermission() работает только по жесту пользователя.
 * На Android, если доступно, слушаем deviceorientationabsolute (привязка к компасу, меньше дрейфа).
 */
export function useDeviceOrientation() {
  const sample = useRef<OrientationSample>({ quaternion: new Quaternion(), hasData: false });
  const [status, setStatus] = useState<OrientationStatus>('off');
  const detachRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
    sample.current.hasData = false;
  }, []);

  const request = useCallback(async (): Promise<OrientationStatus> => {
    stop();
    const Ctor = window.DeviceOrientationEvent as (typeof DeviceOrientationEvent & PermissionAwareOrientationEvent) | undefined;
    if (!Ctor) {
      setStatus('unavailable');
      return 'unavailable';
    }
    setStatus('requesting');

    // iOS 13+: разрешение. Вызов идёт синхронно в рамках жеста (до любых await выше).
    if (typeof Ctor.requestPermission === 'function') {
      try {
        const result = await Ctor.requestPermission();
        if (result !== 'granted') {
          setStatus('denied');
          return 'denied';
        }
      } catch {
        setStatus('denied');
        return 'denied';
      }
    }

    const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    let resolveFirst: (() => void) | null = null;
    const firstData = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const onOrientation = (e: Event) => {
      const { alpha, beta, gamma } = e as DeviceOrientationEvent;
      if (alpha === null || beta === null || gamma === null) return;
      orientationToQuaternion(sample.current.quaternion, alpha, beta, gamma, screenAngle());
      sample.current.hasData = true;
      resolveFirst?.();
    };
    window.addEventListener(eventName, onOrientation);
    detachRef.current = () => window.removeEventListener(eventName, onOrientation);

    // Десктопы часто «поддерживают» событие, но не присылают данных: ждём первое значение.
    const gotData = await Promise.race([
      firstData.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), ORIENTATION_TIMEOUT_MS)),
    ]);
    if (!gotData) {
      stop();
      setStatus('unavailable');
      return 'unavailable';
    }
    setStatus('active');
    return 'active';
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { sample, status, request, stop };
}
