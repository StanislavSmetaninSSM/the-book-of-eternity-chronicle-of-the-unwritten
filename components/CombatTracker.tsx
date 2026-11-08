
import React, { useState, useMemo, useCallback } from 'react';
import { EnemyCombatObject, AllyCombatObject, NPC, PlayerCharacter, GameSettings, ImageCacheEntry, DetailData} from '../types';
import { ShieldExclamationIcon, BoltIcon, ShieldCheckIcon, SunIcon, CloudIcon, DocumentTextIcon, ArchiveBoxIcon, Cog6ToothIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import { FireIcon } from '@heroicons/react/24/solid';
import ImageRenderer from './ImageRenderer';
import { useLocalization } from '../context/LocalizationContext';
import MarkdownRenderer from './MarkdownRenderer';
import { generateEffectDescription } from './DetailRenderer/utils';
import { isEncumbered } from '../utils/carryWeight.js';
import { assessCombat, auditCombatLog } from '../utils/combatAssessment.js';
import { assessEffects } from '../utils/effectAssessment.js';
import { assessWoundProgress } from '../utils/worldAssessment.js';
import { assessCooldowns } from '../utils/combatCooldowns.js';
import WorldStateNotes from './WorldStateNotes';

type Combatant = EnemyCombatObject | AllyCombatObject;

const Section: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
    <div className="mt-4">
        <h5 className="text-sm font-semibold text-cyan-300/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Icon className="w-4 h-4" />
            {title}
        </h5>
        <div className="space-y-2 pl-1">{children}</div>
    </div>
);

const qualityColorMap: Record<string, string> = {
    'Trash': 'text-gray-500 border-gray-700',
    'Common': 'text-gray-300 border-gray-500',
    'Uncommon': 'text-green-400 border-green-700/80',
    'Good': 'text-blue-400 border-blue-700/80',
    'Rare': 'text-indigo-400 border-indigo-700/80',
    'Epic': 'text-purple-400 border-purple-700/80',
    'Legendary': 'text-orange-400 border-orange-700/80',
    'Unique': 'text-yellow-400 border-yellow-600/80',
};

const HealthGrid: React.FC<{ healthStates: string[], maxHealth: string }> = ({ healthStates, maxHealth }) => {
    const max = parseInt(maxHealth);
    if (isNaN(max) || max === 0) return null;

    return (
        <div className="grid grid-cols-10 gap-1 mt-2">
            {healthStates.map((healthStr, i) => {
                const current = parseInt(healthStr);
                const percentage = (current / max) * 100;
                let colorClass = 'bg-green-500';
                if (percentage < 35) colorClass = 'bg-red-500';
                else if (percentage < 75) colorClass = 'bg-yellow-500';

                return (
                    <div key={i} className="w-full h-2 bg-gray-700 rounded-sm" title={`${current}/${max}`}>
                        <div className={`h-full rounded-sm ${colorClass}`} style={{ width: `${percentage}%` }}></div>
                    </div>
                );
            })}
        </div>
    );
};


interface CombatantCardProps {
    combatant: Combatant;
    fullNpcData: NPC | null;
    onOpenDetailModal: (title: string, data: DetailData) => void;
    onViewCharacterSheet: (character: PlayerCharacter | NPC) => void;
    imageCache: Record<string, ImageCacheEntry>;
    onImageGenerated: (prompt: string, src: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => void;
    onOpenImageModal: (displayPrompt: string, originalTextPrompt: string, onClearCustom?: () => void, onUpload?: (base64: string) => void, pendingPrompt?: string | null, onAcceptPending?: () => void) => void;
    gameSettings: GameSettings | null;
    editNpcData?: (npcId: string, field: keyof NPC, value: unknown) => void;
}


const CombatantCard: React.FC<CombatantCardProps> = ({ combatant, fullNpcData, onOpenDetailModal, onViewCharacterSheet, imageCache, onImageGenerated, onOpenImageModal, gameSettings, editNpcData }) => {
    const isGroup = combatant.isGroup;
    const isDefeated = isGroup ? (combatant.count ?? 0) <= 0 : parseInt(combatant.currentHealth ?? '0') <= 0;
    
    const { t } = useLocalization();

    const handleCardClick = useCallback(() => {
        if (fullNpcData) {
            onViewCharacterSheet(fullNpcData);
        }
    }, [fullNpcData, onViewCharacterSheet]);

    const displayImagePrompt = useMemo(() => {
        if (fullNpcData) {
            return fullNpcData.custom_image_prompt || fullNpcData.image_prompt;
        }
        return combatant.image_prompt;
    }, [fullNpcData, combatant.image_prompt]);

    const originalImagePrompt = useMemo(() => {
        return fullNpcData?.image_prompt || combatant.image_prompt;
    }, [fullNpcData, combatant.image_prompt]);

    const handleOpenImageWithCallbacks = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!displayImagePrompt || !originalImagePrompt) return;
    
        let onClearCustom: (() => void) | undefined;
        let onUpload: ((base64: string) => void) | undefined;
    
        if (fullNpcData && editNpcData) {
            onClearCustom = () => editNpcData(fullNpcData.NPCId, 'custom_image_prompt', null);
            onUpload = (base64: string) => editNpcData(fullNpcData.NPCId, 'custom_image_prompt', base64);
        }
    
        onOpenImageModal(displayImagePrompt, originalImagePrompt, onClearCustom, onUpload);
    }, [displayImagePrompt, originalImagePrompt, fullNpcData, editNpcData, onOpenImageModal]);

    const level = useMemo(() => {
        if (fullNpcData && fullNpcData.level !== undefined) {
            return fullNpcData.level;
        }
    
        let maxHealth = parseInt(combatant.maxHealth ?? '0');
        if (isNaN(maxHealth) || maxHealth === 0) return null;
        
        const isHardMode = gameSettings?.hardMode ?? false;
        if (isHardMode) {
            const isNpc = !!fullNpcData;
            const multiplier = isNpc ? 1.5 : 1.75;
            maxHealth = maxHealth / multiplier;
        }
    
        let el: number | null = null;
        // This is the correct reverse-engineered formula for Effective Level (EL)
        // based on the GM's generation logic.
        switch (combatant.type) {
            case 'Frail':
                el = (maxHealth - 50) / 0.6;
                break;
            case 'Weak':
                el = (maxHealth - 80) / 1.2;
                break;
            case 'Moderate':
                el = (maxHealth - 100) / 2;
                break;
            case 'Strong':
                el = (maxHealth - 150) / 3.5;
                break;
            case 'Boss':
                el = (maxHealth - 200) / 5;
                break;
            default:
                // Fallback for unknown types if any
                return null;
        }
    
        if (el === null || isNaN(el)) return null;

        // The final level is rounded to the nearest whole number and cannot be less than 1.
        return Math.max(1, Math.round(el));
    }, [combatant, fullNpcData, gameSettings]);
    
    const { passiveSkills, hasPassiveSkills, inventory, hasInventory, actions } = useMemo(() => {
        const combatActions = combatant.actions || [];
        const finalPassiveSkills = fullNpcData?.passiveSkills || [];
        const finalInventory = fullNpcData?.inventory || [];

        return {
            actions: combatActions,
            hasActions: combatActions.length > 0,
            passiveSkills: finalPassiveSkills,
            hasPassiveSkills: finalPassiveSkills.length > 0,
            inventory: finalInventory,
            hasInventory: finalInventory.length > 0,
        };
    }, [combatant, fullNpcData]);
    
    const woundsToDisplay = useMemo(() => {
        const allWounds = fullNpcData?.wounds || combatant.wounds || [];
        return allWounds.filter(w => !w.healingState || w.healingState.currentState !== 'Healed');
    }, [fullNpcData, combatant.wounds]);
    const hasWounds = woundsToDisplay.length > 0;
    // The card is where a fighter's own buffs, debuffs and open wounds are listed, so the reading is
    // done here and over these exact arrays - the summary has nothing of its own to contradict.
    const allWounds = fullNpcData?.wounds || combatant.wounds || [];
    const combatantNotes = [
        ...assessEffects({
            characters: [
                { name: combatant.name || '?', effects: combatant.activeBuffs, wounds: allWounds },
                { name: combatant.name || '?', effects: combatant.activeDebuffs, wounds: allWounds },
            ],
        }).notes,
        ...assessWoundProgress(woundsToDisplay, combatant.name || '?').notes,
        // The cooldown the client counts belongs to this fighter, so this card is where it is read.
        ...assessCooldowns(combatant.cooldowns, combatant.name || '?').notes,
    ];

    const TABS = useMemo(() => {
        const tabs: string[] = ['Actions', 'CombatantStats'];
        if (hasPassiveSkills) tabs.push('Skills');
        if (hasInventory) tabs.push('Inventory');
        return tabs;
    }, [hasPassiveSkills, hasInventory]);

    const [activeTab, setActiveTab] = useState(TABS[0] || 'CombatantStats');

    return (
        <div 
            className={`bg-gray-900/40 rounded-lg p-3 border border-gray-700/50 transition-all ${isDefeated ? 'opacity-50' : ''} ${fullNpcData ? 'cursor-pointer hover:border-cyan-400/50' : ''}`}
            onClick={handleCardClick}
            title={fullNpcData ? t('View Full NPC Details') : ''}
        >
            <div className="flex justify-between items-start gap-3">
                 <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0 bg-gray-800 cursor-pointer" onClick={handleOpenImageWithCallbacks}>
                    <ImageRenderer prompt={displayImagePrompt} originalTextPrompt={originalImagePrompt} alt={combatant.name} imageCache={imageCache} onImageGenerated={onImageGenerated} width={1024} height={1024} gameSettings={gameSettings} />
                </div>
                <div className="flex-1">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="flex items-baseline gap-2">
                                <h4 className={`font-bold text-lg ${isDefeated ? 'text-gray-500 line-through' : 'text-white'}`}>{combatant.name}</h4>
                                {fullNpcData && isEncumbered(fullNpcData.maxWeight, fullNpcData.totalWeight) && (
                                    <span
                                        className="text-sm font-mono px-2 py-0.5 rounded-full bg-red-500/20 text-red-300"
                                        title={t('overloaded_hint', { max: `${fullNpcData.maxWeight} ${t('kg_short')}` })}
                                    >
                                        {t('overloaded_badge')}
                                    </span>
                                )}
                                {level !== null && !isDefeated && (
                                    fullNpcData ? (
                                        <span className="text-sm font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
                                            {t('Lvl {level}', { level })}
                                        </span>
                                    ) : (
                                        <span 
                                            className="text-sm font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 cursor-help" 
                                            title={t('effectiveLevelTooltip')}
                                        >
                                            {t('Threat {level}', { level })}
                                        </span>
                                    )
                                )}
                            </div>
                             {isGroup ? (
                                <p className="text-xs text-gray-400 uppercase tracking-wider">{t('{count}x {unitName} ({type})', { count: combatant.count || 0, unitName: t(combatant.unitName), type: t(combatant.type) })}</p>
                            ) : (
                                <p className="text-xs text-gray-400 uppercase tracking-wider">{t(combatant.type)}</p>
                            )}
                        </div>
                        {isDefeated && <span className="text-xs bg-red-900/50 text-red-400 px-2 py-1 rounded-full font-bold">{t('DEFEATED')}</span>}
                    </div>
                    
                    {combatant.description && (
                         <div className="text-sm text-gray-400 italic my-2 pr-2 max-h-24 overflow-y-auto">
                            <MarkdownRenderer content={combatant.description} />
                        </div>
                    )}
                    
                    {isGroup && combatant.healthStates && combatant.maxHealth ? (
                        <HealthGrid healthStates={combatant.healthStates} maxHealth={combatant.maxHealth} />
                    ) : combatant.currentHealth !== null ? (
                        <div className="mt-2">
                             <div className="flex justify-between text-xs text-gray-300 mb-1">
                                <span>HP</span>
                                <span>{combatant.currentHealth} / {combatant.maxHealth}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-3">
                                {(() => {
                                    const percentage = (parseInt(combatant.currentHealth) / parseInt(combatant.maxHealth)) * 100;
                                    let colorClass = 'bg-green-500';
                                    if (percentage < 35) colorClass = 'bg-red-500';
                                    else if (percentage < 75) colorClass = 'bg-yellow-500';
                                    return <div className={`${colorClass} h-3 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
                                })()}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
            {combatantNotes.length > 0 && (
                <WorldStateNotes notes={combatantNotes} compact className="mt-2 pt-2 border-t border-amber-500/20" />
            )}
            
            {TABS.length > 1 && (
                <div className="flex space-x-1 rounded-lg bg-gray-900/50 p-1 mt-3">
                {TABS.map(tab => (
                    <button 
                        key={tab}
                        onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
                        className={`w-full rounded-md py-2 text-xs font-medium leading-5 transition flex items-center justify-center gap-1.5 ${activeTab === tab ? 'bg-gray-700 text-cyan-400 shadow' : 'text-gray-300 hover:bg-gray-700/50'}`}
                    >
                        {t(tab)}
                    </button>
                ))}
                </div>
            )}

            <div className="mt-2">
                {activeTab === 'Actions' && (
                    <Section title={t('Actions')} icon={BoltIcon}>
                        {(actions ?? []).map((action, i) => (
                             <button 
                                key={i} 
                                onClick={(e) => { e.stopPropagation(); onOpenDetailModal(t("Combat Action: {name}", { name: action.actionName }), action); }}
                                className="w-full text-left text-xs bg-gray-800/60 p-2 rounded hover:bg-gray-700/80 transition-colors"
                            >
                                <p className="font-semibold text-gray-200">{action.actionName}</p>
                                {(action.effects ?? []).map((e, idx) => (
                                    <p key={idx} className="text-gray-400 italic">{generateEffectDescription(e, t)}</p>
                                ))}
                            </button>
                        ))}
                    </Section>
                )}

                {activeTab === 'CombatantStats' && (
                    <>
                        {(combatant.resistances ?? []).length > 0 && (
                            <Section title={t('Resistances')} icon={ShieldCheckIcon}>
                                <div className="grid grid-cols-2 gap-1 text-xs">
                                    {(combatant.resistances ?? []).map((res, i) => (
                                        <div key={i} className="bg-gray-800/60 p-1.5 rounded flex justify-between items-center">
                                            <span className="text-gray-300">{res.resistTypeDisplayName || t(res.resistType)}</span>
                                            <span className={`font-mono font-semibold ${parseInt(res.resistanceValue ?? '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>{res.resistanceValue}</span>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {hasWounds && (
                             <Section title={t('Wounds')} icon={ShieldExclamationIcon}>
                                {woundsToDisplay.map((wound, index) => (
                                    <button key={wound.woundId || index} onClick={(e) => { e.stopPropagation(); onOpenDetailModal(t("Wound: {name}", { name: wound.woundName }), wound); }} className="w-full text-left bg-gray-900/60 p-3 rounded-md border border-red-800/50 flex items-start gap-3 hover:border-red-600 transition-colors">
                                        <ShieldExclamationIcon className="w-5 h-5 mt-0.5 text-red-500 flex-shrink-0" />
                                        <div className="flex-1">
                                            <div className="flex justify-between items-baseline">
                                                 <span className="font-semibold text-red-400">{wound.woundName}</span>
                                                 <span className="text-xs text-red-500 bg-red-900/50 px-2 py-0.5 rounded-full">{t(wound.severity)}</span>
                                            </div>
                                             <p className="text-sm text-gray-400 italic mt-1 line-clamp-2">{wound.descriptionOfEffects}</p>
                                        </div>
                                    </button>
                                ))}
                            </Section>
                        )}

                        {(combatant.activeBuffs ?? []).length > 0 && (
                            <Section title={t('Buffs')} icon={SunIcon}>
                                {(combatant.activeBuffs ?? []).map((buff, i) => (
                                    <div key={i} className="text-xs bg-green-900/30 p-2 rounded text-green-300">
                                        {buff.description}
                                    </div>
                                ))}
                            </Section>
                        )}
                        
                        {(combatant.activeDebuffs ?? []).length > 0 && (
                            <Section title={t('Debuffs')} icon={CloudIcon}>
                                {(combatant.activeDebuffs ?? []).map((debuff, i) => (
                                    <div key={i} className="text-xs bg-red-900/30 p-2 rounded text-red-300">
                                        {debuff.description}
                                    </div>
                                ))}
                            </Section>
                        )}
                    </>
                )}

                {activeTab === 'Skills' && (
                    <Section title={t('Skills')} icon={ShieldCheckIcon}>
                        {(passiveSkills ?? []).map((skill, i) => (
                            <button key={i} onClick={(e) => { e.stopPropagation(); onOpenDetailModal(t("Passive Skill: {name}", { name: skill.skillName }), skill); }} className="w-full text-left bg-gray-800/60 p-2 rounded hover:bg-gray-700/80 transition-colors">
                                <p className="font-semibold text-gray-200">{skill.skillName}</p>
                                <p className="text-xs text-gray-400 italic line-clamp-2">{skill.skillDescription}</p>
                            </button>
                        ))}
                    </Section>
                )}
                 
                {activeTab === 'Inventory' && (
                    <Section title={t('Inventory')} icon={ArchiveBoxIcon}>
                        {(inventory ?? []).length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {(inventory ?? []).map((item, i) => (
                                    <button key={item.existedId || i} onClick={(e) => { e.stopPropagation(); onOpenDetailModal(t("Item: {name}", { name: item.name }), item); }} className={`w-full text-left p-2 rounded-md border-l-4 ${qualityColorMap[item.quality] || 'border-gray-500'} bg-gray-800/60 shadow-sm hover:bg-gray-700/80 hover:border-cyan-400 transition-colors`}>
                                        <span className={`font-semibold text-xs ${qualityColorMap[item.quality]?.split(' ')[0] || 'text-gray-200'}`}>
                                            {item.name} {item.count > 1 ? `(x${item.count})` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 text-center p-4">{t('No items in inventory.')}</p>
                        )}
                    </Section>
                )}
            </div>
        </div>
    );
};

interface CombatTrackerProps {
    enemies: EnemyCombatObject[];
    allies: AllyCombatObject[];
    combatLog: string[];
    gameLog: string[];
    allNpcs: NPC[];
    playerCharacter: PlayerCharacter;
    setAutoCombatSkill: (skillName: string | null) => void;
    onOpenDetailModal: (title: string, data: DetailData) => void;
    onViewCharacterSheet: (character: PlayerCharacter | NPC) => void;
    onSendMessage: (message: string) => void;
    isLoading: boolean;
    imageCache: Record<string, ImageCacheEntry>;
    onImageGenerated: (prompt: string, src: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => void;
    onOpenImageModal: (displayPrompt: string, originalTextPrompt: string, onClearCustom?: () => void, onUpload?: (base64: string) => void, pendingPrompt?: string | null, onAcceptPending?: () => void) => void;
    onExpand?: () => void;
    isFullScreen?: boolean;
    onCollapse?: () => void;
    gameSettings: GameSettings | null;
    editNpcData?: (npcId: string, field: keyof NPC, value: unknown) => void;
}

export default function CombatTracker({ enemies, allies, combatLog, gameLog, allNpcs, playerCharacter, setAutoCombatSkill, onOpenDetailModal, onViewCharacterSheet, onSendMessage, isLoading, imageCache, onImageGenerated, onOpenImageModal, gameSettings, onExpand, isFullScreen, onCollapse, editNpcData }: CombatTrackerProps): React.ReactNode {
    const { t } = useLocalization();
    const hasCombatants = (enemies && enemies.length > 0) || (allies && allies.length > 0);
    const hasLog = combatLog && combatLog.length > 0;

    // #28.1.3 forbids calculations and dice rolls in these entries, so each one is read back for
    // exactly those two shapes - the wording of an entry is nobody's business here.
    const logNotes = useMemo(() => auditCombatLog(combatLog || []), [combatLog]);
    const hasContent = hasCombatants || hasLog;

    // Read back from the state: who of the listed participants can still stand, how much of them
    // is left, and whether the numbers of the turn fit together. Nothing here decides anything -
    // a line is shown only when a stated number contradicts another stated number.
    const assessment = useMemo(() => assessCombat({
        enemies: enemies || [], allies: allies || [], npcs: allNpcs || [], player: playerCharacter || null,
        // The rules make the game master log its arithmetic into the game log; only the tail of it
        // belongs to the fight the panel is describing.
        calculationLines: (gameLog || []).slice(-40),
    }), [enemies, allies, allNpcs, playerCharacter, gameLog]);
    const healthOf = (percent: number | null) => (percent === null ? t('combat_summary_unknown_health') : `${percent}%`);
    const sideOf = (label: string, side: { total: number; standing: number; wounds: number; effects: number; healthPercent: number | null }) => (
        <p>
            <span className="text-gray-400">{label}</span>{' '}
            {t('combat_summary_side', {
                alive: side.standing, total: side.total, health: healthOf(side.healthPercent),
                wounds: side.wounds, effects: side.effects,
            })}
        </p>
    );

    const combatSkills = useMemo(() => {
        if (!playerCharacter) return [];
        return playerCharacter.activeSkills.filter(
            skill => !!skill.combatEffect && (skill.combatEffect.isActivatedEffect === undefined || skill.combatEffect.isActivatedEffect === true)
        );
    }, [playerCharacter]);

    const handleAttack = (enemy: EnemyCombatObject) => {
        if (isLoading) return;
        // The command travels to the game master, so it must follow the UI language.
        const target = `${enemy.name}${enemy.NPCId ? ` (${enemy.NPCId})` : ''}`;
        onSendMessage(t('attack_command', { name: target }).trim());
    };

    if (!hasContent) {
        return (
            <div className="text-center text-gray-500 p-6 flex flex-col items-center justify-center h-full">
                <ShieldExclamationIcon className="w-12 h-12 text-gray-600 mb-4" />
                <p className="font-semibold">{t('Not in Combat')}</p>
                <p className="text-sm mt-1">{t('When a battle begins, details on enemies and allies will appear here.')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {isFullScreen && onCollapse && (
                <div className="flex justify-end">
                    <button onClick={onCollapse} className="p-2 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white" title={t('Collapse Combat View')}>
                        <ArrowsPointingInIcon className="w-6 h-6" />
                    </button>
                </div>
            )}
            {hasCombatants && playerCharacter && (
                 <div>
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-xl font-bold text-cyan-400 narrative-text flex items-center gap-2">
                            <Cog6ToothIcon className="w-6 h-6" />
                            {t('Auto-Combat Skill')}
                        </h3>
                        {!isFullScreen && onExpand && (
                            <button onClick={onExpand} className="p-2 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white" title={t('Expand Combat View')}>
                                <ArrowsPointingOutIcon className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                    <div className="bg-gray-900/40 p-3 rounded-lg">
                        <label htmlFor="auto-combat-select" className="block text-sm text-gray-400 mb-2">
                            {t('Select a skill to use for general attack commands.')}
                        </label>
                        <select
                            id="auto-combat-select"
                            value={playerCharacter?.autoCombatSkill || ''}
                            onChange={(e) => setAutoCombatSkill(e.target.value || null)}
                            className="w-full bg-gray-700/50 border border-gray-600 rounded-md py-2 px-3 text-gray-200 focus:ring-1 focus:ring-cyan-500 transition"
                        >
                            <option value="">{t('None (Basic Attack)')}</option>
                            {combatSkills.map(skill => (
                                <option key={skill.skillName} value={skill.skillName}>
                                    {skill.skillName}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            )}
            {(hasCombatants || assessment.issues.length > 0) && (
                <div data-testid="combat-summary" className="bg-gray-900/40 p-3 rounded-lg border border-gray-700/50">
                    <h4 className="text-sm font-semibold text-cyan-300/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <ShieldCheckIcon className="w-4 h-4" />
                        {t('Combat Summary')}
                        {!isFullScreen && onExpand && (
                            <button onClick={onExpand} className="ml-auto p-1 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white" title={t('Expand Combat View')}>
                                <ArrowsPointingOutIcon className="w-4 h-4" />
                            </button>
                        )}
                    </h4>
                    <div className="space-y-1 text-sm text-gray-300">
                        {assessment.enemies.total > 0 && sideOf(`${t('Enemies')}:`, assessment.enemies)}
                        {assessment.allies.total > 0 && sideOf(`${t('Allies')}:`, assessment.allies)}
                        {assessment.player && (
                            <p>
                                {t('combat_summary_you', {
                                    health: healthOf(assessment.player.healthPercent),
                                    wounds: assessment.player.wounds,
                                    effects: assessment.player.effects,
                                })}
                                {assessment.player.overloaded && <span className="text-red-400"> · {t('combat_summary_overloaded')}</span>}
                            </p>
                        )}
                        {assessment.issues.map((issue, index) => (
                            <p key={`${issue.subject}-${issue.kind}-${index}`} className="text-amber-300">
                                {t(`combat_summary_issue_${issue.kind}`, {
                                    subject: issue.subject,
                                    health: issue.health, max: issue.max,
                                    count: issue.count, units: issue.units,
                                })}
                            </p>
                        ))}
                        <p className={assessment.calculations.failures.length > 0 ? 'text-amber-300' : 'text-gray-400'}>
                            {assessment.calculations.checked > 0
                                ? (assessment.calculations.failures.length > 0
                                    ? t('combat_summary_checks_failed', { failed: assessment.calculations.failures.length, checked: assessment.calculations.checked })
                                    : t('combat_summary_checks', { checked: assessment.calculations.checked }))
                                : t('combat_summary_checks_none')}
                        </p>
                        {assessment.calculations.failures.slice(0, 3).map((failure, index) => (
                            <p key={`${failure.line}-${index}`} className="text-amber-300/90 font-mono text-xs leading-snug">
                                {failure.line} · {failure.claimed} ≠ {failure.computed}
                            </p>
                        ))}
                    </div>
                </div>
            )}
            {enemies && enemies.length > 0 && (
                <div>
                    <h3 className="text-xl font-bold text-red-400 mb-3 narrative-text">{t('Enemies')}</h3>
                    <div className="space-y-3">
                        {(enemies ?? []).map((enemy, index) => {
                            const isDefeated = enemy.isGroup ? (enemy.count ?? 0) <= 0 : parseInt(enemy.currentHealth ?? '0') <= 0;
                            const combatantWithId = enemy as (EnemyCombatObject | AllyCombatObject);
                            let fullNpcData: NPC | null = null;
                            if (combatantWithId.NPCId) {
                                fullNpcData = allNpcs.find(npc => npc.NPCId === combatantWithId.NPCId) || null;
                            }
                            if (!fullNpcData && enemy.name) {
                                fullNpcData = allNpcs.find(npc => npc.name === enemy.name) || null;
                            }

                            return (
                                <div key={enemy.NPCId || `enemy-${index}`} className="flex items-start gap-2 group">
                                    <div className="flex-1">
                                        <CombatantCard combatant={enemy} fullNpcData={fullNpcData} onOpenDetailModal={onOpenDetailModal} onViewCharacterSheet={onViewCharacterSheet} imageCache={imageCache} onImageGenerated={onImageGenerated} onOpenImageModal={onOpenImageModal} gameSettings={gameSettings} editNpcData={editNpcData} />
                                    </div>
                                    {!isDefeated && (
                                        <button
                                            onClick={() => handleAttack(enemy)}
                                            disabled={isLoading}
                                            className="p-2 mt-1 rounded-full bg-red-900/50 text-red-300 hover:bg-red-800/80 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-900/50"
                                            title={`${t('Attack')} ${enemy.name}`}
                                        >
                                            <FireIcon className="w-5 h-5" />
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
            {allies && allies.length > 0 && (
                <div>
                    <h3 className="text-xl font-bold text-green-400 mt-6 mb-3 narrative-text">{t('Allies')}</h3>
                    <div className="space-y-3">
                        {(allies ?? []).map((ally, index) => {
                             const combatantWithId = ally as (EnemyCombatObject | AllyCombatObject);
                             let fullNpcData: NPC | null = null;
                             if (combatantWithId.NPCId) {
                                 fullNpcData = allNpcs.find(npc => npc.NPCId === combatantWithId.NPCId) || null;
                             }
                             if (!fullNpcData && ally.name) {
                                 fullNpcData = allNpcs.find(npc => npc.name === ally.name) || null;
                             }
                            return <CombatantCard key={ally.NPCId || `ally-${index}`} combatant={ally} fullNpcData={fullNpcData} onOpenDetailModal={onOpenDetailModal} onViewCharacterSheet={onViewCharacterSheet} imageCache={imageCache} onImageGenerated={onImageGenerated} onOpenImageModal={onOpenImageModal} gameSettings={gameSettings} editNpcData={editNpcData} />
                        })}
                    </div>
                </div>
            )}
            {hasLog && (
                 <div>
                    <h3 className="text-xl font-bold text-cyan-400 mt-6 mb-3 narrative-text flex items-center gap-2">
                        <DocumentTextIcon className="w-6 h-6" />
                        {t('Combat Log')}
                    </h3>
                    <div className="space-y-2 bg-gray-900/50 p-3 rounded-lg max-h-60 overflow-y-auto">
                        {(combatLog ?? []).map((entry, index) => (
                            <div key={index} className="text-sm text-gray-300 font-mono leading-snug">
                                <MarkdownRenderer content={entry} className="prose-sm" />
                                {/* The verdict sits under the entry it is about, never in a bar above the list. */}
                                {logNotes.byIndex[index]?.length ? (
                                    <WorldStateNotes notes={logNotes.byIndex[index]} compact className="mt-1" />
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
