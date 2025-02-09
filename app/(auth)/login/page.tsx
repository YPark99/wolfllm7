'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AuthForm } from '@/components/custom/auth-form';
import { SubmitButton } from '@/components/custom/submit-button';

import { login, LoginActionState } from '../actions';

export default function Page() {
  const router = useRouter(); // Хук для навигации и обновления данных страницы

  const [email, setEmail] = useState(''); // Состояние для хранения введенного email

  // Хук useActionState для управления состоянием асинхронного действия (логина)
  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    {
      status: 'idle', // Начальное состояние: ничего не происходит
    }
  );

  useEffect(() => {
    // Отслеживаем изменение статуса формы
    if (state.status === 'failed') {
      // Если вход не удался
      toast.error('Invalid credentials!'); // Показываем ошибку "Неверные учетные данные"
    } else if (state.status === 'invalid_data') {
      // Если данные формы некорректны
      toast.error('Failed validating your submission!'); // Показываем ошибку "Проверка данных не удалась"
    } else if (state.status === 'success') {
      // Если вход успешен
      router.refresh(); // Обновляем текущую страницу
    }
  }, [state.status, router]); // Зависимости для перезапуска useEffect

  // Обработчик отправки формы
  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get('email') as string); // Сохраняем email в состоянии
    formAction(formData); // Выполняем действие логина
  };

  return (
    <div className="flex h-dvh w-screen items-start pt-12 md:pt-0 md:items-center justify-center bg-background">
      <div className="w-full max-w-md overflow-hidden rounded-2xl flex flex-col gap-12">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          {/* Заголовок и описание для формы входа */}
          <h3 className="text-xl font-semibold dark:text-zinc-50">Sign In</h3>
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            Use your email and password to sign in
          </p>
        </div>
        {/* Компонент формы авторизации */}
        <AuthForm action={handleSubmit} defaultEmail={email}>
          {/* Кнопка отправки формы */}
          <SubmitButton>Sign in</SubmitButton>
          {/* Ссылки на регистрацию */}
          <p className="text-center text-sm text-gray-600 mt-4 dark:text-zinc-400">
            {"Don't have an account? "}
            <Link
              href="/register"
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
            >
              Sign up
            </Link>
            {' for free.'}
          </p>
        </AuthForm>
      </div>
    </div>
  );
}
