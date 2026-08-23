// Pharmacy branding (name + logo). Persisted in localStorage and broadcast
// to every mounted component via a custom event, so header / sidebar / auth /
// invoice templates / browser title all react in real time.
import { useEffect, useState } from "react";

export type Branding = {
  name: string;
  logoDataUrl: string | null;
};

const KEY = "breef.branding.v1";
const EVT = "breef:branding-change";

const DEFAULT: Branding = {
  name: "Breef Pharmacy",
  logoDataUrl: null,
};

// Secret admin password gating the branding editor. Kept in code by design
// (the requirement is a shared admin secret, not per-user auth).
export const BRANDING_ADMIN_PASSWORD = "breef-admin-2026";

function read(): Branding {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : DEFAULT.name,
      logoDataUrl: typeof parsed.logoDataUrl === "string" ? parsed.logoDataUrl : null,
    };
  } catch {
    return DEFAULT;
  }
}

export function getBranding(): Branding {
  return read();
}

export function setBranding(patch: Partial<Branding>) {
  const next = { ...read(), ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(EVT, { detail: next }));
  }
}

export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(DEFAULT);
  useEffect(() => {
    setB(read());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Branding>).detail;
      setB(detail ?? read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setB(read());
    };
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return b;
}

// Keeps document.title in sync with the current branding name + a page label.
export function useBrandTitle(pageLabel?: string) {
  const { name } = useBranding();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = pageLabel ? `${pageLabel} — ${name}` : name;
  }, [name, pageLabel]);
}
