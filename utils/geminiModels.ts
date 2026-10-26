import { GoogleGenAI, type Model } from '@google/genai';

export interface GeminiModelOption {
    id: string;
    displayName: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    thinking?: boolean;
}

interface GoogleModel extends Model {
    name?: string;
    baseModelId?: string;
    supportedGenerationMethods?: string[];
}

export const FALLBACK_GEMINI_MODELS: GeminiModelOption[] = [
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview' },
];

const cachedModelsByKey = new Map<string, GeminiModelOption[]>();
const pendingModelsRequestsByKey = new Map<string, Promise<GeminiModelOption[]>>();
const AI_STUDIO_PROXY_CACHE_KEY = 'ai-studio-proxy';

const getAutomaticApiKey = (): string => {
    if (typeof process !== 'undefined' && process.env?.API_KEY) {
        return process.env.API_KEY;
    }
    return '';
};

const normalizeModelId = (model: GoogleModel): string => {
    const rawName = model.baseModelId || model.name || '';
    return rawName.replace(/^models\//, '');
};

const isChatCapableGeminiModel = (model: GoogleModel): boolean => {
    const id = normalizeModelId(model);
    const methods = model.supportedGenerationMethods || model.supportedActions || [];

    if (!id.startsWith('gemini-')) return false;
    if (!methods.includes('generateContent')) return false;

    const blockedFragments = ['embedding', 'imagen', 'veo', 'lyria', 'tts', 'aqa', 'image', 'audio', 'computer-use'];
    return !blockedFragments.some(fragment => id.includes(fragment));
};

const toModelOption = (model: GoogleModel): GeminiModelOption => {
    const id = normalizeModelId(model);
    return {
        id,
        displayName: model.displayName || id,
        description: model.description,
        inputTokenLimit: model.inputTokenLimit,
        outputTokenLimit: model.outputTokenLimit,
        thinking: model.thinking,
    };
};

const sortModels = (models: GeminiModelOption[]): GeminiModelOption[] => {
    return [...models].sort((a, b) => {
        const aPro = a.id.includes('pro') ? 0 : 1;
        const bPro = b.id.includes('pro') ? 0 : 1;
        if (aPro !== bPro) return aPro - bPro;
        return a.displayName.localeCompare(b.displayName);
    });
};

export const loadGeminiModels = async (): Promise<GeminiModelOption[]> => {
    const cacheKey = getAutomaticApiKey().trim() || AI_STUDIO_PROXY_CACHE_KEY;

    if (cachedModelsByKey.has(cacheKey)) {
        return cachedModelsByKey.get(cacheKey)!;
    }

    const pendingRequest = pendingModelsRequestsByKey.get(cacheKey);
    if (pendingRequest) {
        return pendingRequest;
    }

    const pendingModelsRequest = (async () => {
        try {
            const allModels: GoogleModel[] = [];
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const pager = await ai.models.list({ config: { pageSize: 1000 } });

            for await (const model of pager) {
                allModels.push(model as GoogleModel);
            }

            const seen = new Set<string>();
            const loadedModels = sortModels(
                allModels
                    .filter(isChatCapableGeminiModel)
                    .map(toModelOption)
                    .filter(model => {
                        if (seen.has(model.id)) return false;
                        seen.add(model.id);
                        return true;
                    })
            );

            const modelsToUse = loadedModels.length > 0 ? loadedModels : FALLBACK_GEMINI_MODELS;
            if (loadedModels.length > 0) {
                cachedModelsByKey.set(cacheKey, modelsToUse);
            }
            return modelsToUse;
        } catch (error) {
            console.warn('Falling back to bundled Gemini model list.', error);
            return FALLBACK_GEMINI_MODELS;
        } finally {
            pendingModelsRequestsByKey.delete(cacheKey);
        }
    })();

    pendingModelsRequestsByKey.set(cacheKey, pendingModelsRequest);
    return pendingModelsRequest;
};
