
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
import { requestArenaGmStep } from './arenaGmRelay';

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
): Promise<string> {
    const relayContext = context as GameContext & { isRegenerationAttempt?: boolean };
    const result = await requestArenaGmStep(
        prompt,
        context.currentStepFocus || 'StandaloneGeneration',
        'Arena GM',
        relayContext.isRegenerationAttempt ? 2 : 1,
        abortSignal,
        context.gameSettings.adultMode ? getAdultPrompt() : undefined,
    );
    return result.text;
}

/** Requests and parses one JSON stage response from the Arena agent. */
export async function callGenerativeApi(
    prompt: string,
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void
): Promise<{ data: any, signature?: string }> {
    const relayContext = context as GameContext & { isRegenerationAttempt?: boolean };
    const relayResult = await requestArenaGmStep(
        prompt,
        context.currentStepFocus || 'StandaloneGeneration',
        'Arena GM',
        relayContext.isRegenerationAttempt ? 2 : 1,
        abortSignal,
        context.gameSettings.adultMode ? getAdultPrompt() : undefined,
    );
    onStreamingChunk(relayResult.text);
    try {
        return { data: JSON.parse(cleanJsonString(relayResult.text)), signature: relayResult.thoughtSignature };
    } catch (error: any) {
        throw new RegenerationRequiredError(error.message, `Invalid JSON returned by Arena GM for ${context.currentStepFocus || 'step'}.`, relayResult.text);
    }
}

async function attemptCorrection(
    invalidJson: string,
    context: GameContext,
    error: Error,
): Promise<any> {
    const correctionContext = {
        ...context,
        image: null,
        currentStepFocus: `${context.currentStepFocus || 'Step'}_Correction`,
        isRegenerationAttempt: true,
    } as GameContext & { isRegenerationAttempt: boolean };
    const correctionText = await callGenerativeApiRaw(
        getCorrectionPrompt(invalidJson, context, error),
        correctionContext,
        new AbortController().signal,
    );
    return JSON.parse(cleanJsonString(correctionText));
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
    // Every step that writes player-facing prose must receive the narrative guide.
    // Simple turns bypass Step 6, so they need the same guide on their one-shot response step.
    if (stepName === 'Step6_NarrativeGeneration_TaskGuide' || stepName === 'StepSimpleFullResponse_TaskGuide') {
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

export const getModelForStep = (_stepName: string, _context: GameContext): string => 'Arena GM';

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
    const prompt = getMusicPrompt(summarizedContext) + (context.gameSettings.adultMode ? getAdultPrompt() : '');
    const result = await requestArenaGmStep(
        `${prompt}\nReturn a JSON object with exactly two string fields: prompt and reasoning.`,
        'MusicSuggestion', 'Arena GM', 1, undefined,
        context.gameSettings.adultMode ? getAdultPrompt() : undefined,
    );
    const parsed = JSON.parse(cleanJsonString(result.text));
    if (typeof parsed?.prompt !== 'string' || typeof parsed?.reasoning !== 'string') {
        throw new Error('Arena GM music suggestion must include prompt and reasoning strings.');
    }
    return { prompt: parsed.prompt, reasoning: parsed.reasoning };
}

export async function generateSurpriseMusicPrompt(): Promise<string> {
    const result = await requestArenaGmStep(
        'Create a vivid, evocative instrumental music-generation prompt for a fantasy role-playing game. Return a JSON object with exactly one string field named prompt.',
        'SurpriseMusicPrompt', 'Arena GM', 1,
    );
    const parsed = JSON.parse(cleanJsonString(result.text));
    if (typeof parsed?.prompt !== 'string') throw new Error('Arena GM did not return a music prompt.');
    return parsed.prompt;
}

export async function translateToEnglish(text: string, _context: GameContext): Promise<string> {
    if (!text || !text.trim()) return '';
    if (/^[a-zA-Z0-9\s.,!?'\"-]+$/.test(text)) return text;
    try {
        const result = await requestArenaGmStep(
            `Translate the text below to English. Preserve its meaning and return a JSON object with exactly one string field named translation.\n\nText:\n${JSON.stringify(text)}`,
            'TranslateImagePrompt', 'Arena GM', 1,
        );
        const parsed = JSON.parse(cleanJsonString(result.text));
        return typeof parsed?.translation === 'string' ? parsed.translation : text;
    } catch (error) {
        console.error('Error translating text through Arena GM:', error);
        return text;
    }
}

export async function executeCancellableJsonGeneration(
    input: string | { promptContent: string; systemInstruction?: string },
    context: GameContext,
    abortSignal: AbortSignal,
    onStreamingChunk: (text: string) => void,
    systemInstruction?: string
): Promise<any> {
    const prompt = typeof input === 'string' ? input : input.promptContent;
    const effectiveSystemInstruction = systemInstruction || (typeof input === 'string' ? undefined : input.systemInstruction);
    const result = await requestArenaGmStep(
        prompt, context.currentStepFocus || 'CinematicGeneration', 'Arena GM', 1,
        abortSignal, effectiveSystemInstruction,
    );
    onStreamingChunk(result.text);
    try {
        return JSON.parse(cleanJsonString(result.text));
    } catch (error: any) {
        throw new RegenerationRequiredError(
            error.message,
            'Arena GM returned invalid JSON for cinematic generation.',
            result.text,
        );
    }
}
