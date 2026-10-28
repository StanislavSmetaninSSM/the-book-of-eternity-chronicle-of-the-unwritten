import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PlusIcon, MinusIcon } from '@heroicons/react/24/solid';
import { InformationCircleIcon, GlobeAltIcon, PaintBrushIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import Modal from './Modal';
import { UNKNOWN_AUTOSAVE_TIMESTAMP, prepareConfigurationFile, releasePreparedSaveFile, loadConfigurationFromFile, type PreparedSaveFile } from '../utils/fileManager';
import ConfirmationModal from './ConfirmationModal';
import { useLocalization } from '../context/LocalizationContext';
import { gameData } from '../utils/localizationGameData';
import AboutContent from './AboutContent';
import { DBSaveSlotInfo, NetworkRole, Calendar, Month, DayInfo } from '../types';
import { cultivationSystemDescEn, cultivationSystemDescRu } from '../utils/translations/presetRules/fantasy/cultivation';
import { magicSystemDescEn, magicSystemDescRu } from '../utils/translations/presetRules/fantasy/magic';
import { priesthoodSystemDescEn, priesthoodSystemDescRu } from '../utils/translations/presetRules/fantasy/priesthood';
import { hungerSystemDescEn, hungerSystemDescRu } from '../utils/translations/presetRules/post_apocalypse/hunger';
import { thirstSystemDescEn, thirstSystemDescRu } from '../utils/translations/presetRules/post_apocalypse/thirst';
import { radiationSystemDescEn, radiationSystemDescRu } from '../utils/translations/presetRules/post_apocalypse/radiation';
import { psionicSystemDescEn, psionicSystemDescRu } from '../utils/translations/presetRules/post_apocalypse/psionic';
import { psionicSystemDescSciFiEn, psionicSystemDescSciFiRu } from '../utils/translations/presetRules/sci_fi/psionic';
import { urbanMagicSystemDescEn, urbanMagicSystemDescRu } from '../utils/translations/presetRules/modern/null_space_magic';
import { fameSystemDescEn, fameSystemDescRu } from '../utils/translations/presetRules/history/fame';
import { oldMagicDescEn, oldMagicDescRu } from '../utils/translations/presetRules/myths/old_magic';
import { divineFavorDescEn, divineFavorDescRu } from '../utils/translations/presetRules/myths/divine_favor';
import { deathNoteSystemDescEn, deathNoteSystemDescRu } from '../utils/translations/presetRules/modern/death_note_system';
import { initializeAndPreviewSound } from '../utils/soundManager';
import { UniverseCustomizer } from './UniverseCustomizer';
import { weather as weatherTranslations } from '../utils/translations/ui/weather';
import { PlayerCharacter } from '../types';
import type { CrashRecoveryMarker, CrashRecoveryMetadata } from '../utils/fileManager';


const CHARACTERISTICS_LIST = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'faith', 'attractiveness', 'trade', 'persuasion', 'perception', 'luck', 'speed'];
const cooperativeModeButtonBaseClass = 'min-w-0 min-h-[5rem] px-2 py-3 rounded-md text-center transition-all border flex items-center justify-center whitespace-normal break-words leading-snug';

interface StartScreenProps {
    onStartLocal: (creationData: any) => void;
    onStartHost: (creationData: any) => void;
    onJoinGame: (hostId: string, role: NetworkRole, playerName: string) => void;
    onLoadGame: () => Promise<void>;
    onLoadAutosave: () => Promise<boolean>;
    autosaveTimestamp: string | null;
    crashRecoveryInfo: CrashRecoveryMetadata | null;
    crashRecoveryMarker: CrashRecoveryMarker | null;
    onLoadCrashRecovery: () => Promise<boolean>;
    onLoadFromSlot: (slotId: number) => Promise<void>;
    dbSaveSlots: DBSaveSlotInfo[];
}

const initialFormData = {
    universe: 'fantasy',
    selectedEra: 'king_arthurs_britain',
    customEraName: '',
    customSettingName: '',
    playerName: '',
    multiplayerNickname: '',
    characterDescription: '',
    initialPrompt: '',
    worldInformation: '',
    superInstructions: '',
    race: 'Human',
    charClass: 'Warrior',
    age: 25,
    isCustomRace: false,
    customRaceName: '',
    customRaceDescription: '',
    customAttributes: CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 1 }), {} as Record<string, number>),
    attributePoints: 5,
    isCustomClass: false,
    customClassName: '',
    customClassDescription: '',
    customClassAttributes: CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {} as Record<string, number>),
    customClassAttributePoints: 3,
    startTime: '08:00',
    weather: 'Random',
    startingYear: 1024,
    startingMonth: 'fantasy_month_1_name',
    startingDay: 1,
    nonMagicMode: false,
    adultMode: false,
    youtubeApiKey: '',
    allowHistoryManipulation: false,
    currencyName: 'Gold',
    customCurrencyValue: '',
    hardMode: false,
    impossibleMode: false,
    notificationSound: false,
    keepLatestNpcJournals: false,
    latestNpcJournalsCount: 20,
    cooperativeGameType: 'None' as 'None' | 'MultiplePersonalities' | 'FullParty',
    autoPassTurnInCoop: true,
    multiplePersonalitiesSettings: {
        shareCharacteristics: false,
        shareSkills: false,
        shareNpcReputation: false,
        shareFactionReputation: false,
        shareInventory: false,
    },
    doNotUseWorldEvents: false,
    pollinationsImageModel: 'flux' as 'flux' | 'turbo' | 'gptimage',
    useNanoBananaPrimary: false,
    useNanoBananaFallback: true,
    useCultivationSystem: false,
    cultivationSystemDescription: cultivationSystemDescEn,
    useMagicSystem: false,
    magicSystemDescription: magicSystemDescEn,
    usePriesthoodSystem: false,
    priesthoodSystemDescription: priesthoodSystemDescEn,
    useHungerSystem: false,
    hungerSystemDescription: hungerSystemDescEn,
    useThirstSystem: false,
    thirstSystemDescription: thirstSystemDescEn,
    useRadiationSystem: false,
    radiationSystemDescription: radiationSystemDescEn,
    usePsionicSystem: false,
    psionicSystemDescription: psionicSystemDescEn,
    usePsionicSystemSciFi: false,
    psionicSystemDescriptionSciFi: psionicSystemDescSciFiEn,
    useUrbanMagicSystem: false,
    urbanMagicSystemDescription: urbanMagicSystemDescEn,
    useDeathNoteSystem: false,
    deathNoteSystemDescription: deathNoteSystemDescEn,
    useFameSystem: false,
    fameSystemDescription: fameSystemDescEn,
    useOldMagicSystem: false,
    oldMagicDescription: oldMagicDescEn,
    useDivineFavorSystem: false,
    divineFavorDescription: divineFavorDescEn,
};

const formatTimestamp = (timestamp: string | null, t: (key: string) => string): string => {
    if (!timestamp) return '';
    if (timestamp === UNKNOWN_AUTOSAVE_TIMESTAMP) return t('Available');
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '';
    }
};

interface WorldData {
    name: string;
    description: string;
    currencyName: string;
    currencyOptions?: string[];
    races: Record<string, { description: string; bonuses: Record<string, number>; availableClasses?: string[] }>;
    classes: Record<string, { description: string; bonuses: Record<string, number> }>;
    calendar?: Calendar;
}

const universeDisplayNames: Record<string, string> = {
    fantasy: "Fantasy",
    sci_fi: "Sci-Fi",
    post_apocalypse: "Post-Apocalypse",
    urban_myth: "Urban Myth",
    history: "History",
    myths: "Myths",
    custom: "Custom",
};

const ToggleSwitch: React.FC<{
    label: string;
    description?: string;
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    name: string;
    disabled?: boolean;
}> = ({ label, description, checked, onChange, name, disabled = false }) => (
  <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg">
    <div>
      <label htmlFor={name} className={`font-medium text-gray-300 ${disabled ? 'text-gray-500' : ''}`}>{label}</label>
      {description && <p className={`text-xs text-gray-400 ${disabled ? 'text-gray-500' : ''}`}>{description}</p>}
    </div>
    <label htmlFor={name} className={`relative inline-flex items-center ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <input type="checkbox" id={name} name={name} checked={checked} onChange={onChange} disabled={disabled} className="sr-only peer" />
      <div className={`w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600 ${disabled ? 'opacity-50' : ''}`}></div>
    </label>
  </div>
);

interface CreationFormProps {
    formData: typeof initialFormData;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
    handleCheckboxChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleAdultModeClick: () => void;
    handleNonMagicModeClick: () => void;
    handleDifficultyChange: (difficulty: 'normal' | 'hard' | 'impossible') => void;
    handleCoopTypeChange: (type: 'None' | 'MultiplePersonalities' | 'FullParty') => void;
    handleMultiplePersonalitiesSettingChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSubmit: (e: React.FormEvent) => void;
    onLoadGame: () => void;
    submitButtonText: string;
    currentWorld: any;
    customGameData: typeof gameData;
    setIsCreatingUniverse: (isCreating: boolean) => void;
    setFormData: React.Dispatch<React.SetStateAction<typeof initialFormData>>;
}

const CreationForm: React.FC<CreationFormProps> = ({
    formData,
    handleInputChange,
    handleCheckboxChange,
    handleAdultModeClick,
    handleNonMagicModeClick,
    handleDifficultyChange,
    handleCoopTypeChange,
    handleMultiplePersonalitiesSettingChange,
    onSubmit,
    onLoadGame,
    submitButtonText,
    currentWorld,
    customGameData,
    setIsCreatingUniverse,
    setFormData
}) => {
    const { t } = useLocalization();
    const { universe, race, charClass, cooperativeGameType, multiplePersonalitiesSettings, hardMode, impossibleMode, startingMonth, startingDay } = formData;
    const isHostMode = submitButtonText === t('Create Game (Host)');
    const isSubmitDisabled = (submitButtonText === t('Begin Your Adventure') || submitButtonText === t('Create Game (Host)')) && formData.universe === 'custom' && !formData.selectedEra;

    const FULL_WEATHER_OPTIONS = useMemo(() => Object.keys(weatherTranslations.en), []);

    const raceOptions = useMemo(() => Object.keys(currentWorld.races), [currentWorld]);
    
    const availableClassesForRace = useMemo(() => {
        const selectedRaceData = (currentWorld as any).races[race];
        return selectedRaceData?.availableClasses || null;
    }, [race, currentWorld]);

    const classOptions = useMemo(() => {
        const allClasses = Object.keys(currentWorld.classes);
        if (availableClassesForRace) {
            return allClasses.filter(c => availableClassesForRace.includes(c));
        }
        return allClasses;
    }, [currentWorld.classes, availableClassesForRace]);
    
    const selectedRaceInfo = currentWorld.races[race];
    const selectedClassInfo = currentWorld.classes[charClass];
    const nonMagicDisabled = formData.universe === 'history';
    const nonMagicChecked = formData.universe === 'history' ? true : formData.nonMagicMode;

    const currentDifficulty = impossibleMode ? 'impossible' : (hardMode ? 'hard' : 'normal');

    const daysInSelectedMonth = useMemo(() => {
        const monthData = currentWorld.calendar?.months.find((m: any) => m.name === startingMonth);
        return monthData ? monthData.days : 31;
    }, [startingMonth, currentWorld.calendar]);

    const selectedDateInfo = useMemo(() => {
        if (!currentWorld.calendar) return { monthDescription: '', dayOfWeek: null };

        const calendar = currentWorld.calendar as Calendar;
        const selectedMonth = calendar.months.find(m => m.name === formData.startingMonth);
        const monthDescription = selectedMonth?.description ? t(selectedMonth.description as any) : '';

        const monthIndex = calendar.months.findIndex(m => m.name === formData.startingMonth);
        if (monthIndex === -1) return { monthDescription, dayOfWeekName: null, dayOfWeekDescription: null };

        const yearLengthInDays = calendar.months.reduce((acc, month) => acc + month.days, 0);
        if (yearLengthInDays <= 0) return { monthDescription, dayOfWeekName: null, dayOfWeekDescription: null };

        let totalDays = 0;
        let yearsPassed = Number(formData.startingYear) - Number(calendar.startingYear);
        if (Number(calendar.startingYear) > 0 && Number(formData.startingYear) <= 0) {
            yearsPassed += 1;
        } else if (Number(calendar.startingYear) <= 0 && Number(formData.startingYear) > 0) {
            yearsPassed -= 1;
        }
        totalDays += yearsPassed * yearLengthInDays;

        for (let i = 0; i < monthIndex; i++) {
            totalDays += calendar.months[i].days;
        }
        totalDays += (Number(formData.startingDay) - 1);

        const dayOfWeekIndex = totalDays >= 0
            ? totalDays % calendar.daysInWeek
            : (totalDays % calendar.daysInWeek + calendar.daysInWeek) % calendar.daysInWeek;

        const dayOfWeek = calendar.dayNames[dayOfWeekIndex] || null;
        
        let dayOfWeekName = '';
        let dayOfWeekDescription = '';
        if (dayOfWeek) {
            dayOfWeekName = typeof dayOfWeek === 'string' ? t(dayOfWeek as any) : t(dayOfWeek.name as any);
            if (typeof dayOfWeek === 'object' && dayOfWeek.description) {
                dayOfWeekDescription = t(dayOfWeek.description as any);
            }
        }

        return {
            monthDescription,
            dayOfWeekName: dayOfWeekName,
            dayOfWeekDescription: dayOfWeekDescription
        };
    }, [formData.startingYear, formData.startingMonth, formData.startingDay, currentWorld.calendar, t]);


    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">{t("Choose Your Universe")}</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.keys(universeDisplayNames).map(key => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => handleInputChange({ target: { name: 'universe', value: key } } as any)}
                            className={`p-3 rounded-md transition-all border flex items-center justify-center whitespace-normal min-h-[4rem] ${formData.universe === key ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}
                        >
                            {t(universeDisplayNames[key])}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                    {formData.universe === 'custom' && !formData.selectedEra
                        ? t('Create your own world from scratch...')
                        : t(currentWorld.description as any)}
                </p>
            </div>

            {formData.universe === 'history' && (
                <div>
                    <label htmlFor="selectedEra" className="block text-sm font-medium text-gray-300 mb-2">{t("Choose Your Era")}</label>
                    <select id="selectedEra" name="selectedEra" onChange={handleInputChange} value={formData.selectedEra} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition">
                        {Object.keys(gameData.history).map(eraKey => (
                            <option key={eraKey} value={eraKey}>{t(gameData.history[eraKey as keyof typeof gameData.history].name)}</option>
                        ))}
                    </select>
                </div>
            )}

            {formData.universe === 'myths' && (
                <div>
                    <label htmlFor="selectedEra" className="block text-sm font-medium text-gray-300 mb-2">{t("Setting")}</label>
                    <select id="selectedEra" name="selectedEra" onChange={handleInputChange} value={formData.selectedEra} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition">
                        {Object.keys(gameData.myths).map(settingKey => (
                            <option key={settingKey} value={settingKey}>{t(gameData.myths[settingKey as keyof typeof gameData.myths].name)}</option>
                        ))}
                    </select>
                </div>
            )}

            {formData.universe === 'custom' && (
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">{t('Choose Your Custom Universe')}</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {Object.entries(customGameData.custom || {}).map(([key, world]: [string, any]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => handleInputChange({ target: { name: 'selectedEra', value: key } } as any)}
                                className={`p-3 rounded-md transition-all border flex items-center justify-center whitespace-normal min-h-[4rem] ${formData.selectedEra === key ? 'bg-purple-500/30 border-purple-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}
                            >
                                {world.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setIsCreatingUniverse(true)}
                            className="p-3 rounded-md transition-all border-2 border-dashed border-gray-600 hover:border-cyan-400 hover:bg-cyan-900/20 text-gray-400 hover:text-cyan-300 flex flex-col items-center justify-center gap-1 min-h-[4rem]"
                        >
                            <PlusIcon className="w-6 h-6" />
                            <span className="text-sm font-semibold">{t('Create Custom Universe')}</span>
                        </button>
                    </div>
                </div>
            )}
          
            <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50 space-y-4">
                <h4 className="font-semibold text-gray-300 mb-3">{t("Calendar")}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label htmlFor="startingYear" className="block text-sm font-medium text-gray-300 mb-2">{t("Starting Year")}</label>
                        <input id="startingYear" name="startingYear" type="number" onChange={handleInputChange} value={formData.startingYear} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" />
                    </div>
                    <div>
                        <label htmlFor="startingMonth" className="block text-sm font-medium text-gray-300 mb-2">{t("Starting Month")}</label>
                        <select id="startingMonth" name="startingMonth" onChange={handleInputChange} value={formData.startingMonth} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition dark-select">
                            {currentWorld.calendar?.months.map((month: any) => (
                                <option key={month.name} value={month.name}>{t(month.name as any)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="startingDay" className="block text-sm font-medium text-gray-300 mb-2">{t("Starting Day")}</label>
                        <select id="startingDay" name="startingDay" onChange={handleInputChange} value={formData.startingDay} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition dark-select">
                            {Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1).map(day => (
                                <option key={day} value={day}>{day}</option>
                            ))}
                        </select>
                    </div>
                </div>
                {(selectedDateInfo.monthDescription || selectedDateInfo.dayOfWeekName) && (
                    <div className="pt-4 border-t border-gray-700/50 space-y-2 text-sm text-gray-400">
                        {selectedDateInfo.monthDescription && (
                            <p><span className="font-semibold text-gray-300">{t(formData.startingMonth as any)}</span> - {selectedDateInfo.monthDescription}</p>
                        )}
                        {selectedDateInfo.dayOfWeekName && (
                            <p><span className="font-semibold text-gray-300">{selectedDateInfo.dayOfWeekName}</span>{selectedDateInfo.dayOfWeekDescription ? ` - ${selectedDateInfo.dayOfWeekDescription}` : ''}</p>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="startTime" className="block text-sm font-medium text-gray-300 mb-2">{t("Starting Time")}</label>
                    <input 
                        id="startTime" 
                        name="startTime" 
                        type="time" 
                        onChange={handleInputChange} 
                        value={formData.startTime} 
                        className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" 
                    />
                </div>
                <div>
                    <label htmlFor="weather" className="block text-sm font-medium text-gray-300 mb-2">{t("Starting Weather")}</label>
                    <select 
                        id="weather" 
                        name="weather" 
                        onChange={handleInputChange} 
                        value={formData.weather} 
                        className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition"
                    >
                        <option value="Random">{t("Random")}</option>
                        {FULL_WEATHER_OPTIONS.map(w => <option key={w} value={w}>{t(w as any)}</option>)}
                    </select>
                </div>
            </div>

            {!isHostMode && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="playerName" className="block text-sm font-medium text-gray-300 mb-2">{t("Character Name")}</label>
                        <input id="playerName" name="playerName" type="text" onChange={handleInputChange} value={formData.playerName} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" required />
                    </div>
                    <div>
                        <label htmlFor="age" className="block text-sm font-medium text-gray-300 mb-2">{t("Age")}</label>
                        <input id="age" name="age" type="number" onChange={handleInputChange} value={formData.age} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" required min="1" />
                    </div>
                </div>
            )}
          
            <div>
                <label htmlFor="currencyName" className="block text-sm font-medium text-gray-300 mb-2">{t("Currency Name")}</label>
                <select
                    id="currencyName"
                    name="currencyName"
                    onChange={handleInputChange}
                    value={formData.currencyName}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition"
                >
                    {currentWorld.currencyOptions && currentWorld.currencyOptions.length > 0 ? (
                        currentWorld.currencyOptions.map((currency: string) => (
                            <option key={currency} value={currency}>{t(currency as any)}</option>
                        ))
                    ) : (
                        <option value={currentWorld.currencyName || 'Gold'}>{t((currentWorld.currencyName || 'Gold') as any)}</option>
                    )}
                </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label htmlFor="race" className="block text-sm font-medium text-gray-300 mb-2">{formData.universe === 'history' || formData.universe === 'myths' ? t("People") : t("Race")}</label>
                    <select id="race" name="race" onChange={handleInputChange} value={race} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition">
                        {raceOptions.map(r => <option key={r} value={r}>{t(r as any)}</option>)}
                    </select>
                    {selectedRaceInfo && <p className="text-xs text-cyan-300/80 mt-2">{t(selectedRaceInfo.description as any)}</p>}
                </div>

                <div>
                    <label htmlFor="charClass" className="block text-sm font-medium text-gray-300 mb-2">{t("Class")}</label>
                    <select id="charClass" name="charClass" onChange={handleInputChange} value={charClass} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition">
                        {classOptions.map(c => <option key={c} value={c}>{t(c as any)}</option>)}
                    </select>
                    {selectedClassInfo && <p className="text-xs text-cyan-300/80 mt-2">{t(selectedClassInfo.description as any)}</p>}
                </div>
            </div>
          
            <div>
                <label htmlFor="characterDescription" className="block text-sm font-medium text-gray-300 mb-2">{t("Character Description")}</label>
                <textarea id="characterDescription" name="characterDescription" onChange={handleInputChange} value={formData.characterDescription} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" placeholder={t("e.g., A grizzled warrior with a scarred face...")} rows={3} required />
            </div>
            <div>
                <label htmlFor="initialPrompt" className="block text-sm font-medium text-gray-300 mb-2">{t("Your First Action")}</label>
                <textarea id="initialPrompt" name="initialPrompt" onChange={handleInputChange} value={formData.initialPrompt} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" placeholder={t("e.g., I wake up in a dimly lit tavern...")} rows={3} required />
            </div>

            <div>
                <label htmlFor="worldInformation" className="block text-sm font-medium text-gray-300 mb-2">{t("World Information")}</label>
                <textarea
                    id="worldInformation"
                    name="worldInformation"
                    onChange={handleInputChange}
                    value={formData.worldInformation}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition"
                    placeholder={t("Briefly describe your world's key features or history. This is optional.")}
                    rows={4}
                />
            </div>

            <div>
                <label htmlFor="superInstructions" className="block text-sm font-medium text-gray-300 mb-2">{t("Your own rules")}</label>
                <textarea
                    id="superInstructions"
                    name="superInstructions"
                    onChange={handleInputChange}
                    value={formData.superInstructions}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition"
                    placeholder={t("Add any special rules or 'super-instructions' for the Game Master to follow. This is optional.")}
                    rows={4}
                />
            </div>
            
            <fieldset className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text">{t("Game Rules")}</h3>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-cyan-500/20 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">{t("Difficulty")}</label>
                        <div className="flex gap-2 p-1 bg-gray-900/50 rounded-lg">
                            <button type="button" onClick={() => handleDifficultyChange('normal')} className={`flex-1 p-2 rounded-md text-center text-sm font-semibold transition-all ${currentDifficulty === 'normal' ? 'bg-cyan-600 text-white ring-2 ring-cyan-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t('Normal')}</button>
                            <button type="button" onClick={() => handleDifficultyChange('hard')} className={`flex-1 p-2 rounded-md text-center text-sm font-semibold transition-all ${currentDifficulty === 'hard' ? 'bg-cyan-600 text-white ring-2 ring-cyan-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t('Hard')}</button>
                            <button type="button" onClick={() => handleDifficultyChange('impossible')} className={`flex-1 p-2 rounded-md text-center text-sm font-semibold transition-all ${currentDifficulty === 'impossible' ? 'bg-cyan-600 text-white ring-2 ring-cyan-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t('Impossible')}</button>
                        </div>
                        <p className="text-xs text-gray-400 mt-2 text-center">{t(`${currentDifficulty}_mode_description` as any)}</p>
                    </div>
                    <ToggleSwitch label={t('Disable World Events')} description={t('disable_world_events_desc')} name="doNotUseWorldEvents" checked={formData.doNotUseWorldEvents} onChange={handleCheckboxChange} />
                    <ToggleSwitch label={t('Allow History Manipulation')} description={t('allowHistoryManipulationDescription')} name="allowHistoryManipulation" checked={formData.allowHistoryManipulation} onChange={handleCheckboxChange} />
                    <ToggleSwitch label={t("Notification Sound")} description={t("notificationSoundTooltip")} name="notificationSound" checked={formData.notificationSound} onChange={handleCheckboxChange} />
                    <div className={`flex items-center justify-between p-3 rounded-lg ${nonMagicDisabled ? 'bg-gray-800/50' : 'bg-gray-900/30'}`}>
                        <div>
                            <label className={`font-medium ${nonMagicDisabled ? 'text-gray-500' : 'text-gray-300'}`}>{t("Non-Magic Mode")}</label>
                            <p className={`text-xs ${nonMagicDisabled ? 'text-gray-500' : 'text-gray-400'}`}>{t("Disables all magical elements for a realistic playthrough.")}</p>
                        </div>
                        <label htmlFor="nonMagicMode" className={`relative inline-flex items-center ${nonMagicDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <input type="checkbox" id="nonMagicMode" name="nonMagicMode" checked={nonMagicChecked} disabled={nonMagicDisabled} onChange={handleNonMagicModeClick} className="sr-only peer" />
                            <div className={`w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600 ${nonMagicDisabled ? 'opacity-50' : ''}`}></div>
                        </label>
                    </div>
                    <div className="pt-4 border-t border-gray-700/60">
                        <h4 className="text-lg font-semibold text-cyan-400 mb-2">{t('Preset Rules')}</h4>
                        {formData.universe === 'fantasy' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Cultivation System')} description="" name="useCultivationSystem" checked={formData.useCultivationSystem} onChange={handleCheckboxChange} />
                                {formData.useCultivationSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="cultivationSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Cultivation System Description for GM")}</label>
                                        <textarea id="cultivationSystemDescription" name="cultivationSystemDescription" onChange={handleInputChange} value={formData.cultivationSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Magic Development System')} description="" name="useMagicSystem" checked={formData.useMagicSystem} onChange={handleCheckboxChange} />
                                {formData.useMagicSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="magicSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Magic System Description for GM")}</label>
                                        <textarea id="magicSystemDescription" name="magicSystemDescription" onChange={handleInputChange} value={formData.magicSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Priesthood & Divine Favor System')} description="" name="usePriesthoodSystem" checked={formData.usePriesthoodSystem} onChange={handleCheckboxChange} />
                                {formData.usePriesthoodSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="priesthoodSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Priesthood & Divine Favor System Description for GM")}</label>
                                        <textarea id="priesthoodSystemDescription" name="priesthoodSystemDescription" onChange={handleInputChange} value={formData.priesthoodSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
        
                        {formData.universe === 'sci_fi' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Psionic Power System')} description="" name="usePsionicSystemSciFi" checked={formData.usePsionicSystemSciFi} onChange={handleCheckboxChange} />
                                {formData.usePsionicSystemSciFi && (
                                    <div className="pl-4">
                                        <label htmlFor="psionicSystemDescriptionSciFi" className="block text-xs font-medium text-gray-400 mb-1">{t("Psionic Power System Description for GM")}</label>
                                        <textarea id="psionicSystemDescriptionSciFi" name="psionicSystemDescriptionSciFi" onChange={handleInputChange} value={formData.psionicSystemDescriptionSciFi} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {formData.universe === 'post_apocalypse' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Hunger System')} description="" name="useHungerSystem" checked={formData.useHungerSystem} onChange={handleCheckboxChange} />
                                {formData.useHungerSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="hungerSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Hunger System Description for GM")}</label>
                                        <textarea id="hungerSystemDescription" name="hungerSystemDescription" onChange={handleInputChange} value={formData.hungerSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Thirst System')} description="" name="useThirstSystem" checked={formData.useThirstSystem} onChange={handleCheckboxChange} />
                                {formData.useThirstSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="thirstSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Thirst System Description for GM")}</label>
                                        <textarea id="thirstSystemDescription" name="thirstSystemDescription" onChange={handleInputChange} value={formData.thirstSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Radiation & Mutation System')} description="" name="useRadiationSystem" checked={formData.useRadiationSystem} onChange={handleCheckboxChange} />
                                {formData.useRadiationSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="radiationSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Radiation & Mutation System Description for GM")}</label>
                                        <textarea id="radiationSystemDescription" name="radiationSystemDescription" onChange={handleInputChange} value={formData.radiationSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Psionic Power System')} description="" name="usePsionicSystem" checked={formData.usePsionicSystem} onChange={handleCheckboxChange} />
                                {formData.usePsionicSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="psionicSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Psionic Power System Description for GM")}</label>
                                        <textarea id="psionicSystemDescription" name="psionicSystemDescription" onChange={handleInputChange} value={formData.psionicSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
        
                        {formData.universe === 'urban_myth' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Urban Magic System')} description="" name="useUrbanMagicSystem" checked={formData.useUrbanMagicSystem} onChange={handleCheckboxChange} />
                                {formData.useUrbanMagicSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="urbanMagicSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Urban Magic System Description for GM")}</label>
                                        <textarea id="urbanMagicSystemDescription" name="urbanMagicSystemDescription" onChange={handleInputChange} value={formData.urbanMagicSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Death Note System')} description="" name="useDeathNoteSystem" checked={formData.useDeathNoteSystem} onChange={handleCheckboxChange} />
                                {formData.useDeathNoteSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="deathNoteSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Death Note System Description for GM")}</label>
                                        <textarea id="deathNoteSystemDescription" name="deathNoteSystemDescription" onChange={handleInputChange} value={formData.deathNoteSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
                        {formData.universe === 'history' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Fame System')} description="" name="useFameSystem" checked={formData.useFameSystem} onChange={handleCheckboxChange} />
                                {formData.useFameSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="fameSystemDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Fame System Description for GM")}</label>
                                        <textarea id="fameSystemDescription" name="fameSystemDescription" onChange={handleInputChange} value={formData.fameSystemDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {formData.universe === 'myths' && (
                            <div className="space-y-3 animate-fade-in-down">
                                <ToggleSwitch label={t('Activate Old Magic of Albion System')} description="" name="useOldMagicSystem" checked={formData.useOldMagicSystem} onChange={handleCheckboxChange} />
                                {formData.useOldMagicSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="oldMagicDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Old Magic System Description for GM")}</label>
                                        <textarea id="oldMagicDescription" name="oldMagicDescription" onChange={handleInputChange} value={formData.oldMagicDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                                <ToggleSwitch label={t('Activate Favor of the Old Gods & the New System')} description="" name="useDivineFavorSystem" checked={formData.useDivineFavorSystem} onChange={handleCheckboxChange} />
                                {formData.useDivineFavorSystem && (
                                    <div className="pl-4">
                                        <label htmlFor="divineFavorDescription" className="block text-xs font-medium text-gray-400 mb-1">{t("Divine Favor System Description for GM")}</label>
                                        <textarea id="divineFavorDescription" name="divineFavorDescription" onChange={handleInputChange} value={formData.divineFavorDescription} className="w-full h-32 bg-gray-700/50 border border-gray-600 rounded-md p-2 text-xs text-gray-300 focus:ring-1 focus:ring-cyan-500 transition" />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </fieldset>
            
            <div className="p-4 bg-slate-900/30 rounded-lg border border-slate-700 space-y-4">
                <h3 className="text-lg font-semibold text-cyan-400">{t('cooperative_mode')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button type="button" onClick={() => handleCoopTypeChange('None')} disabled={submitButtonText.includes('Host')} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'None' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'} ${submitButtonText.includes('Host') ? 'opacity-50 cursor-not-allowed' : ''}`}>{t('single_player')}</button>
                    <button type="button" onClick={() => handleCoopTypeChange('MultiplePersonalities')} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'MultiplePersonalities' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('multiple_personalities')}</button>
                    <button type="button" onClick={() => handleCoopTypeChange('FullParty')} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'FullParty' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('full_party')}</button>
                </div>
                <p className="text-xs text-gray-400 text-center mt-2 min-h-[2.5rem] px-2">
                    {cooperativeGameType === 'MultiplePersonalities' ? t('multiple_personalities_desc') :
                        cooperativeGameType === 'FullParty' ? t('full_party_desc') : ''}
                </p>
                
                {cooperativeGameType === 'MultiplePersonalities' && (
                    <div className="p-3 bg-gray-800/30 rounded-md mt-4 space-y-3 animate-fade-in-down">
                        <h4 className="font-medium text-gray-300">{t("multiple_personalities_settings")}</h4>
                        <p className="text-xs text-gray-400">{t("share_settings_desc")}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(['shareCharacteristics', 'shareSkills', 'shareNpcReputation', 'shareFactionReputation', 'shareInventory'] as const).map(key => (
                                <div key={key} className="flex items-center justify-between p-2 bg-gray-900/30 rounded-lg">
                                        <label className="font-medium text-gray-300 text-sm">{t(key as any)}</label>
                                        <label htmlFor={key} className="relative inline-flex items-center cursor-pointer">
                                            <input
                                            type="checkbox"
                                            id={key}
                                            name={key}
                                            checked={multiplePersonalitiesSettings[key]}
                                            onChange={handleMultiplePersonalitiesSettingChange}
                                            className="sr-only peer"
                                        />
                                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-400 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                                        </label>
                                        </div>
                                    ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="p-4 bg-slate-900/30 rounded-lg border border-slate-700 space-y-4">
                <h3 className="text-lg font-semibold text-cyan-400">{t('Narrative Settings')}</h3>
                <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg">
                    <div>
                        <label className="font-medium text-yellow-300">{t("Adult Mode (21+)")}</label>
                        <p className="text-xs text-gray-400">{t("Enables less restrictive, player-driven narrative content.")}</p>
                    </div>
                    <div onClick={handleAdultModeClick} className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={!!formData.adultMode} readOnly tabIndex={-1} />
                        <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-yellow-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-600"></div>
                    </div>
                </div>

            </div>

            <div className="flex flex-col sm:flex-row gap-4 mt-8">
                <button type="submit" disabled={isSubmitDisabled} className="flex-1 w-full bg-cyan-600 text-white font-bold py-3 px-4 rounded-md hover:bg-cyan-500 transition-all text-lg shadow-lg shadow-cyan-500/10 disabled:bg-gray-600 disabled:cursor-not-allowed">
                    {submitButtonText}
                </button>
                <button type="button" onClick={onLoadGame} className="flex-1 w-full bg-gray-600 text-white font-bold py-3 px-4 rounded-md hover:bg-gray-500 transition-all text-lg">
                    {t("Load from File")}
                </button>
            </div>
            {isSubmitDisabled && (
                <p className="text-center text-yellow-400 text-sm mt-2">{t('custom_universe_required_warning')}</p>
            )}
        </form>
    );
}


export default function StartScreen({ onStartLocal, onStartHost, onJoinGame, onLoadGame, onLoadAutosave, autosaveTimestamp, crashRecoveryInfo, crashRecoveryMarker, onLoadCrashRecovery, onLoadFromSlot, dbSaveSlots }: StartScreenProps) {
    const [formData, setFormData] = useState(initialFormData);
    const [customGameData, setCustomGameData] = useState(() => JSON.parse(JSON.stringify(gameData)));
    const [preparedConfigurationFile, setPreparedConfigurationFile] = useState<PreparedSaveFile | null>(null);
    const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
    const [isAdultConfirmOpen, setIsAdultConfirmOpen] = useState(false);
    const [isNonMagicConfirmOpen, setIsNonMagicConfirmOpen] = useState(false);
    const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
    const { language, setLanguage, t } = useLocalization();
    const [activeTab, setActiveTab] = useState<'local' | 'network'>('local');
    const [networkTab, setNetworkTab] = useState<'host' | 'join'>('host');
    const [joinRole, setJoinRole] = useState<NetworkRole>('player');
    const [hostId, setHostId] = useState('');
    const [isCreatingUniverse, setIsCreatingUniverse] = useState(false);
    const [newUniverseName, setNewUniverseName] = useState('');
    const [newUniverseDescription, setNewUniverseDescription] = useState('');
    const [isConfigLoading, setIsConfigLoading] = useState(false);
    const [joinPlayerName, setJoinPlayerName] = useState('');

    useEffect(() => () => {
        if (preparedConfigurationFile) releasePreparedSaveFile(preparedConfigurationFile);
    }, [preparedConfigurationFile]);

    useEffect(() => {
        if (activeTab === 'network' && networkTab === 'host') {
            setFormData(prev => ({
                ...prev,
                cooperativeGameType: prev.cooperativeGameType === 'None' ? 'MultiplePersonalities' : prev.cooperativeGameType
            }));
        } else if (activeTab === 'local') {
            setFormData(prev => ({
                ...prev,
                cooperativeGameType: 'None'
            }));
        }
    }, [activeTab, networkTab]);
  
    useEffect(() => {
        setFormData(prev => {
            const newDescriptions: Partial<typeof prev> = {};
            if (prev.cultivationSystemDescription === cultivationSystemDescEn || prev.cultivationSystemDescription === cultivationSystemDescRu) newDescriptions.cultivationSystemDescription = language === 'ru' ? cultivationSystemDescRu : cultivationSystemDescEn;
            if (prev.magicSystemDescription === magicSystemDescEn || prev.magicSystemDescription === magicSystemDescRu) newDescriptions.magicSystemDescription = language === 'ru' ? magicSystemDescRu : magicSystemDescEn;
            if (prev.priesthoodSystemDescription === priesthoodSystemDescEn || prev.priesthoodSystemDescription === priesthoodSystemDescRu) newDescriptions.priesthoodSystemDescription = language === 'ru' ? priesthoodSystemDescRu : priesthoodSystemDescEn;
            if (prev.hungerSystemDescription === hungerSystemDescEn || prev.hungerSystemDescription === hungerSystemDescRu) newDescriptions.hungerSystemDescription = language === 'ru' ? hungerSystemDescRu : hungerSystemDescEn;
            if (prev.thirstSystemDescription === thirstSystemDescEn || prev.thirstSystemDescription === thirstSystemDescRu) newDescriptions.thirstSystemDescription = language === 'ru' ? thirstSystemDescRu : thirstSystemDescEn;
            if (prev.radiationSystemDescription === radiationSystemDescEn || prev.radiationSystemDescription === radiationSystemDescRu) newDescriptions.radiationSystemDescription = language === 'ru' ? radiationSystemDescRu : radiationSystemDescEn;
            if (prev.psionicSystemDescription === psionicSystemDescEn || prev.psionicSystemDescription === psionicSystemDescRu) newDescriptions.psionicSystemDescription = language === 'ru' ? psionicSystemDescRu : psionicSystemDescEn;
            if (prev.psionicSystemDescriptionSciFi === psionicSystemDescSciFiEn || prev.psionicSystemDescriptionSciFi === psionicSystemDescSciFiRu) newDescriptions.psionicSystemDescriptionSciFi = language === 'ru' ? psionicSystemDescSciFiRu : psionicSystemDescSciFiEn;
            if (prev.urbanMagicSystemDescription === urbanMagicSystemDescEn || prev.urbanMagicSystemDescription === urbanMagicSystemDescRu) newDescriptions.urbanMagicSystemDescription = language === 'ru' ? urbanMagicSystemDescRu : urbanMagicSystemDescEn;
            if (prev.deathNoteSystemDescription === deathNoteSystemDescEn || prev.deathNoteSystemDescription === deathNoteSystemDescRu) newDescriptions.deathNoteSystemDescription = language === 'ru' ? deathNoteSystemDescRu : deathNoteSystemDescEn;
            if (prev.fameSystemDescription === fameSystemDescEn || prev.fameSystemDescription === fameSystemDescRu) newDescriptions.fameSystemDescription = language === 'ru' ? fameSystemDescRu : fameSystemDescEn;
            if (prev.oldMagicDescription === oldMagicDescEn || prev.oldMagicDescription === oldMagicDescRu) newDescriptions.oldMagicDescription = language === 'ru' ? oldMagicDescRu : oldMagicDescEn;
            if (prev.divineFavorDescription === divineFavorDescEn || prev.divineFavorDescription === divineFavorDescRu) newDescriptions.divineFavorDescription = language === 'ru' ? divineFavorDescRu : divineFavorDescEn;
            return Object.keys(newDescriptions).length > 0 ? { ...prev, ...newDescriptions } : prev;
        });
    }, [language]);

    const isHostMode = activeTab === 'network' && networkTab === 'host';

    const handleLanguageToggle = () => {
        const newLang = language === 'ru' ? 'en' : 'ru';
        setLanguage(newLang);
    };

    const handleSaveConfiguration = () => {
        const cleanFormData = { ...formData } as typeof formData & Record<string, unknown>;
        [
            'aiProvider', 'modelName', 'correctionModelName', 'isCustomModel', 'customModelName',
            'openRouterModelName', 'geminiThinkingBudget', 'geminiThinkingLevel', 'useDynamicThinkingBudget',
            'geminiApiKey', 'openRouterApiKey', 'useGoogleSearch', 'imageGenerationModelPipeline',
        ].forEach(key => delete cleanFormData[key]);
        try {
            setPreparedConfigurationFile(prepareConfigurationFile({ formData: cleanFormData, customGameData }));
        } catch (err) {
            console.error('Error preparing configuration file:', err);
            alert(t('Could not save the configuration file.'));
        }
    };

    const closeConfigurationDownload = () => setPreparedConfigurationFile(null);

    const handleLoadConfiguration = async () => {
        setIsConfigLoading(true);
        const loadedData = await loadConfigurationFromFile(t);
        if (loadedData && loadedData.customGameData) {
            // Start with the loaded data as the base. It is the source of truth.
            const newGameData = JSON.parse(JSON.stringify(loadedData.customGameData));

            // Now, fill in any missing universes from the default gameData.
            for (const key in gameData) {
                if (Object.prototype.hasOwnProperty.call(gameData, key)) {
                    // If the loaded data does NOT have this universe, add it from the default.
                    if (!(newGameData as any)[key]) {
                        (newGameData as any)[key] = (gameData as any)[key];
                    }
                }
            }

            const addDefaultCalendarRecursively = (obj: any, defaultCalendar: any) => {
                if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;

                // Heuristic to identify a "world" object
                if (obj.name && obj.description && typeof obj.races === 'object' && typeof obj.classes === 'object') {
                    if (!obj.calendar) {
                        console.log(`Adding default calendar to world: ${obj.name}`);
                        obj.calendar = JSON.parse(JSON.stringify(defaultCalendar));
                    }
                }

                // Always recurse deeper, unless it's a leaf node or a calendar itself
                for (const key in obj) {
                    if (key !== 'calendar' && Object.prototype.hasOwnProperty.call(obj, key)) {
                        addDefaultCalendarRecursively(obj[key], defaultCalendar);
                    }
                }
            };
        
            const defaultCalendar = gameData.fantasy.calendar;
            addDefaultCalendarRecursively(newGameData, defaultCalendar);
        
            setCustomGameData(newGameData);
            const loadedFormData = { ...loadedData.formData } as typeof initialFormData & Record<string, unknown>;
            [
                'aiProvider', 'modelName', 'correctionModelName', 'isCustomModel', 'customModelName',
                'openRouterModelName', 'geminiThinkingBudget', 'geminiThinkingLevel', 'useDynamicThinkingBudget',
                'geminiApiKey', 'openRouterApiKey', 'useGoogleSearch', 'imageGenerationModelPipeline',
            ].forEach(key => delete loadedFormData[key]);
            setFormData({ ...initialFormData, ...loadedFormData });
        }
        // Use a timeout to ensure state updates propagate before the loading guard is lifted.
        setTimeout(() => setIsConfigLoading(false), 0);
    };

    const currentWorld: WorldData = useMemo(() => {
        const { universe, selectedEra } = formData;
        const gameDataSource = customGameData || gameData;
        let world;

        if (universe === 'custom') {
            world = (gameDataSource.custom && (gameDataSource.custom as any)[selectedEra]) 
                || { name: selectedEra || t('New Universe'), description: t('Create your own world from scratch...'), races: {}, classes: {}, currencyName: 'Gold', currencyOptions: ['Gold'] };
        } else if (universe === 'history') {
            world = gameDataSource.history[selectedEra as keyof typeof gameDataSource.history];
        } else if (universe === 'myths') {
            world = gameDataSource.myths[selectedEra as keyof typeof gameDataSource.myths];
        } else {
            world = (gameDataSource as any)[universe];
        }

        if (!world) {
            console.warn(`Could not find world data for universe: ${universe}, era: ${selectedEra}. Falling back to fantasy.`);
            return gameDataSource.fantasy;
        }

        return world;
    }, [formData.universe, formData.selectedEra, customGameData, t]);
  
    useEffect(() => {
        if (isConfigLoading) return;
    
        const newWorld = currentWorld;
        // Don't reset calendar values here; only validate options.
        // Calendar resets should only happen on explicit manual universe change.
    
        setFormData(prev => {
            const newRaceOptions = Object.keys(newWorld.races || {});
            const newClassOptions = Object.keys(newWorld.classes || {});
            const newCurrencyOptions = [...(newWorld.currencyOptions || [])];
            if (newWorld.currencyName && !newCurrencyOptions.includes(newWorld.currencyName)) {
                newCurrencyOptions.push(newWorld.currencyName);
            }
            if (newCurrencyOptions.length === 0) {
                newCurrencyOptions.push('Gold'); // Absolute fallback
            }
        
            const isCurrentRaceValid = newRaceOptions.includes(prev.race);
            const isCurrentClassValid = newClassOptions.includes(prev.charClass);
            const isCurrentCurrencyValid = newCurrencyOptions.includes(prev.currencyName) || prev.currencyName === 'CUSTOM';
        
            const firstRace = newRaceOptions[0] || 'Human';
            const firstClass = newClassOptions[0] || 'Warrior';
        
            return {
                ...prev,
                race: isCurrentRaceValid ? prev.race : firstRace,
                charClass: isCurrentClassValid ? prev.charClass : firstClass,
                isCustomRace: false,
                isCustomClass: false,
                currencyName: isCurrentCurrencyValid ? prev.currencyName : newWorld.currencyName || newCurrencyOptions[0] || 'Gold',
                // Removed forced calendar overrides to respect loaded configuration
            };
        });
    }, [currentWorld, isConfigLoading]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
    
        if (name === 'universe' || name === 'selectedEra') {
            let newUniverse = formData.universe;
            let newEra = formData.selectedEra;
    
            if (name === 'universe') {
                newUniverse = value;
                // This is the fix: when the universe changes, we need to pick a default era for that new universe
                if (newUniverse === 'history') {
                    newEra = Object.keys(customGameData.history)[0];
                } else if (newUniverse === 'myths') {
                    newEra = Object.keys(customGameData.myths)[0];
                } else if (newUniverse === 'custom') {
                    newEra = Object.keys(customGameData.custom || {})[0] || '';
                }
            } else { // name === 'selectedEra'
                newEra = value;
            }
    
            const getNewWorldData = (universe: string, era: string) => {
                const gameDataSource = customGameData || gameData;
                if (universe === 'custom') {
                    return ((gameDataSource.custom as any) && (gameDataSource.custom as any)[era]) 
                        || { name: era || t('New Universe'), description: t('Create your own world from scratch...'), races: {}, classes: {}, currencyName: 'Gold', currencyOptions: ['Gold'] };
                }
                if (universe === 'history') {
                    return gameDataSource.history[era as keyof typeof gameDataSource.history];
                }
                if (universe === 'myths') {
                    return gameDataSource.myths[era as keyof typeof gameDataSource.myths];
                }
                return (gameDataSource as any)[universe];
            };
    
            const newWorld = getNewWorldData(newUniverse, newEra);
            
            if (!newWorld) {
                console.error(`Could not find world data for universe ${newUniverse} and era ${newEra}.`);
                setFormData(prev => ({
                    ...prev,
                    universe: newUniverse,
                    selectedEra: newEra,
                }));
                return;
            }
    
            const newRaceOptions = Object.keys(newWorld.races || {});
            const firstRace = newRaceOptions[0] || 'Human';
            
            const selectedRaceData = (newWorld.races || {})[firstRace];
            const availableClasses = selectedRaceData?.availableClasses || null;
            const allClasses = Object.keys(newWorld.classes || {});
            const newClassOptions = availableClasses
                ? allClasses.filter((c: string) => availableClasses.includes(c))
                : allClasses;
            const firstClass = newClassOptions[0] || 'Warrior';
            
            const newCurrencyOptions = newWorld.currencyOptions || [];
            const newCurrencyName = newWorld.currencyName || newCurrencyOptions[0] || 'Gold';
            
            // Extract default calendar from the new world
            const calendar = newWorld.calendar || gameData.fantasy.calendar;

            setFormData(prev => ({
                ...prev,
                universe: newUniverse,
                selectedEra: newEra,
                race: newRaceOptions.includes(prev.race) ? prev.race : firstRace,
                charClass: newClassOptions.includes(prev.charClass) ? prev.charClass : firstClass,
                currencyName: newCurrencyOptions.includes(prev.currencyName) ? prev.currencyName : newCurrencyName,
                isCustomRace: false,
                isCustomClass: false,
                // Explicitly set calendar defaults here on manual switch
                startingYear: calendar.startingYear,
                startingMonth: calendar.startingMonthName,
                startingDay: calendar.startingDayOfMonth,
                startTime: calendar.startingTimeOfDay,
            }));
    
        } else if (name === 'startingMonth') {
            setFormData(prev => ({ ...prev, [name]: value, startingDay: 1 }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = e.target;
        if (name === 'notificationSound' && checked && !formData.notificationSound) {
            initializeAndPreviewSound();
        }
        setFormData(prev => ({ ...prev, [name]: checked }));
    };

    const handleMultiplePersonalitiesSettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = e.target;
        setFormData(prev => ({ ...prev, multiplePersonalitiesSettings: { ...prev.multiplePersonalitiesSettings, [name]: checked } }));
    };

    const handleAdultModeClick = () => {
        if (formData.adultMode) setFormData(prev => ({ ...prev, adultMode: false }));
        else setIsAdultConfirmOpen(true);
    };
    const confirmAdultMode = () => {
        setFormData(prev => ({ ...prev, adultMode: true }));
        setIsAdultConfirmOpen(false);
    };

    const handleNonMagicModeClick = () => {
        if (formData.nonMagicMode) setFormData(prev => ({ ...prev, nonMagicMode: false }));
        else setIsNonMagicConfirmOpen(true);
    };
    const confirmNonMagicMode = () => {
        setFormData(prev => ({ ...prev, nonMagicMode: true }));
        setIsNonMagicConfirmOpen(false);
    };

    const handleDifficultyChange = (difficulty: 'normal' | 'hard' | 'impossible') => {
        setFormData(prev => ({ ...prev, hardMode: difficulty !== 'normal', impossibleMode: difficulty === 'impossible' }));
    };
  
    const handleCoopTypeChange = (type: 'None' | 'MultiplePersonalities' | 'FullParty') => {
        setFormData(prev => ({ ...prev, cooperativeGameType: type }));
    };

    const prepareCreationData = () => {
        if (!isHostMode && (!formData.playerName || !formData.characterDescription || !formData.initialPrompt)) {
            alert(t("Please fill in all required fields."));
            return null;
        }
        const finalData = { ...formData, customGameData } as typeof formData & Record<string, unknown>;
        [
            'aiProvider', 'modelName', 'correctionModelName', 'isCustomModel', 'customModelName',
            'openRouterModelName', 'geminiThinkingBudget', 'geminiThinkingLevel', 'useDynamicThinkingBudget',
            'geminiApiKey', 'openRouterApiKey', 'useGoogleSearch', 'imageGenerationModelPipeline',
        ].forEach(key => delete finalData[key]);
        return finalData;
    };
  
    const handleLocalSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const creationData = prepareCreationData();
        if (creationData) {
            onStartLocal(creationData);
        }
    };

    const handleHostSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const creationData = prepareCreationData();
        if (creationData) {
            const hostData = {
                ...creationData,
                playerName: t('Host'),
                multiplayerNickname: t('Host')
            };
            onStartHost(hostData);
        }
    };
  
    const handleJoinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!hostId.trim()) {
            alert(t("Please enter a Host ID."));
            return;
        }
        if (joinRole === 'player' && !joinPlayerName.trim()) {
            alert(t("Please enter your nickname."));
            return;
        }
        onJoinGame(hostId, joinRole, joinPlayerName);
    };

    const handleCreateUniverse = () => {
        const name = newUniverseName.trim();
        if (!name) {
            alert(t('Please enter a name for your custom era/setting.'));
            return;
        }
        const key = name.toLowerCase().replace(/\s+/g, '_');

        const newCustomData = JSON.parse(JSON.stringify(customGameData));
        if (!newCustomData.custom) {
            newCustomData.custom = {};
        }
        newCustomData.custom[key] = {
            name: name,
            description: newUniverseDescription.trim() || t('A brand new world, waiting to be described.'),
            currencyName: 'Gold',
            currencyOptions: ['Gold'],
            races: {},
            classes: {},
            calendar: JSON.parse(JSON.stringify(gameData.fantasy.calendar)),
        };
        setCustomGameData(newCustomData);

        setFormData(prev => ({ 
            ...prev, 
            universe: 'custom', 
            selectedEra: key,
            // Explicitly set defaults for the new universe
            startingYear: gameData.fantasy.calendar.startingYear,
            startingMonth: gameData.fantasy.calendar.startingMonthName,
            startingDay: gameData.fantasy.calendar.startingDayOfMonth,
            startTime: gameData.fantasy.calendar.startingTimeOfDay
        }));
        setIsCreatingUniverse(false);
        setNewUniverseName('');
        setNewUniverseDescription('');
    };

    return (
        <div className="min-h-screen bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="relative w-full max-w-3xl bg-gray-800/80 p-6 md:p-8 rounded-lg shadow-2xl border border-cyan-500/20 ring-1 ring-cyan-500/20">
                <div className="absolute top-4 right-4 z-20">
                    <button
                        onClick={handleLanguageToggle}
                        className="p-2 text-gray-400 rounded-full hover:bg-gray-700/50 hover:text-white transition-colors flex items-center gap-1.5"
                        title={t("Switch Language")}
                        aria-label={t("Switch Language")}
                    >
                        <GlobeAltIcon className="w-5 h-5" />
                        <span className="font-bold text-xs">{language.toUpperCase()}</span>
                    </button>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold text-cyan-400 mb-2 text-center narrative-text drop-shadow-[0_2px_2px_rgba(0,255,255,0.2)]">{t("The Book of Eternity")}</h1>
                <p className="text-gray-400 mb-6 text-center text-base md:text-lg narrative-text italic">{t("Chronicle of the Unwritten")}</p>
        
                <div className="flex justify-center mb-6 border-b border-gray-700">
                    <button
                        onClick={() => setActiveTab('local')}
                        className={`px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${activeTab === 'local' ? 'border-cyan-400 text-white' : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'}`}
                    >
                        {t('Local Game')}
                    </button>
                    <button
                        onClick={() => setActiveTab('network')}
                        className={`px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${activeTab === 'network' ? 'border-cyan-400 text-white' : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'}`}
                    >
                        {t('Network Game')}
                    </button>
                </div>
        
                <div className="max-h-[65vh] overflow-y-auto pr-4 -mr-4">
                    {activeTab === 'local' && (
                        <div className="animate-fade-in-down">
                            <CreationForm 
                                formData={formData}
                                handleInputChange={handleInputChange}
                                handleCheckboxChange={handleCheckboxChange}
                                handleAdultModeClick={handleAdultModeClick}
                                handleNonMagicModeClick={handleNonMagicModeClick}
                                handleDifficultyChange={handleDifficultyChange}
                                handleCoopTypeChange={handleCoopTypeChange}
                                handleMultiplePersonalitiesSettingChange={handleMultiplePersonalitiesSettingChange}
                                onSubmit={handleLocalSubmit}
                                onLoadGame={onLoadGame}
                                submitButtonText={t('Begin Your Adventure')}
                                currentWorld={currentWorld}
                                customGameData={customGameData}
                                setIsCreatingUniverse={setIsCreatingUniverse}
                                setFormData={setFormData}
                            />
                        </div>
                    )}

                    {activeTab === 'network' && (
                        <div className="animate-fade-in-down">
                            <div className="flex justify-center mb-4">
                                <div className="bg-gray-900/50 p-1 rounded-lg flex gap-1">
                                    <button onClick={() => setNetworkTab('host')} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${networkTab === 'host' ? 'bg-cyan-600 text-white shadow' : 'text-gray-300 hover:bg-gray-700/50'}`}>{t('Host Game')}</button>
                                    <button onClick={() => setNetworkTab('join')} className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${networkTab === 'join' ? 'bg-cyan-600 text-white shadow' : 'text-gray-300 hover:bg-gray-700/50'}`}>{t('Join Game')}</button>
                                </div>
                            </div>
                            {networkTab === 'host' && (
                                <CreationForm 
                                    formData={formData}
                                    handleInputChange={handleInputChange}
                                    handleCheckboxChange={handleCheckboxChange}
                                            handleAdultModeClick={handleAdultModeClick}
                                    handleNonMagicModeClick={handleNonMagicModeClick}
                                    handleDifficultyChange={handleDifficultyChange}
                                        handleCoopTypeChange={handleCoopTypeChange}
                                    handleMultiplePersonalitiesSettingChange={handleMultiplePersonalitiesSettingChange}
                                        onSubmit={handleHostSubmit}
                                    onLoadGame={onLoadGame}
                                    submitButtonText={t('Create Game (Host)')}
                                    currentWorld={currentWorld}
                                    customGameData={customGameData}
                                    setIsCreatingUniverse={setIsCreatingUniverse}
                                    setFormData={setFormData}
                                />
                            )}
                            {networkTab === 'join' && (
                                <form onSubmit={handleJoinSubmit} className="space-y-4 pt-4">
                                    <div>
                                        <label htmlFor="hostId" className="block text-sm font-medium text-gray-300 mb-2">{t("Host ID")}</label>
                                        <input id="hostId" name="hostId" type="text" onChange={(e) => setHostId(e.target.value)} value={hostId} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" placeholder={t("Enter Host ID...")} required />
                                    </div>
                                    <div>
                                        <label htmlFor="joinPlayerName" className="block text-sm font-medium text-gray-300 mb-2">{t("Your Nickname")}</label>
                                        <input id="joinPlayerName" name="joinPlayerName" type="text" onChange={(e) => setJoinPlayerName(e.target.value)} value={joinPlayerName} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" placeholder={t("Enter your nickname for this session...")} required={joinRole === 'player'} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">{t("Your Role")}</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button type="button" onClick={() => setJoinRole('player')} className={`p-3 rounded-md text-center transition-all border ${joinRole === 'player' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('Player')}</button>
                                            <button type="button" onClick={() => setJoinRole('spectator')} className={`p-3 rounded-md text-center transition-all border ${joinRole === 'spectator' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('Spectator')}</button>
                                        </div>
                                    </div>
                                    <div className="pt-4">
                                        <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-md hover:bg-green-500 transition-all text-lg">{t('Join')}</button>
                                    </div>
                                </form>
                            )}
                        </div>
                    )}
                </div>

                {crashRecoveryMarker && crashRecoveryInfo && (
                    <div className="mt-4 rounded-md border border-yellow-500/40 bg-yellow-950/30 p-4 text-left shadow-lg">
                        <div className="flex items-start gap-3">
                            <ExclamationTriangleIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-yellow-300" />
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-yellow-200">
                                    Обнаружен сбой прошлой сессии / Previous session crashed
                                </p>
                                <p className="mt-1 text-sm text-gray-300">
                                    {crashRecoveryInfo.playerName}, {crashRecoveryInfo.locationName}, {t('Turn')} {crashRecoveryInfo.turnNumber ?? '-'} · {formatTimestamp(crashRecoveryInfo.timestamp, t)}
                                </p>
                                {crashRecoveryMarker.recoveryAttemptedAt && (
                                    <p className="mt-2 text-sm text-red-200">
                                        Восстановление уже пробовали. Если ошибка повторится, загрузите автосохранение или файл.
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={onLoadCrashRecovery}
                                    className="mt-3 w-full rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white transition-colors hover:bg-emerald-600"
                                >
                                    Загрузить последнее стабильное состояние / Load last stable state
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-4 text-center">
                    <button 
                        type="button" 
                        onClick={onLoadAutosave}
                        disabled={!autosaveTimestamp}
                        className="text-cyan-400/80 hover:text-cyan-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                    >
                        {t("Load Autosave")} ({formatTimestamp(autosaveTimestamp, t) || t('Never')})
                    </button>
                </div>
                <div className="mt-4 border-t border-gray-700 pt-4 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <button type="button" onClick={handleSaveConfiguration} className="flex-1 bg-gray-700/60 text-gray-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-colors">{t("Save Configuration")}</button>
                        <button type="button" onClick={handleLoadConfiguration} className="flex-1 bg-gray-700/60 text-gray-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-colors">{t("Load Configuration")}</button>
                    </div>
                    <Modal isOpen={!!preparedConfigurationFile} onClose={closeConfigurationDownload} title={t('Configuration file is ready')}>
                        {preparedConfigurationFile && (
                            <div className="space-y-4 text-gray-200">
                                <p>{t('Choose how to save your configuration file.')}</p>
                                <a
                                    href={preparedConfigurationFile.url}
                                    download={preparedConfigurationFile.filename}
                                    className="flex w-full items-center justify-center rounded-md bg-cyan-600 px-4 py-3 font-semibold text-white hover:bg-cyan-500"
                                >
                                    {t('Download configuration file')} ({preparedConfigurationFile.filename})
                                </a>
                                <a
                                    href={preparedConfigurationFile.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex w-full items-center justify-center rounded-md border border-gray-600 px-4 py-3 font-semibold text-cyan-200 hover:bg-gray-700"
                                >
                                    {t('Open configuration file in new tab')}
                                </a>
                                <p className="text-sm text-gray-400">{t('If the download is blocked, open the configuration in a new tab and use your browser’s Save command.')}</p>
                            </div>
                        )}
                    </Modal>
                    <button 
                        type="button" 
                        onClick={() => setIsCustomizerOpen(true)} 
                        className="w-full bg-gray-700/60 text-cyan-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 hover:text-cyan-200 transition-colors flex items-center justify-center gap-2"
                    >
                        <PaintBrushIcon className="w-5 h-5"/>
                        {t('Customize World')}
                    </button>
                    <button type="button" onClick={() => setIsAboutModalOpen(true)} className="w-full bg-transparent text-gray-400 font-semibold py-2 px-4 rounded-md hover:bg-gray-700/50 transition-colors flex items-center justify-center gap-2">
                        <InformationCircleIcon className="w-5 h-5"/>
                        {t('About the Project')}
                    </button>
                </div>
            </div>
            <ConfirmationModal isOpen={isAdultConfirmOpen} onClose={() => setIsAdultConfirmOpen(false)} onConfirm={confirmAdultMode} title={t("Adult Mode (21+)")}>
                <p>{t("adult_mode_warning_p1")}</p><p>{t("adult_mode_warning_p2")}</p><p>{t("adult_mode_warning_p3")}</p><p className="font-bold">{t("adult_mode_warning_p4")}</p>
            </ConfirmationModal>
            <ConfirmationModal isOpen={isNonMagicConfirmOpen} onClose={() => setIsNonMagicConfirmOpen(false)} onConfirm={confirmNonMagicMode} title={t("non_magic_mode_title")}>
                <p>{t("non_magic_mode_warning_p1")}</p>
                <p>{t("non_magic_mode_warning_p2")}</p>
                <p>{t("non_magic_mode_warning_p3")}</p>
                <p className="font-bold">{t("non_magic_mode_warning_p4")}</p>
            </ConfirmationModal>
            {isAboutModalOpen && (
                <Modal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} title={""}>
                    <AboutContent />
                </Modal>
            )}
            {isCustomizerOpen && (
                <UniverseCustomizer
                    isOpen={isCustomizerOpen}
                    onClose={() => setIsCustomizerOpen(false)}
                    gameDataState={customGameData}
                    onUpdateGameData={setCustomGameData}
                    universe={formData.universe}
                    selectedEra={formData.selectedEra}
                />
            )}
            {isCreatingUniverse && (
                <Modal isOpen={isCreatingUniverse} onClose={() => setIsCreatingUniverse(false)} title={t('Create Custom Universe')}>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="newUniverseName" className="block text-sm font-medium text-gray-300 mb-1">{t('Universe Name')}</label>
                            <input
                                id="newUniverseName"
                                type="text"
                                value={newUniverseName}
                                onChange={(e) => setNewUniverseName(e.target.value)}
                                className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2 text-gray-200"
                                placeholder={t('Enter universe name...')}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="newUniverseDescription" className="block text-sm font-medium text-gray-300 mb-1">{t('Description')}</label>
                            <textarea
                                id="newUniverseDescription"
                                value={newUniverseDescription}
                                onChange={(e) => setNewUniverseDescription(e.target.value)}
                                className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2 text-gray-200"
                                placeholder={t('A brand new world, waiting to be described.')}
                                rows={4}
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setIsCreatingUniverse(false)} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition">{t('Cancel')}</button>
                            <button onClick={handleCreateUniverse} className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition">{t('Create')}</button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
