import React, { useState, useMemo } from 'react';
import { ImageCacheEntry, GameSettings } from '../types';
import ImageRenderer from './ImageRenderer';
import { useLocalization } from '../context/LocalizationContext';
import { TrashIcon, PhotoIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import ConfirmationModal from './ConfirmationModal';

interface ImageCacheGalleryProps {
    imageCache: Record<string, ImageCacheEntry | string>;
    onImageGenerated: (prompt: string, src: string, sourceProvider: ImageCacheEntry['sourceProvider'], sourceModel?: string) => void;
    onOpenImageModal: (prompt: string, originalTextPrompt: string) => void;
    deleteImageFromCache: (prompt: string) => void;
    clearImageCache: () => void;
    gameSettings: GameSettings | null;
    isLoading?: boolean;
    onExpand?: () => void;
    isFullScreen?: boolean;
    onCollapse?: () => void;
}

const ImageCacheGallery: React.FC<ImageCacheGalleryProps> = ({ 
    imageCache, 
    onImageGenerated, 
    onOpenImageModal,
    deleteImageFromCache,
    clearImageCache,
    gameSettings,
    isLoading,
    onExpand,
    isFullScreen,
    onCollapse
}) => {
    const { t } = useLocalization();
    const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

    const handleDeleteConfirm = () => {
        if (promptToDelete) {
            deleteImageFromCache(promptToDelete);
        }
        setPromptToDelete(null);
    };

    const handleClearAllConfirm = () => {
        clearImageCache();
        setIsClearConfirmOpen(false);
    };

    const imageEntries = useMemo(() => Object.entries(imageCache || {}).reverse(), [imageCache]);

    if (imageEntries.length === 0) {
        return (
            <div className="text-center text-gray-500 p-6 flex flex-col items-center justify-center h-full">
                <PhotoIcon className="w-12 h-12 text-gray-600 mb-4" />
                <p className="font-semibold">{t('Image cache is empty.')}</p>
                <p className="text-sm mt-1">{t('Generated images will appear here.')}</p>
            </div>
        );
    }

    return (
        <>
        <div className="flex flex-col h-full">
            <div className="flex-shrink-0 flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-cyan-400 narrative-text flex items-center gap-2">
                    <PhotoIcon className="w-6 h-6" />
                    {t('ImageCache')}
                </h3>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsClearConfirmOpen(true)}
                        disabled={imageEntries.length === 0}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-red-300 bg-red-500/10 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                        <TrashIcon className="w-4 h-4" />
                        {t('Clear All Cache')}
                    </button>
                    {!isFullScreen && onExpand && (
                        <button onClick={onExpand} className="p-2 text-gray-400 rounded-full hover:bg-gray-700/80" title={t('Expand')}>
                            <ArrowsPointingOutIcon className="w-5 h-5" />
                        </button>
                    )}
                    {isFullScreen && onCollapse && (
                        <button onClick={onCollapse} className="p-2 text-gray-400 rounded-full hover:bg-gray-700/80" title={t('Collapse')}>
                            <ArrowsPointingInIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                <div className={`grid gap-4 ${isFullScreen ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-2'}`}>
                    {imageEntries.map(([prompt, entry]) => {
                        const cacheEntry = typeof entry === 'string' ? { src: entry, sourceProvider: 'Imagen' as const } : entry;
                        const { src } = cacheEntry;

                        const originalTextPromptForRegen = prompt.startsWith('custom-') || prompt.startsWith('data:image') ? '' : prompt;

                        return (
                            <div key={prompt} className="relative group bg-gray-900/50 rounded-lg overflow-hidden border-2 border-transparent hover:border-cyan-500 transition-all">
                                <ImageRenderer
                                    prompt={src}
                                    originalTextPrompt={originalTextPromptForRegen}
                                    alt={prompt}
                                    className="w-full h-32 object-cover"
                                    imageCache={imageCache}
                                    onImageGenerated={onImageGenerated}
                                    onClick={() => onOpenImageModal(src, prompt)}
                                    showRegenerateButton={!!originalTextPromptForRegen}
                                    gameSettings={gameSettings}
                                    gameIsLoading={isLoading}
                                />
                                <button
                                    onClick={(e) => { e.stopPropagation(); setPromptToDelete(prompt); }}
                                    className="absolute top-1 left-1 bg-red-600/80 text-white p-1.5 rounded-full hover:bg-red-500 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 z-20"
                                    title={t('Delete from cache')}
                                >
                                    <TrashIcon className="w-4 h-4" />
                                </button>
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                    <p className="text-white text-xs truncate" title={prompt}>{prompt}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
            <ConfirmationModal
                isOpen={!!promptToDelete}
                onClose={() => setPromptToDelete(null)}
                onConfirm={handleDeleteConfirm}
                title={t('Delete Image from Cache')}
            >
                <p>{t('Are you sure you want to permanently delete this image from the cache?')}</p>
                <p className="text-xs text-gray-400 mt-2 break-all"><strong>{t('Prompt')}:</strong> {promptToDelete}</p>
            </ConfirmationModal>
            <ConfirmationModal
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                onConfirm={handleClearAllConfirm}
                title={t('Clear Image Cache')}
            >
                <p>{t('Are you sure you want to permanently delete all images from the cache?')}</p>
            </ConfirmationModal>
        </>
    );
};

export default ImageCacheGallery;
