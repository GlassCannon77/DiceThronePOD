-- Run this once in Supabase: SQL Editor > New query > paste > Run.

-- 1) The episodes list.
create table if not exists public.episodes (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text not null default '',
  audio_path       text not null,
  audio_url        text not null,
  audio_bytes      bigint not null default 0,
  audio_type       text not null default 'audio/mpeg',
  duration_seconds integer not null default 0,
  episode_number   integer,
  season_number    integer,
  explicit         boolean not null default false,
  published_at     timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists episodes_published_at_idx on public.episodes (published_at desc);

-- Lock the table. With no policies, only the app's secret key (used by the
-- Netlify functions) can read or write it. Nobody can edit it from a browser.
alter table public.episodes enable row level security;

-- 2) A public storage bucket for the audio files.
-- It must be public so Spotify and podcast apps can download episodes.
insert into storage.buckets (id, name, public)
values ('podcast', 'podcast', true)
on conflict (id) do update set public = true;
