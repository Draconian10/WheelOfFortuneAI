-- Fortune Live: apply this migration once to a dedicated Supabase project.
-- Private authoritative room state; browsers never directly query puzzle solutions.
begin;
create table public.games (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 board jsonb not null,
 pin_hash text not null,
 version integer not null default 0,
 archived boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.sessions (
 id uuid primary key,
 game_id uuid not null references public.games(id),
 host_id uuid not null references auth.users(id),
 join_code text not null check(join_code ~ '^\d{6}$'),
 state jsonb not null,
 version integer not null default 0,
 active boolean not null default true,
 pin_hash text not null,
 created_at timestamptz not null default now()
);
create unique index active_join_codes on public.sessions(join_code) where active;
create index sessions_by_host on public.sessions(host_id,created_at desc);
create index games_by_owner on public.games(owner_id);
create table public.session_members (
 session_id uuid not null references public.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 primary key(session_id,user_id)
);
create table public.session_presence (
 session_id uuid not null references public.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 controller uuid,
 last_seen_ms bigint not null,
 primary key(session_id,user_id)
);
create table public.rate_limits (
 key text primary key,
 window_start timestamptz not null,
 attempts integer not null
);
grant all on public.games,public.sessions,public.session_members,public.session_presence,public.rate_limits to service_role;
alter table public.games enable row level security;
alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.session_presence enable row level security;
alter table public.rate_limits enable row level security;
revoke all on public.games,public.sessions,public.session_members,public.session_presence,public.rate_limits from anon,authenticated;
grant select on public.session_members to authenticated;
create policy own_memberships on public.session_members for select to authenticated
 using(user_id=(select auth.uid()));
-- Browsers receive version notifications only. The API serves sanitized projections.
create policy private_room_broadcasts on realtime.messages for select to authenticated
 using(extension='broadcast' and topic=realtime.topic() and exists (
   select 1 from public.session_members m
   where m.user_id=(select auth.uid()) and ('session:'||m.session_id::text)=realtime.topic()
 ));
create function public.consume_rate_limit(p_key text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare hits integer;
begin
 insert into public.rate_limits as r(key,window_start,attempts) values(p_key,now(),1)
 on conflict(key) do update set
 attempts=case when r.window_start<now()-make_interval(secs=>p_seconds) then 1 else r.attempts+1 end,
 window_start=case when r.window_start<now()-make_interval(secs=>p_seconds) then now() else r.window_start end
 returning attempts into hits;
 return hits<=p_limit;
end;
$$;
create function public.launch_session(p_state jsonb,p_pin_hash text,p_separate boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid:=(p_state->>'id')::uuid;
 gid uuid:=(p_state->>'gameId')::uuid;
 hid uuid:=(p_state->>'hostId')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(gid::text,0));
 if not exists(select 1 from public.games where id=gid and owner_id=hid and not archived) then
  raise exception 'Game is unavailable or archived.';
 end if;
 if exists(select 1 from public.sessions where id=sid and game_id=gid and host_id=hid) then
  return sid;
 end if;
 if not p_separate and exists(select 1 from public.sessions where game_id=gid and active) then
  raise exception 'Resume the ongoing session or explicitly launch another.';
 end if;
 insert into public.sessions(id,game_id,host_id,join_code,state,pin_hash)
 values(sid,gid,hid,p_state->>'joinCode',p_state,p_pin_hash);
 insert into public.session_members values(sid,hid);
 insert into public.session_presence(session_id,user_id,controller,last_seen_ms)
 values(sid,hid,(p_state->>'controller')::uuid,(p_state->>'hostSeen')::bigint);
 return sid;
end;
$$;
create function public.read_session_runtime(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sessions%rowtype;
 players jsonb;
 seen bigint;
begin
 select * into s from public.sessions where id=p_id;
 if not found then return null;end if;
 select coalesce(jsonb_agg(p || jsonb_build_object(
  'lastSeen',greatest(coalesce((p->>'lastSeen')::bigint,0),coalesce(pr.last_seen_ms,0))
 ) order by n),'[]'::jsonb) into players
 from jsonb_array_elements(s.state->'players') with ordinality as e(p,n)
 left join public.session_presence pr on pr.session_id=p_id and pr.user_id=(p->>'id')::uuid;
 select coalesce(max(last_seen_ms),(s.state->>'hostSeen')::bigint) into seen
 from public.session_presence
 where session_id=p_id and user_id=s.host_id
 and controller is not distinct from (s.state->>'controller')::uuid;
 return jsonb_build_object('id',s.id,'pin_hash',s.pin_hash,'version',s.version,
   'runtimeAt',floor(extract(epoch from clock_timestamp())*1000)::bigint,
   'state',jsonb_set(jsonb_set(s.state,'{players}',players),'{hostSeen}',to_jsonb(seen)));
end;
$$;
create function public.touch_session_presence(p_id uuid,p_user uuid,p_controller uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; t bigint; old_seen bigint;
begin
 select state into s from public.sessions where id=p_id;
 if s is null then return jsonb_build_object('error','Game not found.','status',404);end if;
 if s->>'hostId'=p_user::text then
  if p_controller is distinct from (s->>'controller')::uuid then
   return jsonb_build_object('error','Another host tab controls this game.','status',409);
  end if;
 elsif not exists(select 1 from jsonb_array_elements(s->'players') p
   where p->>'id'=p_user::text and not (p->>'removed')::boolean) then
  return jsonb_build_object('error','Access denied.','status',403);
 end if;
 insert into public.session_presence(session_id,user_id,controller,last_seen_ms)
 values(p_id,p_user,p_controller,0) on conflict do nothing;
 select last_seen_ms into old_seen from public.session_presence
  where session_id=p_id and user_id=p_user for update;
 t:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if s->>'hostId'=p_user::text and not coalesce((s->>'paused')::boolean,false)
 and s->>'phase' not in ('finished','ended')
 and t>=greatest(old_seen,(s->>'hostSeen')::bigint)+30000 then
  return jsonb_build_object('kind','heartbeat','host',true,'serverNow',t,'reconcile',true);
 end if;
 if s->>'phase' not in ('finished','ended') then
  update public.session_presence set last_seen_ms=greatest(last_seen_ms,t),
   controller=case when s->>'hostId'=p_user::text then p_controller else null end
  where session_id=p_id and user_id=p_user;
 end if;
 return jsonb_build_object('kind','heartbeat','host',s->>'hostId'=p_user::text,'serverNow',t);
end;
$$;
create function public.commit_session(p_id uuid,p_expected integer,p_state jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare prior jsonb; old_members jsonb; new_members jsonb; changed integer;
begin
 select state into prior from public.sessions where id=p_id and version=p_expected for update;
 if not found then return false;end if;
 if (p_state->>'version')::integer<>p_expected+1 then return false;end if;
 update public.sessions set state=p_state,version=p_expected+1,
  active=(p_state->>'phase') not in ('finished','ended')
 where id=p_id and version=p_expected;
 get diagnostics changed=row_count;
 if changed=0 then return false;end if;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into old_members from (
  select prior->>'hostId' id
  union select p->>'id' from jsonb_array_elements(prior->'players') p where not (p->>'removed')::boolean
 ) x;
 select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into new_members from (
  select p_state->>'hostId' id
  union select p->>'id' from jsonb_array_elements(p_state->'players') p where not (p->>'removed')::boolean
 ) x;
 if old_members is distinct from new_members then
  delete from public.session_members where session_id=p_id;
  insert into public.session_members(session_id,user_id)
   select p_id,value::uuid from jsonb_array_elements_text(new_members);
 end if;
 if p_state->>'controller' is distinct from prior->>'controller' then
  update public.session_presence set controller=(p_state->>'controller')::uuid,
   last_seen_ms=greatest(last_seen_ms,(p_state->>'hostSeen')::bigint)
  where session_id=p_id and user_id=(p_state->>'hostId')::uuid;
 end if;
 begin
  perform realtime.send(jsonb_build_object('version',p_expected+1),'changed','session:'||p_id::text,true);
 exception when others then raise warning 'Realtime notification failed: %',sqlstate;
 end;
 return true;
end;
$$;
-- A conditional claim protects the first buzzer acceptance across concurrent Vercel functions.
create function public.claim_session_buzz(p_id uuid,p_expected integer,p_window uuid,p_user uuid,p_state jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_state->>'respondent' is distinct from p_user::text then return false;end if;
 if not exists(
  select 1 from public.sessions s where s.id=p_id and s.version=p_expected
  and s.state->>'phase' in ('tossup','tieTossup')
  and s.state->>'windowId'=p_window::text
  and s.state->>'respondent' is null and not (s.state->>'paused')::boolean
  and (s.state->'attempted' is null or not (s.state->'attempted' ? p_user::text))
  and (s.state->>'phase'<>'tieTossup' or s.state->'tieEligible' ? p_user::text)
  and exists(select 1 from jsonb_array_elements(s.state->'players') p
    where p->>'id'=p_user::text and not (p->>'removed')::boolean)
 ) then return false;end if;
 return public.commit_session(p_id,p_expected,p_state);
end;
$$;
revoke all on function public.consume_rate_limit(text,integer,integer),
 public.launch_session(jsonb,text,boolean),public.read_session_runtime(uuid),
 public.touch_session_presence(uuid,uuid,uuid),public.commit_session(uuid,integer,jsonb),
 public.claim_session_buzz(uuid,integer,uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer),
 public.launch_session(jsonb,text,boolean),public.read_session_runtime(uuid),
 public.touch_session_presence(uuid,uuid,uuid),public.commit_session(uuid,integer,jsonb),
 public.claim_session_buzz(uuid,integer,uuid,uuid,jsonb)
 to service_role;
notify pgrst,'reload schema';
commit;
