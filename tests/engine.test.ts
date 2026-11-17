import {describe,it,expect} from 'vitest';
import {starterGame,emptyGame} from '@/lib/game/starter';
import {playable,gameSchema} from '@/lib/game/schema';
import {newSession,applyCommand,viewSession,reconcile,total,MIN_PLAYERS,MAX_PLAYERS,activePlayers} from '@/lib/game/engine';
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
  it('advances Fortune Frenzy immediately after a wrong answer',()=>{
    let s=starting();
    s=send(s,{type:'buzz',windowId:s.windowId!},PLAYERS[0]);
    s=send(s,{type:'judgeBuzz',correct:false});
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
    s=send(s,{type:'spin'},PLAYERS[0],0);
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
    s=send(s,{type:'spin'},PLAYERS[0],8);
    expect(s.players[0].banked).toBe(4500);
    expect(s.players[0].roundMoney).toBe(0);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
  });
  it('passes the turn after a wrong letter',()=>{
    let s=regular();s=send(s,{type:'spin'},PLAYERS[0],0);
    s=send(s,{type:'letter',letter:'Z'},PLAYERS[0]);
    expect(s.currentPlayerId).toBe(PLAYERS[1]);
  });
  it('offers Mystery cash or a separately secured prize',()=>{
    let s=regular();s.roundIndex=2;
    s=send(s,{type:'spin'},PLAYERS[0],5);
    s=send(s,{type:'letter',letter:'N'},PLAYERS[0]);
    expect(s.phase).toBe('mysteryChoice');
    s=send(s,{type:'mystery',reveal:true},PLAYERS[0],1);
    expect(s.players[0].pendingPrizes[0].value).toBe(10000);
  });
  it('Express incorrect letters cause Bankrupt and change turns',()=>{
    let s=regular();s.roundIndex=3;s=send(s,{type:'spin'},PLAYERS[0],6);
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
  it('ends Fortune Frenzy when its shared 30-second timer expires',()=>{
    const s=starting();s.hostSeen=s.deadline!+10000;
    reconcile(s,s.deadline!+1);
    expect(s.phase).toBe('roundResult');
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
    s=send(s,{type:'spin'},PLAYERS[0],9);
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
    s=send(s,{type:'spin'},ids[0],0);
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
