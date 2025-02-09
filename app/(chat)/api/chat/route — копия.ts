import {
  convertToCoreMessages,
  generateObject,
  Message,
  StreamData,
  streamObject,
  streamText,
} from 'ai';
import { z } from 'zod';
import { customModel } from '@/ai';
import { models } from '@/ai/models';
import { canvasPrompt, regularPrompt } from '@/ai/prompts';
import { auth } from '@/app/(auth)/auth';
import {
  deleteChatById,
  getChatById,
  getDocumentById,
  saveChat,
  saveDocument,
  saveSuggestions,
} from '@/db/queries';
import { Suggestion } from '@/db/schema';
import { generateUUID, sanitizeResponseMessages } from '@/lib/utils';

// Импортируем функции подсчета токенов
import { countTokensInMessage, countTokensInResponse } from '@/lib/tokenCounter';
import { Model } from '@/ai/models';
import { LanguageModelV1, LanguageModelV1CallOptions, LanguageModelV1StreamPart,  } from 'ai';
/**
 * Преобразует объект модели типа `Model` в формат, ожидаемый API (`LanguageModelV1`).
 *
 * Это необходимо, так как тип `Model` из `models.ts` не содержит всех полей,
 * требуемых функцией `streamText`. Функция дополняет недостающие свойства,
 * такие как `specificationVersion`, `provider`, и `defaultObjectGenerationMode`.
 *
 * @param model - объект модели типа `Model`
 * @returns объект модели типа `LanguageModelV1`, совместимый с функцией `streamText`
 */

function toLanguageModelV1(model: Model): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'custom',
    modelId: model.apiIdentifier,
    defaultObjectGenerationMode: 'json',
    doGenerate: async (options: LanguageModelV1CallOptions) => {
      return {
        text: `Generated response for prompt: ${options.prompt}`,
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawCall: {
          rawPrompt: options.prompt,
          rawSettings: {},
        },
      };
    },
    doStream: async (options: LanguageModelV1CallOptions) => {
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          // Создаем пример потоковой передачи данных
          const textDelta = `Streaming response for: ${options.prompt}`;
          controller.enqueue({ type: 'text-delta', textDelta });
          controller.close();
        },
      });

      return {
        stream,
        rawCall: {
          rawPrompt: options.prompt,
          rawSettings: {},
        },
        rawResponse: {
          headers: {},
        },
        request: {
          body: JSON.stringify(options),
        },
        warnings: [],
      };
    },
  };
}

export const toLanguageModel = toLanguageModelV1;



export const maxDuration = 60;

type AllowedTools =
  | 'createDocument'
  | 'updateDocument'
  | 'requestSuggestions'
  | 'getWeather';

const canvasTools: AllowedTools[] = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
];

const weatherTools: AllowedTools[] = ['getWeather'];

export async function POST(request: Request) {
  const {
    id,
    messages,
    modelId,
  }: { id: string; messages: Array<Message>; modelId: string } =
    await request.json();

  const session = await auth();

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const model = models.find((model) => model.id === modelId);

  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  
  // Получаем ID выбранной модели из запроса
  const modelIdFromRequest = modelId; // предполагаем, что modelId передается с клиента
  const selectedModel = models.find((model) => model.id === modelIdFromRequest) || models[0];
  
  // Преобразуем сообщения в coreMessages
  const coreMessages = convertToCoreMessages(messages);
  
  //  
  const userTokenCount = await coreMessages.reduce(
    async (totalPromise: Promise<number>, msg) => {
      const total = await totalPromise;
      if (typeof msg.content === 'string') {
        return total + await countTokensInMessage(msg.content, selectedModel);
      }
      return total;
    },
    Promise.resolve(0) // начальное значение
  );
  
  // Выводим количество токенов пользователя в консоль
  console.log(`User token count for model ${selectedModel.label}: ${userTokenCount}`);
 
 // Отправляем запрос к модели и получаем поток данных
const apiResult = await streamText({
  model: toLanguageModelV1(selectedModel), // Используем объект модели, а не строку
  messages: coreMessages,
});

// Получаем текст ответа из потока
let apiResponseText = '';
for await (const delta of apiResult.fullStream) {
  if (delta.type === 'text-delta') {
    apiResponseText += delta.textDelta;
  }
}

// Подсчитываем токены в ответе API
const responseTokenCount = countTokensInResponse(apiResponseText, selectedModel);
// Выводим количество токенов в ответе API в консоль
console.log(`API response token count for model ${selectedModel.label}: ${responseTokenCount}`);

  const streamingData = new StreamData();

  const result = await streamText({
    model: customModel(model.apiIdentifier),
    system: modelId === 'gpt-4o-canvas' ? canvasPrompt : regularPrompt,
    messages: coreMessages,
    maxSteps: 5,
    experimental_activeTools:
      modelId === 'gpt-4o-canvas' ? canvasTools : weatherTools,
    tools: {
      getWeather: {
        description: 'Get the current weather at a location',
        parameters: z.object({
          latitude: z.number(),
          longitude: z.number(),
        }),
        execute: async ({ latitude, longitude }) => {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
          );

          const weatherData = await response.json();
          return weatherData;
        },
      },
      createDocument: {
        description: 'Create a document for a writing activity',
        parameters: z.object({
          title: z.string(),
        }),
        execute: async ({ title }) => {
          const id = generateUUID();
          let draftText: string = '';

          streamingData.append({
            type: 'id',
            content: id,
          });

          streamingData.append({
            type: 'title',
            content: title,
          });

          streamingData.append({
            type: 'clear',
            content: '',
          });

          const { fullStream } = await streamText({
            model: customModel(model.apiIdentifier),
            system:
              'Write about the given topic. Markdown is supported. Use headings wherever appropriate.',
            prompt: title,
          });

          for await (const delta of fullStream) {
            const { type } = delta;

            if (type === 'text-delta') {
              const { textDelta } = delta;

              draftText += textDelta;
              streamingData.append({
                type: 'text-delta',
                content: textDelta,
              });
            }
          }

          streamingData.append({ type: 'finish', content: '' });

          if (session.user && session.user.id) {
            await saveDocument({
              id,
              title,
              content: draftText,
              userId: session.user.id,
            });
          }

          return {
            id,
            title,
            content: `A document was created and is now visible to the user.`,
          };
        },
      },
      updateDocument: {
        description: 'Update a document with the given description',
        parameters: z.object({
          id: z.string().describe('The ID of the document to update'),
          description: z
            .string()
            .describe('The description of changes that need to be made'),
        }),
        execute: async ({ id, description }) => {
          const document = await getDocumentById({ id });

          if (!document) {
            return {
              error: 'Document not found',
            };
          }

          const { content: currentContent } = document;
          let draftText: string = '';

          streamingData.append({
            type: 'clear',
            content: document.title,
          });

          const { fullStream } = await streamText({
            model: customModel(model.apiIdentifier),
            system:
              'You are a helpful writing assistant. Based on the description, please update the piece of writing.',
            messages: [
              {
                role: 'user',
                content: description,
              },
              { role: 'user', content: currentContent },
            ],
          });

          for await (const delta of fullStream) {
            const { type } = delta;

            if (type === 'text-delta') {
              const { textDelta } = delta;

              draftText += textDelta;
              streamingData.append({
                type: 'text-delta',
                content: textDelta,
              });
            }
          }

          streamingData.append({ type: 'finish', content: '' });

          if (session.user && session.user.id) {
            await saveDocument({
              id,
              title: document.title,
              content: draftText,
              userId: session.user.id,
            });
          }

          return {
            id,
            title: document.title,
            content: 'The document has been updated successfully.',
          };
        },
      },
      requestSuggestions: {
        description: 'Request suggestions for a document',
        parameters: z.object({
          documentId: z
            .string()
            .describe('The ID of the document to request edits'),
        }),
        execute: async ({ documentId }) => {
          const document = await getDocumentById({ id: documentId });

          if (!document || !document.content) {
            return {
              error: 'Document not found',
            };
          }

          let suggestions: Array<
            Omit<Suggestion, 'userId' | 'createdAt' | 'documentCreatedAt'>
          > = [];

          const { elementStream } = await streamObject({
            model: customModel(model.apiIdentifier),
            system:
              'You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words.',
            prompt: document.content,
            output: 'array',
            schema: z.object({
              originalSentence: z.string().describe('The original sentence'),
              suggestedSentence: z.string().describe('The suggested sentence'),
              description: z
                .string()
                .describe('The description of the suggestion'),
            }),
          });

          for await (const element of elementStream) {
            const suggestion = {
              originalText: element.originalSentence,
              suggestedText: element.suggestedSentence,
              description: element.description,
              id: generateUUID(),
              documentId: documentId,
              isResolved: false,
            };

            streamingData.append({
              type: 'suggestion',
              content: suggestion,
            });

            suggestions.push(suggestion);
          }

          if (session.user && session.user.id) {
            const userId = session.user.id;

            await saveSuggestions({
              suggestions: suggestions.map((suggestion) => ({
                ...suggestion,
                userId,
                createdAt: new Date(),
                documentCreatedAt: document.createdAt,
              })),
            });
          }

          return {
            id: documentId,
            title: document.title,
            message: 'Suggestions have been added to the document',
          };
        },
      },
    },
    onFinish: async ({ responseMessages }) => {
      if (session.user && session.user.id) {
        try {
          const responseMessagesWithoutIncompleteToolCalls =
            sanitizeResponseMessages(responseMessages);

          await saveChat({
            id,
            messages: [
              ...coreMessages,
              ...responseMessagesWithoutIncompleteToolCalls,
            ],
            userId: session.user.id,
          });
        } catch (error) {
          console.error('Failed to save chat');
        }
      }

      streamingData.close();
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'stream-text',
    },
  });

  return result.toDataStreamResponse({
    data: streamingData,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
