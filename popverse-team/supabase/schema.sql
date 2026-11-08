-- =====================================================================================
-- Popverse Team : base de données (Supabase / Postgres).
-- À lancer UNE fois dans Supabase > SQL Editor (on peut le relancer sans risque : tout est « if not exists »).
-- Toutes les tables commencent par pt_ pour ne pas gêner d'autres apps dans le même projet.
--
-- Accès : seuls les membres de l'équipe (un profil pt_profiles avec un rôle owner/admin/member) lisent
-- et écrivent. Le PREMIER compte créé devient « owner » ; les suivants doivent donner le code d'équipe
-- (pt_settings.invite_code, visible et modifiable par les admins dans Réglages).
-- =====================================================================================

create extension if not exists pgcrypto;

-- ---------- Profils ----------
create table if not exists public.pt_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  role text not null default 'member' check (role in ('owner','admin','member','disabled')),
  title text default 'Développeur',
  color text default '#F5B935',
  avatar_url text,
  bio text default '',
  created_at timestamptz not null default now(),
  last_seen timestamptz default now()
);

create table if not exists public.pt_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);
insert into public.pt_settings(key, value)
  values ('invite_code', to_jsonb(upper('POP-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 8))))
  on conflict (key) do nothing;

create or replace function public.pt_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from pt_profiles where id = auth.uid() and role in ('owner','admin','member'));
$$;
create or replace function public.pt_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from pt_profiles where id = auth.uid() and role in ('owner','admin'));
$$;

-- Création du profil à l'inscription (le code d'équipe est vérifié ici : un mauvais code bloque l'inscription).
create or replace function public.pt_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  code text;
  uname text;
  palette text[] := array['#F5B935','#E8833A','#E25D6A','#D16BD8','#8B7CF6','#4FA3F7','#3CC9A0','#9CCB4A'];
  n int;
begin
  select count(*) = 0, count(*) into first_user, n from pt_profiles;
  select value #>> '{}' into code from pt_settings where key = 'invite_code';
  if not first_user and upper(coalesce(new.raw_user_meta_data->>'invite_code','')) <> upper(coalesce(code,'')) then
    raise exception 'Code d''équipe invalide';
  end if;
  uname := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1));
  insert into pt_profiles(id, username, display_name, role, title, color)
  values (new.id, lower(regexp_replace(uname, '\s+', '', 'g')), uname,
          case when first_user then 'owner' else 'member' end,
          case when first_user then 'Fondateur' else 'Développeur' end,
          palette[(n % array_length(palette, 1)) + 1]);
  return new;
end $$;
drop trigger if exists pt_on_signup on auth.users;
create trigger pt_on_signup after insert on auth.users for each row execute function public.pt_on_signup();

create or replace function public.pt_invite_code() returns text
language sql stable security definer set search_path = public as $$
  select case when pt_is_admin() then (select value #>> '{}' from pt_settings where key = 'invite_code') end;
$$;
create or replace function public.pt_set_invite_code(code text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not pt_is_admin() then raise exception 'Réservé aux admins'; end if;
  update pt_settings set value = to_jsonb(upper(code)), updated_at = now() where key = 'invite_code';
  return upper(code);
end $$;

-- Un membre ne peut pas changer son propre rôle ; seul un admin le peut (et personne ne touche à l'owner).
create or replace function public.pt_guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() vide = SQL Editor / clé service : toujours autorisé.
  if new.role is distinct from old.role and auth.uid() is not null then
    if not pt_is_admin() then raise exception 'Seul un admin peut changer un rôle'; end if;
    if old.role = 'owner' and not exists(select 1 from pt_profiles where id = auth.uid() and role = 'owner') then
      raise exception 'Le rôle du fondateur ne peut pas être changé';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pt_guard_profile on public.pt_profiles;
create trigger pt_guard_profile before update on public.pt_profiles for each row execute function public.pt_guard_profile();

-- ---------- Projets (un par jeu) ----------
create table if not exists public.pt_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  icon text default '🎮',
  color text default '#F5B935',
  cover_url text,
  status text default 'dev' check (status in ('idea','dev','beta','live','paused')),
  genre text default '',
  roblox_place_id bigint,
  roblox_universe_id bigint,
  roblox_url text,
  ingest_key uuid not null default gen_random_uuid(),
  position double precision default 0,
  archived boolean default false,
  created_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ---------- Tâches façon Trello ----------
create table if not exists public.pt_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pt_projects(id) on delete cascade,
  name text not null,
  color text,
  position double precision default 0,
  is_done boolean default false,
  wip_limit int,
  created_at timestamptz not null default now()
);
create table if not exists public.pt_cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pt_projects(id) on delete cascade,
  list_id uuid not null references pt_lists(id) on delete cascade,
  title text not null,
  description text default '',
  position double precision default 0,
  priority text check (priority in ('urgent','high','medium','low')),
  labels text[] default '{}',
  assignees uuid[] default '{}',
  due_at timestamptz,
  start_at timestamptz,
  estimate numeric,
  checklist jsonb default '[]',
  attachments jsonb default '[]',
  cover text,
  done boolean default false,
  archived boolean default false,
  created_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);
create table if not exists public.pt_labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pt_projects(id) on delete cascade,
  name text not null,
  color text not null default '#F5B935',
  created_at timestamptz not null default now()
);

-- Commentaires (sur une carte ou un post de progrès).
create table if not exists public.pt_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pt_projects(id) on delete cascade,
  target_type text not null check (target_type in ('card','post','lore')),
  target_id uuid not null,
  author uuid references pt_profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Chat façon Discord ----------
create table if not exists public.pt_channels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pt_projects(id) on delete cascade,
  name text not null,
  topic text default '',
  kind text not null default 'text' check (kind in ('text','dm','announce')),
  members uuid[] default '{}',
  position double precision default 0,
  created_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.pt_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references pt_channels(id) on delete cascade,
  author uuid references pt_profiles(id) on delete set null,
  body text default '',
  attachments jsonb default '[]',
  reply_to uuid,
  reactions jsonb default '{}',
  pinned boolean default false,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.pt_reads (
  user_id uuid not null references pt_profiles(id) on delete cascade,
  channel_id uuid not null references pt_channels(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
insert into public.pt_channels(name, topic, kind, position)
  select * from (values ('général', 'Discussion de toute l''équipe', 'text', 0), ('annonces', 'Les infos importantes du studio', 'announce', 1)) v(name, topic, kind, position)
  where not exists (select 1 from public.pt_channels where project_id is null and kind <> 'dm');

-- ---------- Tableaux visuels façon Milanote ----------
create table if not exists public.pt_boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pt_projects(id) on delete cascade,
  name text not null,
  icon text default '🧭',
  position double precision default 0,
  created_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);
create table if not exists public.pt_board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references pt_boards(id) on delete cascade,
  kind text not null,
  x double precision default 0,
  y double precision default 0,
  w double precision default 240,
  h double precision default 0,
  z int default 0,
  data jsonb default '{}',
  updated_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ---------- Lore / wiki du jeu ----------
create table if not exists public.pt_lore (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pt_projects(id) on delete cascade,
  parent_id uuid references pt_lore(id) on delete cascade,
  title text not null,
  category text default 'histoire',
  icon text default '📜',
  content text default '',
  cover text,
  tags text[] default '{}',
  position double precision default 0,
  updated_by uuid references pt_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ---------- Progrès ----------
create table if not exists public.pt_posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pt_projects(id) on delete cascade,
  author uuid references pt_profiles(id) on delete set null,
  kind text default 'progress' check (kind in ('progress','release','milestone','devlog')),
  title text default '',
  body text default '',
  media jsonb default '[]',
  likes uuid[] default '{}',
  pinned boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ---------- Activité ----------
create table if not exists public.pt_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pt_projects(id) on delete cascade,
  actor uuid references pt_profiles(id) on delete set null,
  kind text,
  text text,
  link text,
  created_at timestamptz not null default now()
);

-- ---------- Stats des jeux Roblox ----------
-- Instantanés publics (API Roblox : joueurs, visites, favoris, votes) pris par la fonction pt-roblox.
create table if not exists public.pt_game_stats (
  id bigint generated always as identity primary key,
  project_id uuid not null references pt_projects(id) on delete cascade,
  at timestamptz not null default now(),
  playing int,
  visits bigint,
  favorites bigint,
  likes bigint,
  dislikes bigint,
  max_players int,
  source text default 'roblox'
);
create index if not exists pt_game_stats_project_at on public.pt_game_stats(project_id, at desc);
-- Serveurs en direct, envoyés par le script Luau installé dans le jeu (toutes les ~30 s).
create table if not exists public.pt_game_servers (
  project_id uuid not null references pt_projects(id) on delete cascade,
  job_id text not null,
  place_version int,
  players int default 0,
  max_players int,
  fps numeric,
  ping numeric,
  uptime int,
  data jsonb default '{}',
  updated_at timestamptz not null default now(),
  primary key (project_id, job_id)
);
-- Évènements de jeu (achats, records, erreurs…) envoyés par le script.
create table if not exists public.pt_game_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references pt_projects(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  job_id text,
  user_id bigint,
  value numeric,
  data jsonb default '{}'
);
create index if not exists pt_game_events_project_at on public.pt_game_events(project_id, at desc);

-- ---------- Assistant IA ----------
create table if not exists public.pt_ai_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references pt_projects(id) on delete cascade,
  user_id uuid not null references pt_profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  actions jsonb default '[]',
  created_at timestamptz not null default now()
);

-- ---------- Index utiles ----------
create index if not exists pt_cards_project on public.pt_cards(project_id);
create index if not exists pt_lists_project on public.pt_lists(project_id);
create index if not exists pt_messages_channel on public.pt_messages(channel_id, created_at desc);
create index if not exists pt_items_board on public.pt_board_items(board_id);
create index if not exists pt_lore_project on public.pt_lore(project_id);
create index if not exists pt_posts_project on public.pt_posts(project_id, created_at desc);
create index if not exists pt_comments_target on public.pt_comments(target_id);
create index if not exists pt_activity_created on public.pt_activity(created_at desc);
create index if not exists pt_ai_user on public.pt_ai_messages(user_id, project_id, created_at);

-- ---------- updated_at automatique ----------
create or replace function public.pt_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['pt_projects','pt_cards','pt_boards','pt_board_items','pt_lore','pt_posts'] loop
    execute format('drop trigger if exists pt_touch on public.%I', t);
    execute format('create trigger pt_touch before update on public.%I for each row execute function public.pt_touch()', t);
  end loop;
end $$;

-- ---------- Sécurité (RLS) ----------
do $$ declare t text; begin
  foreach t in array array['pt_profiles','pt_settings','pt_projects','pt_lists','pt_cards','pt_labels','pt_comments','pt_channels',
    'pt_messages','pt_reads','pt_boards','pt_board_items','pt_lore','pt_posts','pt_activity','pt_game_stats','pt_game_servers',
    'pt_game_events','pt_ai_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists pt_read on public.%I', t);
    execute format('drop policy if exists pt_write on public.%I', t);
  end loop;
end $$;

-- Lecture : tous les membres. Écriture : tous les membres (c'est un espace d'équipe), sauf exceptions ci-dessous.
do $$ declare t text; begin
  foreach t in array array['pt_projects','pt_lists','pt_cards','pt_labels','pt_comments','pt_boards','pt_board_items',
    'pt_lore','pt_posts','pt_activity'] loop
    execute format('create policy pt_read on public.%I for select to authenticated using (pt_is_member())', t);
    execute format('create policy pt_write on public.%I for all to authenticated using (pt_is_member()) with check (pt_is_member())', t);
  end loop;
end $$;

-- Profils : tout le monde (connecté) voit l'équipe ; on modifie son propre profil, les admins tous.
create policy pt_read on public.pt_profiles for select to authenticated using (true);
create policy pt_write on public.pt_profiles for update to authenticated using (id = auth.uid() or pt_is_admin()) with check (id = auth.uid() or pt_is_admin());

-- Réglages : lecture membres sauf le code d'équipe (passé par pt_invite_code()), écriture admins.
create policy pt_read on public.pt_settings for select to authenticated using (pt_is_member() and key <> 'invite_code');
create policy pt_write on public.pt_settings for all to authenticated using (pt_is_admin()) with check (pt_is_admin());

-- Salons : les salons privés (dm) ne sont visibles que de leurs membres.
create policy pt_read on public.pt_channels for select to authenticated
  using (pt_is_member() and (kind <> 'dm' or auth.uid() = any(members)));
create policy pt_write on public.pt_channels for all to authenticated
  using (pt_is_member() and (kind <> 'dm' or auth.uid() = any(members)))
  with check (pt_is_member() and (kind <> 'dm' or auth.uid() = any(members)));

create or replace function public.pt_can_see_channel(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pt_is_member() and exists(select 1 from pt_channels c where c.id = cid and (c.kind <> 'dm' or auth.uid() = any(c.members)));
$$;
create policy pt_read on public.pt_messages for select to authenticated using (pt_can_see_channel(channel_id));
create policy pt_write on public.pt_messages for all to authenticated
  using (pt_can_see_channel(channel_id)) with check (pt_can_see_channel(channel_id));

create policy pt_read on public.pt_reads for select to authenticated using (user_id = auth.uid());
create policy pt_write on public.pt_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Stats : lecture membres ; écriture seulement par la fonction pt-roblox (clé service).
create policy pt_read on public.pt_game_stats for select to authenticated using (pt_is_member());
create policy pt_read on public.pt_game_servers for select to authenticated using (pt_is_member());
create policy pt_read on public.pt_game_events for select to authenticated using (pt_is_member());

-- IA : chacun son historique.
create policy pt_read on public.pt_ai_messages for select to authenticated using (user_id = auth.uid());
create policy pt_write on public.pt_ai_messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and pt_is_member());

-- ---------- Temps réel ----------
do $$ declare t text; begin
  foreach t in array array['pt_profiles','pt_projects','pt_lists','pt_cards','pt_labels','pt_comments','pt_channels','pt_messages',
    'pt_boards','pt_board_items','pt_lore','pt_posts','pt_activity','pt_game_stats','pt_game_servers','pt_game_events'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- Les suppressions envoient l'ancienne ligne complète (utile pour filtrer par projet côté app).
alter table public.pt_cards replica identity full;
alter table public.pt_lists replica identity full;
alter table public.pt_board_items replica identity full;
alter table public.pt_messages replica identity full;
alter table public.pt_lore replica identity full;
alter table public.pt_posts replica identity full;
alter table public.pt_comments replica identity full;
alter table public.pt_labels replica identity full;

-- ---------- Fichiers (images, pièces jointes) ----------
insert into storage.buckets (id, name, public, file_size_limit)
  values ('pt-files', 'pt-files', true, 52428800)
  on conflict (id) do nothing;
drop policy if exists pt_files_read on storage.objects;
drop policy if exists pt_files_write on storage.objects;
drop policy if exists pt_files_delete on storage.objects;
create policy pt_files_read on storage.objects for select using (bucket_id = 'pt-files');
create policy pt_files_write on storage.objects for insert to authenticated with check (bucket_id = 'pt-files' and public.pt_is_member());
create policy pt_files_delete on storage.objects for delete to authenticated using (bucket_id = 'pt-files' and public.pt_is_member());

-- Garde la base éveillée (un projet gratuit s'endort après 7 jours sans activité) : appelée par le workflow GitHub.
create or replace function public.pt_ping() returns text language sql security definer set search_path = public as $$ select 'ok'::text $$;
grant execute on function public.pt_ping() to anon, authenticated;
