import { STORAGE_KEY } from '../config';
import { defaultProfile } from './state';
import type { Profile } from './state';

function isProfile(v: unknown): v is Profile {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return ['likes', 'likesGiven', 'deliveries', 'totalEarned'].every(
    (k) => typeof p[k] === 'number' && Number.isFinite(p[k]),
  );
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const parsed: unknown = JSON.parse(raw);
    return isProfile(parsed) ? parsed : defaultProfile();
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // приватный режим / хранилище недоступно: просто не сохраняем
  }
}
