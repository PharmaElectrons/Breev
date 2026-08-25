import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import {
  directionForLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  readStoredTheme,
  THEME_STORAGE_KEY,
  type Direction,
  type Locale,
  type Theme,
} from "./preferences";

interface PreferencesValue {
  readonly direction: Direction;
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: Theme) => void;
  readonly theme: Theme;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() =>
    safelyReadPreference(readStoredLocale, "en"),
  );
  const [theme, setThemeState] = useState<Theme>(() =>
    safelyReadPreference(readStoredTheme, "light"),
  );
  const direction = directionForLocale(locale);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = direction;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }, [direction, locale, theme]);

  const value = useMemo<PreferencesValue>(
    () => ({
      direction,
      locale,
      setLocale: (nextLocale) => {
        safelyStorePreference(LOCALE_STORAGE_KEY, nextLocale);
        setLocaleState(nextLocale);
      },
      setTheme: (nextTheme) => {
        safelyStorePreference(THEME_STORAGE_KEY, nextTheme);
        setThemeState(nextTheme);
      },
      theme,
    }),
    [direction, locale, theme],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (value === null) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return value;
}

function safelyReadPreference<T>(
  reader: (storage: Storage) => T,
  fallback: T,
): T {
  try {
    return reader(window.localStorage);
  } catch {
    return fallback;
  }
}

function safelyStorePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Presentation preferences may reset if browser storage is unavailable.
  }
}
