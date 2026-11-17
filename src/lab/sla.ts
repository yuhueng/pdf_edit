export type Profile = 'mobile' | 'desktop';

export const SLA: Record<string, { mobile: number; desktop: number }> = {
  'PERF-01': { mobile: 2500, desktop: 1000 },
  'PERF-02': { mobile: 5000, desktop: 2000 },
  'PERF-03': { mobile: 4500, desktop: 1800 },
  'PERF-04': { mobile: 2000, desktop: 800 },
  'PERF-05': { mobile: 6000, desktop: 2500 },
  'PERF-06': { mobile: 3000, desktop: 1200 },
};

export function detectProfile(): Profile {
  if (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return 'mobile';
  }
  return 'desktop';
}
