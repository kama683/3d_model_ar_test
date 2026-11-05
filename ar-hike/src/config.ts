/** Все игровые числа в одном месте. Расстояния в метрах, время в секундах, качество в процентах. */
export const CONFIG = {
  /** Радиус взаимодействия со станцией/скамейкой. */
  interactRadius: 1.0,
  /** Минимальная дистанция между Стартом и Финишем. */
  minStationDistance: 2.0,
  /** Лайки у нового игрока (чтобы спрей и благодарность были доступны в первом заказе). */
  startLikes: 10,

  decay: {
    /** ~1% за 5 секунд. */
    percentPerSecond: 0.2,
    /** Порча от пройденного пути. */
    percentPerMeter: 0.5,
    /** Ниже этого качества груз не портится. */
    minQuality: 80,
    /** Шаг, меньше которого движение считается дрожанием трекинга и не учитывается в пути. */
    minStep: 0.05,
  },

  weather: {
    minInterval: 20,
    maxInterval: 40,
    /** Сколько секунд есть на обработку спреем. */
    reactionTime: 10,
    /** Потеря качества, если не обработать. */
    penalty: 5,
  },

  spray: {
    cost: 5,
    /** Сколько секунд груз защищён после спрея (нет порчи и новых событий). */
    protection: 15,
  },

  bench: {
    /** Сколько скамеек можно поставить за сессию. */
    maxCount: 3,
    /** Нельзя ставить скамейку ближе этого к другой скамейке или станции. */
    minDistance: 1.0,
    /** Сколько Лайков игрок отдаёт волонтёрам за одну скамейку. */
    thankLikes: 1,
  },

  reward: {
    base: 10,
    /** Бонус за быструю доставку: время ≤ fastSecondsPerMeter × дистанция A–B. */
    fastBonus: 5,
    fastSecondsPerMeter: 5,
    /** Меньший бонус: время ≤ okSecondsPerMeter × дистанция A–B. */
    okBonus: 2,
    okSecondsPerMeter: 10,
  },

  /** Через сколько секунд гаснет подсказка-предупреждение. */
  noticeSeconds: 3,
} as const;

/** Визуальные настройки (не влияют на правила). */
export const VISUAL = {
  stationHeight: 1.1,
  stationRadius: 0.12,
  /** Где висит груз относительно камеры в AR: вперёд и вниз, м. */
  cargoHoldForward: 0.45,
  cargoHoldDown: 0.28,
  cargoSize: 0.16,
  pickupAnimation: 1.2,
  deliveryAnimation: 1.2,
} as const;

/** Режим симуляции. */
export const SIM = {
  roomWidth: 6,
  roomDepth: 5,
  walkSpeed: 1.3,
  /** Имитация поиска пола, с. */
  calibrationDelay: 1.0,
  eyeHeight: 1.5,
} as const;

export const STORAGE_KEY = 'ar-hike.profile.v1';
