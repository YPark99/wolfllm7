//lib/tokenCounter.ts
//import { encodingForModel } from 'js-tiktoken';

//const model = DEFAULT_MODEL_NAME; // Укажите модель для корректного подсчета токенов

//export const countTokens = (text: string): number => {
  //const encoder = encodingForModel(model);
  //const tokens = encoder.encode(text);
  //const tokenCount = tokens.length;
  //return tokenCount;
//};

//export const countTokensInMessage = (message: string): number => {
  //return countTokens(message);
//};

//export const countTokensInResponse = (response: string): number => {
  //return countTokens(response);
//};

import { encodingForModel } from 'js-tiktoken';
import { Model } from '@/ai/models';

/**
 * Подсчитывает количество токенов для строки на основе выбранной модели.
 * @param text - текст, для которого нужно подсчитать токены
 * @param model - модель, которая определяет кодировку токенов
 * @returns количество токенов в тексте
 */
export const countTokens = (text: string, model: Model): number => {
  // Получаем кодировщик для указанной модели
  const encoder = encodingForModel(model.apiIdentifier);
  const tokens = encoder.encode(text);
  const tokenCount = tokens.length;
  return tokenCount;
};

/**
 * Подсчитывает токены для сообщений пользователя с учетом выбранной модели.
 * @param message - сообщение пользователя
 * @param model - модель, которая определяет кодировку токенов
 * @returns количество токенов в сообщении
 */
export const countTokensInMessage = (message: string, model: Model): number => {
  return countTokens(message, model);
};

/**
 * Подсчитывает токены для ответа модели с учетом выбранной модели.
 * @param response - ответ от AI
 * @param model - модель, которая определяет кодировку токенов
 * @returns количество токенов в ответе
 */
export const countTokensInResponse = (response: string, model: Model): number => {
  return countTokens(response, model);
};
