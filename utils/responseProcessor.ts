




import { GameState, GameResponse, PlayerCharacter, Characteristics, GameSettings, Quest, Location, Item, NPC, Faction, ActiveSkill, PassiveSkill, SkillMastery, Wound, CustomState, WorldStateFlag, WorldEvent, Recipe, QuestUpdate, FactionChronicleUpdate, FactionBonusChange, FactionResourceChange, StructuredBonus, FactionCustomStateChange, UnlockedMemory, AdjacencyMapEntry, CompletedActivity, LocationStorage, ActiveThreat, Project, CompletedProject, FactionRankBranchChange, FactionRankBranch, NPCSkillChange, FactionRank, Effect, CompleteThreatActivity, NPCSkillMasteryChange, NPCPassiveSkillMasteryChange, EnemyCombatObject, AllyCombatObject, Combatant, InterNPCRelationshipChange, NpcRelationship, NpcPersonalQuest, NpcRelationshipLock } from '../types';
import { recalculateAllWeights } from './inventoryManager';
import { recalculateDerivedStats } from './gameContext';
import { generateFactionColor } from './colorUtils';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

const isObject = (item: any): item is object => {
    return (item && typeof item === 'object' && !Array.isArray(item));
};

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined);
  return [value];
};

const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const arrayMergeConfig: Record<string, { idField: string, nameField?: string, compositeKey?: (item: any) => string | undefined }> = {
    players: { idField: 'playerId' },
    activeQuests: { idField: 'questId', nameField: 'questName' },
    completedQuests: { idField: 'questId', nameField: 'questName' },
    questUpdates: { idField: 'questId', nameField: 'questName' },
    encounteredNPCs: { idField: 'NPCId', nameField: 'name' },
    NPCsData: { idField: 'NPCId', nameField: 'name' },
    NPCRelationshipChanges: { idField: 'NPCId', nameField: 'NPCName' },
    NPCJournals: { idField: 'NPCId', nameField: 'NPCName' },
    NPCEffectChanges: { idField: 'NPCId', nameField: 'NPCName' },
    // Wound IDs are scoped to the NPC; distinct new wounds without IDs must not merge.
    NPCWoundChanges: { idField: '', compositeKey: item => {
        const npc = item.NPCId || item.NPCName;
        return npc && item.woundId ? JSON.stringify([npc, item.woundId]) : undefined;
    } },
    NPCCustomStateChanges: { idField: 'NPCId', nameField: 'NPCName' },
    NPCActivityUpdates: { idField: 'NPCId', nameField: 'NPCName' },
    inventoryItemsData: { idField: 'existedId', nameField: 'name' },
    inventory: { idField: 'existedId', nameField: 'name' },
    moveInventoryItems: { idField: 'movedItemId', nameField: 'itemName' },
    encounteredFactions: { idField: 'factionId', nameField: 'name' },
    factionDataChanges: { idField: 'factionId', nameField: 'name' },
    skillMasteryChanges: { idField: 'skillName' },
    skillMasteryData: { idField: 'skillName' },
    activeProjects: { idField: 'projectId', nameField: 'projectName' },
    completedProjects: { idField: 'projectId', nameField: 'projectName' },
    worldEventsLog: { idField: 'eventId', nameField: 'headline' },
    customStateChanges: { idField: 'stateId', nameField: 'stateName' },
    playerCustomStates: { idField: 'stateId', nameField: 'stateName' },
    customStates: { idField: 'stateId', nameField: 'stateName' },
    thresholds: { idField: 'levelName' },
    // Wound names describe injuries, not identities: two cuts can be distinct.
    playerWounds: { idField: 'woundId' },
    wounds: { idField: 'woundId' },
    unlockedMemories: { idField: 'memoryId', nameField: 'title' },
    'ranks.branches': { idField: 'branchId', nameField: 'displayName' },
    ranks: { idField: '', nameField: 'rankNameMale' },
    objectives: { idField: 'objectiveId', nameField: 'description' },
    completedActivities: { idField: '', compositeKey: (item: any) => item.activityId ? `id:${item.activityId}` : `${item.activityName}_${item.completionTurn}` },
    activeSkills: { idField: 'skillName' },
    passiveSkills: { idField: 'skillName' },
    activeThreats: { idField: 'threatId', nameField: 'name' },
    activePlayerEffects: { idField: 'effectId' },
    activeEffects: { idField: 'effectId' },
    adjacencyMap: { idField: '', compositeKey: (item: any) => item.targetLocationId ? `id:${item.targetLocationId}` : `xy:${item.targetCoordinates?.x},${item.targetCoordinates?.y}` },
    worldStateFlags: { idField: 'flagId', nameField: 'displayName' },
    locationStorages: { idField: 'storageId' },
    newLocations: { idField: 'locationId', nameField: 'name' },
    npcRelationships: { idField: 'targetNpcId', nameField: 'targetNpcName' },
    personalQuests: { idField: 'questId', nameField: 'questName' },
    NPCQuestUpdates: { idField: 'NPCId', nameField: 'NPCName' },
    NPCGoalUpdates: { idField: 'NPCId', nameField: 'NPCName' },
    NPCRelationshipLockUpdates: { idField: 'NPCId', nameField: 'NPCName' },
    interNPCRelationshipChanges: { idField: 'sourceNpcId', nameField: 'sourceNpcName' },
    enemiesData: { idField: 'NPCId', nameField: 'name' },
    alliesData: { idField: 'NPCId', nameField: 'name' },
    actions: { idField: 'actionName' },
    resistances: { idField: 'resistanceName' }
};

const arrayReplaceKeys = new Set([
    'generatedEffects', 
    'canBeImprovedBy', 
    'bonuses', 
    'structuredBonuses', 
    'effects', 
    'combatEffect', 
    'equipmentSlot', 
    'disassembleTo',
    'dialogueOptions',
    'multipliers',
    'temporaryStash',
    'tags',
    'customProperties',
    'affectedFactions',
    'affectedLocations',
    'involvedNPCs',
    'months',
    'dayNames',
    'contentsPath',
    'activeSkillSortOrder',
    'passiveSkillSortOrder',
    'itemSortOrder',
    'personalNpcReputations',
    'personalFactionReputations',
    'items',
    'metaResources',
    'strategicGoods',
    'factionAffiliations',
    'relations',
    'factionControl',
    'controlledTerritories',
    'fateCards',
    'associatedEffects',
    'eventDescriptions',
    'characterSubplots',
    'loomingThreatsOrOpportunities',
    'healthStates',
    'activeBuffs',
    'activeDebuffs',    
]);

const arrayConcatKeys = new Set(['itemJournalUpdates', 'combatLogEntries', 'gameLog', 'detailsLog', 'scribeChronicle', 'journalEntries', 'textContent']);

const mergeById = (arr1: any[], arr2: any[], idField: string, nameField?: string, compositeKey?: (item: any) => string | undefined, strictIdentity = false, matchOnlyExistingByName = false, allowInitialIdFallback = true) => {
    const mergedList = [...arr1];
    
    // GUARD: If arr2 is undefined/null or not an array, return the original list to prevent crashes.
    if (!arr2 || !Array.isArray(arr2)) {
        return mergedList;
    }

    const idIndex = new Map<string, number>();
    const nameIndex = new Map<string, number>();
    const initialIdIndex = new Map<string, number>();

    const indexItem = (item: any, idx: number) => {
        if (!isObject(item)) return;
        const typedItem = item as any;

        if (compositeKey) {
            const key = compositeKey(typedItem);
            if (key !== undefined) idIndex.set(key, idx);
            return;
        }

        if (idField && typedItem[idField]) {
            idIndex.set(String(typedItem[idField]), idx);
        }
        
        if (nameField && typedItem[nameField]) {
            nameIndex.set(String(typedItem[nameField]), idx);
        }

        if (typedItem.initialId) {
            initialIdIndex.set(String(typedItem.initialId), idx);
        }
    };

    mergedList.forEach((item, idx) => indexItem(item, idx));

    for (const item of arr2) {
        if (!isObject(item)) {
            mergedList.push(item);
            continue;
        }
        const typedItem = item as any; // Explicit cast to any to avoid TS errors on dynamic property access

        let matchIndex: number | undefined;

        if (compositeKey) {
            const key = compositeKey(typedItem);
            if (key !== undefined) matchIndex = idIndex.get(key);
        } else {
            if (idField && typedItem[idField]) {
                matchIndex = idIndex.get(String(typedItem[idField]));
            }
            
            if (matchIndex === undefined && nameField && typedItem[nameField]) {
                if (strictIdentity) {
                    const candidates = mergedList.map((value, index) => ({ value, index })).filter(({ value, index }) =>
                        (!matchOnlyExistingByName || index < arr1.length) &&
                        value?.[nameField] === typedItem[nameField] &&
                        !(typedItem[idField] && value[idField] && typedItem[idField] !== value[idField]) &&
                        !(typedItem.initialId && value.initialId && typedItem.initialId !== value.initialId));
                    if (candidates.length === 1) matchIndex = candidates[0].index;
                } else {
                    matchIndex = nameIndex.get(String(typedItem[nameField]));
                }
            }

            if (matchIndex === undefined && allowInitialIdFallback && typedItem.initialId) {
                const initialMatch = initialIdIndex.get(String(typedItem.initialId));
                if (initialMatch !== undefined && (!strictIdentity || !typedItem[idField] || !mergedList[initialMatch]?.[idField] || typedItem[idField] === mergedList[initialMatch][idField])) {
                    matchIndex = initialMatch;
                }
            }
        }

        if (matchIndex !== undefined) {
            mergedList[matchIndex] = deepMergeResponses(mergedList[matchIndex], typedItem);
            indexItem(mergedList[matchIndex], matchIndex);
        } else {
            const newIdx = mergedList.push(typedItem) - 1;
            indexItem(typedItem, newIdx);
        }
    }

    return mergedList;
};

// New locations and items can share names. Merge stage fragments only when
// a shared ID or turn-local tag identifies the same entity; retain conflicts.
const mergeIdentifiedStageEntities = (existing: any[], incoming: any[], idField: string): any[] => {
    const result = [...existing];
    for (const item of incoming) {
        if (!isObject(item)) { result.push(item); continue; }
        const location = item as any;
        const candidates = result.map((value, index) => ({ value, index })).filter(({ value }) => {
            if (!isObject(value)) return false;
            const other = value as any;
            const sharedId = location[idField] && other[idField] && location[idField] === other[idField];
            const sharedTag = location.initialId && other.initialId && location.initialId === other.initialId;
            const conflictingId = location[idField] && other[idField] && location[idField] !== other[idField];
            const conflictingTag = location.initialId && other.initialId && location.initialId !== other.initialId;
            return (sharedId || sharedTag) && !conflictingId && !conflictingTag;
        });
        if (candidates.length === 1) {
            const index = candidates[0].index;
            result[index] = deepMergeResponses(result[index], item);
        } else {
            result.push(item);
        }
    }
    return result;
};

// A temporary item tag pointing at multiple explicit IDs cannot identify an
// ID-less fragment. Keep explicitly addressed updates; reject only the unsafe
// fragment instead of assigning it to whichever declaration appeared first.
const splitAmbiguousItemFragments = (items: Partial<Item>[]) => {
    const idsByTag = new Map<string, Set<string>>();
    const fullNamesByTag = new Map<string, Set<string>>();
    for (const item of items) {
        if (typeof item?.initialId !== 'string' || !item.initialId) continue;
        if (typeof item.existedId === 'string' && item.existedId) {
            const ids = idsByTag.get(item.initialId) || new Set<string>();
            ids.add(item.existedId);
            idsByTag.set(item.initialId, ids);
        } else if (typeof item.name === 'string' && item.name.trim() &&
            typeof item.description === 'string' && typeof item.image_prompt === 'string' &&
            typeof item.quality === 'string' && typeof item.count === 'number' &&
            typeof item.weight === 'number' && typeof item.volume === 'number') {
            // Two complete new declarations with distinct names under the same
            // tag may be separate items, not safely identifiable fragments.
            const names = fullNamesByTag.get(item.initialId) || new Set<string>();
            names.add(item.name.trim().toLocaleLowerCase());
            fullNamesByTag.set(item.initialId, names);
        }
    }
    const rejected: Partial<Item>[] = [];
    const accepted = items.filter(item => {
        if (item?.initialId && !item.existedId && ((idsByTag.get(item.initialId)?.size || 0) > 1 || (fullNamesByTag.get(item.initialId)?.size || 0) > 1)) {
            rejected.push(item);
            return false;
        }
        return true;
    });
    return { accepted, rejected };
};

// A healed wound has no next healing stage. Normalize only explicitly healed
// updates, preserving the general null-as-missing protection for GM responses.
const mergeWounds = (existing: Wound[], updates: Partial<Wound>[]): Wound[] => {
    const merged = mergeById(existing, updates, 'woundId') as Wound[];
    const healedIds = new Set(updates.filter(w => w?.woundId && w.healingState?.currentState === 'Healed').map(w => w.woundId));
    return merged.map(w => healedIds.has(w.woundId) && w.healingState?.currentState === 'Healed'
        ? { ...w, healingState: { ...w.healingState, nextState: null } }
        : w);
};

// Only an explicit, successfully merged Healed transition removes separately
// stored effects carrying that exact wound ID. Wound history is not modified.
const removeEffectsForHealedWounds = (effects: Effect[] | undefined, wounds: Wound[] | undefined, updates: Partial<Wound>[]): Effect[] => {
    const healed = new Set(updates.filter(u => u?.woundId && u.healingState?.currentState === 'Healed' &&
        wounds?.some(w => w.woundId === u.woundId && w.healingState?.currentState === 'Healed')).map(u => u.woundId));
    return (effects || []).filter(effect => !effect?.sourceWoundId || !healed.has(effect.sourceWoundId));
};

export const deepMergeResponses = (target: any, source: any): any => {
    const output = { ...target };

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            const sourceValue = source[key];
            const targetValue = output[key];

            if (sourceValue === undefined) {
                return;
            }

            if (sourceValue === null) {
                if (targetValue !== null && targetValue !== undefined) {
                    return;
                }
                output[key] = null;
                return;
            }

            if (key === 'inventoryTransfers') {
                // A bad top-level type is a malformed command, not a fragment
                // that later stages can repair by replacing it with an array.
                // Preserve it until final validation rejects the entire turn.
                if (targetValue != null && !Array.isArray(targetValue)) output[key] = targetValue;
                else if (!Array.isArray(sourceValue)) output[key] = sourceValue;
                else output[key] = Array.isArray(targetValue) ? targetValue.concat(sourceValue) : sourceValue;
                return;
            }

            if (Array.isArray(sourceValue)) {
                // Rule 13.7: an explicit empty combat roster ends the encounter;
                // unlike other empty arrays it is a command, not a no-op.
                if ((key === 'enemiesData' || key === 'alliesData') && sourceValue.length === 0) {
                    output[key] = [];
                    return;
                }
                if (Array.isArray(targetValue)) {
                    if (key === 'inventoryItemsData') {
                        // Preserve raw fragments until the complete turn is
                        // available: a later stage may reveal a conflicting tag.
                        output[key] = targetValue.concat(sourceValue);
                    } else if (key === 'newLocations') {
                        output[key] = mergeIdentifiedStageEntities(targetValue, sourceValue, 'locationId');
                    } else if (arrayReplaceKeys.has(key)) {
                        output[key] = sourceValue;
                    } else if (arrayConcatKeys.has(key)) {
                        output[key] = targetValue.concat(sourceValue);
                    } else if (sourceValue.every(item => typeof item !== 'object' || item === null)) {
                         const combined = targetValue.concat(sourceValue);
                         output[key] = [...new Set(combined.filter(item => item !== null && item !== undefined))];
                    } else {
                        const mergeConfig = arrayMergeConfig[key as keyof typeof arrayMergeConfig];
                        if (mergeConfig) {
                             // Threats with different IDs are distinct even when
                             // their names match. Name-only fallback may match an
                             // existing threat, not another new entry in this batch.
                             output[key] = mergeById(targetValue, sourceValue, mergeConfig.idField, mergeConfig.nameField, mergeConfig.compositeKey, key === 'NPCsData' || key === 'encounteredNPCs' || key === 'factionDataChanges' || key === 'encounteredFactions' || key === 'activeThreats', key === 'activeThreats');
                        } else {
                            output[key] = targetValue.concat(sourceValue);
                        }
                    }
                } else {
                    output[key] = sourceValue;
                }
            } else if (isObject(sourceValue)) {
                if (isObject(targetValue)) {
                    output[key] = deepMergeResponses(targetValue, sourceValue);
                } else {
                    output[key] = sourceValue;
                }
            } else {
                output[key] = sourceValue;
            }
        });
    } else if (isObject(source)) {
        return { ...source };
    }
    
    return output;
};

const experienceForLevelTransition = (level: number): number => {
    if (level < 1) return 100;
    const baseXP = 100;
    return Math.floor(baseXP * Math.pow(level, 2.5));
};

export function checkAndApplyLevelUp(pc: PlayerCharacter, t: TFunction): { pc: PlayerCharacter, logs: string[] } {
    const newPc = JSON.parse(JSON.stringify(pc));
    let leveledUp = false;
    let levelsGained = 0;
    const logs: string[] = [];

    let currentExperience = Number(newPc.experience);
    let experienceForNextLevel = Number(newPc.experienceForNextLevel);

    while (currentExperience >= experienceForNextLevel && experienceForNextLevel > 0) {
        leveledUp = true;
        levelsGained++;
        const prevLevelExp = experienceForNextLevel;
        newPc.level += 1;
        newPc.attributePoints = (newPc.attributePoints || 0) + 5;
        currentExperience -= prevLevelExp;
        
        experienceForNextLevel = experienceForLevelTransition(newPc.level);
    }

    if (leveledUp) {
        newPc.experience = currentExperience;
        newPc.experienceForNextLevel = experienceForNextLevel;
        if (levelsGained > 1) {
            logs.push(t("You have gained {levels} levels and reached Level {level}! You have {points} new attribute points to spend.", { levels: levelsGained, level: newPc.level, points: levelsGained * 5 }));
        } else {
            logs.push(t("You have reached Level {level}! You have 5 new attribute points to spend.", { level: newPc.level }));
        }
    }

    return { pc: newPc, logs };
}

function preProcessAndAssignIds(response: GameResponse, currentState: GameState, worldMap?: Record<string, Location>): GameResponse {
    const mutableResponse = response;

    // A turn-local tag may identify fragments of the same new item in one
    // response. Combine them before assigning individual permanent IDs.
    if (mutableResponse.inventoryItemsData) {
        mutableResponse.inventoryItemsData = mergeIdentifiedStageEntities([], asArray(mutableResponse.inventoryItemsData), 'existedId');
    }

    // --- 0. PRE-PROCESSING ID RESOLUTION (Match by Name) ---
    // Fix NPC Duplication: Attempt to match NPCs without IDs by name before assigning new ones.
    // This MUST happen before prompt preservation so we can find the existing NPC to check their current image.
    if (mutableResponse.NPCsData) {
        asArray(mutableResponse.NPCsData).forEach((npcUpdate: Partial<NPC>) => {
            if (!npcUpdate.NPCId && npcUpdate.name) {
                 // Try to find existing NPC by name to prevent duplication and allow updates
                 const existing = currentState.encounteredNPCs.find(n => n.name === npcUpdate.name);
                 if (existing) {
                     npcUpdate.NPCId = existing.NPCId;
                 }
            }
        });
    }

    // Safeguard against overwriting full NPC inventories with partial data.
    if (mutableResponse.NPCsData) {
        mutableResponse.NPCsData = asArray(mutableResponse.NPCsData).map((npcUpdate: Partial<NPC>) => {
            if (npcUpdate.NPCId && currentState.encounteredNPCs.some(n => n.NPCId === npcUpdate.NPCId)) {
                if (npcUpdate.inventory) {
                    console.warn(`[SAFEGUARD] An 'inventory' array was provided for an existing NPC ('${npcUpdate.name || npcUpdate.NPCId}'). This is a deprecated and dangerous operation. The inventory update for this NPC will be ignored to prevent data loss. Use atomic commands (NPCInventoryAdds, etc.) instead.`);
                    delete npcUpdate.inventory;
                }
            }
            return npcUpdate;
        });
    }

    // --- IMAGE PROMPT PRESERVATION LOGIC ---
    // Intercept updates that change 'image_prompt' and move them to 'pending_image_prompt'
    // if the entity already has an image. This prevents automatic visual updates.

    // 1. NPCs
    if (mutableResponse.NPCsData) {
        asArray(mutableResponse.NPCsData).forEach((npcUpdate: Partial<NPC>) => {
            if (npcUpdate.image_prompt) {
                // Now that IDs are resolved (Step 0), this lookup should work for Name-only updates too
                const existingNPC = currentState.encounteredNPCs.find(n => n.NPCId === npcUpdate.NPCId);
                if (existingNPC && existingNPC.image_prompt) {
                    // Move new prompt to pending
                    npcUpdate.pending_image_prompt = npcUpdate.image_prompt;
                    // Remove prompt from update so deepMerge doesn't overwrite existing
                    delete npcUpdate.image_prompt;
                }
            }
        });
    }

    // 2. Items (inventoryItemsData)
    if (mutableResponse.inventoryItemsData) {
        asArray(mutableResponse.inventoryItemsData).forEach((itemUpdate: Partial<Item>) => {
            if (itemUpdate.image_prompt && typeof itemUpdate.existedId === 'string' && itemUpdate.existedId.trim()) {
                // Only a real permanent ID can match a saved item; null IDs
                // on new and legacy items do not identify the same entity.
                // Check player inventory
                let existingItem = currentState.playerCharacter.inventory.find(i => i.existedId === itemUpdate.existedId);
                // Check NPC inventories if not found
                if (!existingItem) {
                    for (const npc of currentState.encounteredNPCs) {
                        existingItem = npc.inventory?.find(i => i.existedId === itemUpdate.existedId);
                        if (existingItem) break;
                    }
                }

                if (existingItem && existingItem.image_prompt) {
                     itemUpdate.pending_image_prompt = itemUpdate.image_prompt;
                     delete itemUpdate.image_prompt;
                }
            }
        });
    }

    // 3. Factions
    if (mutableResponse.factionDataChanges) {
        asArray(mutableResponse.factionDataChanges).forEach((factionUpdate: Partial<Faction>) => {
            if (factionUpdate.image_prompt) {
                const existingFaction = currentState.encounteredFactions.find(f => f.factionId === factionUpdate.factionId);
                if (existingFaction && existingFaction.image_prompt) {
                    factionUpdate.pending_image_prompt = factionUpdate.image_prompt;
                    delete factionUpdate.image_prompt;
                }
            }
        });
    }

    // 4. Locations (worldMapUpdates - locationUpdates)
    if (mutableResponse.worldMapUpdates?.locationUpdates) {
        asArray(mutableResponse.worldMapUpdates.locationUpdates).forEach((locUpdate: any) => {
             // Note: 'locationUpdate' structure might have flattened fields in the response object (e.g. newImagePrompt), 
             // but our types define it as LocationUpdate interface. The response actually sends 'image_prompt' inside the update object sometimes if structure allows.
             // Based on `updateWorldMap` function logic, it seems location updates usually use specific fields prefixed with 'new'.
             // However, if standard fields are used:
             if (locUpdate.image_prompt || locUpdate.newImagePrompt) { // Assuming newImagePrompt might be used
                 const prompt = locUpdate.image_prompt || locUpdate.newImagePrompt;
                 if (worldMap && locUpdate.locationId && worldMap[locUpdate.locationId]) {
                     const existingLoc = worldMap[locUpdate.locationId];
                     if (existingLoc.image_prompt) {
                         locUpdate.pending_image_prompt = prompt;
                         delete locUpdate.image_prompt;
                         delete locUpdate.newImagePrompt;
                     }
                 }
             }
        });
    }
    
    // 5. Current Location
    if (mutableResponse.currentLocationData && mutableResponse.currentLocationData.image_prompt) {
         const currentLoc = currentState.currentLocationData;
         // Check if we are updating the SAME location (ID match) or if it's a new location description for the same ID
         if (currentLoc.locationId && mutableResponse.currentLocationData.locationId === currentLoc.locationId && currentLoc.image_prompt) {
             mutableResponse.currentLocationData.pending_image_prompt = mutableResponse.currentLocationData.image_prompt;
             delete mutableResponse.currentLocationData.image_prompt;
         }
    }

    const assignIdIfNeeded = (items: any[] | undefined | null, idField: string, prefix: string) => {
        asArray(items).forEach(item => {
            if (item && (item[idField] === null || item[idField] === undefined)) {
                item[idField] = generateId(prefix);
            }
        });
    };

    // Top-level entities that need IDs
    assignIdIfNeeded(asArray(mutableResponse.inventoryItemsData), 'existedId', 'item');
    assignIdIfNeeded(asArray(mutableResponse.questUpdates), 'questId', 'quest');
    
    // Fix NPC Duplication: Attempt to match NPCs without IDs by name before assigning new ones
    asArray(mutableResponse.NPCsData).forEach(npcUpdate => {
        if (!npcUpdate.NPCId && npcUpdate.name) {
             const existing = currentState.encounteredNPCs.find(n => n.name === npcUpdate.name);
             if (existing) {
                 npcUpdate.NPCId = existing.NPCId;
             }
        }
    });
    assignIdIfNeeded(asArray(mutableResponse.NPCsData), 'NPCId', 'npc');
    
    assignIdIfNeeded(asArray(mutableResponse.factionDataChanges), 'factionId', 'faction');
    assignIdIfNeeded(asArray(mutableResponse.worldEventsLog), 'eventId', 'event');
    assignIdIfNeeded(asArray(mutableResponse.playerWoundChanges), 'woundId', 'wound');
    assignIdIfNeeded(asArray(mutableResponse.playerActiveEffectsChanges), 'effectId', 'effect');
    assignIdIfNeeded(asArray(mutableResponse.customStateChanges), 'stateId', 'state');
    assignIdIfNeeded(asArray(mutableResponse.worldStateFlags), 'flagId', 'flag');

    // Generic combatants have no NPC record; their wounds live on the
    // combatant and still need stable, distinct IDs before the next turn.
    [...asArray(mutableResponse.enemiesData), ...asArray(mutableResponse.alliesData)].forEach(combatant => {
        if (!combatant?.NPCId) assignIdIfNeeded(asArray(combatant?.wounds), 'woundId', 'wound');
    });

    // Nested entities
    asArray(mutableResponse.questUpdates).forEach(quest => {
        assignIdIfNeeded(quest.objectives, 'objectiveId', 'obj');
    });

    asArray(mutableResponse.NPCsData).forEach(npc => {
        assignIdIfNeeded(asArray(npc.inventory), 'existedId', 'item');
        assignIdIfNeeded(npc.customStates, 'stateId', 'state');
        assignIdIfNeeded(npc.fateCards, 'cardId', 'fate');
        assignIdIfNeeded(npc.unlockedMemories, 'memoryId', 'mem');
        assignIdIfNeeded(npc.wounds, 'woundId', 'wound');
        assignIdIfNeeded(npc.activeEffects, 'effectId', 'effect');
        assignIdIfNeeded(npc.personalQuests, 'questId', 'pq');
        asArray(npc.personalQuests).forEach(q => {
             assignIdIfNeeded(q.objectives, 'objectiveId', 'pq-obj');
        });
    });

    asArray(mutableResponse.factionDataChanges).forEach(faction => {
        assignIdIfNeeded(faction.structuredBonuses, 'bonusId', 'bonus');
        assignIdIfNeeded(faction.customStates, 'stateId', 'state');
        assignIdIfNeeded(faction.activeProjects, 'projectId', 'proj');
    });

    const processLocationForIds = (loc: Partial<Location>, assignThreatIds = true) => {
        if (!loc) return;
        assignIdIfNeeded(loc.locationStorages, 'storageId', 'storage');
        if (assignThreatIds) assignIdIfNeeded(loc.activeThreats, 'threatId', 'threat');
    };

    if (mutableResponse.worldMapUpdates) {
        assignIdIfNeeded(asArray(mutableResponse.worldMapUpdates.newLocations), 'locationId', 'loc');
        asArray(mutableResponse.worldMapUpdates.newLocations).forEach(loc => processLocationForIds(loc));
        // These are partial updates, so a missing threat ID can mean an
        // existing, uniquely named threat rather than a new entity.
        asArray(mutableResponse.worldMapUpdates.locationUpdates).forEach(loc => processLocationForIds(loc, false));
    }

    if (mutableResponse.currentLocationData) {
        if (!mutableResponse.currentLocationData.locationId) {
            const stateLoc = currentState.currentLocationData;
            const respLoc = mutableResponse.currentLocationData;
            
            let matchedId = null;
            
            // Helper to clean strings for loose comparison
            const clean = (s: string | undefined | null) => s ? s.toLowerCase().trim() : '';

            // 1. Try to find by NAME in worldMap (Master List)
            if (worldMap) {
                 const foundByName = Object.values(worldMap).find(l => clean(l.name) === clean(respLoc.name));
                 if (foundByName) {
                     matchedId = foundByName.locationId;
                 }
            }
            
            // 2. If not found by name, check against current location
            if (!matchedId) {
                 // We only reuse the current location ID if the name matches.
                 if (clean(stateLoc.name) === clean(respLoc.name)) {
                     matchedId = stateLoc.locationId;
                 }
            }
            
            mutableResponse.currentLocationData.locationId = matchedId || generateId('loc');
        }
        processLocationForIds(mutableResponse.currentLocationData);
    }

    // Older guide versions also described { NPCId, NPCName, wounds: [...] }.
    // Accept that form as well as the canonical flat objects before assigning IDs.
    if (mutableResponse.NPCWoundChanges) {
        mutableResponse.NPCWoundChanges = asArray(mutableResponse.NPCWoundChanges).flatMap((entry: any) => {
            if (!Array.isArray(entry?.wounds)) return [entry];
            const nested = entry.wounds.filter(isObject).map((wound: any) => ({
                ...wound, NPCId: entry.NPCId, NPCName: entry.NPCName
            }));
            if (entry.woundId || entry.woundName) {
                const { wounds: _nestedWounds, ...flatWound } = entry;
                return [flatWound, ...nested];
            }
            return nested;
        });
    }

    // NPC-targeted arrays
    assignIdIfNeeded(asArray(mutableResponse.NPCWoundChanges), 'woundId', 'wound');
    asArray(mutableResponse.NPCEffectChanges).forEach(c => assignIdIfNeeded(c.effectsApplied, 'effectId', 'effect'));
    asArray(mutableResponse.NPCCustomStateChanges).forEach(c => assignIdIfNeeded(c.stateChanges, 'stateId', 'state'));

    // Sentient item journals are added via a separate command, but items in NPCInventoryAdds need IDs.
    asArray(mutableResponse.NPCInventoryAdds).forEach(add => {
        assignIdIfNeeded([add.item], 'existedId', 'item');
    });
    
    // New NPC Quest logic needs IDs
    asArray(mutableResponse.NPCQuestUpdates).forEach(update => {
        assignIdIfNeeded(update.questsToAddOrUpdate, 'questId', 'pq');
        asArray(update.questsToAddOrUpdate).forEach(q => {
             assignIdIfNeeded(q.objectives, 'objectiveId', 'pq-obj');
        });
    });

    return mutableResponse;
}

function resolveInitialIds(obj: any, idMap: Map<string, string>, idKinds: Map<string, string>) {
    if (!obj) return;

    if (Array.isArray(obj)) {
        obj.forEach(item => resolveInitialIds(item, idMap, idKinds));
        return;
    }

    if (typeof obj === 'object') {
        const resolveReference = (source: string, destination: string, expectedKind: string) => {
            const tag = obj[source];
            if (!tag || !idMap.has(tag)) return;
            // An existing permanent target is authoritative. Historical objects
            // may retain an old turn-local tag; reusing it in a later response
            // must not redirect an already resolved relationship or location.
            if (source !== destination && obj[destination]) return;
            const actualKind = idKinds.get(tag);
            if (actualKind !== expectedKind) {
                // Fail before applying any state: an ID from another entity
                // type is never a safe substitute for the requested target.
                throw new Error(`Temporary reference "${tag}" in ${source} expects ${expectedKind}, but refers to ${actualKind || 'unknown'}`);
            }
            obj[destination] = idMap.get(tag);
        };

        resolveReference('initialFactionId', 'factionId', 'faction');
        resolveReference('initialLocationId', 'currentLocationId', 'loc');
        resolveReference('initialTargetLocationId', 'targetLocationId', 'loc');
        resolveReference('initialTargetNpcId', 'targetNpcId', 'npc');
        resolveReference('initialTargetFactionId', 'targetFactionId', 'faction');
        // This field can also hold a permanent ID or a sentinel such as
        // _clear_; only tags declared in this response need resolution.
        resolveReference('newBreakthroughQuestId', 'newBreakthroughQuestId', 'quest');

        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                resolveInitialIds(obj[key], idMap, idKinds);
            }
        }
    }
}

const findNpcForUpdate = (update: { NPCId?: string | null; name?: string; NPCName?: string }, npcs: NPC[]): NPC | undefined => {
    if (update.NPCId) {
        const matches = npcs.filter(n => n.NPCId === update.NPCId);
        return matches.length === 1 ? matches[0] : undefined;
    }
    const name = update.name || update.NPCName;
    if (!name) return undefined;
    const matches = npcs.filter(n => n.name === name);
    return matches.length === 1 ? matches[0] : undefined;
};

// Preserve unambiguous named-NPC health and independent combat effects before
// a later stage clears a combat roster. Use normal NPC update commands.
export const mergeStageResponses = (previous: any, next: any, context: { encounteredNPCs?: NPC[] }): any => {
    const merged = deepMergeResponses(previous, next);
    const cleared = ['enemiesData', 'alliesData'].filter(key => Array.isArray(next?.[key]) && next[key].length === 0);
    if (!cleared.length) return merged;
    const allPriorCombatants = [...asArray(previous?.enemiesData), ...asArray(previous?.alliesData)] as any[];
    const candidates = cleared.flatMap(key => asArray(previous?.[key])) as any[];
    const updates = [...asArray(merged.NPCsData)] as any[];
    const parseHealth = (value: unknown): number | undefined => {
        if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
        if (typeof value !== 'string' || !/^\d+(?:\.\d+)?%?$/.test(value.trim())) return undefined;
        return Number(value.trim().replace(/%$/, ''));
    };
    let changed = false;
    for (const combatant of candidates) {
        if (!combatant?.NPCId || combatant.isGroup || allPriorCombatants.filter(c => c?.NPCId === combatant.NPCId).length !== 1) continue;
        const matches = (context.encounteredNPCs || []).filter(n => n.NPCId === combatant.NPCId);
        if (matches.length !== 1) continue;
        const npc = matches[0];
        const matchingUpdates = updates.filter(u => u?.NPCId === npc.NPCId || (!u?.NPCId && u?.name === npc.name && (context.encounteredNPCs || []).filter(n => n.name === npc.name).length === 1));
        if (matchingUpdates.length > 1) continue;
        const existing = matchingUpdates[0];
        if (parseHealth(existing?.currentHealth) !== undefined) continue;
        const explicitMax = parseHealth(existing?.maxHealth);
        const health = typeof combatant.currentHealth === 'string' && /^\d+%$/.test(combatant.currentHealth.trim()) ? parseHealth(combatant.currentHealth) : undefined;
        const maxHealth = typeof combatant.maxHealth === 'string' && /^\d+%$/.test(combatant.maxHealth.trim()) ? parseHealth(combatant.maxHealth) : undefined;
        if (health === undefined || maxHealth !== npc.maxHealth || (explicitMax !== undefined && explicitMax !== maxHealth) || health > maxHealth) continue;
        if (existing) updates[updates.indexOf(existing)] = { ...existing, currentHealth: health };
        else updates.push({ NPCId: npc.NPCId, name: npc.name, currentHealth: health });
        changed = true;
    }
    if (changed) merged.NPCsData = updates;

    const effectUpdates = [...asArray(merged.NPCEffectChanges)] as any[];
    let effectsChanged = false;
    for (const combatant of candidates) {
        if (!combatant?.NPCId || combatant.isGroup || allPriorCombatants.filter(c => c?.NPCId === combatant.NPCId).length !== 1) continue;
        const npcs = (context.encounteredNPCs || []).filter(n => n.NPCId === combatant.NPCId);
        if (npcs.length !== 1) continue;
        const npc = npcs[0];
        const matching = effectUpdates.filter(u => u?.NPCId === npc.NPCId || (!u?.NPCId && u?.NPCName === npc.name && (context.encounteredNPCs || []).filter(n => n.name === npc.name).length === 1));
        if (matching.length > 1) continue;
        const existing = matching[0];
        const reported = [...asArray(combatant.activeBuffs), ...asArray(combatant.activeDebuffs)] as any[];
        // Only mint an ID for an independently described effect that cannot
        // already be the same stored or explicitly reported effect. Duration is
        // deliberately excluded from the identity comparison because it ticks.
        const signature = (e: any) => JSON.stringify([e?.effectType, e?.targetType, e?.value, e?.description, e?.sourceSkill || null]);
        const mintable = reported.filter(effect => effect && !effect.effectId && !effect.sourceWoundId &&
            typeof effect.duration === 'number' && Number.isFinite(effect.duration) && effect.duration > 0 &&
            typeof effect.effectType === 'string' && !!effect.effectType && typeof effect.targetType === 'string' && !!effect.targetType &&
            typeof effect.value === 'string' && typeof effect.description === 'string' && !!effect.description &&
            reported.filter(e => signature(e) === signature(effect)).length === 1 &&
            !(npc.activeEffects || []).some(e => signature(e) === signature(effect)) &&
            !asArray(existing?.effectsApplied).some(e => signature(e) === signature(effect)));
        const allowed = reported.filter(effect => effect && typeof effect.effectId === 'string' && effect.effectId && !effect.sourceWoundId &&
            typeof effect.duration === 'number' && Number.isFinite(effect.duration) && effect.duration > 0 &&
            typeof effect.effectType === 'string' && typeof effect.targetType === 'string' && typeof effect.value === 'string' &&
            typeof effect.description === 'string' && reported.filter(e => e?.effectId === effect.effectId).length === 1 &&
            !asArray(existing?.effectsToRemove).includes(effect.effectId) &&
            !asArray(existing?.effectsApplied).some((e: any) => e?.effectId === effect.effectId));
        // A reported duration of zero is an explicit expiration, not merely an
        // absent effect. Remove only the same identified effect already on this
        // NPC, and never override an explicit later application or a wound.
        const expired = reported.filter(effect => effect && typeof effect.effectId === 'string' && effect.effectId && !effect.sourceWoundId &&
            typeof effect.duration === 'number' && Number.isFinite(effect.duration) && effect.duration <= 0 &&
            reported.filter(e => e?.effectId === effect.effectId).length === 1 &&
            (npc.activeEffects || []).some(e => e.effectId === effect.effectId && !e.sourceWoundId) &&
            !asArray(existing?.effectsApplied).some((e: any) => e?.effectId === effect.effectId) &&
            !asArray(existing?.effectsToRemove).includes(effect.effectId)).map(effect => effect.effectId);
        if (!allowed.length && !mintable.length && !expired.length) continue;
        const update = { ...(existing || { NPCId: npc.NPCId, NPCName: npc.name }),
            ...(allowed.length || mintable.length ? { effectsApplied: [...asArray(existing?.effectsApplied), ...allowed, ...mintable.map(effect => ({ ...effect, effectId: generateId('effect') }))] } : {}),
            ...(expired.length ? { effectsToRemove: [...asArray(existing?.effectsToRemove), ...expired] } : {}) };
        if (existing) effectUpdates[effectUpdates.indexOf(existing)] = update;
        else effectUpdates.push(update);
        effectsChanged = true;
    }
    if (effectsChanged) merged.NPCEffectChanges = effectUpdates;
    return merged;
};

const findFactionForUpdate = (update: { factionId?: string | null, initialFactionId?: string | null, factionName?: string }, factions: Faction[]): Faction | undefined => {
    if (update.factionId) {
        const matches = factions.filter(f => f.factionId === update.factionId);
        return matches.length === 1 ? matches[0] : undefined;
    }
    // Tags are turn-local. A tag declared in this response was already
    // resolved to factionId above; never consult tags retained in old saves.
    if (update.initialFactionId) return undefined;
    if (!update.factionName) return undefined;
    const matches = factions.filter(f => f.name === update.factionName);
    return matches.length === 1 ? matches[0] : undefined;
};

const applySkillChanges = (npc: NPC, change: NPCSkillChange, isPassive: boolean) => {
    const skills = isPassive ? npc.passiveSkills || [] : npc.activeSkills || [];
    let newSkills = mergeById(skills, asArray(change.skillChanges), 'skillName');
    if (change.skillsToRemove) newSkills = newSkills.filter(s => !asArray(change.skillsToRemove).includes(s.skillName));
    if (isPassive) npc.passiveSkills = newSkills as PassiveSkill[]; else npc.activeSkills = newSkills as ActiveSkill[];
};

const applyChangesToPlayer = (player: PlayerCharacter, changes: Partial<GameResponse>, t: TFunction, gameSettings: GameSettings | null): { player: PlayerCharacter, logs: string[], rejectedNewItems: Partial<Item>[], acceptedNewItems: Partial<Item>[] } => {
    let newPlayer = JSON.parse(JSON.stringify(player));
    const logs: string[] = [];
    const rejectedNewItems: Partial<Item>[] = [];
    const acceptedNewItems: Partial<Item>[] = [];
    const itemsToAdd: Item[] = [];

    newPlayer.currentHealth = Math.max(0, newPlayer.currentHealth + (changes.currentHealthChange || 0));
    let totalEnergyChange = changes.currentEnergyChange || 0;
    if (changes.calculatedWeightData?.additionalEnergyExpenditure) {
        totalEnergyChange -= changes.calculatedWeightData.additionalEnergyExpenditure;
        logs.push(t('energy_lost_overload', { amount: changes.calculatedWeightData.additionalEnergyExpenditure }));
    }
    newPlayer.currentEnergy = Math.max(0, newPlayer.currentEnergy + totalEnergyChange);
    newPlayer.money += changes.moneyChange || 0;
    newPlayer.experience += changes.experienceGained || 0;

    if (changes.statsIncreased) {
        const statCap = newPlayer.level * 2;
        asArray(changes.statsIncreased).forEach(charName => {
            const charKey = `standard${charName.charAt(0).toUpperCase() + charName.slice(1)}` as keyof Characteristics;
            const currentStatValue = newPlayer.characteristics[charKey] as number;

            if (currentStatValue >= statCap) {
                const xpCompensation = Math.max(25, Math.round(newPlayer.experienceForNextLevel * 0.05));
                newPlayer.experience += xpCompensation;
                logs.push(t('stats_increased_capped', { 
                    statName: t(charName as any),
                    statCap: statCap,
                    xp: xpCompensation 
                }));
            } else {
                (newPlayer.characteristics[charKey] as number) += 1;
                logs.push(t('stats_increased_success', { statName: t(charName as any) }));
            }
        });
    }
    if (changes.statsDecreased) asArray(changes.statsDecreased).forEach(charName => { (newPlayer.characteristics[`standard${charName.charAt(0).toUpperCase() + charName.slice(1)}` as keyof Characteristics] as number) -= 1; });
    if (changes.setCharacteristics) for (const charName in changes.setCharacteristics) { (newPlayer.characteristics[`standard${charName.charAt(0).toUpperCase() + charName.slice(1)}` as keyof Characteristics] as number) = (changes.setCharacteristics as any)[charName]; }

    const levelUpResult = checkAndApplyLevelUp(newPlayer, t);
    newPlayer = levelUpResult.pc;
    logs.push(...levelUpResult.logs);
    newPlayer.levelOnPreviousTurn = newPlayer.level;

    if (changes.characterChronicleUpdates) {
        asArray(changes.characterChronicleUpdates).forEach(update => {
            if (!newPlayer.characterChronicle) {
                newPlayer.characterChronicle = [];
            }
            newPlayer.characterChronicle.unshift(update.entryToAppend);
        });
    }

    // Item IDs, not names or old turn-local tags, identify saved inventory.
    // Combine fragments with the same ID before checking a new item's complete
    // state, so a partial fragment arriving first is not lost.
    const inventoryIdCounts = new Map<string, number>();
    for (const item of newPlayer.inventory || []) {
        if (item?.existedId) inventoryIdCounts.set(item.existedId, (inventoryIdCounts.get(item.existedId) || 0) + 1);
    }
    const acceptedItems: Partial<Item>[] = [];
    const { accepted: safeItems, rejected: ambiguousItems } = splitAmbiguousItemFragments(asArray(changes.inventoryItemsData));
    for (const item of ambiguousItems) {
        rejectedNewItems.push(item);
        logs.push(t('warning_inventory_item_identity', { subject: item.initialId || item.name || '?' }));
    }
    const turnItems = mergeIdentifiedStageEntities([], safeItems, 'existedId');
    const itemUpdates = mergeById([], turnItems, 'existedId', undefined, undefined, true, false, false) as Partial<Item>[];
    for (const incoming of itemUpdates) {
        if (!incoming) continue;
        const id = incoming.existedId;
        const matches = id ? inventoryIdCounts.get(id) || 0 : 0;
        const invalidId = id != null && (typeof id !== 'string' || !id.trim());
        const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
        const nonnegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
        // Match the new-item contract, rather than accepting a few fields from
        // an otherwise partial update. Optional type defaults to an empty label.
        const completeNewItem = typeof incoming.name === 'string' && !!incoming.name.trim() &&
            typeof incoming.description === 'string' && !!incoming.description.trim() &&
            typeof incoming.image_prompt === 'string' && !!incoming.image_prompt.trim() &&
            typeof incoming.quality === 'string' && !!incoming.quality.trim() &&
            (incoming.type === undefined || typeof incoming.type === 'string') &&
            Number.isInteger(incoming.price) && nonnegativeNumber(incoming.price) &&
            Number.isInteger(incoming.count) && nonnegativeNumber(incoming.count) && incoming.count > 0 &&
            nonnegativeNumber(incoming.weight) && nonnegativeNumber(incoming.volume) &&
            stringArray(incoming.bonuses) && (incoming.contentsPath === null || stringArray(incoming.contentsPath)) &&
            typeof incoming.isContainer === 'boolean' &&
            (incoming.capacity === null || (Number.isInteger(incoming.capacity) && nonnegativeNumber(incoming.capacity))) &&
            typeof incoming.isConsumption === 'boolean' &&
            typeof incoming.durability === 'string' && !!incoming.durability.trim() &&
            (incoming.equipmentSlot === null || typeof incoming.equipmentSlot === 'string' || stringArray(incoming.equipmentSlot));
        if (invalidId || matches > 1 || (!matches && !completeNewItem)) {
            // A rejected update to an existing stack can also be the receiving
            // side of a transfer, so it must participate in batch deferral.
            rejectedNewItems.push(incoming);
            logs.push(t('warning_inventory_item_identity', { subject: id || incoming.name || '?' }));
            continue;
        }
        const item = { ...(!matches ? { type: '' } : {}), ...incoming, existedId: id || generateId('item') };
        acceptedItems.push(item);
        if (!matches) {
            acceptedNewItems.push(item);
        } else if (matches === 1 && typeof incoming.count === 'number') {
            // An increase to an existing stack can be the receiving side of a
            // transfer just as a newly created stack can. Track the delta, not
            // the resulting stack size, for the companion-stash safeguard.
            const existing = newPlayer.inventory.find((entry: Item) => entry.existedId === id);
            if (existing && typeof existing.count === 'number' && incoming.count > existing.count) {
                acceptedNewItems.push({ ...item, name: existing.name, count: incoming.count - existing.count });
            }
        }
        if (!matches && item.existedId) inventoryIdCounts.set(item.existedId, 1);
    }
    newPlayer.inventory = mergeById(newPlayer.inventory || [], acceptedItems, 'existedId', undefined, undefined, true, false, false);
    if (changes.removeInventoryItems) newPlayer.inventory = newPlayer.inventory.filter((item: Item) => !asArray(changes.removeInventoryItems).some(i => i.removedItemId === item.existedId));
    if (changes.updateItemTextContents) asArray(changes.updateItemTextContents).forEach(update => { const item = newPlayer.inventory.find((i: Item) => i.existedId === update.itemId); if (item) { if (!Array.isArray(item.textContent)) item.textContent = []; item.textContent.unshift(update.textToAppend); } });
    if (changes.itemBondLevelChanges) asArray(changes.itemBondLevelChanges).forEach(change => { const item = newPlayer.inventory.find((i: Item) => i.existedId === change.itemId); if (item) item.ownerBondLevelCurrent = change.newBondLevel; });
    if (changes.itemFateCardUnlocks) asArray(changes.itemFateCardUnlocks).forEach(unlock => { const item = newPlayer.inventory.find((i: Item) => i.existedId === unlock.itemId); if (item?.fateCards) { const card = item.fateCards.find(c => c.cardId === unlock.cardId); if (card) card.isUnlocked = true; } });
    
    if (changes.equipmentChanges) asArray(changes.equipmentChanges).forEach(change => {
        if (change.action === 'equip') {
            const matches = typeof change.itemId === 'string' && change.itemId.trim()
                ? newPlayer.inventory.filter((i: Item) => i.existedId === change.itemId) : [];
            if (matches.length !== 1) {
                logs.push(t('warning_equipment_item_identity', { subject: change.itemId || change.itemName || '?' }));
                return;
            }
            const item = matches[0];
            if (item.requiresTwoHands) { newPlayer.equippedItems.MainHand = change.itemId; newPlayer.equippedItems.OffHand = change.itemId; }
            else (change.targetSlots || []).forEach(slot => { newPlayer.equippedItems[slot] = change.itemId; });
        } else if (change.action === 'unequip') {
            const item = newPlayer.inventory.find((i: Item) => i.existedId === change.itemId);
            if (item?.requiresTwoHands) { if (newPlayer.equippedItems.MainHand === change.itemId) newPlayer.equippedItems.MainHand = null; if (newPlayer.equippedItems.OffHand === change.itemId) newPlayer.equippedItems.OffHand = null; }
            else (change.sourceSlots || []).forEach(slot => { if (newPlayer.equippedItems[slot] === change.itemId) newPlayer.equippedItems[slot] = null; });
        }
    });
    
    if (changes.inventoryItemsResources) {
        asArray(changes.inventoryItemsResources).forEach(change => {
            const item = newPlayer.inventory.find((i: Item) => i.existedId === change.existedId);
            if (item) {
                const oldResource = item.resource;
                if(change.resource !== undefined) item.resource = change.resource;
                if(change.maximumResource !== undefined) item.maximumResource = change.maximumResource;
                if (item.isConsumption && oldResource !== undefined && oldResource > 0 && item.resource === 0) {
                    logs.push(t('item_consumed_creating_empty', { itemName: item.name }));
                    itemsToAdd.push({ name: t('empty_item_name', { itemName: item.name }), description: t('empty_item_desc', { itemName: item.name }), image_prompt: `empty ${item.image_prompt || item.name}, trash`, quality: 'Trash', type: 'Junk', price: Math.ceil(item.price * 0.1), count: 1, weight: item.containerWeight ?? item.weight * 0.2, volume: item.volume, bonuses: [], isContainer: false, capacity: null, isConsumption: true, durability: "100%", equipmentSlot: null, requiresTwoHands: false, contentsPath: null, existedId: null, structuredBonuses: [] });
                    item.count -= 1;
                    if (item.count > 0 && item.maximumResource !== undefined) item.resource = item.maximumResource;
                }
            }
        });
        itemsToAdd.forEach(newItem => {
            const existingStack = newPlayer.inventory.find((i: Item) => i.name === newItem.name && !i.equipmentSlot);
            if (existingStack) existingStack.count += 1;
            else { (newItem as any).existedId = generateId('item'); newPlayer.inventory.push(newItem); }
        });
    }
    
    if (changes.moveInventoryItems) asArray(changes.moveInventoryItems).forEach(move => { const item = newPlayer.inventory.find((i: Item) => i.existedId === move.movedItemId); if (item) item.contentsPath = move.destinationContentsPath; });
    
    newPlayer.activeSkills = mergeById(newPlayer.activeSkills || [], asArray(changes.activeSkillChanges), 'skillName');
    if(changes.removeActiveSkills) newPlayer.activeSkills = newPlayer.activeSkills.filter(s => !asArray(changes.removeActiveSkills).includes(s.skillName));
    if (changes.skillMasteryChanges) newPlayer.skillMasteryData = mergeById(newPlayer.skillMasteryData || [], asArray(changes.skillMasteryChanges).map(c => ({...c, currentMasteryLevel: c.newMasteryLevel, currentMasteryProgress: c.newCurrentMasteryProgress, masteryProgressNeeded: c.newMasteryProgressNeeded})), 'skillName');
    newPlayer.passiveSkills = mergeById(newPlayer.passiveSkills || [], asArray(changes.passiveSkillChanges), 'skillName');
    if(changes.removePassiveSkills) newPlayer.passiveSkills = newPlayer.passiveSkills.filter(s => !asArray(changes.removePassiveSkills).includes(s.skillName));
    newPlayer.knownRecipes = mergeById(newPlayer.knownRecipes || [], asArray(changes.addOrUpdateRecipes), 'recipeName');
    if (changes.removeRecipes) newPlayer.knownRecipes = newPlayer.knownRecipes.filter(r => !asArray(changes.removeRecipes).includes(r.recipeName));
    
    newPlayer.playerWounds = mergeWounds(newPlayer.playerWounds || [], asArray(changes.playerWoundChanges));
    newPlayer.activePlayerEffects = mergeById(newPlayer.activePlayerEffects || [], asArray(changes.playerActiveEffectsChanges), 'effectId');
    newPlayer.activePlayerEffects = removeEffectsForHealedWounds(newPlayer.activePlayerEffects, newPlayer.playerWounds, asArray(changes.playerWoundChanges));
    newPlayer.playerCustomStates = mergeById(newPlayer.playerCustomStates || [], asArray(changes.customStateChanges), 'stateId');
    
    if (changes.playerCharacterNameChange !== undefined && changes.playerCharacterNameChange !== null) newPlayer.name = changes.playerCharacterNameChange;
    // Player Image Prompt preservation
    if (changes.playerImagePromptChange !== undefined && changes.playerImagePromptChange !== null) {
        // Ensure we don't set pending if it's the exact same prompt
        const currentPrompt = newPlayer.image_prompt ? newPlayer.image_prompt.trim() : "";
        const newPrompt = changes.playerImagePromptChange.trim();
        
        if (currentPrompt && currentPrompt !== newPrompt) {
             newPlayer.pending_image_prompt = newPrompt;
             // Add a system log to confirm the change was processed
             logs.push(t('A new appearance is available for your character. Check your profile.'));
        } else {
             // If no existing prompt, or it's the same, set directly (or update if same, no harm)
             newPlayer.image_prompt = newPrompt;
             // Ensure pending is cleared if it matches current
             newPlayer.pending_image_prompt = null; 
        }
    }

    if (changes.playerAppearanceChange !== undefined && changes.playerAppearanceChange !== null) newPlayer.appearanceDescription = changes.playerAppearanceChange;
    if (changes.playerRaceChange !== undefined && changes.playerRaceChange !== null) newPlayer.race = changes.playerRaceChange;
    if (changes.playerRaceDescriptionChange !== undefined && changes.playerRaceDescriptionChange !== null) newPlayer.raceDescription = changes.playerRaceDescriptionChange;
    if (changes.playerClassChange !== undefined && changes.playerClassChange !== null) newPlayer.class = changes.playerClassChange;
    if (changes.playerClassDescriptionChange !== undefined && changes.playerClassDescriptionChange !== null) newPlayer.classDescription = changes.playerClassDescriptionChange;
    if (changes.playerAutoCombatSkillChange !== undefined && changes.playerAutoCombatSkillChange !== null) newPlayer.autoCombatSkill = changes.playerAutoCombatSkillChange === 'clear' ? null : changes.playerAutoCombatSkillChange;
    if (changes.playerStealthStateChange !== undefined && changes.playerStealthStateChange !== null) newPlayer.stealthState = { ...newPlayer.stealthState, ...changes.playerStealthStateChange };
    if (changes.playerEffortTrackerChange !== undefined && changes.playerEffortTrackerChange !== null) newPlayer.effortTracker = { ...newPlayer.effortTracker, ...changes.playerEffortTrackerChange };
    
    newPlayer.inventory = newPlayer.inventory.filter((item: Item) => item.count > 0);
    return { player: newPlayer, logs, rejectedNewItems, acceptedNewItems };
};

export const processAndApplyResponse = (
    response: GameResponse, 
    baseState: GameState, 
    gameSettings: GameSettings | null, 
    t: TFunction, 
    advanceTurn: boolean, 
    currentTurnNumber: number,
    worldMap: Record<string, Location>
): { newState: GameState, logsToAdd: string[], combatLogsToAdd: string[], processedResponse: GameResponse } => {
    // Define helper function at the top
    const getAttitudeAtLevel = (level: number): string => {
        if (level <= -201) return t('relationship_tier_implacable_foe');
        if (level <= -51) return t('relationship_tier_adversary');
        if (level <= -1) return t('relationship_tier_dislike');
        if (level <= 100) return t('relationship_tier_neutral');
        if (level <= 250) return t('relationship_tier_familiarity_trust');
        if (level <= 350) return t('relationship_tier_deep_bond');
        return t('relationship_tier_legendary_bond');
    };

    if (!baseState) throw new Error("processAndApplyResponse called with a null baseState.");

    const mutableResponse = JSON.parse(JSON.stringify(response));
    // New map locations must be resolvable before NPC/other links are applied.
    // Reject malformed coordinates atomically rather than committing dangling IDs.
    const newLocationIds = new Set<string>();
    const newLocationTags = new Set<string>();
    asArray(mutableResponse.worldMapUpdates?.newLocations).forEach((location: any) => {
        if (!location?.coordinates || !Number.isFinite(location.coordinates.x) || !Number.isFinite(location.coordinates.y)) {
            throw new Error(`New location "${location?.name || location?.initialId || 'unknown'}" has invalid or missing coordinates`);
        }
        if (location.locationId && (worldMap?.[location.locationId] || newLocationIds.has(location.locationId))) {
            throw new Error(`New location ID "${location.locationId}" already exists`);
        }
        if (location.initialId && newLocationTags.has(location.initialId)) {
            throw new Error(`New location temporary ID "${location.initialId}" is duplicated`);
        }
        if (location.locationId) newLocationIds.add(location.locationId);
        if (location.initialId) newLocationTags.add(location.initialId);
    });
    // A name-only partial NPC update cannot select between namesakes. Keep
    // explicitly identified and turn-local new NPCs, but skip ambiguous edits.
    if (mutableResponse.NPCsData) {
        mutableResponse.NPCsData = asArray(mutableResponse.NPCsData).filter((update: any) =>
            update?.NPCId || update?.initialId || !update?.name ||
            baseState.encounteredNPCs.filter(npc => npc.name === update.name).length <= 1);
    }
    
    const npcUpdatedEffectIds = new Map<string, Set<string>>();
    const actorEffectKey = (id?: string | null, name?: string | null) => {
        if (id) return `id:${id}`;
        if (!name) return undefined;
        const matches = baseState.encounteredNPCs.filter(npc => npc.name === name);
        return matches.length === 1 && matches[0].NPCId ? `id:${matches[0].NPCId}` : `name:${name}`;
    };
    const recordNpcEffect = (key: string | undefined, effectId: string) => {
        if (!key) return;
        const ids = npcUpdatedEffectIds.get(key) || new Set<string>();
        ids.add(effectId);
        npcUpdatedEffectIds.set(key, ids);
    };
    const activePlayerUpdatedEffectIds = new Set<string>();
    const otherPlayerUpdatedEffectIds = new Map<number, Set<string>>();
    
    asArray(mutableResponse.playerActiveEffectsChanges).forEach(effectUpdate => {
        if (effectUpdate.effectId && effectUpdate.duration !== undefined) {
            activePlayerUpdatedEffectIds.add(effectUpdate.effectId);
        }
    });

    const findUpdatedDurations = (oldCombatants: (EnemyCombatObject | AllyCombatObject)[], newCombatants: (Partial<EnemyCombatObject> | Partial<AllyCombatObject>)[]) => {
        if (!newCombatants || !oldCombatants) return;
        
        const oldMap = new Map<string, (EnemyCombatObject | AllyCombatObject)>();
        oldCombatants.forEach(c => {
            if (c.NPCId) oldMap.set(c.NPCId, c);
            else if (c.name) oldMap.set(c.name, c);
        });

        newCombatants.forEach(newCombatant => {
            const oldCombatant = newCombatant.NPCId ? oldMap.get(newCombatant.NPCId) : (newCombatant.name ? oldMap.get(newCombatant.name) : undefined);
            
            if (oldCombatant) {
                const oldEffects = [...(oldCombatant.activeBuffs || []), ...(oldCombatant.activeDebuffs || [])];
                const newEffects = [...(newCombatant.activeBuffs || []), ...(newCombatant.activeDebuffs || [])];
                
                const oldEffectMap = new Map<string, number | undefined>();
                oldEffects.forEach(e => {
                    if (e.effectId) oldEffectMap.set(e.effectId, e.duration);
                });

                newEffects.forEach(newEffect => {
                    if (newEffect.effectId && oldEffectMap.has(newEffect.effectId)) {
                        const oldDuration = oldEffectMap.get(newEffect.effectId);
                        if (newEffect.duration !== undefined && newEffect.duration !== oldDuration) {
                            recordNpcEffect(actorEffectKey(newCombatant.NPCId, newCombatant.name), newEffect.effectId);
                        }
                    }
                });
            }
        });
    };

    findUpdatedDurations(baseState.enemiesData, asArray(mutableResponse.enemiesData));
    findUpdatedDurations(baseState.alliesData, asArray(mutableResponse.alliesData));

    const initialIdToGeneratedIdMap = new Map<string, string>();
    const initialIdKinds = new Map<string, string>();

    const processForIdMapping = (items: any[] | undefined, idField: string, initialIdField: string, prefix: string) => {
        asArray(items).forEach(item => {
            if (item && item[initialIdField]) {
                const matchingCurrent = prefix === 'loc' && mutableResponse.currentLocationData?.initialId === item[initialIdField]
                    ? mutableResponse.currentLocationData.locationId : undefined;
                const id = item[idField] || matchingCurrent || generateId(prefix);
                const prior = initialIdToGeneratedIdMap.get(item[initialIdField]);
                if (prior && (prior !== id || initialIdKinds.get(item[initialIdField]) !== prefix)) throw new Error(`Conflicting temporary initialId "${item[initialIdField]}"`);
                initialIdToGeneratedIdMap.set(item[initialIdField], id);
                initialIdKinds.set(item[initialIdField], prefix);
                item[idField] = id;
            }
        });
    };

    processForIdMapping(asArray(mutableResponse.factionDataChanges), 'factionId', 'initialId', 'faction');
    processForIdMapping(asArray(mutableResponse.NPCsData), 'NPCId', 'initialId', 'npc');
    processForIdMapping(asArray(mutableResponse.worldMapUpdates?.newLocations), 'locationId', 'initialId', 'loc');
    processForIdMapping(asArray(mutableResponse.questUpdates), 'questId', 'initialId', 'quest');

    if (mutableResponse.currentLocationData?.initialId) {
         const prior = initialIdToGeneratedIdMap.get(mutableResponse.currentLocationData.initialId);
         // A repeated declaration with the same turn-local location tag refers
         // to the same new entity when no permanent ID was supplied here.
         const id = mutableResponse.currentLocationData.locationId ||
             (initialIdKinds.get(mutableResponse.currentLocationData.initialId) === 'loc' ? prior : undefined) || generateId('loc');
         if (prior && (prior !== id || initialIdKinds.get(mutableResponse.currentLocationData.initialId) !== 'loc')) throw new Error(`Conflicting temporary initialId "${mutableResponse.currentLocationData.initialId}"`);
         initialIdToGeneratedIdMap.set(mutableResponse.currentLocationData.initialId, id);
         initialIdKinds.set(mutableResponse.currentLocationData.initialId, 'loc');
         mutableResponse.currentLocationData.locationId = id;
    }

    resolveInitialIds(mutableResponse, initialIdToGeneratedIdMap, initialIdKinds);

    // Existing threats embedded in a current-location update must not bypass
    // the activity identity/completion protocol. New threats remain intact.
    const locUpdate = mutableResponse.currentLocationData;
    const targetId = locUpdate?.locationId || baseState.currentLocationData?.locationId;
    const existingLocation = targetId === baseState.currentLocationData?.locationId
        ? baseState.currentLocationData : (targetId ? worldMap?.[targetId] : undefined);
    if (targetId && existingLocation && Array.isArray(locUpdate?.activeThreats)) {
        const deferredUpdates: Array<{ targetLocationId: string; threatUpdate: Partial<ActiveThreat> }> = [];
        locUpdate.activeThreats = locUpdate.activeThreats.filter(threat => {
            if (!threat) return false;
            const existingThreats = existingLocation.activeThreats || [];
            const matches = existingThreats.filter(existing =>
                threat.threatId ? existing.threatId === threat.threatId : threat.name && existing.name === threat.name);
            const nameCollision = threat.name && existingThreats.some(existing => existing.name === threat.name);
            if (matches.length > 1 || (matches.length === 0 && nameCollision)) {
                // Let the normal command path report an ambiguous/unknown threat.
                deferredUpdates.push({ targetLocationId: targetId, threatUpdate: threat });
                return false;
            }
            if (matches.length !== 1) return true;
            if (!threat.threatId && matches[0].threatId) threat.threatId = matches[0].threatId;
            if (!Object.prototype.hasOwnProperty.call(threat, 'currentActivity')) return true;
            const activity = threat.currentActivity;
            delete (threat as Partial<ActiveThreat>).currentActivity;
            if (activity) deferredUpdates.push({ targetLocationId: targetId, threatUpdate: { threatId: matches[0].threatId, name: matches[0].name, currentActivity: activity } });
            return true;
        });
        if (deferredUpdates.length) {
            mutableResponse.worldMapUpdates ||= {};
            mutableResponse.worldMapUpdates.threatsToUpdate = [...asArray(mutableResponse.worldMapUpdates.threatsToUpdate), ...deferredUpdates];
        }
    }

    const { accepted: safeTopItems, rejected: ambiguousTopItems } = splitAmbiguousItemFragments(asArray(mutableResponse.inventoryItemsData));
    if (mutableResponse.inventoryItemsData) mutableResponse.inventoryItemsData = safeTopItems;
    const processedResponse = preProcessAndAssignIds(mutableResponse, baseState, worldMap);
    const changes = processedResponse;

    // Clamping Faction Reputation
    if (changes.factionDataChanges) {
        asArray(changes.factionDataChanges).forEach(f => {
             if (typeof f.reputation === 'number') {
                 f.reputation = Math.max(-400, Math.min(400, f.reputation));
             }
        });
    }

    // Clamping NPC Relationship Level in Data Updates
    if (changes.NPCsData) {
         asArray(changes.NPCsData).forEach(n => {
             if (typeof n.relationshipLevel === 'number') {
                 n.relationshipLevel = Math.max(-400, Math.min(400, n.relationshipLevel));
             }
         });
    }

    let newState: GameState = JSON.parse(JSON.stringify(baseState));
    const logsToAdd: string[] = [];
    const rejectedPlayerItems: Partial<Item>[] = [...ambiguousTopItems];
    const acceptedPlayerItems: Partial<Item>[] = [];
    // A malformed list or null entry is not an empty transfer batch: silently
    // ignoring it could commit dependent payment, health or story changes.
    if (changes.inventoryTransfers != null && (!Array.isArray(changes.inventoryTransfers) || changes.inventoryTransfers.some(transfer => !isObject(transfer)))) {
        throw new Error(t('error_inventory_transfer_rejected', { subject: '?' }));
    }
    // An explicit transfer must not be combined with legacy inventory commands:
    // without linkage they may represent a second copy of the same operation.
    const legacyInventoryKeys = ['inventoryItemsData', 'removeInventoryItems', 'updateItemTextContents', 'itemBondLevelChanges', 'itemFateCardUnlocks', 'equipmentChanges', 'inventoryItemsResources', 'moveInventoryItems'];
    const hasLegacyCommands = (value: any) => legacyInventoryKeys.some(key => asArray(value?.[key]).length > 0);
    const transferBatchConflict = asArray(changes.inventoryTransfers).length > 0 && (
        hasLegacyCommands(mutableResponse) || ambiguousTopItems.length > 0 ||
        Object.values(changes.otherPlayersInteractions || {}).some(commands => asArray(commands).some(hasLegacyCommands)) ||
        ['NPCInventoryAdds', 'NPCInventoryUpdates', 'NPCInventoryRemovals', 'NPCEquipmentChanges', 'NPCInventoryResourcesChanges'].some(key => asArray((changes as any)[key]).length > 0) ||
        asArray(changes.NPCsData).some(npc => !findNpcForUpdate(npc, newState.encounteredNPCs) && asArray(npc.inventory).length > 0)
    );
    // The other changes may be consequences of the deferred inventory command
    // (for example healing from a consumed potion). Without causal links we
    // cannot safely apply only part of this turn. Reject it before any commit.
    if (transferBatchConflict) throw new Error(t('warning_inventory_transfer_conflict'));
    for (const item of ambiguousTopItems) logsToAdd.push(t('warning_inventory_item_identity', { subject: item.initialId || item.name || '?' }));
    const combatLogsToAdd = asArray(changes.combatLogEntries);
    const activePlayerIndex = newState.activePlayerIndex;

    if (changes.currentLocationData) {
        const newLocData = changes.currentLocationData as Location;
        const newLocationId = newLocData.locationId;
        const currentId = newState.currentLocationData?.locationId;

        let baseForMerge: Location;

        if (newLocationId && newLocationId !== currentId) {
            // Moving to a different location
            // We must check the worldMap for a clean copy of the target location
            if (worldMap && worldMap[newLocationId]) {
                 // Known location: Use the clean state from the map
                baseForMerge = JSON.parse(JSON.stringify(worldMap[newLocationId]));
            } else {
                // New location: Create a fresh base
                baseForMerge = {
                    locationId: newLocationId,
                    name: newLocData.name || "New Location",
                    description: "",
                    eventDescriptions: [],
                    activeThreats: [],
                    locationStorages: [],
                    coordinates: newLocData.coordinates || { x: 0, y: 0},
                    locationType: newLocData.locationType || 'outdoor',
                    internalDifficultyProfile: newLocData.internalDifficultyProfile || { combat: 0, environment: 0, social: 0, exploration: 0 },
                    externalDifficultyProfile: newLocData.externalDifficultyProfile || { combat: 0, environment: 0, social: 0, exploration: 0 },
                } as Location;
                // The same newly entered location can also be declared in
                // newLocations. Use its full data before applying the partial
                // current-location update, rather than letting defaults hide it.
                const declaredLocation = asArray(changes.worldMapUpdates?.newLocations)
                    .find(loc => loc?.locationId === newLocationId);
                if (declaredLocation) baseForMerge = deepMergeResponses(baseForMerge, declaredLocation) as Location;
            }
        } else {
            // Staying put: Use current state to preserve recent local changes
            baseForMerge = newState.currentLocationData;
        }

        const newEvent = (changes.currentLocationData as any).lastEventsDescription;
        const { eventDescriptions, lastEventsDescription, ...restOfLocationData } = changes.currentLocationData as any;
        
        let mergedLocation = deepMergeResponses(baseForMerge, restOfLocationData) as Location;
        
        if (newLocationId) {
            mergedLocation.locationId = newLocationId;
        }

        if (newEvent && typeof newEvent === 'string' && newEvent.trim() !== '') {
            if (!Array.isArray(mergedLocation.eventDescriptions)) {
                mergedLocation.eventDescriptions = [];
            }
            mergedLocation.eventDescriptions.unshift(newEvent);
        }
        
        newState.currentLocationData = mergedLocation;
    }
    
    // Temporary location tags are resolved in the current response above.
    // Stored tags must not relocate NPCs again on later turns.

    // Keep the active player and roster aligned before applying turn changes.
    if (newState.players?.[activePlayerIndex]) {
        newState.players[activePlayerIndex] = newState.playerCharacter;
    }
    const playersBeforeChanges: PlayerCharacter[] = JSON.parse(JSON.stringify(newState.players));
    const playerApplications: Array<{ index: number; changes: Partial<GameResponse>; logs: string[] }> = [];
    if (newState.players?.[activePlayerIndex]) {
        const { player: updatedActivePlayer, logs: activePlayerLogs, rejectedNewItems, acceptedNewItems } = applyChangesToPlayer(newState.players[activePlayerIndex], changes, t, gameSettings);
        rejectedPlayerItems.push(...rejectedNewItems);
        acceptedPlayerItems.push(...acceptedNewItems);
        newState.players[activePlayerIndex] = updatedActivePlayer;
        newState.playerCharacter = updatedActivePlayer;
        playerApplications.push({ index: activePlayerIndex, changes, logs: activePlayerLogs });
    }

    if (changes.otherPlayersInteractions) for (const playerId in changes.otherPlayersInteractions) {
        const playerIndex = newState.players.findIndex(p => p.playerId === playerId);
        if (playerIndex > -1) {
            // Commands are a sequence, not a map with unique keys. Preserve
            // repeated arrays and add numeric deltas before applying once, so
            // level-up and other per-turn processing still run only once.
            const deltaKeys = new Set(['currentHealthChange', 'currentEnergyChange', 'moneyChange', 'experienceGained']);
            const mergedChanges = (changes.otherPlayersInteractions as any)[playerId].reduce((acc: any, cmd: any) => {
                if (!isObject(cmd)) return acc;
                for (const [key, value] of Object.entries(cmd)) {
                    if (value === null || value === undefined) continue;
                    if (Array.isArray(value)) acc[key] = [...(Array.isArray(acc[key]) ? acc[key] : []), ...value];
                    else if (deltaKeys.has(key) && typeof value === 'number') acc[key] = (typeof acc[key] === 'number' ? acc[key] : 0) + value;
                    else if (isObject(value) && isObject(acc[key])) acc[key] = deepMergeResponses(acc[key], value);
                    else acc[key] = value;
                }
                return acc;
            }, {});
            const updatedEffects = new Set<string>();
            for (const effect of asArray(mergedChanges.playerActiveEffectsChanges) as Partial<Effect>[]) {
                if (effect?.effectId && effect.duration !== undefined) updatedEffects.add(effect.effectId);
            }
            otherPlayerUpdatedEffectIds.set(playerIndex, updatedEffects);
            const { player: updatedOtherPlayer, logs: otherPlayerLogs, rejectedNewItems, acceptedNewItems } = applyChangesToPlayer(newState.players[playerIndex], mergedChanges, t, gameSettings);
            rejectedPlayerItems.push(...rejectedNewItems);
            acceptedPlayerItems.push(...acceptedNewItems);
            newState.players[playerIndex] = updatedOtherPlayer;
            playerApplications.push({ index: playerIndex, changes: mergedChanges, logs: otherPlayerLogs });
        }
    }

    // Without explicit transfer linkage we cannot know which destination goes
    // with which source. When a possible transfer contains rejected player
    // items or invalid NPC endpoints, defer the inventory/equipment batch on
    // both sides rather than losing or duplicating a stack.
    const npcRemovals = asArray(changes.NPCInventoryRemovals);
    const npcCountUpdates = asArray(changes.NPCInventoryUpdates).filter(update => typeof update?.itemUpdate?.count === 'number');
    const npcAdds = asArray(changes.NPCInventoryAdds);
    // Validate both sides before committing a possible transfer. NPCs created
    // in this turn are included so a valid new recipient is not rejected.
    const projectedNpcs = mergeById(newState.encounteredNPCs || [], asArray(changes.NPCsData), 'NPCId', 'name', undefined, true) as NPC[];
    const invalidNpcDestination = npcAdds.some(add => !add?.item || !findNpcForUpdate(add, projectedNpcs));
    const invalidNpcSource = npcRemovals.some(removal => {
        const npc = findNpcForUpdate(removal, projectedNpcs);
        return !removal.itemId || !npc?.inventory || npc.inventory.filter(item => item.existedId === removal.itemId).length !== 1;
    }) || npcCountUpdates.some(update => {
        const npc = findNpcForUpdate(update, projectedNpcs);
        const id = update.itemUpdate?.existedId;
        return !id || !npc?.inventory || npc.inventory.filter(item => item.existedId === id).length !== 1;
    });
    const hasNpcSource = npcRemovals.length > 0 || npcCountUpdates.length > 0;
    const hasPlayerSource = playerApplications.some(application =>
        asArray(application.changes.removeInventoryItems).length > 0 ||
        asArray(application.changes.inventoryItemsData).some(update => {
            const original = playersBeforeChanges[application.index]?.inventory?.find(item => item.existedId === update.existedId);
            return !!original && typeof update.count === 'number' && update.count < original.count;
        }));
    const hasInlineNpcDestination = asArray(changes.NPCsData).some(npc => !findNpcForUpdate(npc, newState.encounteredNPCs) && asArray(npc.inventory).length > 0);
    const hasDestination = npcAdds.length > 0 || acceptedPlayerItems.length > 0 || hasInlineNpcDestination;
    const invalidTransferIdentity = (invalidNpcDestination && (hasNpcSource || hasPlayerSource)) || (invalidNpcSource && hasDestination);
    const deferNpcTransferBatch = (rejectedPlayerItems.length > 0 && hasNpcSource) || invalidTransferIdentity;
    if (deferNpcTransferBatch) {
        const inventoryKeys: Array<keyof GameResponse> = [
            'inventoryItemsData', 'removeInventoryItems', 'updateItemTextContents', 'itemBondLevelChanges',
            'itemFateCardUnlocks', 'equipmentChanges', 'inventoryItemsResources', 'moveInventoryItems',
        ];
        newState.players = JSON.parse(JSON.stringify(playersBeforeChanges));
        for (const application of playerApplications) {
            const safeChanges = { ...application.changes };
            inventoryKeys.forEach(key => delete safeChanges[key]);
            const result = applyChangesToPlayer(newState.players[application.index], safeChanges, t, gameSettings);
            newState.players[application.index] = result.player;
            application.logs = result.logs;
        }
        newState.playerCharacter = newState.players[activePlayerIndex];
        acceptedPlayerItems.length = 0;
        // Rejected commands were encountered during the first validation pass;
        // preserve their warnings without replaying any inventory operations.
        for (const item of rejectedPlayerItems.slice(ambiguousTopItems.length)) {
            logsToAdd.push(t('warning_inventory_item_identity', { subject: item.existedId || item.name || item.initialId || '?' }));
        }
        if (invalidTransferIdentity) logsToAdd.push(t('warning_npc_transfer_identity'));
        logsToAdd.push(t('warning_npc_transfer_batch'));
    }
    playerApplications.forEach(application => logsToAdd.push(...application.logs));

    if (changes.plotOutline !== undefined && changes.plotOutline !== null) newState.plotOutline = changes.plotOutline;
    
    if (changes.enemiesData !== undefined && changes.enemiesData !== null) {
        if (Array.isArray(changes.enemiesData) && changes.enemiesData.length === 0) {
            newState.enemiesData = [];
        } else {
            newState.enemiesData = mergeById(newState.enemiesData || [], changes.enemiesData, 'NPCId', 'name');
        }
    }

    if (changes.alliesData !== undefined && changes.alliesData !== null) {
        if (Array.isArray(changes.alliesData) && changes.alliesData.length === 0) {
            newState.alliesData = [];
        } else {
            newState.alliesData = mergeById(newState.alliesData || [], changes.alliesData, 'NPCId', 'name');
        }
    }

    // Generic combatants store wounds on the combat object rather than in
    // NPCWoundChanges. Normalize explicitly healed updates just as for PCs and
    // named NPCs, without treating null as a general deletion instruction.
    const normalizeGenericCombatWounds = (combatants: Combatant[], updates: Combatant[]) => {
        for (const update of asArray(updates)) {
            if (update?.NPCId || !update?.name || !Array.isArray(update.wounds)) continue;
            const matches = combatants.filter(combatant => !combatant.NPCId && combatant.name === update.name);
            if (matches.length === 1) {
                const combatant = matches[0];
                combatant.wounds = mergeWounds(combatant.wounds || [], update.wounds);
                if (combatant.activeBuffs) combatant.activeBuffs = removeEffectsForHealedWounds(combatant.activeBuffs, combatant.wounds, update.wounds);
                if (combatant.activeDebuffs) combatant.activeDebuffs = removeEffectsForHealedWounds(combatant.activeDebuffs, combatant.wounds, update.wounds);
            }
        }
    };
    normalizeGenericCombatWounds(newState.enemiesData, changes.enemiesData || []);
    normalizeGenericCombatWounds(newState.alliesData, changes.alliesData || []);

    newState.worldStateFlags = mergeById(newState.worldStateFlags || [], asArray(changes.worldStateFlags), 'flagId', 'displayName');
    newState.worldEventsLog = mergeById(newState.worldEventsLog || [], asArray(changes.worldEventsLog), 'eventId');    
    newState.encounteredFactions = mergeById(newState.encounteredFactions || [], asArray(changes.factionDataChanges), 'factionId', 'name', undefined, true).map(f => (f && !f.color) ? { ...f, color: generateFactionColor(f.factionId || f.name) } : f);

    asArray(changes.factionChronicleUpdates).forEach(update => { const f = findFactionForUpdate(update, newState.encounteredFactions); if (f) { if (!f.scribeChronicle) f.scribeChronicle = []; f.scribeChronicle.unshift(update.entryToAppend); } });
    asArray(changes.factionBonusChanges).forEach(change => { const f = findFactionForUpdate(change, newState.encounteredFactions); if (f) { if (change.bonusesToRemove) f.structuredBonuses = (f.structuredBonuses || []).filter(b => !b.bonusId || !asArray(change.bonusesToRemove).includes(b.bonusId)); if (change.bonusesToAddOrUpdate) f.structuredBonuses = mergeById(f.structuredBonuses || [], asArray(change.bonusesToAddOrUpdate), 'bonusId', 'description'); } });
    asArray(changes.factionResourceChanges).forEach(change => { const f = findFactionForUpdate(change, newState.encounteredFactions); if (f?.resources) asArray(change.resourceChanges).forEach(rc => { let r = f.resources!.metaResources.find(res => res.resourceName === rc.resourceName); if(r) r.currentStockpile += rc.changeAmount; else { let sg = f.resources!.strategicGoods.find(g => g.resourceName === rc.resourceName); if(sg) sg.currentStockpile += rc.changeAmount; } }); });
    asArray(changes.factionCustomStateChanges).forEach(change => { const f = findFactionForUpdate(change, newState.encounteredFactions); if (f) { f.customStates = mergeById(f.customStates || [], asArray(change.statesToAddOrUpdate), 'stateId'); if(change.statesToRemove) f.customStates = f.customStates.filter(s => !s.stateId || !asArray(change.statesToRemove).includes(s.stateId)); } });
    // Project names are not identities: different projects can share a name.
    // Fall back to an unambiguous name only if at least one side lacks an ID.
    const findProjectIndex = (projects: { projectId?: string; projectName?: string }[], ref: { projectId?: string; projectName?: string }): number => {
        if (ref.projectId) {
            const byId = projects.findIndex(project => project.projectId === ref.projectId);
            if (byId !== -1) return byId;
        }
        if (!ref.projectName) return -1;
        const matches = projects.map((project, index) => ({ project, index }))
            .filter(({ project }) => project.projectName === ref.projectName && (!ref.projectId || !project.projectId));
        return matches.length === 1 ? matches[0].index : -1;
    };
    asArray(changes.factionProjectUpdates).forEach(change => {
        const f = findFactionForUpdate(change, newState.encounteredFactions);
        if (!f || !change.projectUpdate) return;

        if (!f.activeProjects) f.activeProjects = [];
        const projectUpdate = change.projectUpdate as Partial<Project> & { projectId: string };
        const projectIndex = findProjectIndex(f.activeProjects, projectUpdate);

        if (projectIndex > -1) {
            f.activeProjects[projectIndex] = deepMergeResponses(f.activeProjects[projectIndex], projectUpdate) as Project;
        } else if (projectUpdate.projectName && (projectUpdate.projectId || !f.activeProjects.some(project => project.projectName === projectUpdate.projectName))) {
            f.activeProjects.push({
                projectId: projectUpdate.projectId || generateId('proj'),
                projectName: projectUpdate.projectName,
                description: projectUpdate.description || '',
                totalTimeCostMinutes: projectUpdate.totalTimeCostMinutes || 0,
                timeSpentMinutes: projectUpdate.timeSpentMinutes || 0,
                currentStep: projectUpdate.currentStep || 1,
                totalSteps: projectUpdate.totalSteps || 1,
                totalResourceCost: projectUpdate.totalResourceCost,
                resourcesSpent: projectUpdate.resourcesSpent,
                activeState: projectUpdate.activeState || 'Active',
            });
        }
    });

    const archiveCompletedFactionProjects = () => {
        const findFactionForCompletion = (completion: any): Faction | undefined => {
            const directFaction = findFactionForUpdate(completion, newState.encounteredFactions);
            if (directFaction) return directFaction;
            if (completion.factionId || completion.initialFactionId || completion.factionName) return undefined;
            const matches = newState.encounteredFactions.filter(faction =>
                findProjectIndex(faction.activeProjects || [], completion) !== -1
            );
            return matches.length === 1 ? matches[0] : undefined;
        };

        const archiveProject = (faction: Faction, completion: any) => {
            if (!faction.activeProjects) faction.activeProjects = [];
            if (!faction.completedProjects) faction.completedProjects = [];

            const projectIndex = findProjectIndex(faction.activeProjects, completion);
            if (!completion.projectId && completion.projectName && projectIndex === -1 &&
                faction.activeProjects.filter(project => project.projectName === completion.projectName).length > 1) return;
            const activeProject = projectIndex > -1 ? faction.activeProjects[projectIndex] : null;
            // Do not create a phantom history entry for a project that is not
            // present or already archived on the explicitly targeted faction.
            if (!activeProject && findProjectIndex(faction.completedProjects, completion) === -1) return;
            const projectId = completion.projectId || activeProject?.projectId;
            const projectName = completion.projectName || activeProject?.projectName;

            if (!projectId && !projectName) return;

            if (projectIndex > -1) {
                faction.activeProjects.splice(projectIndex, 1);
            }

            const completedProject: CompletedProject = {
                projectId: projectId || generateId('proj'),
                projectName: projectName || 'Unknown Project',
                completionTurn: completion.completionTurn || currentTurnNumber,
                finalState: completion.finalState === 'Abandoned' ? 'Abandoned' : 'Completed',
            };

            const existingIndex = findProjectIndex(faction.completedProjects, completedProject);

            if (existingIndex > -1) {
                faction.completedProjects[existingIndex] = deepMergeResponses(faction.completedProjects[existingIndex], completedProject) as CompletedProject;
            } else {
                faction.completedProjects.unshift(completedProject);
            }
        };

        asArray(changes.completeFactionProjects).forEach(completion => {
            const faction = findFactionForCompletion(completion);
            if (faction) {
                archiveProject(faction, completion);
            }
        });

        newState.encounteredFactions.forEach(faction => {
            asArray(faction.activeProjects)
                .filter(project => {
                    const explicitFinalState = project.activeState === 'Completed' || project.activeState === 'Abandoned';
                    const reachedTimeGoal = project.totalTimeCostMinutes > 0 && project.timeSpentMinutes >= project.totalTimeCostMinutes;
                    return explicitFinalState || reachedTimeGoal;
                })
                .forEach(project => {
                    archiveProject(faction, {
                        projectId: project.projectId,
                        projectName: project.projectName,
                        finalState: project.activeState === 'Abandoned' ? 'Abandoned' : 'Completed',
                    });
                });
        });
    };

    archiveCompletedFactionProjects();

    if (changes.factionRankBranchChanges) {
        asArray(changes.factionRankBranchChanges).forEach(change => {
            const targetFaction = findFactionForUpdate(change, newState.encounteredFactions);
            if (targetFaction) {
                if (!targetFaction.ranks) targetFaction.ranks = { branches: [] };
                let branches = targetFaction.ranks.branches || [];

                if (change.branchesToRemove) branches = branches.filter(b => !asArray(change.branchesToRemove).includes(b.branchId));
                if (change.ranksToRemove) asArray(change.ranksToRemove).forEach(r => {
                    const branch = branches.find(b => b.branchId === r.targetBranchId);
                    if (branch) branch.ranks = branch.ranks.filter(rank => rank.rankNameMale !== r.rankIdentifier && rank.rankNameFemale !== r.rankIdentifier);
                });
                
                if (change.branchesToAdd) branches.push(...asArray(change.branchesToAdd));
                if (change.ranksToAdd) asArray(change.ranksToAdd).forEach(r => {
                    const branch = branches.find(b => b.branchId === r.targetBranchId);
                    if (branch) branch.ranks.push(r.rank);
                });

                if (change.branchesToUpdate) asArray(change.branchesToUpdate).forEach(u => {
                    const branch = branches.find(b => b.branchId === u.branchId);
                    if (branch && u.newDisplayName) branch.displayName = u.newDisplayName;
                });
                if (change.ranksToUpdate) asArray(change.ranksToUpdate).forEach(u => {
                    const branch = branches.find(b => b.branchId === u.targetBranchId);
                    if (branch) {
                        const rankIndex = branch.ranks.findIndex(rank => rank.rankNameMale === u.rankIdentifier || rank.rankNameFemale === u.rankIdentifier);
                        if (rankIndex > -1) {
                            const newRankData = u.update;
                            const oldRank = branch.ranks[rankIndex] as FactionRank;
                            const destination = branch.ranks[rankIndex] as FactionRank;
                            destination.rankNameMale = newRankData.newRankNameMale ?? oldRank.rankNameMale;
                            destination.rankNameFemale = newRankData.newRankNameFemale ?? oldRank.rankNameFemale;
                            destination.requiredReputation = newRankData.newRequiredReputation ?? oldRank.requiredReputation;
                            destination.unlockCondition = newRankData.newUnlockCondition ?? oldRank.unlockCondition;
                            destination.benefits = newRankData.newBenefits ?? oldRank.benefits;
                            destination.isJunctionPoint = newRankData.newIsJunctionPoint ?? oldRank.isJunctionPoint;
                            destination.availableBranches = newRankData.newAvailableBranches ?? oldRank.availableBranches;
                        }
                    }
                });

                targetFaction.ranks.branches = branches;
            }
        });
    }

    // A crisis can end an activity and start a different one in NPCsData in
    // the same turn. Archive the old activity before merging the replacement,
    // otherwise its fields leak into the new activity and completion is lost.
    const archiveNpcActivity = (completion: any, npc: NPC | undefined) => {
        if (!npc?.currentActivity || npc.currentActivity.activityName !== completion.activityName) return;
        if (!npc.completedActivities) npc.completedActivities = [];
        npc.completedActivities.unshift({ activityName: npc.currentActivity.activityName, completionTurn: currentTurnNumber, finalOutcome: completion.finalState === 'Completed' ? 'Success' : 'Failure', narrativeSummary: completion.narrativeSummary });
        npc.currentActivity = null;
    };
    asArray(changes.completeNPCActivities).forEach(completion => {
        const npc = findNpcForUpdate(completion, newState.encounteredNPCs);
        if (!npc?.currentActivity || npc.currentActivity.activityName !== completion.activityName) return;
        const replacement = asArray(changes.NPCsData).find(update =>
            findNpcForUpdate(update, newState.encounteredNPCs) === npc &&
            update.currentActivity?.activityName && update.currentActivity.activityName !== completion.activityName
        );
        if (replacement) archiveNpcActivity(completion, npc);
    });

    // NPC health may arrive as numbers or percentage-formatted health points.
    // Invalid GM values are missing data, not an instruction to kill the NPC.
    const parseNpcHealth = (value: unknown): number | undefined => {
        if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
        if (typeof value !== 'string' || !/^\d+(?:\.\d+)?%?$/.test(value.trim())) return undefined;
        const parsed = Number(value.trim().replace(/%$/, ''));
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    const npcUpdates = asArray(changes.NPCsData).map(u => {
        const update = {
            ...u,
            currentHealth: parseNpcHealth(u.currentHealth),
            maxHealth: parseNpcHealth(u.maxHealth)
        };
        if (deferNpcTransferBatch && !findNpcForUpdate(update, newState.encounteredNPCs)) {
            // A newly introduced NPC may receive items inline, not through
            // NPCInventoryAdds. Defer those items as well as their equipment
            // references while possible source removals are deferred.
            update.inventory = [];
            if (update.equippedItems) {
                update.equippedItems = Object.fromEntries(Object.keys(update.equippedItems).map(slot => [slot, null]));
            }
        }
        return update;
    });
    newState.encounteredNPCs = mergeById(newState.encounteredNPCs || [], npcUpdates, 'NPCId', 'name', undefined, true);
    // Initial inline effects on a newly created NPC are reported this turn,
    // just like NPCEffectChanges, and must not immediately lose a turn.
    for (const update of npcUpdates) {
        if (findNpcForUpdate(update, baseState.encounteredNPCs)) continue;
        const npc = findNpcForUpdate(update, newState.encounteredNPCs);
        if (!npc) continue;
        for (const effect of asArray(update.activeEffects)) {
            if (effect?.effectId && effect.duration !== undefined) recordNpcEffect(actorEffectKey(npc.NPCId, npc.name), effect.effectId);
        }
    }
    newState.encounteredNPCs.forEach(npc => {
        if (npc && !Array.isArray(npc.inventory)) {
            npc.inventory = [];
        }
    });

    // Named combatants use the same health-point scale as their NPC record
    // (expressed as e.g. "80%" / "108%" in the combat view). Only sync
    // unambiguous, explicitly reported updates; preserve an explicit NPC update.
    const npcsWithExplicitHealth = new Set(npcUpdates
        .filter(update => update.currentHealth !== undefined)
        .map(update => findNpcForUpdate(update, newState.encounteredNPCs)?.NPCId)
        .filter(Boolean));
    for (const combatant of [...asArray(changes.enemiesData), ...asArray(changes.alliesData)]) {
        if (!combatant?.NPCId || combatant.isGroup || npcsWithExplicitHealth.has(combatant.NPCId)) continue;
        const npc = newState.encounteredNPCs.find(n => n.NPCId === combatant.NPCId);
        const health = typeof combatant.currentHealth === 'string' && /^\d+%$/.test(combatant.currentHealth.trim())
            ? Number.parseInt(combatant.currentHealth, 10) : NaN;
        const maxHealth = typeof combatant.maxHealth === 'string' && /^\d+%$/.test(combatant.maxHealth.trim())
            ? Number.parseInt(combatant.maxHealth, 10) : NaN;
        if (npc && Number.isFinite(health) && maxHealth === npc.maxHealth && health <= maxHealth) {
            npc.currentHealth = health;
        }
    }

    asArray(changes.NPCSkillMasteryChanges).forEach(change => {
        const npc = findNpcForUpdate(change, newState.encounteredNPCs);
        if (npc) {
            const masteryUpdate = {
                skillName: change.skillName,
                currentMasteryLevel: change.newMasteryLevel,
                currentMasteryProgress: change.newCurrentMasteryProgress,
                masteryProgressNeeded: change.newMasteryProgressNeeded,
            };
            npc.skillMasteryData = mergeById(npc.skillMasteryData || [], [masteryUpdate], 'skillName');
        }
    });

    asArray(changes.NPCPassiveSkillMasteryChanges).forEach(change => {
        const npc = findNpcForUpdate(change, newState.encounteredNPCs);
        if (npc?.passiveSkills) {
            const skillIndex = npc.passiveSkills.findIndex(s => s.skillName === change.skillName);
            if (skillIndex > -1) {
                const skill = npc.passiveSkills[skillIndex];
                if (change.newMasteryLevel !== undefined) {
                    skill.masteryLevel = change.newMasteryLevel;
                }
                if (change.newMaxMasteryLevel !== undefined) {
                    skill.maxMasteryLevel = change.newMaxMasteryLevel;
                }
            }
        }
    });

    asArray(changes.NPCsRenameData).forEach(r => { const npc = newState.encounteredNPCs.find(n => n.name === r.oldName); if (npc) npc.name = r.newName; });
    
    // Clamping NPC Relationship Level in Change Events
    asArray(changes.NPCRelationshipChanges).forEach(c => { 
        const npc = findNpcForUpdate(c, newState.encounteredNPCs); 
        if(npc) { 
            let newLevel = c.newRelationshipLevel;
            
            // Programmatic Clamping for Locked Reputation
            if (npc.relationshipLock?.isLocked && npc.relationshipLock.currentCap !== undefined) {
                if (newLevel > npc.relationshipLock.currentCap) {
                    newLevel = npc.relationshipLock.currentCap;
                }
            }

            // Global clamps
            npc.relationshipLevel = Math.max(-400, Math.min(400, newLevel)); 
            if (c.changeReason) npc.lastRelationshipChangeReason = c.changeReason; 
        } 
    });

    asArray(changes.NPCJournals).forEach(u => {
        const npc = findNpcForUpdate(u, newState.encounteredNPCs);
        if(npc) {
            if(!npc.journalEntries) npc.journalEntries = [];
            
            let note = u.lastJournalNote;
            if (gameSettings?.cooperativeGameType === 'None' && note) {
                 note = note.replace(/(#\[?\d+\]?\.?)\s*\[.*?\]\s*/g, '$1 ');
            }
            
            npc.journalEntries.unshift(note);
            if(gameSettings?.keepLatestNpcJournals) {
                const count = (gameSettings.latestNpcJournalsCount && !isNaN(gameSettings.latestNpcJournalsCount) && gameSettings.latestNpcJournalsCount > 0) 
                    ? gameSettings.latestNpcJournalsCount 
                    : 20;
                npc.journalEntries = npc.journalEntries.slice(0, count);
            }
        }
    });
    asArray(changes.NPCUnlockedMemories).forEach(m => { const npc = findNpcForUpdate(m, newState.encounteredNPCs); if (npc) { if(!npc.unlockedMemories) npc.unlockedMemories = []; npc.unlockedMemories.push(m as UnlockedMemory); } });
    asArray(changes.NPCFateCardUnlocks).forEach(u => { const npc = findNpcForUpdate(u, newState.encounteredNPCs); if (npc?.fateCards) { const card = npc.fateCards.find(c => c.cardId === u.cardId); if(card) card.isUnlocked = true; } });
    asArray(changes.NPCWoundChanges).forEach(wu => { const npc = findNpcForUpdate(wu, newState.encounteredNPCs); if(npc) npc.wounds = mergeWounds(npc.wounds || [], [wu]); });
    asArray(changes.NPCEffectChanges).forEach(ec => {
        const npc = findNpcForUpdate(ec, newState.encounteredNPCs);
        if (npc) {
            if (ec.effectsApplied) {
                // Record the resolved actor, after this turn's NPCs have been
                // assigned IDs and merged, rather than an earlier name-only key.
                for (const effect of asArray(ec.effectsApplied)) {
                    if (effect.effectId && effect.duration !== undefined) recordNpcEffect(actorEffectKey(npc.NPCId, npc.name), effect.effectId);
                }
                npc.activeEffects = mergeById(npc.activeEffects || [], asArray(ec.effectsApplied), 'effectId');
            }
            if (ec.effectsToRemove) {
                const toRemove = new Set(asArray(ec.effectsToRemove));
                if (toRemove.size > 0) {
                    npc.activeEffects = (npc.activeEffects || []).filter((effect: Effect) => !effect.effectId || !toRemove.has(effect.effectId));
                }
            }
        }
    });
    asArray(changes.NPCWoundChanges).forEach(wu => {
        const npc = findNpcForUpdate(wu, newState.encounteredNPCs);
        if (npc?.activeEffects) npc.activeEffects = removeEffectsForHealedWounds(npc.activeEffects, npc.wounds, [wu]);
    });
    asArray(changes.NPCCustomStateChanges).forEach(sc => { const npc = findNpcForUpdate(sc, newState.encounteredNPCs); if (npc) npc.customStates = mergeById(npc.customStates || [], asArray(sc.stateChanges), 'stateId'); });
    const acceptedNpcItems: Array<{ npc: NPC; item: Item }> = [];
    if (!deferNpcTransferBatch) {
        for (const update of npcUpdates) {
            if (findNpcForUpdate(update, baseState.encounteredNPCs)) continue;
            const npc = findNpcForUpdate(update, newState.encounteredNPCs);
            if (npc) for (const item of asArray(npc.inventory)) acceptedNpcItems.push({ npc, item });
        }
        asArray(changes.NPCInventoryAdds).forEach(add => {
            const npc = findNpcForUpdate(add, newState.encounteredNPCs);
            if (!npc || !add.item) return;
            if (!npc.inventory) npc.inventory = [];
            const newItem = { ...add.item, existedId: add.item.existedId || generateId('item') };
            if (add.destinationContainerId) {
                const c = npc.inventory.find(i => i.existedId === add.destinationContainerId);
                if (c) newItem.contentsPath = c.contentsPath ? [...c.contentsPath, c.name] : [c.name];
            }
            npc.inventory.push(newItem as Item);
            acceptedNpcItems.push({ npc, item: newItem as Item });
        });
    }
    // There is no transfer transaction ID in the response. A rejected player
    // item may correspond to *any* NPC removal, even when names differ. Defer
    // destructive NPC inventory commands rather than losing a possible source.
    const normalizedItemName = (name: unknown) => typeof name === 'string' ? name.trim().toLocaleLowerCase() : '';
    const removals = asArray(changes.NPCInventoryRemovals);
    const sourceItems = removals.map(removal => {
        const npc = findNpcForUpdate(removal, newState.encounteredNPCs);
        const item = npc?.inventory?.find(i => i.existedId === removal.itemId);
        return { removal, npc, item };
    });
    // A unique same-name, same-count accepted player or NPC item can represent
    // the removed stack; do not also put it in the companion safeguard stash.
    // Ambiguous cases cannot be resolved reliably without a transfer ID.
    const acceptedStillPresent = acceptedPlayerItems.filter(item => item.existedId &&
        newState.players.some(player => player.inventory?.some(i => i.existedId === item.existedId)));
    const isUnambiguousTransfer = (item: Item) => {
        const name = normalizedItemName(item.name);
        if (!name || !Number.isFinite(item.count)) return false;
        const sourceMatches = sourceItems.filter(source => source.item && normalizedItemName(source.item.name) === name && source.item.count === item.count);
        if (sourceMatches.length !== 1) return false;
        const sourceNpc = sourceMatches[0].npc;
        const playerMatches = acceptedStillPresent.filter(candidate => normalizedItemName(candidate.name) === name && candidate.count === item.count);
        const npcMatches = acceptedNpcItems.filter(candidate => candidate.npc !== sourceNpc && normalizedItemName(candidate.item.name) === name && candidate.item.count === item.count);
        return playerMatches.length + npcMatches.length === 1;
    };
    asArray(changes.NPCInventoryUpdates).forEach(u => {
        const npc = findNpcForUpdate(u, newState.encounteredNPCs);
        if (!npc?.inventory || !u.itemUpdate) return;
        const index = npc.inventory.findIndex(item => item.existedId === u.itemUpdate.existedId);
        if (index < 0) return;
        const existing = npc.inventory[index];
        const update = { ...u.itemUpdate };
        if (update.count !== undefined && (deferNpcTransferBatch || !Number.isSafeInteger(update.count) || update.count < 0)) {
            delete update.count;
            logsToAdd.push(t('warning_npc_item_transfer', { subject: existing.name || existing.existedId || '?' }));
        }
        npc.inventory[index] = { ...existing, ...update };
    });
    removals.forEach(r => {
        const npc = findNpcForUpdate(r, newState.encounteredNPCs);
        if (!npc?.inventory) return;
        const index = npc.inventory.findIndex(item => item.existedId === r.itemId);
        if (index < 0) return;
        const item = npc.inventory[index];
        if (deferNpcTransferBatch) {
            logsToAdd.push(t('warning_npc_item_transfer', { subject: item.name || item.existedId || '?' }));
            return;
        }
        const wasTransferred = isUnambiguousTransfer(item);
        const [removed] = npc.inventory.splice(index, 1);
        if (npc.progressionType === 'Companion' && !wasTransferred) {
            if (!newState.temporaryStash) newState.temporaryStash = [];
            if (!newState.temporaryStash.find(item => item.existedId === removed.existedId)) newState.temporaryStash.push({ ...removed, contentsPath: null });
            logsToAdd.push(t('item_moved_to_stash_from_npc', { itemName: removed.name, npcName: npc.name }));
        }
    });
    if (!deferNpcTransferBatch) asArray(changes.NPCEquipmentChanges).forEach(c => { const npc = findNpcForUpdate(c, newState.encounteredNPCs); if(npc) { if(!npc.equippedItems) npc.equippedItems = {}; if(c.action === 'equip') (c.targetSlots || []).forEach(s => npc.equippedItems![s] = c.itemId); else (c.sourceSlots || []).forEach(s => { if(npc.equippedItems![s] === c.itemId) npc.equippedItems![s] = null; }); } });
    
    // Explicit transfers are individually atomic and idempotent across saves.
    // Each side is addressed by a permanent actor ID, never by a name.
    if (!transferBatchConflict) {
        const transfers = asArray(changes.inventoryTransfers);
        const fingerprint = (x: any) => JSON.stringify([x?.source?.type, x?.source?.id, x?.source?.itemId, x?.destination?.type, x?.destination?.id, x?.quantity]);
        const fingerprints = new Map<string, Set<string>>();
        for (const x of transfers) if (typeof x?.transferId === 'string') {
            const set = fingerprints.get(x.transferId) || new Set<string>();
            set.add(fingerprint(x));
            fingerprints.set(x.transferId, set);
        }
        const actor = (endpoint: any): PlayerCharacter | NPC | undefined => {
            if (!endpoint || typeof endpoint.id !== 'string' || !endpoint.id.trim()) return undefined;
            const list = endpoint.type === 'player' ? newState.players.filter(p => p.playerId === endpoint.id)
                : endpoint.type === 'npc' ? newState.encounteredNPCs.filter(n => n.NPCId === endpoint.id) : [];
            return list.length === 1 ? list[0] : undefined;
        };
        for (const transfer of transfers) {
            const id = transfer?.transferId;
            const signature = fingerprint(transfer);
            // A rejected transfer may be coupled to other transfers or to
            // health, money and story consequences. Without causal IDs, none
            // of this response can be committed safely. All mutations so far
            // are on the candidate clone and are discarded by the caller.
            const reject = (): never => { throw new Error(t('error_inventory_transfer_rejected', { subject: typeof id === 'string' && id.trim() ? id : '?' })); };
            if (typeof id !== 'string' || !id.trim() || id !== id.trim() || (fingerprints.get(id)?.size || 0) !== 1) { reject(); continue; }
            // A transfer committed in an earlier turn cannot be safely skipped:
            // the repeated response could also repeat money, HP, or narrative.
            // Duplicates within this response remain safe to deduplicate below.
            if (baseState.completedInventoryTransfers && Object.prototype.hasOwnProperty.call(baseState.completedInventoryTransfers, id)) {
                if (baseState.completedInventoryTransfers[id] !== signature) reject();
                throw new Error(t('error_inventory_transfer_replayed', { subject: id }));
            }
            const previous = newState.completedInventoryTransfers && Object.prototype.hasOwnProperty.call(newState.completedInventoryTransfers, id)
                ? newState.completedInventoryTransfers[id] : undefined;
            if (previous !== undefined) { if (previous !== signature) reject(); continue; }
            const source = actor(transfer.source), destination = actor(transfer.destination);
            const sourceId = transfer.source?.itemId;
            if (!source || !destination || source === destination || !Array.isArray(source.inventory) || !Array.isArray(destination.inventory) ||
                typeof sourceId !== 'string' || !sourceId.trim() || !Number.isSafeInteger(transfer.quantity) || transfer.quantity <= 0) { reject(); continue; }
            const matches = source.inventory.filter(item => item.existedId === sourceId);
            if (matches.length !== 1) { reject(); continue; }
            const item = matches[0];
            const equipped = Object.values(source.equippedItems || {}).includes(sourceId);
            if (!Number.isSafeInteger(item.count) || item.count < transfer.quantity || item.isContainer || equipped ||
                (item.isSentient && item.count !== transfer.quantity) ||
                (item.count === transfer.quantity && destination.inventory.some(other => other.existedId === sourceId))) { reject(); continue; }
            const moved = JSON.parse(JSON.stringify(item)) as Item;
            moved.count = transfer.quantity;
            moved.contentsPath = null;
            delete moved.initialId;
            if (item.count === transfer.quantity) source.inventory.splice(source.inventory.indexOf(item), 1);
            else {
                item.count -= transfer.quantity;
                moved.existedId = generateId('item');
                // The partially used unit remains in the source stack, matching
                // splitItemStack/splitItemStackForNpc; moved units are full.
                if (moved.resource !== undefined && moved.maximumResource !== undefined) moved.resource = moved.maximumResource;
            }
            destination.inventory.push(moved);
            if (!newState.completedInventoryTransfers) newState.completedInventoryTransfers = {};
            Object.defineProperty(newState.completedInventoryTransfers, id, { value: signature, enumerable: true, writable: true, configurable: true });
        }
    }
    if (!deferNpcTransferBatch) asArray(changes.NPCInventoryResourcesChanges).forEach(change => {
        const npc = findNpcForUpdate(change, newState.encounteredNPCs);
        if (npc && npc.inventory) {
            const itemIndex = npc.inventory.findIndex(item => 
                ((change.itemId && item.existedId === change.itemId) || 
                (!change.itemId && item.name === change.itemName)) && !(item as any)._patched_resource_consumption
            );
    
            if (itemIndex > -1) {
                const item = npc.inventory[itemIndex];
                const oldResource = item.resource;
                const resourceValue = (change as any).newResourceValue ?? (change as any).resource;
    
                if (resourceValue !== undefined) {
                    item.resource = resourceValue;
                }
                if ((change as any).maximumResource !== undefined) {
                    item.maximumResource = (change as any).maximumResource;
                }
                if ((change as any).resourceType !== undefined) {
                    item.resourceType = (change as any).resourceType;
                }
                (item as any)._patched_resource_consumption = true;
    
                if (item.isConsumption && oldResource !== undefined && oldResource > 0 && item.resource === 0) {
                    logsToAdd.push(t('item_consumed_creating_empty_npc', { itemName: item.name, npcName: npc.name }));
                    
                    const emptyItemName = t('empty_item_name', { itemName: item.name });
                    const existingEmptyStack = npc.inventory.find(i => i.name === emptyItemName && !i.equipmentSlot);
    
                    if (existingEmptyStack) {
                        existingEmptyStack.count += 1;
                    } else {
                        const newItem: Item = { 
                            name: emptyItemName, 
                            description: t('empty_item_desc', { itemName: item.name }), 
                            image_prompt: `empty ${item.image_prompt || item.name}, trash`, 
                            quality: 'Trash', 
                            type: 'Junk', 
                            price: Math.ceil(item.price * 0.1), 
                            count: 1, 
                            weight: item.containerWeight ?? item.weight * 0.2, 
                            volume: item.volume, 
                            bonuses: [], 
                            isContainer: false, 
                            capacity: null, 
                            isConsumption: false, 
                            durability: '100%', 
                            equipmentSlot: null, 
                            contentsPath: null,
                            existedId: generateId('item'),
                            initialId: undefined,
                            structuredBonuses: [],
                        };
                        npc.inventory.push(newItem);
                    }
                    
                    item.count -= 1;
                    if (item.count > 0 && item.maximumResource !== undefined) {
                        item.resource = item.maximumResource;
                    }
                }
            }
        }
    });

    asArray(changes.NPCActiveSkillChanges).forEach(c => { const npc = findNpcForUpdate(c, newState.encounteredNPCs); if(npc) applySkillChanges(npc, c, false); });
    asArray(changes.NPCPassiveSkillChanges).forEach(c => { const npc = findNpcForUpdate(c, newState.encounteredNPCs); if(npc) applySkillChanges(npc, c, true); });
    asArray(changes.NPCActivityUpdates).forEach(u => { const npc = findNpcForUpdate(u, newState.encounteredNPCs); if (npc) npc.currentActivity = !npc.currentActivity ? u.activityUpdate as any : deepMergeResponses(npc.currentActivity, u.activityUpdate); });
    asArray(changes.completeNPCActivities).forEach(c => archiveNpcActivity(c, findNpcForUpdate(c, newState.encounteredNPCs)));
    
    // --- HANDLING NEW COMMANDS ---

    // 1. NPCGoalUpdates
    asArray(changes.NPCGoalUpdates).forEach(update => {
        const npc = findNpcForUpdate(update, newState.encounteredNPCs);
        if (npc) {
            if (!npc.goals) npc.goals = { shortTerm: '', longTerm: '' };
            
            if (update.newShortTermGoal) {
                npc.goals.shortTerm = update.newShortTermGoal === '_clear_' ? '' : update.newShortTermGoal;
            }
            if (update.newLongTermGoal) {
                npc.goals.longTerm = update.newLongTermGoal  === '_clear_' ? '' : update.newLongTermGoal;
            }
            if (update.newPlan) {
                npc.plans = update.newPlan === '_clear_' ? null : update.newPlan;
            }
        }
    });

       // 2. NPCQuestUpdates
    asArray(changes.NPCQuestUpdates).forEach(update => {
        const npc = findNpcForUpdate(update, newState.encounteredNPCs);
        if (npc) {
            if (!npc.personalQuests) npc.personalQuests = [];
            
            // Add or Update Quests
            if (update.questsToAddOrUpdate) {
                npc.personalQuests = mergeById(npc.personalQuests, update.questsToAddOrUpdate, 'questId', 'questName');
            }

            // Remove Quests
            if (update.questsToRemove) {
                 const toRemove = new Set(update.questsToRemove);
                 npc.personalQuests = npc.personalQuests.filter(q => !toRemove.has(q.questName));
            }

            // Limit completed or failed quests to 3 to save context size
            const completedCount = npc.personalQuests.filter(q => q.status === 'Completed' || q.status === 'Failed').length;
            if (completedCount > 3) {
                const countToRemove = completedCount - 3;
                let removed = 0;
                npc.personalQuests = npc.personalQuests.filter(q => {
                    if ((q.status === 'Completed' || q.status === 'Failed') && removed < countToRemove) {
                        removed++;
                        return false; // Remove the oldest completed or failed quest
                    }
                    return true;
                });
            }
        }
    });

    // 3. NPCRelationshipLockUpdates
    asArray(changes.NPCRelationshipLockUpdates).forEach(update => {
        const npc = findNpcForUpdate(update, newState.encounteredNPCs);
        if (npc) {
            if (!npc.relationshipLock) npc.relationshipLock = { isLocked: false, breakthroughQuestId: null };
            
            const lockUpdate = update.lockUpdate;
            if (lockUpdate.newIsLocked !== undefined) npc.relationshipLock.isLocked = lockUpdate.newIsLocked;
            if (lockUpdate.newCurrentCap !== undefined) npc.relationshipLock.currentCap = lockUpdate.newCurrentCap;
            
            if (lockUpdate.newBreakthroughQuestId !== undefined) {
                 npc.relationshipLock.breakthroughQuestId = lockUpdate.newBreakthroughQuestId === '_clear_' ? null : lockUpdate.newBreakthroughQuestId;
            }

            // --- FIX START ---
            // If the lock is being removed, grant a small reputation bump to ensure we cross the threshold and avoid an immediate re-lock loop.
            if (lockUpdate.newIsLocked === false) {
                 const oldLevel = npc.relationshipLevel;
                 const newLevel = Math.min(400, oldLevel + 5);
                 if (newLevel !== oldLevel) {
                     npc.relationshipLevel = newLevel;
                     npc.attitude = getAttitudeAtLevel(npc.relationshipLevel);
                     logsToAdd.push(t('breakthrough_bonus', { value: 5 }));
                 }
            }
            // --- FIX END ---
        }
    });

    // 4. interNPCRelationshipChanges
    asArray(changes.interNPCRelationshipChanges).forEach(change => {
        const sourceMatches = newState.encounteredNPCs.filter(n => change.sourceNpcId
            ? n.NPCId === change.sourceNpcId : !!change.sourceNpcName && n.name === change.sourceNpcName);
        const reject = () => logsToAdd.push(t('warning_npc_relationship_identity', { subject: change.sourceNpcId || change.sourceNpcName || '?' }));
        if (sourceMatches.length !== 1) { reject(); return; }
        const sourceNpc = sourceMatches[0];
        const targetId = change.targetNpcId;
        if (!targetId && (change.initialTargetNpcId || !change.targetNpcName)) { reject(); return; }
        const relationships = sourceNpc.npcRelationships || [];
        const nameMatches = relationships.map((r, index) => ({ r, index }))
            .filter(({ r }) => r.targetNpcName === change.targetNpcName);
        const sameNameNpcs = newState.encounteredNPCs.filter(n => n.name === change.targetNpcName);
        let matches: number[];
        if (targetId) {
            matches = relationships.map((r, index) => r.targetNpcId === targetId ? index : -1).filter(index => index >= 0);
            const targetNpcs = newState.encounteredNPCs.filter(n => n.NPCId === targetId);
            // A known historical relation can still be updated after its target
            // leaves the roster. Otherwise, never create a dangling target ID.
            if (targetNpcs.length > 1 || (!targetNpcs.length && !matches.length)) { reject(); return; }
            if (!matches.length && sameNameNpcs.length === 1 && sameNameNpcs[0].NPCId === targetId) {
                // Only upgrade a name-only legacy relation when that name
                // unambiguously identifies the explicitly targeted NPC.
                matches = nameMatches.filter(({ r }) => !r.targetNpcId).map(({ index }) => index);
            }
        } else {
            if (sameNameNpcs.length > 1) { reject(); return; }
            matches = nameMatches.map(({ index }) => index);
            if (matches.length === 1 && sameNameNpcs.length === 1) {
                const savedId = relationships[matches[0]].targetNpcId;
                const rosterId = sameNameNpcs[0].NPCId;
                // One visible namesake does not identify a saved relation to
                // another, absent NPC with the same name.
                if (savedId && (!rosterId || savedId !== rosterId)) { reject(); return; }
            }
        }
        if (matches.length > 1) { reject(); return; }
        const newRel: NpcRelationship = {
            targetNpcId: targetId || (matches.length === 1 ? relationships[matches[0]].targetNpcId : null) || (sameNameNpcs.length === 1 ? sameNameNpcs[0].NPCId : null),
            targetNpcName: change.targetNpcName,
            relationshipStatus: change.newRelationshipStatus,
            statusReason: change.newStatusReason
        };
        sourceNpc.npcRelationships ||= [];
        if (matches.length === 1) sourceNpc.npcRelationships[matches[0]] = newRel;
        else sourceNpc.npcRelationships.push(newRel);
    });

    // --- END NEW COMMANDS ---

    const updatedActiveQuests = [...newState.activeQuests];
    const updatedCompletedQuests = [...newState.completedQuests];
    const lastUpdatedQuestIds = new Set<string>();
    asArray(changes.questUpdates).forEach((update: QuestUpdate) => {
        if (!update.questId && !update.questName) return;
        let questFoundIn: 'active' | 'completed' | 'none' = 'none', questIndex = -1;
        questIndex = updatedActiveQuests.findIndex(q => (update.questId && q.questId === update.questId) || (!update.questId && q.questName === update.questName));
        if (questIndex > -1) questFoundIn = 'active';
        else { questIndex = updatedCompletedQuests.findIndex(q => (update.questId && q.questId === update.questId) || (!update.questId && q.questName === update.questName)); if (questIndex > -1) questFoundIn = 'completed'; }
        const { newDetailsLogEntry, ...restOfUpdate } = update;
        if (questFoundIn !== 'none') {
            let targetArray = questFoundIn === 'active' ? updatedActiveQuests : updatedCompletedQuests;
            let existingQuest = deepMergeResponses(targetArray[questIndex], restOfUpdate);
            if (newDetailsLogEntry) existingQuest.detailsLog = [...(existingQuest.detailsLog || []), newDetailsLogEntry];
            if ((questFoundIn === 'active' && (existingQuest.status === 'Completed' || existingQuest.status === 'Failed'))) { updatedActiveQuests.splice(questIndex, 1); updatedCompletedQuests.unshift(existingQuest); }
            else if (questFoundIn === 'completed' && (existingQuest.status === 'Active' || existingQuest.status === 'Updated')) { updatedCompletedQuests.splice(questIndex, 1); updatedActiveQuests.unshift(existingQuest); }
            else targetArray[questIndex] = existingQuest;
            if (existingQuest.questId) lastUpdatedQuestIds.add(existingQuest.questId);
        } else {
            const newQuest = { ...restOfUpdate, questId: restOfUpdate.questId || generateId('quest') } as Quest;
            if (newDetailsLogEntry) newQuest.detailsLog = [newDetailsLogEntry];
            if (newQuest.status === 'Completed' || newQuest.status === 'Failed') updatedCompletedQuests.unshift(newQuest); else updatedActiveQuests.unshift(newQuest);
            lastUpdatedQuestIds.add(newQuest.questId);
        }
    });
    newState.activeQuests = updatedActiveQuests;
    newState.completedQuests = updatedCompletedQuests;
    if (lastUpdatedQuestIds.size > 0) newState.lastUpdatedQuestId = Array.from(lastUpdatedQuestIds).pop();

    if (changes.removeWorldStateFlags) {
      const flagsToRemove = new Set(asArray(changes.removeWorldStateFlags));
      newState.worldStateFlags = newState.worldStateFlags.filter(flag => !flagsToRemove.has(flag.flagId));
    }

    // The fallback must see NPC arrivals and departures from this same turn.
    newState.NPCsInScene = changes.NPCsInScene ?? newState.encounteredNPCs.some(npc => npc && npc.currentLocationId === newState.currentLocationData.locationId);

    // Apply journal commands after inventories have been created or updated.
    // Top-level commands can address any inventory; commands directed to a
    // particular player must not fall back to another player's namesake.
    const applyItemJournals = (updates: NonNullable<GameResponse['itemJournalUpdates']>, items: Item[], previousItemIds: Set<string>) => {
        asArray(updates).forEach(update => {
            const matches = update.itemId
                ? items.filter(item => item?.existedId === update.itemId)
                : update.initialItemId
                    ? items.filter(item => item?.initialId === update.initialItemId && item.existedId && !previousItemIds.has(item.existedId))
                    : update.itemName ? items.filter(item => item?.name === update.itemName) : [];
            if (matches.length !== 1) {
                logsToAdd.push(t('warning_item_journal_identity', { subject: update.itemId || update.initialItemId || update.itemName || '?' }));
                return;
            }
            const item = matches[0];
            if (!Array.isArray(item.journalEntries)) item.journalEntries = [];
            item.journalEntries.unshift(update.entryToAppend);
        });
    };
    if (changes.itemJournalUpdates) {
        const inventories = [
            ...newState.players.map(p => p?.inventory),
            ...newState.encounteredNPCs.map(npc => npc?.inventory)
        ].filter((inventory): inventory is Item[] => Array.isArray(inventory));
        const previousItemIds = new Set<string>([
            ...asArray(baseState.playerCharacter?.inventory),
            ...baseState.players.flatMap(player => asArray(player?.inventory)),
            ...baseState.encounteredNPCs.flatMap(npc => asArray(npc?.inventory)),
        ].map(item => item?.existedId).filter((id): id is string => !!id));
        applyItemJournals(changes.itemJournalUpdates, inventories.flat(), previousItemIds);
        delete changes.itemJournalUpdates;
    }
    for (const [playerId, commands] of Object.entries(changes.otherPlayersInteractions || {})) {
        const index = newState.players.findIndex(player => player?.playerId === playerId);
        if (index < 0) continue;
        const previousIds = new Set<string>(asArray(baseState.players[index]?.inventory)
            .map(item => item?.existedId).filter((id): id is string => !!id));
        for (const command of asArray(commands as any)) {
            if (command?.itemJournalUpdates) {
                applyItemJournals(asArray(command.itemJournalUpdates), newState.players[index].inventory || [], previousIds);
                delete command.itemJournalUpdates;
            }
        }
    }

    const tickDownAndFilterEffects = (effects: Effect[] | undefined, shouldDecrement: boolean, updatedIds?: Set<string>): Effect[] => {
        if (!effects || effects.length === 0) {
            return [];
        }
    
        let processedEffects = effects;
        if (shouldDecrement) {
            processedEffects = effects.map(effect => {
                if (!effect || typeof effect.duration !== 'number' || effect.duration >= 999) {
                    return effect;
                }
                if (effect.effectId && updatedIds?.has(effect.effectId)) {
                    return effect; 
                }
                return { ...effect, duration: effect.duration - 1 };
            });
        }
    
        const activeEffects = processedEffects.filter((effect): effect is Effect => {
            if (!effect) return false;
            if (typeof effect.duration !== 'number' || effect.duration >= 999) {
                return true;
            }
            return effect.duration > 0;
        });
    
        return activeEffects;
    };

    newState.players = newState.players.map((p, index) => {
        if (p) {
            const playerUpdated = new Set(otherPlayerUpdatedEffectIds.get(index) || []);
            if (index === activePlayerIndex) activePlayerUpdatedEffectIds.forEach(id => playerUpdated.add(id));
            return { ...p, activePlayerEffects: tickDownAndFilterEffects(p.activePlayerEffects, advanceTurn, playerUpdated) };
        }
        return p;
    });
    
    newState.playerCharacter = newState.players[activePlayerIndex];

    newState.encounteredNPCs = newState.encounteredNPCs.map(npc => {
        if (npc) {
            return { ...npc, activeEffects: tickDownAndFilterEffects(npc.activeEffects, advanceTurn, npcUpdatedEffectIds.get(actorEffectKey(npc.NPCId, npc.name) || '')) };
        }
        return npc;
    });
    
    newState.enemiesData = newState.enemiesData.map(enemy => {
        if (enemy) {
            return {
                ...enemy,
                activeBuffs: tickDownAndFilterEffects(enemy.activeBuffs, advanceTurn, npcUpdatedEffectIds.get(actorEffectKey(enemy.NPCId, enemy.name) || '')),
                activeDebuffs: tickDownAndFilterEffects(enemy.activeDebuffs, advanceTurn, npcUpdatedEffectIds.get(actorEffectKey(enemy.NPCId, enemy.name) || ''))
            };
        }
        return enemy;
    });
    newState.alliesData = newState.alliesData.map(ally => {
        if (ally) {
            return {
                ...ally,
                activeBuffs: tickDownAndFilterEffects(ally.activeBuffs, advanceTurn, npcUpdatedEffectIds.get(actorEffectKey(ally.NPCId, ally.name) || '')),
                activeDebuffs: tickDownAndFilterEffects(ally.activeDebuffs, advanceTurn, npcUpdatedEffectIds.get(actorEffectKey(ally.NPCId, ally.name) || ''))
            };
        }
        return ally;
    });

    newState.encounteredNPCs.forEach(npc => {
        if (npc?.inventory) {
            npc.inventory.forEach(item => {
                delete (item as any)._patched_resource_consumption;
            });
        }
    });

    // --- AUTO-LOCK LOGIC START ---
    const REPUTATION_CAPS = [100, 250, 350];

    newState.encounteredNPCs.forEach(npc => {
        if (!npc.NPCId) return;
        
        // Find previous state to detect threshold crossing
        const oldNpc = baseState.encounteredNPCs.find(old => old.NPCId === npc.NPCId);
        if (!oldNpc) return; // Skip new NPCs to respect "Pre-Established Bond" rule

        const oldRel = oldNpc.relationshipLevel;
        const newRel = npc.relationshipLevel;

        for (const cap of REPUTATION_CAPS) {
            // Check if we crossed the cap upwards this turn
            // We check if the OLD level was strictly below the cap, and the NEW level is AT or ABOVE the cap.
            // This signifies crossing the threshold in this turn.
            if (oldRel < cap && newRel >= cap) {
                // Initialize lock object if missing (defensive coding)
                if (!npc.relationshipLock) {
                    npc.relationshipLock = { isLocked: false, breakthroughQuestId: null };
                }

                // If the GM failed to lock it (isLocked is false), we enforce it.
                if (!npc.relationshipLock.isLocked) {
                    console.log(`[Auto-Lock] Enforcing reputation cap for ${npc.name}. ${oldRel} -> ${newRel} (Cap: ${cap}). Locking at ${cap}.`);
                    
                    // Clamp value to the cap
                    npc.relationshipLevel = cap;
                    
                    // Set lock state
                    npc.relationshipLock.isLocked = true;
                    npc.relationshipLock.currentCap = cap;
                    
                    // Update attitude to match the clamped value
                    npc.attitude = getAttitudeAtLevel(cap);
                    
                    // Add a system log to inform the user
                    logsToAdd.push(t('relationship_locked_auto_msg', { name: npc.name, cap: cap }));
                }
            }
        }
    });
    // --- AUTO-LOCK LOGIC END ---

    newState.players = newState.players.map(p => p ? recalculateDerivedStats(recalculateAllWeights(p)) : null).filter((p): p is PlayerCharacter => !!p);
    newState.playerCharacter = newState.players[newState.activePlayerIndex];
    newState.encounteredNPCs = newState.encounteredNPCs.map(n => n ? recalculateDerivedStats(recalculateAllWeights(n)) : null).filter((n): n is NPC => !!n);
    newState.encounteredNPCs.forEach(npc => { if (npc?.inventory) npc.inventory = npc.inventory.filter((item: Item) => item.count > 0); });

    return { newState, logsToAdd, combatLogsToAdd, processedResponse };
};
