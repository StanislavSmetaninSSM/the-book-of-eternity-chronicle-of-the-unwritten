import React, { useState, useEffect, useRef, useCallback } from 'react';
import { XMarkIcon, MusicalNoteIcon, ArrowPathIcon, MinusIcon, PlusIcon, PlayIcon, PauseIcon, SpeakerWaveIcon, SpeakerXMarkIcon, SparklesIcon, ArrowDownOnSquareIcon, ClockIcon, ArrowDownTrayIcon } from '@heroicons/react/24/solid';
import { useLocalization } from '../context/LocalizationContext';
import { GoogleGenAI, LiveMusicSession } from '@google/genai';
import { decode, decodeAudioData } from '../utils/audioUtils';
import LoadingSpinner from './LoadingSpinner';

const getAi = () => {
    if (!process.env.API_KEY) throw new Error("API_KEY environment variable not set");
    return new GoogleGenAI({ apiKey: process.env.API_KEY, apiVersion: "v1alpha" });
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function createWavFile(audioData: Uint8Array, numChannels: number, sampleRate: number, bitsPerSample: number): Blob {
    const dataSize = audioData.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    // chunk size
    view.setUint32(4, 36 + dataSize, true);
    // format
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    // sub-chunk 1 size
    view.setUint32(16, 16, true);
    // audio format (1 for PCM)
    view.setUint16(20, 1, true);
    // num channels
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    // block align
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    // bits per sample
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    writeString(view, 36, 'data');
    // sub-chunk 2 size
    view.setUint32(40, dataSize, true);

    // Write the PCM data
    const pcm = new Uint8Array(audioData.buffer);
    for (let i = 0; i < dataSize; i++) {
        view.setUint8(44 + i, pcm[i]);
    }

    return new Blob([view], { type: 'audio/wav' });
}

interface LyriaMusicPlayerProps {
  initialPrompt: string;
  onClose: () => void;
  onRegeneratePrompt: () => void;
  onUpdatePrompt: (newPrompt: string) => void;
  onGenerateSurprisePrompt: () => void;
  isHidden: boolean;
  onDock: () => void;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  musicStatus: 'stopped' | 'connecting' | 'playing' | 'buffering' | 'error';
  setMusicStatus: React.Dispatch<React.SetStateAction<'stopped' | 'connecting' | 'playing' | 'buffering' | 'error'>>;
  playPauseRef: React.MutableRefObject<() => void>;
}

const LyriaMusicPlayer: React.FC<LyriaMusicPlayerProps> = ({ 
    initialPrompt, 
    onClose, 
    onRegeneratePrompt, 
    onUpdatePrompt, 
    onGenerateSurprisePrompt,
    isHidden,
    onDock,
    isPlaying,
    setIsPlaying,
    musicStatus,
    setMusicStatus,
    playPauseRef,
}) => {
    const { t } = useLocalization();
    const playerRef = useRef<HTMLDivElement>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    
    const [position, setPosition] = useState({ 
        x: window.innerWidth - (MIN_WIDTH + 16),
        y: window.innerHeight - (MIN_HEIGHT + 16),
    });
    const [size, setSize] = useState({ w: MIN_WIDTH, h: MIN_HEIGHT });
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0, initialX: 0, initialY: 0 });
    const resizeStartRef = useRef({ x: 0, y: 0, initialW: 0, initialH: 0 });

    const sessionRef = useRef<LiveMusicSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const audioQueue = useRef<AudioBuffer[]>([]);
    const nextStartTime = useRef(0);
    const accumulatedAudioChunks = useRef<Uint8Array[]>([]);


    const [volume, setVolume] = useState(0.5);
    const [localPrompt, setLocalPrompt] = useState(initialPrompt);
    const [isAutoMusicMode, setIsAutoMusicMode] = useState(false);

    useEffect(() => {
        let intervalId: number | undefined;

        if (isAutoMusicMode && isPlaying) {
            intervalId = window.setInterval(() => {
                onRegeneratePrompt();
            }, 5 * 60 * 1000); // 5 minutes
        }

        return () => {
            if (intervalId) {
                window.clearInterval(intervalId);
            }
        };
    }, [isAutoMusicMode, isPlaying, onRegeneratePrompt]);

    useEffect(() => {
        setLocalPrompt(initialPrompt);
        if (sessionRef.current) {
            sessionRef.current.setWeightedPrompts({ weightedPrompts: [{ text: initialPrompt, weight: 1.0 }] });
        }
    }, [initialPrompt]);
    
    const playAudioQueue = useCallback(() => {
        // BUG FIX: Removed `!isPlaying` check. The closure over `isPlaying` was stale (always false),
        // preventing audio from ever being scheduled. The existence of the audio context
        // is sufficient to know that we should be trying to play.
        if (!audioContextRef.current || !gainNodeRef.current) return;
        
        const context = audioContextRef.current;
        const gainNode = gainNodeRef.current;
    
        const schedule = () => {
            // Use functional update to avoid dependency on musicStatus
            setMusicStatus(currentStatus => {
                if (audioQueue.current.length > 0 && currentStatus !== 'playing') {
                    return 'playing';
                }
                return currentStatus;
            });
    
            while (audioQueue.current.length > 0) {
                const buffer = audioQueue.current.shift()!;
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(gainNode);
    
                const currentTime = context.currentTime;
                // If nextStartTime is in the past, start immediately.
                const startTime = Math.max(currentTime, nextStartTime.current);
                
                source.start(startTime);
                
                // Update the time for the next chunk.
                nextStartTime.current = startTime + buffer.duration;
            }
        };
    
        if (context.state === 'suspended') {
            context.resume().then(schedule);
        } else {
            schedule();
        }
    }, [setMusicStatus]); // Dependency array now only contains stable setters

    useEffect(() => {
        const statusInterval = setInterval(() => {
            if (isPlaying && audioContextRef.current && musicStatus !== 'connecting' && musicStatus !== 'error') {
                const isQueueEmpty = audioQueue.current.length === 0;
                const isPlaybackFinished = nextStartTime.current < audioContextRef.current.currentTime;

                if (isQueueEmpty && isPlaybackFinished) {
                    if (musicStatus !== 'buffering') {
                        setMusicStatus('buffering');
                    }
                }
            }
        }, 500); // Check every 500ms

        return () => clearInterval(statusInterval);
    }, [isPlaying, musicStatus, setMusicStatus]);
    
    const startSession = useCallback(async (prompt: string) => {
        if (sessionRef.current) {
            await sessionRef.current.stop();
            sessionRef.current.close();
        }
        
        setMusicStatus('connecting');
        audioQueue.current = [];
        accumulatedAudioChunks.current = [];
        nextStartTime.current = 0;

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            await audioContextRef.current.close();
        }
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
        gainNodeRef.current = audioContextRef.current.createGain();
        gainNodeRef.current.connect(audioContextRef.current.destination);
        gainNodeRef.current.gain.value = volume;

        try {
            const ai = getAi();
            const session = await ai.live.music.connect({
                model: 'models/lyria-realtime-exp',
                callbacks: {
                    onmessage: async (message) => {
                        if (message.serverContent?.audioChunks) {
                            const decodedPromises = message.serverContent.audioChunks.map(async (chunk) => {
                                try {
                                    if (audioContextRef.current) {
                                        const decodedBytes = decode(chunk.data);
                                        accumulatedAudioChunks.current.push(decodedBytes);
                                        return await decodeAudioData(decodedBytes, audioContextRef.current, 48000, 2);
                                    }
                                } catch (e) {
                                    console.error("Error decoding audio chunk:", e);
                                }
                                return null;
                            });

                            const audioBuffers = (await Promise.all(decodedPromises)).filter((b): b is AudioBuffer => b !== null);
                            
                            if (audioBuffers.length > 0) {
                                audioQueue.current.push(...audioBuffers);
                                playAudioQueue();
                            }
                        }
                    },
                    onerror: (e) => {
                        console.error("Lyria session error:", e);
                        setMusicStatus('error');
                    },
                    onclose: () => {
                        setMusicStatus('stopped');
                        setIsPlaying(false);
                    },
                },
            });
            sessionRef.current = session;
            
            await session.setWeightedPrompts({ weightedPrompts: [{ text: prompt, weight: 1.0 }] });
            await session.setMusicGenerationConfig({ musicGenerationConfig: { } });
            
            setIsPlaying(true);
            await session.play();

        } catch (e) {
            console.error("Failed to start Lyria session", e);
            setMusicStatus('error');
        }
    }, [volume, playAudioQueue, setIsPlaying, setMusicStatus]);
    
    const stopSession = useCallback(async () => {
        if (sessionRef.current) {
            try {
              await sessionRef.current.stop();
              await sessionRef.current.close();
            } catch(e) {
              console.error("Error closing session", e);
            }
            sessionRef.current = null;
        }
        setIsPlaying(false);
        setMusicStatus('stopped');
    }, [setIsPlaying, setMusicStatus]);

    const handlePlayPause = useCallback(async () => {
        if (isPlaying) {
            await stopSession();
        } else {
            await startSession(localPrompt);
        }
    }, [localPrompt, startSession, stopSession, isPlaying]);

    useEffect(() => {
        playPauseRef.current = handlePlayPause;
    }, [handlePlayPause, playPauseRef]);
    
    useEffect(() => {
        startSession(initialPrompt);
        return () => {
            stopSession();
        };
    }, []); 

    useEffect(() => {
        if (gainNodeRef.current) {
            gainNodeRef.current.gain.setValueAtTime(volume, audioContextRef.current?.currentTime || 0);
        }
    }, [volume]);

    // Drag and resize handlers
    const onDragMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); dragStartRef.current = { x: e.clientX, y: e.clientY, initialX: position.x, initialY: position.y }; }, [position]);
    const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsResizing(true); resizeStartRef.current = { x: e.clientX, y: e.clientY, initialW: size.w, initialH: size.h }; }, [size]);
    const onMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging) {
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            setPosition({ x: dragStartRef.current.initialX + dx, y: dragStartRef.current.initialY + dy });
        }
        if (isResizing) {
            const dw = e.clientX - resizeStartRef.current.x;
            const dh = e.clientY - resizeStartRef.current.y;
            setSize({ w: Math.max(MIN_WIDTH, resizeStartRef.current.initialW + dw), h: Math.max(MIN_HEIGHT, resizeStartRef.current.initialH + dh) });
        }
    }, [isDragging, isResizing]);
    const onMouseUp = useCallback(() => { setIsDragging(false); setIsResizing(false); }, []);
    useEffect(() => {
        if (isDragging || isResizing) {
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [isDragging, isResizing, onMouseMove, onMouseUp]);
    
    const handleUpdatePrompt = () => {
        onUpdatePrompt(localPrompt);
    };

    const handleToggleAutoMusic = () => {
        setIsAutoMusicMode(prev => !prev);
    };

    const handleDownload = () => {
        if (accumulatedAudioChunks.current.length === 0) {
            alert(t("No audio data to download."));
            return;
        }

        const totalLength = accumulatedAudioChunks.current.reduce((acc, chunk) => acc + chunk.length, 0);
        const concatenated = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of accumulatedAudioChunks.current) {
            concatenated.set(chunk, offset);
            offset += chunk.length;
        }

        const blob = createWavFile(concatenated, 2, 48000, 16);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safePrompt = localPrompt.replace(/[^a-z0-9]/gi, '_').slice(0, 50);
        a.download = `lyria-music-${safePrompt}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

  return (
    <div 
      ref={playerRef}
      className="music-player"
      style={{
        width: isMinimized ? 'auto' : `${size.w}px`,
        height: isMinimized ? 'auto' : `${size.h}px`,
        minWidth: `${MIN_WIDTH}px`,
        minHeight: isMinimized ? 'auto' : `${MIN_HEIGHT}px`,
        top: '0px',
        left: '0px',
        transform: `translate(${position.x}px, ${position.y}px)`,
        display: isHidden ? 'none' : 'flex',
      }}
    >
      <div className="music-player-header" onMouseDown={onDragMouseDown}>
        <div className="flex items-center gap-2">
            <MusicalNoteIcon className="w-4 h-4 text-cyan-400" />
            <span className="music-player-title">{t('AI Music Player')}</span>
        </div>
        <div className="flex items-center gap-1">
            <button onClick={onRegeneratePrompt} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Regenerate Prompt")}>
                <ArrowPathIcon className="w-4 h-4" />
            </button>
            <button onClick={handleDownload} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Download Track")}>
                <ArrowDownTrayIcon className="w-4 h-4" />
            </button>
            <button onClick={onDock} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Dock to tray")}>
                <ArrowDownOnSquareIcon className="w-4 h-4" />
            </button>
            {isMinimized ? (
                <button onClick={() => setIsMinimized(false)} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Expand")}>
                    <PlusIcon className="w-4 h-4" />
                </button>
            ) : (
                <button onClick={() => setIsMinimized(true)} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Minimize")}>
                    <MinusIcon className="w-4 h-4" />
                </button>
            )}
            <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white" title={t("Close")}>
              <XMarkIcon className="w-4 h-4" />
            </button>
        </div>
      </div>
      <div className="music-player-content p-4 flex flex-col gap-4" style={{ display: isMinimized ? 'none' : 'flex' }}>
        <div className="flex-1 flex flex-col gap-2">
            <label htmlFor="music-prompt" className="text-sm font-medium text-gray-300">{t('Music Prompt')}</label>
            <textarea
                id="music-prompt"
                value={localPrompt}
                onChange={(e) => setLocalPrompt(e.target.value)}
                className="w-full flex-1 bg-gray-900/50 border border-gray-600 rounded-md p-2 text-gray-200 text-sm resize-none"
            />
            <div className="grid grid-cols-3 gap-2">
                 <button onClick={handleUpdatePrompt} className="px-3 py-1.5 text-xs font-semibold rounded-md bg-cyan-600/80 text-white hover:bg-cyan-600">{t('Update')}</button>
                 <button onClick={onGenerateSurprisePrompt} className="px-3 py-1.5 text-xs font-semibold rounded-md bg-purple-600/80 text-white hover:bg-purple-600 flex items-center justify-center gap-1">
                    <SparklesIcon className="w-4 h-4" />
                    {t('Surprise Me')}
                 </button>
                 <button 
                    onClick={handleToggleAutoMusic}
                    title={t('Toggle auto-music mode (new prompt every 5 minutes)')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1 ${
                        isAutoMusicMode 
                        ? 'bg-green-600/80 text-white hover:bg-green-600' 
                        : 'bg-gray-600/80 text-gray-300 hover:bg-gray-600'
                    }`}
                >
                    <ClockIcon className="w-4 h-4" />
                    {isAutoMusicMode ? t('Auto: On') : t('Auto: Off')}
                </button>
            </div>
        </div>
        <div className="flex-shrink-0">
             <div className="flex items-center justify-center gap-4">
                <button onClick={handlePlayPause} className="p-3 rounded-full bg-cyan-600 text-white hover:bg-cyan-500 disabled:bg-gray-600" title={isPlaying ? t('Pause') : t('Play')}>
                    {musicStatus === 'connecting' ? <LoadingSpinner /> : (isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />)}
                </button>
                <div className="flex-1 flex items-center gap-2">
                    {volume > 0 ? <SpeakerWaveIcon className="w-5 h-5 text-gray-400" /> : <SpeakerXMarkIcon className="w-5 h-5 text-gray-400" />}
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={volume}
                        onChange={e => setVolume(parseFloat(e.target.value))}
                        className="w-full styled-slider"
                        style={{ '--range-progress': `${volume * 100}%` } as React.CSSProperties}
                    />
                </div>
            </div>
            <div className="text-center text-xs text-gray-500 mt-2 capitalize">{t(musicStatus as any)}</div>
        </div>
      </div>
      <div 
        className="music-player-resizer"
        onMouseDown={onResizeMouseDown}
        style={{ display: isMinimized ? 'none' : 'block' }}
      />
    </div>
  );
};

export default LyriaMusicPlayer;