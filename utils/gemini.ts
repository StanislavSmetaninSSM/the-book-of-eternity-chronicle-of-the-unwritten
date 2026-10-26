
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold, Modality } from "@google/genai";
import { GameContext, GameResponse } from '../types';
// @ts-ignore
import * as mainPromptModule from '../prompts/mainPromptModule.js';
import * as mainPromptSteps from '../prompts/mainPromptSteps.js';

// @ts-ignore
import { getMusicPrompt } from '../prompts/musicPrompt.js';
// @ts-ignore
import { getCorrectionPrompt, getAdultPrompt } from '../prompts/systemPrompts.js';
// @ts-ignore
import narrativeStyleGuide from '../prompts/narrativeStyleGuide.js';
// @ts-ignore
import worldLogicGuide from '../prompts/worldLogicGuide.js';
import { deepMergeResponses } from "./responseProcessor";
import { deepStripModerationSymbols } from "./textUtils";

const MAX_REGENERATION_RETRIES = 10;

// The custom error class for signaling a need for response regeneration.
export class RegenerationRequiredError extends Error {
    public reason: string;
    public rawText?: string;
    constructor(reason: string, message?: string, rawText?: string) {
        super(message || "Regeneration of the response is required.");
        this.name = "RegenerationRequiredError";
        this.reason = reason;
        this.rawText = rawText;
    }
}

const disabledSafetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const cleanJsonString = (jsonString: string): string => {
    if (!jsonString || typeof jsonString !== 'string') return '';
    // Remove markdown code block fences
    let cleaned = jsonString.trim().replace(/^```json\s*/, '').replace(/```$/, '');
    
    // Attempt to find the start of the JSON object/array
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    
    let startIndex = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
        startIndex = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
        startIndex = firstBrace;
    } else {
        startIndex = firstBracket;
    }

    if (startIndex !== -1) {
        cleaned = cleaned.substring(startIndex);
    }

    // Attempt to find the end of the JSON object/array
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    
    const endIndex = Math.max(lastBrace, lastBracket);

    if (endIndex !== -1) {
        cleaned = cleaned.substring(0, endIndex + 1);
    }

    // Patch: Fix invalid leading zeros in numbers SAFELY (e.g. 02007 -> 2007).
    // This approach matches strings OR numbers with leading zeros.
    // By matching strings first (Group 1), we ensure we don't modify contents inside quotes (like time "08:00" or codes "007").
    // Only if it matches Group 2/3 (number outside quotes) do we apply the fix.
    cleaned = cleaned.replace(/("(?:\\.|[^\\"])*")|([:\[,]\s*)0+([1-9]\d*)/g, (match, stringContent, separator, number) => {
        // If it matched a string (Group 1), return it exactly as is.
        if (stringContent) return stringContent;
        
        // Otherwise, it matched a number with leading zero outside of quotes. Fix it.
        return separator + number;
    });
    
    return cleaned;
};


async function callGenerativeApiRaw(
    prompt: string,
    context: GameContext,
    abortSignal: AbortSignal,
    modelName: string,
    aiProvider: string,
    apiKey: string,
): Promise<string> {
    const defaultModel = 'gemini-2.5-flash';
    const finalModelName = modelName || defaultModel;
    const isGemini3 = finalModelName.includes('gemini-3');
    
    let responseText: string;

    if (aiProvider === 'gemini') {
        const effectiveApiKey = process.env.API_KEY;
        if (!effectiveApiKey) {
            throw new Error("Gemini API Key not found in process.env.API_KEY.");
        }
        
        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

        const modelConfig: any = {
            model: finalModelName,
            signal: abortSignal,
        };

        if (context.image && context.image.data) {
            const base64Data = context.image.data;
            modelConfig.contents = {
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: context.image.mimeType, data: base64Data } }
                ]
            };
        } else {
            modelConfig.contents = prompt;
        }

        modelConfig.config = {}; // Initialize config object
        if (context.gameSettings.adultMode) {
            modelConfig.config.systemInstruction = getAdultPrompt();
        }
        if (context.gameSettings.useGoogleSearch) {
            modelConfig.config.tools = [{googleSearch: {}}];
        } else {
            modelConfig.config.responseMimeType = "application/json";
        }
        
        if (!finalModelName.includes('image')) {
            modelConfig.config.safetySettings = disabledSafetySettings;
        }

        if (isGemini3) {
             const level = context.gameSettings.geminiThinkingLevel === 'low' ? 'LOW' : 'HIGH';
             modelConfig.config.thinkingConfig = {
                includeThoughts: true,
                thinkingLevel: level 
             } as any;
             // Pass previous thought signature if available to maintain reasoning context
             if (context.previousThoughtSignature) {
                 (modelConfig.config.thinkingConfig as any).thoughtSignature = context.previousThoughtSignature;
             }
        } else {
             const budget = context.gameSettings.useDynamicThinkingBudget ? undefined : context.gameSettings.geminiThinkingBudget;
             if (budget !== undefined) {
                modelConfig.config.thinkingConfig = { thinkingBudget: budget };
             }
        }
        
        const response = await ai.models.generateContent(modelConfig);
        responseText = response.text || '';
    } else { // openrouter
        const effectiveApiKey = apiKey || context.gameSettings.openRouterApiKey;
        if (!effectiveApiKey) {
            throw new Error("OpenRouter API Key not found.");
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${effectiveApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": finalModelName,
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }
        const data = await response.json();
        responseText = data.choices[0].message.content;
    }
    
    if (abortSignal.aborted) {
        throw new Error('Aborted');
    }

    return responseText;
}

/**
 * Calls the generative API and returns the parsed JSON response AND any captured thought signature.
 */
export async function callGenerativeApi(
    prompt: string,
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void,
    modelName: string,
    aiProvider: string,
    apiKey: string
): Promise<{ data: any, signature?: string }> {
    const defaultModel = 'gemini-2.5-flash';
    const finalModelName = modelName || defaultModel;
    const isGemini3 = finalModelName.includes('gemini-3');
    let fullResponseText = '';
    let capturedSignature: string | undefined = undefined;

    if (aiProvider === 'gemini') {
        const effectiveApiKey = process.env.API_KEY;
        if (!effectiveApiKey) {
            throw new Error("Gemini API Key not found in process.env.API_KEY.");
        }
        
        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

        const modelConfig: any = {
            model: finalModelName,
            signal: abortSignal,
        };
        
        if (context.image && context.image.data) {
            const base64Data = context.image.data;
            modelConfig.contents = {
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: context.image.mimeType, data: base64Data } }
                ]
            };
        } else {
            modelConfig.contents = prompt;
        }

        modelConfig.config = {}; // Initialize config object
        if (context.gameSettings.adultMode) {
            modelConfig.config.systemInstruction = getAdultPrompt();
        }
        if (context.gameSettings.useGoogleSearch) {
            modelConfig.config.tools = [{googleSearch: {}}];
        } else {
            modelConfig.config.responseMimeType = "application/json";
        }
        
        if (!finalModelName.includes('image')) {
            modelConfig.config.safetySettings = disabledSafetySettings;
        }

        if (isGemini3) {
             const level = context.gameSettings.geminiThinkingLevel === 'low' ? 'LOW' : 'HIGH';
             modelConfig.config.thinkingConfig = {
                includeThoughts: true,
                thinkingLevel: level
             } as any;
             // Pass previous thought signature if available to maintain reasoning context
             if (context.previousThoughtSignature) {
                 // Note: Verify property name based on SDK version. Assuming 'thoughtSignature' within thinkingConfig or similar.
                 (modelConfig.config.thinkingConfig as any).thoughtSignature = context.previousThoughtSignature;
             }
        } else {
             const budget = context.gameSettings.useDynamicThinkingBudget ? undefined : context.gameSettings.geminiThinkingBudget;
             if (budget !== undefined) {
                modelConfig.config.thinkingConfig = { thinkingBudget: budget };
             }
        }
        
        const stream = await ai.models.generateContentStream(modelConfig);

        for await (const chunk of stream) {
            if (abortSignal.aborted) {
                throw new Error('Aborted');
            }
            const chunkText = chunk.text;
            if (chunkText) {
                fullResponseText += chunkText;
                onStreamingChunk(fullResponseText);
            }
            
            // Capture the thought signature from chunks if available (for Gemini 3 models)
            if (isGemini3) {
                const chunkAny = chunk as any;
                if (chunkAny.thoughtSignature) {
                     capturedSignature = chunkAny.thoughtSignature;
                } else if (chunkAny.candidates?.[0]?.thoughtSignature) {
                     capturedSignature = chunkAny.candidates[0].thoughtSignature;
                }
            }
        }
        
        // Note: stream.response is not available on AsyncGenerator in newer SDK versions.
        // Metadata is extracted from chunks during iteration.
        
    } else { // openrouter
        const effectiveApiKey = apiKey || context.gameSettings.openRouterApiKey;
        if (!effectiveApiKey) {
            throw new Error("OpenRouter API Key not found.");
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${effectiveApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": finalModelName,
                "messages": [
                    { "role": "user", "content": prompt }
                ],
                "stream": true
            }),
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        if (!response.body) {
            throw new Error("OpenRouter stream response has no body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (abortSignal.aborted) {
                reader.cancel();
                throw new Error('Aborted');
            }
            
            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the last, potentially incomplete line

            for (const line of lines) {
                if (line.trim() === '' || !line.startsWith('data: ')) continue;
                
                const data = line.substring(6).trim();
                if (data === '[DONE]') {
                    break;
                }
                
                try {
                    const json = JSON.parse(data);
                    const content = json.choices[0]?.delta?.content;
                    if (content) {
                        fullResponseText += content;
                        onStreamingChunk(fullResponseText);
                    }
                } catch (e) {
                    console.error('Error parsing stream chunk:', data, e);
                }
            }
        }
    }

    if (abortSignal.aborted) {
        throw new Error('Aborted');
    }
    
    try {
        const cleanedJson = cleanJsonString(fullResponseText);
        onStreamingChunk(cleanedJson);
        const parsed = JSON.parse(cleanedJson);
        return { data: parsed, signature: capturedSignature };
    } catch (e: any) {
        console.error("Final JSON parse failed. Raw response:", fullResponseText);
        throw new RegenerationRequiredError(e.message, `Failed to parse response from LLM. Raw text: ${fullResponseText}`, fullResponseText);
    }
}

async function attemptCorrection(
    invalidJson: string, 
    context: GameContext, 
    error: Error,
    originalModelName: string,
    aiProvider: string,
    apiKey: string
): Promise<any> {
    console.log("Attempting self-correction...");
    const correctionPrompt = getCorrectionPrompt(invalidJson, context, error);
    
    const correctionModel = context.gameSettings.correctionModelName || 'gemini-2.5-flash';
    const correctionProvider = context.gameSettings.correctionModelName ? 'gemini' : aiProvider;

    const correctionContext = { 
        ...context, 
        image: null,
        gameSettings: {
            ...context.gameSettings,
            useGoogleSearch: false // Always disable search for correction
        }
    };
    
    const correctionResponseText = await callGenerativeApiRaw(
        correctionPrompt, 
        correctionContext, 
        new AbortController().signal, 
        correctionModel, 
        correctionProvider,
        apiKey
    );

    const cleanedForCorrection = cleanJsonString(correctionResponseText);
    const parsedCorrection = JSON.parse(cleanedForCorrection); // This might throw, to be caught by the loop

    if (parsedCorrection.regenerationRequired) {
        console.log("Correction AI indicated regeneration is required.", parsedCorrection.reason);
        return { regenerationRequired: true, reason: parsedCorrection.reason };
    }
    
    console.log("Correction successful!");
    return parsedCorrection;
}

/**
 * Executes a generation step with potential self-correction.
 * Returns an object containing the parsed JSON response data AND the thought signature.
 */
export async function executeStepWithCorrection(
    stepName: string,
    promptFn: () => string,
    context: GameContext,
    partiallyGeneratedResponse: any,
    abortSignal: AbortSignal,
    onPartialResponse: (response: any, stepName: string, modelName: string) => void,
    onStreamingChunk: (text: string) => void,
    onStepStart: (stepName: string, modelName: string) => void
): Promise<{ response: any, signature?: string }> {
    let lastError: any = null;
    let additionalGuides = '';

    // Add guides based on the step name
    if (stepName === 'Step0_AnalysisAndPlanning_TaskGuide' || stepName === 'Step0_5_Verification_TaskGuide') {
        additionalGuides += worldLogicGuide.getGuide();
    }
    if (stepName === 'Step_FactionProgression_TaskGuide' || stepName === 'Step_WorldProgression_TaskGuide') {
        additionalGuides += narrativeStyleGuide.getGuide();
        additionalGuides += worldLogicGuide.getGuide();
    }
    // Step 1 renamed to Step 6
    if (stepName === 'Step6_NarrativeGeneration_TaskGuide') {
        additionalGuides += narrativeStyleGuide.getGuide();
    }
    // Step 3 Logs
    if (stepName === 'Step3_Logs_CombatAnalysis_TaskGuide') {
        additionalGuides += worldLogicGuide.getGuide();
    }
    if (stepName === 'Step4_NPC_TaskGuide') {
        additionalGuides += narrativeStyleGuide.getGuide();
        additionalGuides += worldLogicGuide.getGuide();
    }
    if (stepName === 'Step5_Inventory_TaskGuide') {
        additionalGuides += narrativeStyleGuide.getGuide();
    }
    if (stepName === 'StepQuestion_CorrectionAndClarification_TaskGuide') {
        additionalGuides += narrativeStyleGuide.getGuide();
        additionalGuides += worldLogicGuide.getGuide();
    }

    for (let attempt = 1; attempt <= MAX_REGENERATION_RETRIES; attempt++) {
        const stepContext = { 
            ...context, 
            partiallyGeneratedResponse: JSON.stringify(partiallyGeneratedResponse), 
            currentStepFocus: stepName, 
            isRegenerationAttempt: attempt > 1,
            regenerationReason: lastError?.reason || '' 
        };
        const stepPrompt = promptFn();
        const fullPrompt = stepPrompt + additionalGuides + mainPromptModule.getGameMasterGuideRules(stepContext);
        const model = getModelForStep(stepName, context);
        onStepStart(stepName, model);
        
        try {
            const { data: stepResponse, signature } = await callGenerativeApi(
                fullPrompt, 
                stepContext, 
                abortSignal, 
                onStreamingChunk, 
                model, 
                context.gameSettings.aiProvider, 
                context.gameSettings.geminiApiKey || context.gameSettings.openRouterApiKey || ''
            );
            
            const newPartialResponse = deepMergeResponses(partiallyGeneratedResponse, stepResponse);
            onPartialResponse(newPartialResponse, stepName, model);
            return { response: newPartialResponse, signature };

        } catch (err: any) {
            lastError = err;
            if (abortSignal.aborted) throw err;
            
            console.warn(`Step '${stepName}' failed on regeneration attempt ${attempt}. Reason: ${err.message}`);

            if (err instanceof RegenerationRequiredError && err.rawText) {
                const MAX_CORRECTION_RETRIES = 10;
                let correctionSuccessful = false;
                let correctedResponse = null;

                for (let correctionAttempt = 1; correctionAttempt <= MAX_CORRECTION_RETRIES; correctionAttempt++) {
                     console.log(`Attempting self-correction for step '${stepName}', attempt ${correctionAttempt}/${MAX_CORRECTION_RETRIES}...`);
                    try {
                        const correctionResult = await attemptCorrection(
                            err.rawText, 
                            stepContext, 
                            err, 
                            model, 
                            context.gameSettings.aiProvider, 
                            context.gameSettings.geminiApiKey || context.gameSettings.openRouterApiKey || ''
                        );

                        if (correctionResult.regenerationRequired) {
                            console.log("Correction AI indicated regeneration is required.", correctionResult.reason);
                            lastError = { ...lastError, reason: correctionResult.reason };
                            break;
                        }
                        
                        console.log("Correction attempt produced valid JSON.");
                        correctedResponse = deepMergeResponses(partiallyGeneratedResponse, correctionResult);
                        correctionSuccessful = true;
                        break;

                    } catch (correctionError: any) {
                        console.warn(`Correction attempt ${correctionAttempt} failed. Error: ${correctionError.message}`);
                    }
                }

                if (correctionSuccessful && correctedResponse) {
                    console.log("Correction succeeded.");
                    onPartialResponse(correctedResponse, stepName, model);
                    // Note: Self-correction via standard generation doesn't return a signature usually, unless we upgrade attemptCorrection to do so.
                    // For now, if correction succeeds, we accept the data but might lose the signature chain for this specific error case, which is acceptable fallback.
                    return { response: correctedResponse, signature: undefined };
                } else {
                    console.log("Correction failed after all attempts or was explicitly requested by AI. Proceeding to next regeneration attempt...");
                    continue;
                }
            } else {
                console.log("Error is not a parsing error or has no raw text. Retrying step...");
                continue;
            }
        }
    }
    
    throw new Error(`Failed to execute step '${stepName}' after ${MAX_REGENERATION_RETRIES} attempts. Last error: ${lastError?.message}`);
}

export const getModelForStep = (stepName: string, context: GameContext): string => {
    const { isCustomModel, customModelName, modelName, correctionModelName, aiProvider, openRouterModelName } = context.gameSettings;
    if (aiProvider === 'openrouter') {
        return openRouterModelName || 'google/gemini-flash-1.5';
    }

    if (isCustomModel) {
        return customModelName || 'gemini-2.5-flash';
    }
    
    if (stepName === 'Step0_5_Verification_TaskGuide' && correctionModelName) {
        return correctionModelName;
    }
    return modelName || 'gemini-2.5-flash';
};

export async function executeTurn(
    context: GameContext,
    abortSignal: AbortSignal,
    onPartialResponse: (response: any, stepName: string, modelName: string) => void,
    onStreamingChunk: (text: string) => void,
    onStepStart: (stepName: string, modelName: string) => void,
): Promise<GameResponse> {
    let partiallyGeneratedResponse: any = {};
    // Use the previous thought signature from context if available to start the chain
    let currentSignature = context.previousThoughtSignature;

    const executeStep = async (stepName: string, promptFn: () => string) => {
        const currentContext = { ...context, previousThoughtSignature: currentSignature };
        const result = await executeStepWithCorrection(
            stepName, 
            promptFn, 
            currentContext, 
            partiallyGeneratedResponse, 
            abortSignal, 
            onPartialResponse, 
            onStreamingChunk, 
            onStepStart
        );
        partiallyGeneratedResponse = result.response;
        // Update the signature for the next step in the chain
        if (result.signature) {
            currentSignature = result.signature;
        }
        return result.response;
    };

    await executeStep('Step0_AnalysisAndPlanning_TaskGuide', mainPromptSteps.getStep0);
    
    if (partiallyGeneratedResponse._internal_flags_?.needsSelfCorrection) {
        await executeStep('Step0_5_Verification_TaskGuide', mainPromptSteps.getStep0_5);
    }
    
    const doNotUseWorldEvents = context.gameSettings.doNotUseWorldEvents ?? false;
    
    // Faction Progression (Conditional)
    if (partiallyGeneratedResponse._internal_flags_?.needsFactionProgression === true && !doNotUseWorldEvents) {
        await executeStep('Step_FactionProgression_TaskGuide', mainPromptSteps.getStepFactionProgression);
    }

    // World Progression (Conditional)
    if (partiallyGeneratedResponse._internal_flags_?.needsWorldProgression === true && !doNotUseWorldEvents) {
        await executeStep('Step_WorldProgression_TaskGuide', mainPromptSteps.getStepWorldProgression);
    }
    
    if (partiallyGeneratedResponse._internal_flags_?.isSimpleTurn) {
        await executeStep('StepSimpleFullResponse_TaskGuide', mainPromptSteps.getStepSimpleFullResponse);
        // Attach the final signature to the response object so it can be saved in state
        (partiallyGeneratedResponse as GameResponse).thoughtSignature = currentSignature;
        return partiallyGeneratedResponse as GameResponse;
    }

    // Step 2: Core State (Always runs for complex turn)
    await executeStep('Step2_CoreState_TaskGuide', mainPromptSteps.getStep2);

    // Step 3 Logs + Step 3 Combat (Conditional)
    if (partiallyGeneratedResponse._internal_flags_?.isCombatActive === true) {
        await executeStep('Step3_Logs_CombatAnalysis_TaskGuide', mainPromptSteps.getStep3Logs);
        await executeStep('Step3_Combat_TaskGuide', mainPromptSteps.getStep3);
    }

    // Step 4: NPC (Conditional)
    if (partiallyGeneratedResponse._internal_flags_?.needsNPCProcessing === true) {
        await executeStep('Step4_NPC_TaskGuide', mainPromptSteps.getStep4);
    }

    // Step 5: Inventory (Conditional)
    if (partiallyGeneratedResponse._internal_flags_?.needsInventoryProcessing === true) {
        await executeStep('Step5_Inventory_TaskGuide', mainPromptSteps.getStep5);
    }

    // Step 6: Narrative (Narrative Generation)
    await executeStep('Step6_NarrativeGeneration_TaskGuide', mainPromptSteps.getStep6);

    // Step 7: Finalization (Always runs for complex turn)
    await executeStep('Step7_Finalization_TaskGuide', mainPromptSteps.getStep7);

    // Attach the final signature to the response object so it can be saved in state
    (partiallyGeneratedResponse as GameResponse).thoughtSignature = currentSignature;

    return partiallyGeneratedResponse as GameResponse;
}

export async function askGmQuestion(
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void,
    onStepStart: (stepName: string, modelName: string) => void,
): Promise<GameResponse> {
    const onPartialResponse = (response: any, stepName: string, modelName: string) => {
        // This is a single-step process, so onPartialResponse is equivalent to the final response.
        // We don't need to do anything special here as the final return will handle the full object.
    };

    // Pass current signature from context
    const result = await executeStepWithCorrection(
        'StepQuestion_CorrectionAndClarification_TaskGuide',
        mainPromptSteps.getStepQuestion,
        context,
        {}, // Start with an empty partially generated response
        abortSignal,
        onPartialResponse,
        onStreamingChunk,
        onStepStart
    );

    const response = result.response as GameResponse;
    response.thoughtSignature = result.signature;

    return response;
}

export async function executeWorldProgression(
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void,
    onPartialResponse: (response: any, stepName: string, modelName: string) => void,
    onStepStart: (stepName: string, modelName: string) => void,
): Promise<GameResponse> {
     const result = await executeStepWithCorrection(
        'Step_WorldProgression_TaskGuide',
         mainPromptSteps.getStepWorldProgression,
        context,
        {},
        abortSignal,
        onPartialResponse,
        onStreamingChunk,
        onStepStart
    );
    
    const response = result.response as GameResponse;
    response.thoughtSignature = result.signature;
    return response;
}

export async function getMusicSuggestionFromAi(
    context: GameContext,
    previousQueries: string[]
): Promise<{ prompt: string; reasoning: string; } | null> {
    
    const summarizedContext = {
        last_messages: context.responseHistory.slice(-6).map(m => `${m.sender}: ${m.content}`).join('\n'),
        location_description: context.currentLocation.description,
        player_status: context.previousTurnResponse?.playerStatus,
        plot_summary: context.plotOutline?.mainArc.summary,
        game_world: context.gameSettings.gameWorldInformation.baseInfo.name,
        previous_queries: previousQueries,
        user_language: context.gameSettings.language,
    };
    
    let prompt = getMusicPrompt(summarizedContext);
    if (context.gameSettings.adultMode) {
        prompt += getAdultPrompt();
    }

    let lastError: any = null;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const apiKey = process.env.API_KEY;
            if (!apiKey) {
                throw new Error("Gemini API Key not found in process.env.API_KEY.");
            }
            const ai = new GoogleGenAI({ apiKey });
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    safetySettings: disabledSafetySettings,
                }
            });
            
            let textResponse = response.text || '';
            
            if (context.gameSettings.adultMode) {
                textResponse = deepStripModerationSymbols(textResponse);
            }

            const jsonStr = cleanJsonString(textResponse);
            
            const parsed = JSON.parse(jsonStr);
            
            if (parsed && parsed.prompt && parsed.reasoning) {
                console.log(`Music suggestion succeeded on attempt ${attempt}`);
                return {
                    prompt: parsed.prompt,
                    reasoning: parsed.reasoning,
                };
            } else {
                throw new Error(`AI music suggestion response was not in the expected format: ${textResponse}`);
            }

        } catch (err: any) {
            lastError = err;
            console.warn(`Music suggestion attempt ${attempt} failed:`, err);
            if (attempt === MAX_RETRIES) {
                console.error("Error getting music suggestion from AI after all retries:", err);
                throw new Error(`The AI failed to generate a music suggestion after ${MAX_RETRIES} attempts. Last error: ${err.message}`);
            }
            // Wait a little before retrying
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }
    }

    // This part should not be reached if the loop is correct, but as a fallback:
    if (lastError) {
        throw lastError;
    }
    
    return null; // Fallback
}

export async function generateSurpriseMusicPrompt(): Promise<string> {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: "Generate a creative and descriptive prompt for an AI music generator. The prompt should be evocative and detailed, suitable for creating instrumental music for a fantasy RPG. Don't use quotes or labels. Just provide the prompt text itself."
        });
        return response.text ? response.text.trim() : '';
    } catch (e) {
        console.error("Error generating surprise prompt:", e);
        throw e;
    }
}

export async function translateToEnglish(text: string, context: GameContext): Promise<string> {
    if (!text || !text.trim()) {
        return "";
    }
    
    if (/^[a-zA-Z0-9\s.,!?'"-]+$/.test(text)) {
        return text;
    }

    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            console.warn("Gemini API Key not found for translation.");
            return text;
        }
        const ai = new GoogleGenAI({ apiKey });
        
        const prompt = `Translate the following text to English. Respond with only the translated text, without any additional explanations or formatting. If the text is already in English, return it unchanged.\n\nText to translate:\n"""\n${text}\n"""`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                safetySettings: disabledSafetySettings
            }
        });

        const translatedText = response.text ? response.text.trim() : '';
        return translatedText;

    } catch (err) {
        console.error("Error translating text to English:", err);
        return text;
    }
}

export async function executeCancellableJsonGeneration(
    prompt: string,
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void,
    systemInstruction?: string
): Promise<any> {
    const { modelName, aiProvider, geminiApiKey, openRouterApiKey, useDynamicThinkingBudget, geminiThinkingBudget } = context.gameSettings;
    const isGemini3 = modelName.includes('gemini-3');

    if (aiProvider !== 'gemini') {
        throw new Error("Only Gemini provider is supported for this cinematic generation feature.");
    }
    
    const effectiveApiKey = process.env.API_KEY;
    if (!effectiveApiKey) {
        throw new Error("Gemini API Key not found in process.env.API_KEY.");
    }

    const ai = new GoogleGenAI({ apiKey: effectiveApiKey });

    const modelConfig: any = {
        model: modelName,
        contents: prompt,
        signal: abortSignal,
    };
    
    modelConfig.config = {
        responseMimeType: "application/json",
    };

    if (systemInstruction) {
        modelConfig.config.systemInstruction = systemInstruction;
    }

    if (!modelName.includes('image')) {
        modelConfig.config.safetySettings = disabledSafetySettings;
    }

    if (isGemini3) {
         const level = context.gameSettings.geminiThinkingLevel === 'low' ? 'LOW' : 'HIGH';
         modelConfig.config.thinkingConfig = {
            includeThoughts: true,
            thinkingLevel: level
         } as any;
    } else {
         const budget = useDynamicThinkingBudget ? undefined : geminiThinkingBudget;
         if (budget !== undefined) {
            modelConfig.config.thinkingConfig = { thinkingBudget: budget };
         }
    }
    
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_REGENERATION_RETRIES; attempt++) {
        let fullResponseText = '';
        try {
            const stream = await ai.models.generateContentStream(modelConfig);
            for await (const chunk of stream) {
                if (abortSignal.aborted) {
                    throw new DOMException('Aborted by user.', 'AbortError');
                }
                const chunkText = chunk.text;
                if (chunkText) {
                    fullResponseText += chunkText;
                }
                onStreamingChunk(fullResponseText);
            }
        
            if (abortSignal.aborted) {
                throw new DOMException('Aborted by user.', 'AbortError');
            }

            if (!fullResponseText.trim()) {
                throw new Error("Received empty response from the model.");
            }

            const cleanedJson = cleanJsonString(fullResponseText);
            onStreamingChunk(cleanedJson);
            const parsed = JSON.parse(cleanedJson);
            return parsed; // Success!

        } catch (e: any) {
            lastError = e;
            if (abortSignal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
                throw e;
            }

            console.warn(`Cancellable JSON generation failed on attempt ${attempt}. Reason: ${e.message}`);
            
            if (!fullResponseText.trim()) {
                console.log("Response was empty, retrying generation.");
                continue;
            }

            const MAX_CORRECTION_RETRIES = 10;
            let correctionSuccessful = false;
            let correctedResponse = null;

            for (let correctionAttempt = 1; correctionAttempt <= MAX_CORRECTION_RETRIES; correctionAttempt++) {
                 console.log(`Attempting self-correction for cancellable generation, attempt ${correctionAttempt}/${MAX_CORRECTION_RETRIES}...`);
                try {
                    const correctionResult = await attemptCorrection(
                        fullResponseText, 
                        context, 
                        e, 
                        modelName, 
                        aiProvider, 
                        effectiveApiKey
                    );

                    if (correctionResult.regenerationRequired) {
                        console.log("Correction AI indicated regeneration is required.", correctionResult.reason);
                        lastError = { ...lastError, reason: correctionResult.reason };
                        break; // Break correction loop to trigger regeneration
                    }
                    
                    console.log("Correction attempt produced valid JSON.");
                    correctedResponse = correctionResult;
                    correctionSuccessful = true;
                    break; // Success, break correction loop

                } catch (correctionError: any) {
                    console.warn(`Correction attempt ${correctionAttempt} failed. Error: ${correctionError.message}`);
                    lastError = correctionError;
                }
            }

            if (correctionSuccessful && correctedResponse) {
                console.log("Correction succeeded.");
                return correctedResponse;
            } else {
                console.log("Correction failed or regeneration was requested. Proceeding to next regeneration attempt...");
                continue; // to next regeneration attempt
            }
        }
    }
    
    throw new Error(`Failed to generate a valid JSON response for the cinematic after ${MAX_REGENERATION_RETRIES} attempts. Last error: ${lastError?.message}`);
}
