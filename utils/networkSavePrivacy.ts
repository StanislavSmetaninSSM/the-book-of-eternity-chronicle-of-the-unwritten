import type { SaveFile } from '../types';

/** Remove the local YouTube credential from the settings sent to a peer.
 * This does not attempt to redact arbitrary user-authored text or media. */
export function networkSafeSaveFile(save: SaveFile): SaveFile {
    const { youtubeApiKey: _localKey, ...settings } = save.gameContext.gameSettings;
    return { ...save, gameContext: { ...save.gameContext, gameSettings: settings } };
}
