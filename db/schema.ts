import { Message } from 'ai';
import { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  integer,
  serial,
} from 'drizzle-orm/pg-core';

// Схема таблицы User
export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull().unique(), // Добавлен уникальный индекс
  password: varchar('password', { length: 64 }),
});

export type User = InferSelectModel<typeof user>;

// Схема таблицы Chat
export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  messages: json('messages').notNull(),
  userId: uuid('userId').notNull().references(() => user.id),
  threadId: text('threadId').notNull(), // Изменено с uuid на text
});

export type Chat = Omit<InferSelectModel<typeof chat>, 'messages'> & {
  messages: Array<Message>;
};

// Схема таблицы Document
export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  }
);

export type Document = InferSelectModel<typeof document>;

// Схема таблицы Suggestion
export const Suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

export type Suggestion = InferSelectModel<typeof Suggestion>;

// Схема таблицы Token Records
export const tokenRecords = pgTable('token_records', {
  id: serial('id').primaryKey(), // Автоинкрементный ID
  userId: uuid('userId')
    .notNull()
    .references(() => user.id), // Связь с пользователем
  tokensBalance: integer('tokens_balance').notNull().default(0), // Баланс токенов
  tokensUsed: integer('tokens_used'), // Токены, использованные в текущем запросе
  description: text('description'), // Описание действия
  createdAt: timestamp('createdAdd').defaultNow(), // Временная метка создания
});

export type TokenRecord = InferSelectModel<typeof tokenRecords>;
