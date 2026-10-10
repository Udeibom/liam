-- ============================================================
-- LIAN — Initial Database Schema
-- Run this in your Supabase SQL editor to set up all tables.
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── skin_profiles ───────────────────────────────────────────────────────────
create table if not exists public.skin_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null unique,
  skin_type     text not null default 'unknown',
  goals         text[] not null default '{}',
  sensitivities text[] not null default '{}',
  budget_range  text,
  onboarding_complete boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.skin_profiles enable row level security;
create policy "Users can manage their own skin profile"
  on public.skin_profiles for all
  using (auth.uid() = user_id);

-- ─── skin_scans ──────────────────────────────────────────────────────────────
create table if not exists public.skin_scans (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade not null,
  image_url            text not null,
  youcam_raw           jsonb not null default '{}',
  concerns             jsonb not null default '[]',
  ai_interpretation    text not null default '',
  skin_type_detected   text not null default 'unknown',
  scanned_at           timestamptz not null default now()
);
create index on public.skin_scans (user_id, scanned_at desc);
alter table public.skin_scans enable row level security;
create policy "Users can manage their own scans"
  on public.skin_scans for all
  using (auth.uid() = user_id);

-- ─── products ────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade not null,
  name                 text not null,
  brand                text,
  category             text not null default 'other',
  ingredients          text[] not null default '{}',
  image_url            text,
  status               text not null default 'active',
  started_at           timestamptz,
  stopped_at           timestamptz,
  stop_reason          text,
  reported_reactions   text[] not null default '{}',
  reported_improvements text[] not null default '{}',
  verdict              text not null default 'unknown',
  verdict_reason       text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on public.products (user_id, status);
alter table public.products enable row level security;
create policy "Users can manage their own products"
  on public.products for all
  using (auth.uid() = user_id);

-- ─── routines ────────────────────────────────────────────────────────────────
create table if not exists public.routines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null unique,
  steps         jsonb not null default '[]',
  ai_rationale  text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.routines enable row level security;
create policy "Users can manage their own routine"
  on public.routines for all
  using (auth.uid() = user_id);

-- ─── conversations ────────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  type          text not null default 'general',
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.conversations (user_id, updated_at desc);
alter table public.conversations enable row level security;
create policy "Users can manage their own conversations"
  on public.conversations for all
  using (auth.uid() = user_id);

-- ─── chat_messages ────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.conversations(id) on delete cascade not null,
  user_id          uuid references auth.users(id) on delete cascade not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);
create index on public.chat_messages (conversation_id, created_at asc);
alter table public.chat_messages enable row level security;
create policy "Users can manage their own messages"
  on public.chat_messages for all
  using (auth.uid() = user_id);

-- ─── timeline_events ──────────────────────────────────────────────────────────
create table if not exists public.timeline_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references auth.users(id) on delete cascade not null,
  event_type           text not null,
  title                text not null,
  description          text,
  related_product_id   uuid references public.products(id) on delete set null,
  related_scan_id      uuid references public.skin_scans(id) on delete set null,
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
create index on public.timeline_events (user_id, occurred_at desc);
alter table public.timeline_events enable row level security;
create policy "Users can manage their own timeline"
  on public.timeline_events for all
  using (auth.uid() = user_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_skin_profiles_updated_at
  before update on public.skin_profiles
  for each row execute function public.handle_updated_at();

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.handle_updated_at();

create trigger trg_routines_updated_at
  before update on public.routines
  for each row execute function public.handle_updated_at();

create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

-- ─── Storage bucket for scan images ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('scan-images', 'scan-images', false)
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict do nothing;

create policy "Authenticated users can upload scan images"
  on storage.objects for insert
  with check (bucket_id = 'scan-images' and auth.role() = 'authenticated');

create policy "Users can view their own scan images"
  on storage.objects for select
  using (bucket_id = 'scan-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Authenticated users can upload product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

create policy "Users can view their own product images"
  on storage.objects for select
  using (bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1]);
