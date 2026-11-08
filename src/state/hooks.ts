'use client';
/**
 * React binding for the vanilla store. The only file in src/state allowed to import React.
 * React never re-renders per frame: select narrow slices, never `progress` in a hot component
 * unless it is the scrubber itself.
 */
import { useStore } from 'zustand';
import { appStore, type AppStoreState } from './store';

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  return useStore(appStore, selector);
}
