// app(chat)/api/chat/route.ts v1.6.0
import OpenAI from 'openai';
import { auth } from '@/app/(auth)/auth';
import { saveChat, getChatsByUserId } from '@/db/queries';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export async function submitMessage({
  threadId,
  userId,
  content,
}: {
  threadId?: string;
  userId: string;
  content: string;
}) {
  let newThreadId = threadId;

  if (!newThreadId) {
    const thread = await openai.beta.threads.create();
    newThreadId = thread.id;
  }

  if (!newThreadId) {
    throw new Error('Thread ID is undefined');
  }

  // **Добавляем запуск ассистента (run)**
  const run = await openai.beta.threads.runs.create(newThreadId, {
    assistant_id: process.env.ASSISTANT_ID!,
  });

  // **Ждем завершения работы ассистента**
  let runStatus = run.status;
  while (runStatus !== "completed") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const updatedRun = await openai.beta.threads.runs.retrieve(newThreadId, run.id);
    runStatus = updatedRun.status;
  }

  // **Получаем окончательный список сообщений**
  const response = await openai.beta.threads.messages.list(newThreadId);
  const messages: Message[] = response.data.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant',
    content: extractTextFromMessageContent(message.content),
  }));

  try {
    console.log("Saving chat with threadId:", newThreadId);
    await saveChat({
      id: newThreadId,
      messages,
      userId,
      threadId: newThreadId,
    });
  } catch (error) {
    console.error(`PostgresError while saving chat: ${error instanceof Error ? error.message : error}`);
  }

  return { threadId: newThreadId, messages };
}

function extractTextFromMessageContent(content: any[]): string {
  if (!Array.isArray(content)) {
    return "Error: Invalid content format";
  }

  return content
    .map((block) => {
      if ('text' in block) {
        return block.text.value;
      } else if ('image_url' in block) {
        return `[Image: ${block.image_url}]`;
      }
      return 'Unknown content type';
    })
    .join('\n');
}

export async function POST(request: Request) {
  try {
    const { id, messages, modelId }: { id: string; messages: any[]; modelId: string } =
      await request.json();

    const session = await auth();
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const userId = session.user.id;

    const userChats = await getChatsByUserId({ id: userId });
    const threadId = userChats.length > 0 ? userChats[0].threadId : undefined;

    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || typeof latestMessage.content !== 'string') {
      return new Response(JSON.stringify({ error: "No valid message content provided" }), {
        status: 400,
      });
    }

    const { messages: responseMessages, threadId: newThreadId } = await submitMessage({
      threadId,
      userId,
      content: latestMessage.content,
    });

    // **Используем потоковую передачу с правильным SSE-форматом**
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = async (data: any) => {
          const formattedData = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(formattedData));
          await new Promise((resolve) => setTimeout(resolve, 200));
        };

        await send({ status: "start" });

        for (const message of responseMessages) {
          await send({ message });
        }

        await send({ threadId: newThreadId, status: "end" });

        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error) {
    console.error("Server Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
