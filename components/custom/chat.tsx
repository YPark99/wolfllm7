// components/custom/chat.tsx v1.5.14
'use client';

import { useAssistant, Message, CreateMessage } from 'ai/react';
import { useEffect, useState } from 'react';

// Импорт UI-компонентов
import { ChatHeader } from '@/components/custom/chat-header';
import { MultimodalInput } from '@/components/custom/multimodal-input';
import { Message as PreviewMessage } from '@/components/custom/message';
import { useScrollToBottom } from '@/components/custom/use-scroll-to-bottom';
import { Canvas, UICanvas } from '@/components/custom/canvas';
import { CanvasStreamHandler } from '@/components/custom/canvas-stream-handler';

interface ChatProps {
  id: string;
  initialMessages: Message[];
  selectedModelId: string;
}

const Chat = ({ id, initialMessages, selectedModelId }: ChatProps) => {
  const {
    status,
    messages,
    input,
    submitMessage,
    handleInputChange,
    error,
    append,
    stop,
    setMessages,
    // Нет свойства data в useAssistant, поэтому убираем destructuring 'data'.
  } = useAssistant({ api: '/api/assistant' });

  // Если требуется передавать стриминговые данные в CanvasStreamHandler,
  // временно зададим переменную streamingData = undefined.
  // Если в будущем понадобятся настоящие данные стрима, нужно взять их из другого источника.
  const streamingData = undefined;

  // Используем наш хук для автопрокрутки
  const [messagesContainerRef, messagesEndRef] = useScrollToBottom<HTMLDivElement>();

  // Обёртка для изменения ввода
  const onSetInput = (value: string) => {
    handleInputChange({ target: { value } } as React.ChangeEvent<HTMLInputElement>);
  };

  // Функция отправки формы
  const onSubmit = (event?: { preventDefault?: () => void }): void => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    if (input.trim()) {
      submitMessage();
    }
  };

  // Обёртка для append
  const onAppend = async (
    message: Message | CreateMessage
  ): Promise<string | null | undefined> => {
    await append(message);
    return undefined;
  };

  // Состояние для Canvas
  const [canvas, setCanvas] = useState<UICanvas>({
    documentId: 'init',
    content: '',
    title: '',
    status: 'idle',
    isVisible: false,
    boundingBox: {
      top: 200,
      left: 400,
      width: 250,
      height: 50,
    },
  });

  // Состояние для вложений
  const [attachments, setAttachments] = useState<Array<any>>([]);

  // Автопрокрутка сообщений
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesEndRef]);

  return (
    <div className="flex flex-col min-h-screen">
      <ChatHeader selectedModelId={selectedModelId} />

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
        {messages.map((msg) => (
          <PreviewMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            attachments={msg.experimental_attachments}
            toolInvocations={msg.toolInvocations}
            canvas={canvas}
            setCanvas={setCanvas}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="text-red-500 p-2">Ошибка: {error.message}</div>}

      <form onSubmit={(e) => onSubmit(e)} className="p-4 flex gap-2">
        <MultimodalInput
          input={input}
          setInput={onSetInput}
          attachments={attachments}
          setAttachments={setAttachments}
          isLoading={status === 'in_progress'}
          stop={stop}
          messages={messages}
          setMessages={setMessages}
          append={onAppend}
          handleSubmit={onSubmit}
        />
        <button type="submit" disabled={status === 'in_progress'}>
          Отправить
        </button>
      </form>

      {/* Компонент Canvas */}
      {canvas.isVisible && (
        <Canvas
          input={input}
          setInput={onSetInput}
          handleSubmit={onSubmit}
          isLoading={status === 'in_progress'}
          stop={stop}
          attachments={attachments}
          setAttachments={setAttachments}
          append={onAppend}
          canvas={canvas}
          setCanvas={setCanvas}
          messages={messages}
          setMessages={setMessages}
        />
      )}

      {/* Передаём streamingData={undefined} */}
      <CanvasStreamHandler
        streamingData={streamingData}
        setCanvas={setCanvas}
      />
    </div>
  );
};

export default Chat;
