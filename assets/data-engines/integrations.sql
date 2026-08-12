-- Payload — integrations data engine
--
-- Defines the three tables the existing code already reads and writes:
--   profiles           — role gate for every requireAdmin() check
--   integrations       — the credential vault, one row per vendor
--   integration_audits — append-only record of every connection test
--
-- Every column here is traceable to a line of application code; nothing is
-- speculative. Sources are noted per column.
--
-- Apply with:  supabase db push assets/data-engines/integrations.sql
--
-- NOTE ON CREDENTIAL STORAGE
-- lib/crypto.ts returns {ciphertext: Buffer, iv: Buffer} and the PUT route
-- hands those Buffers to supabase-js. A Buffer does not serialise to bytea
-- over PostgREST — JSON.stringify turns it into {"type":"Buffer","data":[…]},
-- which would store corrupt and never decrypt. These columns are therefore
-- text holding base64, and the route/config must .toString('base64') on write
-- and Buffer.from(v, 'base64') on read. See the companion code change.

begin;

-- ── profiles ─────────────────────────────────────────────────────────
-- Read by requireAdmin() in api/integrations/[vendor]/route.ts,
-- api/integrations/[vendor]/test/route.ts, and settings/integrations/page.tsx,
-- each selecting `role` by `id` and accepting only 'admin' | 'owner'.

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  role       text not null default 'member'
               check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. `role` is the only authorisation input Payload reads.';

-- Keep a profile in step with auth.users so a new sign-up is never roleless.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── integrations ─────────────────────────────────────────────────────
-- vendor / display_name / enabled / fields_schema  → settings/integrations/page.tsx select
-- ciphertext / iv                                   → [vendor]/route.ts PUT, config.ts getConfig
-- last_test_*                                       → [vendor]/test/route.ts update

create table if not exists public.integrations (
  vendor                text primary key,
  display_name          text not null,
  enabled               boolean not null default false,

  -- base64 of AES-256-GCM output. ciphertext is ct||tag (crypto.ts appends
  -- the 16-byte auth tag rather than using a third column); iv is 12 bytes.
  ciphertext            text,
  iv                    text,

  -- [{key, label, secret}] — drives the credential form in integration-card.tsx
  fields_schema         jsonb not null default '[]'::jsonb,

  last_tested_at        timestamptz,
  last_test_status      text check (last_test_status in ('ok', 'fail', 'no_quota', 'disabled')),
  last_test_message     text,
  last_test_latency_ms  integer,

  updated_at            timestamptz not null default now()
);

comment on column public.integrations.ciphertext is
  'base64(AES-256-GCM ciphertext || 16-byte auth tag). Never exposed to non-admins.';

-- ── integration_audits ───────────────────────────────────────────────
-- Insert shape is fixed by [vendor]/test/route.ts:
--   {vendor, check_name, status, latency_ms, message, details}
-- status is narrowed there to 'ok' | 'warn' | 'fail'.

create table if not exists public.integration_audits (
  id          bigint generated always as identity primary key,
  vendor      text not null,
  check_name  text not null,
  status      text not null check (status in ('ok', 'warn', 'fail')),
  latency_ms  integer,
  message     text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Audit rows are append-only: no update or delete path is granted below.
create index if not exists integration_audits_vendor_created_idx
  on public.integration_audits (vendor, created_at desc);

-- ── row level security ───────────────────────────────────────────────
-- The service-role client (admin() in route.ts / config.ts) bypasses RLS.
-- These policies govern the *user* client used by the page components.

alter table public.profiles           enable row level security;
alter table public.integrations       enable row level security;
alter table public.integration_audits enable row level security;

-- A user may read only their own profile. Role changes are service-role only,
-- so a member cannot promote themselves to admin.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin')
  );
$$;

drop policy if exists integrations_select_admin on public.integrations;
create policy integrations_select_admin
  on public.integrations for select
  to authenticated
  using (public.is_admin());

drop policy if exists integration_audits_select_admin on public.integration_audits;
create policy integration_audits_select_admin
  on public.integration_audits for select
  to authenticated
  using (public.is_admin());

-- Column-level defence in depth. RLS is row-level, so even an admin reading
-- through the user client must not be able to pull the encrypted blob — the
-- only legitimate reader of ciphertext/iv is config.ts via service_role.
revoke all on public.integrations from authenticated;
grant select (
  vendor, display_name, enabled, fields_schema,
  last_tested_at, last_test_status, last_test_message, last_test_latency_ms,
  updated_at
) on public.integrations to authenticated;

revoke all on public.integration_audits from authenticated;
grant select on public.integration_audits to authenticated;

-- ── vendor seed ──────────────────────────────────────────────────────
-- The twelve vendors are exactly those handled by config.ts fromEnv(). Field
-- keys mirror that map so a vault save and an env fallback stay interchangeable.
-- `secret: true` marks values integration-card.tsx must mask.

insert into public.integrations (vendor, display_name, fields_schema) values
  ('supabase', 'Supabase', '[
     {"key":"url","label":"Project URL","secret":false},
     {"key":"anon_key","label":"Anon key","secret":false},
     {"key":"service_role_key","label":"Service role key","secret":true}
   ]'::jsonb),
  ('cloudflare_r2', 'Cloudflare R2', '[
     {"key":"account_id","label":"Account ID","secret":false},
     {"key":"token","label":"Access key ID","secret":true},
     {"key":"secret","label":"Secret access key","secret":true},
     {"key":"bucket","label":"Bucket","secret":false},
     {"key":"public_url","label":"Public URL","secret":false}
   ]'::jsonb),
  ('ai_gateway', 'AI Gateway', '[
     {"key":"api_key","label":"API key","secret":true},
     {"key":"default_model","label":"Default model","secret":false}
   ]'::jsonb),
  ('stripe', 'Stripe', '[
     {"key":"publishable_key","label":"Publishable key","secret":false},
     {"key":"secret_key","label":"Secret key","secret":true},
     {"key":"webhook_secret","label":"Webhook secret","secret":true}
   ]'::jsonb),
  ('elevenlabs', 'ElevenLabs', '[
     {"key":"api_key","label":"API key","secret":true},
     {"key":"default_voice_id","label":"Default voice ID","secret":false}
   ]'::jsonb),
  ('higgsfield', 'Higgsfield', '[
     {"key":"api_key_id","label":"API key ID","secret":true},
     {"key":"api_secret","label":"API secret","secret":true},
     {"key":"api_base","label":"API base URL","secret":false}
   ]'::jsonb),
  ('meshy', 'Meshy', '[
     {"key":"api_key","label":"API key","secret":true}
   ]'::jsonb),
  ('suno', 'Suno', '[
     {"key":"api_key","label":"API key","secret":true},
     {"key":"api_base","label":"API base URL","secret":false}
   ]'::jsonb),
  ('langsmith', 'LangSmith', '[
     {"key":"api_key","label":"API key","secret":true},
     {"key":"project","label":"Project","secret":false}
   ]'::jsonb),
  ('porkbun', 'Porkbun', '[
     {"key":"api_key","label":"API key","secret":true},
     {"key":"secret_key","label":"Secret key","secret":true}
   ]'::jsonb),
  ('railway', 'Railway', '[
     {"key":"project_id","label":"Project ID","secret":false},
     {"key":"token","label":"Token","secret":true}
   ]'::jsonb),
  ('vercel', 'Vercel', '[
     {"key":"token","label":"Token","secret":true},
     {"key":"team_id","label":"Team ID","secret":false}
   ]'::jsonb)
on conflict (vendor) do update
  set display_name  = excluded.display_name,
      fields_schema = excluded.fields_schema;

commit;
