/**
 * The landing page shows once per browser per 24 hours: the time of the last visit is kept in localStorage.
 * Storage can be missing or throw (blocked site data); then the landing page shows, and nothing breaks.
 */
export const VISIT_KEY = 'yh:last-visit';
export const LANDING_GAP_MS = 24 * 60 * 60 * 1000;

/** True when this browser has no visit in the last 24 hours. */
export function shouldShowLanding(now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(VISIT_KEY));
    return !(last > 0 && last <= now && now - last < LANDING_GAP_MS);
  } catch {
    return true;
  }
}

/** Records this visit. */
export function markVisit(now = Date.now()): void {
  try {
    localStorage.setItem(VISIT_KEY, String(now));
  } catch {
    /* storage blocked: the landing page will show again next time */
  }
}
