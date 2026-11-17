import type { Command } from './schema';
import type { Context, GameDefinition, GameRound, GameState, Player, Prize, Puzzle, SessionView, Spin } from './types';
import { playable } from './schema';
import { secureIndex, wheelForRound } from './wheel';

export const HOST_GRACE_MS = 30000;
export const TOSSUP_MS = 30000;
const VOWELS = 'AEIOU';
const BASE_BONUS = 'RSTLNE';
const HOST_COMMANDS = new Set([
  'claim','pause','continue','lockLobby','remove','start','nextRound','revealLetter',
  'judgeBuzz','hostSolve','speedUp','bonusJudge','finish','undo','end'
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
  if(['bonusCategory','bonusLetters','bonusTimer','bonusResult','finished'].includes(s.phase)&&s.bonusPuzzleIndex!==undefined)
    return s.definition.bonus.puzzles[s.bonusPuzzleIndex];
  return currentRound(s)?.puzzles[s.puzzleIndex]??s.definition.tiebreaker;
}
export function newSession(definition:GameDefinition,gameId:string,hostId:string,joinCode:string,now:number,controller?:string):GameState{
  playable(definition);
  return {
    id:crypto.randomUUID(),gameId,hostId,joinCode,title:definition.title,definition:structuredClone(definition),
    version:0,actionVersion:0,hostSeen:now,controller,paused:false,locked:false,phase:'lobby',
    roundIndex:0,puzzleIndex:0,players:[],attempted:[],revealed:[],usedLetters:[],bonusLetters:[],
    tripleWinners:[],events:[],processed:[],createdAt:now,updatedAt:now
  };
}
function mark(s:GameState,ctx:Context,p:Player,delta:number,reason:string){
  ensure(Number.isSafeInteger(delta)&&Math.abs(delta)<10000000,'Invalid score change.');
  s.events.push({id:ctx.actionId,playerId:p.id,delta,reason,round:s.roundIndex,at:ctx.now});
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
  s.pendingSpin=undefined;s.speedupCanSolve=false;s.spin=undefined;s.undo=undefined;
}
function nextPlayer(s:GameState){
  const players=activePlayers(s);
  ensure(players.length>0,'No active contestants.');
  const index=players.findIndex(p=>p.id===s.currentPlayerId);
  s.currentPlayerId=players[(index+1)%players.length].id;
  s.phase=s.speedupValue!==undefined?'speedup':'turn';
  s.pendingSpin=undefined;s.speedupCanSolve=false;
}
function finishRound(s:GameState){
  s.phase='roundResult';s.deadline=undefined;s.remaining=undefined;
  s.respondent=undefined;s.windowId=undefined;s.pendingSpin=undefined;s.undo=undefined;
  s.speedupCanSolve=false;
}
function setRound(s:GameState,ctx:Context){
  resetPuzzle(s);s.deadline=undefined;s.remaining=undefined;s.speedupValue=undefined;
  const players=activePlayers(s);
  ensure(players.length>0,'No contestants remain.');
  for(const p of players){p.roundMoney=0;p.pendingPrizes=[];}
  const round=currentRound(s)!;
  if(round.kind==='tossup'||round.kind==='triple'){
    s.phase='tossup';s.windowId=crypto.randomUUID();s.deadline=ctx.now+TOSSUP_MS;
    s.remaining=TOSSUP_MS;
  }else{
    s.phase='turn';s.currentPlayerId=players.some(p=>p.id===s.roundStarterId)
      ? s.roundStarterId : players[random(ctx,players.length)].id;
  }
}
function advanceTossup(s:GameState,ctx:Context){
  const round=currentRound(s);
  if(round&&s.puzzleIndex+1<round.puzzles.length){
    const oldDeadline=s.deadline;
    s.puzzleIndex++;resetPuzzle(s);
    s.phase='tossup';s.windowId=crypto.randomUUID();
    const frenzy=s.roundIndex===0&&s.definition.opening==='frenzy';
    s.deadline=frenzy&&oldDeadline&&oldDeadline>ctx.now?oldDeadline:ctx.now+TOSSUP_MS;
    s.remaining=Math.max(0,s.deadline-ctx.now);
  }else finishRound(s);
}
function completedTossup(s:GameState,ctx:Context,player:Player){
  const round=currentRound(s);
  if(s.phase==='tieAnswer'){
    s.bonusPlayerId=player.id;s.tieEligible=undefined;s.phase='bonusCategory';
    s.deadline=undefined;s.windowId=undefined;s.respondent=undefined;
    return;
  }
  const value=round?.kind==='triple'?2000:s.definition.opening==='traditional'
    ?(s.puzzleIndex===0?1000:2000):1000;
  addBanked(s,player,value,ctx,'Solved '+(round?.title??'Toss-Up'));
  s.roundStarterId=player.id;
  if(round?.kind==='triple'){
    s.tripleWinners.push(player.id);
    if(s.puzzleIndex===2 && s.tripleWinners.length===3 &&
      s.tripleWinners.every(id=>id===player.id))
      addBanked(s,player,4000,ctx,'Triple Toss-Up sweep bonus');
  }
  advanceTossup(s,ctx);
}
function bankrupt(s:GameState,p:Player){
  p.roundMoney=0;p.pendingPrizes=[];
  s.lastAction=p.name+' hit BANKRUPT';
  nextPlayer(s);
}
function bankPuzzle(s:GameState,ctx:Context,p:Player){
  const current=currentRound(s);
  addBanked(s,p,p.roundMoney,ctx,'Solved '+(current?.title??'round'));
  p.prizes.push(...p.pendingPrizes);
  if(current?.kind==='prize'&&current.prize)p.prizes.push(structuredClone(current.prize));
  s.roundStarterId=p.id;
  for(const other of activePlayers(s)){other.roundMoney=0;other.pendingPrizes=[];}
  s.revealed=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])];
  s.lastAction=p.name+' solved the puzzle!';
  finishRound(s);
}
function startBonus(s:GameState){
  const players=activePlayers(s), high=Math.max(...players.map(total));
  const leaders=players.filter(p=>total(p)===high);
  s.tieEligible=leaders.length>1?leaders.map(p=>p.id):undefined;
  if(leaders.length>1){
    resetPuzzle(s);s.phase='tieTossup';s.windowId=crypto.randomUUID();
    s.deadline=Date.now()+TOSSUP_MS;
  }else{
    s.bonusPlayerId=leaders[0].id;s.phase='bonusCategory';
  }
}
function prepareBonus(s:GameState,ctx:Context,index:number){
  s.bonusPuzzleIndex=index;
  s.bonusEnvelopeIndex=random(ctx,s.definition.bonus.envelopes.length);
  s.bonusLetters=[];s.revealed=BASE_BONUS.split('');s.usedLetters=BASE_BONUS.split('');
  s.phase='bonusLetters';s.lastAction='The bonus envelope is sealed.';
}
function awardBonus(s:GameState,ctx:Context,correct:boolean){
  if(s.bonusWon!==undefined)return;
  s.bonusWon=correct;
  if(correct&&s.bonusEnvelopeIndex!==undefined){
    const p=s.players.find(p=>p.id===s.bonusPlayerId)!;
    const prize=s.definition.bonus.envelopes[s.bonusEnvelopeIndex];
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
  }else if(s.phase==='tossup')advanceTossup(s,ctx);
}
export function reconcile(s:GameState,now:number){
  if(FINISHED.has(s.phase)||s.paused)return;
  const boundary=s.hostSeen+HOST_GRACE_MS,at=Math.min(now,boundary);
  if(s.deadline!==undefined&&s.deadline<=at){
    const expiry=s.deadline;
    const ctx:Context={userId:s.hostId,actionId:'timeout:'+s.version+':'+expiry,expectedVersion:s.actionVersion,now:expiry};
    expire(s,ctx);
  }
  if(now>=boundary){
    s.remaining=s.deadline===undefined?s.remaining:Math.max(0,s.deadline-boundary);
    s.deadline=undefined;s.paused=true;s.pauseReason='Host disconnected';
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
  if(HOST_COMMANDS.has(command.type)&&command.type!=='claim')requireController(s,ctx);
  if(command.type==='claim'){
    ensure(host&&ctx.pinVerified,'Incorrect host PIN.',403);
  }else if(!['join','heartbeat','buzz'].includes(command.type)){
    ensure(ctx.expectedVersion===original.actionVersion,'The game changed. Refresh and try again.',409);
  }
  if(FINISHED.has(s.phase)&&!['heartbeat','claim'].includes(command.type))
    throw new GameError('This game is finished.',409);
  if(s.paused&&!['claim','heartbeat','continue','end'].includes(command.type))
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
      ensure(activePlayers(s).length<3,'This traditional game already has three contestants.');
      ensure(!activePlayers(s).some(p=>p.name.toLowerCase()===command.name.trim().toLowerCase()),'That name is taken.');
      const used=activePlayers(s).map(p=>p.seat);
      const seat=[0,1,2].find(n=>!used.includes(n))!;
      s.players.push({id:ctx.userId,name:command.name.trim(),seat,banked:0,roundMoney:0,prizes:[],pendingPrizes:[],
        wildCard:false,millionWedge:false,removed:false,lastSeen:ctx.now});
      break;
    }
    case 'claim':
      ensure(!FINISHED.has(s.phase),'Game already ended.');
      s.paused=true;s.pauseReason='Ready to resume';s.deadline=undefined;
      s.controller=command.controller;s.hostSeen=ctx.now;
      break;
    case 'pause':
      if(!s.paused){if(s.deadline!==undefined)s.remaining=Math.max(0,s.deadline-ctx.now);
        s.deadline=undefined;s.paused=true;s.pauseReason='Paused by host';}
      break;
    case 'continue':
      ensure(s.paused,'Game already running.');
      s.paused=false;s.pauseReason=undefined;s.hostSeen=ctx.now;
      if(['tossup','tieTossup','bonusTimer'].includes(s.phase))
        s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
      break;
    case 'lockLobby': phase('lobby');s.locked=command.locked;break;
    case 'remove':{
      phase('lobby');const p=s.players.find(p=>p.id===command.playerId);
      ensure(p,'Player not found.');p.removed=true;break;
    }
    case 'start':
      phase('lobby');ensure(activePlayers(s).length===3,'Three contestants must join before starting.');
      s.locked=true;s.roundIndex=0;s.puzzleIndex=0;
      s.roundStarterId=activePlayers(s)[random(ctx,3)].id;setRound(s,ctx);
      break;
    case 'revealLetter':{
      phase('tossup','tieTossup');
      const remaining=[...new Set(currentPuzzle(s).answer.toUpperCase().match(/[A-Z]/g)??[])]
        .filter(c=>!s.revealed.includes(c));
      if(remaining.length){const letter=remaining[random(ctx,remaining.length)];
        s.revealed.push(letter);s.lastAction='A letter was revealed.';}
      break;
    }
    case 'buzz':{
      phase('tossup','tieTossup');
      ensure(command.windowId===s.windowId,'This buzzer window has closed.',409);
      ensure(s.deadline!==undefined&&ctx.now<s.deadline,'Buzzer time expired.',409);
      const p=activePlayers(s).find(p=>p.id===ctx.userId);
      ensure(p,'Only contestants can buzz.',403);
      ensure(!s.attempted.includes(p.id),'You have already attempted this puzzle.',409);
      if(s.phase==='tieTossup')ensure(s.tieEligible?.includes(p.id),'Only tied leaders may buzz.',403);
      s.remaining=s.deadline-ctx.now;s.deadline=undefined;s.respondent=p.id;
      s.phase=s.phase==='tieTossup'?'tieAnswer':'tossupAnswer';
      s.lastAction=p.name+' buzzed first!';
      break;
    }
    case 'judgeBuzz':{
      phase('tossupAnswer','tieAnswer');
      ensure(s.respondent,'No contestant is answering.');
      checkpoint(s);
      const p=activePlayers(s).find(p=>p.id===s.respondent)!;
      if(command.correct){
        completedTossup(s,ctx,p);
      }else if(s.phase==='tieAnswer'){
        s.attempted.push(p.id);s.respondent=undefined;
        const available=s.tieEligible?.some(id=>!s.attempted.includes(id));
        s.phase='tieTossup';s.windowId=crypto.randomUUID();
        if(!available){s.attempted=[];s.revealed=[];}
        s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
      }else if(s.roundIndex===0&&s.definition.opening==='frenzy'){
        // The wrong answer immediately moves to the next Fortune Frenzy puzzle.
        s.deadline=ctx.now+(s.remaining??TOSSUP_MS);
        advanceTossup(s,ctx);
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
    case 'nextRound':{
      phase('roundResult');
      if(s.roundIndex===s.definition.rounds.length-1){
        const players=activePlayers(s),high=Math.max(...players.map(total)),leaders=players.filter(p=>total(p)===high);
        if(leaders.length>1){
          resetPuzzle(s);s.tieEligible=leaders.map(p=>p.id);s.phase='tieTossup';
          s.windowId=crypto.randomUUID();s.deadline=ctx.now+TOSSUP_MS;s.remaining=TOSSUP_MS;
        }else{s.bonusPlayerId=leaders[0].id;s.phase='bonusCategory';}
      }else{
        s.roundIndex++;s.puzzleIndex=0;setRound(s,ctx);
      }
      break;
    }
    case 'spin':{
      phase('turn');const p=mustBeActive(s,ctx);
      const choices=wheelForRound(currentRound(s)!.kind);
      const index=random(ctx,choices.length),wedge=choices[index];
      const spin:Spin={id:crypto.randomUUID(),index,wedge,playerId:p.id,sequence:(s.spin?.sequence??0)+1};
      s.spin=spin;s.pendingSpin=spin;
      s.lastAction=p.name+' spun '+wedge.label;
      if(wedge.kind==='bankrupt')bankrupt(s,p);
      else if(wedge.kind==='lose'){nextPlayer(s);}
      else s.phase='letter';
      break;
    }
    case 'buyVowel':{
      phase('turn');const p=mustBeActive(s,ctx);
      ensure(p.roundMoney>=250,'You need $250 in unbanked round money.');
      ensure('AEIOU'.split('').some(l=>!s.usedLetters.includes(l)),'All vowels have been used.');
      p.roundMoney-=250;s.pendingSpin=undefined;s.phase='letter';
      s.lastAction=p.name+' bought a vowel for $250.';
      break;
    }
    case 'letter':{
      phase('letter','express','speedup');const p=mustBeActive(s,ctx);
      const letter=command.letter.toUpperCase(),vowel=VOWELS.includes(letter);
      const spin=s.pendingSpin;
      const cash=spin?.wedge.value??0;
      if(s.phase==='letter'){
        ensure(spin?.wedge.kind==='free'||(spin? !vowel:vowel),
          spin?'Call a consonant for this wedge.':'Choose a vowel.');
      }
      if(s.phase==='express'&&vowel)ensure(p.roundMoney>=250,'Not enough money for an Express vowel.');
      if(s.phase==='speedup')ensure(!s.speedupCanSolve,'Solve or pass before calling another letter.');
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
      if(s.phase==='speedup'){
        if(!vowel)p.roundMoney+=(s.speedupValue??0)*count;
        s.speedupCanSolve=true;s.lastAction=letter+' appears '+count+' time(s). Solve or pass.';
        break;
      }
      if(!vowel){
        const amount=(s.phase==='express'?1000:cash)*count;
        p.roundMoney+=amount;
        s.lastAction=p.name+' earned $'+amount+' with '+letter+'.';
      }else s.lastAction=letter+' revealed '+count+' time(s).';
      if(s.phase==='express')break;
      if(spin?.wedge.kind==='wild')p.wildCard=true;
      if(spin?.wedge.kind==='million')p.millionWedge=true;
      if(spin?.wedge.kind==='mystery'){s.phase='mysteryChoice';break;}
      if(spin?.wedge.kind==='express'){s.phase='expressChoice';break;}
      s.phase='turn';s.pendingSpin=undefined;
      break;
    }
    case 'mystery':{
      phase('mysteryChoice');const p=mustBeActive(s,ctx);
      if(command.reveal){
        if(random(ctx,2)===0){s.lastAction='Mystery reveal: BANKRUPT!';bankrupt(s,p);}
        else {p.pendingPrizes.push({label:'Mystery $10,000',value:10000});
          s.lastAction=p.name+' found the $10,000 Mystery prize!';
          s.phase='turn';s.pendingSpin=undefined;}
      }else{s.lastAction=p.name+' kept the Mystery cash.';s.phase='turn';s.pendingSpin=undefined;}
      break;
    }
    case 'express':{
      phase('expressChoice');mustBeActive(s,ctx);
      s.phase=command.accept?'express':'turn';s.pendingSpin=undefined;
      s.lastAction=command.accept?'Express mode! An incorrect guess means Bankrupt.':'Express declined.';
      break;
    }
    case 'solve':{
      phase('turn','express','speedup','letter');
      const p=mustBeActive(s,ctx);
      if(s.phase==='speedup')ensure(s.speedupCanSolve,'Call a correct letter before solving.');
      if(s.phase==='letter')ensure(s.pendingSpin?.wedge.kind==='free','Choose a letter first.');
      checkpoint(s);
      if(normalize(command.text)===normalize(currentPuzzle(s).answer)){bankPuzzle(s,ctx,p);}
      else{
        s.lastAction=p.name+' attempted an incorrect solution.';
        if(s.phase==='express')bankrupt(s,p);else nextPlayer(s);
      }
      break;
    }
    case 'hostSolve':{
      phase('turn','letter','express','speedup');
      const p=activePlayers(s).find(p=>p.id===command.playerId);
      ensure(p&&p.id===s.currentPlayerId,'Only the active contestant may solve.');
      checkpoint(s);bankPuzzle(s,ctx,p);
      break;
    }
    case 'speedUp':{
      phase('turn');ensure(currentRound(s)?.kind==='final','Speed-Up belongs to Round 4.');
      const available=wheelForRound('final').filter(w=>w.kind==='cash');
      s.speedupValue=available[random(ctx,available.length)].value+1000;
      s.pendingSpin=undefined;s.phase='speedup';s.speedupCanSolve=false;
      s.lastAction='Final Spin! Consonants are worth $'+s.speedupValue+' each.';
      break;
    }
    case 'pass':{
      phase('speedup');mustBeActive(s,ctx);nextPlayer(s);break;
    }
    case 'chooseBonus':{
      phase('bonusCategory');
      ensure(ctx.userId===s.bonusPlayerId||host,'Only the finalist can choose the bonus category.',403);
      prepareBonus(s,ctx,command.index);break;
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
      awardBonus(s,ctx,normalize(command.text)===normalize(currentPuzzle(s).answer));
      break;
    }
    case 'bonusJudge':{
      phase('bonusTimer');ensure(s.deadline!==undefined&&ctx.now<s.deadline,'Bonus time expired.',409);
      awardBonus(s,ctx,command.correct);break;
    }
    case 'finish':phase('bonusResult');s.phase='finished';s.locked=true;break;
    case 'undo':{
      ensure(s.undo,'No judgment to undo.');
      const prev=s.undo;
      ensure(prev.roundIndex===s.roundIndex&&prev.puzzleIndex===s.puzzleIndex,'Cannot undo another puzzle.');
      const recorded=new Set(s.processed);
      Object.assign(s,structuredClone(prev));
      s.processed=[...new Set([...s.processed,...recorded])];
      s.undo=undefined;s.paused=true;s.pauseReason='Judgment undone — review and continue';
      s.deadline=undefined;s.remaining=prev.remaining;
      s.lastAction='Last judgment reversed.';
      break;
    }
    case 'end':
      s.phase='ended';s.locked=true;s.paused=false;s.deadline=undefined;s.windowId=undefined;break;
  }
  if(command.type!=='heartbeat'){
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
  const showAnswer=host||s.phase==='roundResult'||s.phase==='bonusResult'||s.phase==='finished'||s.phase==='ended';
  const tiles=puzzle.answer.toUpperCase().split('').map(ch=>!/[A-Z]/.test(ch)||s.revealed.includes(ch)?ch:'');
  const extra=s.phase.startsWith('bonus')||s.phase==='finished';
  return {
    id:s.id,gameId:s.gameId,title:s.title,joinCode:s.joinCode,phase:s.phase,
    version:s.version,actionVersion:s.actionVersion,
    roundIndex:s.roundIndex,totalRounds:s.definition.rounds.length,
    roundTitle:extra?'Bonus Round':(s.phase==='tieTossup'||s.phase==='tieAnswer'?'Sudden-Death Toss-Up':round?.title??''),
    roundKind:extra?'bonus':(s.phase==='tieTossup'||s.phase==='tieAnswer'?'tie':round?.kind??'regular'),
    puzzleIndex:s.puzzleIndex,puzzlesInRound:round?.puzzles.length??1,
    puzzle:{category:puzzle.category,tiles,answer:showAnswer?puzzle.answer:undefined,hint:host?puzzle.hint:undefined},
    players:activePlayers(s).map(p=>({...p,pendingPrizes:p.pendingPrizes.map(x=>({...x}))})),
    currentPlayerId:s.currentPlayerId,respondent:s.respondent,windowId:s.windowId,
    attempted:s.attempted,revealed:s.revealed,usedLetters:s.usedLetters,
    spin:s.spin,pendingSpin:s.pendingSpin,lastAction:s.lastAction,
    deadline:s.deadline,remaining:s.remaining,speedupValue:s.speedupValue,
    speedupCanSolve:s.speedupCanSolve,bonusPlayerId:s.bonusPlayerId,bonusPuzzleIndex:s.bonusPuzzleIndex,
    bonusCategories:extra?s.definition.bonus.puzzles.map(p=>p.category):undefined,
    bonusLetters:s.bonusLetters,
    bonusPrize:host||['bonusResult','finished'].includes(s.phase)
      ?s.definition.bonus.envelopes[s.bonusEnvelopeIndex??0]:undefined,
    bonusWon:s.bonusWon,tripleWinners:s.tripleWinners,tieEligible:s.tieEligible,
    events:s.events,paused:s.paused,pauseReason:s.pauseReason,locked:s.locked,
    controllerOwned:host&&controller===s.controller,hostConnected:now-s.hostSeen<HOST_GRACE_MS,
    serverNow:now,canUndo:host&&!!s.undo,createdAt:s.createdAt
  };
}
