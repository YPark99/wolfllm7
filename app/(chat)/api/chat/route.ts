// app(chat)/api/chat/route.ts v1.3.1
import { AssistantResponse } from 'ai';
import OpenAI from 'openai';
import { convertToCoreMessages, Message } from 'ai';
import { z } from 'zod';
import { customModel } from '@/ai';
import { models } from '@/ai/models';
import { canvasPrompt, regularPrompt } from '@/ai/prompts';
import { auth } from '@/app/(auth)/auth';
import {
  saveChat,
  getChatById,
  deleteChatById,
} from '@/db/queries';
import { generateUUID } from '@/lib/utils';
import {
  countTokensInMessage,
  countTokensInResponse,
} from '@/lib/tokenCounter';
import { db } from '@/db/queries';
import { tokenRecords } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

// Инициализируем клиента OpenAI с использованием API-ключа из окружения
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export async function POST(request: Request) {
  // Ожидаем, что тело запроса содержит: { id, messages, modelId, threadId? }
  const { id, messages, modelId, threadId } = await request.json() as {
    id: string;
    messages: Message[];
    modelId: string;
    threadId?: string | null;
  };

  // Проверка аутентификации
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

  // Берём последнее сообщение пользователя
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || typeof latestMessage.content !== 'string') {
    return new Response('No valid message content provided', { status: 400 });
  }

  // Подсчитываем токены для последнего сообщения
  const userTokenCount = await countTokensInMessage(latestMessage.content, model);

  // Проверяем баланс пользователя
  const [balanceRecord] = await db
    .select({ tokensBalance: tokenRecords.tokensBalance })
    .from(tokenRecords)
    .where(eq(tokenRecords.userId, userId))
    .orderBy(desc(tokenRecords.createdAt))
    .limit(1);
  const userBalance = balanceRecord?.tokensBalance ?? 0;
  if (userBalance < userTokenCount) {
    return new Response(JSON.stringify({ status: 'insufficient_tokens' }), {
      status: 403,
    });
  }

  // Если threadId не передан, создаём новый поток через OpenAI
  const computedThreadId =
    threadId ?? (await openai.beta.threads.create({})).id;
  console.log('Generated threadId:', computedThreadId);

  // Создаём сообщение пользователя в потоке
  const createdMessage = await openai.beta.threads.messages.create(
    computedThreadId,
    {
      role: 'user',
      content: latestMessage.content,
    }
  );

  // Логирование информации о созданном сообщении
  console.log('Created message in thread:', {
    threadId: computedThreadId,
    messageId: createdMessage.id,
    content: latestMessage.content,
  });

  // Возвращаем стриминговый ответ через AssistantResponse
  return AssistantResponse(
    { threadId: computedThreadId, messageId: createdMessage.id },
    async ({ forwardStream }) => {
      try {
        // Запускаем стриминг ответа ассистента через OpenAI beta threads API
        const runStream = openai.beta.threads.runs.stream(computedThreadId, {
          assistant_id:
            process.env.ASSISTANT_ID ??
            (() => {
              throw new Error('ASSISTANT_ID environment is not set');
            })(),
        });

        console.log('Started streaming response from OpenAI for thread:', computedThreadId);

        // Логируем данные, поступающие в поток
        for await (const chunk of runStream) {
          console.log('Stream chunk received:', chunk);
        }

        await forwardStream(runStream);
      } catch (error) {
        console.error('Error while streaming response:', error);
      }
    }
  );
}

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
