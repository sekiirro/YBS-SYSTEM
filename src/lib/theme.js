export const THEME_STORAGE_KEY = 'ybs-theme-mode';
export const DAY_START_HOUR = 7;
export const NIGHT_START_HOUR = 19;
export const THEME_MODES = ['auto', 'day', 'night'];

export function readThemeMode() {
  // Temporarily locked to Night: the Day/Light theme is not approved yet, so
  // any stored/preferred mode (auto/day) is ignored. Day support stays in the
  // codebase for future use.
  return 'night';
}

export function resolveTheme(mode, date = new Date()) {
  // Temporarily pinned to Night: block time-based auto switching entirely so
  // the browser clock can never flip the app to Day.
  return 'night';
}

export function applyTheme(mode) {
  const theme = resolveTheme(mode);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'night');
  document.documentElement.style.colorScheme = theme === 'night' ? 'dark' : 'light';
  return theme;
}

export function millisecondsToThemeBoundary(date = new Date()) {
  const next = new Date(date);
  const hour = date.getHours();
  if (hour < DAY_START_HOUR) next.setHours(DAY_START_HOUR, 0, 0, 0);
  else if (hour < NIGHT_START_HOUR) next.setHours(NIGHT_START_HOUR, 0, 0, 0);
  else { next.setDate(next.getDate() + 1); next.setHours(DAY_START_HOUR, 0, 0, 0); }
  return next.getTime() - date.getTime() + 10;
}
