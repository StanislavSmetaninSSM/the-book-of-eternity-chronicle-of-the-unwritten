import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import StartScreen from './components/StartScreen';
import ArenaGmRelayPanel from './components/ArenaGmRelayPanel';
import { useLocalization } from './context/LocalizationContext';
import { useStartScreenStatus } from './hooks/useStartScreenStatus';
import { consumeStartupLoadRequest, markCrashDetected } from './utils/fileManager';
import type { GameStartRequest } from './components/GameHost';

// The game host owns the hook, its managers and every in-game screen. The start screen needs
// none of that, so the host is fetched only when a chronicle is started or loaded.
const GameHost = React.lazy(() => import('./components/GameHost'));

const LoadingScreen: React.FC<{ testId: string }> = ({ testId }) => {
    const { t } = useLocalization();
    return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center" data-testid={testId}>
            <p className="text-gray-300">{t('Loading Settings...')}</p>
        </div>
    );
};

export default function App(): React.ReactNode {
    const { interruptedTurnRecovery, autosaveTimestamp, crashRecoveryInfo, crashRecoveryMarker, dbSaveSlots, refresh } = useStartScreenStatus();
    const [request, setRequest] = useState<GameStartRequest | null>(null);
    const settleRef = useRef<((started: boolean) => void) | null>(null);
    const startupLoadHandledRef = useRef(false);

    const requestStart = useCallback((next: GameStartRequest): Promise<boolean> => new Promise<boolean>(resolve => {
        settleRef.current = resolve;
        setRequest(next);
    }), []);

    const handleSettled = useCallback((started: boolean) => {
        settleRef.current?.(started);
        settleRef.current = null;
        if (!started) {
            // A cancelled file dialog, a failed load or a discarded interrupted turn leaves the
            // player on the start screen, which may now show different save data.
            setRequest(null);
            void refresh();
        }
    }, [refresh]);

    const recordCrash = useCallback((source: string, error: unknown, componentStack?: string) => {
        markCrashDetected(source, error, componentStack);
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const handleWindowError = (event: ErrorEvent) => {
            recordCrash('window.error', event.error || event.message);
        };
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            recordCrash('window.unhandledrejection', event.reason);
        };

        window.addEventListener('error', handleWindowError);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        return () => {
            window.removeEventListener('error', handleWindowError);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, [recordCrash]);

    // A crash-recovery or autosave reload asks for a load before the app is even mounted.
    useEffect(() => {
        if (startupLoadHandledRef.current) return;
        startupLoadHandledRef.current = true;
        const startupLoadRequest = consumeStartupLoadRequest();
        if (startupLoadRequest === 'crashRecovery') void requestStart({ kind: 'crashRecovery' });
        else if (startupLoadRequest === 'autosave') void requestStart({ kind: 'autosave' });
    }, [requestStart]);

    if (request) {
        return (
            <Suspense fallback={<LoadingScreen testId="game-host-loading" />}>
                <GameHost request={request} onSettled={handleSettled} />
            </Suspense>
        );
    }

    return (
        <>
            <ArenaGmRelayPanel />
            <StartScreen
                onStartLocal={(creationData) => { void requestStart({ kind: 'new', creationData }); }}
                onLoadGame={async () => { await requestStart({ kind: 'file' }); }}
                onLoadAutosave={() => requestStart({ kind: 'autosave' })}
                autosaveTimestamp={autosaveTimestamp}
                crashRecoveryInfo={crashRecoveryInfo}
                crashRecoveryMarker={crashRecoveryMarker}
                onLoadCrashRecovery={() => requestStart({ kind: 'crashRecovery' })}
                interruptedTurnRecoveryMessage={interruptedTurnRecovery?.history.slice().reverse().find(message => message.sender === 'player')?.content || null}
                onResumeInterruptedTurn={async () => { await requestStart({ kind: 'interruptedTurn' }); }}
                onDiscardInterruptedTurn={() => { void requestStart({ kind: 'discardInterruptedTurn' }); }}
                onLoadFromSlot={async (slotId) => { await requestStart({ kind: 'slot', slotId }); }}
                dbSaveSlots={dbSaveSlots}
            />
        </>
    );
}
