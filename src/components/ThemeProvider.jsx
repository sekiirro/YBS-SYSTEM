import React, { createContext, useContext, useEffect, useState } from 'react';
import { applyTheme, readThemeMode, resolveTheme, millisecondsToThemeBoundary, THEME_STORAGE_KEY, THEME_MODES } from '@/lib/theme';

const ThemeContext = createContext(null);
export const useYbsTheme = () => useContext(ThemeContext);

export default function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readThemeMode);
  const [theme, setTheme] = useState(() => resolveTheme(readThemeMode()));
  const selectMode = (next) => {
    if (!THEME_MODES.includes(next)) return;
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Private/blocked storage: keep this session usable. */ }
    setTheme(applyTheme(next));
    setMode(next);
  };

  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      setTheme(applyTheme(mode));
      if (mode === 'auto') timer = setTimeout(refresh, millisecondsToThemeBoundary());
    };
    const sync = () => { const next = readThemeMode(); setMode(next); setTheme(applyTheme(next)); };
    const storageChanged = (event) => { if (event.key === THEME_STORAGE_KEY || event.key === null) sync(); };
    refresh();
    // Also recover from sleep, local clock/timezone changes, and other tabs.
    const clockCheck = mode === 'auto' ? setInterval(refresh, 60_000) : null;
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', storageChanged);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer); clearInterval(clockCheck);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', storageChanged);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, theme, selectMode }}>{children}</ThemeContext.Provider>;
}
