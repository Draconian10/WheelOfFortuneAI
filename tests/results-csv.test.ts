import {describe,it,expect} from 'vitest';
import {newSession,applyCommand} from '@/lib/game/engine';
import {starterGame} from '@/lib/game/starter';
import {resultsCsv} from '@/lib/game/results-csv';

const HOST='00000000-0000-4000-8000-000000000001';
const PLAYER='00000000-0000-4000-8000-000000000002';
const CONTROLLER='00000000-0000-4000-8000-000000000005';
const NOW=1763350000000;
describe('detailed results CSV export',()=>{
  it('contains session metadata, player rankings, cash, prizes, stage scores, journal, and answer key',()=>{
    let s=newSession(starterGame(),'game',HOST,'112233',NOW,CONTROLLER);
    s=applyCommand(s,{type:'join',name:'Alice'},{
      userId:PLAYER,actionId:crypto.randomUUID(),expectedVersion:s.actionVersion,now:NOW+1
    });
    s.players[0].banked=1500;s.players[0].prizes=[{label:'Vacation',value:8000}];
    s.events=[{id:crypto.randomUUID(),playerId:PLAYER,delta:1500,reason:'Solved Round 1',
      round:1,puzzleIndex:0,at:NOW+10}];
    s.phase='finished';s.bonusPlayerId=PLAYER;s.bonusWon=false;
    const csv=resultsCsv(s,NOW+200);
    for(const phrase of ['GAME SUMMARY','FINAL STANDINGS','EARNINGS BY STAGE','PRIZE DETAILS',
      'SCORING LEDGER','PLAY-BY-PLAY ACTIVITY','PUZZLE ANSWER KEY',
      'Alice','9500','Vacation','Round 1','Solved Round 1','A DREAM COME TRUE'])
      expect(csv).toContain(phrase);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('join');
    expect(csv).toContain('112233');
    expect(csv).not.toContain('HOST PIN');
  });
  it('neutralizes spreadsheet formulas from user-controlled names, prizes, and puzzle solutions',()=>{
    let s=newSession(starterGame(),'game',HOST,'112233',NOW,CONTROLLER);
    s.players.push({id:PLAYER,name:'=HYPERLINK("https://bad")',seat:0,banked:0,roundMoney:0,
      prizes:[{label:'-SUM(3,4)',value:75}],pendingPrizes:[],wildCard:false,millionWedge:false,
      removed:false,lastSeen:NOW});
    s.definition.rounds[0].puzzles[0].answer='=2+2';
    const csv=resultsCsv(s);
    expect(csv).toContain("\"'=HYPERLINK");
    expect(csv).toContain("\"'-SUM(3,4)\"");
    expect(csv).toContain("\"'=2+2\"");
  });
  it('handles old sessions lacking action history and puzzle index',()=>{
    const s=newSession(starterGame(),'game',HOST,'112233',NOW,CONTROLLER);
    delete s.history;
    s.events=[{id:crypto.randomUUID(),playerId:PLAYER,delta:0,reason:'Score',round:0,at:NOW}];
    expect(resultsCsv(s)).toContain('No detailed action history available');
    expect(resultsCsv(s)).toContain('Scoring');
  });
});
