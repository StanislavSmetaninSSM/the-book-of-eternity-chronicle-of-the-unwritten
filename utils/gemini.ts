import { ensureThreatActivityIds } from './gameContext';
import { errorMessage } from './errorUtils';
import { asRecord } from './typeGuards';

import { GameContext, GameResponse, Cinematic } from '../types';
// @ts-ignore
import { getMusicPrompt } from '../prompts/musicPrompt.js';
// @ts-ignore
import { getCorrectionPrompt, getAdultPrompt } from '../prompts/systemPrompts.js';
import { mergeStageResponses } from "./responseProcessor";
import { ArenaGmRelayRequestError, requestArenaGmStep } from './arenaGmRelay';
import { withGameContext } from './relayPromptContext.js';
import { shouldRunWorldProgression } from './worldProgression.js';
import { NARRATIVE_FOCUS } from './narrativeFocus.js';
import { getNarrativeRuleReference } from './arenaRuleReference.js';

// The Game Master rulebook (about 3 MB of source text), the stage guides and the step
// prompt builders are only needed once a turn is actually generated. They are loaded on
// demand so the start screen does not have to download and parse them.
let mainPromptModulePromise: Promise<typeof import('../prompts/mainPromptModule.js')> | null = null;
const loadMainPromptModule = () => (mainPromptModulePromise ??= import('../prompts/mainPromptModule.js'));

let promptStepsPromise: Promise<typeof import('../prompts/mainPromptSteps.js')> | null = null;
const loadPromptSteps = () => (promptStepsPromise ??= import('../prompts/mainPromptSteps.js'));

type StageGuides = { narrative: { getGuide: () => string }; world: { getGuide: () => string } };
let stageGuidesPromise: Promise<StageGuides> | null = null;
const loadStageGuides = (): Promise<StageGuides> => (stageGuidesPromise ??= Promise.all([
    import('../prompts/narrativeStyleGuide.js'),
    import('../prompts/worldLogicGuide.js'),
]).then(([narrative, world]) => ({ narrative: narrative.default, world: world.default } as StageGuides)));

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
    cleaned = cleaned.replace(/("(?:\\.|[^\\"])*")|([:\[,]\s*)0+([1-9]\d*)/g, (_match, stringContent, separator, number) => {
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
        withGameContext(prompt, context),
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
    onStreamingChunk: (text: string) => void,
    ruleBundleId?: string
): Promise<{ data: Partial<GameResponse>, signature?: string }> {
    const relayContext = context as GameContext & { isRegenerationAttempt?: boolean };
    const relayResult = await requestArenaGmStep(
        withGameContext(prompt, context),
        context.currentStepFocus || 'StandaloneGeneration',
        'Arena GM',
        relayContext.isRegenerationAttempt ? 2 : 1,
        abortSignal,
        context.gameSettings.adultMode ? getAdultPrompt() : undefined,
        ruleBundleId,
    );
    onStreamingChunk(relayResult.text);
    let data: Partial<GameResponse>;
    try {
        data = JSON.parse(cleanJsonString(relayResult.text));
    } catch (error: unknown) {
        throw new RegenerationRequiredError(errorMessage(error), `Invalid JSON returned by Arena GM for ${context.currentStepFocus || 'step'}.`, relayResult.text);
    }
    if (ruleBundleId && data?._arenaRuleBundleUnavailable === true) {
        throw new ArenaGmRelayRequestError(409, 'The GM could not access the verified rule bundle.');
    }
    return { data, signature: relayResult.thoughtSignature };
}

async function attemptCorrection(
    invalidJson: string,
    context: GameContext,
    error: Error,
    abortSignal: AbortSignal,
): Promise<Partial<GameResponse>> {
    const correctionContext = {
        ...context,
        image: null,
        currentStepFocus: `${context.currentStepFocus || 'Step'}_Correction`,
        isRegenerationAttempt: true,
    } as GameContext & { isRegenerationAttempt: boolean };
    const correctionText = await callGenerativeApiRaw(
        await getCorrectionPrompt(invalidJson, context, error),
        correctionContext,
        abortSignal,
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
    partiallyGeneratedResponse: Partial<GameResponse>,
    abortSignal: AbortSignal,
    onPartialResponse: (response: Partial<GameResponse>, stepName: string, modelName: string) => void,
    onStreamingChunk: (text: string) => void,
    onStepStart: (stepName: string, modelName: string) => void
): Promise<{ response: GameResponse, signature?: string }> {
    let lastError: unknown = null;
    let additionalGuides = '';
    const guides = await loadStageGuides();
    const narrativeStyleGuide = guides.narrative;
    const worldLogicGuide = guides.world;

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

    const isNarrative = stepName === 'Step6_NarrativeGeneration_TaskGuide' || stepName === 'StepSimpleFullResponse_TaskGuide';
    // The pilot covers narrative, NPC detail, inventory, combat audit, world and faction progression.
    // Simple turns, remaining mechanical stages and first-turn setup keep full inline guides.
    const { getGameMasterGuideRules } = await loadMainPromptModule();
    const fullRules = getGameMasterGuideRules();
    const useReference = stepName === 'Step6_NarrativeGeneration_TaskGuide' || stepName === 'Step4_NPC_TaskGuide' || (stepName === 'Step5_Inventory_TaskGuide' && context.currentTurnNumber > 1) || (stepName === 'Step3_Combat_TaskGuide' && context.currentTurnNumber > 1) || (stepName === 'Step_WorldProgression_TaskGuide' && context.currentTurnNumber > 1) || (stepName === 'Step_FactionProgression_TaskGuide' && context.currentTurnNumber > 1);
    const reference = useReference
        ? await getNarrativeRuleReference(fullRules, narrativeStyleGuide.getGuide(), abortSignal, worldLogicGuide.getGuide(), stepName)
        : null;

    for (let attempt = 1; attempt <= MAX_REGENERATION_RETRIES; attempt++) {
        const stepContext = { 
            ...context, 
            partiallyGeneratedResponse: JSON.stringify(partiallyGeneratedResponse), 
            currentStepFocus: stepName, 
            isRegenerationAttempt: attempt > 1,
            regenerationReason: (asRecord(lastError)?.reason as string | undefined) || '' 
        };
        const stepPrompt = promptFn();
        const focus = isNarrative ? NARRATIVE_FOCUS : '';
        const fullPrompt = stepPrompt + additionalGuides + fullRules + focus;
        const referencedPrompt = reference ? stepPrompt + reference.prompt + focus : fullPrompt;
        const model = getModelForStep(stepName, context);
        onStepStart(stepName, model);
        
        try {
            let result;
            try {
                result = await callGenerativeApi(referencedPrompt, stepContext, abortSignal, onStreamingChunk, reference?.id);
            } catch (error) {
                // The server verifies the bundle immediately before queueing; a
                // lost/corrupt bundle falls back to the original complete prompt.
                if (!reference || !(error instanceof ArenaGmRelayRequestError) || error.status !== 409) throw error;
                result = await callGenerativeApi(fullPrompt, stepContext, abortSignal, onStreamingChunk);
            }
            const { data: stepResponse, signature } = result;

            const newPartialResponse = mergeStageResponses(partiallyGeneratedResponse, stepResponse, context);
            onPartialResponse(newPartialResponse, stepName, model);
            return { response: newPartialResponse, signature };

        } catch (err: unknown) {
            lastError = err;
            if (abortSignal.aborted || err instanceof ArenaGmRelayRequestError) throw err;
            
            console.warn(`Step '${stepName}' failed on regeneration attempt ${attempt}. Reason: ${errorMessage(err)}`);

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
                            abortSignal,
                        );

                        if (correctionResult.regenerationRequired) {
                            console.log("Correction AI indicated regeneration is required.", correctionResult.reason);
                            lastError = { ...(asRecord(lastError) ?? {}), reason: correctionResult.reason };
                            break;
                        }
                        
                        console.log("Correction attempt produced valid JSON.");
                        correctedResponse = mergeStageResponses(partiallyGeneratedResponse, correctionResult, context);
                        correctionSuccessful = true;
                        break;

                    } catch (correctionError: unknown) {
                        if (abortSignal.aborted) throw correctionError;
                        console.warn(`Correction attempt ${correctionAttempt} failed. Error: ${errorMessage(correctionError)}`);
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
    
    throw new Error(`Failed to execute step '${stepName}' after ${MAX_REGENERATION_RETRIES} attempts. Last error: ${errorMessage(lastError)}`);
}

export const getModelForStep = (_stepName: string, _context: GameContext): string => 'Arena GM';

export async function executeTurn(
    context: GameContext,
    abortSignal: AbortSignal,
    onPartialResponse: (response: Partial<GameResponse>, stepName: string, modelName: string) => void,
    onStreamingChunk: (text: string) => void,
    onStepStart: (stepName: string, modelName: string) => void,
): Promise<GameResponse> {
    ensureThreatActivityIds(context.worldMap || {}, context.currentLocation);
    let partiallyGeneratedResponse: Partial<GameResponse> = {};
    // Use the previous thought signature from context if available to start the chain
    let currentSignature = context.previousThoughtSignature;
    const mainPromptSteps = await loadPromptSteps();

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

    // Enforce first-turn setup after the auditor, which can also change flags.
    if (context.currentTurnNumber === 1) {
        const flags = partiallyGeneratedResponse._internal_flags_ ||= {};
        flags.isSimpleTurn = false;
        flags.needsInventoryProcessing = true;
        if (!context.gameSettings.doNotUseWorldEvents) {
            flags.needsWorldProgression = true;
            flags.needsFactionProgression = true;
        }
    }

    // Faction events can create NPC consequences after Step 0 has set its flags.
    let factionEventChanged = false;
    if (shouldRunWorldProgression(partiallyGeneratedResponse._internal_flags_?.needsFactionProgression, context.gameSettings)) {
        const previousEvents = JSON.stringify(partiallyGeneratedResponse.worldEventsLog ?? []);
        await executeStep('Step_FactionProgression_TaskGuide', mainPromptSteps.getStepFactionProgression);
        factionEventChanged = previousEvents !== JSON.stringify(partiallyGeneratedResponse.worldEventsLog ?? []);
    }

    let worldProgressionRan = false;
    if (shouldRunWorldProgression(partiallyGeneratedResponse._internal_flags_?.needsWorldProgression, context.gameSettings)) {
        await executeStep('Step_WorldProgression_TaskGuide', mainPromptSteps.getStepWorldProgression);
        worldProgressionRan = true;
    }
    // Only Step 4 can report NPC activities, goals and quests. Hand it world
    // simulation and faction-event results even when Step 0 marked a turn simple.
    // Neither world/faction progression nor a reaction is invented by this gate.
    const reportedNPCs = partiallyGeneratedResponse.NPCsData;
    const hasReportedNPCs = Array.isArray(reportedNPCs) ? reportedNPCs.length > 0 : !!reportedNPCs && typeof reportedNPCs === 'object';
    if ((worldProgressionRan || factionEventChanged) && (context.encounteredNPCs?.length || hasReportedNPCs)) {
        const flags = partiallyGeneratedResponse._internal_flags_ ||= {};
        flags.needsNPCProcessing = true;
        flags.isSimpleTurn = false;
    }
    
    // Inventory work (including transfers) belongs to Step 5. If the model
    // reports contradictory flags, do not let the simple path skip that step.
    if (partiallyGeneratedResponse._internal_flags_?.needsInventoryProcessing === true) {
        partiallyGeneratedResponse._internal_flags_.isSimpleTurn = false;
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
        // Combat calculation logs may change equipped-item durability after
        // Step 0 set its flags. The relevant item commands belong to Steps 4/5.
        const hasEquipment = (actor: unknown) => {
            const equipped = asRecord(asRecord(actor)?.equippedItems);
            return !!equipped && Object.values(equipped).some(Boolean);
        };
        const flags = partiallyGeneratedResponse._internal_flags_ ||= {};
        if (hasEquipment(context.playerCharacter)) flags.needsInventoryProcessing = true;
        const combatants = [
            ...(context.enemiesDataForCurrentTurn || []), ...(context.alliesDataForCurrentTurn || []),
            ...(Array.isArray(partiallyGeneratedResponse.enemiesData) ? partiallyGeneratedResponse.enemiesData : []),
            ...(Array.isArray(partiallyGeneratedResponse.alliesData) ? partiallyGeneratedResponse.alliesData : []),
        ];
        const npcIds = new Set(combatants.map(combatant => combatant?.NPCId).filter(Boolean));
        if (context.encounteredNPCs?.some(npc => npc.NPCId && npcIds.has(npc.NPCId) && hasEquipment(npc))) flags.needsNPCProcessing = true;
        // When combat ends directly with empty rosters, only Step 4 may write
        // NPCsData. Let it transfer explicitly calculated NPC health from the
        // combat logs; do not infer a final result from pre-turn state.
        const combatEnded = Array.isArray(partiallyGeneratedResponse.enemiesData) && partiallyGeneratedResponse.enemiesData.length === 0 &&
            Array.isArray(partiallyGeneratedResponse.alliesData) && partiallyGeneratedResponse.alliesData.length === 0;
        const hasNamedNpcs = context.encounteredNPCs?.some(npc => !!npc.NPCId) ||
            (Array.isArray(partiallyGeneratedResponse.NPCsData) && partiallyGeneratedResponse.NPCsData.length > 0);
        if (combatEnded && hasNamedNpcs) flags.needsNPCProcessing = true;
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
    const mainPromptSteps = await loadPromptSteps();
    const onPartialResponse = (_response: Partial<GameResponse>, _stepName: string, _modelName: string) => {
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
    onPartialResponse: (response: Partial<GameResponse>, stepName: string, modelName: string) => void,
    onStepStart: (stepName: string, modelName: string) => void,
): Promise<GameResponse> {
    const mainPromptSteps = await loadPromptSteps();
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
): Promise<Partial<Cinematic>> {
    const prompt = typeof input === 'string' ? input : input.promptContent;
    const effectiveSystemInstruction = systemInstruction || (typeof input === 'string' ? undefined : input.systemInstruction);
    const result = await requestArenaGmStep(
        prompt, context.currentStepFocus || 'CinematicGeneration', 'Arena GM', 1,
        abortSignal, effectiveSystemInstruction,
    );
    onStreamingChunk(result.text);
    try {
        return JSON.parse(cleanJsonString(result.text));
    } catch (error: unknown) {
        throw new RegenerationRequiredError(
            errorMessage(error),
            'Arena GM returned invalid JSON for cinematic generation.',
            result.text,
        );
    }
}
