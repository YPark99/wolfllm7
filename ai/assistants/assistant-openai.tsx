'use server';

/**
 * assistant-openai.tsx v1.7
 *
 * Цель: сформировать "план" (execute + onError) для createDataStreamResponse(...)
 * без методов write/close, которых нет в DataStreamWriter у вас.
 * Вместо этого используем writer.enqueue(...) для отправки сообщений.
 */

import { type DataStreamWriter } from 'ai'; 
import { OpenAI } from 'openai';
import { z } from 'zod';

// Пример инструмента (при необходимости)
const searchEmailsTool = {
  description: 'Search emails by query',
  parameters: z.object({
    query: z.string(),
  }),
  async execute({ query }: { query: string }) {
    // Возвращаем фейковые результаты
    return [`Email for query="${query}"`];
  },
};

interface CallOpenAIParams {
  question: string;
  threadId?: string;
  userId?: string;
}

/**
 * Возвращаем объект, совместимый с createDataStreamResponse(...) из 'ai':
 * - async execute(writer): основная логика стриминга
 * - onError(error): обработка ошибок (опционально)
 * - getThreadId(): доступ к ThreadID
 */
export function getOpenAIThreadPlan({
  question,
  threadId,
  userId,
}: CallOpenAIParams) {
  let THREAD_ID = threadId || '';
  let RUN_ID = '';

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return {
    async execute(writer: DataStreamWriter) {
      try {
        // Если нет threadId, создаём тред
        if (!THREAD_ID) {
          const run = await openai.beta.threads.createAndRun({
            assistant_id: 'asst_xxxx',
            stream: true,
            thread: {
              messages: [{ role: 'user', content: question }],
            },
          });

          for await (const delta of run) {
            await handleDelta(delta, writer);
          }
        } else {
          // Продолжаем существующий тред
          await openai.beta.threads.messages.create(THREAD_ID, {
            role: 'user',
            content: question,
          });

          const run = await openai.beta.threads.runs.create(THREAD_ID, {
            assistant_id: 'asst_xxxx',
            stream: true,
          });

          for await (const delta of run) {
            await handleDelta(delta, writer);
          }
        }

        // Завершаем стрим, если доступен метод end()
        // Если у вас ошибка "Property 'end' does not exist...",
        // закомментируйте строку ниже.
        (writer as any).end?.();

      } catch (error) {
        // Передаём информацию об ошибке
        writer.enqueue?.(
          JSON.stringify({
            type: 'error',
            message: String(error),
          })
        );
        (writer as any).end?.();
      }
    },

    // Позволяет переопределить формат ошибки (опционально)
    onError(error: unknown) {
      // Возвращаем строку, которая пойдёт в поток
      return JSON.stringify({ type: 'global-error', detail: String(error) });
    },

    getThreadId() {
      return THREAD_ID;
    },
  };

  /**
   * Локальная функция для обработки дельты (event+data).
   */
  async function handleDelta(
    delta: { data: any; event: string },
    writer: DataStreamWriter
  ) {
    const { data, event } = delta;

    // Логируем event
    writer.enqueue?.(JSON.stringify({ type: 'event', event }));

    if (event === 'thread.created') {
      THREAD_ID = data.id;
    } else if (event === 'thread.run.created') {
      RUN_ID = data.id;
    } else if (event === 'thread.message.delta') {
      if (data?.delta?.content) {
        for (const part of data.delta.content) {
          if (part.type === 'text') {
            writer.enqueue?.(
              JSON.stringify({
                type: 'assistant_text',
                content: part.text.value,
              })
            );
          }
        }
      }
    } else if (event === 'thread.run.requires_action') {
      const requiredAction = data.required_action;
      if (requiredAction?.type === 'submit_tool_outputs') {
        const { tool_calls } = requiredAction.submit_tool_outputs;
        const tool_outputs = [];

        for (const call of tool_calls) {
          const { function: fn, id: toolCallId } = call;
          if (fn.name === 'search_emails') {
            const args = JSON.parse(fn.arguments);
            const result = await searchEmailsTool.execute(args);
            tool_outputs.push({
              tool_call_id: toolCallId,
              output: JSON.stringify(result),
            });
          }
        }

        // Передаём результат инструмента
        const nextRun = await openai.beta.threads.runs.submitToolOutputs(
          THREAD_ID,
          RUN_ID,
          {
            tool_outputs,
            stream: true,
          }
        );

        // Читаем новые дельты
        for await (const delta2 of nextRun) {
          await handleDelta(delta2, writer);
        }
      }
    } else if (event === 'thread.run.failed') {
      writer.enqueue?.(
        JSON.stringify({
          type: 'run-failed',
          detail: data,
        })
      );
    }
  }
}
