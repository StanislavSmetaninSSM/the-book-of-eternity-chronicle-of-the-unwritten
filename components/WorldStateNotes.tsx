import React from 'react';
import { ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';
import { useLocalization } from '../context/LocalizationContext';
import { assessWorld } from '../utils/worldAssessment.js';

interface WorldStateNote {
    kind: string;
    subject: string;
    params: Record<string, string | number>;
}

interface WorldStateNotesProps {
    /** The factions, NPCs and threats this view is listing; the notes are read off them. */
    factions?: object[];
    npcs?: object[];
    threats?: object[];
    className?: string;
    /** Notes about one subject only - for a card, where the subject is already named. */
    only?: string;
}

/**
 * The lines `assessWorld` proved: records the rules cannot produce, stated as the pair of numbers
 * that contradicts each other. Deliberately not a warning banner - it stays out of the way while
 * the world is consistent, and it never offers to fix anything.
 */
const WorldStateNotes: React.FC<WorldStateNotesProps> = ({ factions, npcs, threats, className = '', only }) => {
    const { t } = useLocalization();
    const notes: WorldStateNote[] = React.useMemo(
        () => assessWorld({ factions: factions || [], npcs: npcs || [], threats: threats || [] }).notes,
        [factions, npcs, threats],
    );
    const shown = only ? notes.filter(note => note.subject === only) : notes;
    if (shown.length === 0) return null;

    return (
        <div
            data-testid="world-state-notes"
            className={`bg-gray-900/40 p-3 rounded-lg border border-amber-500/30 ${className}`}
        >
            <h4 className="text-sm font-semibold text-amber-300/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ClipboardDocumentCheckIcon className="w-4 h-4" />
                {t('World State Check')}
            </h4>
            <ul className="space-y-1 text-sm text-amber-200/90">
                {shown.map((note, index) => (
                    <li key={`${note.subject}-${note.kind}-${index}`} className="leading-snug">
                        {t(`world_notes_${note.kind}`, note.params)}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default React.memo(WorldStateNotes);
