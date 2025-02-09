/** 
 * assistant-openai.tsx v1.1
 *
 * Назначение: Логика взаимодействия с OpenAI (через streamText).
 * Определяет функцию `callOpenAIAssistant`, которая вызывает `streamText` 
 * и обрабатывает события (инструменты, onFinish и т. д.). 
 */

"use server";

import { z } from "zod";
import {
  streamText,
  type Message as AIMessage,
  type StreamData,
  type StepResult, // Важно для типа onFinish
  type CoreAssistantMessage,
  type CoreToolMessage,
} from "ai";

import { customModel } from "@/ai"; // ваш кастомный класс или функция для выбора модели
import { canvasPrompt, regularPrompt } from "@/ai/prompts";
import { generateUUID } from "@/lib/utils";
import { saveDocument } from "@/db/queries";

/** 
 * Параметры, которые передаём в callOpenAIAssistant 
 * (минимальный необходимый набор).
 */
interface OpenAIAssistantParams {
  modelId: string;          // Идентификатор модели (например, 'gpt-4o', 'gpt-4o-canvas', и т.д.)
  apiIdentifier: string;    // Напр. 'openai/gpt-4'
  latestUserMessage: AIMessage; // Последнее сообщение от пользователя
  streamingData: StreamData; // Объект, в который ассистент пишет дельты (частичный вывод)

  // Если у вас есть внешняя логика onFinish, которую надо вызвать 
  // (напр. из route.ts), можно передать её здесь. 
  // onFinishExternal?: (responseMessages: Message[]) => void | Promise<void>;

  // Прочие поля, если нужны (userId и т.п.)
  userId: string;
}

/**
 * Функция, которая вызывает streamText и возвращает 
 * StreamResponse (чтобы потом вы могли вызвать .toDataStreamResponse())
 */
export async function callOpenAIAssistant({
  modelId,
  apiIdentifier,
  latestUserMessage,
  streamingData,
  userId,
}: OpenAIAssistantParams) {
  // Пример инструмента createDocument:
  const createDocumentTool = {
    description: "Create a document for a writing activity",
    parameters: z.object({
      title: z.string(),
    }),
    execute: async ({ title }: { title: string }) => {
      const docId = generateUUID();
      let draftText = "";

      // Частичные дельты на фронт
      streamingData.append({ type: "id", content: docId });
      streamingData.append({ type: "title", content: title });
      streamingData.append({ type: "clear", content: "" });

      // Вызываем ещё раз streamText внутри инструмента (если нужно)
      const { fullStream } = await streamText({
        model: customModel(apiIdentifier),
        system:
          "Write about the given topic. Markdown is supported. Use headings wherever appropriate.",
        prompt: title,
      });

      for await (const delta of fullStream) {
        if (delta.type === "text-delta") {
          const { textDelta } = delta;
          draftText += textDelta;
          streamingData.append({
            type: "text-delta",
            content: textDelta,
          });
        }
      }

      // Сигнализируем о завершении инструмента
      streamingData.append({ type: "finish", content: "" });

      // Сохраняем документ в БД
      await saveDocument({
        id: docId,
        title,
        content: draftText,
        userId,
      });

      return {
        id: docId,
        title,
        content: "A document was created and is now visible to the user.",
      };
    },
  };

  // Собираем массив из одного сообщения (или больше, если нужно)
  const coreMessages = [latestUserMessage];

  /**
   * Запуск LLM через streamText 
   */
  const response = await streamText({
    model: customModel(apiIdentifier),
    system: modelId === "gpt-4o-canvas" ? canvasPrompt : regularPrompt,
    messages: coreMessages,
    maxSteps: 5,
    experimental_activeTools: ["createDocument"],
    tools: {
      createDocument: createDocumentTool,
    },

    // Обратите внимание: используем СИГНАТУРУ, которую ждёт библиотека.
    // Она даёт объект event (или stepResult), где:
    //  event.responseMessages = (CoreAssistantMessage|CoreToolMessage)[]
    onFinish: async (event) => {
      // Здесь event: Omit<StepResult<{ createDocument: ... }>, 'stepType'|'isContinued'> & {...}

      // Извлекаем "сырые" сообщения (CoreAssistantMessage|CoreToolMessage)
      const { responseMessages } = event;

      // Дальше вы решаете, нужно ли вам:
      // 1) сконвертировать их в Message[] (ai) со своими полями (id, content и т.п.),
      // 2) сохранить в БД, подсчитать токены и т.д.,
      // 3) или просто оставить как есть.

      // Если нужна логика извне, можно вызвать:
      // if (onFinishExternal) {
      //   await onFinishExternal( convertSomething(responseMessages) );
      // }

      // Или, например, просто логируем:
      console.log("Assistant finished with messages:", responseMessages);

      // Закрываем стрим
      streamingData.close();
    },
  });

  // Возвращаем объект (StreamResponse), у которого есть метод .toDataStreamResponse()
  return response;
}
