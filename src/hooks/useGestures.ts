import { useEffect } from 'react';
import {
  CAMERA_FOV,
  CAMERA_Z,
  GYRO_DISTANCE,
  GYRO_MODEL_HEIGHT,
  MODEL_TARGET_HEIGHT,
  XR_DRAG_METERS_PER_PIXEL,
  XR_MODEL_HEIGHT,
} from '../config';
import type { ArMode } from '../components/ModelScene';
import type { ModelController } from '../model/ModelController';

interface Point {
  x: number;
  y: number;
}

/**
 * Жесты по экрану:
 *  - один палец / ЛКМ: перетаскивание модели
 *  - два пальца: pinch (масштаб), поворот, перенос средней точкой
 *  - колёсико мыши: масштаб
 */
export function useGestures(
  element: React.RefObject<HTMLElement>,
  controller: ModelController,
  enabled: boolean,
  mode: ArMode,
): void {
  useEffect(() => {
    const el = element.current;
    if (!el || !enabled) return;

    const pointers = new Map<number, Point>();
    let lastSingle: Point | null = null;
    let lastPair: { mid: Point; dist: number; angle: number } | null = null;

    /**
     * Сколько единиц контроллера в одном CSS-пикселе. Контроллер работает в единицах режима «на экране»,
     * а Rig масштабирует их под высоту модели текущего режима (unit).
     */
    const worldPerPixel = (): number => {
      if (mode === 'xr') return XR_DRAG_METERS_PER_PIXEL / (XR_MODEL_HEIGHT / MODEL_TARGET_HEIGHT);
      const unit = mode === 'gyro' ? GYRO_MODEL_HEIGHT / MODEL_TARGET_HEIGHT : 1;
      const baseDepth = mode === 'gyro' ? GYRO_DISTANCE : CAMERA_Z;
      const fov = mode === 'gyro' ? 60 : CAMERA_FOV;
      const depth = Math.max(0.3, baseDepth - controller.current.z * unit);
      const visible = 2 * depth * Math.tan(((fov / 2) * Math.PI) / 180);
      return visible / Math.max(1, el.clientHeight) / unit;
    };

    const pairInfo = () => {
      const [a, b] = [...pointers.values()];
      return {
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    };

    /** Пересчитать «опорные» значения при смене числа пальцев, чтобы не было скачков. */
    const rebase = () => {
      lastSingle = pointers.size === 1 ? { ...[...pointers.values()][0] } : null;
      lastPair = pointers.size >= 2 ? pairInfo() : null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      rebase();
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const k = worldPerPixel();

      if (pointers.size === 1 && lastSingle) {
        const p = pointers.get(e.pointerId)!;
        const dx = (p.x - lastSingle.x) * k;
        const dy = (p.y - lastSingle.y) * k;
        // В AR модель стоит на полу: вертикальный свайп двигает ближе/дальше, а не вверх.
        if (mode === 'xr') controller.translate(dx, 0, dy);
        else controller.translate(dx, -dy);
        lastSingle = { ...p };
      } else if (pointers.size >= 2 && lastPair) {
        const now = pairInfo();
        if (lastPair.dist > 0 && now.dist > 0) controller.scaleBy(now.dist / lastPair.dist);
        let dAngle = now.angle - lastPair.angle;
        if (dAngle > Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        controller.rotateBy(dAngle);
        if (mode !== 'xr') {
          controller.translate((now.mid.x - lastPair.mid.x) * k, -(now.mid.y - lastPair.mid.y) * k);
        }
        lastPair = now;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      rebase();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Нормализуем deltaMode (строки/страницы) к пикселям
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      controller.scaleBy(Math.exp(-delta * 0.0015));
    };

    const preventDefault = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', preventDefault);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', preventDefault);
    };
  }, [element, controller, enabled, mode]);
}
