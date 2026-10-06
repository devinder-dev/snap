import { S } from '@/constants/strings';

/** "14:05" — for chat bubbles. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** "nyss", "5 min", "3 tim", "2 d" — for list rows, where only recency matters. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return S.time.now;
  if (minutes < 60) return S.time.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return S.time.hours(hours);
  return S.time.days(Math.floor(hours / 24));
}
