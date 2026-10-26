import React, { useEffect, useMemo, useState } from 'react';
import { FALLBACK_GEMINI_MODELS, GeminiModelOption, loadGeminiModels } from '../utils/geminiModels';
import { useLocalization } from '../context/LocalizationContext';

interface GeminiModelSelectProps {
    id: string;
    name?: string;
    value: string;
    isCustomModel: boolean;
    customModelName: string;
    onModelChange: (modelValue: string) => void;
    onCustomModelChange: (modelValue: string) => void;
    disabled?: boolean;
}

const GeminiModelSelect: React.FC<GeminiModelSelectProps> = ({
    id,
    name,
    value,
    isCustomModel,
    customModelName,
    onModelChange,
    onCustomModelChange,
    disabled = false,
}) => {
    const { t } = useLocalization();
    const [models, setModels] = useState<GeminiModelOption[]>(FALLBACK_GEMINI_MODELS);
    const [modelLoadState, setModelLoadState] = useState<'loading' | 'live' | 'fallback'>('loading');

    useEffect(() => {
        let cancelled = false;
        setModelLoadState('loading');

        loadGeminiModels().then(loadedModels => {
            if (!cancelled) {
                setModels(loadedModels);
                setModelLoadState(loadedModels === FALLBACK_GEMINI_MODELS ? 'fallback' : 'live');
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const options = useMemo(() => {
        if (isCustomModel || !value || models.some(model => model.id === value)) {
            return models;
        }

        return [{ id: value, displayName: value }, ...models];
    }, [isCustomModel, models, value]);

    const customInputId = id === 'modelName' ? 'customModelName' : `${id}-customModelName`;

    return (
        <>
            <select
                id={id}
                name={name}
                value={isCustomModel ? 'CUSTOM' : value}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={disabled}
                className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-3 text-gray-200 focus:ring-2 focus:ring-cyan-500 transition"
            >
                {options.map(model => (
                    <option key={model.id} value={model.id}>
                        {model.displayName} ({model.id})
                    </option>
                ))}
                <option value="CUSTOM">{t("Custom...")}</option>
            </select>
            {isCustomModel && (
                <div className="mt-2">
                    <label htmlFor={customInputId} className="block text-xs font-medium text-gray-400 mb-1">{t('Custom Model Name')}</label>
                    <input
                        id={customInputId}
                        name="customModelName"
                        type="text"
                        onChange={(e) => onCustomModelChange(e.target.value)}
                        value={customModelName}
                        className="w-full bg-gray-700/50 border border-gray-600 rounded-md p-2 text-gray-200 focus:ring-1 focus:ring-cyan-500 transition"
                        placeholder={t('Specify model')}
                        required
                    />
                </div>
            )}
            <p className={`mt-1 text-xs ${modelLoadState === 'fallback' ? 'text-yellow-300' : 'text-gray-400'}`}>
                {modelLoadState === 'loading' && t('Loading Gemini model list...')}
                {modelLoadState === 'live' && t('Gemini model list loaded from Google.')}
                {modelLoadState === 'fallback' && t('Using fallback Gemini model list. Check the configured Gemini key or network access to load the live Google list.')}
            </p>
        </>
    );
};

export default GeminiModelSelect;
