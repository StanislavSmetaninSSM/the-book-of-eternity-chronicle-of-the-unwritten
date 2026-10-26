


import React from 'react';
import { useLocalization } from '../../../context/LocalizationContext';
import { ExclamationTriangleIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { PlayerCharacter, NPC } from '../../../types';

const StatBar: React.FC<{
    value: number;
    max: number;
    threshold?: number;
    color: string;
    thresholdColor?: string;
    label: string;
    unit?: string;
    icon: React.FC<React.SVGProps<SVGSVGElement>>;
    onClick?: () => void;
    min?: number;
    title?: string;
    character?: PlayerCharacter | NPC;
    isLocked?: boolean;
    onLockClick?: () => void;
}> = ({ value, max, threshold, color, thresholdColor = 'bg-red-500', label, unit = '', icon: Icon, onClick, min = 0, title, character, isLocked, onLockClick }) => {
    const { t } = useLocalization();

    // Ensure values are numbers to prevent crashes if data is malformed/missing
    const safeMax = typeof max === 'number' ? max : 100;
    const safeMin = typeof min === 'number' ? min : 0;
    const safeValue = typeof value === 'number' ? value : 0;

    const isOverThreshold = threshold !== undefined && safeValue > threshold;
    const hasMeaningfulRange = safeMax > safeMin;

    const barMax = threshold !== undefined && character && 'criticalExcessWeight' in character ? safeMax + ((character as PlayerCharacter).criticalExcessWeight ?? 15) : safeMax;
    const range = barMax - safeMin;
    const valueInRange = safeValue - safeMin;
    const valuePercentage = range > 0 ? (valueInRange / range) * 100 : 0;
    const thresholdPercentage = threshold !== undefined && range > 0 ? ((threshold - safeMin) / range) * 100 : 101;

    const formattedValue = React.useMemo(() => {
        const healthLabel = t('Health');
        const energyLabel = t('Energy');
        const experienceLabel = t('Experience');
        const weightLabel = t('Weight');
        const relationshipLabel = t('Relationship');
        const reputationLabel = t('Reputation');

        if (label === healthLabel || label === energyLabel || label === experienceLabel || label === reputationLabel) {
            return `${Math.round(safeValue)} / ${Math.round(safeMax)}`;
        }
        if (label === weightLabel) {
            return `${safeValue.toFixed(1)}${unit} / ${(threshold ?? safeMax).toFixed(0)}${unit}`;
        }
        if (label === relationshipLabel) {
             return `${Math.round(safeValue)} / ${Math.round(safeMax)}`;
        }
        
        const unitDisplay = unit ? ` ${unit}` : '';
        if (hasMeaningfulRange) {
            return `${t('Current')}: ${safeValue.toFixed(2)} (${t('Range')}: ${safeMin.toFixed(2)} – ${safeMax.toFixed(2)})`;
        }
        return `${safeValue.toFixed(2)} / ${safeMax.toFixed(2)}${unitDisplay}`;
    }, [label, safeValue, safeMax, safeMin, unit, t, hasMeaningfulRange, threshold]);
    
    const Wrapper = onClick ? 'button' : 'div';
    
    const handleLockClick = (e: React.MouseEvent) => {
        if (isLocked && onLockClick) {
            e.stopPropagation();
            onLockClick();
        } else if (onClick) {
            onClick();
        }
    };
    
    return (
        <Wrapper onClick={onClick} className={`w-full text-left group transition-transform transform ${!onClick ? 'cursor-default' : 'hover:scale-[1.02] cursor-pointer'}`} disabled={!onClick} title={title}>
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${isOverThreshold ? 'text-red-400' : color.replace('bg-', 'text-')}`} />
                    <span className={`text-sm font-medium ${isOverThreshold ? 'text-red-300' : 'text-gray-300'} group-hover:text-cyan-300`}>{label}</span>
                    {isOverThreshold && <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400" title={t('Overloaded!')} />}
                    {isLocked && (
                        <button 
                            onClick={handleLockClick}
                            className="text-gray-400 hover:text-red-400 transition-colors"
                            title={t('Reputation Locked! Click for details.')}
                        >
                            <LockClosedIcon className="w-4 h-4" />
                        </button>
                    )}
                </div>
              <span className={`text-sm font-mono ${isOverThreshold ? 'text-red-300' : 'text-gray-400'}`}>
                   {formattedValue}
              </span>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-2.5 relative overflow-hidden">
                <div className={`${isOverThreshold ? thresholdColor : color} h-2.5 rounded-l-full transition-all duration-500 absolute left-0 top-0 ${isLocked ? 'opacity-50' : ''}`} style={{ width: `${valuePercentage}%` }}></div>
                {threshold !== undefined && (
                    <div className="absolute top-0 bottom-0 border-r-2 border-yellow-300" style={{ left: `${thresholdPercentage}%` }} title={t('Max Weight (Overload Threshold)')}></div>
                )}
            </div>
        </Wrapper>
    );
};

export default StatBar;