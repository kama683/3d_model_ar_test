import type { CameraStatus } from '../hooks/useCamera';

interface StartScreenProps {
  status: CameraStatus;
  error: string | null;
  /** WebXR immersive-ar поддерживается (Android Chrome + ARCore). */
  xrSupported: boolean;
  onStart: () => void;
  onStartXr: () => void;
}

export function StartScreen({ status, error, xrSupported, onStart, onStartXr }: StartScreenProps) {
  const starting = status === 'starting';
  const failed = status === 'error';

  return (
    <div className="start-screen" role="dialog" aria-labelledby="start-title">
      <div className="start-card">
        <div className="start-logo" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="56" height="56">
            <path d="M24 5l16 9v20l-16 9-16-9V14z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M8 14l16 9 16-9M24 23v20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 id="start-title">AR-фильтр</h1>
        {failed && error ? (
          <p className="start-error" role="alert">{error}</p>
        ) : (
          <p className="start-text">
            {xrSupported
              ? 'Ваше устройство поддерживает AR: модель можно поставить на пол, и она останется на месте.'
              : '3D-модель поверх изображения с камеры. Двигайте её кнопками или пальцами.'}
          </p>
        )}

        {xrSupported ? (
          <>
            <button className="btn-primary" onClick={onStartXr} disabled={starting} data-testid="start-xr">
              Запустить AR
            </button>
            <button className="btn-link" onClick={onStart} disabled={starting} data-testid="start-camera">
              {starting ? 'Запуск камеры…' : 'Без AR: камера + гироскоп'}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={onStart} disabled={starting} data-testid="start-camera">
            {starting ? 'Запуск камеры…' : failed ? 'Повторить' : 'Включить камеру'}
          </button>
        )}
      </div>
    </div>
  );
}
