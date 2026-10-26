
import React from 'react';
// FIX: Imported all necessary types from the newly defined types.ts to resolve multiple import errors.
import { GameState, GameContext, ChatMessage, SaveFile, DBSaveSlotInfo, Item, Location, NPC, PlayerCharacter, Faction, WorldEvent, Cinematic, Combatant } from '../../types';
import { saveGameToFile, loadGameFromFile, saveToDB, loadFromDB, getAutosaveTimestampFromDB, saveToDBSlot, loadFromDBSlot, listDBSlots, deleteDBSlot } from '../../utils/fileManager';

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
        cleanupNetwork,
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
        cleanupNetwork: () => void,
        setIsSaving: React.Dispatch<React.SetStateAction<boolean>>,
    }
) => {
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
        }

        return rawSaveData;
    };

    const autosave = async (saveData: SaveFile) => {
        if (saveData) {
            try {
                await saveToDB(saveData);
                setAutosaveTimestamp(saveData.timestamp);
            } catch (e) {
                console.error("Autosave to DB failed", e);
            }
        }
    };

    const saveGame = async () => {
        setIsSaving(true);
        try {
            // Manual save - Perform GC (true)
            const saveData = packageSaveData(gameStateRef.current!, true);
            if (saveData) {
                await saveGameToFile(saveData, t);
            }
        } catch (e) {
            console.error("Save game to file failed", e);
            alert(t('Failed to save game.'));
        } finally {
            setIsSaving(false);
        }
    };

    const loadGame = async (): Promise<boolean> => {
        // ФИКС: НЕ очищать сеть если это сетевая игра
        const currentGameState = gameStateRef.current;
        if (!currentGameState || currentGameState.networkRole === 'none') {
            console.log("🔌 CLEANUP: Cleaning up network for local game load");
            cleanupNetwork();
        } else {
            console.log("🌐 NETWORK: Preserving network connection for multiplayer game");
        }

        const data = await loadGameFromFile(t);
        if (data) {
            restoreFromSaveData(data);
            return true;
        }
        return false;
    };

    const loadAutosave = async (): Promise<boolean> => {
        // ФИКС: НЕ очищать сеть если это сетевая игра
        const currentGameState = gameStateRef.current;
        if (!currentGameState || currentGameState.networkRole === 'none') {
            console.log("🔌 CLEANUP: Cleaning up network for local autosave load");
            cleanupNetwork();
        } else {
            console.log("🌐 NETWORK: Preserving network connection for multiplayer autosave");
        }

        const data = await loadFromDB();
        if (data) {
            restoreFromSaveData(data);
            return true;
        }
        alert(t("No autosave data found."));
        return false;
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
                await saveToDBSlot(slotId, saveData);
                await refreshDbSaveSlots();
                alert(t('Game saved to slot {slotId}.', { slotId }));
            }
        } catch(e) {
            console.error("Save to slot failed", e);
            alert(t('Failed to save game.'));
        } finally {
            setIsSaving(false);
        }
    };

    const loadGameFromSlot = async (slotId: number): Promise<boolean> => {
        // ФИКС: НЕ очищать сеть если это сетевая игра
        const currentGameState = gameStateRef.current;
        if (!currentGameState || currentGameState.networkRole === 'none') {
            console.log("🔌 CLEANUP: Cleaning up network for slot load");
            cleanupNetwork();
        } else {
            console.log("🌐 NETWORK: Preserving network connection for multiplayer slot load");
        }

        try {
            const data = await loadFromDBSlot(slotId);
            if (data) {
                restoreFromSaveData(data);
                return true;
            }
            alert(t('No data found in this slot.'));
            return false;
        } catch (e) {
            console.error("Load from slot failed", e);
            alert(t('Failed to load game.'));
            return false;
        }
    };

    const deleteGameSlot = async (slotId: number) => {
        try {
            await deleteDBSlot(slotId);
            await refreshDbSaveSlots();
            alert(t('Save slot {slotId} deleted.', { slotId }));
        } catch(e) {
            console.error("Delete slot failed", e);
            alert(t('Failed to delete save slot.'));
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
