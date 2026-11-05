import { useCallback, useEffect, useRef, useState } from 'react';

export type FacingMode = 'user' | 'environment';
export type CameraStatus = 'idle' | 'starting' | 'active' | 'error';

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: string | null;
  facing: FacingMode;
  /** true, если видео нужно зеркалить (фронтальная камера) */
  mirrored: boolean;
  cameraCount: number;
  start: (wanted?: FacingMode) => Promise<void>;
  switchCamera: () => Promise<boolean>;
  stop: () => void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Человекочитаемое сообщение об ошибке getUserMedia по-русски. */
export function describeCameraError(err: unknown): string {
  if (!window.isSecureContext) {
    return 'Камера работает только по защищённому соединению (HTTPS). Откройте сайт по ссылке https://…';
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Этот браузер не поддерживает доступ к камере. Попробуйте Safari на iPhone или Chrome на Android.';
  }
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Доступ к камере запрещён. Разрешите доступ в настройках браузера (значок замка/«аА» в адресной строке) и нажмите «Повторить».';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'Камера не найдена. Проверьте, что камера подключена и не отключена в системе.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Камера занята другим приложением или недоступна. Закройте другие приложения с камерой и повторите.';
    default:
      return 'Не удалось включить камеру. Попробуйте ещё раз.';
  }
}

async function requestStream(facing: FacingMode): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
}

export function useCamera(): CameraState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<FacingMode>('user');
  const [mirrored, setMirrored] = useState(true);
  const [cameraCount, setCameraCount] = useState(0);

  const attach = useCallback(async (stream: MediaStream, requested: FacingMode) => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // autoplay muted playsinline обычно не блокируется; если блокируется, видео стартует по следующему тапу
      }
    }
    const track = stream.getVideoTracks()[0];
    const actual = track?.getSettings().facingMode;
    const realFacing: FacingMode =
      actual === 'environment' || actual === 'user' ? actual : requested;
    setFacing(realFacing);
    setMirrored(realFacing === 'user');

    track?.addEventListener('ended', () => {
      if (streamRef.current !== stream) return;
      setStatus('error');
      setError('Камера отключилась. Нажмите «Повторить».');
    });

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraCount(devices.filter((d) => d.kind === 'videoinput').length);
    } catch {
      setCameraCount(1);
    }
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current++;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const startWith = useCallback(
    async (wanted: FacingMode): Promise<void> => {
      const id = ++requestIdRef.current;
      // iOS не умеет держать две камеры одновременно: старые треки останавливаем до запроса новых.
      stopStream(streamRef.current);
      streamRef.current = null;

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('insecure');
      }
      const stream = await requestStream(wanted);
      if (id !== requestIdRef.current) {
        stopStream(stream);
        return;
      }
      await attach(stream, wanted);
    },
    [attach],
  );

  /** @param wanted какую камеру открыть (по умолчанию текущую; в гироскоп-режиме: заднюю) */
  const start = useCallback(async (wanted?: FacingMode) => {
    setStatus('starting');
    setError(null);
    try {
      await startWith(wanted ?? facing);
      setStatus('active');
    } catch (err) {
      setStatus('error');
      setError(describeCameraError(err));
    }
  }, [facing, startWith]);

  /** Возвращает false, если переключиться не удалось (старая камера восстановлена). */
  const switchCamera = useCallback(async (): Promise<boolean> => {
    const previous = facing;
    const next: FacingMode = previous === 'user' ? 'environment' : 'user';
    try {
      await startWith(next);
      return true;
    } catch {
      try {
        await startWith(previous);
      } catch (err) {
        setStatus('error');
        setError(describeCameraError(err));
      }
      return false;
    }
  }, [facing, startWith]);

  // iOS ставит видео на паузу при сворачивании вкладки: возобновляем при возврате.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && videoRef.current?.srcObject) {
        videoRef.current.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Остановка камеры при размонтировании.
  useEffect(() => stop, [stop]);

  return { videoRef, status, error, facing, mirrored, cameraCount, start, switchCamera, stop };
}
