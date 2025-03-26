// ai/assistants/assistant-openai.tsx v1.2
'use server';

import { StreamData, generateId } from 'ai';
import { OpenAI } from 'openai';
import { searchEmails } from '@/lib/searchEmails'; 
// (пример, нужно заменить на ваш реальный путь/логику или удалить)
import { customModel } from '@/ai'; 
// (Если вам нужен customModel - адаптируйте)
import { z } from 'zod';

/**
 * Интерфейс параметров для вызова callOpenAIAssistant:
 * - question: текст запроса пользователя
 * - threadId?: если у вас уже есть сохранённый threadId, 
 *   передайте его, чтобы продолжить тред
 * - userId?: какой пользователь (если нужно для сохранения)
 * - streamingData: тот же объект, который вы создаёте в route.ts (new StreamData())
 */
interface CallOpenAIParams {
  question: string;
  threadId?: string;      // Если уже есть тред, продолжим
  userId?: string;        // Для примера, если нужно
  streamingData: StreamData;
}

/**
 * Создаём (или продолжаем) тред в OpenAI Threads API
 * и возвращаем объект, позволяющий отдать стрим-ответ (toDataStreamResponse).
 */
export async function callOpenAIAssistant({
  question,
  threadId,
  userId,
  streamingData,
}: CallOpenAIParams) {
  /**
   * Инициируем OpenAI-клиент. 
   * Предполагается, что вы укажете действительный API-ключ в .env
   * и используете новую бета-функциональность .beta.threads
   */
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Можно хранить локальные переменные для ThreadID / RunID.
  // Если вы хотите хранить их в БД, то сохраняйте, когда получите события thread.created
  let THREAD_ID = threadId || '';
  let RUN_ID = '';

  // Вспомогательный массив, в котором могут накапливаться прогоны (run) при вызове инструментов
  const runQueue: Array<{
    id: string;
    run: AsyncIterable<{
      data: any;
      event: string;
    }>;
  }> = [];

  // Пример инструмента (можно убрать, если не нужен).
  // В данном случае "поиск имейлов" с помощью локальной функции searchEmails.
  // Вызывается, когда ассистент говорит "requires_action -> submit_tool_outputs".
  const createDocumentTool = {
    description: 'Search for emails with given query and attachments filter',
    parameters: z.object({
      query: z.string(),
      has_attachments: z.boolean().optional(),
    }),
    execute: async ({
      query,
      has_attachments,
    }: {
      query: string;
      has_attachments?: boolean;
    }) => {
      // Эмуляция ожидания
      await new Promise((r) => setTimeout(r, 1000));

      // Считаем, что searchEmails - ваша функция, возвращающая какие-то mock-данные
      const found = searchEmails({ query, has_attachments });

      // Выводим результаты поиска как дельты
      streamingData.append({
        type: 'custom',
        content: `Found ${found.length} emails for query: ${query}`,
      });

      return found;
    },
  };

  /**
   * Функция, инициализирующая первый (или следующий) "прогон" (run)
   * либо создаёт тред с первым сообщением,
   * либо добавляет новое сообщение от пользователя в уже существующий тред.
   */
  async function initiateRun() {
    if (THREAD_ID) {
      // Уже есть тред, значит добавляем новое сообщение с ролью user
      await openai.beta.threads.messages.create(THREAD_ID, {
        role: 'user',
        content: question,
      });

      // Создаём run (stream: true, чтобы получать дельты)
      const run = await openai.beta.threads.runs.create(THREAD_ID, {
        // Здесь можно указать конкретного ассистента, если он есть
        assistant_id: 'asst_xxxx',
        stream: true,
      });

      runQueue.push({ id: generateId(), run });
    } else {
      // Треда нет, создаём и сразу запускаем
      const run = await openai.beta.threads.createAndRun({
        assistant_id: 'asst_xxxx',
        stream: true,
        thread: {
          messages: [
            { role: 'user', content: question },
          ],
        },
      });

      runQueue.push({ id: generateId(), run });
    }
  }

  // Инициируем первый "прогон"
  await initiateRun();

  // Асинхронно обрабатываем очередь
  (async () => {
    while (runQueue.length > 0) {
      const currentRun = runQueue.shift();
      if (!currentRun) continue;

      // Перебираем дельты из ассинхронного генератора run
      for await (const delta of currentRun.run) {
        const { data, event } = delta;

        // Для примера пишем в наш стрим: event -> data
        streamingData.append({
          type: 'info',
          content: `EVENT: ${event}`,
        });

        if (event === 'thread.created') {
          // Получаем ThreadID от OpenAI
          THREAD_ID = data.id;
          // Если надо - сохранить THREAD_ID в БД или прокинуть наружу
        } else if (event === 'thread.run.created') {
          RUN_ID = data.id;
        } else if (event === 'thread.message.delta') {
          // Это кусочки текста от ассистента
          // Если нужно построчно выдавать их на фронт
          if (data?.delta?.content) {
            for (const part of data.delta.content) {
              if (part.type === 'text') {
                // part.text.value - текстовая дельта
                streamingData.append({
                  type: 'text-delta',
                  content: part.text.value,
                });
              }
            }
          }
        } else if (event === 'thread.run.requires_action') {
          // Ассистент запросил инструмент (tool)
          const requiredAction = data.required_action;
          if (
            requiredAction &&
            requiredAction.type === 'submit_tool_outputs'
          ) {
            const { tool_calls } =
              requiredAction.submit_tool_outputs;
            const tool_outputs = [];

            for (const tool_call of tool_calls) {
              const { function: fn, id: toolCallId } = tool_call;
              // Предположим, ассистент хочет вызвать createDocumentTool
              if (fn.name === 'search_emails') {
                const args = JSON.parse(fn.arguments);
                // Выполняем инструмент
                const result = await createDocumentTool.execute(args);

                // Ответ для ассистента, что инструмент отработал
                tool_outputs.push({
                  tool_call_id: toolCallId,
                  output: JSON.stringify(result),
                });
              }
            }

            // Передаём результат инструмента обратно в OpenAI Threads
            const nextRun: any =
              await openai.beta.threads.runs.submitToolOutputs(
                THREAD_ID,
                RUN_ID,
                {
                  tool_outputs,
                  stream: true,
                }
              );

            // Добавляем новый run в очередь (ассистент может продолжить говорить)
            runQueue.push({ id: generateId(), run: nextRun });
          }
        } else if (event === 'thread.run.failed') {
          streamingData.append({
            type: 'error',
            content: JSON.stringify(data),
          });
        }
      }
    }

    // Когда очередь пустая, можно закрыть стрим
    streamingData.close();
  })();

  // Возвращаем объект, чтобы в route.ts v1.4
  // можно было вызвать .toDataStreamResponse({ data: streamingData })
  return {
    /**
     * toDataStreamResponse - метод, аналогичный тому, 
     * что возвращает streamText из 'ai'. 
     * Он преобразует ваш StreamData в готовый поток Response.
     */
    toDataStreamResponse: ({ data }: { data: StreamData }) => {
      return data.toResponse();
    },

    /**
     * Кроме того, при желании можно отдать наружу текущий THREAD_ID
     * (например, чтобы route.ts мог сохранить его в БД)
     */
    getThreadId: () => THREAD_ID,
  };
}
