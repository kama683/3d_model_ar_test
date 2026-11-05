import type { GameStore } from './game/store';

export type GameMode = 'ar' | 'sim';

/**
 * Режим (AR или симуляция) снаружи выглядит одинаково: он сам двигает позицию игрока в store
 * и рисует мир. Через рантайм идут только действия, которым нужны якоря в пространстве.
 */
export interface GameRuntime {
  readonly mode: GameMode;
  readonly store: GameStore;
  /** Поставить скамейку под игроком (в AR ещё и создать anchor). */
  placeBench(): void;
  /** «Переставить»: сбросить станции (в AR ещё и удалить anchors). */
  resetStations(): void;
  /** Остановить цикл, освободить ресурсы, закрыть XR-сессию. */
  dispose(): void;
}
