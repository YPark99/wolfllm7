// components/custom/chat.tsx v1.1
'use client';

import { Attachment, Message } from 'ai';
import { useChat } from 'ai/react';
import { AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { useWindowSize } from 'usehooks-ts';
import { toast } from 'sonner';

import { ChatHeader } from '@/components/custom/chat-header';
import { Message as PreviewMessage } from '@/components/custom/message';
import { useScrollToBottom } from '@/components/custom/use-scroll-to-bottom';

import { Canvas, UICanvas } from './canvas';
import { CanvasStreamHandler } from './canvas-stream-handler';
import { MultimodalInput } from './multimodal-input';
import { Overview } from './overview';

export function Chat({
  id,
  initialMessages,
  selectedModelId,
}: {
  id: string;
  initialMessages: Array<Message>;
  selectedModelId: string;
}) {
  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    isLoading,
    stop,
    data: streamingData,
  } = useChat({
    body: { id, modelId: selectedModelId },
    initialMessages,
    onFinish: () => {
      window.history.replaceState({}, '', `/chat/${id}`);
    },
    onError: async (err) => {
      // 1. Проверяем, что это HTTP-ответ
      if (err instanceof Response) {
        if (err.status === 403) {
          try {
            const data = await err.json();
            if (data?.status === 'insufficient_tokens') {
              toast.error('Недостаточно токенов!');
            } else {
              toast.error('Ошибка 403: Доступ запрещён');
            }
          } catch (parseError) {
            toast.error('Ошибка 403');
          }
        } else if (err.status === 401) {
          toast.error('Вы не авторизованы!');
        } else {
          toast.error(`Произошла ошибка: ${err.status}`);
        }
      } else {
        // 2. Иначе это не Response, а, скорее всего, обычная ошибка (Error).
        // Проверяем, есть ли в ней JSON со статусом
        let parsed: any = null;
        if (typeof err?.message === 'string') {
          try {
            parsed = JSON.parse(err.message);
          } catch (ignore) {
            // не валидный JSON — игнорируем
          }
        }

        // 3. Если распарсили и там действительно insufficient_tokens
        if (parsed?.status === 'insufficient_tokens') {
          toast.error('Недостаточно токенов!');
        } else {
          // в остальных случаях показываем, что есть
          toast.error(`Произошла ошибка: ${String(err)}`);
        }
      }
    },
  });

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const [canvas, setCanvas] = useState<UICanvas>({
    documentId: 'init',
    content: '',
    title: '',
    status: 'idle',
    isVisible: false,
    boundingBox: {
      top: (windowHeight ?? 1080) / 4,
      left: (windowWidth ?? 1920) / 4,
      width: 250,
      height: 50,
    },
  });

  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  return (
    <>
      <div className="flex flex-col min-w-0 h-dvh bg-background">
        <ChatHeader selectedModelId={selectedModelId} />
        <div
          ref={messagesContainerRef}
          className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll"
        >
          {messages.length === 0 && <Overview />}

          {messages.map((message) => (
            <PreviewMessage
              key={message.id}
              role={message.role}
              content={message.content}
              attachments={message.experimental_attachments}
              toolInvocations={message.toolInvocations}
              canvas={canvas}
              setCanvas={setCanvas}
            />
          ))}

          <div
            ref={messagesEndRef}
            className="shrink-0 min-w-[24px] min-h-[24px]"
          />
        </div>
        <form className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl">
          <MultimodalInput
            input={input}
            setInput={setInput}
            handleSubmit={handleSubmit}
            isLoading={isLoading}
            stop={stop}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={messages}
            setMessages={setMessages}
            append={append}
          />
        </form>
      </div>

      <AnimatePresence>
        {canvas && canvas.isVisible && (
          <Canvas
            input={input}
            setInput={setInput}
            handleSubmit={handleSubmit}
            isLoading={isLoading}
            stop={stop}
            attachments={attachments}
            setAttachments={setAttachments}
            append={append}
            canvas={canvas}
            setCanvas={setCanvas}
            messages={messages}
            setMessages={setMessages}
          />
        )}
      </AnimatePresence>

      <CanvasStreamHandler streamingData={streamingData} setCanvas={setCanvas} />
    </>
  );
}
