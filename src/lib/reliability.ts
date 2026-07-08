import { getSupabaseAdmin } from './supabase';

/**
 * Reliability grading — reads the Delay Ledger, never computes delays ad-hoc.
 *
 * The grade philosophy: we only grade what we can observe. KTMB and the bus
 * networks publish live positions, so they get graded. Rapid Rail (LRT/MRT/
 * Monorail) publishes NO realtime feed — those lines are listed as
 * "unmonitored", loudly. We can't grade what Prasarana doesn't show.
 */

export interface DailyReportRow {
  network: string;
  snapshots: number;
  uptime_pct: number | null;
  stall_count: number;
  stall_minutes: number;
  gap_minutes: number;
  outage_minutes: number;
}

export interface NetworkGrade {
  network: string;
  label: string;
  grade: string;        // 'A+' … 'E', or '—' when there isn't enough data yet
  score: number | null; // 0–100
  uptimePct: number | null;
  stallCount: number;
  stallMinutes: number;
  gapMinutes: number;
  outageMinutes: number;
  samples: number;
  days: number;
}

export const NETWORK_LABELS: Record<string, string> = {
  'ktmb': 'KTM Komuter / ETS',
  'rapid-bus-kl': 'Bas Rapid KL',
  'mybas-johor': 'myBAS Johor',
};

/** Rapid Rail lines with no published realtime feed — shown as unmonitored. */
export const UNMONITORED_LINES = [
  { name: 'Kelana Jaya Line',  type: 'LRT',      color: '#009EE0' },
  { name: 'Ampang Line',       type: 'LRT',      color: '#FF8000' },
  { name: 'Sri Petaling Line', type: 'LRT',      color: '#9B1C31' },
  { name: 'KL Monorail',       type: 'Monorail', color: '#EE2024' },
  { name: 'Kajang Line',       type: 'MRT',      color: '#007F55' },
  { name: 'Putrajaya Line',    type: 'MRT',      color: '#3C3799' },
] as const;

/** Today's date in Malaysia time as YYYY-MM-DD, optionally offset by days. */
export function mytDate(offsetDays = 0): string {
  const myt = new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000);
  return myt.toISOString().slice(0, 10);
}

function letterFor(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 88) return 'B+';
  if (score >= 82) return 'B';
  if (score >= 74) return 'C+';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'E';
}

/**
 * Composite score. Feed uptime is the base (outages already depress it);
 * service gaps and stalled trains subtract on top, per-day so a 7-day window
 * isn't judged more harshly than a 1-day one.
 */
export function gradeRows(rows: DailyReportRow[], days: number): NetworkGrade[] {
  const byNetwork = new Map<string, DailyReportRow[]>();
  for (const r of rows) {
    const list = byNetwork.get(r.network) ?? [];
    list.push(r);
    byNetwork.set(r.network, list);
  }

  const grades: NetworkGrade[] = [];
  for (const [network, list] of byNetwork) {
    const samples = list.reduce((s, r) => s + r.snapshots, 0);
    const stallCount = list.reduce((s, r) => s + r.stall_count, 0);
    const stallMinutes = list.reduce((s, r) => s + r.stall_minutes, 0);
    const gapMinutes = list.reduce((s, r) => s + r.gap_minutes, 0);
    const outageMinutes = list.reduce((s, r) => s + r.outage_minutes, 0);

    // Sample-weighted uptime across the window
    const withUptime = list.filter(r => r.uptime_pct != null && r.snapshots > 0);
    const weight = withUptime.reduce((s, r) => s + r.snapshots, 0);
    const uptimePct = weight > 0
      ? Math.round((withUptime.reduce((s, r) => s + (r.uptime_pct as number) * r.snapshots, 0) / weight) * 10) / 10
      : null;

    // Below ~20 samples a grade would be noise, not signal. Say so instead.
    if (uptimePct == null || samples < 20) {
      grades.push({
        network, label: NETWORK_LABELS[network] ?? network,
        grade: '—', score: null, uptimePct, stallCount, stallMinutes,
        gapMinutes, outageMinutes, samples, days,
      });
      continue;
    }

    const score = Math.max(0, Math.min(100,
      uptimePct - (gapMinutes / days) * 0.3 - (stallMinutes / days) * 0.1,
    ));
    grades.push({
      network, label: NETWORK_LABELS[network] ?? network,
      grade: letterFor(score), score: Math.round(score * 10) / 10,
      uptimePct, stallCount, stallMinutes, gapMinutes, outageMinutes, samples, days,
    });
  }

  return grades.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** Ledger rows for the last N Malaysia-time days (today inclusive). */
export async function fetchLedgerWindow(days: number): Promise<DailyReportRow[]> {
  const db = getSupabaseAdmin();
  const dates = Array.from({ length: days }, (_, i) => mytDate(-i));
  const results = await Promise.all(
    dates.map(d => db.rpc('daily_report', { p_date: d })),
  );
  const rows: DailyReportRow[] = [];
  for (const r of results) {
    if (!r.error && Array.isArray(r.data)) rows.push(...(r.data as DailyReportRow[]));
  }
  return rows;
}
