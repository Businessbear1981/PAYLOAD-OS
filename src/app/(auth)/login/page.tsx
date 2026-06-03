'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/client';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [serverError, setServerError] = useState<string | null>(null);

  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {email: '', password: ''},
  });

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    const {error} =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword(values)
        : await supabase.auth.signUp(values);

    if (error) {
      setServerError(error.message);
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{mode === 'signIn' ? 'Sign in' : 'Create account'}</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
        <div>
          <input
            {...register('email')}
            type="email"
            placeholder="Email"
            className="w-full rounded-md border px-3 py-2"
          />
          {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
        </div>

        <div>
          <input
            {...register('password')}
            type="password"
            placeholder="Password"
            className="w-full rounded-md border px-3 py-2"
          />
          {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-xs text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? '…' : mode === 'signIn' ? 'Sign in' : 'Sign up'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        className="text-sm opacity-70 underline-offset-2 hover:underline"
      >
        {mode === 'signIn' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </div>
  );
}
