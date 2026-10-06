import { describe, expect, it } from 'vitest';
import { formatIndicatorValue } from '../../apps/renderer/src/format';

describe('formatIndicatorValue', () => {
  it.each([
    ['2025-01-31', '31 janvier 2025'],
    ['31/01/2025', '31 janvier 2025'],
    ['31-01-2025', '31 janvier 2025'],
    ['31.01.2025', '31 janvier 2025'],
  ])('affiche la date %s sans faire planter le rendu', (value, expected) => {
    expect(formatIndicatorValue({ displayType: 'date', latestValue: value })).toBe(expected);
  });

  it('conserve une date non reconnue au lieu de lever une exception', () => {
    expect(formatIndicatorValue({ displayType: 'date', latestValue: 'date à confirmer' })).toBe(
      'date à confirmer',
    );
  });

  it('conserve une valeur monétaire avec une unité non standard', () => {
    expect(
      formatIndicatorValue({ displayType: 'currency', latestValue: 42, latestUnit: 'euros' }),
    ).toBe('42 euros');
  });
});
