import type { AppState } from "./types";

const STORAGE_KEY = "site-10-layer-check:web-app-shell:v1";

export function loadState(fallback: AppState): AppState {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;

  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
