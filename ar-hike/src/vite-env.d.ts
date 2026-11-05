/// <reference types="vite/client" />
import type { Vec2 } from './game/state';
import type { GameStore } from './game/store';

declare global {
  interface Window {
    /** Только в dev: для e2e-тестов. */
    __store?: GameStore;
    __sim?: {
      walkTo: (x: number, z: number) => Promise<void>;
      screenOf: (x: number, z: number) => { x: number; y: number };
      player: () => Vec2;
    };
  }
}
