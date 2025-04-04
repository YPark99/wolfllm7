// hooks/use-chat-visibility.ts v1.1
'use client';

import { useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';

// Если updateChatVisibility не экспортируется из '@/app/(chat)/actions',
// определяем его здесь как заглушку. При необходимости замените на реальную реализацию.
async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  // Пример вызова API для обновления видимости чата.
  return fetch('/api/chat/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, visibility }),
  });
}

// Определяем тип видимости локально.
export type VisibilityType = 'public' | 'private';

// Импортируем схему чата из базы данных. Путь обновлён на "@/db/schema".
import { Chat } from '@/db/schema';

// Расширяем тип Chat, добавляя свойство visibility.
type ExtendedChat = Chat & {
  visibility: VisibilityType;
};

export function useChatVisibility({
  chatId,
  initialVisibility,
}: {
  chatId: string;
  initialVisibility: VisibilityType;
}) {
  const { mutate, cache } = useSWRConfig();
  const history: Array<ExtendedChat> = cache.get('/api/history')?.data;

  const { data: localVisibility, mutate: setLocalVisibility } = useSWR(
    `${chatId}-visibility`,
    null,
    {
      fallbackData: initialVisibility,
    },
  );

  const visibilityType = useMemo(() => {
    if (!history) return localVisibility;
    const chat = history.find((chat) => chat.id === chatId);
    if (!chat) return 'private';
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setVisibilityType = (updatedVisibilityType: VisibilityType) => {
    setLocalVisibility(updatedVisibilityType);

    mutate<ExtendedChat[]>(
      '/api/history',
      (history) => {
        return history
          ? history.map((chat) => {
              if (chat.id === chatId) {
                return {
                  ...chat,
                  visibility: updatedVisibilityType,
                };
              }
              return chat;
            })
          : [];
      },
      { revalidate: false },
    );

    updateChatVisibility({
      chatId,
      visibility: updatedVisibilityType,
    });
  };

  return { visibilityType, setVisibilityType };
}
