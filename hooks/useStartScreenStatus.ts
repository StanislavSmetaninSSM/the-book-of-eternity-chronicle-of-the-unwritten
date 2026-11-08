import { useCallback, useEffect, useState } from 'react';
import {
  getAutosaveTimestampFromDB,
  getCrashRecoveryMarker,
  getCrashRecoveryMetadata,
  listDBSlots,
  loadInterruptedTurnRecovery,
  migrateInlineImagesToImageStore,
  type CrashRecoveryMarker,
  type CrashRecoveryMetadata,
  type InterruptedTurnRecovery,
} from '../utils/fileManager';
import type { DBSaveSlotInfo } from '../types';

export interface StartScreenStatus {
  autosaveTimestamp: string | null;
  crashRecoveryInfo: CrashRecoveryMetadata | null;
  crashRecoveryMarker: CrashRecoveryMarker | null;
  interruptedTurnRecovery: InterruptedTurnRecovery | null;
  dbSaveSlots: DBSaveSlotInfo[];
}

const emptyStatus: StartScreenStatus = {
  autosaveTimestamp: null,
  crashRecoveryInfo: null,
  crashRecoveryMarker: null,
  interruptedTurnRecovery: null,
  dbSaveSlots: [],
};

/**
 * The start screen needs its autosave, crash-recovery, interrupted-turn and slot state, and
 * those reads used to live inside the game hook. The shell reads them itself so the game host
 * (the hook, its managers and the in-game UI) can stay out of the first bundle.
 */
export const useStartScreenStatus = () => {
  const [status, setStatus] = useState<StartScreenStatus>(emptyStatus);

  const refresh = useCallback(async () => {
    try {
      const [autosaveTimestamp, interruptedTurnRecovery, dbSaveSlots] = await Promise.all([
        getAutosaveTimestampFromDB(),
        loadInterruptedTurnRecovery(),
        listDBSlots(),
      ]);
      setStatus({
        autosaveTimestamp,
        interruptedTurnRecovery,
        dbSaveSlots,
        crashRecoveryInfo: getCrashRecoveryMetadata(),
        crashRecoveryMarker: getCrashRecoveryMarker(),
      });
    } catch (error) {
      console.error('Failed to read the start screen save data', error);
    }
  }, []);

  useEffect(() => {
    // Older saves still carry base64 images inside the stored payload. The migration used to run
    // when the game mounted; it is a startup task, so the shell runs it before reading the state
    // the start screen shows.
    void (async () => {
      try {
        await migrateInlineImagesToImageStore();
      } catch (error) {
        console.error('Failed to migrate inline images into the image store', error);
      }
      await refresh();
    })();
  }, [refresh]);

  return { ...status, refresh };
};
