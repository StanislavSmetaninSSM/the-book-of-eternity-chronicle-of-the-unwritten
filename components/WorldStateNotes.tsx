import React from 'react';
import { ClipboardDocumentCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useLocalization } from '../context/LocalizationContext';
import { assessWorld } from '../utils/worldAssessment.js';

export interface WorldStateNote {
    /** The UI string the note was written for: the reader owns it, the panel only reads it. */
    key: string;
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
    /** Notes computed by the caller, when the view already knows what it holds. */
    notes?: WorldStateNote[];
    /** A view with its own heading; the world panels share one. */
    titleKey?: string;
    /** Inside a card, where the card has already said whose state this is and boxed it twice. */
    compact?: boolean;
}

/**
 * The lines `assessWorld` proved: records the rules cannot produce, stated as the pair of numbers
 * that contradicts each other. Deliberately not a warning banner - it stays out of the way while
 * the world is consistent, and it never offers to fix anything.
 */
const WorldStateNotes: React.FC<WorldStateNotesProps> = ({ factions, npcs, threats, className = '', only, notes: givenNotes, titleKey = 'World State Check', compact = false }) => {
    const { t } = useLocalization();
    const notes: WorldStateNote[] = React.useMemo(
        () => (givenNotes
            ? givenNotes
            : assessWorld({ factions: factions || [], npcs: npcs || [], threats: threats || [] }).notes),
        [givenNotes, factions, npcs, threats],
    );
    const shown = only ? notes.filter(note => note.subject === only) : notes;
    if (shown.length === 0) return null;

    if (compact) {
        // Inside the card that already names its subject: the lines, without a second frame.
        return (
            <div data-testid="world-state-notes-inline" className={`space-y-1 text-xs text-amber-300/90 ${className}`}>
                {shown.map((note, index) => (
                    <p key={`${note.subject}-${note.kind}-${index}`} className="leading-snug flex items-start gap-1.5">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-400/70" />
                        <span>{t(note.key, note.params)}</span>
                    </p>
                ))}
            </div>
        );
    }

    return (
        <div
            data-testid="world-state-notes"
            className={`bg-gray-900/40 p-3 rounded-lg border border-amber-500/30 ${className}`}
        >
            <h4 className="text-sm font-semibold text-amber-300/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ClipboardDocumentCheckIcon className="w-4 h-4" />
                {t(titleKey)}
            </h4>
            <ul className="space-y-1 text-sm text-amber-200/90">
                {shown.map((note, index) => (
                    <li key={`${note.subject}-${note.kind}-${index}`} className="leading-snug">
                        {t(note.key, note.params)}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default React.memo(WorldStateNotes);
