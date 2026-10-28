import React, { useEffect, useState } from 'react';
import {
  ArenaGmTurnRequest,
  getArenaGmRequestEventName,
  parseArenaGmTurnResponse,
} from '../utils/arenaGmRelay';

type RequestDetail = {
  request: ArenaGmTurnRequest;
  resolve: (response: any) => void;
  reject: (reason: Error) => void;
};

export default function ArenaGmRelayPanel(): React.ReactNode {
  const [pending, setPending] = useState<RequestDetail | null>(null);
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<RequestDetail>).detail;
      setPending(detail);
      setResponseText('');
      setError('');
      setCopied(false);
    };
    window.addEventListener(getArenaGmRequestEventName(), onRequest);
    return () => {
      window.removeEventListener(getArenaGmRequestEventName(), onRequest);
    };
  }, []);

  const copyRequest = async () => {
    if (!pending) return;
    const text = JSON.stringify(pending.request, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the request text manually.');
    }
  };
  const applyResponse = () => {
    if (!pending) return;
    try {
      const parsed = parseArenaGmTurnResponse(responseText, pending.request.correlationId);
      pending.resolve(parsed.response);
      setPending(null);
      setResponseText('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate response.');
    }
  };
  const cancel = () => {
    pending?.reject(new Error('Arena GM Relay turn cancelled by the user.'));
    setPending(null);
    setResponseText('');
    setError('');
  };

  return <>
    <div
      className="fixed top-4 left-4 z-[1200] rounded-lg border border-emerald-400 bg-emerald-950/90 px-3 py-2 text-xs font-semibold text-emerald-200 shadow-lg backdrop-blur"
      title="Text and image generation are routed through the Arena GM relay"
      role="status"
    >
      Arena GM: active
    </div>

    {pending && <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-3 md:p-8">
      <section className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-cyan-700 bg-gray-950 text-gray-100 shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-800 p-4">
          <div>
            <h2 className="text-lg font-bold text-cyan-200">Arena GM Relay — передача хода</h2>
            <p className="text-xs text-gray-400">Скопируйте запрос в чат Arena, затем вставьте ответ ГМа сюда.</p>
          </div>
          <button type="button" onClick={cancel} className="rounded px-3 py-1 text-sm text-gray-300 hover:bg-gray-800">Отмена</button>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <div className="flex min-h-[280px] flex-col gap-2">
            <div className="flex items-center justify-between"><label className="font-semibold">Запрос для Arena</label><button type="button" onClick={copyRequest} className="rounded bg-cyan-800 px-3 py-1.5 text-sm hover:bg-cyan-700">{copied ? 'Скопировано' : 'Копировать запрос'}</button></div>
            <textarea readOnly value={JSON.stringify(pending.request, null, 2)} className="min-h-[260px] flex-1 resize-y rounded border border-gray-700 bg-gray-900 p-3 font-mono text-xs text-gray-300" />
          </div>
          <div className="flex min-h-[280px] flex-col gap-2">
            <label htmlFor="arena-gm-response" className="font-semibold">Ответ ГМа (JSON)</label>
            <textarea id="arena-gm-response" value={responseText} onChange={event => { setResponseText(event.target.value); setError(''); }} placeholder={'Вставьте JSON-ответ вида:\n{"kind":"arena-gm-response","protocolVersion":1,"correlationId":"...","response":{"response":"..."}}'} className="min-h-[260px] flex-1 resize-y rounded border border-gray-700 bg-gray-900 p-3 font-mono text-xs text-gray-100" />
            {error && <p role="alert" className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
            <button type="button" onClick={applyResponse} disabled={!responseText.trim()} className="rounded bg-emerald-700 px-4 py-2 font-semibold hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">Проверить и применить ход</button>
          </div>
        </div>
        <footer className="border-t border-gray-800 px-4 py-3 text-xs text-gray-500">Проверьте содержимое ответа перед применением. Он будет обработан игровым конвейером как обычный ответ ГМа.</footer>
      </section>
    </div>}
  </>;
}
