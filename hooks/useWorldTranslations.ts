import { useEffect, useState } from 'react';
import {
  ensureAllWorldTranslations,
  ensureWorldTranslations,
  isWorldTranslationsLoaded,
  subscribeToWorldTranslations,
} from '../utils/localizationTranslations';

/**
 * Reports whether the dictionary of the active universe is loaded, and loads it if not.
 * Pass `undefined` while there is no game at all; pass `null` for a save that predates
 * the recorded universe (every dictionary is loaded then).
 */
export function useWorldTranslations(universe: string | null | undefined): boolean {
  const [ready, setReady] = useState(() => (universe === null ? false : isWorldTranslationsLoaded(universe)));

  useEffect(() => {
    let cancelled = false;
    const sync = () => { if (!cancelled) setReady(universe === null ? false : isWorldTranslationsLoaded(universe)); };
    const unsubscribe = subscribeToWorldTranslations(sync);
    sync();
    const task = universe === null ? ensureAllWorldTranslations() : ensureWorldTranslations(universe);
    task.then(sync).catch(error => {
      console.error('Could not prepare translations for the active universe', error);
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [universe]);

  return ready;
}
