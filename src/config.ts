/** Единое место для путей и настроек приложения. */

/** Имя файла модели в public/models/. Чтобы заменить модель, положите новый GLB с этим именем. */
export const MODEL_FILE_NAME = 'model.glb';
export const MODEL_URL = `${import.meta.env.BASE_URL}models/${MODEL_FILE_NAME}`;

/** Камера three.js */
export const CAMERA_FOV = 50;
export const CAMERA_Z = 5;
/** Видимая высота сцены в плоскости z = 0 (в мировых единицах). */
export const VISIBLE_HEIGHT = 2 * CAMERA_Z * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

/** Какую долю высоты экрана занимает модель после нормализации. */
export const MODEL_SCREEN_FRACTION = 0.4;
/** Максимальная доля ширины экрана (чтобы широкие модели не вылезали за край на телефоне). */
export const MODEL_MAX_WIDTH_FRACTION = 0.8;
/** Высота модели в мировых единицах при масштабе 1. */
export const MODEL_TARGET_HEIGHT = VISIBLE_HEIGHT * MODEL_SCREEN_FRACTION;
/**
 * Точка «пола», куда ставим модель ногами. Центр модели чуть выше центра экрана,
 * чтобы нижняя панель управления на телефоне не перекрывала основание.
 */
export const MODEL_CENTER_OFFSET = 0.08 * VISIBLE_HEIGHT;
export const MODEL_BASE_Y = -MODEL_TARGET_HEIGHT / 2 + MODEL_CENTER_OFFSET;

/** Ограничения трансформаций */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;
export const LIMITS = {
  x: 4,
  yMin: -3,
  yMax: 3,
  zMin: -8,
  zMax: 2.5,
} as const;

/** Шаг при одиночном тапе */
export const STEP = {
  move: 0.15,
  rotate: Math.PI / 12,
  scale: 1.1,
} as const;

/** Скорости при удержании кнопки (в секунду) */
export const SPEED = {
  move: 1.5,
  rotate: Math.PI,
  /** Логарифмическая скорость масштаба: scale *= exp(speed * dt) */
  scale: 0.9,
  autoRotate: Math.PI / 2,
} as const;

/** Задержка перед непрерывным движением при удержании, мс */
export const HOLD_DELAY_MS = 250;

/** Сила сглаживания (чем больше, тем быстрее модель догоняет цель) */
export const DAMPING = 10;

/** Длительность crossfade между анимациями, с */
export const ANIMATION_CROSSFADE = 0.3;

/** Ограничение pixel ratio для производительности */
export const MAX_DPR = 2;
