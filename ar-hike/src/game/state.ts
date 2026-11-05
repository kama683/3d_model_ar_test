/**
 * Игровая логика: конечный автомат и чистые функции без three.js и DOM.
 * Каждая функция принимает состояние и возвращает новое (исходное не мутируется).
 * Игрок задаётся только позицией на полу в метрах (Vec2), поэтому логика одинакова для AR и симуляции.
 */
import { CONFIG } from '../config';

export type Phase =
  | 'idle' // ещё не начали
  | 'calibrating' // ищем пол
  | 'placingA' // ставим Старт
  | 'placingB' // ставим Финиш
  | 'toStart' // идём к Старту за грузом
  | 'carrying' // несём груз к Финишу
  | 'result'; // груз сдан

/** Точка на полу (x, z) в метрах. */
export interface Vec2 {
  x: number;
  z: number;
}

export type WeatherKind = 'heat' | 'humidity';

export interface Weather {
  kind: WeatherKind;
  /** Сколько секунд осталось на обработку спреем. */
  remaining: number;
}

export interface Bench {
  id: string;
  pos: Vec2;
  thanked: boolean;
}

export interface Trip {
  quality: number;
  time: number;
  distance: number;
  weather: Weather | null;
  nextWeatherIn: number;
  /** Сколько секунд ещё действует спрей. */
  protection: number;
  lastPos: Vec2;
}

export interface TripResult {
  quality: number;
  time: number;
  distance: number;
  base: number;
  bonus: number;
  likesEarned: number;
}

/** Сохраняется между сессиями. */
export interface Profile {
  likes: number;
  likesGiven: number;
  deliveries: number;
  totalEarned: number;
}

export interface Notice {
  kind: 'warning' | 'info';
  text: string;
  ttl: number;
}

export interface GameState {
  phase: Phase;
  stationA: Vec2 | null;
  stationB: Vec2 | null;
  benches: Bench[];
  benchCounter: number;
  trip: Trip | null;
  result: TripResult | null;
  profile: Profile;
  notice: Notice | null;
}

export type Random = () => number;

/* ---------------- утилиты ---------------- */

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Порча никогда не опускает качество ниже минимума, а спрей/начальное значение не поднимают выше 100. */
export function clampQuality(q: number): number {
  return clamp(q, CONFIG.decay.minQuality, 100);
}

export function nextWeatherDelay(random: Random): number {
  const { minInterval, maxInterval } = CONFIG.weather;
  return minInterval + random() * (maxInterval - minInterval);
}

function notice(text: string, kind: Notice['kind'] = 'warning'): Notice {
  return { kind, text, ttl: CONFIG.noticeSeconds };
}

export function defaultProfile(): Profile {
  return { likes: CONFIG.startLikes, likesGiven: 0, deliveries: 0, totalEarned: 0 };
}

/* ---------------- создание и запуск ---------------- */

export function createGame(profile: Profile = defaultProfile()): GameState {
  return {
    phase: 'idle',
    stationA: null,
    stationB: null,
    benches: [],
    benchCounter: 0,
    trip: null,
    result: null,
    profile,
    notice: null,
  };
}

export function startCalibration(s: GameState): GameState {
  return { ...createGame(s.profile), phase: 'calibrating' };
}

export function floorFound(s: GameState): GameState {
  return s.phase === 'calibrating' ? { ...s, phase: 'placingA' } : s;
}

/* ---------------- расстановка станций ---------------- */

export function placeStation(s: GameState, pos: Vec2): GameState {
  if (s.phase === 'placingA') {
    return { ...s, stationA: pos, phase: 'placingB', notice: null };
  }
  if (s.phase === 'placingB' && s.stationA) {
    const d = distance(s.stationA, pos);
    if (d < CONFIG.minStationDistance) {
      return {
        ...s,
        notice: notice(
          `Слишком близко к Старту (${d.toFixed(1)} м). Финиш должен быть не ближе ${CONFIG.minStationDistance} м.`,
        ),
      };
    }
    return { ...s, stationB: pos, phase: 'toStart', notice: null };
  }
  return s;
}

/** «Переставить»: заново ставим A и B. Во время переноски груза недоступно. */
export function canResetStations(s: GameState): boolean {
  return s.phase === 'placingB' || s.phase === 'toStart' || s.phase === 'result';
}

export function resetStations(s: GameState): GameState {
  if (!canResetStations(s)) return s;
  return {
    ...s,
    phase: 'placingA',
    stationA: null,
    stationB: null,
    benches: [],
    trip: null,
    result: null,
    notice: null,
  };
}

/** Позиции якорей уточняются трекингом (ARCore): подтягиваем их без смены фазы. */
export function syncAnchoredPositions(
  s: GameState,
  update: { A?: Vec2; B?: Vec2; benches?: Record<string, Vec2> },
): GameState {
  const moved = (a: Vec2 | null, b: Vec2 | undefined) => Boolean(a && b && distance(a, b) > 0.01);
  const aMoved = moved(s.stationA, update.A);
  const bMoved = moved(s.stationB, update.B);
  const benchMoved = s.benches.some((b) => moved(b.pos, update.benches?.[b.id]));
  if (!aMoved && !bMoved && !benchMoved) return s;
  return {
    ...s,
    stationA: aMoved && update.A ? update.A : s.stationA,
    stationB: bMoved && update.B ? update.B : s.stationB,
    benches: benchMoved
      ? s.benches.map((b) => ({ ...b, pos: update.benches?.[b.id] ?? b.pos }))
      : s.benches,
  };
}

/* ---------------- цель и расстояния ---------------- */

/** Куда сейчас идти: к Старту за грузом или к Финишу. */
export function currentTarget(s: GameState): Vec2 | null {
  if (s.phase === 'toStart') return s.stationA;
  if (s.phase === 'carrying') return s.stationB;
  return null;
}

export function distanceToTarget(s: GameState, player: Vec2): number | null {
  const t = currentTarget(s);
  return t ? distance(t, player) : null;
}

/* ---------------- груз ---------------- */

export function canPickup(s: GameState, player: Vec2): boolean {
  return s.phase === 'toStart' && s.stationA !== null && distance(s.stationA, player) < CONFIG.interactRadius;
}

export function pickup(s: GameState, player: Vec2, random: Random): GameState {
  if (!canPickup(s, player)) return s;
  return {
    ...s,
    phase: 'carrying',
    result: null,
    notice: null,
    trip: {
      quality: 100,
      time: 0,
      distance: 0,
      weather: null,
      nextWeatherIn: nextWeatherDelay(random),
      protection: 0,
      lastPos: player,
    },
  };
}

/**
 * Шаг времени. Во время переноски:
 *  - качество падает от времени и пройденного пути (не ниже минимума);
 *  - приходят события погоды; необработанное за reactionTime стоит penalty процентов;
 *  - спрей на protection секунд останавливает порчу и новые события.
 */
export function tick(s: GameState, dt: number, player: Vec2, random: Random): GameState {
  let next = s;
  if (s.notice) {
    const ttl = s.notice.ttl - dt;
    next = { ...next, notice: ttl > 0 ? { ...s.notice, ttl } : null };
  }
  if (s.phase !== 'carrying' || !s.trip) return next;

  const t = s.trip;
  let quality = t.quality;
  let distanceWalked = t.distance;
  let lastPos = t.lastPos;

  // Путь: копим только шаги больше minStep, чтобы дрожание трекинга не считалось ходьбой.
  const step = distance(lastPos, player);
  let walked = 0;
  if (step >= CONFIG.decay.minStep) {
    walked = step;
    distanceWalked += step;
    lastPos = player;
  }

  const protection = Math.max(0, t.protection - dt);
  const protectedNow = t.protection > 0;

  if (!protectedNow) {
    quality -= CONFIG.decay.percentPerSecond * dt + CONFIG.decay.percentPerMeter * walked;
  }

  let weather = t.weather;
  let nextWeatherIn = t.nextWeatherIn;
  let newNotice = next.notice;

  if (weather) {
    const remaining = weather.remaining - dt;
    if (remaining <= 0) {
      quality -= CONFIG.weather.penalty;
      weather = null;
      nextWeatherIn = nextWeatherDelay(random);
      newNotice = notice(`Груз пострадал: −${CONFIG.weather.penalty}% качества`);
    } else {
      weather = { ...weather, remaining };
    }
  } else if (!protectedNow) {
    nextWeatherIn -= dt;
    if (nextWeatherIn <= 0) {
      weather = { kind: random() < 0.5 ? 'heat' : 'humidity', remaining: CONFIG.weather.reactionTime };
    }
  }

  return {
    ...next,
    notice: newNotice,
    trip: {
      quality: clampQuality(quality),
      time: t.time + dt,
      distance: distanceWalked,
      weather,
      nextWeatherIn,
      protection,
      lastPos,
    },
  };
}

/* ---------------- спрей ---------------- */

export function canSpray(s: GameState): boolean {
  return (
    s.phase === 'carrying' &&
    s.trip !== null &&
    s.profile.likes >= CONFIG.spray.cost &&
    // Тратить Лайки имеет смысл, только если есть событие или защита закончилась.
    (s.trip.weather !== null || s.trip.protection <= 0)
  );
}

export function spray(s: GameState, random: Random): GameState {
  if (!canSpray(s) || !s.trip) return s;
  return {
    ...s,
    profile: { ...s.profile, likes: s.profile.likes - CONFIG.spray.cost },
    notice: notice(`Груз обработан: защита ${CONFIG.spray.protection} с`, 'info'),
    trip: {
      ...s.trip,
      weather: null,
      protection: CONFIG.spray.protection,
      // Следующее событие не раньше, чем закончится защита.
      nextWeatherIn: CONFIG.spray.protection + nextWeatherDelay(random),
    },
  };
}

/* ---------------- скамейки ---------------- */

export function canPlaceBench(s: GameState, player: Vec2): boolean {
  if (s.phase !== 'carrying') return false;
  if (s.benches.length >= CONFIG.bench.maxCount) return false;
  const tooClose = (p: Vec2 | null) => p !== null && distance(p, player) < CONFIG.bench.minDistance;
  return !tooClose(s.stationA) && !tooClose(s.stationB) && !s.benches.some((b) => tooClose(b.pos));
}

export function placeBench(s: GameState, player: Vec2): GameState {
  if (!canPlaceBench(s, player)) return s;
  const id = `bench-${s.benchCounter + 1}`;
  return {
    ...s,
    benchCounter: s.benchCounter + 1,
    benches: [...s.benches, { id, pos: player, thanked: false }],
    notice: notice('Скамейка поставлена', 'info'),
  };
}

/** Ближайшая скамейка в радиусе, которую ещё не благодарили. */
export function benchToThank(s: GameState, player: Vec2): Bench | null {
  let best: Bench | null = null;
  let bestD: number = CONFIG.interactRadius;
  for (const b of s.benches) {
    const d = distance(b.pos, player);
    if (!b.thanked && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function canThank(s: GameState, player: Vec2): boolean {
  return benchToThank(s, player) !== null && s.profile.likes >= CONFIG.bench.thankLikes;
}

export function thankVolunteers(s: GameState, player: Vec2): GameState {
  const bench = benchToThank(s, player);
  if (!bench || s.profile.likes < CONFIG.bench.thankLikes) return s;
  return {
    ...s,
    benches: s.benches.map((b) => (b.id === bench.id ? { ...b, thanked: true } : b)),
    profile: {
      ...s.profile,
      likes: s.profile.likes - CONFIG.bench.thankLikes,
      likesGiven: s.profile.likesGiven + CONFIG.bench.thankLikes,
    },
    notice: notice('Спасибо волонтёрам! Лайк отправлен', 'info'),
  };
}

/* ---------------- доставка ---------------- */

export function canDeliver(s: GameState, player: Vec2): boolean {
  return s.phase === 'carrying' && s.stationB !== null && distance(s.stationB, player) < CONFIG.interactRadius;
}

/** Награда: base × качество/100 + бонус за быстроту относительно расстояния A–B. */
export function computeReward(quality: number, time: number, routeLength: number): { base: number; bonus: number } {
  const r = CONFIG.reward;
  const base = Math.round((r.base * quality) / 100);
  let bonus = 0;
  if (time <= r.fastSecondsPerMeter * routeLength) bonus = r.fastBonus;
  else if (time <= r.okSecondsPerMeter * routeLength) bonus = r.okBonus;
  return { base, bonus };
}

export function deliver(s: GameState, player: Vec2): GameState {
  if (!canDeliver(s, player) || !s.trip || !s.stationA || !s.stationB) return s;
  const { quality, time, distance: walked } = s.trip;
  const { base, bonus } = computeReward(quality, time, distance(s.stationA, s.stationB));
  const likesEarned = base + bonus;
  return {
    ...s,
    phase: 'result',
    trip: null,
    notice: null,
    result: { quality, time, distance: walked, base, bonus, likesEarned },
    profile: {
      ...s.profile,
      likes: s.profile.likes + likesEarned,
      deliveries: s.profile.deliveries + 1,
      totalEarned: s.profile.totalEarned + likesEarned,
    },
  };
}

/** «Новый заказ» по тем же точкам. */
export function newOrder(s: GameState): GameState {
  if (s.phase !== 'result' || !s.stationA || !s.stationB) return s;
  return { ...s, phase: 'toStart', result: null, trip: null, notice: null };
}
