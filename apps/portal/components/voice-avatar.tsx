'use client';

import { useMemo } from 'react';

type AvatarSheetKey = 'male' | 'neutral' | 'female';

// Each sheet is a grid of illustrated portraits (public/avatars/*.png). cols/rows
// must match the actual grid layout of that image file.
const AVATAR_SHEETS: Record<AvatarSheetKey, { cols: number; rows: number; src: string }> = {
  female: { cols: 4, rows: 3, src: '/avatars/female-sheet.png' },
  male: { cols: 4, rows: 3, src: '/avatars/male-sheet.png' },
  neutral: { cols: 3, rows: 2, src: '/avatars/neutral-sheet.png' },
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sheetForGender(gender: string | null): AvatarSheetKey {
  if (gender === 'masculine') return 'male';
  if (gender === 'feminine') return 'female';
  return 'neutral';
}

/**
 * Renders one cell of an illustrated avatar sheet, picked deterministically
 * per voice (via `seed`, e.g. the voice id) so the same voice always gets
 * the same portrait and portraits stay stable across reloads/filter changes.
 */
export function VoiceAvatar({
  gender = null,
  name,
  seed,
  size = 48,
}: {
  gender?: string | null;
  name: string;
  seed?: string;
  size?: number;
}) {
  const sheet = AVATAR_SHEETS[sheetForGender(gender)];
  const cellCount = sheet.cols * sheet.rows;

  const index = useMemo(
    () => hashString(seed ?? name) % cellCount,
    [seed, name, cellCount],
  );
  const row = Math.floor(index / sheet.cols);
  const col = index % sheet.cols;
  const bgPosX = sheet.cols > 1 ? (col / (sheet.cols - 1)) * 100 : 0;
  const bgPosY = sheet.rows > 1 ? (row / (sheet.rows - 1)) * 100 : 0;

  return (
    <div
      aria-label={name}
      className="voice-avatar"
      role="img"
      style={{
        backgroundImage: `url(${sheet.src})`,
        backgroundPosition: `${bgPosX}% ${bgPosY}%`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
        height: size,
        width: size,
      }}
    />
  );
}
