import { MathUtils } from 'three';
import {
  DAMPING,
  LIMITS,
  SCALE_MAX,
  SCALE_MIN,
  SPEED,
  STEP,
} from '../config';

export interface Transform {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

export type ModelAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'scaleUp'
  | 'scaleDown'
  | 'rotateLeft'
  | 'rotateRight';

const DEFAULT_TRANSFORM: Readonly<Transform> = { x: 0, y: 0, z: 0, rotY: 0, scale: 1 };

/**
 * Хранит целевое и текущее (сглаженное) состояние модели.
 * Кнопки и жесты меняют только target; current догоняет его в update() каждый кадр.
 * Обычный класс, а не React-состояние: значения меняются 60 раз в секунду, и ререндер не нужен.
 */
export class ModelController {
  readonly target: Transform = { ...DEFAULT_TRANSFORM };
  readonly current: Transform = { ...DEFAULT_TRANSFORM };
  autoRotate = false;
  dance = false;
  private readonly held = new Set<ModelAction>();

  /** Одиночный шаг (тап по кнопке). */
  step(action: ModelAction): void {
    this.apply(action, 1, true);
  }

  /** Начать непрерывное действие (удержание кнопки). */
  press(action: ModelAction): void {
    this.held.add(action);
  }

  release(action: ModelAction): void {
    this.held.delete(action);
  }

  releaseAll(): void {
    this.held.clear();
  }

  /** Сдвиг в мировых единицах (жест перетаскивания). */
  translate(dx: number, dy: number): void {
    this.target.x += dx;
    this.target.y += dy;
    this.clamp();
  }

  /** Умножить масштаб (pinch / колёсико). */
  scaleBy(factor: number): void {
    this.target.scale *= factor;
    this.clamp();
  }

  rotateBy(radians: number): void {
    this.target.rotY += radians;
  }

  reset(): void {
    this.releaseAll();
    // Сворачиваем накопленный угол, чтобы модель не крутилась назад на много оборотов.
    const wrapped = MathUtils.euclideanModulo(this.current.rotY + Math.PI, Math.PI * 2) - Math.PI;
    this.current.rotY = wrapped;
    Object.assign(this.target, DEFAULT_TRANSFORM);
  }

  /** Вызывается каждый кадр. */
  update(dt: number): void {
    for (const action of this.held) this.apply(action, dt, false);
    if (this.autoRotate) this.target.rotY += SPEED.autoRotate * dt;

    const c = this.current;
    const t = this.target;
    c.x = MathUtils.damp(c.x, t.x, DAMPING, dt);
    c.y = MathUtils.damp(c.y, t.y, DAMPING, dt);
    c.z = MathUtils.damp(c.z, t.z, DAMPING, dt);
    c.rotY = MathUtils.damp(c.rotY, t.rotY, DAMPING, dt);
    // Масштаб сглаживаем в логарифмическом пространстве, чтобы рост и уменьшение ощущались одинаково.
    c.scale = Math.exp(MathUtils.damp(Math.log(c.scale), Math.log(t.scale), DAMPING, dt));
  }

  /**
   * @param amount  для шага: 1, для удержания: dt в секундах
   * @param isStep  true: использовать STEP, false: SPEED * dt
   */
  private apply(action: ModelAction, amount: number, isStep: boolean): void {
    const move = isStep ? STEP.move : SPEED.move * amount;
    const rotate = isStep ? STEP.rotate : SPEED.rotate * amount;
    const scale = isStep ? STEP.scale : Math.exp(SPEED.scale * amount);
    const t = this.target;

    switch (action) {
      case 'forward':
        t.z += move;
        break;
      case 'back':
        t.z -= move;
        break;
      case 'left':
        t.x -= move;
        break;
      case 'right':
        t.x += move;
        break;
      case 'up':
        t.y += move;
        break;
      case 'down':
        t.y -= move;
        break;
      case 'scaleUp':
        t.scale *= scale;
        break;
      case 'scaleDown':
        t.scale /= scale;
        break;
      case 'rotateLeft':
        t.rotY -= rotate;
        break;
      case 'rotateRight':
        t.rotY += rotate;
        break;
    }
    this.clamp();
  }

  private clamp(): void {
    const t = this.target;
    t.x = MathUtils.clamp(t.x, -LIMITS.x, LIMITS.x);
    t.y = MathUtils.clamp(t.y, LIMITS.yMin, LIMITS.yMax);
    t.z = MathUtils.clamp(t.z, LIMITS.zMin, LIMITS.zMax);
    t.scale = MathUtils.clamp(t.scale, SCALE_MIN, SCALE_MAX);
  }
}
