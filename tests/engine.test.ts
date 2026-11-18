import {describe,it,expect} from 'vitest';
import {starterGame,emptyGame} from '@/lib/game/starter';
import {playable,gameSchema,commandSchema} from '@/lib/game/schema';
import {newSession,applyCommand,viewSession,reconcile,total,MIN_PLAYERS,MAX_PLAYERS,activePlayers,SPIN_DURATION_MS,TOSSUP_MS,SPEEDUP_SOLVE_MS} from '@/lib/game/engine';
import type {GameState,Context} from '@/lib/game/types';
import type {Command} from '@/lib/game/schema';
const HOST='00000000-0000-4000-8000-000000000001';
const PLAYERS=['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
const CONTROLLER='00000000-0000-4000-8000-000000000005';
const EXTRA_PLAYERS=['00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007'];
const SIXTH_PLAYER='00000000-0000-4000-8000-000000000008';
const START=1763350000000;
let counter=0;
function ctx(s:GameState,user=HOST,index=0,time=START+counter++*50):Context {
  return {userId:user,now:time,actionId:crypto.randomUUID(),expectedVersion:s.actionVersion,
    controller:user===HOST?CONTROLLER:undefined,random:size=>index%size};
}
function send(s:GameState,command:Command,user=HOST,index=0,time?:number){
  return applyCommand(s,command,ctx(s,user,index,time));
}
function spinAndSettle(s:GameState,user=PLAYERS[0],index=0){
  const started=send(s,{type:'spin'},user,index);
  expect(started.phase).toBe('spinning');
  expect(started.spinEndsAt).toBeDefined();
  const next=structuredClone(started);
  reconcile(next,started.spinEndsAt!+1);
  return next;
}
function joined(){
  let s=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',HOST,'030405',START,CONTROLLER);
  for(let i=0;i<3;i++)s=send(s,{type:'join',name:['Alice','Bob','Charlie'][i]},PLAYERS[i]);
  return s;
}
function starting(){return send(joined(),{type:'start'});}
function regular(){
  const s=starting();s.roundIndex=1;s.puzzleIndex=0;s.phase='turn';
  s.currentPlayerId=PLAYERS[0];s.roundStarterId=PLAYERS[0];s.deadline=undefined;
  return s;
}
describe('game authoring',()=>{
  it('validates the full show and its three bonus categories',()=>{
    const d=starterGame();
    expect(gameSchema.parse(d).rounds.map(r=>r.kind)).toEqual(['tossup','regular','mystery','prize','triple','final']);
    expect(d.bonus.puzzles).toHaveLength(3);
    expect(()=>playable(d)).not.toThrow();
  });
  it('permits a draft but prevents an incomplete game from starting',()=>{
    const d=emptyGame();
    expect(gameSchema.safeParse(d).success).toBe(true);
    expect(()=>playable(d)).toThrow('Complete every puzzle');
  });
  it('requires at least one contestant and locks late joins after starting',()=>{
    let s=newSession(starterGame(),'game',HOST,'123456',START,CONTROLLER);
    expect(()=>send(s,{type:'start'})).toThrow('At least one contestant');
    s=send(s,{type:'join',name:'Solo'},PLAYERS[0]);
    s=send(s,{type:'start'});
    expect(s.phase).toBe('tossup');
    expect(s.roundStarterId).toBe(PLAYERS[0]);
    expect(()=>send(s,{type:'join',name:'Late'},PLAYERS[1])).toThrow();
  });
});
describe('live buzzer arbitration and privacy',()=>{
  it('accepts one contestant and closes the old buzzer window',()=>{
    let s=starting(),window=s.windowId!;
    s=send(s,{type:'buzz',windowId:window},PLAYERS[0]);
    expect(s.phase).toBe('tossupAnswer');
    expect(()=>send(s,{type:'buzz',windowId:window},PLAYERS[1])).toThrow();
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.players[0].banked).toBe(1000);
    expect(s.windowId).not.toBe(window);
  });
  it('holds each Fortune Frenzy question until the host starts the next one',()=>{
    let s=starting();
    const firstPuzzle=s.definition.rounds[0].puzzles[0].answer;
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:false});
    expect(s.phase).toBe('roundResult');
    expect(s.puzzleIndex).toBe(0);
    expect(s.definition.rounds[0].puzzles[0].answer).toBe(firstPuzzle);
    expect(s.deadline).toBeUndefined();
    expect(s.frenzyRemaining).toBeUndefined();
    s=send(s,{type:'nextRound'});
    expect(s.phase).toBe('tossup');expect(s.puzzleIndex).toBe(1);
  });
  it('excludes private solutions from player and audience projections',()=>{
    const s=starting();
    expect(viewSession(s,HOST,START,CONTROLLER).puzzle.answer).toBeTruthy();
    expect(viewSession(s,PLAYERS[0],START).puzzle.answer).toBeUndefined();
    expect(viewSession(s,HOST,START,undefined,true).puzzle.answer).toBeUndefined();
  });
});
describe('wheel scoring',()=>{
  it('awards every consonant, deducts vowel cost, then banks on a solve',()=>{
    let s=regular();
    s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1500);
    expect(s.players[0].banked).toBe(0);
    s=send(s,{type:'buyVowel'},PLAYERS[0]);
    s=send(s,{type:'letter',letter:'E'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1250);
    s=send(s,{type:'solve',text:'THE FUTURE IS BRIGHT'},PLAYERS[0]);
    expect(s.phase).toBe('roundResult');expect(s.players[0].banked).toBe(1250);
    expect(s.players[0].roundMoney).toBe(0);
  });
  it('Bankrupt erases unbanked earnings but not secured winnings',()=>{
    let s=regular();s.players[0].banked=4500;s.players[0].roundMoney=1800;
    s=spinAndSettle(s,PLAYERS[0],8);
    expect(s.players[0].banked).toBe(4500);
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
  });
  it('passes the turn after a wrong letter',()=>{
    let s=regular();s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
  });
  it('offers Mystery cash or a separately secured prize',()=>{
    let s=regular();s.roundIndex=2;
    s=spinAndSettle(s,PLAYERS[0],5);
    s=send(s,{type:'letter',letter:'N'},PLAYERS[0]);
    expect(s.phase).toBe('mysteryChoice');
    s=send(s,{type:'mystery',reveal:true},PLAYERS[0],1);
    expect(s.players[0].pendingPrizes[0].value).toBe(10000);
  });
  it('Express incorrect letters cause Bankrupt and change turns',()=>{
    let s=regular();s.roundIndex=3;s=spinAndSettle(s,PLAYERS[0],6);
    s=send(s,{type:'letter',letter:'P'},PLAYERS[0]);
    expect(s.phase).toBe('expressChoice');
    s=send(s,{type:'express',accept:true},PLAYERS[0]);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);expect(s.players[0].roundMoney).toBe(0);
  });
});
describe('bonus round and host control',()=>{
  it('uses RSTLNE plus 3 consonants and one vowel, awards the prize after a solve',()=>{
    let s=regular();s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],0);
    expect(s.phase).toBe('bonusCategory');
    s=send(s,{type:'chooseBonus',index:0},PLAYERS[0],0);
    for(const letter of ['B','C','D','A'])s=send(s,{type:'bonusLetter',letter},PLAYERS[0]);
    s=send(s,{type:'startBonus'});
    expect(s.phase).toBe('bonusTimer');
    s=send(s,{type:'bonusSolve',text:'A DREAM COME TRUE'},PLAYERS[0]);
    expect(s.bonusWon).toBe(true);expect(s.players[0].prizes[0].value).toBe(40000);
    s=send(s,{type:'finish'});expect(s.phase).toBe('finished');
  });
  it('only allows the controlling host to judge or pause',()=>{
    const s=starting();
    expect(()=>send(s,{type:'pause'},PLAYERS[0])).toThrow();
    expect(()=>applyCommand(s,{type:'pause'},{
      ...ctx(s),controller:'00000000-0000-4000-8000-000000000099'
    })).toThrow('read-only');
  });
  it('persists remaining timer duration on host disconnect',()=>{
    const s=starting();s.hostSeen=START;s.deadline=START+50000;
    reconcile(s,START+30000);
    expect(s.paused).toBe(true);
    expect(s.deadline).toBeUndefined();
    expect(s.remaining).toBe(20000);
  });
});

describe('automatic Toss-Up reveal and standings',()=>{
  it('reveals letters automatically without host commands',()=>{
    const s=starting();s.hostSeen=START+100000;
    const start=s.puzzleStartedAt!;
    reconcile(s,start+7000);
    expect(s.revealed.length).toBeGreaterThan(0);
    expect(s.phase).toBe('tossup');
  });
  it('holds a timed-out Frenzy puzzle for host review without disclosing its solution',()=>{
    let s=starting();s.hostSeen=s.deadline!+10000;
    reconcile(s,s.deadline!+1);
    expect(s.phase).toBe('roundResult');
    expect(s.puzzleIndex).toBe(0);
    expect(s.puzzleTimedOut).toBe(true);
    expect(viewSession(s,PLAYERS[0],START).puzzle.answer).toBeUndefined();
    expect(viewSession(s,HOST,START,undefined,true).puzzle.answer).toBeUndefined();
    expect(()=>send(s,{type:'revealTimedOut'},PLAYERS[0])).toThrow('Only the host');
    s=send(s,{type:'revealTimedOut'});
    expect(s.puzzleTimedOut).toBe(false);
    expect(viewSession(s,PLAYERS[0],START).puzzle.answer).toBe(s.definition.rounds[0].puzzles[0].answer);
    expect(s.puzzleIndex).toBe(0);
  });
  it('holds Triple Toss-Up standings between its three puzzles',()=>{
    let s=starting();s.roundIndex=4;s.puzzleIndex=0;
    s.hostSeen=START+100000;
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.phase).toBe('roundResult');
    expect(s.players[0].banked).toBe(2000);
    s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(4);expect(s.puzzleIndex).toBe(1);
    expect(s.phase).toBe('tossup');
  });
});

describe('judgment corrections',()=>{
  it('can undo a correct regular-round solve before moving to the next round',()=>{
    let s=regular();s.players[0].roundMoney=1000;
    s=send(s,{type:'solve',text:'THE FUTURE IS BRIGHT'},PLAYERS[0]);
    expect(s.phase).toBe('roundResult');
    expect(s.players[0].banked).toBe(1000);
    expect(s.undo).toBeDefined();
    s=send(s,{type:'undo'});
    expect(s.phase).toBe('turn');
    expect(s.players[0].banked).toBe(0);
    expect(s.players[0].roundMoney).toBe(1000);
    expect(s.paused).toBe(true);
  });
  it('keeps the selected bonus prize concealed until the final reveal',()=>{
    let s=regular();s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],0);
    const host=viewSession(s,HOST,START,CONTROLLER);
    const player=viewSession(s,PLAYERS[0],START);
    expect(host.bonusPrize).toBeUndefined();
    expect(player.bonusPrize).toBeUndefined();
  });
  it('allows the host to reverse an incorrect bonus judgment',()=>{
    let s=regular();s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],0);
    s=send(s,{type:'chooseBonus',index:0},PLAYERS[0]);
    for(const letter of ['B','C','D','A'])s=send(s,{type:'bonusLetter',letter},PLAYERS[0]);
    s=send(s,{type:'startBonus'});
    s=send(s,{type:'bonusJudge',correct:false});
    expect(s.phase).toBe('bonusResult');
    s=send(s,{type:'undo'});
    expect(s.phase).toBe('bonusTimer');
    expect(s.bonusWon).toBeUndefined();
    expect(s.paused).toBe(true);
  });
  it('shows updated standings between traditional opening Toss-Ups',()=>{
    let s=starting();s.definition.opening='traditional';s.hostSeen=START+100000;
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.phase).toBe('roundResult');expect(s.players[0].banked).toBe(1000);
    s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(0);expect(s.puzzleIndex).toBe(1);
  });
});

describe('special wedge coverage',()=>{
  it('includes the Lose a Turn wedge and preserves the contestant round bank',()=>{
    let s=regular();s.players[0].roundMoney=1700;
    s=spinAndSettle(s,PLAYERS[0],9);
    expect(s.spin?.wedge.kind).toBe('lose');
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    expect(s.players[0].roundMoney).toBe(1700);
  });
});


describe('flexible lobby with one to five contestants',()=>{
  const ids=[...PLAYERS,...EXTRA_PLAYERS];
  it('permits starting with each size from one through five without waiting for a full lobby',()=>{
    expect(MIN_PLAYERS).toBe(1);expect(MAX_PLAYERS).toBe(5);
    for(let count=MIN_PLAYERS;count<=MAX_PLAYERS;count++){
      let s=newSession(starterGame(),'game',HOST,'1000'+count+count,START,CONTROLLER);
      for(let i=0;i<count;i++)s=send(s,{type:'join',name:'Player '+(i+1)},ids[i]);
      expect(activePlayers(s)).toHaveLength(count);
      s=send(s,{type:'start'},HOST,count-1);
      expect(s.phase).toBe('tossup');
      expect(s.roundStarterId).toBe(ids[count-1]);
      expect(s.players.map(p=>p.seat)).toEqual(Array.from({length:count},(_,i)=>i));
    }
  });
  it('blocks the sixth player and reuses seats removed before launch',()=>{
    let s=newSession(starterGame(),'game',HOST,'234567',START,CONTROLLER);
    for(let i=0;i<MAX_PLAYERS;i++)s=send(s,{type:'join',name:'Contestant '+(i+1)},ids[i]);
    expect(activePlayers(s)).toHaveLength(MAX_PLAYERS);
    expect(()=>send(s,{type:'join',name:'Overflow'},SIXTH_PLAYER)).toThrow('five-contestant limit');
    s=send(s,{type:'remove',playerId:ids[2]});
    expect(activePlayers(s)).toHaveLength(MAX_PLAYERS-1);
    s=send(s,{type:'join',name:'Replacement'},SIXTH_PLAYER);
    expect(s.players.find(p=>p.id===SIXTH_PLAYER)?.seat).toBe(2);
    expect(activePlayers(s).map(p=>p.seat)).toEqual([0,1,2,3,4]);
  });
  it('has a functional solo turn loop rather than losing the active player',()=>{
    let s=newSession(starterGame(),'game',HOST,'667788',START,CONTROLLER);
    s=send(s,{type:'join',name:'Solo player'},ids[0]);
    s=send(s,{type:'start'});
    s.roundIndex=1;s.phase='turn';s.currentPlayerId=ids[0];s.deadline=undefined;
    s=spinAndSettle(s,ids[0],0);
    s=send(s,{type:'letter',letter:'Z'},ids[0]);
    expect(s.currentPlayerId).toBe(ids[0]);
    expect(s.phase).toBe('turn');
  });
  it('accepts the first buzz and rejects other contestants in a five-player session',()=>{
    let s=newSession(starterGame(),'game',HOST,'998877',START,CONTROLLER);
    for(let i=0;i<MAX_PLAYERS;i++)s=send(s,{type:'join',name:'Player '+i},ids[i]);
    s=send(s,{type:'start'});
    const window=s.windowId!;
    s=send(s,{type:'buzz',windowId:window},ids[4]);
    expect(s.respondent).toBe(ids[4]);
    for(const id of ids.slice(0,4))
      expect(()=>send(s,{type:'buzz',windowId:window},id)).toThrow();
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.players.find(p=>p.id===ids[4])?.banked).toBe(1000);
  });
});


describe('ending a session safely from the lobby',()=>{
  it('closes a room with zero players without displaying a fabricated winner',()=>{
    let s=newSession(starterGame(),'game',HOST,'864200',START,CONTROLLER);
    s=send(s,{type:'end'});
    expect(s.phase).toBe('ended');
    expect(s.closedInLobby).toBe(true);
    expect(s.locked).toBe(true);
    expect(s.windowId).toBeUndefined();
    expect(viewSession(s,HOST,START,CONTROLLER).closedInLobby).toBe(true);
    expect(()=>send(s,{type:'join',name:'Too late'},PLAYERS[0])).toThrow();
    expect(()=>send(s,{type:'start'})).toThrow();
  });
  it('ends the lobby for its joined contestants, but only from the controlling host',()=>{
    let s=newSession(starterGame(),'game',HOST,'864201',START,CONTROLLER);
    s=send(s,{type:'join',name:'First'},PLAYERS[0]);
    expect(()=>send(s,{type:'end'},PLAYERS[0])).toThrow();
    s=send(s,{type:'end'});
    expect(s.phase).toBe('ended');
    expect(s.closedInLobby).toBe(true);
    expect(viewSession(s,PLAYERS[0],START).closedInLobby).toBe(true);
  });
  it('keeps a started game termination distinct from a cancelled lobby',()=>{
    let s=starting();
    s=send(s,{type:'end'});
    expect(s.phase).toBe('ended');
    expect(s.closedInLobby).toBe(false);
  });
});

describe('server-authoritative wheel animation and Frenzy progression',()=>{
  it('does not apply BANKRUPT until the wheel finishes, including for a solo player',()=>{
    let s=regular();
    s.players[0].roundMoney=2300;
    s=send(s,{type:'spin'},PLAYERS[0],8);
    expect(s.phase).toBe('spinning');
    expect(s.spinEndsAt!-s.spin!.startedAt!).toBe(SPIN_DURATION_MS);
    expect(s.players[0].roundMoney).toBe(2300);
    expect(s.currentPlayerId).toBe(PLAYERS[0]);
    expect(s.lastAction).not.toContain('BANKRUPT');
    expect(()=>send(s,{type:'letter',letter:'T'},PLAYERS[0])).toThrow();
    let before=structuredClone(s);
    reconcile(before,s.spinEndsAt!-1);
    expect(before.phase).toBe('spinning');
    reconcile(before,s.spinEndsAt!+1);
    expect(before.phase).toBe('turn');
    expect(before.lastAction).toContain('BANKRUPT');
    expect(before.players[0].roundMoney).toBe(0);
    expect(before.currentPlayerId).toBe(PLAYERS[1]);
  });
  it('preserves a cash wedge until the animation ends then enables the letter',()=>{
    let s=regular();
    s=send(s,{type:'spin'},PLAYERS[0],0);
    expect(s.phase).toBe('spinning');
    reconcile(s,s.spinEndsAt!+1);
    expect(s.phase).toBe('letter');
    expect(s.pendingSpin?.wedge.kind).toBe('cash');
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1500);
  });
  it('starts the second Frenzy puzzle with a fresh 30-second clock after a correct solve',()=>{
    let s=starting();
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    const firstRemaining=s.remaining!;
    expect(firstRemaining).toBeGreaterThan(0);
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.phase).toBe('roundResult');
    expect(s.puzzleIndex).toBe(0);
    expect(s.players[0].banked).toBe(1000);
    expect(s.deadline).toBeUndefined();
    const second=send(s,{type:'nextRound'},HOST,0,START+10000);
    expect(second.puzzleIndex).toBe(1);
    expect(second.phase).toBe('tossup');
    expect(second.deadline!-second.updatedAt).toBe(30000);
    expect(second.remaining).toBe(30000);
    expect(second.puzzleTimedOut).toBeUndefined();
    expect(second.deadline!-second.updatedAt).toBeGreaterThan(firstRemaining);
    expect(viewSession(second,PLAYERS[0],second.updatedAt).puzzle.answer).toBeUndefined();
  });
  it('does not expire the second puzzle immediately when the first had almost no time left',()=>{
    let s=starting();
    // Simulate an old session containing a nearly exhausted shared timer.
    s.frenzyRemaining=1;
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:true});
    s=send(s,{type:'nextRound'});
    expect(s.phase).toBe('tossup');
    expect(s.deadline!-s.updatedAt).toBe(30000);
    s.hostSeen=s.updatedAt+60000;
    reconcile(s,s.updatedAt+5000);
    expect(s.phase).toBe('tossup');
    expect(s.puzzleIndex).toBe(1);
    expect(s.puzzleTimedOut).toBeUndefined();
  });
  it('continues to the next Frenzy question only on the host next-puzzle action after timeout',()=>{
    let s=starting();
    const expiry=s.deadline!;
    s.hostSeen=expiry+30000;
    reconcile(s,expiry+1);
    expect(s.phase).toBe('roundResult');
    expect(s.puzzleTimedOut).toBe(true);
    const next=send(s,{type:'nextRound'},HOST,0,expiry+1000);
    expect(next.phase).toBe('tossup');
    expect(next.roundIndex).toBe(0);
    expect(next.puzzleIndex).toBe(1);
    expect(next.deadline!-next.updatedAt).toBe(30000);
  });
});

describe('audience data privacy during Frenzy timeout',()=>{
  it('does not publish the solution until the host explicitly reveals it',()=>{
    let s=starting();
    const deadline=s.deadline!;
    s.hostSeen=deadline+30000;
    reconcile(s,deadline+1);
    const audience=viewSession(s,HOST,deadline+1,undefined,true);
    const player=viewSession(s,PLAYERS[0],deadline+1);
    expect(audience.puzzleTimedOut).toBe(true);
    expect(audience.puzzle.answer).toBeUndefined();
    expect(player.puzzle.answer).toBeUndefined();
    expect(audience.controllerOwned).toBe(false);
    s=send(s,{type:'revealTimedOut'},HOST,0,deadline+1000);
    expect(viewSession(s,HOST,deadline+1000,undefined,true).puzzle.answer).toBeTruthy();
  });
  it('refuses manual reveals before the timer actually expires',()=>{
    const s=starting();
    expect(()=>send(s,{type:'revealTimedOut'})).toThrow();
  });
});

describe('Toss-Up automatic reveal pacing (30-second broadcast window)',()=>{
  function freshShortPuzzle(answer='A BRIGHT IDEA'){
    const s=starting();
    s.definition.rounds[0].puzzles[0].answer=answer;
    s.hostSeen=s.puzzleStartedAt!+TOSSUP_MS+90000;
    return s;
  }
  it('disallows the removed manual reveal action at the API schema boundary',()=>{
    expect(commandSchema.safeParse({type:'revealLetter'}).success).toBe(false);
    expect(commandSchema.safeParse({type:'revealTimedOut'}).success).toBe(true);
  });
  it('keeps at least one distinct letter hidden on a short phrase at 23 and 29 seconds',()=>{
    const s=freshShortPuzzle();
    const start=s.puzzleStartedAt!;
    const unique=new Set(s.definition.rounds[0].puzzles[0].answer.match(/[A-Z]/g));
    expect(unique.size).toBe(9);
    reconcile(s,start+23000);
    // Previous fixed 2.3s interval showed all nine letters by ~20.7s.
    expect(s.revealed.length).toBeLessThan(unique.size);
    expect(s.revealed.length).toBe(6);
    const player=viewSession(s,PLAYERS[0],start+23000);
    expect(player.puzzle.answer).toBeUndefined();
    expect(player.puzzle.tiles).toContain('');
    expect(player.puzzle.tiles.join('')).not.toBe('ABRIGHTIDEA');
    reconcile(s,start+TOSSUP_MS-1);
    expect(s.phase).toBe('tossup');
    expect(s.revealed.length).toBe(unique.size-1);
    expect(viewSession(s,PLAYERS[0],start+TOSSUP_MS-1).puzzle.tiles).toContain('');
  });
  it('reveals short and long puzzles proportionally; never shows the final letter automatically',()=>{
    for(const answer of ['AAAA','ABA','A BRIGHT IDEA','ABCDEFGHIJKLMNOPQRSTUVWXY']){
      const s=freshShortPuzzle(answer);
      const startedAt=s.puzzleStartedAt!;
      const count=new Set(answer.match(/[A-Z]/g)).size;
      for(const time of [0,1000,5000,14000,22000,29000,29999]){
        reconcile(s,startedAt+time);
        const expected=Math.min(Math.max(0,count-1),Math.floor(time*count/TOSSUP_MS));
        expect(s.revealed.length).toBe(expected);
        expect(s.revealed.length).toBeLessThan(count);
      }
    }
  });
  it('freezes the revealed tiles at the moment a contestant buzzes',()=>{
    let s=freshShortPuzzle();
    const start=s.puzzleStartedAt!;
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0],0,start+23000);
    expect(s.phase).toBe('tossupAnswer');
    const frozen=s.revealed.slice();
    expect(frozen.length).toBeLessThan(9);
    reconcile(s,start+TOSSUP_MS+5000);
    expect(s.phase).toBe('tossupAnswer');
    expect(s.revealed).toEqual(frozen);
    expect(viewSession(s,PLAYERS[1],start+TOSSUP_MS+5000).puzzle.tiles).toContain('');
  });
  it('keeps reveal pacing stable when the host pauses and resumes',()=>{
    let s=freshShortPuzzle();
    const start=s.puzzleStartedAt!;
    s=send(s,{type:'pause'},HOST,0,start+15000);
    const paused=s.revealed.slice();
    reconcile(s,start+70000);
    expect(s.revealed).toEqual(paused);
    s=send(s,{type:'continue'},HOST,0,start+75000);
    // Pausing for 60 seconds cannot accelerate the reveal rate.
    expect(s.puzzleStartedAt).toBe(start+60000);
    reconcile(s,start+78000);
    expect(s.revealed.length).toBeLessThan(9);
    expect(s.revealed.length).toBe(5);
  });
  it('does not auto-expose the final answer when the Frenzy timer runs out',()=>{
    const s=freshShortPuzzle();
    const start=s.puzzleStartedAt!;
    reconcile(s,start+TOSSUP_MS);
    expect(s.phase).toBe('roundResult');
    expect(s.puzzleTimedOut).toBe(true);
    const audience=viewSession(s,HOST,start+TOSSUP_MS,undefined,true);
    expect(audience.puzzle.answer).toBeUndefined();
    expect(audience.puzzle.tiles).toContain('');
  });
});

describe('Million Dollar Wedge qualification',()=>{
  const collect=()=>{
    let s=regular();s.roundIndex=2;s.currentPlayerId=PLAYERS[0];
    s=spinAndSettle(s,PLAYERS[0],16); // $500 Million wedge (Mystery round)
    expect(s.pendingSpin?.wedge.kind).toBe('million');
    s=send(s,{type:'letter',letter:'G'},PLAYERS[0]);
    return s;
  };
  it('requires collecting contestant to solve the same puzzle before eligibility',()=>{
    let s=collect();
    expect(s.players[0].pendingMillionWedge).toBe(true);
    expect(s.players[0].millionWedge).toBe(false);
    s=send(s,{type:'solve',text:'WRONG ANSWER'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    s=send(s,{type:'hostSolve',playerId:PLAYERS[1]});
    expect(s.players[0].pendingMillionWedge).toBe(false);
    expect(s.players[0].millionWedge).toBe(false);
    expect(s.players[1].millionWedge).toBe(false);
    expect(s.phase).toBe('roundResult');
  });
  it('keeps the qualification after a correct round solve, then forfeits it on later BANKRUPT',()=>{
    let s=collect();
    s=send(s,{type:'hostSolve',playerId:PLAYERS[0]});
    expect(s.players[0].pendingMillionWedge).toBe(false);
    expect(s.players[0].millionWedge).toBe(true);
    const secured=s.players[0].banked;
    s=send(s,{type:'nextRound'});
    expect(s.phase).toBe('turn');
    // Next regular-round starter rotates instead of following the prior solver.
    expect(s.currentPlayerId).toBe(PLAYERS[2]);
    s=spinAndSettle(s,PLAYERS[2],8);
    expect(s.currentPlayerId).toBe(PLAYERS[0]);
    s=spinAndSettle(s,PLAYERS[0],8);
    expect(s.players[0].banked).toBe(secured);
    expect(s.players[0].millionWedge).toBe(false);
  });
  it('replaces the top bonus envelope only when the winning finalist qualified',()=>{
    let s=collect();
    s=send(s,{type:'hostSolve',playerId:PLAYERS[0]});
    s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],4);
    expect(s.bonusEnvelopeIndex).toBe(4);
    s=send(s,{type:'chooseBonus',index:0},PLAYERS[0]);
    for(const letter of ['B','C','D','A'])s=send(s,{type:'bonusLetter',letter},PLAYERS[0]);
    s=send(s,{type:'startBonus'});
    s=send(s,{type:'bonusJudge',correct:true});
    expect(s.players[0].prizes.at(-1)?.value).toBe(1000000);
    expect(s.players[0].prizes.at(-1)?.label).toBe('$1,000,000');

    let unqualified=collect();
    unqualified=send(unqualified,{type:'solve',text:'INCORRECT'},PLAYERS[0]);
    unqualified=send(unqualified,{type:'hostSolve',playerId:PLAYERS[1]});
    unqualified.phase='bonusSpin';unqualified.bonusPlayerId=PLAYERS[0];
    unqualified=send(unqualified,{type:'spinBonus'},PLAYERS[0],4);
    unqualified=send(unqualified,{type:'chooseBonus',index:0},PLAYERS[0]);
    for(const letter of ['B','C','D','A'])unqualified=send(unqualified,{type:'bonusLetter',letter},PLAYERS[0]);
    unqualified=send(unqualified,{type:'startBonus'});
    unqualified=send(unqualified,{type:'bonusJudge',correct:true});
    expect(unqualified.players[0].prizes.at(-1)?.value).toBe(100000);
  });
  it('forfeits a provisional Million Dollar collectible on BANKRUPT',()=>{
    let s=collect();
    expect(s.players[0].pendingMillionWedge).toBe(true);
    s=spinAndSettle(s,PLAYERS[0],8);
    expect(s.players[0].pendingMillionWedge).toBe(false);
    expect(s.players[0].millionWedge).toBe(false);
  });
});

describe('Wild Card retention, in-round extra consonant, and forfeiture',()=>{
  const collectWild=()=>{
    let s=regular();
    s=spinAndSettle(s,PLAYERS[0],16); // Wild Card, $500 per T
    expect(s.pendingSpin?.wedge.kind).toBe('wild');
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].wildCard).toBe(true);
    return s;
  };
  it('spends the retained Wild Card on an extra paid consonant after a cash wedge',()=>{
    let s=collectWild();
    expect(()=>send(s,{type:'useWildCard'},PLAYERS[0])).toThrow('cash-wedge consonant');
    s=spinAndSettle(s,PLAYERS[0],0); // $500
    s=send(s,{type:'letter',letter:'H'},PLAYERS[0]);
    expect(s.wildCardValue).toBe(500);
    const before=s.players[0].roundMoney;
    s=send(s,{type:'useWildCard'},PLAYERS[0]);
    expect(s.phase).toBe('wildLetter');
    expect(s.players[0].wildCard).toBe(false);
    expect(()=>send(s,{type:'letter',letter:'A'},PLAYERS[0])).toThrow('consonant only');
    s=send(s,{type:'letter',letter:'R'},PLAYERS[0]);
    expect(s.phase).toBe('turn');
    expect(s.players[0].roundMoney).toBe(before+1000); // R twice at $500
    expect(s.wildCardValue).toBeUndefined();
    expect(()=>send(s,{type:'useWildCard'},PLAYERS[0])).toThrow();
  });
  it('consumes Wild Card and passes the turn for a wrong extra consonant',()=>{
    let s=collectWild();
    s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'H'},PLAYERS[0]);
    s=send(s,{type:'useWildCard'},PLAYERS[0]);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    expect(s.players[0].wildCard).toBe(false);
    expect(s.wildCardValue).toBeUndefined();
  });
  it('retains Wild Card when another player solves, but BANKRUPT forfeits it',()=>{
    let s=collectWild();
    s=send(s,{type:'solve',text:'NOPE'},PLAYERS[0]);
    s=send(s,{type:'hostSolve',playerId:PLAYERS[1]});
    expect(s.players[0].wildCard).toBe(true);
    s=send(s,{type:'nextRound'});
    s.currentPlayerId=PLAYERS[0]; // control returned to this player during the next round
    s=spinAndSettle(s,PLAYERS[0],8);
    expect(s.players[0].wildCard).toBe(false);
  });
  it('permits an extra Bonus Round consonant when the Wild Card survived',()=>{
    let s=collectWild();
    s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],0);
    s=send(s,{type:'chooseBonus',index:0},PLAYERS[0]);
    for(const letter of ['B','C','D','G','A'])s=send(s,{type:'bonusLetter',letter},PLAYERS[0]);
    expect(s.bonusLetters).toHaveLength(5);
    s=send(s,{type:'startBonus'});
    expect(s.phase).toBe('bonusTimer');
  });
  it('forgoes the temporary extra consonant option when spinning again',()=>{
    let s=collectWild();
    s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'H'},PLAYERS[0]);
    expect(s.wildCardValue).toBe(500);
    s=send(s,{type:'spin'},PLAYERS[0],0);
    expect(s.wildCardValue).toBeUndefined();
    expect(s.players[0].wildCard).toBe(true); // saved for later/Bonus
  });
});

describe('tiebreaker uses its own reveal epoch',()=>{
  function tied(){
    const s=regular();s.roundIndex=5;s.phase='roundResult';
    s.puzzleStartedAt=START-90000;s.revealed=['A','B','C'];
    s.hostSeen=START+100000;
    return s;
  }
  it('starts an empty tie puzzle with a fresh 30-second countdown',()=>{
    let s=tied();s=send(s,{type:'nextRound'});
    expect(s.phase).toBe('tieTossup');
    expect(s.tieEligible).toHaveLength(3);
    expect(s.revealed).toEqual([]);
    expect(s.puzzleStartedAt).toBe(s.updatedAt);
    expect(s.deadline!-s.puzzleStartedAt!).toBe(TOSSUP_MS);
    const time=s.puzzleStartedAt!;
    reconcile(s,time+4000);
    const distinct=new Set(s.definition.tiebreaker.answer.match(/[A-Z]/g)).size;
    expect(s.revealed.length).toBeLessThan(distinct-1);
    expect(viewSession(s,PLAYERS[0],time+4000).puzzle.answer).toBeUndefined();
  });
  it('resets reveal start after an unanswered tiebreaker expires',()=>{
    let s=tied();s=send(s,{type:'nextRound'});
    const old=s.deadline!,oldWindow=s.windowId;
    reconcile(s,old);
    expect(s.phase).toBe('tieTossup');
    expect(s.puzzleStartedAt).toBe(old);
    expect(s.revealed).toEqual([]);
    expect(s.windowId).not.toBe(oldWindow);
    expect(s.deadline).toBe(old+TOSSUP_MS);
  });
  it('restarts cleanly if every tied leader is judged wrong',()=>{
    let s=tied();s=send(s,{type:'nextRound'});
    const firstStart=s.puzzleStartedAt!;
    for(const p of PLAYERS){
      s=send(s,{type:'buzz',windowId:s.windowId!},p);
      s=send(s,{type:'judgeBuzz',correct:false});
    }
    expect(s.phase).toBe('tieTossup');
    expect(s.attempted).toEqual([]);
    expect(s.revealed).toEqual([]);
    expect(s.puzzleStartedAt).toBe(s.updatedAt);
    expect(s.puzzleStartedAt).toBeGreaterThan(firstStart);
    expect(s.deadline!-s.puzzleStartedAt!).toBe(TOSSUP_MS);
  });
});

describe('three-second Final Spin solve window',()=>{
  function speedup(){
    let s=regular();s.roundIndex=5;s.hostSeen=START+100000;
    s=send(s,{type:'speedUp'},HOST,0);
    expect(s.phase).toBe('finalSpinning');
    expect(s.speedupValue).toBeUndefined();
    expect(s.spin?.wedge.kind).toBe('cash');
    const finished=structuredClone(s);
    reconcile(finished,s.spinEndsAt!+1);
    expect(finished.phase).toBe('speedup');
    expect(finished.speedupValue).toBe(s.spin!.wedge.value+1000);
    return finished;
  }
  it('starts a three-second window after a correct consonant, with no instant cash bank',()=>{
    let s=speedup();
    expect(()=>send(s,{type:'hostSolve',playerId:PLAYERS[0]})).toThrow('open three-second');
    s=send(s,{type:'letter',letter:'C'},PLAYERS[0]);
    expect(s.speedupCanSolve).toBe(true);
    expect(s.deadline!-s.updatedAt).toBe(SPEEDUP_SOLVE_MS);
    expect(s.players[0].roundMoney).toBeGreaterThan(0);
    expect(s.players[0].banked).toBe(0);
    const at=s.deadline!;
    reconcile(s,at-1);
    expect(s.currentPlayerId).toBe(PLAYERS[0]);
    reconcile(s,at);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    expect(s.phase).toBe('speedup');
    expect(s.speedupCanSolve).toBe(false);
    expect(s.deadline).toBeUndefined();
    expect(s.players[0].roundMoney).toBeGreaterThan(0);
    expect(()=>send(s,{type:'solve',text:'CHOCOLATE CHIP PANCAKES'},PLAYERS[0],0,at+10)).toThrow();
  });
  it('banks a correct complete solution within the timed window',()=>{
    let s=speedup();
    s=send(s,{type:'letter',letter:'C'},PLAYERS[0]);
    const money=s.players[0].roundMoney;
    s=send(s,{type:'solve',text:'CHOCOLATE CHIP PANCAKES'},PLAYERS[0],0,s.updatedAt+1000);
    expect(s.phase).toBe('roundResult');
    expect(s.players[0].banked).toBe(money);
  });
  it('gives a free vowel a solve window but no letter earnings',()=>{
    let s=speedup();
    s=send(s,{type:'letter',letter:'A'},PLAYERS[0]);
    expect(s.speedupCanSolve).toBe(true);
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.deadline!-s.updatedAt).toBe(SPEEDUP_SOLVE_MS);
  });
  it('passes immediately after a wrong consonant or manual pass',()=>{
    let s=speedup();
    expect(()=>send(s,{type:'pass'},PLAYERS[0])).toThrow('correct letter');
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    s=send(s,{type:'letter',letter:'C'},PLAYERS[1]);
    s=send(s,{type:'pass'},PLAYERS[1]);
    expect(s.currentPlayerId).toBe(PLAYERS[2]);
    expect(s.deadline).toBeUndefined();
  });
  it('preserves the remaining solve window during host pause and resume',()=>{
    let s=speedup();
    s=send(s,{type:'letter',letter:'C'},PLAYERS[0]);
    const opening=s.deadline!;
    s=send(s,{type:'pause'},HOST,0,opening-2000);
    expect(s.paused).toBe(true);
    expect(s.remaining).toBe(2000);
    s=send(s,{type:'continue'},HOST,0,opening+58000);
    expect(s.paused).toBe(false);
    expect(s.deadline!-s.updatedAt).toBe(2000);
    const ends=s.deadline!;
    reconcile(s,ends);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    expect(s.speedupCanSolve).toBe(false);
  });
  it('denies late host adjudication; only an active contestant with time left can win',()=>{
    let s=speedup();
    s=send(s,{type:'letter',letter:'C'},PLAYERS[0]);
    const expiry=s.deadline!;
    expect(()=>send(s,{type:'hostSolve',playerId:PLAYERS[0]},HOST,0,expiry)).toThrow();
    // A valid host oral judgment just before expiry is still allowed.
    s=send(s,{type:'hostSolve',playerId:PLAYERS[0]},HOST,0,expiry-1);
    expect(s.phase).toBe('roundResult');
  });
});

describe('Express automatically completes a fully revealed puzzle',()=>{
  const express=()=>{
    const s=regular();s.roundIndex=3;s.currentPlayerId=PLAYERS[0];
    s.definition.rounds[3].puzzles[0].answer='CAT';
    s.phase='express';s.revealed=['C','A'];s.usedLetters=['C','A'];s.deadline=undefined;
    s.players[0].roundMoney=2200;s.hostSeen=START+100000;
    return s;
  };
  it('ends Express and banks cash immediately after the final correct letter',()=>{
    let s=express();
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.phase).toBe('roundResult');
    expect(s.players[0].banked).toBe(3200);
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.lastAction).toMatch(/entire Express puzzle/);
    expect(viewSession(s,PLAYERS[1],s.updatedAt).puzzle.answer).toBe('CAT');
    expect(s.history?.at(-1)?.action).toBe('letter');
  });
  it('does not complete Express when any answer letter remains concealed',()=>{
    let s=express();s.revealed=['C'];s.usedLetters=['C'];
    s=send(s,{type:'letter',letter:'A'},PLAYERS[0]);
    expect(s.phase).toBe('express');
    expect(s.players[0].banked).toBe(0);
  });
  it('does not accidentally auto-solve outside Express mode',()=>{
    let s=express();s.phase='turn';
    s=send(s,{type:'hostSolve',playerId:PLAYERS[0]});
    expect(s.phase).toBe('roundResult');
    // Ordinary gameplay is still resolved by explicit player/host solve.
    expect(s.lastAction).not.toMatch(/entire Express puzzle/);
  });
});
describe('session action journal is private and reflects the correct puzzle',()=>{
  it('records player actions without storing authentication secrets in player views',()=>{
    let s=starting();
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:true});
    expect(s.history?.some(v=>v.action==='buzz')).toBe(true);
    expect(s.history?.some(v=>v.action==='judgeBuzz')).toBe(true);
    const player=viewSession(s,PLAYERS[1],s.updatedAt);
    expect('history' in player).toBe(false);
    expect(s.events[0].puzzleIndex).toBe(0);
  });
});

describe('server-enforced host control for gameplay commands',()=>{
  it('only permits the controlling host to start the Bonus Round',()=>{
    let s=regular();s.phase='bonusSpin';s.bonusPlayerId=PLAYERS[0];
    s=send(s,{type:'spinBonus'},PLAYERS[0],0);
    s=send(s,{type:'chooseBonus',index:0},PLAYERS[0]);
    for(const letter of ['B','C','D','A'])s=send(s,{type:'bonusLetter',letter},PLAYERS[0]);
    expect(()=>send(s,{type:'startBonus'},PLAYERS[0])).toThrow('Only the host');
    expect(()=>applyCommand(s,{type:'startBonus'},{
      ...ctx(s),controller:'00000000-0000-4000-8000-000000000099'
    })).toThrow('read-only');
    s=send(s,{type:'startBonus'});
    expect(s.phase).toBe('bonusTimer');
  });
  it('blocks a stale host tab from spinning, choosing letters, or buying vowels',()=>{
    const s=regular();s.players[0].roundMoney=500;
    const stale={...ctx(s),controller:'00000000-0000-4000-8000-000000000099'};
    expect(()=>applyCommand(s,{type:'spin'},stale)).toThrow('read-only');
    expect(()=>applyCommand(s,{type:'buyVowel'},stale)).toThrow('read-only');
    expect(()=>send(s,{type:'spin'},PLAYERS[0],0)).not.toThrow();
    expect(send(s,{type:'spin'},HOST,0).phase).toBe('spinning');
  });
});

describe('legacy Free Play wedge scoring',()=>{
  it('awards $500 per consonant occurrence and keeps a free vowel free',()=>{
    let s=regular();
    s=spinAndSettle(s,PLAYERS[0],7);
    expect(s.pendingSpin?.wedge.kind).toBe('free');
    expect(s.pendingSpin?.wedge.value).toBe(500);
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1500);
    let vowel=regular();
    vowel=spinAndSettle(vowel,PLAYERS[0],7);
    vowel=send(vowel,{type:'letter',letter:'E'},PLAYERS[0]);
    expect(vowel.players[0].roundMoney).toBe(0);
    expect(vowel.currentPlayerId).toBe(PLAYERS[0]);
  });
  it('does not penalize an absent letter or lose the turn',()=>{
    let s=regular();
    s=spinAndSettle(s,PLAYERS[0],7);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.currentPlayerId).toBe(PLAYERS[0]);
    expect(s.phase).toBe('turn');
  });
});

describe('television-style round starting order',()=>{
  const solveTossup=(state:GameState,player:string)=>{
    let s=send(state,{type:'buzz',windowId:state.windowId!},player);
    return send(s,{type:'judgeBuzz',correct:true});
  };
  it('uses the last opening winner for Round 1, rotates Rounds 2 and 3, then uses the final Triple winner',()=>{
    let s=starting();
    s=solveTossup(s,PLAYERS[0]);s=send(s,{type:'nextRound'});
    s=solveTossup(s,PLAYERS[2]);s=send(s,{type:'nextRound'});
    s=solveTossup(s,PLAYERS[1]);s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(1);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);

    s=send(s,{type:'hostSolve',playerId:PLAYERS[1]});
    s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(2);
    expect(s.currentPlayerId).toBe(PLAYERS[2]);
    expect(s.roundStarterId).toBe(PLAYERS[1]);

    s=send(s,{type:'hostSolve',playerId:PLAYERS[2]});
    s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(3);
    expect(s.currentPlayerId).toBe(PLAYERS[0]);

    s=send(s,{type:'hostSolve',playerId:PLAYERS[0]});
    s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(4);
    s=solveTossup(s,PLAYERS[2]);s=send(s,{type:'nextRound'});
    expect(s.roundStarterId).toBe(PLAYERS[1]); // First two Triple puzzles never control Round 4.
    s=solveTossup(s,PLAYERS[0]);s=send(s,{type:'nextRound'});
    s=solveTossup(s,PLAYERS[2]);s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(5);
    expect(s.currentPlayerId).toBe(PLAYERS[2]);
  });
  it('uses the second traditional Toss-Up winner for Round 1',()=>{
    const def=starterGame();def.opening='traditional';
    def.rounds[0].puzzles=def.rounds[0].puzzles.slice(0,2);
    let s=newSession(def,'game',HOST,'123456',START,CONTROLLER);
    for(let i=0;i<3;i++)s=send(s,{type:'join',name:'Player'+i},PLAYERS[i]);
    s=send(s,{type:'start'});
    s=solveTossup(s,PLAYERS[0]);s=send(s,{type:'nextRound'});
    s=solveTossup(s,PLAYERS[2]);s=send(s,{type:'nextRound'});
    expect(s.roundIndex).toBe(1);
    expect(s.currentPlayerId).toBe(PLAYERS[2]);
  });
  it('retains Round 1 starter as a fallback when the third Triple Toss-Up is unsolved',()=>{
    const s=regular();
    s.roundIndex=4;s.puzzleIndex=2;s.phase='roundResult';
    s.roundStarterId=PLAYERS[0];
    s.tripleWinners=[PLAYERS[1],PLAYERS[2]];
    const next=send(s,{type:'nextRound'});
    expect(next.roundIndex).toBe(5);
    expect(next.currentPlayerId).toBe(PLAYERS[0]);
  });
  it('wraps the regular-round rotation across all five player seats',()=>{
    let s=newSession(starterGame(),'game',HOST,'123456',START,CONTROLLER);
    const ids=[...PLAYERS,...EXTRA_PLAYERS];
    for(const [i,id] of ids.entries())s=send(s,{type:'join',name:'Seat '+i},id);
    s=send(s,{type:'start'});
    s.roundStarterId=ids[4];
    s.roundIndex=0;s.phase='roundResult';s.puzzleIndex=s.definition.rounds[0].puzzles.length-1;
    s=send(s,{type:'nextRound'});
    expect(s.currentPlayerId).toBe(ids[4]);
    s=send(s,{type:'hostSolve',playerId:ids[4]});s=send(s,{type:'nextRound'});
    expect(s.currentPlayerId).toBe(ids[0]);
    s=send(s,{type:'hostSolve',playerId:ids[0]});s=send(s,{type:'nextRound'});
    expect(s.currentPlayerId).toBe(ids[1]);
  });
});

describe('round puzzle-count validation',()=>{
  it('allows only one puzzle in regular, Mystery, Prize and Final Spin rounds',()=>{
    for(const index of [1,2,3,5]){
      const game=starterGame();
      game.rounds[index].puzzles.push({
        ...game.rounds[index].puzzles[0],id:crypto.randomUUID()
      });
      expect(gameSchema.safeParse(game).success).toBe(false);
      expect(()=>playable(game)).toThrow('exactly 1 puzzle');
    }
  });
  it('requires exactly three Triple Toss-Up puzzles',()=>{
    const fewer=starterGame();fewer.rounds[4].puzzles.pop();
    const extra=starterGame();extra.rounds[4].puzzles.push({
      ...extra.rounds[4].puzzles[0],id:crypto.randomUUID()
    });
    expect(gameSchema.safeParse(fewer).success).toBe(false);
    expect(gameSchema.safeParse(extra).success).toBe(false);
    expect(()=>playable(fewer)).toThrow('exactly 3 puzzles');
    expect(()=>playable(extra)).toThrow('exactly 3 puzzles');
    expect(gameSchema.parse(starterGame()).rounds[4].puzzles).toHaveLength(3);
  });
  it('still allows multiple opening puzzles but requires at least two for traditional Toss-Ups',()=>{
    const frenzy=starterGame();
    expect(gameSchema.safeParse(frenzy).success).toBe(true);
    frenzy.rounds[0].puzzles=frenzy.rounds[0].puzzles.slice(0,1);
    expect(gameSchema.safeParse(frenzy).success).toBe(true);
    frenzy.opening='traditional';
    expect(gameSchema.safeParse(frenzy).success).toBe(false);
    frenzy.rounds[0].puzzles.push({
      ...frenzy.rounds[0].puzzles[0],id:crypto.randomUUID()
    });
    expect(gameSchema.safeParse(frenzy).success).toBe(true);
  });
});

describe('Final Spin synchronized animation and Speed-Up handoff',()=>{
  it('selects a real cash wedge, rejects early letters, then releases the same payout on every view',()=>{
    let s=regular();s.roundIndex=5;s.hostSeen=START+100000;
    s=send(s,{type:'speedUp'},HOST,5);
    expect(s.phase).toBe('finalSpinning');
    expect(s.spinEndsAt!-s.spin!.startedAt!).toBe(SPIN_DURATION_MS);
    expect(s.speedupValue).toBeUndefined();
    expect(s.spin?.wedge.kind).toBe('cash');
    expect(s.spin?.index).toBeGreaterThanOrEqual(0);
    expect(viewSession(s,PLAYERS[1],s.updatedAt).speedupValue).toBeUndefined();
    expect(()=>send(s,{type:'speedUp'})).toThrow();
    expect(()=>send(s,{type:'letter',letter:'C'},PLAYERS[0],0,s.updatedAt+300)).toThrow();

    const settled=structuredClone(s);
    reconcile(settled,s.spinEndsAt!+1);
    expect(settled.phase).toBe('speedup');
    expect(settled.spin?.id).toBe(s.spin?.id);
    expect(settled.speedupValue).toBe(s.spin!.wedge.value+1000);
    expect(viewSession(settled,PLAYERS[1],s.spinEndsAt!+1).speedupValue).toBe(settled.speedupValue);
    expect(settled.history?.at(-1)?.action).toBe('finalSpinResult');
    const result=send(settled,{type:'letter',letter:'C'},PLAYERS[0],0,s.spinEndsAt!+200);
    expect(result.phase).toBe('speedup');
    expect(result.speedupCanSolve).toBe(true);
  });
});

describe('host scoreboard and letter adjudication corrections',()=>{
  it('adjusts secured cash and round earnings with a private audit log and score event',()=>{
    let s=regular();
    s=send(s,{type:'adjustScore',playerId:PLAYERS[0],balance:'banked',
      amount:1500,reason:'Missed puzzle award'});
    expect(s.players[0].banked).toBe(1500);
    expect(s.events.at(-1)?.delta).toBe(1500);
    expect(s.events.at(-1)?.reason).toContain('Missed puzzle award');
    expect(s.history?.at(-1)?.action).toBe('adjustScore');
    expect(s.history?.at(-1)?.subjectId).toBe(PLAYERS[0]);

    s=send(s,{type:'adjustScore',playerId:PLAYERS[0],balance:'banked',
      amount:-500,reason:'Award was too high'});
    expect(s.players[0].banked).toBe(1000);
    s=send(s,{type:'adjustScore',playerId:PLAYERS[1],balance:'roundMoney',
      amount:600,reason:'Corrected letter payout'});
    expect(s.players[1].roundMoney).toBe(600);
    expect(viewSession(s,PLAYERS[0],s.updatedAt).players[1].roundMoney).toBe(600);
    expect(()=>send(s,{type:'adjustScore',playerId:PLAYERS[0],
      balance:'banked',amount:-2000,reason:'Too much'})).toThrow('negative');
  });
  it('enforces controller authorization and correction limits',()=>{
    const s=regular();
    const command={type:'adjustScore',playerId:PLAYERS[0],
      balance:'banked',amount:100,reason:'Host review'} as const;
    expect(()=>send(s,command,PLAYERS[0])).toThrow('Only the host');
    expect(()=>applyCommand(s,command,{
      ...ctx(s),controller:'00000000-0000-4000-8000-000000000099'
    })).toThrow('read-only');
    expect(()=>send(s,{...command,amount:0})).toThrow();
    expect(()=>send(s,{...command,amount:1.5})).toThrow();
    expect(()=>send(s,{...command,reason:''})).toThrow();
  });
  it('undoes the immediate wrong letter without losing the spin or ending the round',()=>{
    let s=regular();s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
    expect(s.usedLetters).toContain('Z');
    expect(viewSession(s,HOST,s.updatedAt,CONTROLLER).canUndoLetter).toBe(true);
    expect(viewSession(s,PLAYERS[0],s.updatedAt).canUndoLetter).toBe(false);
    expect(()=>send(s,{type:'undoLetter'},PLAYERS[0])).toThrow('Only the host');
    s=send(s,{type:'undoLetter'});
    expect(s.currentPlayerId).toBe(PLAYERS[0]);
    expect(s.phase).toBe('letter');
    expect(s.usedLetters).not.toContain('Z');
    expect(s.pendingSpin?.wedge.kind).toBe('cash');
    expect(s.history?.slice(-2).map(h=>h.action)).toEqual(['letter','undoLetter']);
    expect(()=>send(s,{type:'undoLetter'})).toThrow('most recent letter');
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1500);
  });
  it('reverses an incorrect consonant payout and blocks stale undo after another action',()=>{
    let s=regular();s=spinAndSettle(s,PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    expect(s.players[0].roundMoney).toBe(1500);
    s=send(s,{type:'undoLetter'});
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.revealed).not.toContain('T');
    s=send(s,{type:'letter',letter:'T'},PLAYERS[0]);
    s=send(s,{type:'spin'},PLAYERS[0]);
    expect(viewSession(s,HOST,s.updatedAt,CONTROLLER).canUndoLetter).toBe(false);
    expect(()=>send(s,{type:'undoLetter'})).toThrow('most recent letter');
  });
});
