import type { Command } from './schema';
import type { Context, GameDefinition, GameRound, GameState, Player, Prize, Puzzle, SessionView, Spin } from './types';
import { playable } from './schema';
import { secureIndex, wheelForRound, MYSTERY_INDICES, bonusWheelWedges, bonusEnvelopeForSlot } from './wheel';

export const HOST_GRACE_MS = 30000;
export const TOSSUP_MS = 30000;
export const SPIN_DURATION_MS = 4200;
/** Show-style interval for a solve after a successful Speed-Up letter. */
export const SPEEDUP_SOLVE_MS = 3000;
/** Live sessions support one to five contestants; a full lobby is never required to begin. */
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 5;
const VOWELS = 'AEIOU';
const BASE_BONUS = 'RSTLNE';
const HOST_COMMANDS = new Set([
  'claim','pause','continue','lockLobby','remove','start','nextRound','revealTimedOut',
  'judgeBuzz','hostSolve','speedUp','adjustScore','undoLetter','startBonus','bonusJudge','finish','undo','end'
]);
const FINISHED = new Set(['finished','ended']);
export class GameError extends Error {
  constructor(message:string, public status=400){super(message);}
}
function ensure(check:unknown, message:string, status=400):asserts check {
  if(!check) throw new GameError(message,status);
}
const random=(ctx:Context,n:number) => {
  const choice=ctx.random ? ctx.random(n) : secureIndex(n);
  ensure(Number.isSafeInteger(choice)&&choice>=0&&choice<n,'Invalid random selection.');
  return choice;
};
export const activePlayers=(s:GameState)=>s.players.filter(p=>!p.removed).sort((a,b)=>a.seat-b.seat);
export const total=(p:Player)=>p.banked+p.prizes.reduce((sum,prize)=>sum+prize.value,0);
export const normalize=(answer:string)=>answer.toUpperCase().replace(/[^A-Z0-9]/g,'');
export function currentRound(s:GameState):GameRound|undefined{return s.definition.rounds[s.roundIndex];}
export function currentPuzzle(s:GameState):Puzzle{
  if(s.phase==='tieTossup'||s.phase==='tieAnswer')return s.definition.tiebreaker;
  if(['bonusCategory','bonusSpin','bonusSpinning','bonusLetters','bonusTimer','bonusResult','finished'].includes(s.phase)&&s.bonusPuzzleIndex!==undefined)
    return s.definition.bonus.puzzles[s.bonusPuzzleIndex];
  return currentRound(s)?.puzzles[s.puzzleIndex]??s.definition.tiebreaker;
}
export function newSession(definition:GameDefinition,gameId:string,hostId:string,joinCode:string,now:number,controller?:string):GameState{
  playable(definition);
  return {
    id:crypto.randomUUID(),gameId,hostId,joinCode,title:definition.title,definition:structuredClone(definition),
    version:0,actionVersion:0,hostSeen:now,controller,paused:false,locked:false,phase:'lobby',
    roundIndex:0,puzzleIndex:0,players:[],attempted:[],revealed:[],usedLetters:[],bonusLetters:[],
    tripleWinners:[],events:[],history:[],processed:[],createdAt:now,updatedAt:now
  };
}
function mark(s:GameState,ctx:Context,p:Player,delta:number,reason:string){
  ensure(Number.isSafeInteger(delta)&&Math.abs(delta)<10000000,'Invalid score change.');
  s.events.push({id:crypto.randomUUID(),playerId:p.id,delta,reason,
    round:s.roundIndex,puzzleIndex:s.puzzleIndex,at:ctx.now});
}
function recordAction(s:GameState,at:number,action:string,detail:string,actorId?:string,subjectId?:string,input?:string){
  if(!s.history)s.history=[];
  s.history.push({at,action,detail,actorId,subjectId,stageIndex:s.roundIndex,
    puzzleIndex:s.puzzleIndex,phase:s.phase,...(input===undefined?{}:{input})});
  if(s.history.length>1200)s.history=s.history.slice(-1000);
}
function checkpoint(s:GameState){
  const snapshot=structuredClone(s);delete snapshot.undo;
  s.undo=snapshot;
}
function addBanked(s:GameState,p:Player,value:number,ctx:Context,reason:string){
  p.banked+=value;mark(s,ctx,p,value,reason);
}
function resetPuzzle(s:GameState){
  s.revealed=[];s.usedLetters=[];s.respondent=undefined;s.attempted=[];
  s.pendingSpin=undefined;s.speedupCanSolve=false;s.wildCardValue=undefined;
  s.mysteryCash=undefined;s.spin=undefined;s.undo=undefined;
  s.mysteryReveals=undefined;
  s.answerStartedAt=undefined;s.spinEndsAt=undefined;s.puzzleTimedOut=undefined;s.frenzyRemaining=undefined;
}
function nextPlayer(s:GameState){
  const players=activePlayers(s);
  ensure(players.length>0,'No active contestants.');
  const index=players.findIndex(p=>p.id===s.currentPlayerId);
  s.currentPlayerId=players[(index+1)%players.length].id;
  s.phase=s.speedupValue!==undefined?'speedup':'turn';
  s.pendingSpin=undefined;s.speedupCanSolve=false;s.wildCardValue=undefined;
  s.windowId=undefined;s.respondent=undefined;
  s.deadline=undefined;s.remaining=undefined;
}
function finishRound(s:GameState){
  s.phase='roundResult';s.deadline=undefined;s.remaining=undefined;s.spinEndsAt=undefined;
  s.respondent=undefined;s.windowId=undefined;s.pendingSpin=undefined;
  s.speedupCanSolve=false;s.wildCardValue=undefined;
}
function setRound(s:GameState,ctx:Context){
  resetPuzzle(s);s.deadline=undefined;s.remaining=undefined;s.speedupValue=undefined;s.frenzyRemaining=undefined;
  // The same two mystery wedges retain their secret outcomes for the whole round.
  // Reveal commands never reroll an outcome. Other rounds clear that secret.
  s.mysteryPrizeIndex=currentRound(s)?.kind==='mystery'
    ?MYSTERY_INDICES[random(ctx,MYSTERY_INDICES.length)]:undefined;
  s.mysteryReveals=[];
  const players=activePlayers(s);
  ensure(players.length>0,'No contestants remain.');
  for(const p of players){p.roundMoney=0;p.pendingPrizes=[];p.pendingMillionWedge=false;}
  const round=currentRound(s)!;
  if(round.kind==='tossup'||round.kind==='triple'){
    s.phase='tossup';s.windowId=crypto.randomUUID();s.deadline=ctx.now+TOSSUP_MS;
    s.remaining=TOSSUP_MS;s.puzzleStartedAt=ctx.now;
  }else{
    // The last opening Toss-Up winner begins Round 1. The next contestants
    // in seat order begin Rounds 2 and 3, irrespective of who solved before.
    // The final Triple Toss-Up winner begins Round 4.
    const first=players.findIndex(p=>p.id===s.roundStarterId);
    const base=first>=0?first:random(ctx,players.length);
    const offset=['regular','mystery','prize'].includes(round.kind)?s.roundIndex-1:0;
    s.phase='turn';s.currentPlayerId=players[(base+offset)%players.length].id;
  }
}
function advanceTossup(s:GameState,ctx:Context){
  const round=currentRound(s);
  if(round&&s.puzzleIndex+1<round.puzzles.length){
    // Each Fortune Frenzy puzzle must have a fresh timer when the host starts it.
    // Never reuse the seconds remaining on the previously judged question.
    s.puzzleIndex++;resetPuzzle(s);s.puzzleStartedAt=ctx.now;
    s.phase='tossup';s.windowId=crypto.randomUUID();
    s.deadline=ctx.now+TOSSUP_MS;
    s.remaining=TOSSUP_MS;
    s.lastAction='Puzzle '+(s.puzzleIndex+1)+' is ready. You have 30 seconds to buzz.';
  }else finishRound(s);
}
function completedTossup(s:GameState,ctx:Context,player:Player){
  const round=currentRound(s);
  if(s.phase==='tieAnswer'){
    s.bonusPlayerId=player.id;s.tieEligible=undefined;s.phase='bonusSpin';s.spin=undefined;
    s.deadline=undefined;s.windowId=undefined;s.respondent=undefined;
    return;
  }
  const value=round?.kind==='triple'?2000:s.definition.opening==='traditional'
    ?(s.puzzleIndex===0?1000:2000):1000;
  addBanked(s,player,value,ctx,'Solved '+(round?.title??'Toss-Up'));
  // Triple Toss-Up 1 and 2 do not determine who starts the Final Spin.
  // Only the third Triple Toss-Up may change the starter for Round 4.
  if(round?.kind==='tossup'||(round?.kind==='triple'&&s.puzzleIndex===2))
    s.roundStarterId=player.id;
  if(round?.kind==='triple'){
    s.tripleWinners.push(player.id);
    if(s.puzzleIndex===2 && s.tripleWinners.length===3 &&
      s.tripleWinners.every(id=>id===player.id))
      addBanked(s,player,4000,ctx,'Triple Toss-Up sweep bonus');
  }
  // After a judgment, show standings until the host explicitly advances.
  // The next Frenzy question starts its own full 30-second clock.
  s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
  s.lastAction=player.name+' solved a '+(round?.kind==='triple'?'Triple Toss-Up':'Toss-Up')+'!';
  finishRound(s);
}
function bankrupt(s:GameState,p:Player){
  p.roundMoney=0;p.pendingPrizes=[];
  p.wildCard=false;p.pendingMillionWedge=false;p.millionWedge=false;
  s.mysteryCash=undefined;
  s.lastAction=p.name+' hit BANKRUPT';
  nextPlayer(s);
}
function bankPuzzle(s:GameState,ctx:Context,p:Player){
  const current=currentRound(s);
  addBanked(s,p,p.roundMoney,ctx,'Solved '+(current?.title??'round'));
  p.prizes.push(...p.pendingPrizes);
  if(p.pendingMillionWedge)p.millionWedge=true;
  if(current?.kind==='prize'&&current.prize)p.prizes.push(structuredClone(current.prize));
  for(const other of activePlayers(s)){
    other.roundMoney=0;other.pendingPrizes=[];other.pendingMillionWedge=false;
  }
  s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
  s.lastAction=p.name+' solved the puzzle!';
  finishRound(s);
}
function startTiebreaker(s:GameState,ctx:Context,leaders:Player[]){
  resetPuzzle(s);s.tieEligible=leaders.map(p=>p.id);
  s.phase='tieTossup';s.windowId=crypto.randomUUID();
  s.puzzleStartedAt=ctx.now;
  s.deadline=ctx.now+TOSSUP_MS;s.remaining=TOSSUP_MS;
  s.lastAction='Sudden-death Toss-Up! A fresh 30-second puzzle begins.';
}
function availableBonusEnvelopes(s:GameState):Prize[]{
  const finalist=s.players.find(p=>p.id===s.bonusPlayerId);
  const envelopes=s.definition.bonus.envelopes;
  if(!finalist?.millionWedge)return envelopes;
  // Replace the top envelope, rather than increasing the Bonus Wheel slots.
  const hundredThousand=envelopes.findIndex(p=>p.value===100000);
  const top=hundredThousand>=0?hundredThousand:
    envelopes.reduce((best,p,i)=>p.value>envelopes[best].value?i:best,0);
  return envelopes.map((p,i)=>i===top?{label:'$1,000,000',value:1000000}:p);
}
function prepareBonus(s:GameState,index:number){
  s.bonusPuzzleIndex=index;
  s.bonusLetters=[];s.revealed=BASE_BONUS.split('');s.usedLetters=BASE_BONUS.split('');
  s.phase='bonusLetters';s.lastAction='Category chosen. R, S, T, L, N, E are revealed.';
}
function awardBonus(s:GameState,ctx:Context,correct:boolean){
  if(s.bonusWon!==undefined)return;
  s.bonusWon=correct;
  if(correct&&s.bonusEnvelopeIndex!==undefined){
    const p=s.players.find(p=>p.id===s.bonusPlayerId)!;
    const prize=availableBonusEnvelopes(s)[s.bonusEnvelopeIndex];
    p.prizes.push(structuredClone(prize));
    mark(s,ctx,p,prize.value,'Bonus Round prize: '+prize.label);
  }
  s.phase='bonusResult';s.deadline=undefined;s.remaining=undefined;
  s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
}
function expire(s:GameState,ctx:Context){
  if(s.phase==='bonusTimer')awardBonus(s,ctx,false);
  else if(s.phase==='tieTossup'){
    s.windowId=crypto.randomUUID();s.deadline=ctx.now+TOSSUP_MS;
    s.remaining=TOSSUP_MS;s.attempted=[];s.revealed=[];
    s.puzzleStartedAt=ctx.now;
  }else if(s.phase==='speedup'&&s.speedupCanSolve){
    s.lastAction='The three-second buzz window expired. Next contestant.';
    nextPlayer(s);
  }else if(s.phase==='tossup'){
    if(s.roundIndex===0&&s.definition.opening==='frenzy'){
      // Expiry never selects the next puzzle and never reveals its solution.
      s.puzzleTimedOut=true;
      s.lastAction='Time is up for this Frenzy puzzle. The host can reveal the answer or continue.';
      finishRound(s);
    }else advanceTossup(s,ctx);
  }
}
function settleSpin(s:GameState){
  if(s.phase!=='spinning'||!s.spin||s.spinEndsAt===undefined)return;
  const spin=s.spin,p=activePlayers(s).find(p=>p.id===spin.playerId);
  const resolvedAt=s.spinEndsAt;
  s.spinEndsAt=undefined;
  if(!p){s.phase='turn';s.pendingSpin=undefined;return;}
  s.pendingSpin=spin;
  if(spin.wedge.kind==='bankrupt')bankrupt(s,p);
  else if(spin.wedge.kind==='lose'){
    s.lastAction=p.name+' landed on LOSE A TURN.';
    nextPlayer(s);
  }else{
    s.phase='letter';
    s.lastAction=p.name+' landed on '+spin.wedge.label+'.';
  }
  recordAction(s,resolvedAt,'wheelResult',s.lastAction??'Wheel resolved.',undefined,p.id,spin.wedge.label);
}
function settleFinalSpin(s:GameState){
  if(s.phase!=='finalSpinning'||!s.spin||s.spinEndsAt===undefined)return;
  const settledAt=s.spinEndsAt;
  s.spinEndsAt=undefined;
  s.speedupValue=s.spin.wedge.value+1000;
  s.phase='speedup';
  s.speedupCanSolve=false;
  s.pendingSpin=undefined;
  s.deadline=undefined;s.remaining=undefined;
  s.lastAction='FINAL SPIN! Consonants are worth $'+s.speedupValue+' each. Speed-Up begins!';
  recordAction(s,settledAt,'finalSpinResult',s.lastAction,undefined,s.currentPlayerId,s.spin.wedge.label);
}
function settleBonusSpin(s:GameState){
  if(s.phase!=='bonusSpinning'||!s.spin||s.spinEndsAt===undefined)return;
  const settledAt=s.spinEndsAt;
  s.spinEndsAt=undefined;
  s.phase='bonusCategory';
  s.lastAction='Bonus Wheel landed on sealed envelope '+String(s.spin.index+1).padStart(2,'0')+
    '. Choose one of three puzzle categories.';
  recordAction(s,settledAt,'bonusWheelResult',s.lastAction,undefined,s.bonusPlayerId);
}
function revealAutomatically(s:GameState,now:number){
  if(!['tossup','tieTossup'].includes(s.phase)||s.puzzleStartedAt===undefined)return;
  const puzzle=currentPuzzle(s);
  const letters=[...new Set(puzzle.answer.toUpperCase().match(/[A-Z]/g)??[])];
  const hash=(letter:string)=>{
    let value=2166136261;
    for(const char of puzzle.id+letter){value^=char.charCodeAt(0);value=Math.imul(value,16777619);}
    return value>>>0;
  };
  letters.sort((a,b)=>hash(a)-hash(b)||a.localeCompare(b));
  // Pacing depends on distinct letters rather than a fixed reveal interval.
  // The former 2.3s/letter rule revealed short puzzles before time expired.
  // Keep at least one distinct letter hidden while the buzzer remains open.
  const elapsed=Math.max(0,now-s.puzzleStartedAt);
  const target=Math.min(Math.max(0,letters.length-1),
    Math.floor(elapsed*letters.length/TOSSUP_MS));
  // Deterministic state also fixes older over-revealed sessions still buzzing.
  s.revealed=letters.slice(0,target);
}
/** Recover in-progress older sessions that already revealed every Final Spin
 * letter before automatic completion was available. Prefer the last successful
 * letter caller from the private journal over whoever happens to hold the turn. */
function recoverFullyRevealedSpeedup(s:GameState,at:number){
  if(!['speedup','speedupAnswer'].includes(s.phase)||currentRound(s)?.kind!=='final')return;
  const answer=currentPuzzle(s).answer.toUpperCase();
  const letters=[...new Set(answer.match(/[A-Z]/g)??[])];
  if(!letters.length||!letters.every(letter=>s.revealed.includes(letter)))return;
  const last=s.history?.slice().reverse().find(entry=>
    entry.action==='letter'&&entry.stageIndex===s.roundIndex&&
    entry.puzzleIndex===s.puzzleIndex&&!!entry.input&&
    answer.includes(entry.input.toUpperCase())&&
    activePlayers(s).some(p=>p.id===entry.subjectId));
  const winner=activePlayers(s).find(p=>p.id===(last?.subjectId??s.currentPlayerId));
  if(!winner)return;
  const ctx:Context={userId:s.hostId,actionId:'final-spin-recovery',expectedVersion:s.actionVersion,now:at};
  bankPuzzle(s,ctx,winner);
  s.lastAction=winner.name+' completed the fully revealed Final Spin puzzle!';
  recordAction(s,at,'finalSpinAutoComplete',s.lastAction,s.hostId,winner.id);
}
export function reconcile(s:GameState,now:number){
  if(FINISHED.has(s.phase)||s.paused)return;
  const boundary=s.hostSeen+HOST_GRACE_MS,at=Math.min(now,boundary);
  if(s.phase==='spinning'&&s.spinEndsAt!==undefined&&at>=s.spinEndsAt)
    settleSpin(s);
  if(s.phase==='finalSpinning'&&s.spinEndsAt!==undefined&&at>=s.spinEndsAt)
    settleFinalSpin(s);
  if(s.phase==='bonusSpinning'&&s.spinEndsAt!==undefined&&at>=s.spinEndsAt)
    settleBonusSpin(s);
  recoverFullyRevealedSpeedup(s,at);
  if(s.deadline!==undefined&&s.deadline<=at){
    const expiry=s.deadline;
    const ctx:Context={userId:s.hostId,actionId:'timeout:'+s.version+':'+expiry,expectedVersion:s.actionVersion,now:expiry};
    expire(s,ctx);
  }else revealAutomatically(s,at);
  if(now>=boundary){
    s.remaining=s.deadline===undefined?s.remaining:Math.max(0,s.deadline-boundary);
    s.deadline=undefined;s.paused=true;s.pausedAt=boundary;s.pauseReason='Host disconnected';
  }
}
function requireController(s:GameState,ctx:Context){
  ensure(ctx.userId===s.hostId,'Only the host may do this.',403);
  ensure(!!ctx.controller&&ctx.controller===s.controller,'This tab is read-only. Reclaim control first.',409);
}
function mustBeActive(s:GameState,ctx:Context){
  const player=activePlayers(s).find(p=>p.id===s.currentPlayerId);
  ensure(player,'No active player.');
  ensure(ctx.userId===player.id||ctx.userId===s.hostId,'Wait for your turn.',403);
  return player;
}
export function applyCommand(original:GameState,command:Command,ctx:Context):GameState{
  if(original.processed.includes(ctx.actionId))return original;
  const s=structuredClone(original);
  reconcile(s,ctx.now);
  const host=ctx.userId===s.hostId;
  const member=activePlayers(s).some(p=>p.id===ctx.userId);
  ensure(host||member||command.type==='join','You are not part of this game.',403);
  // Host permissions are enforced for every host-issued gameplay command, not just
  // buttons listed as host-only. This prevents stale/read-only host tabs from
  // bypassing controller ownership via spin, letters, or Bonus Round actions.
  if((HOST_COMMANDS.has(command.type)&&command.type!=='claim')||
    (host&&!['claim','heartbeat','join','buzz'].includes(command.type)))requireController(s,ctx);
  if(command.type==='claim'){
    ensure(host&&ctx.pinVerified,'Incorrect host PIN.',403);
  }else if(!['join','heartbeat','buzz'].includes(command.type)){
    ensure(ctx.expectedVersion===original.actionVersion,'The game changed. Refresh and try again.',409);
  }
  if(FINISHED.has(s.phase)&&!['heartbeat','claim'].includes(command.type))
    throw new GameError('This game is finished.',409);
  if(s.paused&&!['claim','heartbeat','continue','end','adjustScore'].includes(command.type))
    throw new GameError('The game is paused.',409);
  const phase=(...valid:GameState['phase'][])=>ensure(valid.includes(s.phase),'This action is not available right now.',409);
  switch(command.type){
    case 'heartbeat':
      if(host)ensure(ctx.controller===s.controller,'Another tab controls this game.',409);
      if(host)s.hostSeen=ctx.now;
      else {const p=s.players.find(p=>p.id===ctx.userId);if(p)p.lastSeen=ctx.now;}
      break;
    case 'join':{
      ensure(ctx.userId!==s.hostId,'Use a separate player browser or device.',403);
      const existing=s.players.find(p=>p.id===ctx.userId);
      if(existing){ensure(!existing.removed,'Your seat was removed.',403);existing.lastSeen=ctx.now;break;}
      phase('lobby');ensure(!s.locked,'The lobby is locked.');
      ensure(activePlayers(s).length<MAX_PLAYERS,'This game has reached the five-contestant limit.');
      ensure(!activePlayers(s).some(p=>p.name.toLowerCase()===command.name.trim().toLowerCase()),'That name is taken.');
      const used=activePlayers(s).map(p=>p.seat);
      const seat=Array.from({length:MAX_PLAYERS},(_,i)=>i).find(n=>!used.includes(n))!;
      s.players.push({id:ctx.userId,name:command.name.trim(),seat,banked:0,roundMoney:0,prizes:[],pendingPrizes:[],
        wildCard:false,millionWedge:false,removed:false,lastSeen:ctx.now});
      break;
    }
    case 'claim':
      ensure(!FINISHED.has(s.phase),'Game already ended.');
      if(s.deadline!==undefined)s.remaining=Math.max(0,s.deadline-ctx.now);
      if(!s.paused)s.pausedAt=ctx.now;
      s.paused=true;s.pauseReason='Ready to resume';s.deadline=undefined;
      s.controller=command.controller;s.hostSeen=ctx.now;
      break;
    case 'pause':
      if(!s.paused){if(s.deadline!==undefined)s.remaining=Math.max(0,s.deadline-ctx.now);
        s.deadline=undefined;s.paused=true;s.pausedAt=ctx.now;s.pauseReason='Paused by host';}
      break;
    case 'continue':
      ensure(s.paused,'Game already running.');
      if(s.pausedAt!==undefined&&s.puzzleStartedAt!==undefined)
        s.puzzleStartedAt+=Math.max(0,ctx.now-s.pausedAt);
      s.pausedAt=undefined;
      s.paused=false;s.pauseReason=undefined;s.hostSeen=ctx.now;
      if(['tossup','tieTossup','bonusTimer'].includes(s.phase))
        s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
      if(s.phase==='speedup'&&s.speedupCanSolve)
        s.deadline=ctx.now+(s.remaining??SPEEDUP_SOLVE_MS);
      break;
    case 'lockLobby': phase('lobby');s.locked=command.locked;break;
    case 'remove':{
      phase('lobby');const p=s.players.find(p=>p.id===command.playerId);
      ensure(p,'Player not found.');p.removed=true;break;
    }
    case 'start':
      phase('lobby');ensure(activePlayers(s).length>=MIN_PLAYERS,'At least one contestant must join before starting.');
      s.locked=true;s.roundIndex=0;s.puzzleIndex=0;
      const players=activePlayers(s);
      s.roundStarterId=players[random(ctx,players.length)].id;setRound(s,ctx);
      break;
    case 'buzz':{
      phase('tossup','tieTossup');
      ensure(command.windowId===s.windowId,'This buzzer window has closed.',409);
      ensure(s.deadline!==undefined&&ctx.now<s.deadline,'Buzzer time expired.',409);
      const p=activePlayers(s).find(p=>p.id===ctx.userId);
      ensure(p,'Only contestants can buzz.',403);
      ensure(!s.attempted.includes(p.id),'You have already attempted this puzzle.',409);
      if(s.phase==='tieTossup')ensure(s.tieEligible?.includes(p.id),'Only tied leaders may buzz.',403);
      s.remaining=s.deadline-ctx.now;s.deadline=undefined;s.respondent=p.id;s.answerStartedAt=ctx.now;
      s.phase=s.phase==='tieTossup'?'tieAnswer':'tossupAnswer';
      s.lastAction=p.name+' buzzed first!';
      break;
    }
    case 'judgeBuzz':{
      phase('tossupAnswer','tieAnswer');
      ensure(s.respondent,'No contestant is answering.');
      checkpoint(s);
      const p=activePlayers(s).find(p=>p.id===s.respondent)!;
      if(!command.correct&&s.answerStartedAt!==undefined&&s.puzzleStartedAt!==undefined)
        s.puzzleStartedAt+=Math.max(0,ctx.now-s.answerStartedAt);
      s.answerStartedAt=undefined;
      if(command.correct){
        completedTossup(s,ctx,p);
      }else if(s.phase==='tieAnswer'){
        s.attempted.push(p.id);s.respondent=undefined;
        const available=s.tieEligible?.some(id=>!s.attempted.includes(id));
        s.phase='tieTossup';s.windowId=crypto.randomUUID();
        if(!available){
          s.attempted=[];s.revealed=[];
          s.puzzleStartedAt=ctx.now;s.remaining=TOSSUP_MS;
        }
        s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
      }else if(s.roundIndex===0&&s.definition.opening==='frenzy'){
        s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
        s.lastAction=p.name+' answered incorrectly. The host can advance to the next puzzle.';
        finishRound(s);
      }else{
        s.attempted.push(p.id);s.respondent=undefined;
        if(activePlayers(s).every(player=>s.attempted.includes(player.id)))advanceTossup(s,ctx);
        else{
          s.phase='tossup';s.windowId=crypto.randomUUID();
          s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
        }
      }
      break;
    }
    case 'revealTimedOut':{
      phase('roundResult');
      ensure(s.puzzleTimedOut===true,'There is no concealed timed-out solution to reveal.',409);
      s.puzzleTimedOut=false;
      s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
      s.lastAction='The host revealed the answer to puzzle '+(s.puzzleIndex+1)+'.';
      break;
    }
    case 'nextRound':{
      phase('roundResult');
      if(['triple','tossup'].includes(currentRound(s)?.kind??'')&&
        s.puzzleIndex+1<currentRound(s)!.puzzles.length){
        advanceTossup(s,ctx);
      }else if(s.roundIndex===s.definition.rounds.length-1){
        const players=activePlayers(s),high=Math.max(...players.map(total)),leaders=players.filter(p=>total(p)===high);
        if(leaders.length>1){
          startTiebreaker(s,ctx,leaders);
        }else{resetPuzzle(s);s.bonusPlayerId=leaders[0].id;s.phase='bonusSpin';}
      }else{
        s.roundIndex++;s.puzzleIndex=0;setRound(s,ctx);
      }
      break;
    }
    case 'spin':{
      phase('turn');const p=mustBeActive(s,ctx);
      s.wildCardValue=undefined;
      const choices=wheelForRound(currentRound(s)!.kind,s.mysteryReveals);
      const index=random(ctx,choices.length),wedge=choices[index];
      const spin:Spin={id:crypto.randomUUID(),index,wedge,playerId:p.id,sequence:(s.spin?.sequence??0)+1};
      spin.startedAt=ctx.now;
      s.spin=spin;s.pendingSpin=undefined;
      s.spinEndsAt=ctx.now+SPIN_DURATION_MS;
      s.phase='spinning';
      s.lastAction=p.name+' is spinning the wheel…';
      // The server resolves BANKRUPT, LOSE A TURN, or a cash amount only
      // after the wheel animation period has elapsed on the server clock.
      break;
    }
    case 'buyVowel':{
      phase('turn');const p=mustBeActive(s,ctx);
      s.wildCardValue=undefined;
      ensure(p.roundMoney>=250,'You need $250 in unbanked round money.');
      ensure('AEIOU'.split('').some(l=>!s.usedLetters.includes(l)),'All vowels have been used.');
      p.roundMoney-=250;s.pendingSpin=undefined;s.phase='letter';
      s.lastAction=p.name+' bought a vowel for $250.';
      break;
    }
    case 'useWildCard':{
      phase('turn');const p=mustBeActive(s,ctx);
      ensure(p.wildCard&&s.wildCardValue!==undefined&&s.wildCardValue>0,
        'Wild Card requires a preceding successful cash-wedge consonant.',409);
      p.wildCard=false;s.phase='wildLetter';
      s.lastAction=p.name+' spent a Wild Card for one extra consonant at $'+s.wildCardValue+' per occurrence.';
      break;
    }
    case 'letter':{
      phase('letter','wildLetter','express','speedup');const p=mustBeActive(s,ctx);
      const letter=command.letter.toUpperCase(),vowel=VOWELS.includes(letter);
      const usingWild=s.phase==='wildLetter';
      const spin=s.pendingSpin;
      const cash=spin?.wedge.value??(usingWild?s.wildCardValue??0:0);
      if(usingWild)ensure(!vowel,'Wild Card allows a consonant only.',409);
      if(s.phase==='letter'){
        ensure(spin?.wedge.kind==='free'||(spin? !vowel:vowel),
          spin?'Call a consonant for this wedge.':'Choose a vowel.');
      }
      if(s.phase==='express'&&vowel)ensure(p.roundMoney>=250,'Not enough money for an Express vowel.');
      if(s.phase==='speedup')ensure(!s.speedupCanSolve,'Solve or pass before calling another letter.');
      // Save the full puzzle/score/turn state for the latest letter only.
      checkpoint(s);
      s.lastLetterActionVersion=original.actionVersion+1;
      const repeated=s.usedLetters.includes(letter);
      if(!repeated)s.usedLetters.push(letter);
      if(s.phase==='express'&&vowel)p.roundMoney-=250;
      const count=repeated?0:(currentPuzzle(s).answer.toUpperCase().match(new RegExp(letter,'g'))??[]).length;
      if(!count){
        s.lastAction=p.name+' called '+letter+' — no matches.';
        if(s.phase==='express')bankrupt(s,p);
        else if(s.phase==='letter'&&spin?.wedge.kind==='free'){s.phase='turn';s.pendingSpin=undefined;}
        else nextPlayer(s);
        break;
      }
      s.revealed.push(letter);
      if(usingWild){
        const amount=cash*count;
        p.roundMoney+=amount;s.wildCardValue=undefined;s.phase='turn';
        s.lastAction=p.name+' earned $'+amount+' using the Wild Card extra consonant.';
        break;
      }
      if(s.phase==='speedup'){
        if(!vowel)p.roundMoney+=(s.speedupValue??0)*count;
        // A fully revealed board completes the round immediately. Otherwise,
        // the contestant has 3 seconds to *buzz*, not to finish typing.
        const answerLetters=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
        if(answerLetters.every(c=>s.revealed.includes(c))){
          bankPuzzle(s,ctx,p);
          s.lastAction=p.name+' revealed every letter in the Final Spin puzzle and completed the round!';
          break;
        }
        s.speedupCanSolve=true;
        s.windowId=crypto.randomUUID();
        s.deadline=ctx.now+SPEEDUP_SOLVE_MS;s.remaining=SPEEDUP_SOLVE_MS;
        s.lastAction=letter+' appears '+count+' time(s). Three seconds to buzz for a solution!';
        break;
      }
      if(!vowel){
        const amount=(s.phase==='express'?1000:cash)*count;
        p.roundMoney+=amount;
        s.lastAction=p.name+' earned $'+amount+' with '+letter+'.';
      }else s.lastAction=letter+' revealed '+count+' time(s).';
      if(s.phase==='express'){
        // A player who reveals every distinct letter during Express has already
        // completed the puzzle; don't force a redundant typed solution.
        const answerLetters=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
        if(answerLetters.every(c=>s.revealed.includes(c))){
          checkpoint(s);
          bankPuzzle(s,ctx,p);
          s.lastAction=p.name+' revealed the entire Express puzzle and won the round automatically!';
        }
        break;
      }
      if(spin?.wedge.kind==='wild'){
        p.wildCard=true;s.lastAction+=' Wild Card collected for an extra consonant!';
      }
      if(spin?.wedge.kind==='million'){
        p.pendingMillionWedge=true;
        s.lastAction+=' Million Dollar Wedge collected—solve this puzzle to secure it!';
      }
      s.wildCardValue=spin?.wedge.kind==='cash'&&!vowel&&p.wildCard?cash:undefined;
      if(spin?.wedge.kind==='mystery'){
        s.mysteryCash=cash*count;s.phase='mysteryChoice';break;
      }
      if(spin?.wedge.kind==='express'){s.phase='expressChoice';break;}
      s.phase='turn';s.pendingSpin=undefined;
      break;
    }
    case 'mystery':{
      phase('mysteryChoice');const p=mustBeActive(s,ctx);
      const index=s.pendingSpin?.index;
      ensure(index!==undefined&&MYSTERY_INDICES.includes(index as typeof MYSTERY_INDICES[number])&&
        s.pendingSpin?.wedge.kind==='mystery','No unrevealed Mystery Wedge is active.',409);
      if(command.reveal){
        // Legacy live rooms without preassigned outcomes get a one-time choice;
        // new games always choose the winning wedge before Mystery Round begins.
        if(s.mysteryPrizeIndex===undefined)
          s.mysteryPrizeIndex=MYSTERY_INDICES[random(ctx,MYSTERY_INDICES.length)];
        const outcome=index===s.mysteryPrizeIndex?'prize':'bankrupt';
        s.mysteryReveals=[...(s.mysteryReveals??[]),{index,outcome}];
        p.roundMoney-=s.mysteryCash??0;
        if(outcome==='bankrupt'){
          bankrupt(s,p);
          s.lastAction='Mystery Wedge '+(index===5?'A':'B')+' revealed BANKRUPT!';
        }else{
          p.pendingPrizes.push({label:'Mystery $10,000',value:10000});
          s.lastAction=p.name+' revealed the $10,000 Mystery prize!';
          s.phase='turn';s.pendingSpin=undefined;
        }
      }else{
        s.lastAction=p.name+' kept the Mystery cash.';
        s.phase='turn';s.pendingSpin=undefined;
      }
      s.mysteryCash=undefined;
      break;
    }
    case 'express':{
      phase('expressChoice');mustBeActive(s,ctx);
      s.phase=command.accept?'express':'turn';s.pendingSpin=undefined;
      s.lastAction=command.accept?'Express mode! An incorrect guess means Bankrupt.':'Express declined.';
      break;
    }
    case 'speedupBuzz':{
      phase('speedup');
      const p=mustBeActive(s,ctx);
      ensure(s.speedupCanSolve&&!!s.deadline&&ctx.now<s.deadline,
        'The three-second buzz window has expired.',409);
      ensure(!!s.windowId&&command.windowId===s.windowId,
        'This buzz window is no longer active.',409);
      s.phase='speedupAnswer';
      s.respondent=p.id;
      s.windowId=undefined;
      s.deadline=undefined;s.remaining=undefined;
      s.lastAction=p.name+' buzzed in during Final Spin! Take your time entering the full answer.';
      break;
    }
    case 'solve':{
      phase('turn','express','speedupAnswer','letter');
      const p=mustBeActive(s,ctx);
      if(s.phase==='speedupAnswer')ensure(s.speedupCanSolve,'Buzz in before submitting a Final Spin solution.',409);
      if(s.phase==='letter')ensure(s.pendingSpin?.wedge.kind==='free','Choose a letter first.');
      checkpoint(s);s.wildCardValue=undefined;
      if(normalize(command.text)===normalize(currentPuzzle(s).answer)){bankPuzzle(s,ctx,p);}
      else{
        s.lastAction=p.name+' attempted an incorrect solution.';
        if(s.phase==='express')bankrupt(s,p);
        else if(s.phase==='letter'&&s.pendingSpin?.wedge.kind==='free'){
          s.phase='turn';s.pendingSpin=undefined;
        }else nextPlayer(s);
      }
      break;
    }
    case 'hostSolve':{
      phase('turn','letter','express','speedupAnswer');
      if(s.phase==='speedupAnswer')ensure(s.speedupCanSolve,
        'The current contestant has not buzzed in.',409);
      const p=activePlayers(s).find(p=>p.id===command.playerId);
      ensure(p&&p.id===s.currentPlayerId,'Only the active contestant may solve.');
      checkpoint(s);bankPuzzle(s,ctx,p);
      break;
    }
    case 'speedUp':{
      phase('turn');ensure(currentRound(s)?.kind==='final','Speed-Up belongs to Round 4.');
      const wheel=wheelForRound('final');
      const available=wheel.map((w,index)=>({w,index})).filter(({w})=>w.kind==='cash');
      const selected=available[random(ctx,available.length)];
      s.wildCardValue=undefined;s.speedupValue=undefined;
      s.spin={id:crypto.randomUUID(),index:selected.index,wedge:selected.w,
        playerId:s.currentPlayerId!,sequence:(s.spin?.sequence??0)+1,startedAt:ctx.now};
      s.spinEndsAt=ctx.now+SPIN_DURATION_MS;
      s.pendingSpin=undefined;s.phase='finalSpinning';s.speedupCanSolve=false;
      s.deadline=undefined;s.remaining=undefined;
      s.lastAction='FINAL SPIN! The wheel is spinning. Speed-Up begins when it stops!';
      break;
    }
    case 'adjustScore':{
      ensure(Number.isSafeInteger(command.amount)&&command.amount!==0&&Math.abs(command.amount)<=1000000,
        'Enter a nonzero whole-dollar correction up to $1,000,000.');
      ensure(command.reason.trim().length>=3&&command.reason.length<=160,
        'Enter a short reason for the score correction.');
      s.undo=undefined;
      ensure(s.phase!=='lobby','Start the game before correcting scores.',409);
      const p=activePlayers(s).find(p=>p.id===command.playerId);
      ensure(p,'Contestant not found.',404);
      if(command.balance==='roundMoney')
        ensure(['turn','spinning','letter','wildLetter','mysteryChoice',
          'expressChoice','express','finalSpinning','speedup','speedupAnswer'].includes(s.phase),
          'Round earnings can only be corrected during a wheel puzzle.',409);
      const current=p[command.balance];
      ensure(Number.isSafeInteger(current+command.amount)&&current+command.amount>=0,
        'A score correction cannot make a balance negative.');
      p[command.balance]=current+command.amount;
      const part=command.balance==='banked'?'secured cash':'current-round earnings';
      mark(s,ctx,p,command.amount,'Host correction to '+part+': '+command.reason);
      s.lastAction='Host adjusted '+p.name+'\'s '+part+' by '+
        (command.amount>0?'+':'')+'$'+command.amount+'. Reason: '+command.reason;
      break;
    }
    case 'undoLetter':{
      ensure(s.lastLetterActionVersion===original.actionVersion&&!!s.undo,
        'Only the most recent letter call can be reversed, before another action.',409);
      const previous=s.undo;
      ensure(previous.roundIndex===s.roundIndex&&previous.puzzleIndex===s.puzzleIndex,
        'Cannot reverse a letter from another puzzle.',409);
      const journal=s.history??[];
      const seen=new Set(s.processed);
      for(const key of Object.keys(s))Reflect.deleteProperty(s,key);
      Object.assign(s,structuredClone(previous));
      // Keep the original wrong call in the private audit trail, then record its reversal.
      s.history=journal;
      s.processed=[...new Set([...s.processed,...seen])];
      s.hostSeen=original.hostSeen;
      s.undo=undefined;s.lastLetterActionVersion=undefined;
      s.lastAction='Host reversed the most recent letter call. The contestant may choose again.';
      break;
    }
    case 'pass':{
      phase('speedup','speedupAnswer');mustBeActive(s,ctx);
      ensure(s.speedupCanSolve,'Call a correct letter before passing.',409);
      nextPlayer(s);break;
    }
    case 'chooseBonus':{
      phase('bonusCategory');
      ensure(ctx.userId===s.bonusPlayerId||host,'Only the finalist can choose the bonus category.',403);
      prepareBonus(s,command.index);break;
    }
    case 'spinBonus':{
      phase('bonusSpin');
      ensure(ctx.userId===s.bonusPlayerId||host,'Only the finalist can spin the bonus wheel.',403);
      const index=random(ctx,24);
      const wheel=bonusWheelWedges();
      s.spin={id:crypto.randomUUID(),index,wedge:wheel[index],
        playerId:s.bonusPlayerId!,sequence:(s.spin?.sequence??0)+1,startedAt:ctx.now};
      // The exact selected slot resolves to an actual configured envelope.
      // Never pick a second, unrelated random prize after the wheel stops.
      s.bonusEnvelopeIndex=bonusEnvelopeForSlot(index,availableBonusEnvelopes(s).length);
      s.revealed=[];s.usedLetters=[];
      s.phase='bonusSpinning';s.spinEndsAt=ctx.now+SPIN_DURATION_MS;
      s.lastAction='Bonus Wheel spinning! The sealed envelope is being selected.';
      break;
    }
    case 'bonusLetter':{
      phase('bonusLetters');
      ensure(ctx.userId===s.bonusPlayerId||host,'Only the finalist can select letters.',403);
      const letter=command.letter.toUpperCase();
      ensure(!BASE_BONUS.includes(letter)&&!s.bonusLetters.includes(letter),'Letter already included.');
      const p=activePlayers(s).find(p=>p.id===s.bonusPlayerId)!;
      const consonants=s.bonusLetters.filter(l=>!VOWELS.includes(l)).length;
      const vowels=s.bonusLetters.filter(l=>VOWELS.includes(l)).length;
      ensure(VOWELS.includes(letter)?vowels<1:consonants<(p.wildCard?4:3),'You have selected all allowed letters.');
      s.bonusLetters.push(letter);s.revealed.push(letter);s.usedLetters.push(letter);
      break;
    }
    case 'startBonus':{
      phase('bonusLetters');
      const p=activePlayers(s).find(p=>p.id===s.bonusPlayerId)!;
      ensure(s.bonusLetters.filter(l=>VOWELS.includes(l)).length===1,'Choose one vowel.');
      ensure(s.bonusLetters.filter(l=>!VOWELS.includes(l)).length===(p.wildCard?4:3),
        'Choose '+(p.wildCard?4:3)+' consonants.');
      s.phase='bonusTimer';s.deadline=ctx.now+10000;s.remaining=10000;break;
    }
    case 'bonusSolve':{
      phase('bonusTimer');
      ensure(ctx.userId===s.bonusPlayerId,'Only the finalist can submit a solution.',403);
      ensure(s.deadline!==undefined&&ctx.now<s.deadline,'Bonus time expired.',409);
      checkpoint(s);
      awardBonus(s,ctx,normalize(command.text)===normalize(currentPuzzle(s).answer));
      break;
    }
    case 'bonusJudge':{
      phase('bonusTimer');ensure(s.deadline!==undefined&&ctx.now<s.deadline,'Bonus time expired.',409);
      checkpoint(s);
      awardBonus(s,ctx,command.correct);break;
    }
    case 'finish':phase('bonusResult');s.phase='finished';s.locked=true;break;
    case 'undo':{
      ensure(s.lastLetterActionVersion!==original.actionVersion,'Use Undo Last Letter for a letter correction.',409);
      ensure(s.undo,'No judgment to undo.');
      const prev=s.undo;
      ensure(prev.roundIndex===s.roundIndex&&prev.puzzleIndex===s.puzzleIndex,'Cannot undo another puzzle.');
      const recorded=new Set(s.processed);
      // Replace the aggregate completely: Object.assign alone retains optional fields
      // added by the action being undone (for example bonusWon or a newly awarded prize).
      for(const key of Object.keys(s))Reflect.deleteProperty(s,key);
      Object.assign(s,structuredClone(prev));
      s.processed=[...new Set([...s.processed,...recorded])];
      s.undo=undefined;s.paused=true;s.pauseReason='Judgment undone — review and continue';
      s.deadline=undefined;s.remaining=prev.remaining;
      s.lastAction='Last judgment reversed.';
      break;
    }
    case 'end':
      // Preserve a separate cancellation state: a lobby without a started game
      // should not announce a winner or show an empty results scoreboard.
      s.closedInLobby=s.phase==='lobby';
      s.lastAction=s.closedInLobby?'Lobby closed by the host.':'The host ended the game.';
      s.phase='ended';s.locked=true;s.paused=false;s.deadline=undefined;s.windowId=undefined;break;
  }
  // Once another action occurs, do not roll back an earlier letter or turn.
  if(!['heartbeat','letter','undoLetter'].includes(command.type)&&
    original.lastLetterActionVersion===original.actionVersion){
    if(!['solve','hostSolve','judgeBuzz','bonusSolve','bonusJudge'].includes(command.type))
      s.undo=undefined;
    s.lastLetterActionVersion=undefined;
  }
  if(command.type!=='heartbeat'){
    const subject=command.type==='adjustScore'?command.playerId:
      original.respondent??original.currentPlayerId;
    const input=command.type==='letter'||command.type==='bonusLetter'?command.letter:
      command.type==='solve'||command.type==='bonusSolve'?command.text:
      command.type==='judgeBuzz'||command.type==='bonusJudge'?command.correct?'Correct':'Incorrect':undefined;
    const description=s.lastAction!==original.lastAction?s.lastAction??command.type:
      command.type==='nextRound'?'Advanced to '+(currentRound(s)?.title??s.phase)+'.':
      command.type==='start'?'Started the game.':
      command.type==='pause'?'Show paused.':
      command.type==='continue'?'Show resumed.':
      command.type==='join'?'A contestant joined.':
      command.type==='finish'?'Announced the champion.':
      command.type;
    recordAction(s,ctx.now,command.type,description,ctx.userId,subject,input);
    s.processed.push(ctx.actionId);
    if(s.processed.length>600)s.processed=s.processed.slice(-400);
    s.actionVersion=original.actionVersion+1;
  }
  s.updatedAt=ctx.now;s.version=original.version+1;
  return s;
}
export function viewSession(s:GameState,userId:string,now:number,controller?:string,audience=false):SessionView{
  const host=userId===s.hostId&&!audience;
  ensure(host||audience||activePlayers(s).some(p=>p.id===userId),'You do not have access to this session.',403);
  const round=currentRound(s),puzzle=currentPuzzle(s);
  const showAnswer=host||((s.phase==='roundResult'&&!s.puzzleTimedOut)||
    s.phase==='bonusResult'||s.phase==='finished'||s.phase==='ended');
  const tiles=puzzle.answer.toUpperCase().split('').map(ch=>!/[A-Z]/.test(ch)||s.revealed.includes(ch)?ch:'');
  const extra=s.phase.startsWith('bonus')||s.phase==='finished';
  return {
    id:s.id,gameId:s.gameId,title:s.title,joinCode:s.joinCode,phase:s.phase,
    closedInLobby:s.closedInLobby,
    version:s.version,actionVersion:s.actionVersion,
    roundIndex:s.roundIndex,totalRounds:s.definition.rounds.length,
    roundTitle:extra?'Bonus Round':(s.phase==='tieTossup'||s.phase==='tieAnswer'?'Sudden-Death Toss-Up':round?.title??''),
    roundKind:extra?'bonus':(s.phase==='tieTossup'||s.phase==='tieAnswer'?'tie':round?.kind??'regular'),
    puzzleIndex:s.puzzleIndex,puzzlesInRound:round?.puzzles.length??1,
    puzzle:{category:puzzle.category,tiles,answer:showAnswer?puzzle.answer:undefined,hint:host?puzzle.hint:undefined},
    players:activePlayers(s).map(p=>({...p,pendingPrizes:p.pendingPrizes.map(x=>({...x}))})),
    currentPlayerId:s.currentPlayerId,respondent:s.respondent,windowId:s.windowId,
    attempted:s.attempted,revealed:s.revealed,usedLetters:s.usedLetters,
    spin:s.spin,pendingSpin:s.pendingSpin,lastAction:s.lastAction,puzzleTimedOut:s.puzzleTimedOut,
    mysteryReveals:s.mysteryReveals?.map(entry=>({...entry})),
    deadline:s.deadline,remaining:s.remaining,spinEndsAt:s.spinEndsAt,frenzyRemaining:s.frenzyRemaining,speedupValue:s.speedupValue,
    speedupCanSolve:s.speedupCanSolve,wildCardValue:s.wildCardValue,
    bonusPlayerId:s.bonusPlayerId,bonusPuzzleIndex:s.bonusPuzzleIndex,
    bonusCategories:extra?s.definition.bonus.puzzles.map(p=>p.category):undefined,
    bonusLetters:s.bonusLetters,
    bonusPrize:s.bonusEnvelopeIndex!==undefined&&['bonusResult','finished','ended'].includes(s.phase)
      ?availableBonusEnvelopes(s)[s.bonusEnvelopeIndex]:undefined,
    bonusWon:s.bonusWon,tripleWinners:s.tripleWinners,tieEligible:s.tieEligible,
    events:s.events,paused:s.paused,pauseReason:s.pauseReason,locked:s.locked,
    controllerOwned:host&&controller===s.controller,hostConnected:now-s.hostSeen<HOST_GRACE_MS,
    serverNow:now,canUndo:host&&!!s.undo&&s.lastLetterActionVersion!==s.actionVersion,
    canUndoLetter:host&&!!s.undo&&s.lastLetterActionVersion===s.actionVersion,createdAt:s.createdAt
  };
}
