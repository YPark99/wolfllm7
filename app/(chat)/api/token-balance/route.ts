import { auth } from '@/app/(auth)/auth'; // Импорт функции для проверки авторизации пользователя
import { db } from '@/db/queries'; // Импорт соединения с базой данных
import { tokenRecords } from '@/db/schema'; // Импорт схемы таблицы `tokenRecords`
import { eq, desc } from 'drizzle-orm'; // Импорт операторов для работы с запросами в Drizzle ORM

export async function GET(request: Request) {
  // Проверяем авторизацию пользователя
  const session = await auth();

  // Если пользователь не авторизован или ID пользователя отсутствует, возвращаем 401 Unauthorized
  if (!session || !session.user || !session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = session.user.id; // Извлекаем идентификатор пользователя из сессии

  // Объявляем переменную под идентификатор интервала,
  // чтобы потом очистить его при закрытии потока
  let intervalId: ReturnType<typeof setInterval>;

  // Создаем поток для отправки данных клиенту (SSE)
  const readableStream = new ReadableStream({
    /**
     * Функция `start` вызывается при инициализации потока.
     * Здесь мы устанавливаем периодическую задачу отправки данных.
     */
    start(controller) {
      // Функция для получения и отправки текущего баланса токенов пользователя
      const sendBalanceUpdate = async () => {
        const userBalanceQuery = await db
          .select({ tokensBalance: tokenRecords.tokensBalance }) // Извлекаем поле `tokensBalance`
          .from(tokenRecords)                                   // Указываем таблицу `tokenRecords`
          .where(eq(tokenRecords.userId, userId))               // Фильтруем по ID пользователя
          .orderBy(desc(tokenRecords.createdAt))                // Сортируем записи по убыванию даты создания
          .limit(1);                                            // Получаем только последнюю запись

        const balance = userBalanceQuery[0]?.tokensBalance ?? 5000; // Извлекаем баланс или устанавливаем 0, если записи нет

        // Отправляем данные в виде строки события SSE
        controller.enqueue(`data: ${JSON.stringify({ balance })}\n\n`);
      };

      // Отправляем баланс сразу после подключения клиента
      void sendBalanceUpdate();

      // Настраиваем периодическое обновление баланса каждые 5 секунд
      intervalId = setInterval(sendBalanceUpdate, 10000);
    },

    /**
     * Функция `cancel` вызывается, когда поток отменяется (например,
     * если клиент закрыл соединение и дальше данные не нужны).
     * Здесь важно «почистить» все ресурсы, в том числе остановить setInterval.
     */
    cancel(reason) {
      clearInterval(intervalId);
      // console.log('Stream cancelled:', reason);
    },
  });

  // Возвращаем поток клиенту с заголовками для SSE
  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream', // Указываем, что это поток событий SSE
      'Cache-Control': 'no-cache',         // Отключаем кэширование
      Connection: 'keep-alive',            // Соединение остаётся открытым
    },
  });
}
