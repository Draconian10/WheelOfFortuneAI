import {describe,it,expect} from 'vitest';
import {sessionReturnHref} from '@/lib/session-navigation';

describe('session back navigation',()=>{
  it('returns all completed or manually ended sessions to the homepage',()=>{
    for(const role of ['host','player','audience'] as const){
      expect(sessionReturnHref(role,true)).toBe('/');
    }
  });
  it('keeps expected in-progress navigation for each role',()=>{
    expect(sessionReturnHref('host',false)).toBe('/host');
    expect(sessionReturnHref('player',false)).toBe('/join');
    expect(sessionReturnHref('audience',false)).toBe('/');
  });
});
