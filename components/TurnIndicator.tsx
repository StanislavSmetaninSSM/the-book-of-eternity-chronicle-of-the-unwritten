import React from 'react';
import { GameSettings } from '../types';
import { useLocalization } from '../context/LocalizationContext';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

interface TurnIndicatorProps {
  activePlayerName: string | null;
  gameSettings: GameSettings | null;
}

const TurnIndicator: React.FC<TurnIndicatorProps> = ({ activePlayerName, gameSettings }) => {
  const { t } = useLocalization();
  if (!gameSettings || gameSettings.cooperativeGameType === 'None') return null;
  return (
    <div className="w-full text-center p-2 rounded-lg mb-2 flex items-center justify-center gap-2 font-semibold bg-green-500/20 border border-green-500/30 text-green-300">
      <CheckCircleIcon className="w-5 h-5" />
      <span>{t('active_character_turn', { name: activePlayerName || '...' })}</span>
    </div>
  );
};

export default TurnIndicator;
