import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from './Modal';
import { useLocalization } from '../context/LocalizationContext';
import { PlayIcon, PauseIcon, ArrowLeftIcon, ArrowRightIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/solid';
import { stripModerationSymbols } from '../utils/textUtils';
import { Cinematic } from '../types';
import { createAudioContext } from '../utils/audioContext';

// Helper functions for decoding Base64 raw PCM audio data.
// These must be implemented manually as per Gemini API guidelines.
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


interface CinemaPlayerProps {
    isOpen: boolean;
    onClose: () => void;
    cinematic: Cinematic | null;
}

const CinemaPlayer: React.FC<CinemaPlayerProps> = ({ isOpen, onClose, cinematic }) => {
    const { t } = useLocalization();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const [isMuted, setIsMuted] = useState(false);

    const frames = cinematic?.frames || null;

    const stopAudio = useCallback(() => {
        if (audioSourceRef.current) {
            try {
                audioSourceRef.current.stop();
            } catch (e) {
                // It might already be stopped, which can throw an error. Safe to ignore.
            }
            audioSourceRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(e => console.error("Error closing audio context:", e));
            audioContextRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!isOpen) {
            stopAudio();
            return;
        }

        if (!isPlaying || !frames || frames.length === 0) {
            return;
        }

        const timer = setTimeout(() => {
            setCurrentIndex(prev => (prev + 1) % frames.length);
        }, 5000); // 5 seconds per frame

        return () => clearTimeout(timer);
    }, [currentIndex, isPlaying, isOpen, frames, stopAudio]);

    const startAudio = useCallback(() => {
        if (!cinematic?.audio_base64 || audioSourceRef.current) return;
        const audioBase64 = cinematic.audio_base64;
        const play = async () => {
            try {
                const context = createAudioContext({ sampleRate: 24000 });
                audioContextRef.current = context;

                const decodedBytes = decode(audioBase64);
                const audioBuffer = await decodeAudioData(decodedBytes, context, 24000, 1);

                const source = context.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(context.destination);
                source.start(0);
                audioSourceRef.current = source;
            } catch (e) {
                console.error("Failed to decode or play cinematic audio:", e);
            }
        };
        play();
    }, [cinematic]);

    useEffect(() => {
        // Reset the slide show when the modal opens or a new cinematic arrives.
        if (isOpen && cinematic) {
            setCurrentIndex(0);
            setIsPlaying(true);
            stopAudio();
            if (!isMuted) startAudio();
        }
    }, [cinematic, isOpen, startAudio, stopAudio, isMuted]);

    useEffect(() => {
        // Mute is a playback switch only: it must not restart the slide show.
        if (!isOpen) return;
        if (isMuted) stopAudio();
        else startAudio();
    }, [isMuted, isOpen, startAudio, stopAudio]);
    
    const handleClose = () => {
        stopAudio();
        onClose();
    };


    const nextFrame = useCallback(() => {
        if (!frames) return;
        setCurrentIndex(prev => (prev + 1) % frames.length);
    }, [frames]);

    const prevFrame = useCallback(() => {
        if (!frames) return;
        setCurrentIndex(prev => (prev - 1 + frames.length) % frames.length);
    }, [frames]);

    const currentFrame = frames?.[currentIndex];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={cinematic?.title || t('MovieTrailer')} size="fullscreen">
            <div className="cinema-player">
                {currentFrame && (
                    <div className="cinema-frame-container">
                        {currentFrame.imageUrl && <img src={currentFrame.imageUrl} alt={`Scene ${currentIndex + 1}`} className="cinema-frame" />}
                        <div className="cinema-subtitle">
                            <p>{stripModerationSymbols(currentFrame.subtitle)}</p>
                        </div>
                    </div>
                )}
                <div className="cinema-controls">
                    <div className="flex items-center gap-8">
                        <button onClick={prevFrame} className="cinema-control-button">
                            <ArrowLeftIcon className="w-8 h-8" />
                        </button>
                        <button onClick={() => setIsPlaying(p => !p)} className="cinema-control-button">
                            {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
                        </button>
                        <button onClick={nextFrame} className="cinema-control-button">
                            <ArrowRightIcon className="w-8 h-8" />
                        </button>
                        {cinematic?.audio_base64 && (
                            <button
                                onClick={() => setIsMuted(muted => !muted)}
                                className="cinema-control-button"
                                title={t(isMuted ? 'Unmute' : 'Mute')}
                                aria-label={t(isMuted ? 'Unmute' : 'Mute')}
                                aria-pressed={isMuted}
                                data-testid="cinema-mute"
                            >
                                {isMuted ? <SpeakerXMarkIcon className="w-8 h-8" /> : <SpeakerWaveIcon className="w-8 h-8" />}
                            </button>
                        )}
                    </div>
                    <div className="cinema-progress-bar">
                        <div className="cinema-progress-inner" style={{ width: `${((currentIndex + 1) / (frames?.length || 1)) * 100}%` }}></div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default CinemaPlayer;