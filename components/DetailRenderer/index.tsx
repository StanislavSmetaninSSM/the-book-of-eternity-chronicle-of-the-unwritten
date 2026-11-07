
import React, { useState } from 'react';
import { Item, Quest, NPC, Location, PlayerCharacter, CombatAction, Faction, CustomState, PassiveSkill, ActiveSkill, Effect, Wound, WorldEvent } from '../../types';
import { DetailRendererProps } from './types';
import ConfirmationModal from '../ConfirmationModal';
import { useLocalization } from '../../context/LocalizationContext';

// Import all the new renderer components
import ItemDetailsRenderer from './ItemDetailsRenderer';
import QuestDetailsRenderer from './QuestDetailsRenderer';
import ActiveSkillDetailsRenderer from './ActiveSkillDetailsRenderer';
import PassiveSkillDetailsRenderer from './PassiveSkillDetailsRenderer';
import EffectDetailsRenderer from './EffectDetailsRenderer';
import WoundDetailsRenderer from './WoundDetailsRenderer';
import CharacteristicDetailsRenderer from './CharacteristicDetailsRenderer';
import PrimaryStatDetailsRenderer from './PrimaryStatDetailsRenderer';
import DerivedStatDetailsRenderer from './DerivedStatDetailsRenderer';
import LocationDetailsRenderer from './LocationDetailsRenderer';
import CombatActionDetails from './Shared/CombatActionDetails';
import Section from './Shared/Section';
import FactionDetailsRenderer from './FactionDetailsRenderer'; // Import the new component
import WorldEventDetailsRenderer from './WorldEventDetailsRenderer';
import { ExclamationTriangleIcon, CogIcon } from '@heroicons/react/24/outline';
import MarkdownRenderer from '../MarkdownRenderer';
import RelationshipDetailsRenderer from './RelationshipDetailsRenderer';
import PlayerCharacterDetailsRenderer from './PlayerCharacterDetailsRenderer';
import BonusCard from './Shared/BonusCard';
import type { CustomStateThreshold, RelationshipTier, StructuredBonus } from '../../types';
import { asRecord } from '../../utils/typeGuards';

// Type guards
const isItem = (data: unknown): data is Item & { ownerType?: 'player' | 'npc', ownerId?: string, isEquippedByOwner?: boolean } => {
    const record = asRecord(data);
    return !!record && record.quality !== undefined && record.weight !== undefined;
};
const isQuest = (data: unknown): data is Quest => {
    const record = asRecord(data);
    return !!record && record.questGiver !== undefined && Array.isArray(record.objectives);
};
const isPassiveSkill = (data: unknown): data is PassiveSkill => {
    const record = asRecord(data);
    return !!record && record.skillName !== undefined && record.masteryLevel !== undefined;
};
const isActiveSkill = (data: unknown): data is ActiveSkill => {
    const record = asRecord(data);
    return !!record && record.skillName !== undefined && record.masteryLevel === undefined && !isPassiveSkill(data);
};
const isEffect = (data: unknown): data is Effect => {
    const record = asRecord(data);
    return !!record && record.effectType !== undefined && record.duration !== undefined;
};
const isWound = (data: unknown): data is Wound & { type: 'wound' } => asRecord(data)?.type === 'wound';
const isNpc = (data: unknown): data is NPC => {
    const record = asRecord(data);
    return !!record && (record.relationshipLevel !== undefined || record.NPCId !== undefined);
};
const isCharacteristic = (data: unknown): data is { type: 'characteristic', name: string, value: number, description?: string } => asRecord(data)?.type === 'characteristic';
const isPrimaryStat = (data: unknown): data is { type: 'primaryStat', name: string, description: string } => asRecord(data)?.type === 'primaryStat';
const isLocation = (data: unknown): data is Location & { type: 'location' } => {
    const record = asRecord(data);
    return !!record && record.type === 'location' && record.externalDifficultyProfile !== undefined;
};
const isPlayerCharacter = (data: unknown): data is PlayerCharacter & { type: 'playerCharacter' } => asRecord(data)?.type === 'playerCharacter';
const isDerivedStat = (data: unknown): data is { type: 'derivedStat', name: string, value: string, breakdown: { label: string, value: string }[], description: string } => asRecord(data)?.type === 'derivedStat';
const isCombatAction = (data: unknown): data is CombatAction => {
    const record = asRecord(data);
    return !!record && Array.isArray(record.effects) && record.actionName !== undefined && record.quality === undefined && record.skillName === undefined;
};
const isFaction = (data: unknown): data is Faction & { type: 'faction', perspectiveFor?: { name: string; rank: string } } => {
    const record = asRecord(data);
    return !!record && record.type === 'faction' && record.reputation !== undefined;
};
const isCustomState = (data: unknown): data is CustomState & { type: 'customState' } => {
    const record = asRecord(data);
    return !!record && record.type === 'customState' && record.stateName !== undefined;
};
const isCustomStateThreshold = (data: unknown): data is CustomStateThreshold & { type: 'customStateThreshold' } => asRecord(data)?.type === 'customStateThreshold';
const isWorldEvent = (data: unknown): data is WorldEvent & { type: 'worldEvent' } => asRecord(data)?.type === 'worldEvent';
const isMemory = (data: unknown): data is { type: 'memory', content: string } => asRecord(data)?.type === 'memory';
const isRelationship = (data: unknown): data is { type: 'relationship', tiers: RelationshipTier[], current: number } => asRecord(data)?.type === 'relationship';

// Renderer for the Threshold Modal
const CustomStateThresholdDetailsRenderer: React.FC<{ threshold: CustomStateThreshold }> = ({ threshold }) => {
    const { t } = useLocalization();
    return (
        <div className="space-y-4">
            <h3 className="text-2xl font-bold text-cyan-300 capitalize">{threshold.levelName}</h3>
            <p className="text-lg text-gray-300">{t('Trigger')}: <span className="font-mono text-white">{threshold.triggerCondition === 'value_greater_than_or_equal_to' ? '>= ' : '<= '}{threshold.triggerValue}</span></p>
            
            {threshold.description && (
                <div className="italic text-gray-400">
                    <MarkdownRenderer content={threshold.description} />
                </div>
            )}

            {threshold.associatedEffects && threshold.associatedEffects.length > 0 && (
                <Section title={t("Associated Effects")} icon={ExclamationTriangleIcon}>
                    <div className="space-y-4">
                        {threshold.associatedEffects.map((effect, j) => {
                            if (effect.bonusType) { // This is a StructuredBonus-like object for factions
                                return <BonusCard key={j} bonus={effect as StructuredBonus} />;
                            }
                            if (effect.effectType) { // This is an Effect object for players
                                return <EffectDetailsRenderer key={j} effect={effect as Effect} />;
                            }
                            // Fallback for unknown or simple descriptions
                            if (typeof effect.description === 'string') {
                                return <p key={j} className="text-sm italic text-gray-400">{effect.description}</p>;
                            }
                            return null;
                        })}
                    </div>
                </Section>
            )}
        </div>
    );
};


// Local component for Custom State Details
const CustomStateDetailsRenderer: React.FC<{ state: CustomState; onOpenDetailModal: (title: string, data: any) => void; }> = ({ state, onOpenDetailModal }) => {
    const { t } = useLocalization();
    return (
        <div className="space-y-4">
            {state.description && (
                <div className="italic text-gray-400">
                    <MarkdownRenderer content={state.description} />
                </div>
            )}
            <Section title={t("Rules")} icon={CogIcon}>
                <div className="bg-gray-700/50 p-3 rounded-md space-y-2">
                    <p><strong>{t("Current Value")}:</strong> {state.currentValue} / {state.maxValue}</p>
                    {state.progressionRule && (
                        <p><strong>{t("Progression")}:</strong> {state.progressionRule.description}</p>
                    )}
                </div>
            </Section>
            {state.thresholds && state.thresholds.length > 0 && (
                <Section title={t("Thresholds")} icon={ExclamationTriangleIcon}>
                     <div className="space-y-2">
                        {state.thresholds.map((threshold, i) => (
                            <button
                                key={i}
                                onClick={() => onOpenDetailModal(t("Threshold: {name}", { name: threshold.levelName }), { ...threshold, type: 'customStateThreshold' })}
                                className="w-full text-left bg-gray-800/40 p-3 rounded-lg border border-gray-700/50 hover:bg-gray-700/60 hover:border-cyan-500/50 transition-colors group"
                            >
                                <div className="flex justify-between items-center">
                                    <p className="font-bold text-cyan-400 group-hover:text-cyan-300">{threshold.levelName}</p>
                                    <p className="text-sm font-mono text-gray-400">{threshold.triggerCondition === 'value_greater_than_or_equal_to' ? '>= ' : '<= '}{threshold.triggerValue}</p>
                                </div>
                                {threshold.associatedEffects && threshold.associatedEffects.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-1 italic">{t('Has {count} associated effects', { count: threshold.associatedEffects.length })}</p>
                                )}
                            </button>
                        ))}
                    </div>
                </Section>
            )}
        </div>
    );
};


export default function DetailRenderer(props: DetailRendererProps) {
    const { onForgetNpc, onClearNpcJournal, onCloseModal, onForgetQuest, onForgetLocation, currentLocationId, onRegenerateId, forgetHealedWound, forgetActiveWound, clearAllHealedWounds, allNpcs, updatePlayerPortrait, clearAllCompletedFactionProjects, deleteFactionCompletedProject, deleteFactionCustomState, clearAllCompletedNpcActivities, onDeleteCurrentActivity, onDeleteCompletedActivity, onViewCharacterSheet, onOpenTextReader, placeAsStorage, isLoading, deleteFactionProject, deleteFactionBonus } = props;
    const { data: _data, ...rest } = props;
    const [confirmation, setConfirmation] = useState<{ type: string | null; data: any }>({ type: null, data: null });
    const { t } = useLocalization();

    
    React.useEffect(() => {
        if (isNpc(_data) && !('type' in _data) && props.onViewCharacterSheet) {
            props.onViewCharacterSheet(_data);
            if (props.onCloseModal) {
                props.onCloseModal();
            }
        }
    }, [_data, props.onViewCharacterSheet, props.onCloseModal]);

    if (isNpc(_data) && !('type' in _data)) {
        return null;
    }

    const handleConfirmationClose = () => {
        setConfirmation({ type: null, data: null });
    };

    const handleConfirmationConfirm = () => {
        if (!confirmation.type || !confirmation.data) return;

        switch (confirmation.type) {
            case 'forgetNpc':
                if (onForgetNpc && confirmation.data.NPCId) {
                    onForgetNpc(confirmation.data.NPCId);
                    if (onCloseModal) onCloseModal();
                }
                break;
            case 'clearJournal':
                if (onClearNpcJournal && confirmation.data.NPCId) {
                    onClearNpcJournal(confirmation.data.NPCId);
                    if (onCloseModal) onCloseModal();
                }
                break;
            case 'forgetLocation':
                if (onForgetLocation && confirmation.data.locationId && confirmation.data.locationId !== currentLocationId) {
                    onForgetLocation(confirmation.data.locationId);
                    if (onCloseModal) onCloseModal();
                }
                break;
            case 'forgetQuest':
                 if (onForgetQuest && confirmation.data.questId) {
                    onForgetQuest(confirmation.data.questId);
                    if (onCloseModal) onCloseModal();
                }
                break;
            case 'regenerateId':
                if (onRegenerateId) {
                    onRegenerateId(confirmation.data.entity, confirmation.data.entityType);
                }
                break;
            case 'placeAsStorage':
                 if (placeAsStorage) {
                    placeAsStorage(confirmation.data);
                }
                break;
        }
        handleConfirmationClose();
    };

    const getConfirmationContent = () => {
        if (!confirmation.type) return { title: '', content: null };
        switch (confirmation.type) {
            case 'forgetNpc':
                return {
                    title: t("Forget NPC"),
                    content: <p>{t("Are you sure you want to forget about {name}? This will remove them from your known NPCs list.", { name: confirmation.data.name })}</p>
                };
            case 'clearJournal':
                return {
                    title: t("Clear Journal"),
                    content: <p>{t("Are you sure you want to clear the journal for {name}? This cannot be undone.", { name: confirmation.data.name })}</p>
                };
            case 'forgetLocation':
                return {
                    title: t("Forget Location"),
                    content: <p>{t("Are you sure you want to forget this location? This will remove it from your map and logs.")}</p>
                };
            case 'forgetQuest':
                return {
                    title: t("Forget Quest"),
                    content: <p>{t("Are you sure you want to permanently remove this quest?")}</p>
                };
            case 'regenerateId':
                return {
                    title: t('Regenerate ID'),
                    content: (
                        <>
                            <p>{t('Are you sure you want to regenerate the ID for "{name}"?', { name: confirmation.data.name })}</p>
                            <p className="mt-2 text-sm text-gray-400">{t('This can fix issues with uneditable objects but might have unintended side effects. This action cannot be undone.')}</p>
                        </>
                    )
                }
            case 'placeAsStorage':
                 return {
                    title: t("Place as Storage"),
                    content: <p>{t('Are you sure you want to place {name} here as a permanent storage? The item will be removed from your inventory.', { name: confirmation.data.name })}</p>
                }
            default:
                return { title: '', content: null };
        }
    };

    let content;
    if (isMemory(_data)) content = <MarkdownRenderer content={_data.content} />;
    else if (isRelationship(_data)) content = <RelationshipDetailsRenderer data={_data} />;
    else if (isItem(_data)) content = <ItemDetailsRenderer item={_data} {...rest} onOpenTextReader={onOpenTextReader} placeAsStorage={(item) => setConfirmation({ type: 'placeAsStorage', data: item })} />;
    else if (isQuest(_data)) content = <QuestDetailsRenderer quest={_data} onOpenForgetConfirm={() => setConfirmation({ type: 'forgetQuest', data: _data })} {...rest} />;
    else if (isActiveSkill(_data)) content = <ActiveSkillDetailsRenderer skill={_data} {...rest} />;
    else if (isPassiveSkill(_data)) content = <PassiveSkillDetailsRenderer skill={_data} {...rest} />;
    else if (isEffect(_data)) content = <EffectDetailsRenderer effect={_data} />;
    else if (isWound(_data)) content = <WoundDetailsRenderer wound={_data} forgetHealedWound={forgetHealedWound} forgetActiveWound={forgetActiveWound} clearAllHealedWounds={clearAllHealedWounds} {...rest} />;
    else if (isCharacteristic(_data)) content = <CharacteristicDetailsRenderer data={_data} />;
    else if (isPrimaryStat(_data)) content = <PrimaryStatDetailsRenderer data={_data} />;
    else if (isDerivedStat(_data)) content = <DerivedStatDetailsRenderer data={_data} />;
    else if (isLocation(_data)) {
        const { initialView, ...locationData } = _data as (Location & { type: 'location', initialView?: string });
        content = <LocationDetailsRenderer
            location={locationData as Location}
            onOpenForgetConfirm={() => setConfirmation({ type: 'forgetLocation', data: _data })}
            initialView={initialView}
            {...rest}
        />;
    }
    else if (isCombatAction(_data)) content = <CombatActionDetails action={_data} />;
    else if (isFaction(_data)) {
        const { perspectiveFor, ...factionData } = _data as Faction & { type: 'faction', perspectiveFor?: { name: string; rank: string | null; branch?: string | null; } };
        content = <FactionDetailsRenderer
            {...rest}
            faction={{ ...factionData, perspectiveFor }}
            onViewCharacterSheet={onViewCharacterSheet!}
            allNpcs={allNpcs!}
            clearAllCompletedFactionProjects={clearAllCompletedFactionProjects!}
            deleteFactionProject={deleteFactionProject}
            deleteFactionCompletedProject={deleteFactionCompletedProject}
            deleteFactionCustomState={deleteFactionCustomState}
            deleteFactionBonus={deleteFactionBonus}
            clearAllCompletedNpcActivities={clearAllCompletedNpcActivities!}
            onDeleteCurrentActivity={onDeleteCurrentActivity}
            onDeleteCompletedActivity={onDeleteCompletedActivity}
        />;
    }
    else if (isCustomState(_data)) content = <CustomStateDetailsRenderer state={_data} onOpenDetailModal={props.onOpenDetailModal} />;
    else if (isCustomStateThreshold(_data)) content = <CustomStateThresholdDetailsRenderer threshold={_data} />;
    else if (isWorldEvent(_data)) content = <WorldEventDetailsRenderer event={_data} {...rest} />;
    else if (isPlayerCharacter(_data)) content = <PlayerCharacterDetailsRenderer character={_data} updatePlayerPortrait={updatePlayerPortrait} {...rest} isLoading={isLoading} />;
    else content = <pre className="text-xs text-gray-400 whitespace-pre-wrap">{JSON.stringify(_data, null, 2)}</pre>;

    const { title: confirmTitle, content: confirmContent } = getConfirmationContent();

    return (
        <>
            {content}
            <ConfirmationModal
                isOpen={!!confirmation.type}
                onClose={handleConfirmationClose}
                onConfirm={handleConfirmationConfirm}
                title={confirmTitle}
            >
                {confirmContent}
            </ConfirmationModal>
        </>
    );
}
