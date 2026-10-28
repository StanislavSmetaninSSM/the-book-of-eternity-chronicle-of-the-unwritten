

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ArrowPathIcon, ArrowUpTrayIcon, XCircleIcon, ArrowDownTrayIcon, SparklesIcon, MapPinIcon } from '@heroicons/react/24/solid';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';
import { useLocalization } from '../context/LocalizationContext';
import { GameSettings, ImageCacheEntry } from '../types';
import { requestArenaGmImage } from '../utils/arenaGmRelay';

interface ImageRendererProps {
    prompt: string | null | undefined;
    originalTextPrompt?: string;
    className?: string;
    alt?: string;
    showRegenerateButton?: boolean;
    showCancelButton?: boolean;
    width?: number;
    height?: number;
    imageCache: Record<string, ImageCacheEntry | string>;
    onImageGenerated: (prompt: string, src: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => void;
    onUploadCustom?: (base64: string | null) => void;
    uploadButtonPosition?: 'overlay' | 'below';
    fitMode?: 'cover' | 'natural';
    onClearCustom?: () => void;
    onClick?: () => void;
    gameSettings: GameSettings | null;
    gameIsLoading?: boolean;
    showSourceInfo?: boolean;
    showDownloadButton?: boolean;
    pendingPrompt?: string | null;
    onAcceptPending?: () => void;
}

// Share each in-flight request by prompt. Hidden warmup renderers and visible cards
// then display the same progress instead of silently suppressing the visible spinner.
const imageRequestsInProgress = new Map<string, Promise<string>>();

interface UploadButtonProps {
    isOverlay: boolean;
    onUploadCustom?: (base64: string | null) => void;
    isGenerating: boolean;
    gameIsLoading?: boolean;
}

const UploadButton: React.FC<UploadButtonProps> = React.memo(({ isOverlay, onUploadCustom, isGenerating, gameIsLoading }) => {
    const { t } = useLocalization();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                alert(t("Please select an image file."));
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64dataUrl = reader.result as string;
                if (onUploadCustom) {
                    onUploadCustom(base64dataUrl);
                }
            };
            reader.readAsDataURL(file);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, [onUploadCustom, t]);

    if (!onUploadCustom) return null;

    return (
        <>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/*"
            />
            <button
                onClick={handleUploadClick}
                disabled={isGenerating || gameIsLoading}
                className={isOverlay
                    ? "bg-gray-900/60 text-white p-2 rounded-full hover:bg-black/80 transition-all opacity-50 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-cyan-300 bg-cyan-600/20 rounded-md hover:bg-cyan-600/40 transition-colors"
                }
                title={t("Upload Image")}
            >
                <ArrowUpTrayIcon className="w-5 h-5" />
                {!isOverlay && <span>{t('Upload Custom Portrait')}</span>}
            </button>
        </>
    );
});

interface RegenerateButtonProps {
    onClick: (e: React.MouseEvent) => void;
    isGenerating: boolean;
    t: (key: string) => string;
    gameIsLoading?: boolean;
}

const RegenerateButton: React.FC<RegenerateButtonProps> = React.memo(({ onClick, isGenerating, t }) => {
    const isDisabled = isGenerating;

    return (
        <button
            onClick={onClick}
            disabled={isDisabled}
            className="bg-gray-900/60 text-white p-2 rounded-full hover:bg-black/80 transition-all opacity-50 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("Regenerate Image")}
        >
            <ArrowPathIcon className={`w-5 h-5 ${isGenerating ? 'animate-spin' : ''}`} />
        </button>
    );
});


const ImageRenderer: React.FC<ImageRendererProps> = (props) => {
    const {
        prompt,
        originalTextPrompt,
        className = '',
        alt,
        showRegenerateButton = false,
        showCancelButton = false,
        width = 512,
        height = 512,
        imageCache,
        onImageGenerated,
        onUploadCustom,
        uploadButtonPosition = 'overlay',
        fitMode = 'cover',
        onClearCustom,
        onClick,
        gameSettings,
        gameIsLoading,
        showSourceInfo = false,
        showDownloadButton = false,
        pendingPrompt,
        onAcceptPending
    } = props;

    const { t } = useLocalization();
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [isManuallyCancelled, setIsManuallyCancelled] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const manualCancelRef = useRef(false);
    useEffect(() => () => {
        // HMR, navigation, or closing the game must not leave an orphaned image
        // request occupying the single-active relay mailbox.
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
    }, []);

    const generateImage = useCallback(async (p: string, _settings: GameSettings | null, _forceRegenerate: boolean = false) => {
        if (!p) return;
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const { signal } = controller;
        setIsGenerating(true);
        setGenerationError(null);
        setIsManuallyCancelled(false);
        manualCancelRef.current = false;
        let request = imageRequestsInProgress.get(p);
        if (!request) {
            request = requestArenaGmImage(p, width, height, signal);
            imageRequestsInProgress.set(p, request);
        }
        try {
            const imageUrl = await request;
            if (!signal.aborted) onImageGenerated(p, imageUrl, 'Arena GM', 'arena-gm-relay');
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                if (manualCancelRef.current) setIsManuallyCancelled(true);
            } else {
                const message = error instanceof Error ? error.message : String(error);
                setGenerationError(message);
                console.error(`Arena image generation failed for prompt "${p.substring(0, 50)}...":`, error);
            }
        } finally {
            if (imageRequestsInProgress.get(p) === request) imageRequestsInProgress.delete(p);
            setIsGenerating(false);
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
        }
    }, [onImageGenerated, width, height]);
    
    const { cacheEntry, sourceProvider, sourceModel } = useMemo(() => {
        // Try prompt first, then fall back to originalTextPrompt
        let entry = prompt ? imageCache[prompt] : null;
        if (!entry && originalTextPrompt) {
            entry = imageCache[originalTextPrompt];
        }

        let provider: ImageCacheEntry['sourceProvider'] | null = null;
        let model: string | undefined = undefined;

        if (prompt?.startsWith('custom-portrait-')) {
            provider = 'Custom Upload';
        } else if (entry) {
            if (typeof entry === 'string') {
                provider = 'Imagen'; // Legacy
                model = 'imagen-4.0-generate-001'; // Guess
            } else {
                provider = entry.sourceProvider;
                model = entry.sourceModel;
            }
        } else if (prompt?.startsWith('data:image')) {
            provider = 'Custom Upload';
        }

        return { cacheEntry: entry, sourceProvider: provider, sourceModel: model };
    }, [prompt, originalTextPrompt, imageCache]);

    const isCustomPortrait = useMemo(() => {
        return prompt?.startsWith('custom-portrait-') ||
            sourceProvider === 'Custom Upload';
    }, [prompt, sourceProvider]);

    const imageUrlToDisplay = useMemo(() => {
        const isDirectSource = prompt?.startsWith('data:image') || prompt?.startsWith('https');
        if (isDirectSource) {
            return prompt;
        }
        if (cacheEntry) {
            return typeof cacheEntry === 'string' ? cacheEntry : cacheEntry.src;
        }
        return null;
    }, [prompt, cacheEntry]);
    
    useEffect(() => {
        // Always enqueue missing images as soon as their prompts are mounted. The relay
        // scheduler holds these jobs behind the active turn lease, so they cannot
        // overwrite a staged game request; gating here can lose prompts while loading.
        if (prompt && !imageUrlToDisplay && !isGenerating && !isManuallyCancelled) {
            generateImage(prompt, gameSettings);
        }
    }, [prompt, imageUrlToDisplay, isGenerating, isManuallyCancelled, generateImage, gameSettings]);

    const handleRegenerateClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (isGenerating) return;
        if (originalTextPrompt) {
            // Image requests are safe during turns: the relay scheduler defers them
            // behind the active turn lease and the button can still show progress.
            generateImage(originalTextPrompt, gameSettings, true);
        }
    }, [isGenerating, originalTextPrompt, generateImage, gameSettings]);

    const handlePinImage = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onUploadCustom && imageUrlToDisplay) {
            // Setting the current image as a "custom upload" effectively locks it
            onUploadCustom(imageUrlToDisplay);
        }
    }, [onUploadCustom, imageUrlToDisplay]);

    const handleCancelGeneration = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (abortControllerRef.current) {
            manualCancelRef.current = true;
            abortControllerRef.current.abort();
        }
    }, []);

    const displaySourceText = useMemo(() => {
        if (!sourceProvider) return null;
        
        // Per user request, do not display the source text for custom uploads.
        if (sourceProvider === 'Custom Upload') {
            return null;
        }

        if (sourceProvider === 'Nano Banana') return t('image_source_nanobanana');
        if (sourceProvider === 'Imagen') {
            if (sourceModel === 'imagen-4.0-ultra-generate-001') {
                return t('image_source_imagen_ultra');
            }
            if (sourceModel === 'imagen-4.0-fast-generate-001') {
                return t('image_source_imagen_fast');
            }
            return t('image_source_imagen_normal');
        }
        return sourceProvider; // Fallback for unknown providers
    }, [sourceProvider, sourceModel, t]);
    
    const handleDownload = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!imageUrlToDisplay) return;
    
        const a = document.createElement('a');
        a.href = imageUrlToDisplay;
        
        const safePrompt = (originalTextPrompt || 'image').replace(/[^a-z0-9]/gi, '_').slice(0, 50);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        
        // Determine file extension
        let extension = 'png';
        if (imageUrlToDisplay.startsWith('data:image/jpeg')) {
            extension = 'jpg';
        } else if (imageUrlToDisplay.startsWith('data:image/webp')) {
            extension = 'webp';
        }
    
        a.download = `${safePrompt}_${timestamp}.${extension}`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }, [imageUrlToDisplay, originalTextPrompt]);

    const handleAcceptPending = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onAcceptPending) {
            onAcceptPending();
        }
    }, [onAcceptPending]);

    const imgClasses = fitMode === 'cover'
        ? "object-cover w-full h-full"
        : "max-w-full max-h-[80vh] h-auto w-auto";

    const imageContainer = (
        <div className={`relative group bg-gray-800 ${className} ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
            {imageUrlToDisplay ? (
                <img src={imageUrlToDisplay} alt={alt || t('Generated image')} className={imgClasses} />
            ) : isManuallyCancelled ? (
                <div className="flex items-center justify-center h-full w-full bg-gray-900">
                    <XCircleIcon className="w-16 h-16 text-gray-600" />
                </div>
            ) : generationError ? (
                <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-900 p-3 text-center text-red-300">
                    <XCircleIcon className="h-8 w-8" />
                    <span className="text-sm font-semibold">{t('image_request_failed')}</span>
                    <span className="max-w-full break-words text-xs text-red-200/80">{generationError}</span>
                </div>
            ) : (
                <div className="flex items-center justify-center h-full w-full">
                    {/* The main spinner is now inside the isGenerating overlay, which appears immediately */}
                </div>
            )}

            {(isGenerating || (gameIsLoading && !imageUrlToDisplay)) && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-10 gap-4">
                    <svg className="w-10 h-10 text-white animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {showCancelButton && isGenerating && (
                        <button
                            onClick={handleCancelGeneration}
                            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-md hover:bg-red-500 transition-colors flex items-center gap-2"
                        >
                            <XCircleIcon className="w-5 h-5" />
                            {t('Cancel')}
                        </button>
                    )}
                </div>
            )}

            {onClick && imageUrlToDisplay && !isGenerating && (
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <p className="text-white font-bold text-lg">{t('Enlarge')}</p>
                </div>
            )}
            
            {showSourceInfo && gameSettings?.showImageSourceInfo && displaySourceText && !isGenerating && imageUrlToDisplay && (
                <div 
                    className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full z-10 pointer-events-none"
                    title={`${t('Generated by')}: ${displaySourceText}`}
                >
                    {displaySourceText}
                </div>
            )}

            {pendingPrompt && onAcceptPending && !isCustomPortrait && (
                <button
                    onClick={handleAcceptPending}
                    className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-4 rounded shadow-lg flex items-center gap-2 z-50 animate-pulse"
                    title={t("A new look is available based on recent events.")}
                >
                    <SparklesIcon className="w-4 h-4" />
                    {t("Update Look")}
                </button>
            )}

            <div className="absolute top-2 right-2 flex gap-2 z-20">
                {showDownloadButton && imageUrlToDisplay && !isGenerating && (
                    <button
                        onClick={handleDownload}
                        className="bg-gray-900/60 text-white p-2 rounded-full hover:bg-black/80 transition-all opacity-50 group-hover:opacity-100 focus:opacity-100"
                        title={t("Download Image")}
                    >
                        <ArrowDownTrayIcon className="w-5 h-5" />
                    </button>
                )}
                {onUploadCustom && !isCustomPortrait && imageUrlToDisplay && !isGenerating && (
                    <button
                        onClick={handlePinImage}
                        className="bg-gray-900/60 text-white p-2 rounded-full hover:bg-black/80 transition-all opacity-50 group-hover:opacity-100 focus:opacity-100"
                        title={t("Pin Image")}
                    >
                        <MapPinIcon className="w-5 h-5" />
                    </button>
                )}
                {uploadButtonPosition === 'overlay' && (
                    <UploadButton
                        isOverlay={true}
                        onUploadCustom={onUploadCustom}
                        isGenerating={isGenerating}
                        gameIsLoading={gameIsLoading}
                    />
                )}
                {showRegenerateButton && originalTextPrompt && (
                    <RegenerateButton
                        onClick={handleRegenerateClick}
                        isGenerating={isGenerating}
                        t={t}
                        gameIsLoading={gameIsLoading}
                    />
                )}
            </div>
        </div>
    );

    return (
        <>
            {uploadButtonPosition === 'below' ? (
                <div>
                    {imageContainer}
                    <div className="mt-2 flex gap-2">
                         <UploadButton
                            isOverlay={false}
                            onUploadCustom={onUploadCustom}
                            isGenerating={isGenerating}
                            gameIsLoading={gameIsLoading}
                        />
                        {onClearCustom && (
                             <button
                                onClick={(e) => { e.stopPropagation(); onClearCustom(); }}
                                disabled={gameIsLoading || isGenerating}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-yellow-300 bg-yellow-600/20 rounded-md hover:bg-yellow-600/40 transition-colors disabled:opacity-50"
                                title={t("revert_to_generated")}
                            >
                                <ArrowUturnLeftIcon className="w-5 h-5" />
                                <span>{t('Revert')}</span>
                            </button>
                        )}
                    </div>
                </div>
            ) : imageContainer}
        </>
    );
};

export default ImageRenderer;
