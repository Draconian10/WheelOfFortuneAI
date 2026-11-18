import {describe,it,expect} from 'vitest';
import {
  hostConfirmationRedirect,hostPasswordRecoveryRedirect,publicHostRedirectOrigin
} from '@/lib/auth-flow';

describe('host email redirect targets',()=>{
  it('matches the Jeopardy-style host confirmation and password recovery paths',()=>{
    const origin='https://public-game.vercel.app';
    expect(hostConfirmationRedirect(origin)).toBe('https://public-game.vercel.app/host?confirmed=1');
    expect(hostPasswordRecoveryRedirect(origin)).toBe('https://public-game.vercel.app/host?reset=1');
  });
  it('uses the canonical production domain rather than a protected Vercel preview',()=>{
    const origin=publicHostRedirectOrigin('https://private-preview.vercel.app',{
      siteUrl:'https://private-preview.vercel.app',
      vercelProductionUrl:'public-game.vercel.app',
      isVercel:true
    });
    expect(origin).toBe('https://public-game.vercel.app');
    expect(hostConfirmationRedirect(origin)).toContain('public-game.vercel.app');
  });
  it('respects a configured public URL if Vercel production metadata is unavailable',()=>{
    expect(publicHostRedirectOrigin('https://preview.vercel.app',{
      siteUrl:'https://game.example.com/some-path',isVercel:true
    })).toBe('https://game.example.com');
  });
  it('fails closed on deployed Vercel without a configured public redirect URL',()=>{
    expect(()=>publicHostRedirectOrigin('https://private-preview.vercel.app',{isVercel:true}))
      .toThrow('Configure a public production URL');
  });
  it('permits local development but rejects insecure public or credential-bearing targets',()=>{
    expect(publicHostRedirectOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(()=>publicHostRedirectOrigin('https://preview.vercel.app',{
      siteUrl:'http://untrusted.example.com',isVercel:true
    })).toThrow('require HTTPS');
    expect(()=>publicHostRedirectOrigin('https://preview.vercel.app',{
      siteUrl:'https://user:password@example.com',isVercel:true
    })).toThrow('require HTTPS');
  });
});
