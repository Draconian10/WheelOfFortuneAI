import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DisplayAccess from '@/components/display-access';
import PuzzleBoard from '@/components/puzzle-board';
import HostAnswer from '@/components/host-answer';
import BonusReveal from '@/components/bonus-reveal';
import WedgeHelp from '@/components/wedge-help';
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
