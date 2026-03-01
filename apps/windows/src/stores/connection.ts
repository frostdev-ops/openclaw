import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { PresenceEntry, HealthSnapshot } from '../gateway/types';

interface PresenceState {
  entries: PresenceEntry[];
  set: (entries: PresenceEntry[]) => void;
  upsert: (entry: PresenceEntry) => void;
  remove: (key: string) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  entries: [],
  set: (entries) => set({ entries }),
  upsert: (entry) =>
    set((state) => {
      const idx = state.entries.findIndex((e) => e.key === entry.key);
      if (idx >= 0) {
        const next = [...state.entries];
        next[idx] = entry;
        return { entries: next };
      }
      return { entries: [...state.entries, entry] };
    }),
  remove: (key) =>
    set((state) => ({
      entries: state.entries.filter((e) => e.key !== key),
    })),
}));

interface HealthState {
  snapshot: HealthSnapshot | null;
  set: (snapshot: HealthSnapshot) => void;
}

export const useHealthStore = create<HealthState>((set) => ({
  snapshot: null,
  set: (snapshot) => set({ snapshot }),
}));

// Subscribe to Tauri gateway events and populate stores
let _subscribed = false;

export function subscribeGatewayEvents() {
  if (_subscribed) {return;}
  _subscribed = true;

  void listen<{ type: string; payload: unknown }>("gateway-event", (event) => {
    const { type, payload } = event.payload;

    switch (type) {
      case "presence.joined":
      case "presence.updated": {
        const entry = payload as PresenceEntry;
        usePresenceStore.getState().upsert(entry);
        break;
      }
      case "presence.left": {
        const { key } = payload as { key: string };
        usePresenceStore.getState().remove(key);
        break;
      }
      case "health.updated": {
        const snapshot = payload as HealthSnapshot;
        useHealthStore.getState().set(snapshot);
        break;
      }
    }
  });
}
