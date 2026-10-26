import React from 'react';

interface ErrorBoundaryProps {
    name: string;
    children: React.ReactNode;
    compact?: boolean;
    className?: string;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    onLoadRecovery?: () => boolean | Promise<boolean>;
    onLoadAutosave?: () => boolean | Promise<boolean>;
}

interface ErrorBoundaryState {
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
    resetKey: number;
    recoveryActionError: string | null;
    isRecoveryActionRunning: boolean;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        error: null,
        errorInfo: null,
        resetKey: 0,
        recoveryActionError: null,
        isRecoveryActionRunning: false,
    };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error(`[ErrorBoundary:${this.props.name}]`, error, errorInfo);
        this.props.onError?.(error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = (): void => {
        this.setState((state) => ({
            error: null,
            errorInfo: null,
            resetKey: state.resetKey + 1,
            recoveryActionError: null,
            isRecoveryActionRunning: false,
        }));
    };

    handleRecoveryAction = async (action: () => boolean | Promise<boolean>): Promise<void> => {
        this.setState({ isRecoveryActionRunning: true, recoveryActionError: null });
        try {
            const didRecover = await action();
            if (didRecover) {
                this.handleReset();
                return;
            }

            this.setState({
                isRecoveryActionRunning: false,
                recoveryActionError: 'Восстановление не выполнено / Recovery did not complete',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setState({
                isRecoveryActionRunning: false,
                recoveryActionError: message,
            });
        }
    };

    render(): React.ReactNode {
        const { children, compact = false, className = '', name, onLoadRecovery, onLoadAutosave } = this.props;
        const { error, errorInfo, resetKey, recoveryActionError, isRecoveryActionRunning } = this.state;

        if (!error) {
            return <React.Fragment key={resetKey}>{children}</React.Fragment>;
        }

        const message = error.message || String(error);
        const stack = [error.stack, errorInfo?.componentStack].filter(Boolean).join('\n\n');
        const wrapperClassName = compact
            ? `pointer-events-auto w-full rounded-lg border border-red-500/40 bg-gray-900/90 p-4 text-gray-200 shadow-lg ${className}`
            : `pointer-events-auto flex min-h-screen w-full items-center justify-center bg-gray-900 p-6 text-gray-200 ${className}`;

        return (
            <div className={wrapperClassName}>
                <div className="w-full max-w-2xl rounded-lg border border-red-500/40 bg-gray-800/90 p-5 shadow-xl">
                    <div className="mb-4">
                        <h2 className="text-xl font-bold text-red-300">
                            Ошибка интерфейса / Interface error
                        </h2>
                        <p className="mt-2 text-sm text-gray-300">
                            {name}: {message}
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={this.handleReset}
                            disabled={isRecoveryActionRunning}
                            className="rounded-md bg-cyan-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-cyan-500"
                        >
                            Попробовать восстановить / Try to recover
                        </button>
                        {onLoadRecovery && (
                            <button
                                type="button"
                                onClick={() => this.handleRecoveryAction(onLoadRecovery)}
                                disabled={isRecoveryActionRunning}
                                className="rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-600"
                            >
                                Загрузить стабильное состояние / Load stable state
                            </button>
                        )}
                        {onLoadAutosave && (
                            <button
                                type="button"
                                onClick={() => this.handleRecoveryAction(onLoadAutosave)}
                                disabled={isRecoveryActionRunning}
                                className="rounded-md bg-gray-700 px-4 py-2 font-semibold text-white transition-colors hover:bg-gray-600 disabled:bg-gray-600"
                            >
                                Загрузить автосохранение / Load autosave
                            </button>
                        )}
                    </div>

                    {recoveryActionError && (
                        <p className="mt-3 text-sm text-red-200">
                            {recoveryActionError}
                        </p>
                    )}

                    <details className="mt-4 text-sm text-gray-300">
                        <summary className="cursor-pointer font-semibold text-gray-200">
                            Technical details
                        </summary>
                        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-gray-950/80 p-3 text-xs text-red-100">
                            {stack || message}
                        </pre>
                    </details>
                </div>
            </div>
        );
    }
}
