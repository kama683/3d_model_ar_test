/// <reference types="vite/client" />
import type { ModelController } from './model/ModelController';

declare global {
  interface Window {
    /** Только в dev-сборке, для e2e-тестов. */
    __arDebug?: ModelController;
    /** Только в dev: экранные координаты точки, где стоит модель. */
    __arModelNdc?: () => { x: number; y: number } | null;
  }
}
