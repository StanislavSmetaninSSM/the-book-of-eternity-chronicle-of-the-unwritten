import React, { useState, useMemo, useCallback } from 'react';
import { ChatMessage } from '../types';
import { BookOpenIcon, ArrowPathIcon, PencilSquareIcon, SpeakerWaveIcon, StopCircleIcon } from '@heroicons/react/24/solid';
import { XCircleIcon } from '@heroicons/react/24/outline';
import MarkdownRenderer from './MarkdownRenderer';
import { useLocalization } from '../context/LocalizationContext';
import { useSpeech } from '../context/SpeechContext';
import ConfirmationModal from './ConfirmationModal';
import { stripMarkdown } from '../utils/textUtils';

interface ChatWindowProps {
  history: ChatMessage[];
  error: string | null;
  onDeleteMessage: (index: number) => void;
  onShowMessageModal: (title: string, content: string) => void;
  onResend?: () => void;
  onShowEditModal: (index: number, message: ChatMessage) => void;
  allowHistoryManipulation: boolean;
  onRegenerate?: () => void;
  isLoading: boolean;
}

interface ChatMessageRowProps {
  message: ChatMessage;
  strippedContent: string;
  index: number;
  isLastPlayerMessage: boolean;
  isSpeakingThisMessage: boolean;
  allowHistoryManipulation: boolean;
  isLoading: boolean;
  onRegenerate?: () => void;
  onShowEditModal: (index: number, message: ChatMessage) => void;
  onShowMessageModal: (title: string, content: string) => void;
  onRequestDelete: (index: number) => void;
  onSpeak: (text: string) => void;
}

/**
 * A single chat entry. Memoized because the window re-renders on every streaming chunk
 * and on hover/toolbar state, while past messages keep the same text and handlers.
 */
const ChatMessageRow = React.memo(function ChatMessageRow({
  message,
  strippedContent,
  index,
  isLastPlayerMessage,
  isSpeakingThisMessage,
  allowHistoryManipulation,
  isLoading,
  onRegenerate,
  onShowEditModal,
  onShowMessageModal,
  onRequestDelete,
  onSpeak,
}: ChatMessageRowProps) {
  const { t } = useLocalization();
  const isPlayer = message.sender === 'player';

  return (
    <div className={`flex items-start group ${isPlayer ? 'justify-end' : 'justify-start'}`}>
      {/* For player messages, buttons are on the left */}
      {isPlayer && (
        <div className="flex items-center self-center opacity-40 group-hover:opacity-100 transition-opacity mr-2 flex-shrink-0 pointer-events-auto space-x-1">
          {isLastPlayerMessage && onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isLoading}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("Regenerate response")}
                title={t("Regenerate response")}
              >
                <ArrowPathIcon className="w-5 h-5" />
              </button>
          )}
          {allowHistoryManipulation && (
              <button
                onClick={() => onShowEditModal(index, message)}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
                aria-label={t("Edit")}
                title={t("Edit")}
              >
                <PencilSquareIcon className="w-5 h-5" />
              </button>
          )}
          <button
            onClick={() => onRequestDelete(index)}
            className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
            aria-label={t("Delete message")}
          >
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* The message bubble itself */}
      <div className={`flex items-start max-w-full`}>
        {!isPlayer && (
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center mr-3 flex-shrink-0 border border-gray-600">
            <BookOpenIcon className="w-5 h-5 text-cyan-400" />
          </div>
        )}
        <div
          onClick={() => onShowMessageModal(t("Message Details"), message.content)}
          className={`max-w-xl lg:max-w-3xl px-5 py-3 rounded-xl shadow-md cursor-pointer transition-all pointer-events-auto ${
            isPlayer
              ? 'bg-cyan-600 text-white rounded-br-none hover:bg-cyan-500'
              : 'bg-gray-800 text-gray-300 rounded-bl-none narrative-text hover:bg-gray-700'
          }`}
        >
          <MarkdownRenderer content={message.content} className="chat-message-content" />
        </div>
      </div>

      {/* For GM/System messages, buttons are on the right */}
      {!isPlayer && (
        <div className="flex items-center self-center opacity-40 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0 pointer-events-auto space-x-1">
          <button
            onClick={() => onSpeak(strippedContent)}
            className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
            aria-label={isSpeakingThisMessage ? t("Stop speech") : t("Read aloud")}
            title={isSpeakingThisMessage ? t("Stop speech") : t("Read aloud")}
          >
            {isSpeakingThisMessage
              ? <StopCircleIcon className="w-5 h-5 text-cyan-400 animate-pulse" />
              : <SpeakerWaveIcon className="w-5 h-5" />
            }
          </button>
          {allowHistoryManipulation && (
              <button
                onClick={() => onShowEditModal(index, message)}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
                aria-label={t("Edit")}
                title={t("Edit")}
              >
                <PencilSquareIcon className="w-5 h-5" />
              </button>
          )}
          <button
            onClick={() => onRequestDelete(index)}
            className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
            aria-label={t("Delete message")}
          >
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
});

export default function ChatWindow({ history, error, onDeleteMessage, onShowMessageModal, onResend, onShowEditModal, allowHistoryManipulation, onRegenerate, isLoading }: ChatWindowProps): React.ReactNode {
  const { t } = useLocalization();
  const { speak, isSpeaking, currentlySpeakingText } = useSpeech();
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleDeleteConfirm = useCallback(() => {
    setDeleteIndex(current => {
      if (current !== null) onDeleteMessage(current);
      return null;
    });
  }, [onDeleteMessage]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteIndex(null);
  }, []);

  // Stripping markdown is regex-heavy; do it once per history change instead of on
  // every render of every row.
  const strippedContents = useMemo(() => history.map(message => stripMarkdown(message.content)), [history]);

  const lastPlayerMessageIndex = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].sender === 'player') {
            return i;
        }
    }
    return -1;
  }, [history]);

  return (
    <div className="space-y-6" data-testid="chat-window">
      {history.map((msg, index) => (
        <ChatMessageRow
          key={index}
          message={msg}
          strippedContent={strippedContents[index]}
          index={index}
          isLastPlayerMessage={index === lastPlayerMessageIndex}
          isSpeakingThisMessage={isSpeaking && currentlySpeakingText === strippedContents[index]}
          allowHistoryManipulation={allowHistoryManipulation}
          isLoading={isLoading}
          onRegenerate={onRegenerate}
          onShowEditModal={onShowEditModal}
          onShowMessageModal={onShowMessageModal}
          onRequestDelete={setDeleteIndex}
          onSpeak={speak}
        />
      ))}
      {error && (
         <div className="flex justify-start pointer-events-auto">
            <div className="w-8 h-8 rounded-full bg-red-800 flex items-center justify-center mr-3 flex-shrink-0">
                <span className="text-red-300 font-bold">!</span>
            </div>
            <div className="max-w-xl lg:max-w-2xl px-5 py-3 rounded-xl bg-red-900/50 text-red-300 rounded-bl-none">
                <p className="font-semibold mb-1">{t("System Error")}</p>
                <MarkdownRenderer content={error} className="chat-message-content" />
                {onResend && (
                  <button
                    onClick={onResend}
                    disabled={isLoading}
                    className="mt-2 flex items-center gap-2 px-3 py-1 text-xs font-semibold text-yellow-300 bg-yellow-600/20 rounded-md hover:bg-yellow-600/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowPathIcon className="w-4 h-4" />
                    {t("Repeat last action")}
                  </button>
                )}
            </div>
         </div>
      )}
      <div ref={chatEndRef} />
      <ConfirmationModal
        isOpen={deleteIndex !== null}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title={t("Delete message")}
      >
        <p>{t("Are you sure you want to delete this message?")}</p>
      </ConfirmationModal>
    </div>
  );
}
