import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import * as G from './state';
import type { GameState, Vec2 } from './state';

const A: Vec2 = { x: 0, z: 0 };
const B: Vec2 = { x: 3, z: 0 };
/** Детерминированный «рандом»: всегда одно значение. */
const fixed = (v: number) => () => v;

/** Игра, в которой станции стоят, груз ещё не взят. */
function readyGame(likes: number = CONFIG.startLikes): GameState {
  let s = G.createGame({ likes, likesGiven: 0, deliveries: 0, totalEarned: 0 });
  s = G.startCalibration(s);
  s = G.floorFound(s);
  s = G.placeStation(s, A);
  s = G.placeStation(s, B);
  return s;
}

/** Груз взят у A. Первое событие погоды через 30 с (random = 0.5). */
function carrying(likes?: number): GameState {
  return G.pickup(readyGame(likes), A, fixed(0.5));
}

/** Прогнать время мелкими шагами, стоя на месте. */
function wait(s: GameState, seconds: number, at: Vec2 = A, random = fixed(0.5)): GameState {
  const dt = 0.1;
  let state = s;
  for (let t = 0; t < seconds - 1e-9; t += dt) state = G.tick(state, dt, at, random);
  return state;
}

describe('конечный автомат', () => {
  it('idle → калибровка → A → B → к старту', () => {
    let s = G.createGame();
    expect(s.phase).toBe('idle');
    s = G.startCalibration(s);
    expect(s.phase).toBe('calibrating');
    s = G.placeStation(s, A);
    expect(s.phase).toBe('calibrating'); // пол ещё не найден: тап игнорируется
    s = G.floorFound(s);
    expect(s.phase).toBe('placingA');
    s = G.placeStation(s, A);
    expect(s.phase).toBe('placingB');
    s = G.placeStation(s, B);
    expect(s.phase).toBe('toStart');
    expect(G.currentTarget(s)).toEqual(A);
  });

  it('Финиш ближе 2 м к Старту не ставится и даёт предупреждение', () => {
    let s = G.floorFound(G.startCalibration(G.createGame()));
    s = G.placeStation(s, A);
    s = G.placeStation(s, { x: 1.5, z: 0 });
    expect(s.phase).toBe('placingB');
    expect(s.stationB).toBeNull();
    expect(s.notice?.kind).toBe('warning');
    s = G.placeStation(s, { x: 2, z: 0 });
    expect(s.phase).toBe('toStart');
  });

  it('«Переставить» доступно до груза и после сдачи, но не во время переноски', () => {
    const ready = readyGame();
    expect(G.resetStations(ready).phase).toBe('placingA');
    const c = carrying();
    expect(G.canResetStations(c)).toBe(false);
    expect(G.resetStations(c)).toBe(c);
  });

  it('груз выдаётся только в радиусе 1 м от Старта', () => {
    const s = readyGame();
    expect(G.canPickup(s, { x: 1.2, z: 0 })).toBe(false);
    expect(G.pickup(s, { x: 1.2, z: 0 }, fixed(0.5))).toBe(s);
    const c = G.pickup(s, { x: 0.5, z: 0 }, fixed(0.5));
    expect(c.phase).toBe('carrying');
    expect(c.trip?.quality).toBe(100);
    expect(G.currentTarget(c)).toEqual(B);
  });
});

describe('порча груза', () => {
  it('~1% за 5 секунд стоя на месте', () => {
    const s = wait(carrying(), 5);
    expect(s.trip?.quality).toBeCloseTo(99, 5);
  });

  it('порча от пройденного пути', () => {
    let s = carrying();
    s = G.tick(s, 0.0001, { x: 2, z: 0 }, fixed(0.5));
    expect(s.trip?.distance).toBeCloseTo(2, 5);
    expect(s.trip?.quality).toBeCloseTo(100 - 2 * CONFIG.decay.percentPerMeter, 3);
  });

  it('дрожание трекинга меньше minStep не считается ходьбой', () => {
    let s = carrying();
    for (let i = 0; i < 100; i++) {
      s = G.tick(s, 0.01, { x: (i % 2) * 0.02, z: 0 }, fixed(0.5));
    }
    expect(s.trip?.distance).toBe(0);
  });

  it('качество не опускается ниже 80%', () => {
    const s = wait(carrying(), 600);
    expect(s.trip?.quality).toBe(CONFIG.decay.minQuality);
  });

  it('штраф погоды тоже не опускает ниже 80%', () => {
    let s = carrying();
    s = { ...s, trip: s.trip && { ...s.trip, quality: 82, weather: { kind: 'heat', remaining: 0.05 } } };
    s = G.tick(s, 0.1, A, fixed(0.5));
    expect(s.trip?.quality).toBe(80);
  });
});

describe('события погоды', () => {
  it('приходят через 20–40 секунд', () => {
    expect(G.nextWeatherDelay(fixed(0))).toBe(20);
    expect(G.nextWeatherDelay(fixed(1))).toBe(40);
    const c = G.pickup(readyGame(), A, fixed(0)); // через 20 с
    expect(wait(c, 19.5).trip?.weather).toBeNull();
    expect(wait(c, 20.1).trip?.weather).not.toBeNull();
  });

  it('тип события: жара или влажность', () => {
    const c = G.pickup(readyGame(), A, fixed(0));
    expect(wait(c, 20.1, A, fixed(0.2)).trip?.weather?.kind).toBe('heat');
    expect(wait(c, 20.1, A, fixed(0.8)).trip?.weather?.kind).toBe('humidity');
  });

  it('без спрея через 10 с качество падает на 5%', () => {
    const c = G.pickup(readyGame(), A, fixed(0));
    const atEvent = wait(c, 20.1);
    const qBefore = atEvent.trip?.quality ?? 0;
    const after = wait(atEvent, CONFIG.weather.reactionTime);
    expect(after.trip?.weather).toBeNull();
    const naturalDecay = CONFIG.decay.percentPerSecond * CONFIG.weather.reactionTime;
    expect(after.trip?.quality).toBeCloseTo(qBefore - naturalDecay - CONFIG.weather.penalty, 1);
  });
});

describe('спрей', () => {
  it('стоит 5 Лайков, снимает событие и даёт защиту 15 с', () => {
    const c = G.pickup(readyGame(10), A, fixed(0));
    const atEvent = wait(c, 20.1);
    expect(atEvent.trip?.weather).not.toBeNull();
    const s = G.spray(atEvent, fixed(0.5));
    expect(s.profile.likes).toBe(5);
    expect(s.trip?.weather).toBeNull();
    expect(s.trip?.protection).toBe(CONFIG.spray.protection);
  });

  it('во время защиты качество не падает', () => {
    const s = G.spray(carrying(10), fixed(0.5));
    const q = s.trip?.quality ?? 0;
    const later = wait(s, CONFIG.spray.protection - 0.5, { x: 0.5, z: 0 });
    expect(later.trip?.quality).toBe(q);
    // после защиты порча продолжается
    const after = wait(later, 5);
    expect(after.trip?.quality).toBeLessThan(q);
  });

  it('неактивен, если Лайков меньше 5', () => {
    const c = carrying(4);
    expect(G.canSpray(c)).toBe(false);
    expect(G.spray(c, fixed(0.5))).toBe(c);
  });

  it('недоступен вне переноски', () => {
    expect(G.canSpray(readyGame(100))).toBe(false);
  });
});

describe('скамейки', () => {
  it('ставится во время переноски, не ближе 1 м к станциям', () => {
    const c = carrying();
    expect(G.canPlaceBench(c, { x: 0.5, z: 0 })).toBe(false);
    const s = G.placeBench(c, { x: 1.5, z: 0 });
    expect(s.benches).toHaveLength(1);
    expect(G.canPlaceBench(s, { x: 1.8, z: 0 })).toBe(false); // рядом с другой скамейкой
  });

  it('поблагодарить можно один раз: −1 Лайк, +1 в «Лайки отданы»', () => {
    let s = G.placeBench(carrying(10), { x: 1.5, z: 0 });
    const near: Vec2 = { x: 1.5, z: 0.5 };
    expect(G.canThank(s, near)).toBe(true);
    s = G.thankVolunteers(s, near);
    expect(s.profile.likes).toBe(9);
    expect(s.profile.likesGiven).toBe(1);
    expect(G.canThank(s, near)).toBe(false);
    expect(G.thankVolunteers(s, near)).toBe(s);
  });

  it('не больше maxCount скамеек', () => {
    let s = carrying();
    for (let i = 0; i < 5; i++) s = G.placeBench(s, { x: 1.2 + i * 0.0, z: -2 + i * 1.1 });
    expect(s.benches.length).toBe(CONFIG.bench.maxCount);
  });
});

describe('доставка и награда', () => {
  it('сдать можно только в радиусе 1 м от Финиша', () => {
    const c = carrying();
    expect(G.canDeliver(c, { x: 1.5, z: 0 })).toBe(false);
    expect(G.canDeliver(c, { x: 2.5, z: 0 })).toBe(true);
  });

  it('награда = 10 × качество/100 + бонус за быстроту', () => {
    expect(G.computeReward(100, 5, 3)).toEqual({ base: 10, bonus: CONFIG.reward.fastBonus });
    expect(G.computeReward(80, 25, 3)).toEqual({ base: 8, bonus: CONFIG.reward.okBonus });
    expect(G.computeReward(90, 100, 3)).toEqual({ base: 9, bonus: 0 });
  });

  it('полный цикл начисляет Лайки и считает доставки', () => {
    let s = carrying(10);
    // идём к B за ~6 с
    for (let i = 1; i <= 60; i++) s = G.tick(s, 0.1, { x: (2.6 * i) / 60, z: 0 }, fixed(0.5));
    s = G.deliver(s, { x: 2.6, z: 0 });
    expect(s.phase).toBe('result');
    expect(s.result?.likesEarned).toBeGreaterThan(0);
    expect(s.profile.likes).toBe(10 + (s.result?.likesEarned ?? 0));
    expect(s.profile.deliveries).toBe(1);
    expect(s.result?.distance).toBeCloseTo(2.6, 1);

    const again = G.newOrder(s);
    expect(again.phase).toBe('toStart');
    expect(again.stationA).toEqual(A);
    expect(again.stationB).toEqual(B);
  });
});

describe('якоря', () => {
  it('позиции станций подтягиваются за якорями без смены фазы', () => {
    const s = readyGame();
    const moved = G.syncAnchoredPositions(s, { A: { x: 0.05, z: 0 } });
    expect(moved.stationA).toEqual({ x: 0.05, z: 0 });
    expect(moved.phase).toBe('toStart');
    // сдвиг меньше 1 см игнорируется
    expect(G.syncAnchoredPositions(s, { A: { x: 0.005, z: 0 } })).toBe(s);
  });
});
