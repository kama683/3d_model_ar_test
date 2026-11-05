import type { Profile, TripResult } from '../game/state';
import { LikeIcon } from './Hud';

interface StartProps {
  arSupported: boolean | null;
  profile: Profile;
  error: string | null;
  onStartAr: () => void;
  onStartSim: () => void;
}

export function StartScreen({ arSupported, profile, error, onStartAr, onStartSim }: StartProps) {
  return (
    <div className="screen start" data-testid="start-screen">
      <div className="card">
        <div className="logo" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round">
            <path d="M4 40l14-22 8 12 6-8 12 18z" />
            <rect x="19" y="6" width="10" height="9" rx="1.5" />
          </svg>
        </div>
        <h1>Груз</h1>
        <p className="lead">Возьмите груз на Старте, донесите его до Финиша и получите Лайки.</p>

        <div className="stats" data-testid="profile">
          <span><LikeIcon size={16} /> {profile.likes}</span>
          <span>Доставок: {profile.deliveries}</span>
          <span>Лайки отданы: {profile.likesGiven}</span>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        {arSupported ? (
          <>
            <button type="button" className="btn btn-primary btn-wide" onClick={onStartAr} data-testid="start-ar">
              Войти в AR
            </button>
            <button type="button" className="btn btn-ghost btn-wide" onClick={onStartSim} data-testid="start-sim">
              Симуляция
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-wide"
              onClick={onStartSim}
              disabled={arSupported === null}
              data-testid="start-sim"
            >
              {arSupported === null ? 'Проверяем устройство…' : 'Начать симуляцию'}
            </button>
            {arSupported === false && (
              <p className="small">
                AR (WebXR) на этом устройстве недоступен. Нужен Android Chrome с «Google Play Services for AR».
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ResultProps {
  result: TripResult;
  profile: Profile;
  onNewOrder: () => void;
  onChangePoints: () => void;
}

function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

export function ResultScreen({ result, profile, onNewOrder, onChangePoints }: ResultProps) {
  return (
    <div className="screen result" data-testid="result">
      <div className="card">
        <p className="eyebrow">Груз доставлен</p>
        <div className="reward" data-testid="reward">
          +{result.likesEarned} <LikeIcon size={30} />
        </div>
        <dl className="result-grid">
          <dt>Качество</dt>
          <dd>{Math.round(result.quality)}%</dd>
          <dt>Время</dt>
          <dd>{formatTime(result.time)}</dd>
          <dt>Пройдено</dt>
          <dd>{result.distance.toFixed(1)} м</dd>
          <dt>За качество</dt>
          <dd>+{result.base}</dd>
          <dt>За скорость</dt>
          <dd>+{result.bonus}</dd>
          <dt>Всего Лайков</dt>
          <dd>{profile.likes}</dd>
          <dt>Лайки отданы</dt>
          <dd>{profile.likesGiven}</dd>
        </dl>
        <button type="button" className="btn btn-primary btn-wide" onClick={onNewOrder} data-testid="new-order">
          Новый заказ
        </button>
        <button type="button" className="btn btn-ghost btn-wide" onClick={onChangePoints} data-testid="change-points">
          Поменять точки
        </button>
      </div>
    </div>
  );
}
