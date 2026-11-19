import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DisplayAccess from '@/components/display-access';
import PuzzleBoard from '@/components/puzzle-board';
import HostAnswer from '@/components/host-answer';
import BonusReveal from '@/components/bonus-reveal';
import WedgeHelp from '@/components/wedge-help';
import AudienceStage from '@/components/audience-stage';
import RoundTransition,{cueFor,isFreshRoundCue} from '@/components/round-transition';
import Wheel from '@/components/wheel';
import GameBuzzer from '@/components/game-buzzer';
import {readFileSync} from 'node:fs';
import FinalSpinAnnouncement from '@/components/final-spin-announcement';
import ScoreCorrections from '@/components/score-corrections';
import {newSession,viewSession} from '@/lib/game/engine';
import {starterGame} from '@/lib/game/starter';

describe('audience display opens as an ordinary browser tab',()=>{
  it('renders a direct, accessible target-blank link with no script-created popup',()=>{
    const sessionId='00000000-0000-4000-8000-000000000010';
    const html=renderToStaticMarkup(createElement(DisplayAccess,{sessionId}));
    expect(html).toMatch(new RegExp('href="/display/'+sessionId+'"'));
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Audience display');
    expect(html).not.toContain('Allow popups');
  });
  it('keeps the same native link in the lobby',()=>{
    const html=renderToStaticMarkup(createElement(DisplayAccess,{
      sessionId:'00000000-0000-4000-8000-000000000020',placement:'lobby'
    }));
    expect(html).toContain('Open audience display');
    expect(html).toContain('target="_blank"');
  });
});

describe('timed-out Frenzy board rendering',()=>{
  it('does not render the host solution until the host explicitly reveals it',()=>{
    const hostId='00000000-0000-4000-8000-000000000001';
    const state=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',hostId,'123456',1000);
    state.phase='roundResult';
    state.puzzleTimedOut=true;
    const current=viewSession(state,hostId,1100);
    expect(current.puzzle.answer).toBeTruthy(); // Only authorized host receives private answer.
    const hidden=renderToStaticMarkup(createElement(PuzzleBoard,{s:current}));
    expect(hidden).not.toContain('puzzle-solution');
    expect(hidden).not.toContain(current.puzzle.answer!);
    state.puzzleTimedOut=false;
    const shown=viewSession(state,hostId,1100);
    const revealed=renderToStaticMarkup(createElement(PuzzleBoard,{s:shown}));
    expect(revealed).toContain('puzzle-solution');
    expect(revealed).toContain(shown.puzzle.answer!);
  });
});

describe('private answer and special-wedge host/game UI',()=>{
  it('renders a compact, clearly private judging reference',()=>{
    const html=renderToStaticMarkup(createElement(HostAnswer,{
      answer:'FRESHLY BAKED COOKIES',hint:'Accept only the complete phrase'
    }));
    expect(html).toContain('Private Correct Response');
    expect(html).toContain('HOST ONLY');
    expect(html).toContain('FRESHLY BAKED COOKIES');
    expect(html).toContain('Host note');
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    // Details are collapsed by default; clicking is required to expose content.
    expect(html).not.toMatch(/<details[^>]+\sopen(?:\s|=|>)/);
  });
  it('describes Free Play, Wild Card, Mystery, Million Dollar, and BANKRUPT',()=>{
    const specs=[
      ['free','FREE PLAY','free vowel'],
      ['wild','WILD CARD','BANKRUPT'],
      ['mystery','MYSTERY WEDGE','$10,000'],
      ['million','MILLION DOLLAR WEDGE','$1 million'],
      ['bankrupt','BANKRUPT','banked winnings']
    ] as const;
    for(const [kind,heading,phrase] of specs){
      const html=renderToStaticMarkup(createElement(WedgeHelp,{kind}));
      expect(html).toContain(heading);
      expect(html).toContain(phrase);
    }
  });
});

describe('Bonus Round envelope reveal makes payouts unambiguous',()=>{
  const player={
    id:'00000000-0000-4000-8000-000000000002',
    name:'Jon',seat:0,banked:13250,roundMoney:0,
    prizes:[],pendingPrizes:[],wildCard:false,millionWedge:false,
    removed:false,lastSeen:Date.now()
  };
  const render=(won:boolean)=>{
    const finalist=won?{...player,prizes:[{label:'$50,000',value:50000}]}:player;
    return renderToStaticMarkup(createElement(BonusReveal,{
      won,prize:{label:'$50,000',value:50000},finalist,
      control:false,busy:false,paused:false,onFinish:()=>{}
    }));
  };
  it('for an unsuccessful solve, labels envelope NOT AWARDED and does not add it to winnings',()=>{
    const html=render(false);
    expect(html).toContain('BONUS PUZZLE NOT SOLVED');
    expect(html).toContain('THE BONUS ENVELOPE CONTAINED');
    expect(html).toContain('NOT AWARDED');
    expect(html).toContain('$50,000');
    expect(html).toContain('$13,250');
    expect(html).toContain('$0');
    expect(html).not.toContain('PRIZE AWARDED');
    expect(html).not.toContain('Announce the Champion');
  });
  it('for a successful solve, labels the bonus AWARDED and totals the prize once',()=>{
    const html=render(true);
    expect(html).toContain('BONUS PUZZLE SOLVED!');
    expect(html).toContain('PRIZE AWARDED');
    expect(html).toContain('$13,250');
    expect(html).toContain('$50,000');
    expect(html).toContain('$63,250');
    expect(html).not.toContain('NOT AWARDED');
  });
});

describe('broadcast round transitions and Bonus Wheel artwork',()=>{
  const host='00000000-0000-4000-8000-000000000001';
  it('names each stage, Mystery, Triple Toss-Up, the Bonus Finale, and tie-breakers',()=>{
    const state=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',host,'654210',1000);
    const view=viewSession(state,host,1000);
    for(const [index,kind,keyword] of [[1,'regular','ROUND ONE'],[2,'mystery','MYSTERY ROUND'],
      [3,'prize','PRIZE PUZZLE'],[4,'triple','TRIPLE TOSS-UP'],[5,'final','ROUND FOUR']] as const){
      const next={...view,roundIndex:index,roundKind:kind,phase:'turn' as const};
      expect(cueFor(next)?.title).toBe(keyword);
      expect(cueFor(next)?.key).toBe('round:'+index);
    }
    expect(cueFor({...view,phase:'bonusSpinning'})?.title).toBe('BONUS ROUND');
    expect(cueFor({...view,phase:'tieTossup'})?.title).toBe('SUDDEN DEATH');
    expect(cueFor({...view,phase:'finished'})).toBeUndefined();
    const hidden=renderToStaticMarkup(createElement(RoundTransition,{s:view}));
    expect(hidden).not.toContain('round-transition-overlay');
  });
  it('draws a dedicated 24-envelope Bonus Wheel without prematurely showing prize values',()=>{
    const html=renderToStaticMarkup(createElement(Wheel,{kind:'regular',bonus:true}));
    expect(html).toContain('Bonus Wheel with 24 numbered sealed envelopes');
    expect(html).toContain('wheel-bonus');
    expect(html).toContain('BONUS');
    expect(html).not.toContain('$40,000');
    expect(html).not.toContain('BANKRUPT');
  });
  it('replaces exposed Mystery Wedges with an explicitly shown outcome',()=>{
    const unrevealed=renderToStaticMarkup(createElement(Wheel,{kind:'mystery'}));
    expect(unrevealed).toContain('MYSTERY');
    const changed=renderToStaticMarkup(createElement(Wheel,{kind:'mystery',
      mysteryReveals:[{index:5,outcome:'prize'},{index:19,outcome:'bankrupt'}]}));
    expect(changed).toContain('10K WON');
    expect(changed).toContain('BANKRUPT');
  });
});

describe('television-style audience and final spin presentation',()=>{
  const host='00000000-0000-4000-8000-000000000001';
  const player='00000000-0000-4000-8000-000000000002';
  it('shows a visible synchronized final spin announcement and does not leak the private answer',()=>{
    const state=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',host,'456789',1000);
    state.roundIndex=5;state.phase='finalSpinning';
    state.players=[{id:player,name:'Taylor',seat:0,banked:2000,roundMoney:500,
      prizes:[],pendingPrizes:[],wildCard:false,millionWedge:false,removed:false,lastSeen:1000}];
    state.currentPlayerId=player;
    state.spin={id:crypto.randomUUID(),index:0,wedge:{kind:'cash',value:500,label:'$500',color:'#fff'},
      playerId:player,sequence:1,startedAt:1000};
    state.spinEndsAt=5200;
    const audience=viewSession(state,host,2000,undefined,true);
    expect(audience.puzzle.answer).toBeUndefined();
    const html=renderToStaticMarkup(createElement(AudienceStage,{s:audience,remaining:0}));
    expect(html).toContain('broadcast-stage');
    expect(html).toContain('FINAL SPIN!');
    expect(html).toContain('LIVE GAME UPDATE');
    expect(html).toContain('Taylor');
    expect(html).not.toContain(state.definition.rounds[5].puzzles[0].answer);
    expect(html).not.toContain('Apply Score Correction');
    expect(html).not.toContain('$1,500 PER CONSONANT');
  });
  it('announces the Speed-Up value only after the final spin settles',()=>{
    const spinning=renderToStaticMarkup(createElement(FinalSpinAnnouncement,{spinning:true}));
    expect(spinning).toContain('FINAL SPIN!');
    expect(spinning).not.toContain('per matching consonant');
    const ready=renderToStaticMarkup(createElement(FinalSpinAnnouncement,{spinning:false,value:1500}));
    expect(ready).toContain('$1,500');
    expect(ready).toContain('Speed-Up');
  });
  it('only offers the letter reversal when the host projection supports it',()=>{
    const state=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',host,'456789',1000);
    state.phase='turn';state.roundIndex=1;
    state.players=[{id:player,name:'Taylor',seat:0,banked:2000,roundMoney:500,
      prizes:[],pendingPrizes:[],wildCard:false,millionWedge:false,removed:false,lastSeen:1000}];
    const view=viewSession(state,host,1100,undefined);
    view.canUndoLetter=true;
    const html=renderToStaticMarkup(createElement(ScoreCorrections,{
      s:view,enabled:true,onCommand:()=>{}
    }));
    expect(html).toContain('Undo Last Letter');
    expect(html).toContain('Adjust a contestant score');
    expect(html).not.toContain('Apply Score Correction'); // Form stays collapsed until opened.
  });
});

describe('broadcast Final Spin buzzer and untimed answer',()=>{
  it('announces the player answer after the buzz without displaying a running deadline or private answer',()=>{
    const host='00000000-0000-4000-8000-000000000001';
    const player='00000000-0000-4000-8000-000000000002';
    const s=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',host,'113355',1000);
    s.roundIndex=5;s.phase='speedupAnswer';s.speedupValue=1900;s.speedupCanSolve=true;
    s.currentPlayerId=player;s.respondent=player;
    s.players=[{id:player,name:'Jon',seat:0,banked:9350,roundMoney:14600,
      prizes:[],pendingPrizes:[],wildCard:false,millionWedge:false,removed:false,lastSeen:1000}];
    const audience=viewSession(s,host,1100,undefined,true);
    const html=renderToStaticMarkup(createElement(AudienceStage,{s:audience,remaining:0}));
    expect(html).toContain('Jon buzzed in!');
    expect(html).toContain('Take your time');
    expect(html).toContain('$1,900');
    expect(html).not.toContain('00:00');
    expect(html).not.toContain(s.definition.rounds[5].puzzles[0].answer);
  });
});
describe('themed shared buzzer and reconnect-safe cinema',()=>{
  it('renders a large reusable active buzzer for Toss-Up and Final Spin',()=>{
    for(const context of ['tossup','speedup'] as const){
      const html=renderToStaticMarkup(createElement(GameBuzzer,{
        context,ready:true,onBuzz:()=>{}
      }));
      expect(html).toContain('game-show-buzzer');
      expect(html).toContain('buzzer '+(context==='speedup'?'game-show-buzzer':'game-show-buzzer'));
      expect(html).toContain('buzzer-'+context);
      expect(html).toContain('aria-label="Buzz in to answer"');
      expect(html).toContain('BUZZ!');
      expect(html).not.toContain('disabled=""');
    }
    const waiting=renderToStaticMarkup(createElement(GameBuzzer,{
      context:'speedup',ready:false,onBuzz:()=>{}
    }));
    expect(waiting).toContain('disabled=""');
    expect(waiting).toContain('WAIT');
  });
  it('centers the private correct answer without the decorative gold divider',()=>{
    const css=readFileSync('app/gameplay-polish.css','utf8');
    expect(css).toMatch(/\.host-private-answer-content\s*\{[^}]*border-left:0/);
    expect(css).toMatch(/\.host-private-answer-response\s*\{[^}]*text-align:center/);
    expect(css).toContain('.buzzer.game-show-buzzer');
    expect(css).toContain('.speedup-buzz-layout');
  });
  it('shows a cinematic only for a newly entered live round, not a delayed phone refresh',()=>{
    const host='00000000-0000-4000-8000-000000000001';
    const state=newSession(starterGame(),'00000000-0000-4000-8000-000000000010',host,'445566',1000);
    state.phase='turn';state.roundIndex=2;state.roundBeganAt=4950;
    const sample=viewSession(state,host,5100);
    expect(isFreshRoundCue(sample,4900,5100)).toBe(true);
    expect(isFreshRoundCue(sample,5060,5100)).toBe(false); // Returned after the round began.
    expect(isFreshRoundCue({...sample,serverNow:15000},0,15000)).toBe(false); // Offline for 10s.
    expect(isFreshRoundCue({...sample,roundBeganAt:undefined},0,5100)).toBe(false);
    expect(isFreshRoundCue({...sample,roundBeganAt:5200},0,5100)).toBe(false);
    expect(cueFor(sample)?.title).toBe('MYSTERY ROUND');
  });
});
