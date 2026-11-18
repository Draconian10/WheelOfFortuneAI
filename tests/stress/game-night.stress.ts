/**
 * CI capacity regression. Actual game engine and PGlite SQL migrations, with
 * emulated identities and transport. No connection to live Supabase or Vercel.
 * This is a repeatable concurrency correctness test, NOT a cloud load benchmark.
 */
import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {newSession,applyCommand,reconcile,viewSession,total,MAX_PLAYERS} from '@/lib/game/engine';
import {starterGame} from '@/lib/game/starter';
import type {Command} from '@/lib/game/schema';
import type {GameState,Context} from '@/lib/game/types';

const pg=new PGlite();
const output=process.env.STRESS_OUTPUT_DIR??'test-results/stress';
const reports:{scenario:string;checks:number;elapsedMs:number;metrics:Record<string,unknown>}[]=[];
const host=crypto.randomUUID(),controller=crypto.randomUUID();
const players=Array.from({length:6},()=>crypto.randomUUID());
const nowSeed=Date.now();
let now=nowSeed;
let attempts=0,commits=0,conflicts=0;
function log(scenario:string,started:number,checks:number,metrics:Record<string,unknown>){
  reports.push({scenario,checks,elapsedMs:Math.round(performance.now()-started),metrics});
  mkdirSync(output,{recursive:true});
  writeFileSync(output+'/progress.json',JSON.stringify(reports,null,2));
}
function context(s:GameState,user=host,index=0,actionId=crypto.randomUUID()):Context{
  if(s.spinEndsAt!==undefined&&['spinning','finalSpinning','bonusSpinning'].includes(s.phase))now=Math.max(now+1,s.spinEndsAt+1);
  else now=Math.max(now+1,s.updatedAt+1);
  return {userId:user,controller:user===host?controller:undefined,now,
    expectedVersion:s.actionVersion,actionId,random:(n:number)=>index%n,pinVerified:true};
}
function action(s:GameState,cmd:Command,user=host,index=0){
  return applyCommand(s,cmd,context(s,user,index));
}
async function sql<T>(query:string,args:unknown[]):Promise<T[]>{
  return (await pg.query<T>(query,args)).rows;
}
async function launch(s:GameState){
  const rs=await sql<{id:string}>('select public.launch_session($1::jsonb,$2,$3) id',
    [JSON.stringify(s),'fake-pin',true]);
  expect(rs[0].id).toBe(s.id);
}
async function commit(before:GameState,after:GameState){
  attempts++;
  const rs=await sql<{ok:boolean}>('select public.commit_session($1,$2,$3::jsonb) ok',
    [before.id,before.version,JSON.stringify(after)]);
  if(!rs[0].ok){conflicts++;throw new Error('Unexpected optimistic-lock failure');}
  commits++;
}
async function move(before:GameState,cmd:Command,user=host,index=0){
  const after=action(before,cmd,user,index);
  await commit(before,after);
  return after;
}
async function stored(id:string){
  const rows=await sql<{data:{state:GameState}}>('select public.read_session_runtime($1) data',[id]);
  expect(rows[0]?.data?.state).toBeDefined();
  return rows[0].data.state;
}
async function makeRoom(code:string){
  const definition=starterGame(),game=crypto.randomUUID();
  await sql('insert into public.games(id,owner_id,board,pin_hash) values($1,$2,$3::jsonb,$4)',
    [game,host,JSON.stringify(definition),'fake-pin']);
  const s=newSession(definition,game,host,code,now,controller);
  await launch(s);return s;
}
beforeAll(async()=>{
  mkdirSync(output,{recursive:true});
  await pg.exec([
    'create role anon;create role authenticated;create role service_role;',
    'create schema auth;create table auth.users(id uuid primary key);',
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
  for(const file of ['001_initial.sql','002_recovery_display.sql'])
    await pg.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  for(const id of [host,...players])
    await sql('insert into auth.users(id) values($1)',[id]);
},30000);
afterAll(async()=>{
  writeFileSync(output+'/results.json',JSON.stringify({
    date:new Date().toISOString(),node:process.version,
    scope:'Real engine and SQL migrations in isolated local PGlite. Supabase Auth, hosted networking, Vercel and Realtime delivery are not load-tested.',
    totals:{attempts,commits,conflicts},scenarios:reports
  },null,2));
  await pg.close();
});

it('complete five-player show: every round, prize, Mystery, Express, Triple Toss-Up, speed-up, Bonus, and result consistency',async()=>{
  const start=performance.now();
  let checks=0;
  let s=await makeRoom('521001');
  for(let i=0;i<5;i++)s=await move(s,{type:'join',name:'Player '+(i+1)},players[i]);
  expect(s.players).toHaveLength(5);checks++;
  expect(()=>action(s,{type:'join',name:'Player 1'},players[5])).toThrow();checks++;
  expect(()=>action(s,{type:'join',name:'Extra'},players[5])).toThrow();checks++;
  s=await move(s,{type:'lockLobby',locked:true});
  expect(()=>action(s,{type:'join',name:'Extra'},players[5])).toThrow();checks++;
  s=await move(s,{type:'lockLobby',locked:false});
  s=await move(s,{type:'start'});
  expect(s.phase).toBe('tossup');checks++;
  // One wrong answer, then two correct answers. Each interstitial stays put.
  const firstWindow=s.windowId!;
  s=await move(s,{type:'buzz',windowId:firstWindow},players[0]);
  expect(()=>action(s,{type:'buzz',windowId:firstWindow},players[1])).toThrow();checks++;
  s=await move(s,{type:'judgeBuzz',correct:false});
  expect(s.phase).toBe('roundResult');
  expect(s.puzzleIndex).toBe(0);checks++;
  s=await move(s,{type:'nextRound'});
  expect(s.deadline!-s.updatedAt).toBe(30000);checks++;
  s=await move(s,{type:'buzz',windowId:s.windowId!},players[1]);
  s=await move(s,{type:'judgeBuzz',correct:true});
  expect(s.players[1].banked).toBe(1000);checks++;
  s=await move(s,{type:'nextRound'});
  expect(s.deadline!-s.updatedAt).toBe(30000);checks++;
  s=await move(s,{type:'buzz',windowId:s.windowId!},players[1]);
  s=await move(s,{type:'judgeBuzz',correct:true});
  s=await move(s,{type:'nextRound'});
  expect(s.phase).toBe('turn');expect(s.roundIndex).toBe(1);checks++;
  // Regular: cash wedge, repeated consonants, vowel cost, correct solution.
  const regularPlayer=s.currentPlayerId!;
  s=await move(s,{type:'spin'},regularPlayer,0);
  expect(s.phase).toBe('spinning');expect(s.pendingSpin).toBeUndefined();checks++;
  s=await move(s,{type:'letter',letter:'T'},regularPlayer);
  expect(s.players.find(p=>p.id===regularPlayer)!.roundMoney).toBe(1500);checks++;
  s=await move(s,{type:'buyVowel'},regularPlayer);
  s=await move(s,{type:'letter',letter:'E'},regularPlayer);
  expect(s.players.find(p=>p.id===regularPlayer)!.roundMoney).toBe(1250);checks++;
  s=await move(s,{type:'solve',text:'THE FUTURE IS BRIGHT'},regularPlayer);
  expect(s.phase).toBe('roundResult');checks++;
  s=await move(s,{type:'nextRound'});
  expect(s.roundIndex).toBe(2);checks++;
  // Mystery: accept a known 50/50 prize branch, which banks only on solve.
  let current=s.currentPlayerId!;
  s=await move(s,{type:'spin'},current,5);
  s=await move(s,{type:'letter',letter:'N'},current);
  expect(s.phase).toBe('mysteryChoice');checks++;
  s=await move(s,{type:'mystery',reveal:true},current,1);
  expect(s.players.find(p=>p.id===current)?.pendingPrizes.some(p=>p.value===10000)).toBe(true);checks++;
  s=await move(s,{type:'hostSolve',playerId:current});
  expect(s.players.find(p=>p.id===current)?.prizes.some(p=>p.value===10000)).toBe(true);checks++;
  s=await move(s,{type:'nextRound'});
  // Prize: Express is optional; incorrect Express letter loses current money.
  current=s.currentPlayerId!;
  s=await move(s,{type:'spin'},current,6);
  s=await move(s,{type:'letter',letter:'P'},current);
  expect(s.phase).toBe('expressChoice');checks++;
  s=await move(s,{type:'express',accept:true},current);
  s=await move(s,{type:'letter',letter:'Z'},current);
  expect(s.players.find(p=>p.id===current)?.roundMoney).toBe(0);checks++;
  current=s.currentPlayerId!;
  s=await move(s,{type:'hostSolve',playerId:current});
  expect(s.players.find(p=>p.id===current)?.prizes.some(p=>p.value===8000)).toBe(true);checks++;
  s=await move(s,{type:'nextRound'});
  // Triple: all three correct -> +$6k and +$4k sweep.
  for(let i=0;i<3;i++){
    s=await move(s,{type:'buzz',windowId:s.windowId!},players[2]);
    s=await move(s,{type:'judgeBuzz',correct:true});
    expect(s.phase).toBe('roundResult');checks++;
    s=await move(s,{type:'nextRound'});
  }
  expect(s.roundIndex).toBe(5);expect(s.phase).toBe('turn');checks++;
  expect(s.players[2].banked).toBeGreaterThanOrEqual(10000);checks++;
  // Final: fixed consonant value / no further spins, then the highest scorer advances.
  s=await move(s,{type:'speedUp'});
  expect(s.phase).toBe('finalSpinning');checks++;
  expect(s.spinEndsAt).toBeDefined();checks++;
  expect(s.spin?.wedge.kind).toBe('cash');checks++;
  current=s.currentPlayerId!;
  s=await move(s,{type:'letter',letter:'C'},current);
  expect(s.speedupCanSolve).toBe(true);checks++;
  expect(s.windowId).toBeDefined();checks++;
  s=await move(s,{type:'speedupBuzz',windowId:s.windowId!},current);
  expect(s.phase).toBe('speedupAnswer');checks++;
  expect(s.deadline).toBeUndefined();checks++;
  s=await move(s,{type:'solve',text:'CHOCOLATE CHIP PANCAKES'},current);
  expect(s.phase).toBe('roundResult');checks++;
  const standings=s.players.map(p=>({id:p.id,total:total(p)}));
  s=await move(s,{type:'nextRound'});
  expect(['bonusSpin','tieTossup']).toContain(s.phase);checks++;
  if(s.phase==='tieTossup'){
    const eligible=s.tieEligible!;
    s=await move(s,{type:'buzz',windowId:s.windowId!},eligible[0]);
    s=await move(s,{type:'judgeBuzz',correct:true});
  }
  expect(s.phase).toBe('bonusSpin');checks++;
  const finalist=s.bonusPlayerId!;
  expect(standings.some(row=>row.id===finalist)).toBe(true);checks++;
  s=await move(s,{type:'spinBonus'},finalist);
  expect(s.phase).toBe('bonusSpinning');checks++;
  expect(s.spin?.index).toBeGreaterThanOrEqual(0);checks++;
  expect(viewSession(s,players[0],now).bonusPrize).toBeUndefined();checks++;
  s=await move(s,{type:'chooseBonus',index:0},finalist);
  for(const letter of ['B','C','D','A'])s=await move(s,{type:'bonusLetter',letter},finalist);
  s=await move(s,{type:'startBonus'});
  expect(s.deadline!-s.updatedAt).toBe(10000);checks++;
  s=await move(s,{type:'bonusSolve',text:'A DREAM COME TRUE'},finalist);
  expect(s.bonusWon).toBe(true);checks++;
  s=await move(s,{type:'finish'});
  expect(s.phase).toBe('finished');checks++;
  expect(s.players.find(p=>p.id===finalist)!.prizes.some(p=>p.value===40000)).toBe(true);checks++;
  const persisted=await stored(s.id);
  expect(persisted.phase).toBe('finished');expect(persisted.version).toBe(s.version);checks++;
  const views=players.slice(0,5).map(id=>viewSession(persisted,id,now));
  expect(new Set(views.map(v=>JSON.stringify(v.players.map(total)))).size).toBe(1);checks++;
  const rows=await sql<{active:boolean;version:number}>('select active,version from public.sessions where id=$1',[s.id]);
  expect(rows[0]).toMatchObject({active:false,version:s.version});checks++;
  log('complete five-contestant show, actual SQL commits and projections',start,checks,
    {events:s.events.length,version:s.version,bonusPrize:40000,playerTotals:s.players.map(total)});
},150000);

it('five-way simultaneous buzzer contention in three independent rooms over many windows',async()=>{
  const started=performance.now();
  const outcomes:{room:number;window:number;winner:string;losers:number}[]=[];
  let checks=0;
  for(let room=0;room<3;room++){
    let s=await makeRoom('75210'+room);
    for(let i=0;i<5;i++)s=await move(s,{type:'join',name:'P'+i},players[i]);
    s=await move(s,{type:'start'});
    for(let window=0;window<12;window++){
      const original=s,windowId=s.windowId!;
      const attempts=await Promise.all(players.slice(0,5).map(async id=>{
        const next=action(original,{type:'buzz',windowId},id);
        const res=await sql<{ok:boolean}>(
          'select public.claim_session_buzz($1,$2,$3,$4,$5::jsonb) ok',
          [original.id,original.version,windowId,id,JSON.stringify(next)]);
        return {id,ok:res[0].ok};
      }));
      const winners=attempts.filter(x=>x.ok);
      expect(winners).toHaveLength(1);checks++;
      expect(attempts.filter(x=>!x.ok)).toHaveLength(4);checks++;
      s=await stored(original.id);
      expect(s.respondent).toBe(winners[0].id);checks++;
      // A stale-window buzz cannot be replayed as another winning response.
      expect(()=>action(s,{type:'buzz',windowId},players[(window+1)%5])).toThrow();checks++;
      if(window<11){
        // The next race uses an independent open window without mutating earned scores.
        s.phase='tossup';s.respondent=undefined;s.attempted=[];s.windowId=crypto.randomUUID();
        s.deadline=now+30000;s.remaining=30000;s.version++;
        const cas=await sql<{ok:boolean}>('select public.commit_session($1,$2,$3::jsonb) ok',
          [s.id,s.version-1,JSON.stringify(s)]);
        expect(cas[0].ok).toBe(true);checks++;
      }
      outcomes.push({room,window,winner:winners[0].id,losers:4});
    }
  }
  expect(outcomes).toHaveLength(36);checks++;
  log('3 rooms × 12 windows × 5 simultaneous buzzer claims (real conditional SQL)',started,checks,
    {windows:36,buzzes:180,accepted:36,conflicting:144,rooms:3});
},140000);

it('1–5 seats, reconnect identity and idempotency, invalid commands, pause/undo and deadline boundaries',async()=>{
  const started=performance.now();let checks=0;
  for(let seats=1;seats<=MAX_PLAYERS;seats++){
    let s=await makeRoom('88300'+seats);
    for(let i=0;i<seats;i++)s=await move(s,{type:'join',name:'Seat '+i},players[i]);
    const old=s;
    const ctx=context(old,players[0]);
    const joinAgain=applyCommand(old,{type:'join',name:'Ignored name'},ctx);
    expect(joinAgain.players).toHaveLength(seats);checks++;
    expect(()=>action(old,{type:'pause'},players[0])).toThrow();checks++;
    s=await move(s,{type:'start'});
    expect(s.players).toHaveLength(seats);checks++;
    expect(()=>action(s,{type:'join',name:'Late'},players[5])).toThrow();checks++;
    const actId=crypto.randomUUID();
    const c=context(s,players[0],0,actId);
    const buzz=applyCommand(s,{type:'buzz',windowId:s.windowId!},c);
    const duplicate=applyCommand(buzz,{type:'buzz',windowId:s.windowId!},{...c,expectedVersion:buzz.actionVersion});
    expect(duplicate).toEqual(buzz);checks++;
    s=await commit(s,buzz).then(()=>buzz);
    s=await move(s,{type:'judgeBuzz',correct:true});
    expect(s.phase).toBe('roundResult');checks++;
    s=await move(s,{type:'undo'});
    expect(s.paused).toBe(true);checks++;
    expect(()=>action(s,{type:'nextRound'})).toThrow();checks++;
    s=await move(s,{type:'continue'});
    expect(s.paused).toBe(false);checks++;
    // Legacy old-controller takeover is rejected without changing the score.
    const oldController=s.controller!;
    const newController=crypto.randomUUID();
    s=await move(s,{type:'claim',pin:'123456',controller:newController});
    expect(s.controller).toBe(newController);checks++;
    const wrong={...context(s,host),controller:oldController};
    expect(()=>applyCommand(s,{type:'pause'},wrong)).toThrow();checks++;
    // Closing a running show cannot be reversed or joined.
    const final=applyCommand(s,{type:'end'},{...context(s,host),controller:newController});
    await commit(s,final);s=final;
    expect(s.phase).toBe('ended');checks++;
    expect(()=>action(s,{type:'start'})).toThrow();checks++;
  }
  log('seat sizes 1–5, duplicate commands, undo, pause/reconnect and closed-room protection',started,checks,{seatSizes:[1,2,3,4,5]});
},120000);
