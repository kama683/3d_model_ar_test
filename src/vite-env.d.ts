/// <reference types="vite/client" />
import type { ModelController } from './model/ModelController';

declare global {
  interface Window {
    /** Только в dev-сборке, для e2e-тестов. */
    __arDebug?: ModelController;
  }
}
