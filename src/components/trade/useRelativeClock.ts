"use client";

import { useSyncExternalStore } from "react";

// One shared 1s clock for relative timestamps ("12s ago"). The interval runs
// only while something is subscribed, and the server snapshot is 0 so
// server-rendered markup never depends on the current time.

const TICK_MS = 1000;
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      // Forget the frozen time so the next mount does not render a stale clock.
      now = 0;
    }
  };
}

function getSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

function getServerSnapshot(): number {
  return 0;
}

/** Current time in ms, refreshed every second (0 during server rendering). */
export function useRelativeClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
