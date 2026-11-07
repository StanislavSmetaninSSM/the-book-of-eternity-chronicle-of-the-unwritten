type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * Web Audio is only exposed as `webkitAudioContext` in older Safari builds; everywhere else the
 * standard constructor is used.
 */
export const createAudioContext = (options?: AudioContextOptions): AudioContext => {
    const AudioContextCtor = typeof window === 'undefined'
        ? undefined
        : window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('This browser does not support the Web Audio API');
    return new AudioContextCtor(options);
};
