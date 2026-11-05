import { CONFIG } from '../config';
import * as G from '../game/state';
import type { GameSnapshot } from '../game/store';
import type { GameMode, GameRuntime } from '../runtime';

interface HudProps {
  snap: GameSnapshot;
  mode: GameMode;
  runtime: GameRuntime;
  onExit: () => void;
}

const WEATHER_TEXT: Record<G.WeatherKind, { icon: string; title: string }> = {
  heat: { icon: '☀️', title: 'Жара' },
  humidity: { icon: '💧', title: 'Влажность' },
};

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function hintFor(phase: G.Phase, mode: GameMode): string | null {
  const tap = mode === 'ar' ? 'Наведите кольцо на пол и коснитесь экрана' : 'Нажмите на пол';
  switch (phase) {
    case 'calibrating':
      return mode === 'ar' ? 'Медленно поводите телефоном над полом, чтобы найти поверхность' : 'Ищем пол…';
    case 'placingA':
      return `${tap}, чтобы поставить Старт (A)`;
    case 'placingB':
      return `${tap}, чтобы поставить Финиш (B), не ближе ${CONFIG.minStationDistance} м от Старта`;
    case 'toStart':
      return 'Подойдите к Старту (A) за грузом';
    case 'carrying':
      return 'Несите груз к Финишу (B)';
    default:
      return null;
  }
}

export function LikeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z" />
    </svg>
  );
}

export function Hud({ snap, mode, runtime, onExit }: HudProps) {
  const { state, player } = snap;
  const store = runtime.store;
  const trip = state.trip;
  const toTarget = G.distanceToTarget(state, player);
  const hint = hintFor(state.phase, mode);
  const bench = state.phase === 'carrying' ? G.benchToThank(state, player) : null;

  return (
    <div className="hud">
      {/* ---- верх ---- */}
      <div className="hud-top">
        <div className="hud-row">
          <span className={`mode-badge mode-${mode}`} data-testid="mode-badge">
            {mode === 'ar' ? 'AR' : 'Симуляция'}
          </span>
          <span className="chip likes" data-testid="likes" title="Лайки">
            <LikeIcon /> {state.profile.likes}
          </span>
          {toTarget !== null && (
            <span className="chip" data-testid="distance">
              {toTarget < CONFIG.interactRadius ? 'на месте' : `${toTarget.toFixed(1)} м`}
            </span>
          )}
          {trip && (
            <span className="chip mono" data-testid="timer">
              {formatTime(trip.time)}
            </span>
          )}
          <button type="button" className="icon-btn" onClick={onExit} aria-label="Выйти" title="Выйти" data-testid="exit">
            ✕
          </button>
        </div>

        {trip && (
          <div className="quality" data-testid="quality" aria-label={`Качество груза ${Math.round(trip.quality)}%`}>
            <div className="quality-label">
              <span>Качество груза</span>
              <span>
                {trip.protection > 0 && <span className="protect">🛡 {Math.ceil(trip.protection)} с · </span>}
                {Math.round(trip.quality)}%
              </span>
            </div>
            <div className="quality-track">
              {/* шкала 80–100%: ниже 80 груз не портится */}
              <div
                className="quality-fill"
                style={{ width: `${((trip.quality - CONFIG.decay.minQuality) / (100 - CONFIG.decay.minQuality)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {trip?.weather && (
          <div className="weather" role="alert" data-testid="weather">
            <span className="weather-icon">{WEATHER_TEXT[trip.weather.kind].icon}</span>
            <span>
              <b>{WEATHER_TEXT[trip.weather.kind].title}!</b> Обработайте груз спреем, иначе −{CONFIG.weather.penalty}%
            </span>
            <span className="weather-timer">{Math.ceil(trip.weather.remaining)} с</span>
          </div>
        )}

        {state.notice && (
          <div className={`notice notice-${state.notice.kind}`} role="status" data-testid="notice">
            {state.notice.text}
          </div>
        )}
      </div>

      {/* ---- низ ---- */}
      <div className="hud-bottom">
        {hint && <p className="hint" data-testid="hint">{hint}</p>}
        <div className="actions">
          {state.phase === 'toStart' && G.canPickup(state, player) && (
            <button type="button" className="btn btn-primary" onClick={store.pickup} data-testid="pickup">
              Получить груз
            </button>
          )}

          {state.phase === 'carrying' && (
            <>
              <button
                type="button"
                className={`btn${trip?.weather ? ' btn-alert' : ''}`}
                onClick={store.spray}
                disabled={!G.canSpray(state)}
                data-testid="spray"
              >
                Спрей <span className="cost">−{CONFIG.spray.cost} <LikeIcon size={14} /></span>
              </button>
              {G.canPlaceBench(state, player) && (
                <button type="button" className="btn" onClick={() => runtime.placeBench()} data-testid="place-bench">
                  Поставить скамейку
                </button>
              )}
              {bench && (
                <button
                  type="button"
                  className="btn"
                  onClick={store.thank}
                  disabled={!G.canThank(state, player)}
                  data-testid="thank"
                >
                  Поблагодарить волонтёров <span className="cost">−{CONFIG.bench.thankLikes} <LikeIcon size={14} /></span>
                </button>
              )}
              {G.canDeliver(state, player) && (
                <button type="button" className="btn btn-primary" onClick={store.deliver} data-testid="deliver">
                  Сдать груз
                </button>
              )}
            </>
          )}

          {G.canResetStations(state) && state.phase !== 'result' && (
            <button type="button" className="btn btn-ghost" onClick={() => runtime.resetStations()} data-testid="reset">
              Переставить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
