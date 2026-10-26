
import React from 'react';
import { getMusicSuggestionFromAi, generateSurpriseMusicPrompt as generateSurpriseMusicPromptUtil } from '../../utils/gemini';
import { formatError } from '../../utils/errorUtils';

type TFunction = (key: string, replacements?: Record<string, string | number>) => string;

export const createMusicManager = (
    {
        gameContextRef,
        setError,
        t,
        setGameLog,
        setMusicPrompt,
        setIsMusicLoading,
        setIsMusicPlayerVisible,
        previousMusicQueries
    }: {
        gameContextRef: React.MutableRefObject<any>,
        setError: React.Dispatch<React.SetStateAction<string | null>>,
        t: TFunction,
        setGameLog: React.Dispatch<React.SetStateAction<string[]>>,
        setMusicPrompt: React.Dispatch<React.SetStateAction<string | null>>,
        setIsMusicLoading: React.Dispatch<React.SetStateAction<boolean>>,
        setIsMusicPlayerVisible: React.Dispatch<React.SetStateAction<boolean>>,
        previousMusicQueries: React.MutableRefObject<string[]>
    }
) => {
    const generateMusicPrompt = async () => {
        if (!gameContextRef.current) return;

        setIsMusicLoading(true);
        setError(null);
        try {
          const suggestion = await getMusicSuggestionFromAi(gameContextRef.current, previousMusicQueries.current);
          if (suggestion && suggestion.prompt) {
            setMusicPrompt(suggestion.prompt);
            previousMusicQueries.current.push(suggestion.prompt);
            if (previousMusicQueries.current.length > 10) {
                previousMusicQueries.current.shift();
            }
            setGameLog(prev => [t("music_suggestion_reasoning", {reasoning: suggestion.reasoning}), ...prev]);
            setIsMusicPlayerVisible(true);
          } else {
            setGameLog(prev => [t("music_suggestion_failed"), ...prev]);
          }
        } catch (e: any) {
          console.error("Failed to get music suggestion:", e);
          const formattedError = formatError(e);
          setError(t("music_suggestion_error", { error: formattedError }));
        } finally {
          setIsMusicLoading(false);
        }
    };

    const generateSurpriseMusicPrompt = async () => {
        setIsMusicLoading(true);
        setError(null);
        try {
            const prompt = await generateSurpriseMusicPromptUtil();
            setMusicPrompt(prompt);
            setGameLog(prev => [t('Surprise music prompt generated.'), ...prev]);
            // FIX: Removed check for isMusicPlayerVisible as it's not in scope.
            // Setting it to true is idempotent and achieves the desired effect of showing the player.
            setIsMusicPlayerVisible(true);
        } catch (e: any) {
            console.error("Failed to generate surprise music prompt:", e);
            const formattedError = formatError(e);
            setError(t("music_suggestion_error", { error: formattedError }));
        } finally {
            setIsMusicLoading(false);
        }
    };

    const closeMusicPlayer = () => {
        setMusicPrompt(null);
        setIsMusicPlayerVisible(false);
        previousMusicQueries.current = [];
    };

    const updateMusicPrompt = (prompt: string) => {
        setMusicPrompt(prompt);
    }

    return {
        generateMusicPrompt,
        generateSurpriseMusicPrompt,
        closeMusicPlayer,
        updateMusicPrompt,
    };
};
