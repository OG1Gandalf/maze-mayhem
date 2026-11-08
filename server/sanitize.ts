import { NAME_MAX, ROOM_CODE_LENGTH } from '../shared/constants';

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const clean = s
    .normalize('NFKC')
    .replace(/[\p{C}<>&"'`\\]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, NAME_MAX).join('').trim() || 'Player';
}

export function sanitizeCode(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
}
