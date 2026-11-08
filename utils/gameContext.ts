// @ts-ignore -- shared JS helpers
import { critChanceBuffFromLuck, criticalHitThreshold, maxCarryWeight, maxEnergyPercent, maxHealthPercent } from './derivedStats.js';
import { isEncumbered } from './carryWeight.js';
import { coordinateKey, matchingLinkIndexes, isAmbiguousCoordinateLink } from './locationLinks.js';
import { withLiveActivePlayer } from './partyView';
import { GameState, GameResponse, PlayerCharacter, Location, Language, Item, GameSettings, WorldState, NPC, WorldData, CharacterCreationData, Effect, QuestUpdate, PassiveSkill, LocationStorage, ActiveThreat, Calendar, Month, DayInfo, GameContext, ChatMessage, Characteristics, ItemResourceChange, NPCInventoryResourceChange } from '../types';
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

/**
 * Update payloads carry their patch fields next to `new*` rename hints. Copy everything that is
 * not such a hint into the patch object, exactly as the old dynamic loop did, but without
 * escaping the type system at the call site.
 */
const copyPassthroughFields = <T extends object>(target: Partial<T>, source: object, skip: (key: string) => boolean): void => {
    Object.entries(source).forEach(([key, value]) => {
        if (skip(key)) return;
        Object.assign(target, { [key]: value });
    });
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
        newPc.characteristics = {} as Characteristics;
    }

    const permanentlyModifiedValues: Record<string, number> = {};

    CHARACTERISTICS_LIST.forEach(char => {
        const charCapitalized = char.charAt(0).toUpperCase() + char.slice(1);
        const standardKey = `standard${charCapitalized}` as keyof PlayerCharacter['characteristics'];
        const standardValue: number | undefined = newPc.characteristics[standardKey];
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

    newPc.maxHealth = maxHealthPercent(pmCon, pmStr);
    newPc.maxEnergy = maxEnergyPercent(pmCon, pmInt, pmWis, pmFth);
    newPc.maxWeight = maxCarryWeight(pmStr, pmCon);
    newPc.critChanceBuffFromLuck = critChanceBuffFromLuck(pmLck);
    newPc.critChanceThreshold = criticalHitThreshold(pmLck);

    if (newPc.currentHealth === undefined) newPc.currentHealth = newPc.maxHealth;
    if (newPc.currentEnergy === undefined) newPc.currentEnergy = newPc.maxEnergy;

    newPc.currentHealth = Math.min(newPc.currentHealth, newPc.maxHealth);
    newPc.currentEnergy = Math.min(newPc.currentEnergy, newPc.maxEnergy);

    // The threshold moved here, so a load that used to fit may not fit any more. The weight pass
    // sets the same flag: either of the two can be the last one to run, and both read fresh values.
    newPc.isOverloaded = isEncumbered(newPc.maxWeight, newPc.totalWeight);

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
        newPc.characteristics[modifiedKey] = modifiedValue;
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

// Assign IDs to legacy activities before they are sent to the GM. This mutates
// only the in-memory save/context and does not write the user's save by itself.
export function ensureThreatActivityIds(map: Record<string, Location>, currentLocation?: Location | null): void {
    for (const loc of Object.values(map || {})) {
        for (const threat of loc?.activeThreats || []) {
            if (threat.currentActivity && !threat.currentActivity.activityId) threat.currentActivity.activityId = generateId('threat-activity');
        }
    }
    if (currentLocation?.locationId && map?.[currentLocation.locationId]) {
        const saved = map[currentLocation.locationId];
        for (const threat of currentLocation.activeThreats || []) {
            const match = saved.activeThreats?.find(t => t.threatId && t.threatId === threat.threatId);
            if (threat.currentActivity && !threat.currentActivity.activityId) {
                threat.currentActivity.activityId = match?.currentActivity?.activityId || generateId('threat-activity');
            }
        }
    } else if (currentLocation) {
        for (const threat of currentLocation.activeThreats || []) {
            if (threat.currentActivity && !threat.currentActivity.activityId) threat.currentActivity.activityId = generateId('threat-activity');
        }
    }
}

export type WorldMapWarning = {
    kind: 'link-create' | 'link-update' | 'link-remove' | 'threat-completion' | 'threat-replacement' | 'threat-update' | 'threat-identity';
    subject: string;
};

export function updateWorldMap(
    currentMap: Record<string, Location>,
    updates: GameResponse['worldMapUpdates'],
    currentLocation: Location,
    currentTurnNumber: number,
    onWarning?: (warning: WorldMapWarning) => void
): Record<string, Location> {
    const newMap: Record<string, Location> = JSON.parse(JSON.stringify(currentMap));

    if (currentLocation.locationId) {
        newMap[currentLocation.locationId] = deepMergeResponses(newMap[currentLocation.locationId], currentLocation);
    }

    ensureThreatActivityIds(newMap);
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
        const newLocationId = newLoc.locationId || generateId('loc');
        newLoc.locationId = newLocationId;

        if (newLoc.initialId) {
            initialIdToLocationIdMap.set(newLoc.initialId, newLocationId);
        }
        // A location may represent another vertical level at the same x/y.
        // Preserve distinct IDs; coordinates alone cannot identify an entity.
        if (newMap[newLocationId]) return;
        if (existingCoords.has(coordKey)) {
            console.warn(`Multiple locations share coordinates ${coordKey}; coordinate-only navigation may be ambiguous.`);
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

    const embeddedThreatUpdates: Array<{ targetLocationId: string; threatUpdate: Partial<ActiveThreat> }> = [];
    asArray(updates.locationUpdates).forEach(update => {
        if (update.locationId && newMap[update.locationId]) {
            const originalLocation = newMap[update.locationId];

            const { newLastEventsDescription, ...restOfUpdate } = update;
    
            const cleanUpdate: Partial<Location> = {};
            if (restOfUpdate.newName) cleanUpdate.name = restOfUpdate.newName;
            if (restOfUpdate.newDescription) cleanUpdate.description = restOfUpdate.newDescription;
            if (restOfUpdate.newInternalDifficultyProfile) cleanUpdate.internalDifficultyProfile = deepMergeResponses(originalLocation.internalDifficultyProfile, restOfUpdate.newInternalDifficultyProfile);
            if (restOfUpdate.newExternalDifficultyProfile) cleanUpdate.externalDifficultyProfile = deepMergeResponses(originalLocation.externalDifficultyProfile, restOfUpdate.newExternalDifficultyProfile);
            
            copyPassthroughFields<Location>(cleanUpdate, restOfUpdate, key => key.startsWith('new') || key === 'locationId');
            
            // Route updates to existing activities through the same identity and
            // completion checks as explicit threatsToUpdate commands.
            if (Array.isArray(cleanUpdate.activeThreats)) {
                cleanUpdate.activeThreats = cleanUpdate.activeThreats.flatMap(threat => {
                    if (!threat) return [];
                    const existingThreats = originalLocation.activeThreats || [];
                    const matches = existingThreats.filter(existing =>
                        threat.threatId ? existing.threatId === threat.threatId : threat.name && existing.name === threat.name);
                    const nameCollision = threat.name && existingThreats.some(existing => existing.name === threat.name);
                    if (matches.length > 1 || (matches.length === 0 && nameCollision)) {
                        onWarning?.({ kind: 'threat-identity', subject: threat.threatId || threat.name || '?' });
                        return [];
                    }
                    if (matches.length !== 1 || !Object.prototype.hasOwnProperty.call(threat, 'currentActivity')) return [threat];
                    const { currentActivity, ...otherFields } = threat;
                    if (currentActivity) embeddedThreatUpdates.push({ targetLocationId: update.locationId, threatUpdate: { threatId: matches[0].threatId, name: matches[0].name, currentActivity } });
                    return [otherFields as ActiveThreat];
                });
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
            // Only new embedded threats still lack an ID after merging. Assign
            // one now, after name-only updates have had a chance to match.
            for (const threat of mergedLocation.activeThreats || []) {
                if (threat && !threat.threatId) threat.threatId = generateId('threat');
            }

            if (newLastEventsDescription && typeof newLastEventsDescription === 'string') {
                if (!Array.isArray(mergedLocation.eventDescriptions)) {
                    mergedLocation.eventDescriptions = [];
                }
                mergedLocation.eventDescriptions.unshift(newLastEventsDescription);
            }
    
            newMap[update.locationId] = mergedLocation;
        }
    });

    const locations = Object.values(newMap);
    asArray(updates.newLinks).forEach(linkUpdate => {
        const source = newMap[linkUpdate.sourceLocationId];
        let link = linkUpdate.link;
        if (!source || !link || isAmbiguousCoordinateLink(link, locations)) {
            console.warn('Skipping ambiguous or invalid new location link.');
            onWarning?.({ kind: 'link-create', subject: linkUpdate.sourceLocationId || '?' });
            return;
        }
        if (link.targetLocationId && !newMap[link.targetLocationId]) {
            console.warn(`Skipping link to unknown location ${link.targetLocationId}.`);
            onWarning?.({ kind: 'link-create', subject: linkUpdate.sourceLocationId || '?' });
            return;
        }
        if (link.targetLocationId) {
            const targetCoordinates = newMap[link.targetLocationId].coordinates;
            const targetKey = coordinateKey(targetCoordinates);
            const suppliedKey = coordinateKey(link.targetCoordinates);
            if (!targetKey || (link.targetCoordinates != null && suppliedKey !== targetKey)) {
                console.warn('Skipping link with invalid or conflicting destination coordinates.');
                onWarning?.({ kind: 'link-create', subject: linkUpdate.sourceLocationId || '?' });
                return;
            }
            link = { ...link, targetCoordinates: { ...targetCoordinates } };
        }
        source.adjacencyMap ||= [];
        if (matchingLinkIndexes(source.adjacencyMap, link, locations).length === 0) source.adjacencyMap.push(link);
    });

    asArray(updates.linkUpdates).forEach(update => {
        const source = newMap[update.sourceLocationId];
        const matches = source?.adjacencyMap ? matchingLinkIndexes(source.adjacencyMap, update, locations) : [];
        if (matches.length !== 1) { console.warn('Skipping ambiguous or unknown location link update.'); onWarning?.({ kind: 'link-update', subject: update.sourceLocationId || '?' }); return; }
        const merged = deepMergeResponses(source.adjacencyMap[matches[0]], update.updatedLink);
        const target = merged.targetLocationId && newMap[merged.targetLocationId];
        if (target && merged.targetCoordinates == null && coordinateKey(target.coordinates)) merged.targetCoordinates = { ...target.coordinates };
        if (!coordinateKey(merged.targetCoordinates) || (merged.targetLocationId && (!target || coordinateKey(merged.targetCoordinates) !== coordinateKey(target.coordinates)))) {
            console.warn('Skipping link update with invalid or conflicting destination coordinates.');
            onWarning?.({ kind: 'link-update', subject: update.sourceLocationId || '?' });
            return;
        }
        source.adjacencyMap[matches[0]] = merged;
    });

    asArray(updates.linksToRemove).forEach(removal => {
        const source = newMap[removal.sourceLocationId];
        const matches = source?.adjacencyMap ? matchingLinkIndexes(source.adjacencyMap, removal, locations) : [];
        if (matches.length !== 1) { console.warn('Skipping ambiguous or unknown location link removal.'); onWarning?.({ kind: 'link-remove', subject: removal.sourceLocationId || '?' }); return; }
        source.adjacencyMap.splice(matches[0], 1);
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

                    copyPassthroughFields<LocationStorage>(cleanUpdate, updatePayload, key => key.startsWith('new'));
                    
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
            if (!targetLocationId && add.initialTargetLocationId) {
                const foundId = initialIdToLocationIdMap.get(add.initialTargetLocationId);
                if (foundId) targetLocationId = foundId;
                else console.warn(`Could not find a new location with initialId: ${add.initialTargetLocationId} for a new threat.`);
            }
            if (targetLocationId && newMap[targetLocationId]) {
                if (!newMap[targetLocationId].activeThreats) newMap[targetLocationId].activeThreats = [];
                const newThreat = { ...add.threat, threatId: add.threat.threatId || generateId('threat'), currentActivity: add.threat.currentActivity ? { ...add.threat.currentActivity, activityId: generateId('threat-activity') } : null };
                newMap[targetLocationId].activeThreats!.push(newThreat);
            } else if(targetLocationId) {
                console.warn(`Attempted to add a threat to a non-existent location ID: ${targetLocationId}`);
            }
        });
    }

    // Apply progress to the existing activity first, complete it next, and only
    // then install a replacement. A stale completion must never replace the task.
    const deferredThreatUpdates: Array<{ targetLocationId: string; threatId: string; threatUpdate: Partial<ActiveThreat>; previousId: string }> = [];
    if (threatsToUpdate || embeddedThreatUpdates.length) {
        [...embeddedThreatUpdates, ...asArray(threatsToUpdate)].forEach(update => {
            const location = newMap[update.targetLocationId];
            if (!location?.activeThreats || !update.threatUpdate) return;
            const matches = location.activeThreats.map((threat, index) =>
                (update.threatUpdate.threatId ? threat.threatId === update.threatUpdate.threatId :
                    update.threatUpdate.name && threat.name === update.threatUpdate.name) ? index : -1).filter(index => index >= 0);
            if (matches.length !== 1) {
                onWarning?.({ kind: 'threat-identity', subject: update.threatUpdate.threatId || update.threatUpdate.name || '?' });
                return;
            }
            const threatIndex = matches[0];
            const existing = location.activeThreats[threatIndex];
            if (!existing.threatId) existing.threatId = generateId('threat');
            const incoming = update.threatUpdate.currentActivity;
            const payload = { ...update.threatUpdate };
            const previous = existing.currentActivity;
            if (incoming && previous && incoming.activityId && incoming.activityId !== previous.activityId) {
                // An explicit identity must never be rewritten to target a different task.
                delete payload.currentActivity;
                onWarning?.({ kind: 'threat-update', subject: existing.threatId! });
            } else if (incoming && previous && incoming.activityName && incoming.activityName !== previous.activityName) {
                deferredThreatUpdates.push({ targetLocationId: update.targetLocationId, threatId: existing.threatId!, threatUpdate: { currentActivity: incoming }, previousId: previous.activityId! });
                delete payload.currentActivity;
            } else if (incoming && previous) {
                payload.currentActivity = { ...incoming, activityId: previous.activityId };
            } else if (incoming?.activityId) {
                // An identified task is an update, not a request to start a new one.
                delete payload.currentActivity;
                onWarning?.({ kind: 'threat-update', subject: existing.threatId! });
            } else if (incoming) {
                payload.currentActivity = { ...incoming, activityId: generateId('threat-activity') };
            }
            location.activeThreats[threatIndex] = deepMergeResponses(existing, payload) as ActiveThreat;
        });
    }

    if (completeThreatActivities) {
        asArray(completeThreatActivities).forEach(completion => {
            const location = newMap[completion.targetLocationId];
            if (location && location.activeThreats) {
                const threatIndex = location.activeThreats.findIndex(t => t.threatId === completion.threatId);
                if (threatIndex > -1) {
                    const threat = location.activeThreats[threatIndex];
                    // Completion refers to an active task, not to the threat itself.
                    // A duplicate command for an idle threat must not create history.
                    if (!threat.currentActivity || !completion.activityId || completion.activityId !== threat.currentActivity.activityId) {
                        console.warn('Skipping threat activity completion: no active activity or missing/mismatched activityId.');
                        onWarning?.({ kind: 'threat-completion', subject: completion.threatId || '?' });
                        return;
                    }
                    if (!threat.completedActivities) threat.completedActivities = [];
                    threat.completedActivities.unshift({
                        activityId: threat.currentActivity.activityId,
                        activityName: threat.currentActivity.activityName,
                        finalState: completion.finalState,
                        narrativeSummary: completion.narrativeSummary,
                        completionTurn: currentTurnNumber,
                    });
                    threat.currentActivity = null;
                } else {
                    console.warn(`Could not find threat with id ${completion.threatId} in location ${completion.targetLocationId} to complete its activity.`);
                    onWarning?.({ kind: 'threat-completion', subject: completion.threatId || '?' });
                }
            } else {
                onWarning?.({ kind: 'threat-completion', subject: completion.threatId || '?' });
            }
        });
    }

    for (const deferred of deferredThreatUpdates) {
        const threat = newMap[deferred.targetLocationId]?.activeThreats?.find(t => t.threatId === deferred.threatId);
        const completed = threat?.completedActivities?.some(a => a.activityId === deferred.previousId && a.completionTurn === currentTurnNumber);
        if (!threat || threat.currentActivity || !completed) {
            console.warn('Skipping replacement of an unfinished threat activity.');
            onWarning?.({ kind: 'threat-replacement', subject: deferred.threatId });
            continue;
        }
        threat.currentActivity = { ...deferred.threatUpdate.currentActivity!, activityId: generateId('threat-activity') };
    }

    if (threatsToRemove) {
        asArray(threatsToRemove).forEach(remove => {
            if (remove.targetLocationId && newMap[remove.targetLocationId] && newMap[remove.targetLocationId].activeThreats) {
                newMap[remove.targetLocationId].activeThreats = newMap[remove.targetLocationId].activeThreats!.filter(t => t.threatId !== remove.threatId);
            }
        });
    }

    ensureThreatActivityIds(newMap);
    return newMap;
}


export function buildNextContext(
    currentContext: GameContext,
    response: GameResponse,
    newState: GameState,
    newHistory: ChatMessage[],
    advanceTurn: boolean = true,
    onWorldMapWarning?: (warning: WorldMapWarning) => void
): GameContext {
    // ... (Same as previous patches for resource consistency) ...
    if (response.inventoryItemsResources) {
        const resourceChangesForNewItems = asArray(response.inventoryItemsResources).filter(rc => rc.existedId === null && rc.name);
        if (resourceChangesForNewItems.length > 0) {
            // Every resource change may fill one newly created item; a consumed change must not be
            // reused for a second item with the same name.
            const usedResourceChanges = new Set<ItemResourceChange>();
            const processInventory = (inventory: Item[]) => {
                if (!inventory) return;
                inventory.forEach(item => {
                    if (item.resource !== undefined) return;
                    const resourceInfo = resourceChangesForNewItems.find(rc => rc.name === item.name && !usedResourceChanges.has(rc));
                    if (!resourceInfo) return;
                    item.resource = resourceInfo.resource;
                    item.maximumResource = resourceInfo.maximumResource;
                    item.resourceType = resourceInfo.resourceType;
                    usedResourceChanges.add(resourceInfo);
                });
            };
            newState.players.forEach(player => processInventory(player.inventory));
            newState.encounteredNPCs.forEach(npc => processInventory(npc.inventory));
        }
    }
    
    if (response.NPCInventoryResourcesChanges) {
        const resourceChangesForNewNpcItems = asArray(response.NPCInventoryResourcesChanges).filter(rc => (rc.itemId === null || rc.itemId === undefined) && rc.itemName);
        if (resourceChangesForNewNpcItems.length > 0) {
            const usedResourceChanges = new Set<NPCInventoryResourceChange>();
            const patchedItems = new Set<Item>();
            resourceChangesForNewNpcItems.forEach(resourceChange => {
                if (usedResourceChanges.has(resourceChange)) return;

                const npc = newState.encounteredNPCs.find(n => (n.NPCId && n.NPCId === resourceChange.NPCId) || n.name === resourceChange.NPCName);
                if (!npc?.inventory) return;

                const item = npc.inventory.find(candidate =>
                    candidate.name === resourceChange.itemName &&
                    candidate.resource === undefined &&
                    !patchedItems.has(candidate)
                );
                if (!item) return;

                const resourceValue = resourceChange.newResourceValue ?? resourceChange.resource;
                if (resourceValue === undefined) return;

                item.resource = resourceValue;
                item.maximumResource = resourceChange.maximumResource ?? resourceValue;
                if (resourceChange.resourceType !== undefined) {
                    item.resourceType = resourceChange.resourceType;
                }
                patchedItems.add(item);
                usedResourceChanges.add(resourceChange);
            });
        }
    }


    let newTurnNumber = currentContext.currentTurnNumber;
    let newActivePlayerIndex = newState.activePlayerIndex;

    if (advanceTurn) {
        const isManualPass = currentContext.message === '[System Action] Pass turn';
        const isAutoPass = currentContext.gameSettings.autoPassTurn ?? true;
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

    const newWorldMap = updateWorldMap(baseMap, response.worldMapUpdates, newState.currentLocationData as Location, currentContext.currentTurnNumber, onWorldMapWarning);
    
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
        players: withLiveActivePlayer(newState.players, newState.playerCharacter),
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
        // Pass the new thought signature to the next context to maintain reasoning continuity
        previousThoughtSignature: response.thoughtSignature
    };

  return nextContext;
}

export const createInitialContext = (creationData: CharacterCreationData, language: Language): GameContext => {
    const { universe, selectedEra, worldInformation, superInstructions, initialPrompt, ...characterCreationData } = creationData;
    const t = (key: string, replacements?: Record<string, string | number>) => translate(language, key, replacements);

    const gameDataSource = creationData.customGameData || gameData;
    const gameDataType = gameDataSource as typeof gameData & { custom?: Record<string, WorldData | undefined> };
    let currentWorld: WorldData;
    
    if (universe === 'custom') {
        currentWorld = (gameDataType.custom && gameDataType.custom[selectedEra ?? '']) || {
            name: selectedEra || t('New Universe'), description: t('Create your own world from scratch...'), races: {}, classes: {}, currencyName: 'Gold', currencyOptions: ['Gold'],
            calendar: JSON.parse(JSON.stringify(gameData.fantasy.calendar))
        };
    } else if (universe === 'history') {
        currentWorld = gameDataType.history[selectedEra as keyof typeof gameDataType.history];
    } else if (universe === 'myths') {
        currentWorld = gameDataType.myths[selectedEra as keyof typeof gameDataType.myths];
    } else {
        currentWorld = (gameDataType as unknown as Record<string, WorldData>)[universe];
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
            calendar: localizedCalendar,
            universe
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
        autoPassTurn: creationData.autoPassTurn ?? true,
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
    const startingMonthIndex = calendar.months.findIndex((m: Month) => m.name === gameStartingMonthName || m.name === t(gameStartingMonthName));
    
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
    };
    return context;
}
