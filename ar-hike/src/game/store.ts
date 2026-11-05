import * as G from './state';
import type { GameState, Vec2 } from './state';
import { loadProfile, saveProfile } from './storage';

type Listener = () => void;

/** Снимок для UI: состояние + позиция игрока (от неё зависят расстояния и доступные кнопки). */
export interface GameSnapshot {
  state: GameState;
  player: Vec2;
}

/** Как часто (в секундах) HUD обновляется из-за хода времени и движения игрока. */
const UI_TICK_INTERVAL = 0.1;

/**
 * Обёртка над чистыми функциями state.ts: хранит текущее состояние и позицию игрока,
 * уведомляет React (useSyncExternalStore) и сохраняет профиль в localStorage.
 * Источник позиции (AR-камера или аватар симуляции) задаётся снаружи через setPlayer().
 */
export class GameStore {
  private state: GameState;
  private player: Vec2 = { x: 0, z: 0 };
  private snapshot: GameSnapshot;
  private listeners = new Set<Listener>();
  private sinceNotify = 0;

  constructor(private readonly random: () => number = Math.random) {
    this.state = G.createGame(loadProfile());
    this.snapshot = { state: this.state, player: this.player };
  }

  getState = (): GameState => this.state;
  getPlayer = (): Vec2 => this.player;
  getSnapshot = (): GameSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setPlayer(pos: Vec2): void {
    this.player = pos;
  }

  /** Вызывается каждый кадр из рендер-цикла (AR или симуляция). */
  update(dt: number): void {
    const prev = this.state;
    const next = G.tick(prev, dt, this.player, this.random);
    this.sinceNotify += dt;
    // Смена фазы, события погоды или заметки: сразу; остальное не чаще 10 раз в секунду.
    const important =
      next.phase !== prev.phase ||
      next.trip?.weather?.kind !== prev.trip?.weather?.kind ||
      next.notice?.text !== prev.notice?.text;
    this.commit(next, important || this.sinceNotify >= UI_TICK_INTERVAL);
  }

  // ---- действия игрока ----
  startCalibration = () => this.commit(G.startCalibration(this.state));
  floorFound = () => this.commit(G.floorFound(this.state));
  placeStation = (pos: Vec2) => this.commit(G.placeStation(this.state, pos));
  resetStations = () => this.commit(G.resetStations(this.state));
  pickup = () => this.commit(G.pickup(this.state, this.player, this.random));
  spray = () => this.commit(G.spray(this.state, this.random));
  placeBench = () => this.commit(G.placeBench(this.state, this.player));
  thank = () => this.commit(G.thankVolunteers(this.state, this.player));
  deliver = () => this.commit(G.deliver(this.state, this.player));
  newOrder = () => this.commit(G.newOrder(this.state));
  syncAnchors = (update: Parameters<typeof G.syncAnchoredPositions>[1]) => {
    this.state = G.syncAnchoredPositions(this.state, update);
  };

  private commit(next: GameState, notify = true): void {
    if (next.profile !== this.state.profile) saveProfile(next.profile);
    this.state = next;
    if (!notify) return;
    this.sinceNotify = 0;
    this.snapshot = { state: this.state, player: this.player };
    this.listeners.forEach((l) => l());
  }
}
