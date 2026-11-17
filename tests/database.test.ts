import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {newSession,applyCommand} from '@/lib/game/engine';
import {starterGame} from '@/lib/game/starter';
import type {GameState,Context} from '@/lib/game/types';

const pg=new PGlite();
const host=crypto.randomUUID(),players=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
const game=crypto.randomUUID(),controller=crypto.randomUUID();
let now=Date.now();
function act(state:GameState,cmd:Parameters<typeof applyCommand>[1],userId=host):GameState{
  const ctx:Context={userId,actionId:crypto.randomUUID(),expectedVersion:state.actionVersion,
    controller:userId===host?controller:undefined,now:++now,random:()=>0};
  return applyCommand(state,cmd,ctx);
}
async function commit(before:GameState,after:GameState){
 const r=await pg.query<{ok:boolean}>('select public.commit_session($1,$2,$3::jsonb) ok',
   [before.id,before.version,JSON.stringify(after)]);
 expect(r.rows[0].ok).toBe(true);
}
beforeAll(async()=>{
 await pg.exec([
  'create role anon;','create role authenticated;','create role service_role;',
  'create schema auth;','create table auth.users(id uuid primary key);',
  "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  'grant usage on schema auth to authenticated;',
  'grant execute on function auth.uid() to authenticated;',
  'create schema realtime;',
  'create table realtime.messages(id bigserial,extension text,topic text,payload jsonb);',
  'alter table realtime.messages enable row level security;',
  'grant usage on schema realtime to authenticated;',
  'grant select on realtime.messages to authenticated;',
  "create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;",
  "create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$ insert into realtime.messages(extension,topic,payload) values('broadcast',topic,payload) $$;"
 ].join('\n'));
 await pg.exec(readFileSync('supabase/migrations/001_initial.sql','utf8'));
 await pg.exec(readFileSync('supabase/migrations/002_recovery_display.sql','utf8'));
 for(const id of [host,...players])await pg.query('insert into auth.users(id) values($1)',[id]);
 await pg.query('insert into public.games(id,owner_id,board,pin_hash) values($1,$2,$3::jsonb,$4)',
   [game,host,JSON.stringify(starterGame()),'fake-pin']);
},30000);
afterAll(async()=>pg.close());

describe('PostgreSQL game runtime',()=>{
 it('installs both migrations and launches idempotent private rooms',async()=>{
   const s=newSession(starterGame(),game,host,'048291',now,controller);
   for(let i=0;i<2;i++){
     const result=await pg.query<{id:string}>(
      'select public.launch_session($1::jsonb,$2,$3) id',[JSON.stringify(s),'fake-pin',false]);
     expect(result.rows[0].id).toBe(s.id);
   }
   const read=await pg.query<{data:{state:GameState}}>('select public.read_session_runtime($1) data',[s.id]);
   expect(read.rows[0].data.state.joinCode).toBe('048291');
 });
 it('prevents two claimants from winning the same buzzer window',async()=>{
   let s=newSession(starterGame(),game,host,'027481',now,controller);
   await pg.query('select public.launch_session($1::jsonb,$2,$3)',[JSON.stringify(s),'fake-pin',true]);
   for(let i=0;i<3;i++){
     const next=act(s,{type:'join',name:'Player'+i},players[i]);await commit(s,next);s=next;
   }
   let next=act(s,{type:'start'});await commit(s,next);s=next;
   const a=act(s,{type:'buzz',windowId:s.windowId!},players[0]);
   const b=act(s,{type:'buzz',windowId:s.windowId!},players[1]);
   const winner=await pg.query<{ok:boolean}>('select public.claim_session_buzz($1,$2,$3,$4,$5::jsonb) ok',
      [s.id,s.version,s.windowId,players[0],JSON.stringify(a)]);
   const loser=await pg.query<{ok:boolean}>('select public.claim_session_buzz($1,$2,$3,$4,$5::jsonb) ok',
      [s.id,s.version,s.windowId,players[1],JSON.stringify(b)]);
   expect(winner.rows[0].ok).toBe(true);
   expect(loser.rows[0].ok).toBe(false);
   const state=await pg.query<{state:GameState}>('select state from public.sessions where id=$1',[s.id]);
   expect(state.rows[0].state.respondent).toBe(players[0]);
   const members=await pg.query<{c:number}>('select count(*)::integer c from public.session_members where session_id=$1',[s.id]);
   expect(members.rows[0].c).toBe(4);
   const notices=await pg.query<{payload:{version:number}}>('select payload from realtime.messages where topic=$1',['session:'+s.id]);
   expect(notices.rows.some(r=>r.payload.version>0)).toBe(true);
   expect(JSON.stringify(notices.rows)).not.toContain('LET THE GOOD TIMES ROLL');
 });
 it('does not permit direct browser access to private game content',async()=>{
   await pg.exec('set role authenticated;');
   try{
     await expect(pg.query('select state from public.sessions')).rejects.toThrow();
     await expect(pg.query('select board from public.games')).rejects.toThrow();
   }finally{await pg.exec('reset role;');}
 });
});
