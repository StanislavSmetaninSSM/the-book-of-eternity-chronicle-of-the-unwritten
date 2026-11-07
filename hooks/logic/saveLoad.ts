
import React from 'react';
// FIX: Imported all necessary types from the newly defined types.ts to resolve multiple import errors.
import { GameState, GameContext, ChatMessage, SaveFile, DBSaveSlotInfo, Item, Location, NPC, PlayerCharacter, Faction, WorldEvent, Cinematic, Combatant } from '../../types';
import { prepareSaveFiles, loadSaveBundleFromFiles, saveToDB, loadFromDB, getAutosaveTimestampFromDB, saveToDBSlot, loadFromDBSlot, listDBSlots, deleteDBSlot } from '../../utils/fileManager';
import { applyImageBudget, MAX_IMAGES_PER_SAVE, MAX_IMAGE_BYTES_PER_SAVE } from '../../utils/saveImageBudget';
import { notifyError, notifySuccess, notifyWarning } from '../../utils/notifications';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

export const createSaveLoadManager = (
    {
        gameContextRef,
        gameStateRef,
        gameHistory,
        gameLog,
        combatLog,
        lastJsonResponse,
        sceneImagePrompt,
        restoreFromSaveData,
        t,
        setAutosaveTimestamp,
        setDbSaveSlots,
        beginLocalLoad,
        setIsSaving
    }: {
        gameContextRef: React.MutableRefObject<GameContext | null>,
        gameStateRef: React.MutableRefObject<GameState | null>,
        gameHistory: ChatMessage[],
        gameLog: string[],
        combatLog: string[],
        lastJsonResponse: string | null,
        sceneImagePrompt: string | null,
        restoreFromSaveData: (data: SaveFile) => void,
        t: TFunction,
        setAutosaveTimestamp: React.Dispatch<React.SetStateAction<string | null>>,
        setDbSaveSlots: React.Dispatch<React.SetStateAction<DBSaveSlotInfo[]>>,
        beginLocalLoad: () => (() => boolean) | null,
        setIsSaving: React.Dispatch<React.SetStateAction<boolean>>,
    }
) => {
    const informMissingImages = (count: number) => {
        notifyWarning(t('Some images were not found: import the images file together with the save ({count}).', { count }));
    };

    const packageSaveData = (gameState: GameState, performGC: boolean = true): SaveFile | null => {
        if (!gameContextRef.current || !gameState) {
            return null;
        }

        const rawSaveData: SaveFile = {
            gameContext: gameContextRef.current,
            gameState: gameState,
            gameHistory: gameHistory,
            gameLog: gameLog,
            combatLog: combatLog,
            lastJsonResponse: lastJsonResponse,
            sceneImagePrompt: sceneImagePrompt,
            timestamp: new Date().toISOString(),
        };

        // Some short-lived sync payloads keep the full image cache to avoid dropping assets mid-transfer.
        if (!performGC) {
            return rawSaveData;
        }

        // --- IMAGE CACHE GARBAGE COLLECTION ---
        // Identify all image prompts currently active in the game state to filter out unused background images from previous turns.
        const activePrompts = new Set<string>();

        const addPrompt = (p: string | null | undefined) => {
            if (p && typeof p === 'string') {
                activePrompts.add(p.trim());
            }
        };

        // 1. Current Scene
        addPrompt(sceneImagePrompt);

        // Helper to scan Items
        const scanItem = (item: Item) => {
            addPrompt(item.image_prompt);
            addPrompt(item.custom_image_prompt);
            addPrompt(item.pending_image_prompt);
            if (item.fateCards) {
                item.fateCards.forEach(card => {
                    addPrompt(card.image_prompt);
                });
            }
        };

        // Helper to scan Characters (Player/NPC)
        const scanCharacter = (char: PlayerCharacter | NPC) => {
            addPrompt(char.image_prompt);
            addPrompt(char.pending_image_prompt);
            if ((char as any).custom_image_prompt) addPrompt((char as any).custom_image_prompt);
            if ((char as any).portrait) addPrompt((char as any).portrait);
            
            if (char.inventory) {
                char.inventory.forEach(scanItem);
            }
            if ('fateCards' in char && char.fateCards) {
                char.fateCards.forEach(card => {
                    addPrompt(card.image_prompt);
                });
            }
        };

        // Helper to scan Combatants (Enemies/Allies)
        const scanCombatant = (combatant: Combatant) => {
             addPrompt(combatant.image_prompt);
        };

        // Helper to scan Locations
        const scanLocation = (loc: Location) => {
            addPrompt(loc.image_prompt);
            addPrompt(loc.custom_image_prompt);
            addPrompt(loc.pending_image_prompt);
            if (loc.locationStorages) {
                loc.locationStorages.forEach(storage => {
                    addPrompt(storage.image_prompt);
                    if (storage.contents) {
                        storage.contents.forEach(scanItem);
                    }
                });
            }
        };

        // Helper to scan Factions
        const scanFaction = (faction: Faction) => {
            addPrompt(faction.image_prompt);
            addPrompt(faction.custom_image_prompt);
            addPrompt(faction.pending_image_prompt);
        };

        // Scan Players
        if (gameState.playerCharacter) scanCharacter(gameState.playerCharacter);
        if (gameState.players) gameState.players.forEach(scanCharacter);

        // Scan NPCs
        if (gameState.encounteredNPCs) gameState.encounteredNPCs.forEach(scanCharacter);

        // Scan Factions
        if (gameState.encounteredFactions) gameState.encounteredFactions.forEach(scanFaction);

        // Scan Combatants (Enemies & Allies)
        if (gameState.enemiesData) gameState.enemiesData.forEach(scanCombatant);
        if (gameState.alliesData) gameState.alliesData.forEach(scanCombatant);

        // Scan Locations (Current, Visited, World Map)
        if (gameState.currentLocationData) scanLocation(gameState.currentLocationData);
        if (rawSaveData.gameContext.visitedLocations) rawSaveData.gameContext.visitedLocations.forEach(scanLocation);
        if (rawSaveData.gameContext.worldMap) Object.values(rawSaveData.gameContext.worldMap).forEach(scanLocation);

        // Scan Stash
        if (gameState.temporaryStash) gameState.temporaryStash.forEach(scanItem);

        // NOTE: We explicitly DO NOT scan worldEventsLog. 
        // Old events in history should not keep their images alive in the cache forever.
        // This prevents bloat and ensures "past background scenes" are cleaned up.

        // Scan Cinematics
        if (gameState.cinematics) {
            gameState.cinematics.forEach(cinema => {
                if (cinema.frames) {
                    cinema.frames.forEach(frame => {
                        addPrompt(frame.imagePrompt);
                    });
                }
            });
        }

        // Filter the cache
        if (gameState.imageCache) {
            const cleanedCache: any = {};
            let keptCount = 0;
            let removedCount = 0;

            Object.entries(gameState.imageCache).forEach(([key, entry]) => {
                // Check if the key itself is a prompt that is active
                // Also handle 'custom-portrait' keys or data URLs which might be keys themselves
                // Note: 'entry' might be string (legacy) or ImageCacheEntry object
                
                const src = typeof entry === 'string' ? entry : entry.src;
                
                // We keep it if the KEY matches a prompt we found (trimmed), 
                // OR if it's a custom uploaded data string that matches a prompt/src we found.
                // Often the 'key' in the cache IS the prompt.
                
                if (activePrompts.has(key.trim()) || activePrompts.has(src.trim())) {
                    cleanedCache[key] = entry;
                    keptCount++;
                } else {
                    removedCount++;
                }
            });

            // Update the gameState in the save object (don't mutate the live state ref)
            rawSaveData.gameState = {
                ...gameState,
                imageCache: cleanedCache
            };
            
            console.log(`Image Cache GC: Kept ${keptCount}, Removed ${removedCount} unused images.`);

            // Even the surviving images are base64 payloads that every slot copy and
            // checkpoint duplicates, so a single save is kept within a hard budget.
            const budgeted = applyImageBudget(cleanedCache, {
                maxEntries: MAX_IMAGES_PER_SAVE,
                maxBytes: MAX_IMAGE_BYTES_PER_SAVE,
                priorityKeys: [sceneImagePrompt, gameState.playerCharacter?.image_prompt],
            });
            if (budgeted.omittedCount > 0) {
                console.warn(`Save image budget: kept ${budgeted.keptKeys.length} images, omitted ${budgeted.omittedCount} (${Math.round(budgeted.bytes / 1024)} KB).`);
                rawSaveData.gameState = {
                    ...rawSaveData.gameState,
                    imageCache: budgeted.cache as typeof cleanedCache
                };
                rawSaveData.omittedImageCount = budgeted.omittedCount;
            }
        }

        return rawSaveData;
    };

    const autosave = async (saveData: SaveFile) => {
        if (saveData) {
            try {
                const result = await saveToDB(saveData);
                setAutosaveTimestamp(saveData.timestamp);
                if (result?.imagesOmittedForQuota) {
                    notifyWarning(t('autosave_images_dropped'));
                }
            } catch (e) {
                console.error("Autosave to DB failed", e);
                notifyWarning(t('Failed to save game.'));
            }
        }
    };

    const saveGame = async () => {
        setIsSaving(true);
        try {
            const currentGameState = gameStateRef.current;
            if (!currentGameState) throw new Error('The current game state is not available.');

            // Manual save - Perform GC (true).
            const saveData = packageSaveData(currentGameState, true);
            if (!saveData) throw new Error('The game context is not ready to save.');
            if (saveData.omittedImageCount) {
                notifyWarning(t('save_images_trimmed', { count: saveData.omittedImageCount }));
            }
            // Do not call showSaveFilePicker here: Arena runs this UI in a
            // cross-origin iframe. Return Blob URLs for real clickable links: one
            // portable file and a save/images pair that mirrors the in-app storage.
            return await prepareSaveFiles(saveData);
        } catch (e) {
            console.error("Save game file preparation failed", e);
            notifyError(t('Failed to save game.') + ` ${e instanceof Error ? e.message : e}`);
            return null;
        } finally {
            setIsSaving(false);
        }
    };

    const loadGame = async (): Promise<boolean> => {
        const canCommit = beginLocalLoad();
        if (!canCommit) return false;
        const result = await loadSaveBundleFromFiles(t);
        if (!result || !canCommit()) return false;
        if (result.missingImages > 0) {
            informMissingImages(result.missingImages);
        } else if (result.imagesImported > 0) {
            notifySuccess(t('Imported images: {count}.', { count: result.imagesImported }));
        }
        try { restoreFromSaveData(result.saveData); return true; }
        catch (e) { notifyError(t('Failed to load game.') + ` ${e instanceof Error ? e.message : e}`); return false; }
    };

    const loadAutosave = async (): Promise<boolean> => {
        const canCommit = beginLocalLoad();
        if (!canCommit) return false;
        const data = await loadFromDB();
        if (!data) { notifyWarning(t("No autosave data found.")); return false; }
        if (!canCommit()) return false;
        try { restoreFromSaveData(data); return true; }
        catch (e) { notifyError(t('Failed to load game.') + ` ${e instanceof Error ? e.message : e}`); return false; }
    };

    const refreshDbSaveSlots = async () => {
        try {
            const slots = await listDBSlots();
            setDbSaveSlots(slots);
        } catch (e) {
            console.error("Failed to refresh DB save slots", e);
        }
    };

    const saveGameToSlot = async (slotId: number) => {
        setIsSaving(true);
        try {
            // Manual save to slot - Perform GC (true)
            const saveData = packageSaveData(gameStateRef.current!, true);
            if (saveData) {
                if (saveData.omittedImageCount) {
                    notifyWarning(t('save_images_trimmed', { count: saveData.omittedImageCount }));
                }
                await saveToDBSlot(slotId, saveData);
                await refreshDbSaveSlots();
                notifySuccess(t('Game saved to slot {slotId}.', { slotId }));
            }
        } catch(e) {
            console.error("Save to slot failed", e);
            notifyError(t('Failed to save game.'));
        } finally {
            setIsSaving(false);
        }
    };

    const loadGameFromSlot = async (slotId: number): Promise<boolean> => {
        const canCommit = beginLocalLoad();
        if (!canCommit) return false;
        try {
            const data = await loadFromDBSlot(slotId);
            if (!data) { notifyWarning(t('No data found in this slot.')); return false; }
            if (!canCommit()) return false;
            restoreFromSaveData(data);
            return true;
        } catch (e) {
            console.error("Load from slot failed", e);
            notifyError(t('Failed to load game.') + ` ${e instanceof Error ? e.message : e}`);
            return false;
        }
    };

    const deleteGameSlot = async (slotId: number) => {
        try {
            await deleteDBSlot(slotId);
            await refreshDbSaveSlots();
            notifySuccess(t('Save slot {slotId} deleted.', { slotId }));
        } catch(e) {
            console.error("Delete slot failed", e);
            notifyError(t('Failed to delete save slot.'));
        }
    };

    return {
        packageSaveData,
        autosave,
        saveGame,
        loadGame,
        loadAutosave,
        saveGameToSlot,
        loadGameFromSlot,
        deleteGameSlot,
        refreshDbSaveSlots
    };
};
