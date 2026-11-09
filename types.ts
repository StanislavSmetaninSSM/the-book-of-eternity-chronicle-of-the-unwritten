



// FIX: Defined and exported all missing types required by the application.
export interface Month {
  name: string;
  days: number;
  description?: string;
}

export interface DayInfo {
    name: string;
    description?: string;
}

export interface Calendar {
  startingYear: number;
  startingMonthName: string;
  startingDayOfMonth: number;
  startingTimeOfDay: string;
  months: Month[];
  daysInWeek: number;
  dayNames: DayInfo[];
}

/**
 * In memory `src` is always a `data:` URL. Stored saves keep a `blob:<sha256>` reference
 * instead and read the bytes back from the image store on load (see `utils/imageBlobStore`).
 */
export type ImageCacheEntry = {
  src: string;
  sourceProvider: 'Nano Banana' | 'Imagen' | 'Arena GM' | 'Custom Upload';
  sourceModel?: string;
};

/** A world as the creation form, the customiser and the prompt builder see it. */
/** One race of a universe's preset pack, as the customizer edits it. */
export interface RaceDefinition {
    description: string;
    bonuses: Record<string, number>;
    availableClasses?: string[];
}

/** One class of a universe's preset pack, as the customizer edits it. */
export interface ClassDefinition {
    description: string;
    bonuses: Record<string, number>;
}

export interface WorldData {
    name: string;
    description: string;
    /** Some shipped worlds leave the currency to the default, so it is optional. */
    currencyName?: string;
    currencyOptions?: string[];
    races: Record<string, RaceDefinition>;
    classes: Record<string, ClassDefinition>;
    calendar?: Calendar;
}

/** The world a chronicle runs in, recorded in the game settings. */
export interface WorldBaseInfo extends WorldData {
    universe?: string;
    selectedEra?: string | null;
}

/** A state an item reacts to, e.g. "increases damage against Burning targets". */
export interface ItemCustomProperty {
    interactionType?: string;
    targetStateName?: string;
    changeValue?: number;
}

/** A material an item breaks down into; the model may prefill its item stats. */
export interface DisassemblyMaterial extends Partial<Item> {
    materialName: string;
    quantity: number;
}

/** A combat resistance of a combatant. */
export interface CombatResistance {
    resistanceName?: string;
    resistanceValue?: string;
    resistType?: string;
    resistTypeDisplayName?: string;
}

/** How strongly a faction holds a location. */
export interface FactionControlEntry {
    factionId?: string;
    factionName?: string;
    controlType?: 'Military' | 'Economic' | 'Social' | 'Covert';
    controlLevel: number;
}

/** A player's standing with one NPC or faction. */
export interface NpcReputationEntry {
    NPCId?: string;
    relationshipLevel?: number;
    isCompanion?: boolean;
}

export interface FactionReputationEntry {
    factionId?: string;
    reputation?: number;
    playerRank?: string | null;
    isMember?: boolean;
}

/** The short status of the player that the narrating model reports each turn. */
export interface PlayerStatus {
    healthPercentage?: string;
    energyPercentage?: string;
    activeConditions?: string[];
}

/** What a multi-personality party shares between its members. */
export interface MultiplePersonalitiesSettings {
  shareCharacteristics: boolean;
  shareSkills: boolean;
  shareNpcReputation: boolean;
  shareFactionReputation: boolean;
  shareInventory: boolean;
}

export interface GameSettings {
  nonMagicMode: boolean;
  language: Language;
  gameWorldInformation: {
    currencyName: string;
    baseInfo: WorldBaseInfo;
    customInfo: string;
    calendar?: Calendar;
    /** Universe id; absent in saves written before translations became lazy. */
    universe?: string;
  };
  adultMode: boolean;
  // FIX: Added missing youtubeApiKey property to GameSettings interface.
  youtubeApiKey?: string;
  allowHistoryManipulation: boolean;
  hardMode: boolean;
  impossibleMode: boolean;
  notificationSound: boolean;
  keepLatestNpcJournals: boolean;
  latestNpcJournalsCount: number;
  cooperativeGameType: 'None' | 'MultiplePersonalities' | 'FullParty';
  /** Hand the turn to the next party member automatically. */
  autoPassTurn: boolean;
  showPartyStatusPanel?: boolean;
  uiControlScale?: number;
  uiFontScale?: number;
  multiplePersonalitiesSettings?: MultiplePersonalitiesSettings;
  doNotUseWorldEvents: boolean;
  showImageSourceInfo?: boolean;
  generateWorldEventImages?: boolean;
  disableImageGeneration?: boolean;
}

/**
 * What the start screen hands to the game: the universe choice, the toggles and
 * the new character. Every field is optional because a universe contributes only
 * the choices it has — a custom universe has no era, and a quick start no class.
 */
export interface CharacterCreationData {
  universe?: string;
  selectedEra?: string;
  worldInformation?: string;
  superInstructions?: string;
  initialPrompt?: string;
  customGameData?: unknown;
  playerName?: string;
  characterDescription?: string;
  age?: number;
  race?: string;
  charClass?: string;
  isCustomRace?: boolean;
  customRaceName?: string;
  customRaceDescription?: string;
  customAttributes?: Record<string, number>;
  isCustomClass?: boolean;
  customClassName?: string;
  customClassDescription?: string;
  customClassAttributes?: Record<string, number>;
  startingYear?: number;
  startingMonth?: string;
  startingDay?: number;
  startTime?: string;
  weather?: string;
  currencyName?: string;
  nonMagicMode?: boolean;
  adultMode?: boolean;
  youtubeApiKey?: string;
  allowHistoryManipulation?: boolean;
  hardMode?: boolean;
  impossibleMode?: boolean;
  notificationSound?: boolean;
  keepLatestNpcJournals?: boolean;
  latestNpcJournalsCount?: number;
  cooperativeGameType?: GameSettings['cooperativeGameType'];
  autoPassTurn?: boolean;
  showPartyStatusPanel?: boolean;
  uiControlScale?: number;
  uiFontScale?: number;
  multiplePersonalitiesSettings?: MultiplePersonalitiesSettings;
  doNotUseWorldEvents?: boolean;
  generateWorldEventImages?: boolean;
  disableImageGeneration?: boolean;
  [key: string]: unknown;
}

export interface WorldState {
  day: number;
  weather: string;
  currentTimeInMinutes: number;
  campaignStartTimeInMinutes?: number;
  lastWorldProgressionTimeInMinutes: number;
  lastFactionProgressionTimeInMinutes?: number;
  date?: {
    currentYear: number;
    currentMonthName: string;
    dayOfMonth: number;
    dayOfWeekName: string;
    timeOfDay: string; // "HH:MM"
  };
}

export interface ChatMessage {
  sender: 'player' | 'gm' | 'system';
  content: string;
}

export interface Characteristics {
  standardStrength: number;
  modifiedStrength: number;
  standardDexterity: number;
  modifiedDexterity: number;
  standardConstitution: number;
  modifiedConstitution: number;
  standardIntelligence: number;
  modifiedIntelligence: number;
  standardWisdom: number;
  modifiedWisdom: number;
  standardFaith: number;
  modifiedFaith: number;
  standardAttractiveness: number;
  modifiedAttractiveness: number;
  standardTrade: number;
  modifiedTrade: number;
  standardPersuasion: number;
  modifiedPersuasion: number;
  standardPerception: number;
  modifiedPerception: number;
  standardLuck: number;
  modifiedLuck: number;
  standardSpeed: number;
  modifiedSpeed: number;
}

export interface StealthState {
  isActive: boolean;
  detectionLevel: number;
  description: string;
}

export interface EffortTracker {
  lastUsedCharacteristic: string | null;
  consecutivePartialSuccesses: number;
}

export interface StructuredBonus {
    bonusId?: string;
    description: string;
    bonusType: 'Characteristic' | 'ActionCheck' | 'Utility' | 'Other' | 'PowerProfileScale' | 'Resource' | 'CustomStatePower';
    target: string;
    valueType: 'Flat' | 'Percentage' | 'String' | 'Boolean' | 'Reference';
    /** Number for flat/percentage bonuses, the referenced name for references, a flag otherwise. */
    value: string | number | boolean;
    application: 'Permanent' | 'Conditional';
    condition: string | null;
}

export interface Item {
    existedId: string | null;
    initialId?: string;
    name: string;
    description: string;
    image_prompt?: string;
    custom_image_prompt?: string | null;
    pending_image_prompt?: string | null;
    quality: string;
    type: string;
    group?: string;
    price: number;
    count: number;
    weight: number;
    volume: number;
    textContent?: (string | null)[];
    bonuses: string[];
    structuredBonuses?: StructuredBonus[];
    customProperties?: ItemCustomProperty[];
    contentsPath: string[] | null;
    isContainer: boolean;
    capacity: number | null;
    isConsumption: boolean;
    containerWeight?: number | null;
    weightReduction?: number | null;
    durability: string;
    combatEffect?: CombatAction[];
    equipmentSlot: string | string[] | null;
    requiresTwoHands?: boolean;
    disassembleTo?: DisassemblyMaterial[];
    fateCards?: FateCard[];
    ownerBondLevelCurrent?: number;
    resource?: number;
    maximumResource?: number;
    resourceType?: string;
    tags?: string[];
    isSentient?: boolean;
    journalEntries?: (string | null)[];
}

export interface ActiveSkill {
    skillName: string;
    skillDescription: string;
    rarity: string;
    combatEffect?: CombatAction;
    scalingCharacteristic: string | null;
    scalesValue?: boolean;
    scalesDuration?: boolean;
    scalesChance?: boolean;
    energyCost?: string | number;
    cooldownTurns?: number;
    tags?: string[];
}

export interface PassiveSkill {
    skillName: string;
    skillDescription: string;
    rarity: string;
    type: string;
    group: string;
    combatEffect?: CombatAction;
    playerStatBonus?: string | null;
    structuredBonuses?: StructuredBonus[];
    effectDetails?: string;
    masteryLevel: number;
    maxMasteryLevel: number;
    knowledgeDomain?: string;
    unlockedActiveSkillsCount?: number;
    maxUnlockableActiveSkills?: number;
    tags?: string[];
}

export interface SkillMastery {
    skillName: string;
    currentMasteryLevel: number;
    currentMasteryProgress: number;
    masteryProgressNeeded: number;
}

export interface SkillMasteryChange {
    skillName: string;
    newMasteryLevel?: number;
    newCurrentMasteryProgress?: number;
    newMasteryProgressNeeded?: number;
    masteryLeveledUp?: boolean;
}

export interface Recipe {
    recipeName: string;
    craftedItemName: string;
    description: string;
    requiredKnowledgeSkill?: {
        skillName: string;
        requiredMasteryLevel: number;
    };
    requiredMaterials: {
        materialName: string;
        quantity: number;
    }[];
    requiredTools: string[];
    outputQuantity: number;
}

export interface Effect {
    effectId?: string;
    effectType: string;
    value: string;
    targetType: string;
    duration: number;
    sourceSkill?: string;
    sourceWoundId?: string;
    description: string;
}

export interface NPCWoundChange extends Partial<Wound> {
    NPCId: string;
    NPCName: string;
    /** Older guide versions grouped the wounds of one NPC under the NPC entry. */
    wounds?: Partial<Wound>[];
}

export interface Wound {
    woundId: string;
    woundName: string;
    severity: string;
    descriptionOfEffects: string;
    generatedEffects: Effect[];
    healingState: {
        currentState: string;
        description: string;
        treatmentProgress: number;
        progressNeeded: number;
        nextState: string | null;
        canBeImprovedBy: string[];
    };
}

/** What crossing one custom-state threshold does: a trimmed effect or a plain description. */
export type CustomStateThresholdEffect = Partial<Effect> & Partial<StructuredBonus>;

/** One named level of a custom state, reached at a trigger value. */
export interface CustomStateThreshold {
    levelName: string;
    triggerCondition?: string;
    triggerValue?: number;
    description?: string;
    associatedEffects?: CustomStateThresholdEffect[];
}

/** One band of an NPC's relationship scale. */
export interface RelationshipTier {
    lowerBound: number;
    upperBound: number;
    name: string;
    desc: string;
}

export interface CustomState {
    stateId: string;
    stateName: string;
    currentValue: number;
    minValue: number;
    maxValue: number;
    description: string;
    progressionRule: {
        description: string;
    };
    thresholds: CustomStateThreshold[];
}

export interface PlayerCharacter {
    playerId: string;
    name: string;
    race: string;
    class: string;
    age: number;
    appearanceDescription: string;
    raceDescription: string;
    classDescription: string;
    portrait: string | null;
    image_prompt: string | null;
    pending_image_prompt?: string | null;
    level: number;
    levelOnPreviousTurn: number;
    experience: number;
    experienceForNextLevel: number;
    attributePoints: number;
    money: number;
    currentHealth: number;
    maxHealth: number;
    currentEnergy: number;
    maxEnergy: number;
    maxWeight: number;
    totalWeight: number;
    criticalExcessWeight: number;
    isOverloaded: boolean;
    critChanceBuffFromLuck: number;
    critChanceThreshold: number;
    characteristics: Characteristics;
    activeSkills: ActiveSkill[];
    passiveSkills: PassiveSkill[];
    activeSkillSortOrder?: string[];
    passiveSkillSortOrder?: string[];
    skillMasteryData: SkillMastery[];
    knownRecipes: Recipe[];
    inventory: Item[];
    itemSortOrder?: string[];
    itemSortCriteria?: 'manual' | 'name' | 'quality' | 'weight' | 'price' | 'type';
    itemSortDirection?: 'asc' | 'desc';
    equippedItems: Record<string, string | null>;
    activePlayerEffects: Effect[];
    playerWounds: Wound[];
    playerCustomStates: CustomState[];
    autoCombatSkill: string | null;
    stealthState: StealthState;
    effortTracker: EffortTracker;
    personalNpcReputations?: NpcReputationEntry[];
    personalFactionReputations?: FactionReputationEntry[];
    characterChronicle?: (string | null)[];
}

export interface LocationStorage {
    storageId: string;
    name: string;
    description: string;
    image_prompt?: string;
    capacity: number | null;
    volume: number | null;
    owner: {
      ownerType: 'Player' | 'Faction' | 'Shared';
      ownerId: string;
      ownerName: string;
    };
    authorizedUsers: {
      playerId: string;
      playerName: string;
    }[];
    contents: Item[];
    hasFullAccess: boolean;
}

export interface DifficultyProfile {
    combat: number;
    environment: number;
    social: number;
    exploration: number;
}

export interface ThreatActivity {
    activityName: string;
    description: string;
    totalTimeCostMinutes: number;
    timeSpentMinutes: number;
    currentStepNumber?: number;
    totalStepsInActivity?: number;
}

export interface ThreatImpactProfile {
    primaryTargetType: 'Faction' | 'Location' | 'Resource';
    primaryTargetId: string | null;
    primaryTargetName: string;
    primaryImpact: 'Military' | 'Economic' | 'Social' | 'Covert' | 'Stability' | 'Environment';
    baseImpactValue: number;
}

export interface ThreatArchetype {
    motivation: 'Domination' | 'Consumption' | 'Preservation' | 'Corruption' | 'Accumulation' | 'Execution' | 'Custom';
    method: 'Overt' | 'Covert' | 'Deceptive' | 'Opportunistic' | 'Systemic' | 'Custom';
    customMotivation: string | null;
    customMethod: string | null;
}

export interface CompletedThreatActivity {
    activityId?: string;
    activityName: string;
    finalState: 'Completed' | 'Abandoned';
    narrativeSummary: string;
    completionTurn: number;
}

export interface ActiveThreat {
    threatId: string | null;
    name: string;
    threatArchetype: ThreatArchetype;
    intensity: number;
    longTermGoal: string;
    currentActivity: CurrentActivity | null;
    impactProfile: ThreatImpactProfile;
    completedActivities?: CompletedThreatActivity[];
}

export interface LocationCoordinates {
    x: number;
    y: number;
    /** Vertical map layer; legacy coordinate-only data without z defaults to 0. ID-linked targets inherit stored coordinates. */
    z?: number;
}

export interface LocationData {
    locationId: string | null;
    initialId?: string;
    name: string;
    coordinates: LocationCoordinates;
    locationType: 'indoor' | 'outdoor';
    biome: string | null;
    indoorType?: string | null;
    internalDifficultyProfile: DifficultyProfile;
    externalDifficultyProfile: DifficultyProfile;
    description: string;
    eventDescriptions?: string[];
    image_prompt: string;
    custom_image_prompt?: string | null;
    pending_image_prompt?: string | null;
    adjacencyMap?: AdjacencyMapEntry[];
    factionControl?: FactionControlEntry[];
    locationStorages?: LocationStorage[];
    activeThreats?: ActiveThreat[];
}

export type Location = LocationData;

export interface Objective {
    objectiveId: string;
    description: string;
    status: 'Active' | 'Completed' | 'Failed';
}

// FIX: Added optional newDetailsLogEntry to Quest for quest update objects.
export interface Quest {
    questId: string;
    questName: string;
    questGiver: string;
    status: 'Active' | 'Completed' | 'Failed' | 'Updated';
    questBackground: string;
    description: string;
    objectives: Objective[];
    rewards?: {
        experience?: number;
        money?: number;
        items?: string[];
        other?: string;
    };
    failureConsequences?: string;
    detailsLog?: string[];
    newDetailsLogEntry?: string;
    initialId?: string; // For new quests referencing a lock
    source?: string;
}

// FIX: Defined QuestUpdate type for GameResponse.
export interface QuestUpdate extends Partial<Quest> {
  newDetailsLogEntry?: string;
}

// FIX: Defined PlotOutline and related types to resolve multiple 'Cannot find name' errors.
export interface PlotOutlineArc {
    summary: string;
    nextImmediateStep: string;
    potentialClimax: string;
}
  
export interface CharacterSubplot {
    characterName: string;
    arcSummary: string;
    nextStep: string;
    potentialConflictOrResolution: string;
}
  
export interface PlotOutline {
    mainArc: PlotOutlineArc;
    characterSubplots: CharacterSubplot[];
    loomingThreatsOrOpportunities: string[];
    lastUpdatedTurn: number;
}

export interface UnlockedMemory {
    memoryId: string;
    title: string;
    unlockedAtRelationshipLevel: number;
    content: string;
}

export interface FateCard {
    cardId: string;
    name: string;
    image_prompt: string;
    description: string;
    unlockConditions?: {
        requiredRelationshipLevel?: number;
        plotConditionDescription?: string;
        conjunction?: 'AND' | 'OR';
    };
    rewards?: {
        description: string;
    };
    isUnlocked: boolean;
}

// FIX: Added missing Activity types for NPCs.
export interface CurrentActivity {
    activityId?: string; // Stable identity for threat activities; legacy saves may omit it.
    activityName: string;
    description: string;
    totalTimeCostMinutes: number;
    timeSpentMinutes: number;
    currentStepNumber: number;
    totalStepsInActivity: number;
    linkedQuestId?: string;
    linkedPlotOutlineNode?: string;
    activeState?: 'Active' | 'Completed' | 'Abandoned';
}

export interface CompletedActivity {
    activityName: string;
    completionTurn: number;
    finalOutcome: 'Success' | 'SuccessWithComplication' | 'Failure';
    narrativeSummary: string;
}

export interface FactionAffiliation {
    factionId: string;
    factionName: string;
    rank: string | null;
    branch?: string | null;
    membershipStatus: 'Active' | 'Former' | 'Exiled' | 'Undercover' | 'Ally' | 'Enemy';
}

export interface NpcRelationship {
    targetNpcId: string | null;
    targetNpcName: string;
    relationshipStatus: 'Ally' | 'Friend' | 'Neutral' | 'Rival' | 'Enemy' | 'Subordinate' | 'Superior' | 'Family';
    statusReason: string;
}

export interface NpcGoals {
    longTerm: string;
    shortTerm: string;
}

export interface NpcRelationshipLock {
    isLocked: boolean;
    currentCap?: number;
    breakthroughQuestId: string | null;
}

// FIX: Updated NpcPersonalQuest to override rewards as string to match usage and prevent type errors.
export interface NpcPersonalQuest extends Omit<Quest, 'rewards'> {
    rewards?: string;
}

// FIX: Added missing properties to NPC interface.
export interface NPC {
    NPCId: string;
    name: string;
    currentLocationId?: string | null;
    initialLocationId?: string;
    image_prompt?: string;
    custom_image_prompt?: string | null;
    pending_image_prompt?: string | null;
    rarity?: string;
    age?: number;
    worldview?: string;
    personalityArchetype?: string;
    race: string;
    class: string;
    appearanceDescription: string;
    raceDescription: string;
    classDescription: string;
    history: string;
    level?: number;
    progressionType?: 'Companion' | 'PlotDriven' | 'Static';
    relationshipLevel: number;
    lastRelationshipChangeReason?: string;
    attitude: string;
    characteristics: Characteristics;
    passiveSkills: PassiveSkill[];
    activeSkills: ActiveSkill[];
    skillMasteryData?: SkillMastery[];
    inventory: Item[];
    itemSortOrder?: string[];
    itemSortCriteria?: 'manual' | 'name' | 'quality' | 'weight' | 'price' | 'type';
    itemSortDirection?: 'asc' | 'desc';
    equippedItems?: Record<string, string | null>;
    customStates?: CustomState[];
    fateCards?: FateCard[];
    factionAffiliations?: FactionAffiliation[];
    journalEntries?: string[];
    unlockedMemories?: UnlockedMemory[];
    wounds?: Wound[];
    activeEffects?: Effect[];
    maxWeight?: number;
    totalWeight?: number;
    isOverloaded?: boolean;
    criticalExcessWeight?: number;
    currentHealth: number;
    maxHealth: number;
    currentEnergy?: number;
    maxEnergy?: number;
    experience?: number;
    experienceForNextLevel?: number;
    playerCompanionDirective?: string | null;
    progressionTrackers?: {
        lastPlayerXPValueOnSync?: number;
        dailyEffortHoursSpent?: number;
    };
    currentActivity?: CurrentActivity | null;
    completedActivities?: CompletedActivity[];
    tags?: string[];
    // New fields
    npcRelationships?: NpcRelationship[];
    goals?: NpcGoals;
    plans?: string | null;
    personalQuests?: NpcPersonalQuest[];
    relationshipLock?: NpcRelationshipLock;
}

export interface FactionRank {
    rankNameMale: string;
    rankNameFemale: string;
    requiredReputation: number;
    benefits: string[];
    unlockCondition?: string;
    isJunctionPoint?: boolean;
    availableBranches?: string[];
}

export interface FactionRankBranch {
    branchId: string;
    displayName: string;
    isCoreBranch: boolean;
    ranks: FactionRank[];
}

export interface PowerProfile {
    military: number;
    economic: number;
    social: number;
    covert: number;
    logistics: number;
    stability: number;
    arcane_tech: number;
    exploration: number;
}

export interface MetaResource {
    resourceName: 'Wealth' | 'Influence' | 'Manpower';
    currentStockpile: number;
    incomePerCycle: number;
    upkeepPerCycle: number;
}

export interface StrategicGood {
    resourceName: string;
    currentStockpile: number;
    incomePerCycle: number;
}

export interface Project {
    projectId: string;
    projectName: string;
    description: string;
    totalTimeCostMinutes: number;
    timeSpentMinutes: number;
    currentStep: number;
    totalSteps: number;
    totalResourceCost?: { resourceName: string; totalAmount: number }[];
    resourcesSpent?: { resourceName: string; amountSpent: number }[];
    activeState?: 'Active' | 'Completed' | 'Abandoned';
}

export interface CompletedProject {
    projectId: string;
    projectName: string;
    completionTurn: number;
    finalState: 'Completed' | 'Abandoned';
}

// FIX: Expanded the Faction interface to include all properties available from the Gemini API prompt.
export interface Faction {
    factionId: string;
    initialId?: string | null;
    name: string;
    description: string;
    reputation: number;
    reputationDescription: string;
    isPlayerMember: boolean;
    playerRank: string | null;
    playerBranch?: string | null;
    ranks?: { branches: FactionRankBranch[] };
    color?: string;
    image_prompt?: string;
    custom_image_prompt?: string | null;
    pending_image_prompt?: string | null;
    level?: number;
    experience?: number;
    experienceForNextLevel?: number;
    developmentArchetype?: string;
    customArchetypePriorities?: { primary: string; secondary: string; tertiary: string; };
    powerProfile?: PowerProfile;
    resources?: {
        metaResources: MetaResource[];
        strategicGoods: StrategicGood[];
    };
    controlledTerritories?: { locationId: string; locationName: string; }[];
    isPlayerFaction?: boolean;
    playerStrategyDirective?: string;
    structuredBonuses?: StructuredBonus[];
    customStates?: CustomState[];
    activeProjects?: Project[];
    completedProjects?: CompletedProject[];
    scribeChronicle?: string[];
    relations?: {
        targetFactionId: string;
        initialTargetFactionId?: string; // Add this field for initial linking
        status: 'Allied' | 'War' | 'Rivalry' | 'Neutral' | 'Vassal' | 'Patron';
        description: string;
    }[];
}

export interface WorldStateFlag {
    flagId: string;
    displayName: string;
    value: string | number | boolean | null;
    description: string;
}

export interface AffectedFaction {
  factionId: string;
  factionName: string;
  impactDescription: string;
}

export interface AffectedLocation {
  locationId: string;
  locationName: string;
  impactDescription: string;
}

export interface InvolvedNPC {
  NPCId: string;
  NPCName: string;
  roleInEvent: string;
}

export interface WorldEvent {
    eventId: string;
    turnNumber: number;
    date: {
        year: number;
        monthName: string;
        dayOfMonth: number;
        timeOfDay: string; // "HH:MM"
    };
    headline: string;
    summary: string;
    vignette: string;
    eventType: string;
    visibility: string;
    image_prompt?: string;
    affectedFactions?: AffectedFaction[];
    affectedLocations?: AffectedLocation[];
    involvedNPCs?: InvolvedNPC[];
}

export interface LootTemplate {
    baseName: string;
    quality: string;
    bonuses: string[];
}

export interface FactionChronicleUpdate {
    factionId: string;
    factionName: string;
    entryToAppend: string;
}

export interface FactionBonusChange {
    factionId: string;
    factionName: string;
    bonusesToAddOrUpdate?: (StructuredBonus & { bonusId?: string | null })[];
    bonusesToRemove?: string[] | null;
}

export interface FactionResourceChange {
    factionId: string;
    factionName: string;
    resourceChanges: {
        resourceName: string;
        changeAmount: number;
    }[];
}

export interface FactionCustomStateChange {
    factionId: string;
    factionName: string;
    statesToAddOrUpdate?: (CustomState & { stateId?: string | null })[];
    statesToRemove?: string[];
}

export interface NPCSkillChange {
    NPCId: string | null;
    NPCName: string;
    skillChanges?: (ActiveSkill | PassiveSkill)[];
    skillsToRemove?: string[];
}

export interface NPCSkillMasteryChange {
    NPCId: string | null;
    NPCName: string;
    skillName: string;
    newMasteryLevel?: number;
    newCurrentMasteryProgress?: number;
    newMasteryProgressNeeded?: number;
}

export interface NPCPassiveSkillMasteryChange {
    NPCId: string | null;
    NPCName: string;
    skillName: string;
    newMasteryLevel?: number;
    newMaxMasteryLevel?: number;
}

export interface NPCEffectChange {
    NPCId: string | null;
    NPCName: string;
    effectsApplied?: (Partial<Effect> & { effectId?: string | null })[];
    effectsToRemove?: string[];
}

export interface InventoryTransfer {
    transferId: string;
    source: { type: 'player' | 'npc'; id: string; itemId: string };
    destination: { type: 'player' | 'npc'; id: string };
    quantity: number;
}

export interface NPCInventoryAdd {
    NPCId: string | null;
    NPCName: string;
    item: Item;
    destinationContainerId?: string | null;
}

export interface NPCInventoryUpdate {
    NPCId: string | null;
    NPCName: string;
    itemUpdate: Partial<Item> & { existedId: string };
}

export interface NPCInventoryRemoval {
    NPCId: string | null;
    NPCName: string;
    itemId: string;
}

export interface NPCEquipmentChange {
    NPCId: string | null;
    NPCName: string;
    action: 'equip' | 'unequip';
    itemId: string | null;
    itemName: string;
    targetSlots?: string[];
    sourceSlots?: string[];
}

export interface NPCInventoryResourceChange {
    NPCId: string | null;
    NPCName: string;
    itemId: string | null;
    itemName: string;
    newResourceValue?: number;
    resource?: number;
    maximumResource?: number;
    resourceType?: string;
}

export interface NPCCustomStateChange {
    NPCId: string | null;
    NPCName: string;
    stateChanges: (Partial<CustomState> & { stateId?: string | null })[];
}

export interface NPCActivityUpdate {
    NPCId: string;
    NPCName: string;
    activityUpdate: Partial<CurrentActivity>;
}

export interface FactionProjectUpdate {
    factionId: string;
    factionName: string;
    projectUpdate: Partial<Project> & { projectId: string };
}

export interface CompleteNPCActivity {
    NPCId: string;
    NPCName: string;
    activityName: string;
    finalState: 'Completed' | 'Abandoned';
    narrativeSummary: string;
}

export interface CompleteFactionProject {
    factionId?: string;
    /** Turn-local tag of a faction created in this response; resolved to factionId before use. */
    initialFactionId?: string;
    factionName?: string;
    projectId: string;
    projectName: string;
    completionTurn?: number;
    finalState: 'Completed' | 'Abandoned';
    narrativeSummary?: string;
}

export interface CompleteThreatActivity {
  activityId: string;
  targetLocationId: string;
  threatId: string;
  threatName: string;
  finalState: 'Completed' | 'Abandoned';
  narrativeSummary: string;
}

// FIX: Added missing player-specific commands.
export interface EquipmentChange {
  action: 'equip' | 'unequip';
  itemId: string;
  itemName: string;
  targetSlots?: string[];
  sourceSlots?: string[];
}

export interface ItemResourceChange {
  name: string;
  resource: number;
  maximumResource: number;
  resourceType: string;
  contentsPath: string[] | null;
  existedId: string;
}

export interface ItemMove {
  movedItemId: string;
  itemName: string;
  currentContentsPath: string[] | null;
  destinationContainerId: string | null;
  destinationContainerName: string | null;
  destinationContentsPath: string[] | null;
}

interface LocationUpdate {
    locationId: string;
    newName?: string;
    newDescription?: string;
    newInternalDifficultyProfile?: Partial<DifficultyProfile>;
    newExternalDifficultyProfile?: Partial<DifficultyProfile>;
    newLastEventsDescription?: string;
    factionControl?: FactionControlEntry[];
    locationStorages?: LocationStorage[];
    newImagePrompt?: string; // Added for pending image prompt handling
    /** Older guides wrote the prompt straight onto the update instead of using the new* fields. */
    image_prompt?: string;
    pending_image_prompt?: string | null;
}

export interface StorageUpdatePayload {
  newName?: string;
  newDescription?: string;
  newCapacity?: number | null;
  newOwner?: LocationStorage['owner'];
  /** Fields copied verbatim onto the storage, so their shape is whatever the guide sent. */
  [key: string]: unknown;
}

export interface StorageUpdate {
  targetLocationId: string;
  storageId: string;
  update: StorageUpdatePayload;
}

export interface StorageRemoval {
  targetLocationId: string;
  storageId: string;
}

/** A change to the description or state of one link between locations. */
export interface LocationLinkUpdate {
    sourceLocationId: string;
    targetLocationId?: string;
    targetCoordinates?: LocationCoordinates;
    updatedLink?: { newShortDescription?: string; newLinkState?: string };
}

interface WorldMapUpdates {
    newLocations?: Partial<Location>[];
    newLinks?: { sourceLocationId: string; link: AdjacencyMapEntry }[];
    locationUpdates?: LocationUpdate[];
    linkUpdates?: LocationLinkUpdate[];
    linksToRemove?: { sourceLocationId: string; targetLocationId?: string; targetCoordinates?: LocationCoordinates }[];
    threatsToAdd?: { targetLocationId?: string; initialTargetLocationId?: string; threat: ActiveThreat }[];
    threatsToUpdate?: { targetLocationId: string, threatUpdate: Partial<ActiveThreat> & { threatId: string } }[];
    threatsToRemove?: { targetLocationId: string, threatId: string }[];
    completeThreatActivities?: CompleteThreatActivity[];
    storageUpdates?: StorageUpdate[];
    storagesToRemove?: StorageRemoval[];
}

export interface FactionRankBranchChange {
    factionId: string | null;
    initialFactionId?: string | null;
    factionName: string;
    branchesToAdd?: FactionRankBranch[];
    branchesToUpdate?: { branchId: string; newDisplayName?: string }[];
    branchesToRemove?: string[];
    ranksToAdd?: { targetBranchId: string; rank: FactionRank }[];
    ranksToUpdate?: {
        targetBranchId: string;
        rankIdentifier: string;
        update: Partial<{
            newRankNameMale: string;
            newRankNameFemale: string;
            newRequiredReputation: number;
            newUnlockCondition: string;
            newBenefits: string[];
            newIsJunctionPoint: boolean;
            newAvailableBranches: string[];
        }>;
    }[];
    ranksToRemove?: { targetBranchId: string; rankIdentifier: string }[];
}

export interface InterNPCRelationshipChange {
    sourceNpcId: string;
    sourceNpcName: string;
    targetNpcId: string | null;
    initialTargetNpcId?: string | null;
    targetNpcName: string;
    newRelationshipStatus: 'Ally' | 'Friend' | 'Neutral' | 'Rival' | 'Enemy' | 'Subordinate' | 'Superior' | 'Family';
    newStatusReason: string;
}

export interface NPCGoalUpdate {
    NPCId: string;
    NPCName: string;
    newShortTermGoal?: string; // string or "_clear_"
    newLongTermGoal?: string;
    newPlan?: string;
}

export interface NPCQuestUpdate {
    NPCId: string;
    NPCName: string;
    questsToAddOrUpdate?: NpcPersonalQuest[];
    questsToRemove?: string[]; // quest names
}

export interface NPCRelationshipLockUpdate {
    NPCId: string;
    NPCName: string;
    lockUpdate: {
        newIsLocked?: boolean;
        newCurrentCap?: number;
        newBreakthroughQuestId?: string | null; // or "_clear_"
    };
}

/** What a step tells the turn loop to do next; the model fills these in as it plans. */
export interface InternalTurnFlags {
    isCombatActive?: boolean;
    isSimpleTurn?: boolean;
    needsSelfCorrection?: boolean;
    needsFactionProgression?: boolean;
    needsWorldProgression?: boolean;
    needsInventoryProcessing?: boolean;
    needsNPCProcessing?: boolean;
    [key: string]: unknown;
}

/**
 * Anything the detail modal can be asked to show: an entity from the save, or a
 * decorated copy a log builds on the spot (`{ ...item, type: 'item' }`).
 */
export type DetailData =
    | Record<string, unknown>
    | Item
    | Quest
    | NPC
    | Location
    | PlayerCharacter
    | Faction
    | Wound
    | Effect
    | PassiveSkill
    | ActiveSkill
    | CombatAction
    | NpcPersonalQuest
    | CustomState
    | CustomStateThreshold
    | WorldEvent
    | UnlockedMemory;

/** A journal line the turn wants appended to one of the player's items. */
export interface ItemJournalUpdate {
    itemId: string;
    initialItemId?: string;
    itemName: string;
    entryToAppend: string;
}

/** One per-turn command aimed at another party member; keys depend on the command. */
export type PlayerCommand = Record<string, unknown> & {
    itemJournalUpdates?: ItemJournalUpdate[];
};

export interface GameResponse {
    response?: string;
    thoughtSignature?: string; // Opaque token for preserving reasoning context
    /** Routing flags a step sets for the turn loop. */
    _internal_flags_?: InternalTurnFlags;
    /** Set by the relay when the step asked for a rule bundle it could not read. */
    _arenaRuleBundleUnavailable?: boolean;
    /** Set on a correction response that refuses to repair the JSON and asks for a fresh step. */
    regenerationRequired?: boolean;
    reason?: string;
    image_prompt?: string;
    items_and_stat_calculations?: string[];
    inventoryItemsData?: Partial<Item>[];
    removeInventoryItems?: { removedItemId: string }[];
    updateItemTextContents?: { itemId: string; itemName: string; textToAppend: string }[];
    activeSkillChanges?: Partial<ActiveSkill>[];
    removeActiveSkills?: string[];
    skillMasteryChanges?: SkillMasteryChange[];
    passiveSkillChanges?: Partial<PassiveSkill>[];
    removePassiveSkills?: string[];
    enemiesData?: EnemyCombatObject[];
    alliesData?: AllyCombatObject[];
    combatLogEntries?: string[];
    playerActiveEffectsChanges?: Partial<Effect>[];
    currentLocationData?: Partial<Location> & { lastEventsDescription?: string };
    questUpdates?: QuestUpdate[];
    NPCsData?: Partial<NPC>[];
    NPCsRenameData?: { oldName: string; newName: string }[];
    NPCJournals?: { NPCId: string; name: string; lastJournalNote: string }[];
    NPCRelationshipChanges?: { NPCId: string; NPCName?: string; newRelationshipLevel: number; changeReason?: string; }[];
    factionDataChanges?: Partial<Faction>[];
    factionRankBranchChanges?: FactionRankBranchChange[];
    dialogueOptions?: string[];
    multipliers?: number[];
    playerBehaviorAssessment?: { historyManipulationCoefficient: number };
    currentHealthChange?: number;
    currentEnergyChange?: number;
    moneyChange?: number;
    experienceGained?: number;
    timeChange?: number;
    weatherChange?: { tendency: string };
    setWorldTime?: {
        year: number;
        monthName: string;
        dayOfMonth: number;
        timeOfDay: string; // "HH:MM"
    };
    updateWorldProgressionTracker?: { newLastWorldProgressionTimeInMinutes: number };
    updateFactionProgressionTracker?: { newLastFactionProgressionTimeInMinutes: number };
    playerStatus?: PlayerStatus;
    worldStateFlags?: WorldStateFlag[];
    removeWorldStateFlags?: string[];
    worldEventsLog?: WorldEvent[];
    plotOutline?: PlotOutline;
    worldMapUpdates?: WorldMapUpdates;
    playerWoundChanges?: Partial<Wound>[];
    addOrUpdateRecipes?: Recipe[];
    removeRecipes?: string[];
    calculatedWeightData?: { additionalEnergyExpenditure: number };
    otherPlayersInteractions?: Record<string, PlayerCommand[]>;
    customStateChanges?: Partial<CustomState>[];
    playerCharacterNameChange?: string | null;
    playerImagePromptChange?: string | null;
    generateWorldProgression?: boolean;
    factionChronicleUpdates?: FactionChronicleUpdate[];
    factionBonusChanges?: FactionBonusChange[];
    factionResourceChanges?: FactionResourceChange[];
    statsIncreased?: string | string[];
    statsDecreased?: string | string[];
    setCharacteristics?: Record<string, number>;
    NPCActiveSkillChanges?: NPCSkillChange[];
    NPCPassiveSkillChanges?: NPCSkillChange[];
    NPCSkillMasteryChanges?: NPCSkillMasteryChange[];
    NPCPassiveSkillMasteryChanges?: NPCPassiveSkillMasteryChange[];
    NPCEffectChanges?: NPCEffectChange[];
    NPCUnlockedMemories?: (Partial<UnlockedMemory> & { NPCId: string; NPCName: string })[];
    NPCFateCardUnlocks?: { NPCId: string; cardId: string; cardName: string }[];
    NPCsInScene?: boolean;
    factionCustomStateChanges?: FactionCustomStateChange[];
    inventoryTransfers?: InventoryTransfer[];
    NPCInventoryAdds?: NPCInventoryAdd[];
    NPCInventoryUpdates?: NPCInventoryUpdate[];
    NPCInventoryRemovals?: NPCInventoryRemoval[];
    NPCEquipmentChanges?: NPCEquipmentChange[];
    itemFateCardUnlocks?: { itemId: string; cardId: string; cardName: string }[];
    itemBondLevelChanges?: { itemId: string; itemName: string; newBondLevel: number; changeReason: string }[];
    itemJournalUpdates?: (Omit<ItemJournalUpdate, 'itemId'> & { itemId: string | null })[];
    playerAppearanceChange?: string | null;
    playerRaceChange?: string | null;
    playerRaceDescriptionChange?: string | null;
    playerClassChange?: string | null;
    playerClassDescriptionChange?: string | null;
    playerAutoCombatSkillChange?: string | 'clear' | null;
    playerStealthStateChange?: Partial<StealthState>;
    playerEffortTrackerChange?: Partial<EffortTracker>;
    NPCWoundChanges?: NPCWoundChange[];
    NPCInventoryResourcesChanges?: NPCInventoryResourceChange[];
    NPCCustomStateChanges?: NPCCustomStateChange[];
    NPCActivityUpdates?: NPCActivityUpdate[];
    factionProjectUpdates?: FactionProjectUpdate[];
    completeNPCActivities?: CompleteNPCActivity[];
    completeFactionProjects?: CompleteFactionProject[];
    // FIX: Added missing player-specific commands for 100% prompt coverage.
    equipmentChanges?: EquipmentChange[];
    inventoryItemsResources?: ItemResourceChange[];
    moveInventoryItems?: ItemMove[];
    characterChronicleUpdates?: { entryToAppend: string }[];
    interNPCRelationshipChanges?: InterNPCRelationshipChange[];
    NPCGoalUpdates?: NPCGoalUpdate[];
    NPCQuestUpdates?: NPCQuestUpdate[];
    NPCRelationshipLockUpdates?: NPCRelationshipLockUpdate[];
}

export interface CinemaFrame {
    imagePrompt: string;
    imageUrl?: string;
    subtitle: string;
}

export interface Cinematic {
    id: string;
    title: string;
    synopsis: string;
    userPrompt: string;
    frames: CinemaFrame[];
    comments: string[];
    audio_base64?: string;
    audio_voice?: string;
}

export interface GameState {
    playerCharacter: PlayerCharacter;
    players: PlayerCharacter[];
    activePlayerIndex: number;
    currentLocationData: Location;
    activeQuests: Quest[];
    completedQuests: Quest[];
    encounteredNPCs: NPC[];
    encounteredFactions: Faction[];
    enemiesData: EnemyCombatObject[];
    alliesData: AllyCombatObject[];
    playerCustomStates: CustomState[];
    plotOutline: PlotOutline | null;
    temporaryStash?: Item[];
    // Committed transfer IDs and canonical payloads, saved with the game.
    completedInventoryTransfers?: Record<string, string>;
    worldStateFlags: WorldStateFlag[];
    worldEventsLog: WorldEvent[];
    imageCache: Record<string, ImageCacheEntry>;
    lastUpdatedQuestId?: string | null;
    npcSortOrder?: string[];
    NPCsInScene?: boolean;
    cinematics?: Cinematic[];
    thoughtSignature?: string; // Preserved reasoning context from the last turn

}

export interface CombatActionEffect {
    effectType: string;
    value: string;
    targetType: string;
    targetTypeDisplayName?: string;
    duration?: number;
    effectDescription?: string;
    targetsCount?: number;
}

export interface CombatAction {
    actionName: string;
    isActivatedEffect?: boolean;
    effects: CombatActionEffect[];
    targetPriority?: string;
    scalingCharacteristic?: string | null;
    shotsPerTurn?: number;
    ammoType?: string;
}

/**
 * One action of a combatant whose wait the client counts (#6.1.6.7, #12.9.3). The turn of the use
 * and the length of the wait are both read out of the state; `earlyUse*` is recorded when a use
 * arrived before the wait its own earlier use opened, and it is what the combat panel reads back.
 */
export interface ActionCooldown {
    actionName: string;
    lastUsedTurnNumber: number;
    cooldownTurns: number;
    /** The first turn a reuse contradicts nothing. */
    readyFromTurn: number;
    /** The use that landed inside the wait, and the turn that wait asked for. */
    earlyUseTurnNumber?: number;
    earlyUseAgainstReadyFrom?: number;
}

export interface Combatant {
    NPCId: string | null;
    name: string;
    image_prompt?: string;
    description: string;
    type: string;
    isGroup?: boolean;
    count?: number;
    unitName?: string;
    healthStates?: string[];
    maxHealth: string;
    currentHealth: string | null;
    actions: CombatAction[];
    resistances?: CombatResistance[];
    activeBuffs?: Effect[];
    activeDebuffs?: Effect[];
    wounds?: Wound[];
    /** The names the response reported as used this turn (#12.9.3); consumed by the client, never stored. */
    cooldownsUsed?: string[];
    /** The countdown the client keeps, one entry per action name the NPC's own skills state a wait for. */
    cooldowns?: ActionCooldown[];
}

export type EnemyCombatObject = Combatant;
export type AllyCombatObject = Combatant;

/** Mastery progress of one NPC skill, handed to the model each turn. */
export interface NpcSkillMasteryEntry {
    NPCId?: string;
    skillName?: string;
    currentMasteryLevel?: number;
    [key: string]: unknown;
}

export interface GameContext {
    message: string;
    image?: { mimeType: string; data: string; } | null;
    superInstructions: string;
    currentTurnNumber: number;
    gameSettings: GameSettings;
    playerCharacter: PlayerCharacter;
    players: PlayerCharacter[];
    currentLocation: Location;
    visitedLocations: Location[];
    activeQuests: Quest[];
    completedQuests: Quest[];
    encounteredNPCs: NPC[];
    npcSkillMasteryData: NpcSkillMasteryEntry[];
    lootForCurrentTurn: LootTemplate[];
    preGeneratedDices1d20: number[];
    worldState: WorldState;
    worldStateFlags: WorldStateFlag[];
    previousTurnResponse: GameResponse | null;
    encounteredFactions: Faction[];
    plotOutline: PlotOutline | null;
    worldMap: Record<string, Location>;
    responseHistory: ChatMessage[];
    currentStepFocus: string | null;
    /** The response merged so far; a prompt-only context carries it as serialised JSON. */
    partiallyGeneratedResponse: Partial<GameResponse> | string | null;
    enemiesDataForCurrentTurn: EnemyCombatObject[];
    alliesDataForCurrentTurn: AllyCombatObject[];
    playerCustomStates: CustomState[];
    worldEventsLog: WorldEvent[];
    previousThoughtSignature?: string; // Passed back to the model to maintain reasoning context
}

export interface DBSaveSlotInfo {
    slotId: number;
    timestamp: string;
    playerName: string;
    playerLevel: number;
    locationName: string;
    turnNumber: number;
    /** The slot had to be written without cached images (size budget or full quota). */
    imagesOmitted?: boolean;
}

export interface AdjacencyMapEntry {
    targetLocationId?: string; // Legacy links may contain coordinates only.
    name: string;
    shortDescription: string;
    linkType: string;
    linkState: string;
    targetCoordinates: LocationCoordinates;
    estimatedInternalDifficultyProfile?: DifficultyProfile;
    estimatedExternalDifficultyProfile?: DifficultyProfile;
}

export type Language = 'en' | 'ru';

export interface SaveFile {
  gameContext: GameContext;
  gameState: GameState;
  gameHistory: ChatMessage[];
  gameLog: string[];
  combatLog: string[];
  lastJsonResponse: string | null;
  sceneImagePrompt: string | null;
  timestamp: string;
  /** Cached images dropped from this save to keep it within the size budget. */
  omittedImageCount?: number;
  /** Set when the storage quota forced the save to be written without any images. */
  imagesOmittedForQuota?: boolean;
  /** Images this save referenced but the local store could not return when it was loaded. */
  missingImageCount?: number;
}

export const isWound = (d: unknown): d is (Wound & { type: 'wound', characterType: 'player' | 'npc', characterId: string | null }) =>
    !!d && typeof d === 'object' && !Array.isArray(d) && (d as { type?: unknown }).type === 'wound';
