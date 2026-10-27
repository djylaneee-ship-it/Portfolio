-- Rovex Hub : espace Co-work (projets partagés : tâches façon Trello, tableau d'idées façon Milanote, membres).
-- À coller dans Supabase → SQL Editor → Run, après rovex.sql et rovex-devices.sql. Peut être relancé sans risque.
-- Un membre = un ID d'accès (rovex.codes.id, montré dans l'app comme « ID Rovex » RVX-XXXXXXXXXXXX) ou la clé admin
-- principale ('master'). Le code d'accès lui-même n'est jamais montré aux autres : on invite avec l'ID Rovex.

create table if not exists rovex.cw_profiles (
  member text primary key,
  name text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists rovex.cw_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#7c3aed',
  owner text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rovex.cw_members (
  project_id uuid not null references rovex.cw_projects(id) on delete cascade,
  member text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (project_id, member)
);
create index if not exists cw_members_member on rovex.cw_members(member);

-- Tout le contenu d'un projet : colonnes et tâches du tableau (kind list / task), dossiers et cartes du tableau
-- d'idées (folder / note / image / todo / link). Une suppression garde une trace (deleted) pour la synchro.
create table if not exists rovex.cw_nodes (
  id uuid primary key,
  project_id uuid not null references rovex.cw_projects(id) on delete cascade,
  parent uuid,
  kind text not null check (kind in ('list', 'task', 'folder', 'note', 'image', 'todo', 'link')),
  data jsonb not null default '{}'::jsonb,
  pos double precision not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
create index if not exists cw_nodes_sync on rovex.cw_nodes(project_id, updated_at);

-- Images des cartes (data URL JPEG/PNG déjà réduites par l'app).
create table if not exists rovex.cw_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references rovex.cw_projects(id) on delete cascade,
  data text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

alter table rovex.cw_profiles enable row level security;
alter table rovex.cw_projects enable row level security;
alter table rovex.cw_members enable row level security;
alter table rovex.cw_nodes enable row level security;
alter table rovex.cw_files enable row level security;

-- Qui appelle : l'id de son ID d'accès valide, 'master' pour la clé admin principale, sinon null.
create or replace function rovex.cw_me(k text) returns text language sql stable security definer set search_path = '' as $$
  select case when rovex.is_master(k) then 'master'
    else (select c.id from rovex.codes c where c.code = rovex.norm(k) and not c.revoked and (c.expires_at is null or c.expires_at > now())) end
$$;

create or replace function rovex.cw_public(m text) returns text language sql immutable set search_path = '' as $$
  select case when m = 'master' then 'RVX-ADMIN' else 'RVX-' || upper(m) end
$$;

create or replace function rovex.cw_name(m text) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif((select p.name from rovex.cw_profiles p where p.member = m), ''),
                  nullif((select c.label from rovex.codes c where c.id = m), ''),
                  case when m = 'master' then 'Admin' else rovex.cw_public(m) end)
$$;

create or replace function rovex.cw_role(p uuid, m text) returns text language sql stable security definer set search_path = '' as $$
  select role from rovex.cw_members where project_id = p and member = m
$$;

create or replace function rovex.cw_node_json(n rovex.cw_nodes) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', n.id, 'parent', n.parent, 'kind', n.kind, 'data', n.data, 'pos', n.pos, 'deleted', n.deleted,
    'createdAt', n.created_at, 'updatedAt', n.updated_at, 'updatedBy', n.updated_by)
$$;

create or replace function rovex.cw_members_json(p uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.member, 'publicId', rovex.cw_public(m.member), 'name', rovex.cw_name(m.member),
    'role', m.role, 'addedAt', m.added_at) order by m.role desc, m.added_at), '[]'::jsonb)
  from rovex.cw_members m where m.project_id = p
$$;

-- ---------- API appelée par l'app ----------

-- Mon profil co-work (et changement de mon nom affiché si p_name est donné).
create or replace function public.rovex_cw_profile(p_code text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code);
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if p_name is not null then
    insert into rovex.cw_profiles (member, name) values (me, left(trim(p_name), 40))
    on conflict (member) do update set name = excluded.name, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'id', me, 'publicId', rovex.cw_public(me), 'name', rovex.cw_name(me));
end $$;

-- Mes projets, et mes tâches non terminées dans tous les projets.
create or replace function public.rovex_cw_projects(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code);
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  return jsonb_build_object('ok', true, 'me', jsonb_build_object('id', me, 'publicId', rovex.cw_public(me), 'name', rovex.cw_name(me)),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'color', p.color, 'role', m.role,
        'owner', rovex.cw_name(p.owner), 'updatedAt', p.updated_at,
        'members', (select count(*) from rovex.cw_members x where x.project_id = p.id),
        'tasks', (select count(*) from rovex.cw_nodes n where n.project_id = p.id and n.kind = 'task' and not n.deleted),
        'myTasks', (select count(*) from rovex.cw_nodes n where n.project_id = p.id and n.kind = 'task' and not n.deleted
                    and n.data->>'assignee' = me and coalesce((n.data->>'done')::boolean, false) = false)) order by p.updated_at desc)
      from rovex.cw_projects p join rovex.cw_members m on m.project_id = p.id and m.member = me), '[]'::jsonb),
    'myTasks', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'project', p.id, 'projectName', p.name, 'color', p.color,
        'title', n.data->>'title', 'due', n.data->>'due', 'list', (select l.data->>'title' from rovex.cw_nodes l where l.id = n.parent))
        order by n.data->>'due' nulls last, n.updated_at desc)
      from rovex.cw_nodes n join rovex.cw_projects p on p.id = n.project_id
      join rovex.cw_members m on m.project_id = p.id and m.member = me
      where n.kind = 'task' and not n.deleted and n.data->>'assignee' = me and coalesce((n.data->>'done')::boolean, false) = false), '[]'::jsonb));
end $$;

-- Nouveau projet : j'en suis le propriétaire ; trois colonnes de départ et un premier dossier d'idées.
create or replace function public.rovex_cw_create(p_code text, p_name text, p_color text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); pid uuid;
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'err', 'cwName'); end if;
  if (select count(*) from rovex.cw_projects where owner = me) >= 50 then return jsonb_build_object('ok', false, 'err', 'cwLimit'); end if;
  insert into rovex.cw_projects (name, color, owner) values (left(trim(p_name), 60), coalesce(nullif(left(p_color, 20), ''), '#7c3aed'), me) returning id into pid;
  insert into rovex.cw_members (project_id, member, role) values (pid, me, 'owner');
  insert into rovex.cw_nodes (id, project_id, kind, data, pos, updated_by) values
    (gen_random_uuid(), pid, 'list', '{"title": "À faire"}', 1, me),
    (gen_random_uuid(), pid, 'list', '{"title": "En cours"}', 2, me),
    (gen_random_uuid(), pid, 'list', '{"title": "Terminé", "done": true}', 3, me);
  return jsonb_build_object('ok', true, 'id', pid);
end $$;

-- Renommer / changer la couleur (propriétaire).
create or replace function public.rovex_cw_update(p_code text, p_project uuid, p_name text default null, p_color text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code);
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is distinct from 'owner' then return jsonb_build_object('ok', false, 'err', 'cwOwnerOnly'); end if;
  update rovex.cw_projects set name = coalesce(nullif(left(trim(p_name), 60), ''), name), color = coalesce(nullif(left(p_color, 20), ''), color),
    updated_at = now() where id = p_project;
  return jsonb_build_object('ok', true);
end $$;

-- Supprimer le projet et tout son contenu (propriétaire).
create or replace function public.rovex_cw_delete(p_code text, p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code);
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is distinct from 'owner' then return jsonb_build_object('ok', false, 'err', 'cwOwnerOnly'); end if;
  delete from rovex.cw_projects where id = p_project;
  return jsonb_build_object('ok', true);
end $$;

-- Inviter quelqu'un avec son ID Rovex (RVX-XXXXXXXXXXXX) : le propriétaire seulement.
create or replace function public.rovex_cw_invite(p_code text, p_project uuid, p_public text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); target text; raw text := lower(regexp_replace(coalesce(p_public, ''), '^\s*rvx-|\s', '', 'gi'));
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is distinct from 'owner' then return jsonb_build_object('ok', false, 'err', 'cwOwnerOnly'); end if;
  if raw = 'admin' then target := 'master';
  else select c.id into target from rovex.codes c where c.id = raw and not c.revoked; end if;
  if target is null then return jsonb_build_object('ok', false, 'err', 'cwNoUser'); end if;
  if (select count(*) from rovex.cw_members where project_id = p_project) >= 50 then return jsonb_build_object('ok', false, 'err', 'cwLimit'); end if;
  insert into rovex.cw_members (project_id, member) values (p_project, target) on conflict do nothing;
  update rovex.cw_projects set updated_at = now() where id = p_project;
  return jsonb_build_object('ok', true, 'members', rovex.cw_members_json(p_project));
end $$;

-- Retirer un membre (propriétaire), ou quitter le projet (soi-même). Le propriétaire ne peut pas se retirer.
create or replace function public.rovex_cw_remove(p_code text, p_project uuid, p_member text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code);
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is null then return jsonb_build_object('ok', false, 'err', 'cwNotMember'); end if;
  if p_member <> me and rovex.cw_role(p_project, me) <> 'owner' then return jsonb_build_object('ok', false, 'err', 'cwOwnerOnly'); end if;
  if rovex.cw_role(p_project, p_member) = 'owner' then return jsonb_build_object('ok', false, 'err', 'cwOwnerStays'); end if;
  delete from rovex.cw_members where project_id = p_project and member = p_member;
  return jsonb_build_object('ok', true, 'members', rovex.cw_members_json(p_project));
end $$;

-- Synchro : le projet, ses membres et tout ce qui a changé depuis p_since (tout si null). « now » = l'heure du
-- serveur, à renvoyer comme p_since au prochain appel.
create or replace function public.rovex_cw_sync(p_code text, p_project uuid, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); pr rovex.cw_projects; t timestamptz := now();
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is null then return jsonb_build_object('ok', false, 'err', 'cwNotMember'); end if;
  select * into pr from rovex.cw_projects where id = p_project;
  return jsonb_build_object('ok', true, 'now', t, 'full', p_since is null,
    'project', jsonb_build_object('id', pr.id, 'name', pr.name, 'color', pr.color, 'role', rovex.cw_role(p_project, me), 'updatedAt', pr.updated_at),
    'me', me, 'members', rovex.cw_members_json(p_project),
    'nodes', coalesce((select jsonb_agg(rovex.cw_node_json(n) order by n.updated_at)
      from rovex.cw_nodes n where n.project_id = p_project
        and (case when p_since is null then not n.deleted else n.updated_at > p_since - interval '2 seconds' end)), '[]'::jsonb));
end $$;

-- Écrit un lot de nœuds (création, modification, suppression). La dernière écriture gagne.
create or replace function public.rovex_cw_put(p_code text, p_project uuid, p_nodes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); n jsonb; nid uuid; cnt int := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is null then return jsonb_build_object('ok', false, 'err', 'cwNotMember'); end if;
  if jsonb_typeof(p_nodes) <> 'array' or jsonb_array_length(p_nodes) > 200 then return jsonb_build_object('ok', false, 'err', 'cwBad'); end if;
  for n in select * from jsonb_array_elements(p_nodes) loop
    if coalesce(n->>'kind', '') not in ('list', 'task', 'folder', 'note', 'image', 'todo', 'link')
       or coalesce(n->>'id', '') !~ '^[0-9a-f-]{36}$' then continue; end if;
    nid := (n->>'id')::uuid;
    if exists (select 1 from rovex.cw_nodes where id = nid and project_id <> p_project) then continue; end if;
    if length(coalesce(n->'data', '{}'::jsonb)::text) > 40000 then continue; end if;
    if not exists (select 1 from rovex.cw_nodes where id = nid)
       and (select count(*) from rovex.cw_nodes where project_id = p_project) >= 20000 then
      return jsonb_build_object('ok', false, 'err', 'cwLimit');
    end if;
    insert into rovex.cw_nodes (id, project_id, parent, kind, data, pos, deleted, updated_by)
    values (nid, p_project, nullif(n->>'parent', '')::uuid, n->>'kind', coalesce(n->'data', '{}'::jsonb),
            coalesce((n->>'pos')::double precision, 0), coalesce((n->>'deleted')::boolean, false), me)
    on conflict (id) do update set parent = excluded.parent, kind = excluded.kind, data = excluded.data, pos = excluded.pos,
      deleted = excluded.deleted, updated_at = now(), updated_by = me;
    cnt := cnt + 1;
  end loop;
  update rovex.cw_projects set updated_at = now() where id = p_project;
  return jsonb_build_object('ok', true, 'saved', cnt);
end $$;

-- Images : envoi (data URL JPEG / PNG, 1,5 Mo max) et lecture.
create or replace function public.rovex_cw_file_put(p_code text, p_project uuid, p_data text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); fid uuid;
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is null then return jsonb_build_object('ok', false, 'err', 'cwNotMember'); end if;
  if p_data !~ '^data:image/(jpeg|png|webp);base64,' or length(p_data) > 1500000 then return jsonb_build_object('ok', false, 'err', 'cwFile'); end if;
  insert into rovex.cw_files (project_id, data, created_by) values (p_project, p_data, me) returning id into fid;
  return jsonb_build_object('ok', true, 'id', fid);
end $$;

create or replace function public.rovex_cw_file_get(p_code text, p_project uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me text := rovex.cw_me(p_code); d text;
begin
  if me is null then return jsonb_build_object('ok', false, 'err', 'unknownId'); end if;
  if rovex.cw_role(p_project, me) is null then return jsonb_build_object('ok', false, 'err', 'cwNotMember'); end if;
  select data into d from rovex.cw_files where id = p_id and project_id = p_project;
  if d is null then return jsonb_build_object('ok', false, 'err', 'cwNoFile'); end if;
  return jsonb_build_object('ok', true, 'data', d);
end $$;

select 'Rovex Hub : Co-work ✅' as resultat;
