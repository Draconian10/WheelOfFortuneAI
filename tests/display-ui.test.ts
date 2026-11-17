import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DisplayAccess from '@/components/display-access';
import PuzzleBoard from '@/components/puzzle-board';
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
