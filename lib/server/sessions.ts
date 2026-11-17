import { db } from './db';
import { applyCommand, GameError, reconcile } from '@/lib/game/engine';
import type { Command } from '@/lib/game/schema';
import type { Context, GameState } from '@/lib/game/types';

export interface SessionRow {
  id: string; state: GameState; pin_hash: string; version: number; runtimeAt?: number;
}
function databaseError(error:{code?:string}|null){
  if(!error)return;
  console.error('Session runtime error',error.code);
  throw new GameError(
    error.code==='42883'||error.code==='PGRST202'
      ?'Apply the Supabase SQL migration before using the app.'
      :'Unable to save the game. Please retry.',503);
}
export async function readSession(id:string):Promise<SessionRow>{
  const {data,error}=await db().rpc('read_session_runtime',{p_id:id});
  databaseError(error);
  if(!data)throw new GameError('Session not found.',404);
  return data as SessionRow;
}
function authorize(s:GameState,userId:string){
  if(s.hostId!==userId&&!s.players.some(p=>p.id===userId&&!p.removed))
    throw new GameError('You do not have access to this session.',403);
}
async function commit(before:GameState,after:GameState,buzz?:{windowId:string;userId:string}){
  const {data,error}=await db().rpc(buzz?'claim_session_buzz':'commit_session',{
    p_id:before.id,p_expected:before.version,p_state:after,
    ...(buzz?{p_window:buzz.windowId,p_user:buzz.userId}:{})
  });
  databaseError(error);
  return data as boolean;
}
export async function loadSession(id:string,userId:string){
  for(let attempt=0;attempt<12;attempt++){
    const row=await readSession(id);authorize(row.state,userId);
    const next=structuredClone(row.state);
    reconcile(next,Date.now());
    if(JSON.stringify(next)===JSON.stringify(row.state))return row;
    next.version=row.state.version+1;
    next.actionVersion=row.state.actionVersion+1;
    next.updatedAt=Date.now();
    if(await commit(row.state,next))return readSession(id);
  }
  throw new GameError('Game is busy. Please retry.',409);
}
export async function heartbeat(id:string,ctx:Context){
  let {data,error}=await db().rpc('touch_session_presence',{
    p_id:id,p_user:ctx.userId,p_controller:ctx.controller??null
  });
  databaseError(error);
  if(data?.error)throw new GameError(data.error,data.status??409);
  if(data?.reconcile){
    await loadSession(id,ctx.userId);
    ({data,error}=await db().rpc('touch_session_presence',{
      p_id:id,p_user:ctx.userId,p_controller:ctx.controller??null
    }));
    databaseError(error);
    if(data?.error)throw new GameError(data.error,data.status??409);
    return {...data,needsRefresh:true};
  }
  return data;
}
export async function mutate(id:string,command:Command,ctx:Context):Promise<GameState>{
  for(let attempt=0;attempt<20;attempt++){
    const row=await readSession(id);
    if(command.type!=='join')authorize(row.state,ctx.userId);
    const next=applyCommand(row.state,command,{...ctx,now:Date.now()});
    if(next.version===row.state.version)return row.state;
    const buzz=command.type==='buzz'?{windowId:command.windowId,userId:ctx.userId}:undefined;
    if(await commit(row.state,next,buzz))return (await readSession(id)).state;
    if(buzz)throw new GameError('Another contestant buzzed first.',409);
  }
  throw new GameError('Game is busy. Please retry.',409);
}
