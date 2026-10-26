

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocalization } from '../context/LocalizationContext';
import Modal from './Modal';
import { gameData, standardCalendarStructure } from '../utils/localizationGameData';
import { PlusIcon, MinusIcon, CheckIcon } from '@heroicons/react/24/solid';
// FIX: Added missing icon imports to resolve multiple 'Cannot find name' errors.
import { InformationCircleIcon, GlobeAltIcon, PaintBrushIcon, MagnifyingGlassIcon, PencilSquareIcon, TrashIcon, StarIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import ConfirmationModal from './ConfirmationModal';
import { Month, Calendar, DayInfo } from '../types';

interface UniverseCustomizerProps {
  isOpen: boolean;
  onClose: () => void;
  gameDataState: typeof gameData;
  onUpdateGameData: (newData: typeof gameData) => void;
  universe: string;
  selectedEra: string;
}

const CHARACTERISTICS_LIST = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'faith', 'attractiveness', 'trade', 'persuasion', 'perception', 'luck', 'speed'];

// RaceEditModal Component
const RaceEditModal: React.FC<{
    race: any;
    allClasses: string[];
    onSave: (race: any) => void;
    onClose: () => void;
}> = ({ race, allClasses, onSave, onClose }) => {
    const { t } = useLocalization();
    const [isPointLimitDisabled, setIsPointLimitDisabled] = useState(false);
    
    const [localRace, setLocalRace] = useState(() => {
        const initialBonuses = CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {});
        return {
            ...race,
            name: race.name ? t(race.name as any) : '',
            description: race.description ? t(race.description as any) : '',
            bonuses: { ...initialBonuses, ...race.bonuses },
            availableClasses: race.availableClasses || []
        };
    });

    useEffect(() => {
        const initialBonuses = CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {});
        setLocalRace({
            ...race,
            name: race.name ? t(race.name as any) : '',
            description: race.description ? t(race.description as any) : '',
            bonuses: { ...initialBonuses, ...race.bonuses },
            availableClasses: race.availableClasses || []
        });
    }, [race, t]);
    
    const points = useMemo(() => {
        // FIX: Explicitly map values to numbers before reducing to ensure type safety in arithmetic operation.
        const spentPoints = Object.values(localRace.bonuses || {}).map(v => Number(v)).reduce((sum, v) => sum + v, 0);
        return 5 - spentPoints;
    }, [localRace.bonuses]);


    const handleAttributeChange = (attr: string, delta: number) => {
        const currentVal = localRace.bonuses[attr] || 0;

        if (delta > 0) { // Increasing
            if (isPointLimitDisabled || points > 0) {
                setLocalRace(prev => ({ ...prev, bonuses: { ...prev.bonuses, [attr]: currentVal + 1 } }));
            }
        }
        
        if (delta < 0) { // Decreasing
            if (currentVal > -1) { // Min bonus is -1, so total stat is 0 (1 base - 1 bonus)
                setLocalRace(prev => ({ ...prev, bonuses: { ...prev.bonuses, [attr]: currentVal - 1 } }));
            }
        }
    };

    const handleClassToggle = (className: string) => {
        setLocalRace((prev: any) => {
            const availableClasses = prev.availableClasses || [];
            if (availableClasses.includes(className)) {
                return { ...prev, availableClasses: availableClasses.filter((c: string) => c !== className) };
            } else {
                return { ...prev, availableClasses: [...availableClasses, className] };
            }
        });
    };

    const handleSave = () => {
        if (!localRace.name.trim()) {
            alert(t('Race Name cannot be empty.'));
            return;
        }
        onSave({ ...localRace, attributePoints: points });
    };

    return (
        <Modal isOpen={true} onClose={onClose} title={race.originalName ? t('Edit Race') : t('Create Race')}>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('Race Name')}</label>
                    <input value={localRace.name} onChange={(e) => setLocalRace({ ...localRace, name: e.target.value })} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('Description')}</label>
                    <textarea value={localRace.description} onChange={(e) => setLocalRace({ ...localRace, description: e.target.value })} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2" rows={3} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                        {t('Attribute Bonuses')}
                        {!isPointLimitDisabled && ` (${t('Points Remaining: {points}', { points })})`}
                    </label>
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="disable-race-limit" checked={isPointLimitDisabled} onChange={(e) => setIsPointLimitDisabled(e.target.checked)} className="form-checkbox h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-600 focus:ring-cyan-500" />
                        <label htmlFor="disable-race-limit" className="text-xs text-gray-400">{t('remove_characteristic_restrictions')}</label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {CHARACTERISTICS_LIST.map(attr => (
                            <div key={attr} className="flex justify-between items-center bg-gray-800 p-2 rounded-md">
                                <span className="capitalize text-sm">{t(attr as any)}</span>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => handleAttributeChange(attr, -1)} disabled={(localRace.bonuses[attr] || 0) <= -1} className="p-1 rounded-full bg-red-600/50 hover:bg-red-500 disabled:bg-gray-600 text-white"><MinusIcon className="w-4 h-4" /></button>
                                    <span className="w-6 text-center font-mono">{1 + (localRace.bonuses[attr] || 0)}</span>
                                    <button type="button" onClick={() => handleAttributeChange(attr, 1)} disabled={!isPointLimitDisabled && points <= 0} className="p-1 rounded-full bg-green-600/50 hover:bg-green-500 disabled:bg-gray-600 text-white"><PlusIcon className="w-4 h-4" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('Available Classes')}</label>
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-gray-900/40 rounded-md">
                        {allClasses.map(className => (
                            <div key={className} className="flex items-center">
                                <input id={`class-${className}`} type="checkbox" checked={(localRace.availableClasses || []).includes(className)} onChange={() => handleClassToggle(className)} className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-600 focus:ring-cyan-500" />
                                <label htmlFor={`class-${className}`} className="ml-2 text-sm text-gray-300">{t(className as any)}</label>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 font-semibold">{t('Cancel')}</button>
                <button onClick={handleSave} className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold">{t('Save')}</button>
            </div>
        </Modal>
    );
};

// Reusable component for export UI
const ExportControls: React.FC<{
    dataType: 'races' | 'classes' | 'calendar' | 'currencies';
    customUniverses: { key: string; name: string }[];
    onExport: (dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetKey: string) => void;
}> = ({ dataType, customUniverses, onExport }) => {
    const { t } = useLocalization();
    const [exportTarget, setExportTarget] = useState('');

    if (customUniverses.length === 0) return null;

    const titleMap = {
        races: t('Export Races'),
        classes: t('Export Classes'),
        calendar: t('Export Calendar'),
        currencies: t('Export Currencies'),
    };

    return (
        <div className="mt-6 pt-4 border-t border-gray-700/50 space-y-2">
            <h4 className="text-sm font-semibold text-gray-400">{titleMap[dataType]}</h4>
            <div className="flex gap-2">
                <select
                    value={exportTarget}
                    onChange={e => setExportTarget(e.target.value)}
                    className="dark-select flex-1"
                >
                    <option value="">{t('Select target universe...')}</option>
                    {customUniverses.map(uni => (
                        <option key={uni.key} value={uni.key}>{uni.name}</option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={() => onExport(dataType, exportTarget)}
                    disabled={!exportTarget}
                    className="px-4 py-2 text-sm font-semibold text-cyan-300 bg-cyan-600/20 rounded-md hover:bg-cyan-600/40 disabled:opacity-50"
                >
                    {t('Export')}
                </button>
            </div>
        </div>
    );
};

interface RaceEditorProps {
    world: any;
    onFieldChange: (field: string, value: any) => void;
    customUniverses: { key: string; name: string }[];
    onExport: (dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetKey: string) => void;
}

// RaceEditor Component
const RaceEditor: React.FC<RaceEditorProps> = ({ world, onFieldChange, customUniverses, onExport }) => {
    const { t } = useLocalization();
    const [races, setRaces] = useState(world.races || {});
    const [editingRace, setEditingRace] = useState<any>(null);
    const [raceToDelete, setRaceToDelete] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        setRaces(world.races || {});
    }, [world.races]);

    const filteredRaces = useMemo(() => {
        return Object.keys(races).filter(raceName => t(raceName as any).toLowerCase().includes(search.toLowerCase()));
    }, [races, search, t]);

    const handleSaveRace = (race: any) => {
        const newRaces = { ...races };
        // If name was changed, we need to remove old key and add new one
        if (race.originalName && race.originalName !== race.name) {
            delete newRaces[race.originalName];
        }
        const { originalName, ...restOfRace } = race;
        newRaces[race.name] = restOfRace;

        setRaces(newRaces);
        onFieldChange('races', newRaces);
        setEditingRace(null);
    };

    const handleDeleteRace = () => {
        if (!raceToDelete) return;
        const newRaces = { ...races };
        delete newRaces[raceToDelete];
        setRaces(newRaces);
        onFieldChange('races', newRaces);
        setRaceToDelete(null);
    };

    return (
        <>
            <div className="flex justify-between items-center mb-4">
                <div className="relative">
                    <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search...')} className="bg-gray-800 border border-gray-600 rounded-md py-2 pl-10 pr-4" />
                </div>
                <button onClick={() => setEditingRace({ name: '', description: '', bonuses: CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {}), availableClasses: [] })} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-green-300 bg-green-600/10 rounded-md hover:bg-green-600/20">
                    <PlusIcon className="w-5 h-5" />{t('Add New Race')}
                </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {filteredRaces.map(raceName => (
                    <div key={raceName} className="flex items-center justify-between p-2 bg-gray-900/40 rounded-md">
                        <span className="text-gray-200">{t(raceName as any)}</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setEditingRace({ ...races[raceName], name: raceName, originalName: raceName })} className="p-1 text-cyan-400 hover:text-white"><PencilSquareIcon className="w-5 h-5" /></button>
                            <button onClick={() => setRaceToDelete(raceName)} className="p-1 text-red-400 hover:text-white"><TrashIcon className="w-5 h-5" /></button>
                        </div>
                    </div>
                ))}
            </div>
            {editingRace && <RaceEditModal race={editingRace} allClasses={Object.keys(world.classes)} onSave={handleSaveRace} onClose={() => setEditingRace(null)} />}
            <ConfirmationModal isOpen={!!raceToDelete} onClose={() => setRaceToDelete(null)} onConfirm={handleDeleteRace} title={t('Delete Race')}>
                <p>{t('Are you sure you want to delete this race?')}</p>
            </ConfirmationModal>
            <ExportControls dataType="races" customUniverses={customUniverses} onExport={onExport} />
        </>
    );
};

// ClassEditModal Component
const ClassEditModal: React.FC<{
    classData: any;
    onSave: (classData: any) => void;
    onClose: () => void;
}> = ({ classData, onSave, onClose }) => {
    const { t } = useLocalization();
    const [isPointLimitDisabled, setIsPointLimitDisabled] = useState(false);

    const [localClass, setLocalClass] = useState(() => {
        const initialBonuses = CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {});
        return {
            ...classData,
            name: classData.name ? t(classData.name as any) : '',
            description: classData.description ? t(classData.description as any) : '',
            bonuses: { ...initialBonuses, ...classData.bonuses },
        };
    });

    useEffect(() => {
        const initialBonuses = CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {});
        setLocalClass({
            ...classData,
            name: classData.name ? t(classData.name as any) : '',
            description: classData.description ? t(classData.description as any) : '',
            bonuses: { ...initialBonuses, ...classData.bonuses },
        });
    }, [classData, t]);
    
    const points = useMemo(() => {
        // FIX: Explicitly map values to numbers before reducing to ensure type safety in arithmetic operation.
        const spentPoints = Object.values(localClass.bonuses || {}).map(v => Number(v)).reduce((sum, v) => sum + v, 0);
        return 3 - spentPoints;
    }, [localClass.bonuses]);


    const handleAttributeChange = (attr: string, delta: number) => {
        const currentVal = Number(localClass.bonuses[attr] || 0);

        if (delta > 0) { // Increasing
            if (isPointLimitDisabled || points > 0) {
                setLocalClass(prev => ({ ...prev, bonuses: { ...prev.bonuses, [attr]: currentVal + 1 } }));
            }
        }
        
        if (delta < 0 && currentVal > 0) { // Decreasing, and current bonus is greater than 0
            setLocalClass(prev => ({ ...prev, bonuses: { ...prev.bonuses, [attr]: currentVal - 1 } }));
        }
    };

    const handleSave = () => {
        if (!localClass.name.trim()) {
            alert(t('Class Name cannot be empty.'));
            return;
        }
        onSave({ ...localClass, attributePoints: points });
    };

    return (
        <Modal isOpen={true} onClose={onClose} title={classData.originalName ? t('Edit Class') : t('Create Class')}>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('Class Name')}</label>
                    <input value={localClass.name} onChange={(e) => setLocalClass({ ...localClass, name: e.target.value })} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">{t('Description')}</label>
                    <textarea value={localClass.description} onChange={(e) => setLocalClass({ ...localClass, description: e.target.value })} className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2" rows={3} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                        {t('Attribute Bonuses')}
                        {!isPointLimitDisabled && ` (${t('Points Remaining: {points}', { points })})`}
                    </label>
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="disable-class-limit" checked={isPointLimitDisabled} onChange={(e) => setIsPointLimitDisabled(e.target.checked)} className="form-checkbox h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-600 focus:ring-cyan-500" />
                        <label htmlFor="disable-class-limit" className="text-xs text-gray-400">{t('remove_characteristic_restrictions')}</label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {CHARACTERISTICS_LIST.map(attr => (
                            <div key={attr} className="flex justify-between items-center bg-gray-800 p-2 rounded-md">
                                <span className="capitalize text-sm">{t(attr as any)}</span>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => handleAttributeChange(attr, -1)} disabled={(localClass.bonuses[attr] || 0) <= 0} className="p-1 rounded-full bg-red-600/50 hover:bg-red-500 disabled:bg-gray-600 text-white"><MinusIcon className="w-4 h-4" /></button>
                                    <span className="w-6 text-center font-mono">{(localClass.bonuses[attr] || 0)}</span>
                                    <button type="button" onClick={() => handleAttributeChange(attr, 1)} disabled={!isPointLimitDisabled && points <= 0} className="p-1 rounded-full bg-green-600/50 hover:bg-green-500 disabled:bg-gray-600 text-white"><PlusIcon className="w-4 h-4" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 font-semibold">{t('Cancel')}</button>
                <button onClick={handleSave} className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold">{t('Save')}</button>
            </div>
        </Modal>
    );
};

interface ClassEditorProps {
    world: any;
    onFieldChange: (field: string, value: any) => void;
    customUniverses: { key: string; name: string }[];
    onExport: (dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetKey: string) => void;
}

// ClassEditor Component
const ClassEditor: React.FC<ClassEditorProps> = ({ world, onFieldChange, customUniverses, onExport }) => {
    const { t } = useLocalization();
    const [classes, setClasses] = useState(world.classes || {});
    const [editingClass, setEditingClass] = useState<any>(null);
    const [classToDelete, setClassToDelete] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        setClasses(world.classes || {});
    }, [world.classes]);

    const filteredClasses = useMemo(() => {
        return Object.keys(classes).filter(className => t(className as any).toLowerCase().includes(search.toLowerCase()));
    }, [classes, search, t]);

    const handleSaveClass = (classData: any) => {
        const newClasses = { ...classes };
        if (classData.originalName && classData.originalName !== classData.name) {
            delete newClasses[classData.originalName];
        }
        const { originalName, ...restOfClass } = classData;
        newClasses[classData.name] = restOfClass;
        setClasses(newClasses);
        onFieldChange('classes', newClasses);
        setEditingClass(null);
    };

    const handleDeleteClass = () => {
        if (!classToDelete) return;
        const newClasses = { ...classes };
        delete newClasses[classToDelete];
        setClasses(newClasses);
        onFieldChange('classes', newClasses);
        setClassToDelete(null);
    };

    return (
        <>
            <div className="flex justify-between items-center mb-4">
                <div className="relative">
                    <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search...')} className="bg-gray-800 border border-gray-600 rounded-md py-2 pl-10 pr-4" />
                </div>
                <button onClick={() => setEditingClass({ name: '', description: '', bonuses: CHARACTERISTICS_LIST.reduce((acc, char) => ({ ...acc, [char]: 0 }), {}) })} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-green-300 bg-green-600/10 rounded-md hover:bg-green-600/20">
                    <PlusIcon className="w-5 h-5" />{t('Add New Class')}
                </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {filteredClasses.map(className => (
                    <div key={className} className="flex items-center justify-between p-2 bg-gray-900/40 rounded-md">
                        <span className="text-gray-200">{t(className as any)}</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setEditingClass({ ...classes[className], name: className, originalName: className })} className="p-1 text-cyan-400 hover:text-white"><PencilSquareIcon className="w-5 h-5" /></button>
                            <button onClick={() => setClassToDelete(className)} className="p-1 text-red-400 hover:text-white"><TrashIcon className="w-5 h-5" /></button>
                        </div>
                    </div>
                ))}
            </div>
            {editingClass && <ClassEditModal classData={editingClass} onSave={handleSaveClass} onClose={() => setEditingClass(null)} />}
            <ConfirmationModal isOpen={!!classToDelete} onClose={() => setClassToDelete(null)} onConfirm={handleDeleteClass} title={t('Delete Class')}>
                <p>{t('Are you sure you want to delete this class?')}</p>
            </ConfirmationModal>
            <ExportControls dataType="classes" customUniverses={customUniverses} onExport={onExport} />
        </>
    );
};

interface CalendarEditorProps {
    calendar: Calendar;
    onCalendarChange: (newCalendar: Calendar) => void;
    customUniverses: { key: string; name: string }[];
    onExport: (dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetKey: string) => void;
}

// CalendarEditor Component
const CalendarEditor: React.FC<CalendarEditorProps> = ({ calendar, onCalendarChange, customUniverses, onExport }) => {
    const { t } = useLocalization();
    const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
    const [expandedDay, setExpandedDay] = useState<number | null>(null);
    const [isConfirmLoadStandardCalendarOpen, setIsConfirmLoadStandardCalendarOpen] = useState(false);

    const handleConfirmLoadStandardCalendar = () => {
        onCalendarChange(standardCalendarStructure as Calendar);
        setIsConfirmLoadStandardCalendarOpen(false);
    };

    const handleFieldChange = (field: keyof Calendar, value: any) => {
        onCalendarChange({ ...calendar, [field]: value });
    };

    const handleMonthChange = (index: number, field: keyof Month, value: string | number) => {
        const newMonths = [...calendar.months];
        if(field === 'days' && typeof value === 'string') {
            value = parseInt(value, 10) || 1;
        }
        (newMonths[index] as any)[field] = value;
        handleFieldChange('months', newMonths);
    };

    const handleAddMonth = () => {
        handleFieldChange('months', [...calendar.months, { name: t('New Month'), days: 30, description: '' }]);
    };

    const handleDeleteMonth = (index: number) => {
        handleFieldChange('months', calendar.months.filter((_, i) => i !== index));
    };

    const handleDayNameChange = (index: number, field: keyof DayInfo, value: string) => {
        const newDayNames = [...calendar.dayNames];
        const oldDay = newDayNames[index];
        const dayAsObject: DayInfo = typeof oldDay === 'string' ? { name: oldDay, description: '' } : oldDay;
        
        const updatedDay: DayInfo = {
            ...dayAsObject,
            [field]: value
        };

        newDayNames[index] = updatedDay;
        handleFieldChange('dayNames', newDayNames);
    };

    const handleAddDayName = () => {
        handleFieldChange('dayNames', [...calendar.dayNames, { name: t('New Day'), description: '' }]);
    };

    const handleDeleteDayName = (index: number) => {
        const newDayNames = calendar.dayNames.filter((_, i) => i !== index);
        handleFieldChange('dayNames', newDayNames);
        handleFieldChange('daysInWeek', newDayNames.length);
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('Starting Year')}</label>
                <input
                    type="number"
                    defaultValue={calendar.startingYear}
                    key={calendar.startingYear}
                    onBlur={(e) => handleFieldChange('startingYear', parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2"
                />
            </div>

            <div>
                <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-gray-300">{t('Months of the Year')}</h4>
                    <button type="button" onClick={() => setIsConfirmLoadStandardCalendarOpen(true)} className="px-3 py-1 text-xs font-semibold rounded-md transition-colors bg-blue-600/20 text-blue-300 hover:bg-blue-600/40">
                        {t('Load Standard Calendar')}
                    </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {calendar.months.map((month, index) => (
                        <div key={index} className="bg-gray-900/40 rounded-lg border border-gray-700/50">
                            <div className="flex items-center gap-2 p-2">
                                <button type="button" onClick={() => setExpandedMonth(expandedMonth === index ? null : index)} className="p-1 text-gray-400 hover:text-white">
                                    {expandedMonth === index ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                                </button>
                                <input
                                    type="text"
                                    defaultValue={t(month.name as any)}
                                    key={`${month.name}-${index}-name`}
                                    onBlur={(e) => handleMonthChange(index, 'name', e.target.value)}
                                    placeholder={t('Month Name')}
                                    className="flex-1 bg-gray-800 border border-gray-600 rounded-md p-2 text-sm"
                                />
                                <input
                                    type="number"
                                    value={month.days}
                                    onChange={(e) => handleMonthChange(index, 'days', e.target.value)}
                                    placeholder={t('Days')}
                                    className="w-20 bg-gray-800 border border-gray-600 rounded-md p-2 text-sm"
                                />
                                <button type="button" onClick={() => handleDeleteMonth(index)} className="p-1 text-red-400 hover:text-white">
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                            </div>
                            {expandedMonth === index && (
                                <div className="p-2 border-t border-gray-700/50">
                                    <label className="block text-xs font-medium text-gray-400 mb-1">{t('Description')}</label>
                                    <textarea
                                        defaultValue={t(month.description as any) || ''}
                                        key={`${month.name}-${index}-desc`}
                                        onBlur={(e) => handleMonthChange(index, 'description', e.target.value)}
                                        rows={3}
                                        className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm"
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <button type="button" onClick={handleAddMonth} className="mt-2 flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-green-300 bg-green-600/10 rounded-md hover:bg-green-600/20">
                    <PlusIcon className="w-4 h-4" /> {t('Add Month')}
                </button>
            </div>

            <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">{t('Days of the Week')}</h4>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {calendar.dayNames.map((day, index) => {
                        const dayInfo = typeof day === 'string' ? { name: day, description: '' } : day;
                        return (
                            <div key={index} className="bg-gray-900/40 rounded-lg border border-gray-700/50">
                                <div className="flex items-center gap-2 p-2">
                                    <button type="button" onClick={() => setExpandedDay(expandedDay === index ? null : index)} className="p-1 text-gray-400 hover:text-white">
                                        {expandedDay === index ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
                                    </button>
                                    <input
                                        type="text"
                                        defaultValue={t(dayInfo.name as any)}
                                        key={`${dayInfo.name}-${index}-name`}
                                        onBlur={(e) => handleDayNameChange(index, 'name', e.target.value)}
                                        placeholder={t('Day Name')}
                                        className="flex-1 bg-gray-800 border border-gray-600 rounded-md p-2 text-sm"
                                    />
                                    <button type="button" onClick={() => handleDeleteDayName(index)} className="p-1 text-red-400 hover:text-white">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                {expandedDay === index && (
                                     <div className="p-2 border-t border-gray-700/50">
                                        <label className="block text-xs font-medium text-gray-400 mb-1">{t('Description')}</label>
                                        <textarea
                                            defaultValue={t(dayInfo.description as any) || ''}
                                            key={`${dayInfo.name}-${index}-desc`}
                                            onBlur={(e) => handleDayNameChange(index, 'description', e.target.value)}
                                            rows={3}
                                            className="w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
                 <button type="button" onClick={handleAddDayName} className="mt-2 flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-green-300 bg-green-600/10 rounded-md hover:bg-green-600/20">
                    <PlusIcon className="w-4 h-4" /> {t('Add Day')}
                </button>
            </div>
            <ExportControls dataType="calendar" customUniverses={customUniverses} onExport={onExport} />
            <ConfirmationModal
                isOpen={isConfirmLoadStandardCalendarOpen}
                onClose={() => setIsConfirmLoadStandardCalendarOpen(false)}
                onConfirm={handleConfirmLoadStandardCalendar}
                title={t('Confirm Load Standard Calendar')}
            >
                <p>{t('Are you sure you want to load the standard calendar? This will overwrite all current calendar settings.')}</p>
            </ConfirmationModal>
        </div>
    );
};

interface CurrencyEditorProps {
    world: any;
    onFieldChange: (field: string, value: any) => void;
    customUniverses: { key: string; name: string }[];
    onExport: (dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetKey: string) => void;
}

// CurrencyEditor Component
const CurrencyEditor: React.FC<CurrencyEditorProps> = ({ world, onFieldChange, customUniverses, onExport }) => {
    const { t } = useLocalization();
    const [newCurrency, setNewCurrency] = useState('');

    const currencyList = useMemo(() => {
        const options = Array.isArray(world.currencyOptions) ? world.currencyOptions : [];
        const name = world.currencyName;
        
        const currencySet = new Set(options);
        if (name) {
            currencySet.add(name);
        }
        
        return Array.from(currencySet).filter(Boolean).filter((c): c is string => typeof c === 'string');
    }, [world.currencyOptions, world.currencyName]);

    const handleAddCurrency = () => {
        const trimmedNew = newCurrency.trim();
        if (trimmedNew && !currencyList.includes(trimmedNew)) {
            const newCurrencies = [...currencyList, trimmedNew];
            onFieldChange('currencyOptions', newCurrencies);
            setNewCurrency('');
        }
    };

    const handleDeleteCurrency = (currencyToDelete: string) => {
        const newCurrencies = currencyList.filter(c => c !== currencyToDelete);
        onFieldChange('currencyOptions', newCurrencies);
        if (world.currencyName === currencyToDelete) {
            onFieldChange('currencyName', newCurrencies[0] || '');
        }
    };

    const handleSetDefault = (currency: string) => {
        onFieldChange('currencyName', currency);
    };

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('Add Currency')}</label>
                <div className="flex gap-2">
                    <input
                        value={newCurrency}
                        onChange={(e) => setNewCurrency(e.target.value)}
                        placeholder={t('Enter currency name...')}
                        className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2"
                    />
                    <button type="button" onClick={handleAddCurrency} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-green-300 bg-green-600/10 rounded-md hover:bg-green-600/20">
                        <PlusIcon className="w-4 h-4" /> {t('Add')}
                    </button>
                </div>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {currencyList.map((currency) => (
                    <div key={currency} className="flex items-center justify-between p-2 bg-gray-900/40 rounded-md">
                        <span className={`text-gray-200 ${world.currencyName === currency ? 'font-bold' : ''}`}>{t(currency as any)}</span>
                        <div className="flex items-center gap-2">
                            {world.currencyName === currency ? (
                                <StarIcon className="w-4 h-4 text-yellow-400" title={t('Default currency')} />
                            ) : (
                                <button onClick={() => handleSetDefault(currency)} className="p-1 text-gray-500 hover:text-yellow-400" title={t('Set as default')}>
                                    <StarIcon className="w-4 h-4" />
                                </button>
                            )}
                            <button onClick={() => handleDeleteCurrency(currency)} className="p-1 text-red-400 hover:text-white" title={t('Delete')}>
                                <TrashIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <ExportControls dataType="currencies" customUniverses={customUniverses} onExport={onExport} />
        </div>
    );
};

// Main UniverseCustomizer Component
export const UniverseCustomizer: React.FC<UniverseCustomizerProps> = ({ isOpen, onClose, gameDataState, onUpdateGameData, universe, selectedEra }) => {
    const { t } = useLocalization();
    const [localData, setLocalData] = useState(() => JSON.parse(JSON.stringify(gameDataState)));
    const [activeTab, setActiveTab] = useState('General');
    const [isFullScreen, setIsFullScreen] = useState(false);
    
    useEffect(() => {
        setLocalData(JSON.parse(JSON.stringify(gameDataState)));
    }, [gameDataState, isOpen]);
    
    const currentWorldData = useMemo(() => {
        if (!universe || (universe === 'custom' && !selectedEra)) {
            return null;
        }
        if (universe === 'history') {
            return localData.history[selectedEra as keyof typeof localData.history];
        }
        if (universe === 'myths') {
            return localData.myths[selectedEra as keyof typeof localData.myths];
        }
        if (universe === 'custom') {
            return (localData.custom as Record<string, any>)[selectedEra];
        }
        return (localData as any)[universe];
    }, [localData, universe, selectedEra]);
    
    const [localWorldName, setLocalWorldName] = useState('');
    const [localWorldDescription, setLocalWorldDescription] = useState('');

    useEffect(() => {
        if (currentWorldData) {
            setLocalWorldName(t(currentWorldData.name as string));
            setLocalWorldDescription(t(currentWorldData.description as string));
        }
    }, [currentWorldData, t, isOpen]);

    const customUniverses = useMemo(() => {
        const currentKey = universe === 'custom' ? selectedEra : universe;
        return Object.entries(localData.custom || {})
            .map(([key, world]: [string, any]) => ({ key, name: world.name }))
            .filter(uni => uni.key !== currentKey);
    }, [localData.custom, universe, selectedEra]);

    const handleExport = useCallback((dataType: 'races' | 'classes' | 'calendar' | 'currencies', targetUniverseKey: string) => {
        if (!targetUniverseKey || !currentWorldData) {
            alert(t('No target selected or source data missing.'));
            return;
        }

        const sourceData = {
            races: currentWorldData.races,
            classes: currentWorldData.classes,
            calendar: currentWorldData.calendar,
            currencies: {
                currencyName: currentWorldData.currencyName,
                currencyOptions: currentWorldData.currencyOptions,
            }
        };

        const newLocalData = JSON.parse(JSON.stringify(localData));
        const targetWorld = (newLocalData.custom as Record<string, any>)[targetUniverseKey];
        if (!targetWorld) {
            alert(t('Target universe not found.'));
            return;
        }

        let exportedItemName = '';
        const deepCopy = (obj: any) => JSON.parse(JSON.stringify(obj));

        if (dataType === 'races') {
            targetWorld.races = deepCopy(sourceData.races);
            exportedItemName = t('Races');
        } else if (dataType === 'classes') {
            targetWorld.classes = deepCopy(sourceData.classes);
            exportedItemName = t('Classes');
        } else if (dataType === 'calendar') {
            targetWorld.calendar = deepCopy(sourceData.calendar);
            exportedItemName = t('Calendar');
        } else if (dataType === 'currencies') {
            targetWorld.currencyName = sourceData.currencies.currencyName;
            targetWorld.currencyOptions = deepCopy(sourceData.currencies.currencyOptions);
            exportedItemName = t('Currencies');
        }

        setLocalData(newLocalData);
        alert(t('{itemName} exported to {universeName}.', { itemName: exportedItemName, universeName: targetWorld.name }));

    }, [localData, currentWorldData, t]);

    const handleSave = () => {
        onUpdateGameData(localData);
        onClose();
    };
    
    const handleFieldChange = (field: string, value: any) => {
        setLocalData((prev: typeof gameData) => {
            const newData = JSON.parse(JSON.stringify(prev));
            let world;
            if (universe === 'history') world = newData.history[selectedEra as keyof typeof newData.history];
            else if (universe === 'myths') world = newData.myths[selectedEra as keyof typeof newData.myths];
            else if (universe === 'custom') world = (newData.custom as any)[selectedEra];
            else world = newData[universe as keyof typeof newData];
            if (world) {
                (world as any)[field] = value;
            }
            return newData;
        });
    };

    if (!isOpen) return null;

    if (!currentWorldData) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={t('World Customizer')}>
                <div className="text-center p-8 text-gray-400">
                    <p>{t('Please select a specific universe to customize.')}</p>
                </div>
            </Modal>
        );
    }
    
    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title={t('World Customizer')} 
            size={isFullScreen ? "fullscreen" : "default"}
            closeOnOverlayClick={false}
            onToggleFullScreen={() => setIsFullScreen(p => !p)}
            isFullScreen={isFullScreen}
        >
            <div className="flex border-b border-gray-700/60 mb-4">
                {['General', 'Calendar', 'Races', 'Classes', 'Currencies'].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-semibold transition-colors border-b-2 ${activeTab === tab ? 'border-cyan-400 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}>{t(tab as any)}</button>
                ))}
            </div>

            <div className="flex-1 flex flex-col min-h-0 space-y-4 max-h-[60vh] overflow-y-auto pr-2 -mr-2">
                {activeTab === 'General' && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">{t('Universe Name')}</label>
                            <input 
                                value={localWorldName} 
                                onChange={(e) => setLocalWorldName(e.target.value)} 
                                onBlur={() => handleFieldChange('name', localWorldName)}
                                className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">{t('Universe Description')}</label>
                            <textarea 
                                value={localWorldDescription} 
                                onChange={(e) => setLocalWorldDescription(e.target.value)}
                                onBlur={() => handleFieldChange('description', localWorldDescription)}
                                className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2" 
                                rows={5}
                            />
                        </div>
                    </div>
                )}
                {activeTab === 'Calendar' && currentWorldData.calendar && (
                    <CalendarEditor calendar={currentWorldData.calendar} onCalendarChange={(newCal) => handleFieldChange('calendar', newCal)} customUniverses={customUniverses} onExport={handleExport} />
                )}
                {activeTab === 'Races' && <RaceEditor world={currentWorldData} onFieldChange={handleFieldChange} customUniverses={customUniverses} onExport={handleExport} />}
                {activeTab === 'Classes' && <ClassEditor world={currentWorldData} onFieldChange={handleFieldChange} customUniverses={customUniverses} onExport={handleExport} />}
                {activeTab === 'Currencies' && <CurrencyEditor world={currentWorldData} onFieldChange={handleFieldChange} customUniverses={customUniverses} onExport={handleExport} />}
            </div>
            <div className="mt-6 flex justify-end">
                <button onClick={handleSave} className="px-6 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center gap-2"><CheckIcon className="w-5 h-5"/>{t('Save & Close')}</button>
            </div>
        </Modal>
    );
};
