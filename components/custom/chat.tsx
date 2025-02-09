// components/custom/chat.tsx v1.3
'use client';

import { Attachment, Message } from 'ai';
import { AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
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
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const [messages, setMessages] = useState<Array<Message>>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingData, setStreamingData] = useState<any>(null);
  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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

  /** Функция для обработки SSE-потока */
  const handleStream = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          modelId: selectedModelId,
          messages,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ошибка запроса: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const jsonData = JSON.parse(line.slice(6));
            console.log('SSE Data:', jsonData);

            if (jsonData.status === 'start') {
              setStreamingData(jsonData);
            } else if (jsonData.status === 'end') {
              setIsLoading(false);
            } else if (jsonData.message) {
              setMessages((prev) => [...prev, jsonData.message]);
            }
          } catch (error) {
            console.error('Ошибка парсинга SSE:', error);
          }
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки потока:', err);
      setError('Ошибка загрузки потока');
      toast.error('Произошла ошибка при получении данных.');
    } finally {
      setIsLoading(false);
    }
  };

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

        <form
          className="flex mx-auto px-4 bg-background pb-4 md:pb-6 gap-2 w-full md:max-w-3xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: input }]);
            setInput('');
            handleStream();
          }}
        >
          <MultimodalInput
            input={input}
            setInput={setInput}
            handleSubmit={() => handleStream()}
            isLoading={isLoading}
            stop={() => eventSourceRef.current?.close()}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={messages}
            setMessages={setMessages}
            append={async (msg) => {
              setMessages((prev) => [...prev, { ...msg, id: msg.id || Date.now().toString() }]);
              return Promise.resolve(msg.id || null);
            }}
          />
        </form>
      </div>

      <AnimatePresence>
        {canvas && canvas.isVisible && (
          <Canvas
            input={input}
            setInput={setInput}
            handleSubmit={() => handleStream()}
            isLoading={isLoading}
            stop={() => eventSourceRef.current?.close()}
            attachments={attachments}
            setAttachments={setAttachments}
            append={async (msg) => {
              setMessages((prev) => [...prev, { ...msg, id: msg.id || Date.now().toString() }]);
              return Promise.resolve(msg.id || null);
            }}
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
