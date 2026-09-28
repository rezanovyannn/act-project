import { daysInMonth, toIsoDate, yearOf } from "./dates";
import type { IsoDate, Period } from "./types";

export interface PeriodRange {
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * Periode bulanan dari bulan `fromDate` sampai Desember tahun yang sama
 * (seed saat workspace dibuat, ADR 006).
 */
export function monthlyPeriodsUntilYearEnd(fromDate: IsoDate): PeriodRange[] {
  const year = yearOf(fromDate);
  const firstMonth = Number(fromDate.slice(5, 7));
  const ranges: PeriodRange[] = [];
  for (let month = firstMonth; month <= 12; month++) {
    ranges.push({
      startDate: toIsoDate(year, month, 1),
      endDate: toIsoDate(year, month, daysInMonth(year, month)),
    });
  }
  return ranges;
}

/** 12 periode bulanan untuk satu tahun buku (tahun kalender). */
export function monthlyPeriodsForYear(year: number): PeriodRange[] {
  return monthlyPeriodsUntilYearEnd(toIsoDate(year, 1, 1));
}

/** Periode yang memuat `date`, atau `null` bila tidak ada. */
export function findPeriodForDate<T extends PeriodRange>(
  periods: readonly T[],
  date: IsoDate,
): T | null {
  return periods.find((p) => p.startDate <= date && date <= p.endDate) ?? null;
}

/** `true` bila dua rentang periode saling tumpang tindih. */
export function periodsOverlap(a: PeriodRange, b: PeriodRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function isPeriodOpen(period: Pick<Period, "status">): boolean {
  return period.status === "open";
}
