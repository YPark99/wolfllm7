// app(chat)/api/chat/route.ts v1.3 (пример)

// Импортируйте нужные штуки
import {
  convertToCoreMessages,
  streamText,
  StreamData,
  Message,
} from 'ai';
import { z } from 'zod';
import { customModel } from '@/ai';
import { models } from '@/ai/models';
import { canvasPrompt, regularPrompt } from '@/ai/prompts';
import { auth } from '@/app/(auth)/auth';
import {
  saveDocument,
  saveChat,
  deleteChatById,
  getChatById,
} from '@/db/queries';
import { generateUUID, sanitizeResponseMessages } from '@/lib/utils';
import {
  countTokensInMessage,
  countTokensInResponse,
} from '@/lib/tokenCounter';
import { db } from '@/db/queries';
import { tokenRecords } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export const maxDuration = 60;
type AllowedTools = 'createDocument' | 'updateDocument' | 'requestSuggestions';

export async function POST(request: Request) {
  const { id, messages, modelId }: { id: string; messages: Message[]; modelId: string } =
    await request.json();

  const session = await auth();
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = session.user.id;

  // Определяем модель
  const model = models.find((m) => m.id === modelId);
  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  // Берём только последнее сообщение (текущий запрос пользователя)
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || typeof latestMessage.content !== 'string') {
    return new Response('No valid message content provided', { status: 400 });
  }

  // Считаем токены для ОДНОГО последнего сообщения
  const userTokenCount = await countTokensInMessage(latestMessage.content, model);

  // Получаем текущий баланс пользователя
  const [balanceRecord] = await db
    .select({ tokensBalance: tokenRecords.tokensBalance })
    .from(tokenRecords)
    .where(eq(tokenRecords.userId, userId))
    .orderBy(desc(tokenRecords.createdAt))
    .limit(1);

  const userBalance = balanceRecord?.tokensBalance ?? 0;

  // Проверяем, хватит ли баланса на текущее сообщение
  if (userBalance < userTokenCount) {
    return new Response(JSON.stringify({ status: 'insufficient_tokens' }), {
      status: 403,
    });
  }

  // Готовим стрим
  const streamingData = new StreamData();

  // Передаём в LLM только одно сообщение
  const coreMessages = convertToCoreMessages([latestMessage]);

  const result = await streamText({
    model: customModel(model.apiIdentifier),
    system: modelId === 'gpt-4o-canvas' ? canvasPrompt : regularPrompt,
    messages: coreMessages,
    maxSteps: 5,
    // Пример с инструментом createDocument (можно убрать, если не нужно)
    experimental_activeTools: ['createDocument'],
    tools: {
      createDocument: {
        description: 'Create a document for a writing activity',
        parameters: z.object({
          title: z.string(),
        }),
        execute: async ({ title }) => {
          const docId = generateUUID();
          let draftText = '';

          // Шлём частичные дельты на фронт
          streamingData.append({ type: 'id', content: docId });
          streamingData.append({ type: 'title', content: title });
          streamingData.append({ type: 'clear', content: '' });

          // Генерируем текст внутри инструмента
          const { fullStream } = await streamText({
            model: customModel(model.apiIdentifier),
            system:
              'Write about the given topic. Markdown is supported. Use headings wherever appropriate.',
            prompt: title,
          });

          for await (const delta of fullStream) {
            if (delta.type === 'text-delta') {
              const { textDelta } = delta;
              draftText += textDelta;
              streamingData.append({
                type: 'text-delta',
                content: textDelta,
              });
            }
          }

          streamingData.append({ type: 'finish', content: '' });

          // Сохраняем
          await saveDocument({
            id: docId,
            title,
            content: draftText,
            userId,
          });

          return {
            id: docId,
            title,
            content: 'A document was created and is now visible to the user.',
          };
        },
      },
    },
    onFinish: async ({ responseMessages }) => {
      // Подсчитываем токены в ответе
      const apiResponseText = responseMessages.map((m) => m.content).join('');
      const responseTokenCount = countTokensInResponse(apiResponseText, model);

      // Сколько всего потратили (последнее сообщение + ответ LLM)
      const totalTokensUsed = userTokenCount + responseTokenCount;
      const newBalance = userBalance - totalTokensUsed;

      // Если вдруг баланс ушёл в минус
      if (newBalance < 0) {
        console.error(`User ${userId} has insufficient tokens after response.`);
        // Можно ничего не возвращать, т. к. ответ уже частично ушёл
        return;
      }

      // Обновляем запись в tokenRecords
      await db.insert(tokenRecords).values({
        userId,
        tokensBalance: newBalance,
        tokensUsed: totalTokensUsed,
        description: 'Chat interaction',
      });

      // Сохраняем чат (если нужно)
      try {
        const cleanedResponseMessages = sanitizeResponseMessages(responseMessages);
        await saveChat({
          id,
          messages: [...messages, ...cleanedResponseMessages],
          userId,
        });
      } catch (error) {
        console.error('Failed to save chat', error);
      }

      streamingData.close();
    },
  });

  return result.toDataStreamResponse({
    data: streamingData,
  });
}

// Удаление чата (пример)
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session?.user) {
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
