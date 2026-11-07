




import React, { useState, useEffect, useMemo } from 'react';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, ClockIcon, WrenchScrewdriverIcon, InformationCircleIcon, TrashIcon, CloudArrowDownIcon, BookOpenIcon, PaintBrushIcon } from '@heroicons/react/24/outline';
import { GameSettings, DBSaveSlotInfo, GameState } from '../types';
import { useLocalization } from '../context/LocalizationContext';
import ConfirmationModal from './ConfirmationModal';
import AboutContent from './AboutContent';
import Modal from './Modal';
import { UniverseCustomizer } from './UniverseCustomizer';
import { gameData as defaultGameData } from '../utils/localizationGameData';
import { UNKNOWN_AUTOSAVE_TIMESTAMP } from '../utils/fileManager';


interface GameMenuViewProps {
    onSave: () => void;
    onLoad: () => void;
    onLoadAutosave: () => void;
    autosaveTimestamp: string | null;
    isGameActive: boolean;
    gameSettings: GameSettings | null;
    updateGameSettings: (newSettings: Partial<GameSettings>) => void;
    superInstructions: string;
    updateSuperInstructions: (instructions: string) => void;
    isLoading: boolean;
    onSaveToSlot: (slotId: number) => Promise<void>;
    onLoadFromSlot: (slotId: number) => Promise<void>;
    onDeleteSlot: (slotId: number) => Promise<void>;
    dbSaveSlots: DBSaveSlotInfo[];
    refreshDbSaveSlots: () => Promise<void>;
    clearNpcJournalsNow: () => void;
    gameState: GameState | null;
}

const formatTimestamp = (timestamp: string | null, t: (key: string, replacements?: any) => string): string => {
    if (!timestamp) return t('Never');
    if (timestamp === UNKNOWN_AUTOSAVE_TIMESTAMP) return t('Available');
    try {
        return new Date(timestamp).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return 'Invalid Date';
    }
};

const UI_CONTROL_SCALE_MIN = 0.8;
const UI_CONTROL_SCALE_MAX = 1.25;
const UI_FONT_SCALE_MIN = 0.85;
const UI_FONT_SCALE_MAX = 1.25;

const clampScale = (value: unknown, min: number, max: number): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(max, Math.max(min, parsed));
};

const formatScalePercent = (value: number): string => `${Math.round(value * 100)}%`;

const getSliderProgress = (value: number, min: number, max: number): string => {
    return `${((value - min) / (max - min)) * 100}%`;
};

const cooperativeModeButtonBaseClass = 'min-w-0 min-h-[5rem] px-2 py-3 rounded-md text-center transition-all border flex items-center justify-center whitespace-normal break-words leading-snug';

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


export default function GameMenuView({
    onSave,
    onLoad,
    onLoadAutosave,
    autosaveTimestamp,
    isGameActive,
    gameSettings,
    updateGameSettings,
    superInstructions,
    updateSuperInstructions,
    isLoading,
    onSaveToSlot,
    onLoadFromSlot,
    onDeleteSlot,
    dbSaveSlots,
    refreshDbSaveSlots,
    clearNpcJournalsNow,
    gameState,
}: GameMenuViewProps): React.ReactNode {
    const [isAdultConfirmOpen, setIsAdultConfirmOpen] = useState(false);
    const [localSuperInstructions, setLocalSuperInstructions] = React.useState(superInstructions);
    const [localWorldInfo, setLocalWorldInfo] = useState(gameSettings?.gameWorldInformation?.customInfo ?? '');
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState<number | null>(null);
    const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState<number | null>(null);
    const [isClearJournalConfirmOpen, setIsClearJournalConfirmOpen] = useState(false);
    const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
    const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
    const { t } = useLocalization();

    useEffect(() => {
        setLocalSuperInstructions(superInstructions);
    }, [superInstructions]);

    useEffect(() => {
        if (gameSettings) {
            setLocalWorldInfo(gameSettings.gameWorldInformation.customInfo);
        }
    }, [gameSettings?.gameWorldInformation?.customInfo]);

    useEffect(() => {
        refreshDbSaveSlots();
    }, [refreshDbSaveSlots]);

    const universeInfo = useMemo(() => {
        if (!gameSettings) return { universe: null, selectedEra: null };

        const { baseInfo } = gameSettings.gameWorldInformation;
        if (!baseInfo) return { universe: null, selectedEra: null };

        if (baseInfo.universe) {
            return { universe: baseInfo.universe, selectedEra: baseInfo.selectedEra };
        }

        for (const uniKey of Object.keys(defaultGameData)) {
            const uniData = (defaultGameData as any)[uniKey];
            if (uniKey === 'history' || uniKey === 'myths') {
                for (const eraKey in uniData) {
                    if (uniData[eraKey].name === baseInfo.name) {
                        return { universe: uniKey, selectedEra: eraKey };
                    }
                }
            } else if (uniKey !== 'custom') {
                if (uniData.name === baseInfo.name) {
                    return { universe: uniKey, selectedEra: null };
                }
            }
        }

        const customEraKey = baseInfo.name?.toLowerCase().replace(/\s+/g, '_');
        return { universe: 'custom', selectedEra: customEraKey };

    }, [gameSettings]);

    const handleUpdateGameData = (newGameData: any) => {
        if (!gameSettings || !universeInfo.universe) return;
        const { universe, selectedEra } = universeInfo;

        let world;
        if (universe === 'history' && selectedEra) world = newGameData.history[selectedEra];
        else if (universe === 'myths' && selectedEra) world = newGameData.myths[selectedEra];
        else if (universe === 'custom' && selectedEra) world = newGameData.custom[selectedEra];
        else world = newGameData[universe];

        if (world) {
            const finalWorldData = {
                ...world,
                universe: universe,
                selectedEra: selectedEra,
            };
            updateGameSettings({
                gameWorldInformation: {
                    ...gameSettings.gameWorldInformation,
                    baseInfo: finalWorldData,
                    currencyName: finalWorldData.currencyName
                }
            });
        }
    };

    const gameDataStateForCustomizer = useMemo(() => {
        if (!gameSettings || !universeInfo.universe) {
            return JSON.parse(JSON.stringify(defaultGameData));
        }
        const { universe, selectedEra } = universeInfo;
        const baseInfo = gameSettings.gameWorldInformation.baseInfo;
        const gameDataState = JSON.parse(JSON.stringify(defaultGameData));

        if (universe === 'history' && selectedEra) {
            gameDataState.history[selectedEra as keyof typeof gameDataState.history] = baseInfo;
        } else if (universe === 'myths' && selectedEra) {
            gameDataState.myths[selectedEra as keyof typeof gameDataState.myths] = baseInfo;
        } else if (universe === 'custom' && selectedEra) {
            if (!gameDataState.custom) (gameDataState as any).custom = {};
            (gameDataState as any).custom[selectedEra] = baseInfo;
        } else if ((gameDataState as any)[universe as keyof typeof gameDataState]) {
            (gameDataState as any)[universe] = baseInfo;
        }
        return gameDataState;
    }, [gameSettings, universeInfo]);

    const handleSaveSuperInstructions = () => {
        updateSuperInstructions(localSuperInstructions);
    };

    const handleSaveWorldInfo = () => {
        if (gameSettings) {
            updateGameSettings({
                gameWorldInformation: {
                    ...gameSettings.gameWorldInformation,
                    customInfo: localWorldInfo,
                },
            });
        }
    };

    const handleSaveToNewSlot = () => {
        const nextSlotId = dbSaveSlots.length > 0 ? Math.max(...dbSaveSlots.map(s => s.slotId)) + 1 : 1;
        onSaveToSlot(nextSlotId);
    };

    const confirmDelete = () => {
        if (isDeleteConfirmOpen !== null) {
            onDeleteSlot(isDeleteConfirmOpen);
            setIsDeleteConfirmOpen(null);
        }
    };

    const confirmOverwrite = () => {
        if (isOverwriteConfirmOpen !== null) {
            onSaveToSlot(isOverwriteConfirmOpen);
            setIsOverwriteConfirmOpen(null);
        }
    };

    const handleClearJournalsConfirm = () => {
        clearNpcJournalsNow();
        setIsClearJournalConfirmOpen(false);
    };

    if (!gameSettings) {
        return (
             <div className="space-y-6">
                <div>
                    <h3 className="text-xl font-bold text-cyan-400 mb-4 narrative-text">{t('Game Management')}</h3>
                    <div className="space-y-3">
                         <button disabled className="w-full flex items-center justify-center gap-3 px-4 py-3 text-base font-semibold text-cyan-200 bg-cyan-600/20 rounded-lg opacity-50 cursor-not-allowed">
                            {t("Loading Settings...")}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    const { adultMode, allowHistoryManipulation, keepLatestNpcJournals, latestNpcJournalsCount, cooperativeGameType, multiplePersonalitiesSettings, autoPassTurn: autoPassTurnSetting, autoPassTurnInCoop: legacyAutoPassTurn, showPartyStatusPanel, doNotUseWorldEvents, hardMode, impossibleMode } = gameSettings;

    const handleDifficultyChange = (difficulty: 'normal' | 'hard' | 'impossible') => {
        updateGameSettings({
            hardMode: difficulty === 'hard' || difficulty === 'impossible',
            impossibleMode: difficulty === 'impossible'
        });
    };
    const currentDifficulty = impossibleMode ? 'impossible' : (hardMode ? 'hard' : 'normal');
    const uiControlScale = clampScale(gameSettings.uiControlScale, UI_CONTROL_SCALE_MIN, UI_CONTROL_SCALE_MAX);
    const uiFontScale = clampScale(gameSettings.uiFontScale, UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX);

    const handleAdultModeClick = () => {
        if (isLoading) return;

        if (adultMode) {
            updateGameSettings({ adultMode: false });
        } else {
            setIsAdultConfirmOpen(true);
        }
    };

    const confirmAdultMode = () => {
      updateGameSettings({ adultMode: true });
      setIsAdultConfirmOpen(false);
    };

    return (
        <div className="h-full">
            <div className="space-y-8">
            <fieldset disabled={!isGameActive} className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text flex items-center gap-2">
                    <WrenchScrewdriverIcon className="w-6 h-6" /> {t('Game Management')}
                </h3>

                <fieldset disabled={isLoading} className="space-y-4">
                <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50">
                    <h4 className="font-semibold text-gray-300 mb-3">{t("Database Saves")}</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {dbSaveSlots.length > 0 ? dbSaveSlots.map(slot => (
                            <div key={slot.slotId} className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-md">
                                <div className="flex-1">
                                    <p className="font-semibold text-white">
                                        {t('Slot')} {slot.slotId}: {slot.playerName} ({t('Lvl {level}', { level: slot.playerLevel })})
                                    </p>
                                    <p className="text-xs text-gray-400">
                                        {slot.locationName} - {t('Turn')} {slot.turnNumber} - {formatTimestamp(slot.timestamp, t)}
                                    </p>
                                    {slot.imagesOmitted && (
                                        <p className="text-xs text-yellow-300/90" data-testid={`slot-without-images-${slot.slotId}`}>
                                            {t('slot_without_images')}
                                        </p>
                                    )}
                                </div>
                                <button onClick={() => onLoadFromSlot(slot.slotId)} className="p-2 text-cyan-300 bg-cyan-600/20 hover:bg-cyan-600/40 rounded-md transition-colors" title={t('Load')}><CloudArrowDownIcon className="w-5 h-5" /></button>
                                <button onClick={() => setIsOverwriteConfirmOpen(slot.slotId)} className="p-2 text-yellow-300 bg-yellow-600/20 hover:bg-yellow-600/40 rounded-md transition-colors" title={t('Save')}><ArrowDownTrayIcon className="w-5 h-5" /></button>
                                <button onClick={() => setIsDeleteConfirmOpen(slot.slotId)} className="p-2 text-red-300 bg-red-600/20 hover:bg-red-600/40 rounded-md transition-colors" title={t('Delete')}><TrashIcon className="w-5 h-5" /></button>
                            </div>
                        )) : <p className="text-sm text-gray-500 text-center py-4">{t("No saved games in the database yet.")}</p>}
                    </div>
                    <button onClick={handleSaveToNewSlot} className="w-full mt-3 bg-cyan-600/80 text-white font-bold py-2 px-4 rounded-md hover:bg-cyan-600 transition-all text-sm">{t("Save to New Slot")}</button>
                </div>
                </fieldset>

                <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50">
                    <h4 className="font-semibold text-gray-300 mb-3">{t("File & Autosave")}</h4>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <button type="button" onClick={onSave} disabled={!gameState} className="flex-1 w-full flex items-center justify-center gap-3 px-4 py-2 text-base font-semibold text-gray-200 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                            <ArrowDownTrayIcon className="w-5 h-5" />
                            {t("Save to File")}
                        </button>
                        <button onClick={onLoad} disabled={isLoading} title={t('Choose the save file and, if you have it, the images file - both at once is fine.')} className="flex-1 w-full flex items-center justify-center gap-3 px-4 py-2 text-base font-semibold text-gray-200 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                             <ArrowUpTrayIcon className="w-5 h-5" />
                            {t("Load from File")}
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">{t('Choose the save file and, if you have it, the images file - both at once is fine.')}</p>
                    <button onClick={onLoadAutosave} disabled={!autosaveTimestamp || isLoading} className="w-full mt-3 text-cyan-400/80 hover:text-cyan-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 p-2">
                        <ClockIcon className="w-5 h-5" />
                        {t("Autosave")}: {formatTimestamp(autosaveTimestamp, t)}
                    </button>
                </div>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50">
                    <ToggleSwitch
                        label={t("disable_image_generation")}
                        description={t("disable_image_generation_desc")}
                        name="disableImageGeneration"
                        checked={gameSettings.disableImageGeneration ?? false}
                        onChange={(e) => updateGameSettings({ disableImageGeneration: e.target.checked })}
                    />
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text flex items-center gap-2">
                    <PaintBrushIcon className="w-6 h-6" /> {t('Interface Settings')}
                </h3>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-cyan-500/20 space-y-5">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <label htmlFor="uiControlScale-ingame" className="font-medium text-gray-300">{t('UI Control Size')}</label>
                            <span className="text-sm font-mono text-cyan-300">{formatScalePercent(uiControlScale)}</span>
                        </div>
                        <input
                            type="range"
                            id="uiControlScale-ingame"
                            min={UI_CONTROL_SCALE_MIN}
                            max={UI_CONTROL_SCALE_MAX}
                            step="0.05"
                            value={uiControlScale}
                            onChange={(e) => updateGameSettings({ uiControlScale: Number(e.target.value) })}
                            className="w-full styled-slider"
                            style={{ '--range-progress': getSliderProgress(uiControlScale, UI_CONTROL_SCALE_MIN, UI_CONTROL_SCALE_MAX) } as React.CSSProperties}
                        />
                        <p className="text-xs text-gray-400">{t('UI Control Size Description')}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <label htmlFor="uiFontScale-ingame" className="font-medium text-gray-300">{t('UI Font Size')}</label>
                            <span className="text-sm font-mono text-cyan-300">{formatScalePercent(uiFontScale)}</span>
                        </div>
                        <input
                            type="range"
                            id="uiFontScale-ingame"
                            min={UI_FONT_SCALE_MIN}
                            max={UI_FONT_SCALE_MAX}
                            step="0.05"
                            value={uiFontScale}
                            onChange={(e) => updateGameSettings({ uiFontScale: Number(e.target.value) })}
                            className="w-full styled-slider"
                            style={{ '--range-progress': getSliderProgress(uiFontScale, UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX) } as React.CSSProperties}
                        />
                        <p className="text-xs text-gray-400">{t('UI Font Size Description')}</p>
                    </div>

                    <button
                        type="button"
                        onClick={() => updateGameSettings({ uiControlScale: 1, uiFontScale: 1 })}
                        className="w-full bg-gray-700/50 text-gray-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-colors text-sm"
                    >
                        {t('Reset Interface Size')}
                    </button>
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text">{t("Game Master's Memory")}</h3>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="font-medium text-gray-300 flex items-center gap-2">
                                {t("keep_journals_label")}
                                <span className="text-gray-400 hover:text-white cursor-pointer" title={t("keep_journals_tooltip")}>
                                    <InformationCircleIcon className="w-4 h-4" />
                                </span>
                            </label>
                            <p className="text-xs text-gray-400">{t("Helps reduce context size and speed up turns.")}</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={keepLatestNpcJournals} onChange={(e) => updateGameSettings({ keepLatestNpcJournals: e.target.checked })} />
                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                        </label>
                    </div>
                    {keepLatestNpcJournals && (
                        <div className="animate-fade-in-down-fast">
                            <label htmlFor="latestNpcJournalsCount" className="block text-sm font-medium text-gray-300 mb-2">{t("Number of entries to keep")}</label>
                            <input type="number" id="latestNpcJournalsCount" value={latestNpcJournalsCount} onChange={(e) => updateGameSettings({ latestNpcJournalsCount: parseInt(e.target.value, 10) })} min="1" className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition" />
                        </div>
                    )}
                    <button onClick={() => setIsClearJournalConfirmOpen(true)} className="w-full bg-gray-700/50 text-gray-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 text-sm">
                        <TrashIcon className="w-4 h-4" />
                        {t("Clear now")}
                    </button>
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
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
                    <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg border border-yellow-500/20">
                        <div>
                            <label className="font-medium text-yellow-300">{t("Adult Mode (21+)")}</label>
                            <p className="text-xs text-gray-400">{t("Enables less restrictive, player-driven narrative content.")}</p>
                        </div>
                        <div onClick={handleAdultModeClick} className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={!!adultMode} readOnly tabIndex={-1} />
                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-yellow-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-600"></div>
                        </div>
                    </div>

                    <ToggleSwitch label={t("Allow History Manipulation")} description={t("allowHistoryManipulationDescription")} name="allowHistoryManipulation" checked={allowHistoryManipulation} onChange={(e) => updateGameSettings({ allowHistoryManipulation: e.target.checked })} />
                    <ToggleSwitch label={t('Disable World Events')} description={t('disable_world_events_desc')} name="doNotUseWorldEvents" checked={!!doNotUseWorldEvents} onChange={(e) => updateGameSettings({ doNotUseWorldEvents: e.target.checked })} />
                    <ToggleSwitch
                        label={t("generate_world_event_images")}
                        description={t("generate_world_event_images_desc")}
                        name="generateWorldEventImages"
                        checked={gameSettings.generateWorldEventImages ?? true}
                        onChange={(e) => updateGameSettings({ generateWorldEventImages: e.target.checked })}
                    />
                    <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg">
                        <div>
                            <label htmlFor="notificationSound" className="font-medium text-gray-300 flex items-center gap-2">
                                {t("Notification Sound")}
                                <span className="text-gray-400 hover:text-white cursor-pointer" title={t("notificationSoundTooltip")}>
                                    <InformationCircleIcon className="w-4 h-4" />
                                </span>
                            </label>
                            <p className="text-xs text-gray-400">{t("Play a sound when the GM's response is ready.")}</p>
                        </div>
                        <label htmlFor="notificationSound-ingame" className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="notificationSound-ingame" name="notificationSound" checked={!!gameSettings.notificationSound} onChange={(e) => updateGameSettings({ notificationSound: e.target.checked })} className="sr-only peer" />
                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                        </label>
                    </div>
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text">{t("Cooperative Settings")}</h3>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-cyan-500/20 space-y-4">
                     <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg">
                        <div>
                            <label className="font-medium text-gray-300">{t("Show Players Panel")}</label>
                            <p className="text-xs text-gray-400">{t("Show/hide the party status panel at the top of the screen.")}</p>
                        </div>
                        <label htmlFor="showPartyStatusPanel" className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" id="showPartyStatusPanel" name="showPartyStatusPanel" className="sr-only peer" checked={!!showPartyStatusPanel} onChange={(e) => updateGameSettings({ showPartyStatusPanel: e.target.checked })} />
                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                        </label>
                    </div>
                    <div className="p-4 bg-gray-900/30 rounded-lg border border-cyan-500/20">
                        <h4 className="font-semibold text-gray-300 mb-3">{t("cooperative_mode")}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <button type="button" onClick={() => updateGameSettings({ cooperativeGameType: 'None' })} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'None' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('single_player')}</button>
                            <button type="button" onClick={() => updateGameSettings({ cooperativeGameType: 'MultiplePersonalities' })} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'MultiplePersonalities' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('multiple_personalities')}</button>
                            <button type="button" onClick={() => updateGameSettings({ cooperativeGameType: 'FullParty' })} className={`${cooperativeModeButtonBaseClass} ${cooperativeGameType === 'FullParty' ? 'bg-cyan-500/30 border-cyan-400 text-white' : 'bg-gray-700/50 border-gray-600 hover:bg-gray-700'}`}>{t('full_party')}</button>
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
                                        <label htmlFor={`mp-${key}-ingame`} className="relative inline-flex items-center cursor-pointer">
                                            <input
                                            type="checkbox"
                                            id={`mp-${key}-ingame`}
                                            name={key}
                                            checked={multiplePersonalitiesSettings?.[key] ?? false}
                                            onChange={(e) => {
                                                const { name, checked } = e.target;
                                                updateGameSettings({
                                                    multiplePersonalitiesSettings: {
                                                        ...gameSettings.multiplePersonalitiesSettings,
                                                        [name]: checked
                                                    }
                                                });
                                            }}
                                            className="sr-only peer"
                                            />
                                            <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-400 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                                        </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(cooperativeGameType === 'FullParty' || cooperativeGameType === 'MultiplePersonalities') && (
                            <div className="flex items-center justify-between p-3 bg-gray-900/30 rounded-lg mt-4">
                                <div>
                                <label className="font-medium text-gray-300">{t("auto_pass_turn")}</label>
                                <p className="text-xs text-gray-400">{t("auto_pass_turn_desc")}</p>
                                </div>
                                <label htmlFor="autoPassTurn" className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    id="autoPassTurn"
                                    name="autoPassTurn"
                                    checked={autoPassTurnSetting ?? legacyAutoPassTurn ?? true}
                                    onChange={(e) => updateGameSettings({ autoPassTurn: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-focus-within:ring-2 peer-focus-within:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
                                </label>
                            </div>
                        )}
                    </div>
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
                <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text flex items-center gap-2">{t("Arena GM")}</h3>
                <div className="p-4 bg-gray-900/30 rounded-lg border border-cyan-500/20 text-sm text-gray-300">
                    {t("The Arena agent handles all text and image generation. Model, provider, search, and generation-parameter controls are not used.")}
                </div>
            </fieldset>

            <fieldset disabled={!isGameActive || isLoading} className="space-y-4">
                 <h3 className="text-xl font-bold text-cyan-400 mb-2 narrative-text flex items-center gap-2"><BookOpenIcon className="w-6 h-6" /> {t('Narrative Overrides')}</h3>
                 <div className="p-4 bg-gray-900/30 rounded-lg border border-gray-700/50 space-y-4">
                    <button
                        type="button"
                        onClick={() => setIsCustomizerOpen(true)}
                        className="w-full bg-gray-700/60 text-cyan-300 font-semibold py-2 px-4 rounded-md hover:bg-gray-700 hover:text-cyan-200 transition-colors flex items-center justify-center gap-2"
                    >
                        <PaintBrushIcon className="w-5 h-5"/>
                        {t('Customize World')}
                    </button>
                    <div>
                        <label htmlFor="superInstructions" className="block text-sm font-medium text-gray-300 mb-2">{t("Player Super-Instructions")}</label>
                        <p className="text-xs text-gray-400 mb-2">{t("These instructions override the GM's default behavior. Use with caution.")}</p>
                        <textarea id="superInstructions" value={localSuperInstructions} onChange={(e) => setLocalSuperInstructions(e.target.value)} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition min-h-[120px]" />
                        <button onClick={handleSaveSuperInstructions} className="w-full mt-2 bg-cyan-600/80 text-white font-bold py-2 px-4 rounded-md hover:bg-cyan-600 transition-all text-sm">{t("Save Super-Instructions")}</button>
                    </div>
                     <div className="pt-4 border-t border-gray-700/60">
                        <label htmlFor="worldInformation" className="block text-sm font-medium text-gray-300 mb-2">{t("World Information")}</label>
                        <textarea id="worldInformation" value={localWorldInfo} onChange={(e) => setLocalWorldInfo(e.target.value)} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition min-h-[120px]" />
                        <button onClick={handleSaveWorldInfo} className="w-full mt-2 bg-cyan-600/80 text-white font-bold py-2 px-4 rounded-md hover:bg-cyan-600 transition-all text-sm">{t("Save World Information")}</button>
                    </div>
                 </div>
            </fieldset>
             <button type="button" onClick={() => setIsAboutModalOpen(true)} className="w-full bg-transparent text-gray-400 font-semibold py-2 px-4 rounded-md hover:bg-gray-700/50 transition-colors flex items-center justify-center gap-2">
                <InformationCircleIcon className="w-5 h-5"/>
                {t('About the Project')}
            </button>
        </div>
            <ConfirmationModal isOpen={isAdultConfirmOpen} onClose={() => setIsAdultConfirmOpen(false)} onConfirm={confirmAdultMode} title={t("Adult Mode (21+)")}>
                <p>{t("adult_mode_warning_p1")}</p><p>{t("adult_mode_warning_p2")}</p><p>{t("adult_mode_warning_p3")}</p><p className="font-bold">{t("adult_mode_warning_p4")}</p>
            </ConfirmationModal>
            <ConfirmationModal isOpen={isDeleteConfirmOpen !== null} onClose={() => setIsDeleteConfirmOpen(null)} onConfirm={confirmDelete} title={t("Confirm Deletion")}>
                <p>{t("Are you sure you want to delete this save slot? This action cannot be undone.")}</p>
            </ConfirmationModal>
            <ConfirmationModal isOpen={isOverwriteConfirmOpen !== null} onClose={() => setIsOverwriteConfirmOpen(null)} onConfirm={confirmOverwrite} title={t("Confirm Overwrite")}>
                 <p>{t("Are you sure you want to overwrite this save slot with your current progress?")}</p>
            </ConfirmationModal>
             <ConfirmationModal isOpen={isClearJournalConfirmOpen} onClose={() => setIsClearJournalConfirmOpen(false)} onConfirm={handleClearJournalsConfirm} title={t("Confirm Journal Clearing")}>
                <p>{t("confirm_journal_clearing_p1", { count: latestNpcJournalsCount })}</p>
                <p className="mt-2">{t("confirm_journal_clearing_p2")}</p>
            </ConfirmationModal>
            {isAboutModalOpen && (
                <Modal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} title={""}>
                    <AboutContent />
                </Modal>
            )}
            {isCustomizerOpen && gameSettings && universeInfo.universe && (
                <UniverseCustomizer
                    isOpen={isCustomizerOpen}
                    onClose={() => setIsCustomizerOpen(false)}
                    gameDataState={gameDataStateForCustomizer}
                    onUpdateGameData={handleUpdateGameData}
                    universe={universeInfo.universe}
                    selectedEra={universeInfo.selectedEra!}
                />
            )}
        </div>
    );
}
