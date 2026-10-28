import { GameState, GameResponse, PlayerCharacter, Characteristics, Location, Faction, Language, LootTemplate, UnlockedMemory, Recipe, Item, WorldStateFlag, SkillMastery, GameSettings, WorldState, NPC, Effect, WorldEvent, QuestUpdate, PassiveSkill, LocationStorage, ActiveThreat, Project, CompletedProject, AdjacencyMapEntry, Calendar, CompleteThreatActivity, Month, NPCInventoryAdd, DayInfo, GameContext, ChatMessage } from '../types';
import { gameData } from './localizationGameData';
import { generateLootTemplates } from './lootGenerator';
import { translate } from './localization';
import { deepMergeResponses } from './responseProcessor';
import { createNewPlayerCharacter } from './characterManager';

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(item => item !== null && item !== undefined);
  }
  return [value];
};

const CHARACTERISTICS_LIST = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'faith', 'attractiveness', 'trade', 'persuasion', 'perception', 'luck', 'speed'];
const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Cryptographically secure random number generator for D20 dice to prevent patterns
const generateSecureRandomD20Array = (length: number): number[] => {
    const rolls: number[] = [];
    if (typeof window !== 'undefined' && window.crypto) {
        const array = new Uint32Array(length);
        window.crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            // Map 32-bit random integer to 1-20 range
            rolls.push((array[i] % 20) + 1);
        }
    } else {
        // Fallback for non-browser environments
        for (let i = 0; i < length; i++) {
            rolls.push(Math.floor(Math.random() * 20) + 1);
        }
    }
    return rolls;
};

const BIOME_WEATHER: Record<string, string[]> = {
    TemperateForest: ['Clear', 'Cloudy', 'Overcast', 'Foggy', 'Light Rain', 'Heavy Rain', 'Storm'],
    Plains: ['Clear', 'Cloudy', 'Overcast', 'Foggy', 'Light Rain', 'Heavy Rain', 'Storm'],
    Desert: ['Clear', 'Scorching Sun', 'Cloudy', 'Windy', 'Sandstorm'],
    ArcticTundra: ['Clear', 'Frigid Air', 'Cloudy', 'Light Snow', 'Heavy Snow', 'Blizzard'],
    Mountains: ['Clear', 'Frigid Air', 'Cloudy', 'Light Snow', 'Heavy Snow', 'Blizzard'],
    Swamp: ['Clear', 'Humid', 'Misty', 'Foggy', 'Drizzle', 'Downpour'],
    Coastal: ['Clear', 'Cloudy', 'Foggy', 'Light Rain', 'Heavy Rain', 'Storm'],
    Urban: ['Clear', 'Cloudy', 'Overcast', 'Foggy', 'Light Rain', 'Heavy Rain', 'Storm'],
    Unique: ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow', 'Foggy'], // a generic fallback
};

export function recalculateDerivedStats<T extends PlayerCharacter | NPC>(pc: T): T {
    const newPc = JSON.parse(JSON.stringify(pc)); // Work on a copy

    if (!newPc.characteristics) {
        console.warn('recalculateDerivedStats: characteristics is undefined, initializing with defaults');
        newPc.characteristics = {} as any;
    }

    const permanentlyModifiedValues: Record<string, number> = {};

    CHARACTERISTICS_LIST.forEach(char => {
        const charCapitalized = char.charAt(0).toUpperCase() + char.slice(1);
        const standardKey = `standard${charCapitalized}` as keyof PlayerCharacter['characteristics'];
        const standardValue = (newPc.characteristics as any)[standardKey] as number;
        const safeStandardValue = typeof standardValue === 'number' ? standardValue : 1;

        let permanentFlatBonusTotal = 0;

        Object.values(newPc.equippedItems || {}).forEach((itemId: string | null) => {
            if (!itemId) return;
            const item = (newPc.inventory || []).find((i: Item) => i.existedId === itemId);
            if (!item) return;

            if (item.structuredBonuses && item.structuredBonuses.length > 0) {
                item.structuredBonuses.forEach(bonus => {
                    if (
                        bonus.bonusType === 'Characteristic' &&
                        bonus.target.toLowerCase() === char.toLowerCase() &&
                        bonus.application === 'Permanent' &&
                        !bonus.condition &&
                        bonus.valueType === 'Flat' &&
                        typeof bonus.value === 'number'
                    ) {
                        permanentFlatBonusTotal += bonus.value;
                    }
                });
            } else if (item.bonuses) { // Legacy fallback
                (item.bonuses as string[]).forEach((bonus: string) => {
                    const match = bonus.match(/^([+-]?\d+)\s+(.+)$/);
                    if (match && match[2].toLowerCase() === char) {
                        permanentFlatBonusTotal += parseInt(match[1], 10);
                    }
                });
            }
        });

        (newPc.passiveSkills || []).forEach((skill: PassiveSkill) => {
            let bonusApplied = false;
            if (skill.structuredBonuses && skill.structuredBonuses.length > 0) {
                skill.structuredBonuses.forEach(bonus => {
                    if (
                        bonus.bonusType === 'Characteristic' &&
                        bonus.target.toLowerCase() === char.toLowerCase() &&
                        bonus.application === 'Permanent' &&
                        !bonus.condition &&
                        bonus.valueType === 'Flat' &&
                        typeof bonus.value === 'number'
                    ) {
                        permanentFlatBonusTotal += bonus.value;
                        bonusApplied = true;
                    }
                });
            }

            if (!bonusApplied && skill.playerStatBonus) { // Legacy fallback
                const match = skill.playerStatBonus.match(/^([+-]?\d+)\s+(.+)$/);
                const charName = match?.[2]?.toLowerCase();
                if (match && charName && CHARACTERISTICS_LIST.includes(charName) && charName === char) {
                    permanentFlatBonusTotal += parseInt(match[1], 10);
                }
            }
        });

        permanentlyModifiedValues[char] = safeStandardValue + permanentFlatBonusTotal;
    });

    const pmStr = permanentlyModifiedValues.strength || 1;
    const pmCon = permanentlyModifiedValues.constitution || 1;
    const pmInt = permanentlyModifiedValues.intelligence || 1;
    const pmWis = permanentlyModifiedValues.wisdom || 1;
    const pmFth = permanentlyModifiedValues.faith || 1;
    const pmLck = permanentlyModifiedValues.luck || 1;

    newPc.maxHealth = 100 + Math.floor(pmCon * 2.0) + Math.floor(pmStr * 1.0);
    newPc.maxEnergy = 100 + Math.floor(pmCon * 0.75) + Math.floor(pmInt * 0.75) + Math.floor(pmWis * 0.75) + Math.floor(pmFth * 0.75);
    newPc.maxWeight = 30 + Math.floor(pmStr * 1.8 + pmCon * 0.4);
    newPc.critChanceBuffFromLuck = Math.floor(pmLck / 20);
    newPc.critChanceThreshold = 20 - newPc.critChanceBuffFromLuck;

    if (newPc.currentHealth === undefined) newPc.currentHealth = newPc.maxHealth;
    if (newPc.currentEnergy === undefined) newPc.currentEnergy = newPc.maxEnergy;

    newPc.currentHealth = Math.min(newPc.currentHealth, newPc.maxHealth);
    newPc.currentEnergy = Math.min(newPc.currentEnergy, newPc.maxEnergy);

    CHARACTERISTICS_LIST.forEach(char => {
        const charCapitalized = char.charAt(0).toUpperCase() + char.slice(1);
        const modifiedKey = `modified${charCapitalized}` as keyof PlayerCharacter['characteristics'];

        const permanentlyModifiedValue = permanentlyModifiedValues[char] || 1;
        let conditionalFlatBonusTotal = 0;
        let percentageBonusTotal = 0;

        Object.values(newPc.equippedItems || {}).forEach((itemId: string | null) => {
            if (!itemId) return;
            const item = (newPc.inventory || []).find((i: Item) => i.existedId === itemId);
            if (!item?.structuredBonuses) return;
            item.structuredBonuses.forEach(bonus => {
                if (
                    bonus.bonusType === 'Characteristic' &&
                    bonus.target.toLowerCase() === char.toLowerCase() &&
                    bonus.application === 'Conditional' &&
                    bonus.valueType === 'Flat' &&
                    typeof bonus.value === 'number'
                ) {
                    conditionalFlatBonusTotal += bonus.value;
                }
            });
        });

        (newPc.passiveSkills || []).forEach((skill: PassiveSkill) => {
            if (!skill.structuredBonuses) return;
            skill.structuredBonuses.forEach(bonus => {
                if (
                    bonus.bonusType === 'Characteristic' &&
                    bonus.target.toLowerCase() === char.toLowerCase() &&
                    bonus.application === 'Conditional' &&
                    bonus.valueType === 'Flat' &&
                    typeof bonus.value === 'number'
                ) {
                    conditionalFlatBonusTotal += bonus.value;
                }
            });
        });

        const activeEffects = (newPc as PlayerCharacter).activePlayerEffects || (newPc as NPC).activeEffects || [];
        activeEffects.forEach((effect: Effect) => {
            if ((effect.effectType === 'Buff' || effect.effectType === 'Debuff') && effect.targetType.toLowerCase() === char.toLowerCase()) {
                if (typeof effect.value === 'string' && effect.value.includes('%')) {
                    const percentageValue = parseInt(effect.value.replace('%', ''));
                    if (!isNaN(percentageValue)) {
                        percentageBonusTotal += percentageValue;
                    }
                }
            }
        });

        const modifiedValue = Math.round((permanentlyModifiedValue + conditionalFlatBonusTotal) * (1 + (percentageBonusTotal / 100)));
        (newPc.characteristics as any)[modifiedKey] = modifiedValue;
    });

    return newPc;
}

export const calculateDate = (totalMinutes: number, calendar: Calendar): WorldState['date'] => {
    const minutesInDay = 24 * 60;
    
    // Calculate time of day using robust modulo to handle negative minutes correctly.
    // ((a % n) + n) % n ensures the result is always positive [0, n-1]
    const minutesIntoDay = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
    const hours = Math.floor(minutesIntoDay / 60);
    const minutes = Math.floor(minutesIntoDay % 60);
    const timeOfDayString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    // Total days can be negative (before start of campaign)
    const totalDays = Math.floor(totalMinutes / minutesInDay);

    if (!calendar || !calendar.months || calendar.months.length === 0 || !calendar.dayNames || calendar.dayNames.length === 0) {
        // FALLBACK LOGIC: Used only if calendar config is missing/broken.
        // We simulate a generic 30-day month cycle to avoid "Day 201".
        const fallbackCycle = 30;
        // Robust modulo to ensure day index is 0..29 even for negative totalDays
        const dayIndex = ((totalDays % fallbackCycle) + fallbackCycle) % fallbackCycle;
        const dayOfMonth = dayIndex + 1; // Convert 0-based index to 1-based calendar day

        return {
            currentYear: 1 + Math.floor(totalDays / 360), // Rough approximation
            currentMonthName: 'Unknown',
            dayOfMonth: dayOfMonth,
            dayOfWeekName: 'Unknown',
            timeOfDay: timeOfDayString,
        };
    }

    const yearLengthInDays = calendar.months.reduce((acc, month) => acc + month.days, 0);

    if (yearLengthInDays === 0) {
      const dayOfWeekName = calendar.dayNames.length > 0 ? calendar.dayNames[((Math.abs(totalDays) % calendar.daysInWeek) + calendar.daysInWeek) % calendar.daysInWeek]?.name || 'Unknown' : 'Unknown';
      return {
          currentYear: calendar.startingYear,
          currentMonthName: calendar.months[0]?.name || 'Unknown',
          dayOfMonth: 1,
          dayOfWeekName,
          timeOfDay: timeOfDayString,
      };
    }
    
    // Calculate elapsed years. Using Math.floor handles negatives correctly (-0.5 -> -1)
    const yearsPassed = Math.floor(totalDays / yearLengthInDays);
    const currentYear = calendar.startingYear + yearsPassed;
    
    // Calculate day within the current year (0-indexed) using robust modulo to ensure it's always positive [0, yearLength-1]
    let dayOfYear = ((totalDays % yearLengthInDays) + yearLengthInDays) % yearLengthInDays;

    let currentMonthName = '';
    let dayOfMonth = 1;

    for (const month of calendar.months) {
        if (dayOfYear < month.days) {
            currentMonthName = month.name;
            dayOfMonth = dayOfYear + 1; // +1 because days start at 1 (0-indexed time -> 1-based date)
            break;
        }
        dayOfYear -= month.days;
    }
    
    if (!currentMonthName) {
        const lastMonth = calendar.months[calendar.months.length - 1];
        currentMonthName = lastMonth?.name || 'Unknown';
        dayOfMonth = lastMonth?.days || 1;
    }
    
    // Calculate day of week using robust modulo
    const dayOfWeekIndex = ((totalDays % calendar.daysInWeek) + calendar.daysInWeek) % calendar.daysInWeek;
    const dayOfWeekName = calendar.dayNames.length > 0 
        ? calendar.dayNames[dayOfWeekIndex]?.name || 'Unknown' 
        : 'Unknown';

    return {
        currentYear,
        currentMonthName,
        dayOfMonth: Math.max(1, Math.abs(dayOfMonth)), // Safety clamp
        dayOfWeekName,
        timeOfDay: timeOfDayString,
    };
};

export const calculateTotalMinutes = (date: { year: number, monthIndex: number, day: number }, calendar: Calendar): number => {
    if (!calendar || !calendar.months || calendar.months.length === 0) {
        return 0;
    }
    const yearLengthInDays = calendar.months.reduce((acc, month) => acc + month.days, 0);
    if (yearLengthInDays === 0) return 0;
    
    // Simple year calculation
    const yearsPassed = date.year - calendar.startingYear;
    let daysPassed = yearsPassed * yearLengthInDays;

    for (let i = 0; i < date.monthIndex; i++) {
        daysPassed += calendar.months[i].days;
    }

    daysPassed += (date.day - 1);

    return daysPassed * 24 * 60; 
};

export const calculateJourneyDay = (currentMinutes: number, startMinutes?: number): number => {
    if (startMinutes !== undefined) {
        const elapsed = currentMinutes - startMinutes;
        return Math.floor(Math.max(0, elapsed) / (24 * 60)) + 1;
    }
    return Math.abs(Math.floor(currentMinutes / (24 * 60)));
};

export function updateWorldMap(
    currentMap: Record<string, Location>,
    updates: GameResponse['worldMapUpdates'],
    currentLocation: Location,
    currentTurnNumber: number
): Record<string, Location> {
    const newMap: Record<string, Location> = JSON.parse(JSON.stringify(currentMap));

    if (currentLocation.locationId) {
        newMap[currentLocation.locationId] = deepMergeResponses(newMap[currentLocation.locationId], currentLocation);
    }

    if (!updates) {
        return newMap;
    }
    
    const existingCoords = new Set<string>();
    Object.values(newMap).forEach(loc => {
        if (loc.coordinates) {
            existingCoords.add(`${loc.coordinates.x},${loc.coordinates.y}`);
        }
    });

    const initialIdToLocationIdMap = new Map<string, string>();

    asArray(updates.newLocations).forEach(newLoc => {
        if (!newLoc.coordinates) return;
        const coordKey = `${newLoc.coordinates.x},${newLoc.coordinates.y}`;
        if (existingCoords.has(coordKey)) return;
        
        const newLocationId = newLoc.locationId || generateId('loc');
        newLoc.locationId = newLocationId;

        if (newLoc.initialId) {
            initialIdToLocationIdMap.set(newLoc.initialId, newLocationId);
        }

        if (newLoc.locationStorages) {
            newLoc.locationStorages = (newLoc.locationStorages as Partial<LocationStorage>[]).map(storage => {
                if (!storage) return null;
                return { ...storage, storageId: storage.storageId || generateId('storage') } as LocationStorage;
            }).filter((s): s is LocationStorage => !!s);
        }
        
        newMap[newLocationId] = newLoc as Location;
        existingCoords.add(coordKey);
    });

    asArray(updates.locationUpdates).forEach(update => {
        if (update.locationId && newMap[update.locationId]) {
            const originalLocation = newMap[update.locationId];
            const updateAny = update as any;
            
            const { newLastEventsDescription, ...restOfUpdate } = updateAny;
    
            const cleanUpdate: Partial<Location> = {};
            if (restOfUpdate.newName) cleanUpdate.name = restOfUpdate.newName;
            if (restOfUpdate.newDescription) cleanUpdate.description = restOfUpdate.newDescription;
            if (restOfUpdate.newInternalDifficultyProfile) cleanUpdate.internalDifficultyProfile = deepMergeResponses(originalLocation.internalDifficultyProfile, restOfUpdate.newInternalDifficultyProfile);
            if (restOfUpdate.newExternalDifficultyProfile) cleanUpdate.externalDifficultyProfile = deepMergeResponses(originalLocation.externalDifficultyProfile, restOfUpdate.newExternalDifficultyProfile);
            
            for (const key in restOfUpdate) {
                if (!key.startsWith('new') && key !== 'locationId') {
                    (cleanUpdate as any)[key] = (restOfUpdate as any)[key];
                }
            }
            
            if (restOfUpdate.locationStorages) {
                cleanUpdate.locationStorages = (restOfUpdate.locationStorages as Partial<LocationStorage>[]).map(storage => {
                    if (!storage) return null;
                    const existingStorage = originalLocation?.locationStorages?.find(s => s.storageId === storage.storageId);
                    return {
                        ...existingStorage,
                        ...storage,
                        storageId: storage.storageId || existingStorage?.storageId || generateId('storage'),
                    } as LocationStorage;
                }).filter((s): s is LocationStorage => !!s);
            }
    
            let mergedLocation = deepMergeResponses(originalLocation, cleanUpdate) as Location;

            if (newLastEventsDescription && typeof newLastEventsDescription === 'string') {
                if (!Array.isArray(mergedLocation.eventDescriptions)) {
                    mergedLocation.eventDescriptions = [];
                }
                mergedLocation.eventDescriptions.unshift(newLastEventsDescription);
            }
    
            newMap[update.locationId] = mergedLocation;
        }
    });

    asArray(updates.newLinks).forEach(linkUpdate => {
        const source = newMap[linkUpdate.sourceLocationId];
        if (source) {
            if (!source.adjacencyMap) source.adjacencyMap = [];
            if (!source.adjacencyMap.some(l => 
                l.targetCoordinates.x === linkUpdate.link.targetCoordinates.x &&
                l.targetCoordinates.y === linkUpdate.link.targetCoordinates.y
            )) {
                source.adjacencyMap.push(linkUpdate.link);
            }
        }
    });

    asArray(updates.linkUpdates).forEach(update => {
        const source = newMap[update.sourceLocationId];
        if (source?.adjacencyMap) {
            const linkIndex = source.adjacencyMap.findIndex(l => 
                l.targetCoordinates.x === update.targetCoordinates.x && 
                l.targetCoordinates.y === update.targetCoordinates.y
            );
            if (linkIndex > -1) {
                source.adjacencyMap[linkIndex] = deepMergeResponses(source.adjacencyMap[linkIndex], update.updatedLink);
            }
        }
    });

    asArray(updates.linksToRemove).forEach(removal => {
        const source = newMap[removal.sourceLocationId];
        if (source?.adjacencyMap) {
            source.adjacencyMap = source.adjacencyMap.filter(l => 
                !(l.targetCoordinates.x === removal.targetCoordinates.x && 
                  l.targetCoordinates.y === removal.targetCoordinates.y)
            );
        }
    });

    const { threatsToAdd, threatsToUpdate, threatsToRemove, completeThreatActivities, storageUpdates, storagesToRemove } = updates || {};
    
    if (storageUpdates) {
        asArray(storageUpdates).forEach(update => {
            const location = newMap[update.targetLocationId];
            if (location && location.locationStorages) {
                const storageIndex = location.locationStorages.findIndex(s => s.storageId === update.storageId);
                if (storageIndex > -1) {
                    const originalStorage = location.locationStorages[storageIndex];
                    const updatePayload = update.update;

                    const cleanUpdate: Partial<LocationStorage> = {};
                    if (updatePayload.newName) cleanUpdate.name = updatePayload.newName;
                    if (updatePayload.newDescription) cleanUpdate.description = updatePayload.newDescription;
                    if (updatePayload.newCapacity !== undefined) cleanUpdate.capacity = updatePayload.newCapacity;
                    if (updatePayload.newOwner) cleanUpdate.owner = updatePayload.newOwner;

                    for (const key in updatePayload) {
                        if (!key.startsWith('new')) {
                            (cleanUpdate as any)[key] = (updatePayload as any)[key];
                        }
                    }
                    
                    location.locationStorages[storageIndex] = deepMergeResponses(originalStorage, cleanUpdate) as LocationStorage;
                }
            }
        });
    }

    if (storagesToRemove) {
        asArray(storagesToRemove).forEach(removal => {
            const location = newMap[removal.targetLocationId];
            if (location && location.locationStorages) {
                location.locationStorages = location.locationStorages.filter(s => s.storageId !== removal.storageId);
            }
        });
    }

    if (threatsToAdd) {
        asArray(threatsToAdd).forEach(add => {
            let targetLocationId = add.targetLocationId;
            if (add.initialTargetLocationId) {
                const foundId = initialIdToLocationIdMap.get(add.initialTargetLocationId);
                if (foundId) targetLocationId = foundId;
                else console.warn(`Could not find a new location with initialId: ${add.initialTargetLocationId} for a new threat.`);
            }
            if (targetLocationId && newMap[targetLocationId]) {
                if (!newMap[targetLocationId].activeThreats) newMap[targetLocationId].activeThreats = [];
                const newThreat = { ...add.threat, threatId: add.threat.threatId || generateId('threat') };
                newMap[targetLocationId].activeThreats!.push(newThreat);
            } else if(targetLocationId) {
                console.warn(`Attempted to add a threat to a non-existent location ID: ${targetLocationId}`);
            }
        });
    }

    if (threatsToUpdate) {
        asArray(threatsToUpdate).forEach(update => {
            if (update.targetLocationId && newMap[update.targetLocationId] && newMap[update.targetLocationId].activeThreats) {
                const location = newMap[update.targetLocationId];
                let threatIndex = -1;
                if (update.threatUpdate.threatId) threatIndex = location.activeThreats!.findIndex(t => t.threatId === update.threatUpdate.threatId);
                if (threatIndex === -1 && update.threatUpdate.name) threatIndex = location.activeThreats!.findIndex(t => t.name === update.threatUpdate.name);
                if (threatIndex > -1) {
                    if (!location.activeThreats![threatIndex].threatId) location.activeThreats![threatIndex].threatId = generateId('threat');
                    location.activeThreats![threatIndex] = deepMergeResponses(location.activeThreats![threatIndex], update.threatUpdate) as ActiveThreat;
                }
            }
        });
    }

    if (threatsToRemove) {
        asArray(threatsToRemove).forEach(remove => {
            if (remove.targetLocationId && newMap[remove.targetLocationId] && newMap[remove.targetLocationId].activeThreats) {
                newMap[remove.targetLocationId].activeThreats = newMap[remove.targetLocationId].activeThreats!.filter(t => t.threatId !== remove.threatId);
            }
        });
    }

    if (completeThreatActivities) {
        asArray(completeThreatActivities).forEach(completion => {
            const location = newMap[completion.targetLocationId];
            if (location && location.activeThreats) {
                const threatIndex = location.activeThreats.findIndex(t => t.threatId === completion.threatId);
                if (threatIndex > -1) {
                    const threat = location.activeThreats[threatIndex];
                    if (!threat.completedActivities) threat.completedActivities = [];
                    threat.completedActivities.unshift({
                        activityName: threat.currentActivity?.activityName || completion.threatName,
                        finalState: completion.finalState,
                        narrativeSummary: completion.narrativeSummary,
                        completionTurn: currentTurnNumber,
                    });
                    threat.currentActivity = null;
                } else {
                    console.warn(`Could not find threat with id ${completion.threatId} in location ${completion.targetLocationId} to complete its activity.`);
                }
            }
        });
    }

    return newMap;
}


export function buildNextContext(
    currentContext: GameContext,
    response: GameResponse,
    newState: GameState,
    newHistory: ChatMessage[],
    advanceTurn: boolean = true
): GameContext {
    // ... (Same as previous patches for resource consistency) ...
    if (response.inventoryItemsResources) {
        const resourceChangesForNewItems = asArray(response.inventoryItemsResources).filter(rc => rc.existedId === null && rc.name);
        if (resourceChangesForNewItems.length > 0) {
            const processInventory = (inventory: Item[]) => {
                if (!inventory) return;
                inventory.forEach(item => {
                    if (item.resource === undefined) {
                        const resourceInfoIndex = resourceChangesForNewItems.findIndex(rc => rc.name === item.name && !(rc as any)._used);
                        if (resourceInfoIndex > -1) {
                            const resourceInfo = resourceChangesForNewItems[resourceInfoIndex];
                            item.resource = resourceInfo.resource;
                            item.maximumResource = resourceInfo.maximumResource;
                            item.resourceType = resourceInfo.resourceType;
                            (resourceInfo as any)._used = true;
                        }
                    }
                });
            };
            newState.players.forEach(player => processInventory(player.inventory));
            newState.encounteredNPCs.forEach(npc => processInventory(npc.inventory));
        }
    }
    
    if (response.NPCInventoryResourcesChanges) {
        const resourceChangesForNewNpcItems = asArray(response.NPCInventoryResourcesChanges).filter(rc => (rc.itemId === null || rc.itemId === undefined) && rc.itemName);
        if (resourceChangesForNewNpcItems.length > 0) {
            resourceChangesForNewNpcItems.forEach(resourceChange => {
                if ((resourceChange as any)._used) return;

                const npc = newState.encounteredNPCs.find(n => (n.NPCId && n.NPCId === resourceChange.NPCId) || n.name === resourceChange.NPCName);
                if (npc && npc.inventory) {
                    const itemIndex = npc.inventory.findIndex(item => 
                        item.name === resourceChange.itemName && 
                        item.resource === undefined && 
                        !(item as any)._patched_resource
                    );

                    if (itemIndex > -1) {
                        const item = npc.inventory[itemIndex];
                        const resourceValue = (resourceChange as any).newResourceValue ?? (resourceChange as any).resource;

                        if (resourceValue !== undefined) {
                            item.resource = resourceValue;
                            if ((resourceChange as any).maximumResource !== undefined) {
                                item.maximumResource = (resourceChange as any).maximumResource;
                            } else {
                                item.maximumResource = resourceValue;
                            }
                            if ((resourceChange as any).resourceType !== undefined) {
                                item.resourceType = (resourceChange as any).resourceType;
                            }
                            (item as any)._patched_resource = true;
                            (resourceChange as any)._used = true;
                        }
                    }
                }
            });

            newState.encounteredNPCs.forEach(npc => {
                if (npc?.inventory) {
                    npc.inventory.forEach(item => {
                        delete (item as any)._patched_resource;
                    });
                }
            });
        }
    }


    if (response.inventoryItemsResources) {
        const resourceChangesForNewItems = asArray(response.inventoryItemsResources).filter(rc => rc.existedId === null && rc.name);
        if (resourceChangesForNewItems.length > 0) {
            const processInventory = (inventory: Item[]) => {
                if (!inventory) return;
                inventory.forEach(item => {
                    if (item.resource === undefined) {
                        const resourceInfoIndex = resourceChangesForNewItems.findIndex(rc => rc.name === item.name && !(rc as any)._used);
                        if (resourceInfoIndex > -1) {
                            const resourceInfo = resourceChangesForNewItems[resourceInfoIndex];
                            item.resource = resourceInfo.resource;
                            item.maximumResource = resourceInfo.maximumResource;
                            item.resourceType = resourceInfo.resourceType;
                            (resourceInfo as any)._used = true;
                        }
                    }
                });
            };
            newState.players.forEach(player => processInventory(player.inventory));
            newState.encounteredNPCs.forEach(npc => processInventory(npc.inventory));
        }
    }

    let newTurnNumber = currentContext.currentTurnNumber;
    let newActivePlayerIndex = newState.activePlayerIndex;

    if (advanceTurn) {
        const isManualPass = currentContext.message === '[System Action] Pass turn';
        const isAutoPass = currentContext.gameSettings.autoPassTurnInCoop ?? true;
        const isCoop = currentContext.gameSettings.cooperativeGameType === 'FullParty' || currentContext.gameSettings.cooperativeGameType === 'MultiplePersonalities';

        if (isCoop && (isAutoPass || isManualPass)) {
            const nextIndex = (newState.activePlayerIndex + 1);
            if (nextIndex >= newState.players.length) {
                newTurnNumber++;
                newActivePlayerIndex = 0;
            } else {
                newActivePlayerIndex = nextIndex;
            }
        } else if (!isCoop) {
            newTurnNumber++;
        }
    }
    
    newState.activePlayerIndex = newActivePlayerIndex;


    const newWorldState: WorldState = { ...currentContext.worldState };
    let newTotalMinutes = Number(newWorldState.currentTimeInMinutes || 0);

    if (response.setWorldTime) {
        const { year, monthName, dayOfMonth, timeOfDay } = response.setWorldTime;
        const calendar = currentContext.gameSettings.gameWorldInformation.calendar!;
        const monthIndex = calendar.months.findIndex(m => m.name === monthName);
        const [hours, minutes] = timeOfDay.split(':').map(Number);
        const minutesIntoDay = hours * 60 + minutes;
        const totalDaysMinutes = calculateTotalMinutes({ year, monthIndex: monthIndex > -1 ? monthIndex : 0, day: dayOfMonth }, calendar);
        newTotalMinutes = totalDaysMinutes + minutesIntoDay;
    } else if (response.timeChange && response.timeChange > 0) {
        newTotalMinutes += (Number(response.timeChange) || 0);
    }
    
    // Ensure time cannot go negative unless intended by setWorldTime for flashbacks (not fully supported by simple clamp)
    // But for general game flow, time only moves forward.
    // We rely on calculateDate to handle large/negative numbers correctly for "Day" display.
    newWorldState.currentTimeInMinutes = newTotalMinutes;


    const calendar = currentContext.gameSettings.gameWorldInformation.calendar!;
    const newDate = calculateDate(newTotalMinutes, calendar);
    newWorldState.date = newDate;
    newWorldState.day = calculateJourneyDay(newTotalMinutes, newWorldState.campaignStartTimeInMinutes);

    if (response.updateWorldProgressionTracker) {
        newWorldState.lastWorldProgressionTimeInMinutes = response.updateWorldProgressionTracker.newLastWorldProgressionTimeInMinutes;
    }
    
    if (response.updateFactionProgressionTracker) {
        newWorldState.lastFactionProgressionTimeInMinutes = response.updateFactionProgressionTracker.newLastFactionProgressionTimeInMinutes;
    }

    if (response.weatherChange && response.weatherChange.tendency !== 'NO_CHANGE') {
        const currentBiome = newState.currentLocationData.biome || 'TemperateForest';
        const weatherOptions = BIOME_WEATHER[currentBiome] || BIOME_WEATHER['Unique'];
        const currentIdx = weatherOptions.indexOf(newWorldState.weather);

        if (response.weatherChange.tendency.startsWith('JUMP_TO_')) {
            const targetWeatherRaw = response.weatherChange.tendency.replace('JUMP_TO_', '').replace(/_/g, ' ');
            const foundWeather = weatherOptions.find(option => option.toLowerCase() === targetWeatherRaw.toLowerCase());
            if (foundWeather) {
                newWorldState.weather = foundWeather;
            }
        } else if (currentIdx !== -1) {
            if (response.weatherChange.tendency === 'IMPROVE') {
                newWorldState.weather = weatherOptions[Math.max(0, currentIdx - 1)];
            } else if (response.weatherChange.tendency === 'WORSEN') {
                newWorldState.weather = weatherOptions[Math.min(weatherOptions.length - 1, currentIdx + 1)];
            }
        }
    }
    
    if (!newState.currentLocationData) {
        console.warn("newState.currentLocationData was null in buildNextContext. Recovering from currentContext.");
        newState.currentLocationData = currentContext.currentLocation;
    }

    let baseMap = currentContext.worldMap;
    if (currentContext.currentTurnNumber === 1 && advanceTurn) {
        baseMap = {};
    }

    const newWorldMap = updateWorldMap(baseMap, response.worldMapUpdates, newState.currentLocationData as Location, currentContext.currentTurnNumber);
    
    if (newState.currentLocationData?.locationId && newWorldMap[newState.currentLocationData.locationId]) {
        newState.currentLocationData = newWorldMap[newState.currentLocationData.locationId];
    }
    
    const allLocationsNow: Location[] = Object.values(newWorldMap);
    const allLocationsMap = new Map(allLocationsNow.map(l => [l.locationId!, l]));

    const changedLocationIds = new Set<string>();
    if (newState.currentLocationData?.locationId) {
        changedLocationIds.add(newState.currentLocationData.locationId);
    }
    asArray(response.worldMapUpdates?.locationUpdates).forEach(u => {
        if (u.locationId) changedLocationIds.add(u.locationId);
    });
    const previousIds = new Set(currentContext.visitedLocations.map(l => l.locationId!));
    allLocationsNow.forEach(l => {
        if (l.locationId && !previousIds.has(l.locationId)) {
            changedLocationIds.add(l.locationId);
        }
    });

    let previousOrderedList = currentContext.visitedLocations
        .map(loc => loc.locationId ? allLocationsMap.get(loc.locationId) : null)
        .filter((l): l is Location => !!l);
    
    const existingIdsInOrderedList = new Set(previousOrderedList.map(l => l.locationId!));
    const brandNewLocations = allLocationsNow.filter(l => l.locationId && !existingIdsInOrderedList.has(l.locationId));
    previousOrderedList.push(...brandNewLocations);

    const topLocations: Location[] = [];
    const bottomLocations: Location[] = [];

    previousOrderedList.forEach(loc => {
        if (loc.locationId && changedLocationIds.has(loc.locationId)) {
            topLocations.push(loc);
        } else {
            bottomLocations.push(loc);
        }
    });

    const newVisitedLocations = [...topLocations, ...bottomLocations];

    const updatedActiveQuests = [...newState.activeQuests];
    const updatedCompletedQuests = [...newState.completedQuests];
    asArray(response.questUpdates).forEach((update: QuestUpdate) => {
        if (update.newDetailsLogEntry && update.questId) {
            let questFound = false;
            const activeIndex = updatedActiveQuests.findIndex(q => q.questId === update.questId);
            if (activeIndex > -1) {
                const existingQuest = updatedActiveQuests[activeIndex];
                const newDetailsLog = [...(existingQuest.detailsLog || []), update.newDetailsLogEntry];
                updatedActiveQuests[activeIndex] = { ...existingQuest, detailsLog: newDetailsLog };
                questFound = true;
            }
            if (!questFound) {
                const completedIndex = updatedCompletedQuests.findIndex(q => q.questId === update.questId);
                if (completedIndex > -1) {
                    const existingQuest = updatedCompletedQuests[completedIndex];
                    const newDetailsLog = [...(existingQuest.detailsLog || []), update.newDetailsLogEntry];
                    updatedCompletedQuests[completedIndex] = { ...existingQuest, detailsLog: newDetailsLog };
                }
            }
        }
    });

    if (response.removeWorldStateFlags) {
      const flagsToRemove = new Set(asArray(response.removeWorldStateFlags));
      newState.worldStateFlags = newState.worldStateFlags.filter(flag => !flagsToRemove.has(flag.flagId));
    }

    const nextContext: GameContext = {
        message: '',
        image: null,
        superInstructions: currentContext.superInstructions,
        currentStepFocus: null,
        partiallyGeneratedResponse: null,
        currentTurnNumber: newTurnNumber,
        gameSettings: currentContext.gameSettings,
        worldState: newWorldState,
        worldStateFlags: newState.worldStateFlags,
        players: newState.players,
        playerCharacter: newState.players[newActivePlayerIndex],
        currentLocation: newState.currentLocationData,
        visitedLocations: newVisitedLocations,
        activeQuests: updatedActiveQuests,
        completedQuests: updatedCompletedQuests,
        encounteredNPCs: newState.encounteredNPCs,
        npcSkillMasteryData: [],
        lootForCurrentTurn: generateLootTemplates(response.multipliers, newState.players[newActivePlayerIndex], 5),
        preGeneratedDices1d20: generateSecureRandomD20Array(50),
        previousTurnResponse: response,
        encounteredFactions: newState.encounteredFactions,
        plotOutline: newState.plotOutline,
        worldMap: newWorldMap,
        responseHistory: newHistory.slice(-15),
        enemiesDataForCurrentTurn: newState.enemiesData,
        alliesDataForCurrentTurn: newState.alliesData,
        playerCustomStates: newState.playerCustomStates,
        worldEventsLog: newState.worldEventsLog,
        networkRole: newState.networkRole,
        peers: newState.peers,
        isConnectedToHost: newState.isConnectedToHost,
        // Pass the new thought signature to the next context to maintain reasoning continuity
        previousThoughtSignature: response.thoughtSignature
    };

  return nextContext;
}

export const createInitialContext = (creationData: any, language: Language): GameContext => {
    const { universe, selectedEra, worldInformation, superInstructions, initialPrompt, ...characterCreationData } = creationData;
    const t = (key: string, replacements?: any) => translate(language, key, replacements);

    const gameDataSource = creationData.customGameData || gameData;
    let currentWorld: any;
    
    if (universe === 'custom') {
        currentWorld = (gameDataSource.custom && (gameDataSource.custom as any)[selectedEra]) || {
            name: selectedEra || t('New Universe'), description: t('Create your own world from scratch...'), races: {}, classes: {}, currencyName: 'Gold', currencyOptions: ['Gold'],
            calendar: JSON.parse(JSON.stringify(gameData.fantasy.calendar))
        };
    } else if (universe === 'history') {
        currentWorld = gameDataSource.history[selectedEra as keyof typeof gameDataSource.history];
    } else if (universe === 'myths') {
        currentWorld = gameDataSource.myths[selectedEra as keyof typeof gameDataSource.myths];
    } else {
        currentWorld = (gameDataSource as any)[universe];
    }
    
    const worldForContext = JSON.parse(JSON.stringify(currentWorld));

    const calendarTemplate = worldForContext.calendar || gameData.fantasy.calendar;
    const localizedCalendar = JSON.parse(JSON.stringify(calendarTemplate));
    localizedCalendar.months = localizedCalendar.months.map((month: Month) => ({ ...month, name: t(month.name), description: month.description ? t(month.description) : '' }));
    localizedCalendar.dayNames = localizedCalendar.dayNames.map((day: DayInfo) => ({ ...day, name: t(day.name), description: day.description ? t(day.description) : '' }));
    
    const gameStartingYear = parseInt(String(creationData.startingYear), 10);
    const gameStartingMonthName = creationData.startingMonth;
    const gameStartingDay = parseInt(String(creationData.startingDay), 10);
    const gameStartTime = creationData.startTime;

    // FIX: Update the calendar object with the user's chosen start settings
    localizedCalendar.startingYear = gameStartingYear;
    localizedCalendar.startingMonthName = gameStartingMonthName;
    localizedCalendar.startingDayOfMonth = gameStartingDay;
    localizedCalendar.startingTimeOfDay = gameStartTime;

    const gameSettings: GameSettings = {
        language: language,
        gameWorldInformation: {
            baseInfo: worldForContext,
            customInfo: worldInformation,
            currencyName: creationData.currencyName || currentWorld.currencyName || 'Gold',
            calendar: localizedCalendar
        },
        nonMagicMode: creationData.nonMagicMode,
        adultMode: creationData.adultMode,
        youtubeApiKey: creationData.youtubeApiKey,
        allowHistoryManipulation: creationData.allowHistoryManipulation,
        hardMode: creationData.hardMode,
        impossibleMode: creationData.impossibleMode,
        notificationSound: creationData.notificationSound,
        keepLatestNpcJournals: creationData.keepLatestNpcJournals,
        latestNpcJournalsCount: creationData.latestNpcJournalsCount,
        cooperativeGameType: creationData.cooperativeGameType,
        autoPassTurnInCoop: creationData.autoPassTurnInCoop,
        showPartyStatusPanel: creationData.showPartyStatusPanel,
        uiControlScale: creationData.uiControlScale ?? 1,
        uiFontScale: creationData.uiFontScale ?? 1,
        multiplePersonalitiesSettings: creationData.multiplePersonalitiesSettings,
        doNotUseWorldEvents: creationData.doNotUseWorldEvents,
        showImageSourceInfo: false,
        generateWorldEventImages: creationData.generateWorldEventImages ?? true,
        disableImageGeneration: creationData.disableImageGeneration ?? false,
    };

    const calendar = gameSettings.gameWorldInformation.calendar!;
    const startingMonthIndex = calendar.months.findIndex((m: Month) => m.name === gameStartingMonthName || m.name === t(gameStartingMonthName as any));
    
    const [startHour, startMinute] = gameStartTime.split(':').map(Number);
    const startingMinutesIntoDay = startHour * 60 + startMinute;
    
    const totalMinutes = calculateTotalMinutes({
        year: gameStartingYear,
        monthIndex: startingMonthIndex > -1 ? startingMonthIndex : 0,
        day: gameStartingDay
    }, calendar) + startingMinutesIntoDay;
    
    const initialWorldState: WorldState = {
        day: 1,
        weather: creationData.weather === 'Random' ? 'Clear' : creationData.weather,
        currentTimeInMinutes: totalMinutes,
        campaignStartTimeInMinutes: totalMinutes,
        lastWorldProgressionTimeInMinutes: totalMinutes,
        lastFactionProgressionTimeInMinutes: totalMinutes,
        date: calculateDate(totalMinutes, calendar),
    };
    
    const playerCharacter = createNewPlayerCharacter(characterCreationData, gameSettings, {
        partyLevel: 1,
        shareCharacteristics: gameSettings.multiplePersonalitiesSettings?.shareCharacteristics ?? false,
        templatePlayer: null
    });
    
    const startingLocation: Location = {
        locationId: generateId('loc'),
        initialId: 'start-loc-01',
        name: 'A New Beginning',
        coordinates: { x: 0, y: 0 },
        locationType: 'outdoor',
        biome: 'Plains',
        internalDifficultyProfile: { combat: 0, environment: 0, social: 0, exploration: 0 },
        externalDifficultyProfile: { combat: 0, environment: 0, social: 0, exploration: 0 },
        description: 'An undescribed location where the adventure begins. FOR AI - this is just a placeholder. Please create completely new location as starting location. This location is just for the example',
        image_prompt: 'A misty valley at dawn, a single path leading into the unknown, fantasy landscape.',
    } as Location;

    const context: GameContext = {
        message: initialPrompt,
        image: null,
        superInstructions: superInstructions,
        currentTurnNumber: 1,
        gameSettings,
        playerCharacter,
        players: [playerCharacter],
        currentLocation: startingLocation,
        visitedLocations: [],
        activeQuests: [],
        completedQuests: [],
        encounteredNPCs: [],
        npcSkillMasteryData: [],
        // FIX: Cannot find name 'response'. Pass an empty array as multipliers are not available at creation time.
        lootForCurrentTurn: generateLootTemplates([], playerCharacter, 5),
        preGeneratedDices1d20: generateSecureRandomD20Array(50),
        worldState: initialWorldState,
        worldStateFlags: [],
        previousTurnResponse: null,
        encounteredFactions: [],
        plotOutline: null,
        worldMap: {},
        responseHistory: [],
        currentStepFocus: null,
        partiallyGeneratedResponse: null,
        enemiesDataForCurrentTurn: [],
        alliesDataForCurrentTurn: [],
        playerCustomStates: [],
        worldEventsLog: [],
        networkRole: 'none',
        peers: [],
        isConnectedToHost: true
    };
    return context;
}
