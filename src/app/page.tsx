import {createClient} from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">It works.</h1>
      <p className="opacity-70">
        {user ? `Signed in as ${user.email}` : 'Not signed in.'}
      </p>
    </main>
  );
}
