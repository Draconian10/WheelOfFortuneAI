import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { db, hashPin, verifyPin, identity, hostOnly, limit } from '@/lib/server/db';
import { guestSecret, guestSecretHash, secretMatches } from '@/lib/server/guest-access';
import { heartbeat, loadSession, mutate, readSession } from '@/lib/server/sessions';
import { newSession, GameError, viewSession, total } from '@/lib/game/engine';
import { pinSchema, envelopeSchema, saveSchema, playable } from '@/lib/game/schema';
import type { GameDefinition, GameState } from '@/lib/game/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;
const uuid=z.string().uuid();
async function body(req:NextRequest){
  const text=await req.text();
  if(text.length>1000000)throw new GameError('Request is too large.',413);
  try{return JSON.parse(text);}catch{throw new GameError('Invalid JSON.');}
}
const noCache={'Cache-Control':'private, no-store'};
function csvCell(value:unknown){
  const s=String(value??'');
  // Prevent spreadsheet formula execution in exported data.
  const safe=/^[=+\-@\t\r]/.test(s)?'\''+s:s;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function exportResults(s:GameState){
  const rows:(string|number)[][]=[
    ['Player','Standing','Banked cash','Prize value','Total','Status'],
  ];
  const ranked=s.players.filter(p=>!p.removed).sort((a,b)=>total(b)-total(a)||a.seat-b.seat);
  for(const [i,p] of ranked.entries())
    rows.push([p.name,i+1,p.banked,p.prizes.reduce((sum,x)=>sum+x.value,0),total(p),
      p.id===s.bonusPlayerId?'Main-game finalist':'Contestant']);
  rows.push([]);
  rows.push(['Event','Player','Round','Amount','Description','Timestamp']);
  for(const e of s.events){
    const player=s.players.find(p=>p.id===e.playerId);
    rows.push(['Score',player?.name??'',e.round+1,e.delta,e.reason,new Date(e.at).toISOString()]);
  }
  return '\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
async function handle(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){
  try{
    if(req.method!=='GET'){
      const origin=req.headers.get('origin');
      if(origin&&origin!==req.nextUrl.origin)throw new GameError('Cross-origin request rejected.',403);
    }
    const {path}=await ctx.params;
    if(path.length>3)throw new GameError('Route not found.',404);
    const [resource,id,op]=path,database=db();
    if(resource==='display'&&req.method==='GET'&&id&&!op){
      uuid.parse(id);const token=req.nextUrl.searchParams.get('token')??'';
      if(!/^[A-Za-z0-9_-]{32}$/.test(token))throw new GameError('Audience link invalid.',403);
      await limit(req,id,'display-read',600,60);
      const {data:link,error}=await database.from('session_display_links').select('token_hash')
       .eq('session_id',id).gt('expires_at',new Date().toISOString()).maybeSingle();
      if(error||!link||!secretMatches(link.token_hash,guestSecretHash('display',id,token)))
        throw new GameError('This audience link has expired or was replaced.',403);
      const {state,runtimeAt}=await readSession(id);
      return NextResponse.json({...viewSession(state,state.hostId,Date.now(),undefined,true),runtimeAt},{headers:noCache});
    }
    const user=await identity(req);
    if(resource==='player-sessions'&&req.method==='GET'&&!id){
      const {data:memberships,error:merr}=await database.from('session_members').select('session_id').eq('user_id',user.id);
      if(merr)throw new GameError('Could not fetch your games.',503);
      if(!memberships?.length)return NextResponse.json({sessions:[]},{headers:noCache});
      const {data:rows,error}=await database.from('sessions').select('state').in('id',memberships.map(m=>m.session_id))
        .eq('active',true).order('created_at',{ascending:false}).limit(20);
      if(error)throw new GameError('Could not fetch your games.',503);
      return NextResponse.json({sessions:(rows??[]).flatMap(({state})=>{
        const s=state as GameState;
        return s.players.some(p=>p.id===user.id&&!p.removed)
          ?[{id:s.id,title:s.title,joinCode:s.joinCode,phase:s.phase,createdAt:s.createdAt}]:[];
      })},{headers:noCache});
    }
    if(resource==='recovery'&&id==='request'&&req.method==='POST'){
      await limit(req,user.id,'recovery-request',30,60);
      if(!user.is_anonymous)throw new GameError('Join with a separate player identity.',403);
      const input=z.object({code:pinSchema,recoveryCode:z.string().regex(/^[A-Za-z0-9_-]{24}$/)}).strict().parse(await body(req));
      const {data:room}=await database.from('sessions').select('id').eq('join_code',input.code).eq('active',true).maybeSingle();
      if(!room)throw new GameError('Game or recovery code not found.',404);
      const {data,error}=await database.rpc('request_player_recovery',{
        p_session:room.id,p_claimant:user.id,p_hash:guestSecretHash('recovery',room.id,input.recoveryCode)
      });
      if(error)throw new GameError('Unable to request seat recovery.',503);
      if(data?.error)throw new GameError(data.error,data.status);
      return NextResponse.json({requestId:data.requestId},{status:201,headers:noCache});
    }
    if(resource==='recovery'&&id&&!op&&req.method==='GET'){
      uuid.parse(id);
      const {data:request}=await database.from('session_player_recovery_requests')
        .select('status,session_id,expires_at').eq('id',id).eq('claimant_id',user.id).maybeSingle();
      if(!request)throw new GameError('Recovery request not found.',404);
      const status=request.status==='pending'&&new Date(request.expires_at).getTime()<Date.now()?'expired':request.status;
      return NextResponse.json({status,...(status==='approved'?{sessionId:request.session_id}:{})},{headers:noCache});
    }
    if(resource==='games'){
      hostOnly(user);
      if(req.method==='GET'&&!id){
        const [games,sessions]=await Promise.all([
          database.from('games').select('id,board,version,archived,updated_at').eq('owner_id',user.id).order('updated_at',{ascending:false}),
          database.from('sessions').select('id,game_id,join_code,active,state,created_at').eq('host_id',user.id).order('created_at',{ascending:false})
        ]);
        if(games.error||sessions.error)throw new GameError('Could not load games.',503);
        return NextResponse.json({
          games:(games.data??[]).map(g=>({id:g.id,title:(g.board as GameDefinition).title,version:g.version,
            archived:g.archived,updatedAt:g.updated_at})),
          sessions:(sessions.data??[]).map(s=>({id:s.id,gameId:s.game_id,joinCode:s.join_code,
            active:s.active,phase:(s.state as GameState).phase,title:(s.state as GameState).title,
            players:(s.state as GameState).players.filter(p=>!p.removed).length,createdAt:s.created_at}))
        },{headers:noCache});
      }
      if(req.method==='POST'&&!id){
        await limit(req,user.id,'save',30,60);
        const input=saveSchema.parse(await body(req));
        if(!input.pin)throw new GameError('Choose a six-digit host PIN.');
        const {data,error}=await database.from('games')
         .insert({owner_id:user.id,board:input.definition,pin_hash:hashPin(input.pin)})
         .select('id').single();
        if(error)throw new GameError('Unable to create game.',503);
        return NextResponse.json(data,{status:201,headers:noCache});
      }
      uuid.parse(id);
      const {data:game,error}=await database.from('games').select('*').eq('id',id).eq('owner_id',user.id).single();
      if(error||!game)throw new GameError('Game not found.',404);
      if(req.method==='GET'&&!op)return NextResponse.json({id:game.id,definition:game.board,version:game.version},{headers:noCache});
      if(req.method==='PUT'&&!op){
        await limit(req,user.id,'save',30,60);
        const input=saveSchema.parse(await body(req));
        if(input.version===undefined)throw new GameError('Game version required.');
        const {data,error}=await database.from('games')
          .update({board:input.definition,version:input.version+1,updated_at:new Date().toISOString(),
            ...(input.pin?{pin_hash:hashPin(input.pin)}:{})})
          .eq('id',id).eq('owner_id',user.id).eq('version',input.version)
          .select('version').maybeSingle();
        if(error)throw new GameError('Unable to save game.',503);
        if(!data)throw new GameError('This game was edited in another tab. Refresh before saving.',409);
        return NextResponse.json(data,{headers:noCache});
      }
      if(req.method==='POST'&&op==='archive'){
        const input=z.object({archived:z.boolean(),version:z.number().int().nonnegative()}).strict().parse(await body(req));
        if(input.archived){
          const {data:running}=await database.from('sessions').select('id').eq('game_id',id).eq('active',true).limit(1);
          if(running?.length)throw new GameError('End the active session before archiving.',409);
        }
        const {data,error}=await database.from('games').update({archived:input.archived,version:input.version+1})
          .eq('id',id).eq('owner_id',user.id).eq('version',input.version).select('id').maybeSingle();
        if(error||!data)throw new GameError('Could not archive; refresh the list.',409);
        return NextResponse.json({ok:true},{headers:noCache});
      }
      if(req.method==='POST'&&op==='start'){
        await limit(req,user.id,'pin',10,60);
        if(game.archived)throw new GameError('Restore the game first.');
        const input=z.object({pin:pinSchema,separate:z.boolean().default(false),
          requestId:uuid,controller:uuid}).strict().parse(await body(req));
        if(!verifyPin(input.pin,game.pin_hash))throw new GameError('Incorrect host PIN.',403);
        try{playable(game.board);}catch(e){throw new GameError((e as Error).message);}
        const {data:previous}=await database.from('sessions').select('id').eq('id',input.requestId).eq('host_id',user.id).maybeSingle();
        if(previous)return NextResponse.json({id:previous.id},{headers:noCache});
        for(let i=0;i<15;i++){
          const code=String(randomInt(0,1000000)).padStart(6,'0');
          const session=newSession(game.board as GameDefinition,id,user.id,code,Date.now(),input.controller);
          session.id=input.requestId;
          const {error}=await database.rpc('launch_session',{
            p_state:session,p_pin_hash:game.pin_hash,p_separate:input.separate
          });
          if(!error)return NextResponse.json({id:session.id},{status:201,headers:noCache});
          if(error.code==='P0001')throw new GameError('An unfinished session exists. Resume it first.',409);
          if(error.code!=='23505')throw new GameError('Could not launch the game.',503);
        }
        throw new GameError('Could not allocate a join code.',503);
      }
    }
    if(resource==='join'&&req.method==='POST'&&!id){
      await limit(req,user.id,'join',20,60);
      const input=z.object({code:pinSchema,name:z.string().trim().min(1).max(24)}).strict().parse(await body(req));
      const {data:room}=await database.from('sessions').select('id').eq('join_code',input.code).eq('active',true).maybeSingle();
      if(!room)throw new GameError('No active game matches that code.',404);
      await mutate(room.id,{type:'join',name:input.name},{
        userId:user.id,now:Date.now(),actionId:crypto.randomUUID(),expectedVersion:0
      });
      return NextResponse.json({id:room.id},{headers:noCache});
    }
    if(resource==='sessions'){
      uuid.parse(id);
      const controller=req.headers.get('x-controller')??undefined;
      if(controller)uuid.parse(controller);
      if(req.method==='POST'&&op==='recovery-code'){
        await limit(req,user.id,'recovery-code',60,60);
        const {state}=await readSession(id);
        if(!state.players.some(p=>p.id===user.id&&!p.removed)||['ended','finished'].includes(state.phase))
          throw new GameError('Only an active player can create a recovery code.',403);
        const code=guestSecret(18),expiresAt=new Date(Date.now()+12*60*60_000).toISOString();
        const {data,error}=await database.rpc('rotate_player_recovery_code',{
          p_session:id,p_player:user.id,p_hash:guestSecretHash('recovery',id,code),p_expires:expiresAt
        });
        if(error||!data)throw new GameError('Unable to create recovery code.',503);
        return NextResponse.json({code,expiresAt},{headers:noCache});
      }
      if(req.method==='POST'&&op==='display-link'){
        hostOnly(user);
        const {state}=await readSession(id);
        if(state.hostId!==user.id)throw new GameError('Only the host can share the audience view.',403);
        const token=guestSecret(24),expiresAt=new Date(Date.now()+12*60*60_000).toISOString();
        const {error}=await database.from('session_display_links').upsert({
          session_id:id,token_hash:guestSecretHash('display',id,token),
          expires_at:expiresAt,created_at:new Date().toISOString()
        },{onConflict:'session_id'});
        if(error)throw new GameError('Unable to create audience link.',503);
        return NextResponse.json({token,expiresAt},{headers:noCache});
      }
      if(req.method==='GET'&&op==='recovery-requests'){
        hostOnly(user);const {state}=await readSession(id);
        if(state.hostId!==user.id)throw new GameError('Only the host can review recovery requests.',403);
        const {data,error}=await database.from('session_player_recovery_requests')
          .select('id,player_id,requested_at,expires_at').eq('session_id',id).eq('status','pending')
          .gt('expires_at',new Date().toISOString()).order('requested_at',{ascending:true}).limit(50);
        if(error)throw new GameError('Unable to load recovery requests.',503);
        return NextResponse.json({requests:(data??[]).flatMap(r=>{
          const p=state.players.find(p=>p.id===r.player_id&&!p.removed);
          return p?[{id:r.id,name:p.name,requestedAt:r.requested_at}]:[];
        })},{headers:noCache});
      }
      if(req.method==='POST'&&['recovery-approve','recovery-reject'].includes(op??'')){
        hostOnly(user);const {state}=await readSession(id);
        if(state.hostId!==user.id)throw new GameError('Only the host can review requests.',403);
        const input=z.object({requestId:uuid}).strict().parse(await body(req));
        if(op==='recovery-reject'){
          const {error}=await database.from('session_player_recovery_requests')
            .update({status:'rejected',resolved_at:new Date().toISOString()})
            .eq('id',input.requestId).eq('session_id',id).eq('status','pending');
          if(error)throw new GameError('Unable to decline recovery.',503);
          return NextResponse.json({rejected:true},{headers:noCache});
        }
        const {data,error}=await database.rpc('approve_player_recovery',{
          p_session:id,p_host:user.id,p_request:input.requestId
        });
        if(error)throw new GameError('Unable to approve recovery.',503);
        if(data?.error)throw new GameError(data.error,data.status);
        return NextResponse.json(data,{headers:noCache});
      }
      if(req.method==='GET'&&op==='results'){
        hostOnly(user);const {state}=await readSession(id);
        if(state.hostId!==user.id)throw new GameError('Only the host can download results.',403);
        if(!['ended','finished'].includes(state.phase))throw new GameError('End the game to export results.',409);
        return new Response(exportResults(state),{headers:{
          'Content-Type':'text/csv; charset=utf-8',
          'Content-Disposition':'attachment; filename="fortune-results-'+id+'.csv"',
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
        }});
      }
      if(req.method==='GET'&&!op){
        const {state,runtimeAt}=await loadSession(id,user.id);
        return NextResponse.json({
          ...viewSession(state,user.id,Date.now(),controller,
            req.nextUrl.searchParams.get('view')==='audience'),
          runtimeAt
        },{headers:noCache});
      }
      if(req.method==='POST'&&op==='end'){
        hostOnly(user);
        const input=z.object({actionId:uuid,confirmed:z.literal(true)}).strict().parse(await body(req));
        const row=await readSession(id);
        if(row.state.hostId!==user.id)throw new GameError('Only the host can end this game.',403);
        if(['ended','finished'].includes(row.state.phase))return NextResponse.json({ended:true},{headers:noCache});
        await mutate(id,{type:'end'},{userId:user.id,actionId:input.actionId,now:Date.now(),
          expectedVersion:row.state.actionVersion,controller:row.state.controller});
        return NextResponse.json({ended:true},{headers:noCache});
      }
      if(req.method==='POST'&&op==='command'){
        const input=envelopeSchema.parse(await body(req));
        let verified=false;
        if(input.command.type==='claim'){
          await limit(req,user.id,'pin',10,60);
          const row=await readSession(id);
          if(row.state.hostId!==user.id)throw new GameError('Only the host can reclaim control.',403);
          verified=verifyPin(input.command.pin,row.pin_hash);
        }else if(input.command.type==='heartbeat')await limit(req,user.id,'heartbeat',30,60);
        else await limit(req,user.id,'commands',240,60);
        const commandContext={userId:user.id,actionId:input.actionId,now:Date.now(),
          expectedVersion:input.version,controller:input.controller,pinVerified:verified};
        if(input.command.type==='heartbeat')
          return NextResponse.json(await heartbeat(id,commandContext),{headers:noCache});
        const state=await mutate(id,input.command,commandContext);
        return NextResponse.json(viewSession(state,user.id,Date.now(),input.controller),{headers:noCache});
      }
    }
    throw new GameError('Route not found.',404);
  }catch(error){
    const message=error instanceof z.ZodError
      ?error.issues.map(i=>(i.path.join('.')||'Input')+': '+i.message).join('; ')
      :error instanceof GameError?error.message
      :'Unexpected server error. Please retry.';
    const status=error instanceof GameError?error.status:error instanceof z.ZodError?400:500;
    if(status>=500)console.error('Fortune API error',error);
    return NextResponse.json({error:message},{status,headers:noCache});
  }
}
export async function GET(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){return handle(req,ctx);}
export async function POST(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){return handle(req,ctx);}
export async function PUT(req:NextRequest,ctx:{params:Promise<{path:string[]}>}){return handle(req,ctx);}
