
import React, { useState } from 'react';
import { NPC, NpcPersonalQuest } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import { FlagIcon, MapIcon, CheckCircleIcon, XCircleIcon, StopCircleIcon, LightBulbIcon, TrashIcon } from '@heroicons/react/24/outline';
import SectionHeader from './Shared/SectionHeader';
import MarkdownRenderer from '../MarkdownRenderer';
import EditableField from '../DetailRenderer/Shared/EditableField';
import ConfirmationModal from '../ConfirmationModal';

interface NpcGoalsViewProps {
    character: NPC;
    isAdminEditable?: boolean;
    onEditNpcData?: (npcId: string, field: keyof NPC, value: any) => void;
}

const QuestStatusIcon = ({ status }: { status: string }) => {
    switch (status) {
        case 'Completed': return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
        case 'Failed': return <XCircleIcon className="w-5 h-5 text-red-500" />;
        case 'Active': return <div className="w-5 h-5 flex items-center justify-center"><div className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse"></div></div>;
        default: return <StopCircleIcon className="w-5 h-5 text-gray-500" />;
    }
};

const NpcGoalsView: React.FC<NpcGoalsViewProps> = ({ character, isAdminEditable = false, onEditNpcData }) => {
    const { t } = useLocalization();
    const [questToDelete, setQuestToDelete] = useState<number | null>(null);

    const goals = character.goals;
    const personalQuests = character.personalQuests || [];
    const plans = character.plans;

    const handleSaveGoal = (type: 'longTerm' | 'shortTerm', val: string) => {
        if (onEditNpcData) {
            const currentGoals = character.goals || { longTerm: '', shortTerm: '' };
            const newGoals = { ...currentGoals, [type]: val };
            onEditNpcData(character.NPCId, 'goals', newGoals);
        }
    };

    const handleSavePlan = (val: string) => {
        if (onEditNpcData) {
            onEditNpcData(character.NPCId, 'plans', val);
        }
    };

    const handleSaveQuestField = (index: number, field: keyof NpcPersonalQuest, val: string) => {
        if (onEditNpcData && character.personalQuests) {
             const newQuests = [...character.personalQuests];
             newQuests[index] = { ...newQuests[index], [field]: val };
             onEditNpcData(character.NPCId, 'personalQuests', newQuests);
        }
    };

    const handleConfirmDeleteQuest = () => {
        if (questToDelete !== null && onEditNpcData && character.personalQuests) {
             const newQuests = character.personalQuests.filter((_, i) => i !== questToDelete);
             onEditNpcData(character.NPCId, 'personalQuests', newQuests);
             setQuestToDelete(null);
        }
    };

    const getSafeString = (val: any): string => {
        if (typeof val === 'string') return val;
        if (val && typeof val === 'object') {
            if (val.other) return val.other;
            const parts = [];
            if (val.experience) parts.push(`${val.experience} XP`);
            if (val.money) parts.push(`${val.money} Money`);
            if (val.items) parts.push(`Items: ${val.items.join(', ')}`);
            return parts.join(', ');
        }
        return '';
    };

    return (
        <div className="space-y-6">
            {(goals || isAdminEditable) && (
                <div className="space-y-4">
                    <SectionHeader title={t('Ambitions')} icon={FlagIcon} />
                    
                    <div className="bg-purple-900/20 border-l-4 border-purple-500 p-4 rounded-r-lg">
                        <h5 className="text-xs font-bold text-purple-300 uppercase tracking-widest mb-1">{t('Ultimate Goal')}</h5>
                        <EditableField
                            label={t('Ultimate Goal')}
                            value={goals?.longTerm || ''}
                            isEditable={isAdminEditable}
                            onSave={(val) => handleSaveGoal('longTerm', val)}
                            as="textarea"
                            className="text-gray-200 font-medium italic"
                        />
                    </div>
                    
                    <div className="bg-cyan-900/20 border-l-4 border-cyan-500 p-4 rounded-r-lg">
                        <h5 className="text-xs font-bold text-cyan-300 uppercase tracking-widest mb-1">{t('Current Objective')}</h5>
                        <EditableField
                            label={t('Current Objective')}
                            value={goals?.shortTerm || ''}
                            isEditable={isAdminEditable}
                            onSave={(val) => handleSaveGoal('shortTerm', val)}
                            as="textarea"
                            className="text-gray-200 font-medium italic"
                        />
                    </div>

                    {(plans || isAdminEditable) && (
                        <div className="bg-slate-800 border-l-4 border-indigo-500 p-4 rounded-r-lg">
                            <h5 className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-1 flex items-center gap-2">
                                <LightBulbIcon className="w-4 h-4" />
                                {t('Strategic Plan')}
                            </h5>
                            <EditableField
                                label={t('Strategic Plan')}
                                value={plans || ''}
                                isEditable={isAdminEditable}
                                onSave={handleSavePlan}
                                as="textarea"
                                className="text-gray-200 font-medium italic"
                            />
                        </div>
                    )}
                </div>
            )}

            {personalQuests.length > 0 && (
                <div className="space-y-4">
                    <SectionHeader title={t('Personal Plans')} icon={MapIcon} />
                    <div className="grid gap-4">
                        {personalQuests.slice().reverse().map((quest, index) => (
                            <div key={index} className={`relative bg-gray-800/60 rounded-lg border p-4 ${quest.status === 'Completed' ? 'border-green-900/50 opacity-70' : quest.status === 'Failed' ? 'border-red-900/50 opacity-70' : 'border-gray-600'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2 flex-1">
                                        <QuestStatusIcon status={quest.status} />
                                        <div className="flex-1">
                                            <EditableField
                                                label={t('Quest Name')}
                                                value={quest.questName}
                                                isEditable={isAdminEditable}
                                                onSave={(val) => handleSaveQuestField(personalQuests.length - 1 - index, 'questName', val)}
                                                as="input"
                                                className={`font-bold ${quest.status === 'Completed' ? 'text-green-400 line-through' : quest.status === 'Failed' ? 'text-red-400 line-through' : 'text-cyan-300'}`}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-gray-500">
                                            <EditableField
                                                label={t('Source')}
                                                value={t(quest.source || 'Personal Goal')}
                                                isEditable={isAdminEditable}
                                                onSave={(val) => handleSaveQuestField(personalQuests.length - 1 - index, 'source', val)}
                                                as="input"
                                            />
                                        </span>
                                        {isAdminEditable && (
                                            <button 
                                                onClick={() => setQuestToDelete(personalQuests.length - 1 - index)}
                                                className="text-gray-400 hover:text-red-400 transition-colors p-1"
                                                title={t('Delete Quest')}
                                            >
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="mb-3 text-sm text-gray-300/90 italic pl-7 border-l-2 border-gray-700">
                                    <EditableField
                                        label={t('Background')}
                                        value={quest.questBackground}
                                        isEditable={isAdminEditable}
                                        onSave={(val) => handleSaveQuestField(personalQuests.length - 1 - index, 'questBackground', val)}
                                        as="textarea"
                                    />
                                </div>

                                <div className="space-y-2 pl-7">
                                    {quest.objectives.map((obj, i) => (
                                        <div key={obj.objectiveId || i} className="flex items-start gap-2 text-xs">
                                             <div className="mt-0.5">
                                                {obj.status === 'Completed' ? <CheckCircleIcon className="w-3 h-3 text-green-500"/> : <div className="w-3 h-3 border border-gray-500 rounded-full"></div>}
                                             </div>
                                             <span className={obj.status === 'Completed' ? 'text-gray-500 line-through' : 'text-gray-300'}>{obj.description}</span>
                                        </div>
                                    ))}
                                </div>
                                
                                {(quest.rewards || quest.failureConsequences || isAdminEditable) && (
                                     <div className="mt-3 pt-3 border-t border-gray-700/50 flex flex-col gap-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-green-400/80 font-bold">{t('Hope')}:</span>
                                            <EditableField
                                                label={t('Rewards')}
                                                value={getSafeString(quest.rewards)}
                                                isEditable={isAdminEditable}
                                                onSave={(val) => handleSaveQuestField(personalQuests.length - 1 - index, 'rewards', val)}
                                                as="input"
                                                className="text-green-400/80 flex-1"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-red-400/80 font-bold">{t('Fear')}:</span>
                                            <EditableField
                                                label={t('Consequences')}
                                                value={getSafeString(quest.failureConsequences)}
                                                isEditable={isAdminEditable}
                                                onSave={(val) => handleSaveQuestField(personalQuests.length - 1 - index, 'failureConsequences', val)}
                                                as="input"
                                                className="text-red-400/80 flex-1"
                                            />
                                        </div>
                                     </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {!goals && personalQuests.length === 0 && !isAdminEditable && (
                 <div className="text-center text-gray-500 p-6 bg-gray-900/20 rounded-lg">
                    <p>{t('This character has no known ambitions or plans.')}</p>
                </div>
            )}

            <ConfirmationModal
                isOpen={questToDelete !== null}
                onClose={() => setQuestToDelete(null)}
                onConfirm={handleConfirmDeleteQuest}
                title={t('Delete Personal Quest')}
            >
                <p>{t('Are you sure you want to delete this personal quest?')}</p>
            </ConfirmationModal>
        </div>
    );
};

export default NpcGoalsView;
