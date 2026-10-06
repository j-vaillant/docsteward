import type { Indicator } from '@docsteward/contracts';

type IndicatorValue = Pick<Indicator, 'displayType' | 'latestValue' | 'latestUnit'>;

function parseCalendarDate(value: string): Date | null {
  const trimmed = value.trim();
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const frenchDate = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  const match = isoDate ?? frenchDate;

  if (match) {
    const [, first, second, third] = match;
    const year = Number(isoDate ? first : third);
    const month = Number(second);
    const day = Number(isoDate ? third : first);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day)
      return date;
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function formatIndicatorValue(indicator: IndicatorValue): string {
  if (indicator.latestValue === null) return 'Valeur indisponible';
  if (indicator.displayType === 'currency' && typeof indicator.latestValue === 'number') {
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: indicator.latestUnit ?? 'EUR',
        maximumFractionDigits: 2,
      }).format(indicator.latestValue);
    } catch {
      return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(indicator.latestValue)}${indicator.latestUnit ? ` ${indicator.latestUnit}` : ''}`;
    }
  }
  if (indicator.displayType === 'percentage' && typeof indicator.latestValue === 'number')
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(indicator.latestValue)} %`;
  if (indicator.displayType === 'number' && typeof indicator.latestValue === 'number')
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(
      indicator.latestValue,
    );
  if (indicator.displayType === 'date') {
    const raw = String(indicator.latestValue);
    const date = parseCalendarDate(raw);
    return date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date) : raw;
  }
  return `${String(indicator.latestValue)}${indicator.latestUnit ? ` ${indicator.latestUnit}` : ''}`;
}
