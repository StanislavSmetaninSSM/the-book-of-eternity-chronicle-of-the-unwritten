
import React, { useMemo } from 'react';
import { NPC, NpcRelationship } from '../../types';
import { useLocalization } from '../../context/LocalizationContext';
import { UserIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import SectionHeader from './Shared/SectionHeader';

interface NpcRelationshipsViewProps {
    character: NPC;
    allNpcs: NPC[];
    onViewCharacterSheet: (character: NPC) => void;
}

const statusColors: Record<string, string> = {
    'Ally': 'text-green-400 border-green-500/50 bg-green-900/20',
    'Friend': 'text-teal-400 border-teal-500/50 bg-teal-900/20',
    'Neutral': 'text-gray-400 border-gray-500/50 bg-gray-900/20',
    'Rival': 'text-orange-400 border-orange-500/50 bg-orange-900/20',
    'Enemy': 'text-red-400 border-red-500/50 bg-red-900/20',
    'Subordinate': 'text-blue-400 border-blue-500/50 bg-blue-900/20',
    'Superior': 'text-purple-400 border-purple-500/50 bg-purple-900/20',
    'Family': 'text-pink-400 border-pink-500/50 bg-pink-900/20',
};

const NpcRelationshipsView: React.FC<NpcRelationshipsViewProps> = ({ character, allNpcs, onViewCharacterSheet }) => {
    const { t } = useLocalization();

    const relationships = useMemo(() => {
        return character.npcRelationships || [];
    }, [character.npcRelationships]);

    if (!relationships || relationships.length === 0) {
        return (
            <div className="text-center text-gray-500 p-6 bg-gray-900/20 rounded-lg">
                <UserGroupIcon className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                <p>{t('No known relationships with other NPCs.')}</p>
            </div>
        );
    }

    const resolveTargetNpc = (rel: NpcRelationship) => {
        if (rel.targetNpcId) {
            return allNpcs.find(n => n.NPCId === rel.targetNpcId);
        }
        return allNpcs.find(n => n.name === rel.targetNpcName);
    };

    return (
        <div className="space-y-4">
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {relationships.map((rel, index) => {
                    const targetNpc = resolveTargetNpc(rel);
                    const styleClass = statusColors[rel.relationshipStatus] || statusColors['Neutral'];
                    
                    return (
                        <div key={index} className={`p-3 rounded-lg border flex flex-col gap-2 ${styleClass}`}>
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 truncate">
                                    <UserIcon className="w-5 h-5 opacity-80 flex-shrink-0" />
                                    {targetNpc ? (
                                        <button 
                                            onClick={() => onViewCharacterSheet(targetNpc)}
                                            className="font-bold hover:underline truncate"
                                            title={t("View Character Sheet")}
                                        >
                                            {targetNpc.name}
                                        </button>
                                    ) : (
                                        <span className="font-bold truncate" title={rel.targetNpcName}>{rel.targetNpcName}</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-start">
                                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-black/30 border border-current">
                                    {t(rel.relationshipStatus as any)}
                                </span>
                            </div>
                            <p className="text-sm italic opacity-90 pl-2 border-l-2 border-current/30 line-clamp-3" title={rel.statusReason}>
                                "{rel.statusReason}"
                            </p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default NpcRelationshipsView;
