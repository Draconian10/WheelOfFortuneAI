/**
 * Full offline browser journey: actual Next.js UI in isolated Chromium profiles.
 * Supabase identity, HTTP and Realtime transport are emulated; game rules are NOT.
 * Designed to mirror JeopardyAI's offline live-browser runner in CI.
 */
import {test,expect,devices,type BrowserContext,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {newSession,applyCommand,reconcile,viewSession,total} from '../../lib/game/engine';
import {starterGame} from '../../lib/game/starter';
import type {GameState} from '../../lib/game/types';
import type {Command} from '../../lib/game/schema';

const HOST=crypto.randomUUID();
const CONTROLLER=crypto.randomUUID();
const IDS=Array.from({length:5},()=>crypto.randomUUID());
const GAME=crypto.randomUUID();
const JOIN='654210';
const start=Date.now();
let s:GameState;
let responseSerial=0;
let actionCount=0;
const steps:string[]=[];
const note=(text:string)=>{steps.push(text);console.log('[offline game night] '+text);};
const user=(id:string,host=false)=>({
  id,aud:'authenticated',role:'authenticated',email:host?'test-host@example.com':undefined,
  is_anonymous:!host,app_metadata:{},user_metadata:{},created_at:new Date().toISOString()
});
function contextFor(id:string,host=false){
  return {
    userId:id,now:Date.now(),expectedVersion:s.actionVersion,
    controller:host?CONTROLLER:undefined,actionId:crypto.randomUUID(),
    random:(length:number)=>0,pinVerified:true
  };
}
function responseFor(id:string,url:URL,host=false){
  const spectator=url.searchParams.get('view')==='audience';
  return {...viewSession(s,id,Date.now(),host?CONTROLLER:undefined,spectator),
    runtimeAt:Date.now()+ ++responseSerial};
}
async function configure(context:BrowserContext,id:string,host=false){
  const subject=user(id,host);
  const payload={sub:id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+
    Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fixture';
  await context.addInitScript(({subject,token,host,room,controller})=>{
    localStorage.setItem('sb-example-auth-token',JSON.stringify({
      access_token:token,refresh_token:'fixture',expires_in:3600,
      expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:subject
    }));
    if(host)sessionStorage.setItem('fortune:launch:'+room,controller);
  },{subject,token,host,room:s.id,controller:CONTROLLER});
  await context.route('https://example.supabase.co/auth/v1/**',async route=>{
    await route.fulfill({status:200,json:subject});
  });
  // No real Supabase subscription should be established by the browser fixture.
  await context.routeWebSocket(/example\.supabase\.co/,socket=>socket.close());
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    const parts=url.pathname.split('/').filter(Boolean).slice(1);
    const [resource,target,op]=parts;
    try{
      if(resource==='player-sessions')return await route.fulfill({json:{sessions:[]}});
      if(resource==='join'&&req.method()==='POST'){
        const body=req.postDataJSON();
        if(body.code!==JOIN)throw new Error('Invalid game code');
        s=applyCommand(s,{type:'join',name:body.name},contextFor(id));
        actionCount++;
        return await route.fulfill({json:{id:s.id}});
      }
      if(resource==='sessions'&&target===s.id&&op==='command'&&req.method()==='POST'){
        const body=req.postDataJSON();
        const cmd=body.command as Command;
        if(cmd.type==='heartbeat'){
          s=applyCommand(s,cmd,{...contextFor(id,host),controller:body.controller});
          return await route.fulfill({json:{kind:'heartbeat',serverNow:Date.now(),host}});
        }
        s=applyCommand(s,cmd,{...contextFor(id,host),
          actionId:body.actionId,controller:body.controller,
          expectedVersion:body.version});
        actionCount++;
        return await route.fulfill({json:responseFor(id,url,host)});
      }
      if(resource==='sessions'&&target===s.id&&req.method()==='GET'){
        reconcile(s,Date.now());
        return await route.fulfill({json:responseFor(id,url,host)});
      }
      if(resource==='sessions'&&target===s.id&&op==='results')
        return await route.fulfill({contentType:'text/csv',body:'name,total\\n'+
          s.players.map(p=>p.name+','+total(p)).join('\\n')});
      if(resource==='display'&&target===s.id&&req.method()==='GET'){
        reconcile(s,Date.now());
        return await route.fulfill({json:responseFor(id,new URL(req.url()),host)});
      }
      return await route.fulfill({status:404,json:{error:'Fixture route not supported: '+url.pathname}});
    }catch(error){
      return await route.fulfill({
        status:(error as {status?:number}).status??409,
        json:{error:(error as Error).message}
      });
    }
  });
}

test('complete 5-contestant browser game: join, live buzz, host control, rounds, prizes, bonus and home navigation',async({browser},testInfo)=>{
  test.setTimeout(240000);
  s=newSession(starterGame(),GAME,HOST,JOIN,start,CONTROLLER);
  const contexts:BrowserContext[]=[];
  const pages:Page[]=[];
  const create=async(id:string,host=false)=>{
    const context=await browser.newContext(host?devices['Desktop Chrome']:devices['Pixel 7']);
    contexts.push(context);await configure(context,id,host);
    const page=await context.newPage();pages.push(page);
    page.on('dialog',d=>void d.accept());
    return page;
  };
  try{
    const host=await create(HOST,true);
    host.on('pageerror',err=>console.log('[fixture page error]',err.message));
    await host.goto('/host/session/'+s.id);
    await expect(host.locator('[data-game-phase="lobby"]')).toBeVisible({timeout:15000});
    note('Host logged in, controls active, empty room');
    const contestants:Page[]=[];
    for(let i=0;i<5;i++){
      const p=await create(IDS[i]);
      await p.goto('/join?code='+JOIN);
      await p.getByPlaceholder('Your name').fill('Contestant '+(i+1));
      await p.getByRole('button',{name:/Join Game/}).click();
      await expect(p.locator('[data-game-phase="lobby"]')).toBeVisible();
      contestants.push(p);
    }
    await host.reload();
    await expect(host.getByLabel('5 out of 5 contestant seats filled')).toBeVisible();
    note('Five independent phone profiles joined and host sees full lobby');
    // Browser-native Audience Display link opens a genuine separate tab, with no pop-up workaround.
    const audiencePromise=host.context().waitForEvent('page');
    await host.getByRole('link',{name:'Open audience display in a new tab'}).click();
    const audience=await audiencePromise;await audience.waitForLoadState('domcontentloaded');
    await expect(audience.locator('.audience-container')).toBeVisible();
    await expect(audience.getByRole('button',{name:/Pause Show/})).toHaveCount(0);
    note('Audience link opens its own read-only tab');
    await host.getByRole('button',{name:/Start the Show/}).click();
    await expect(host.locator('[data-game-phase="tossup"]')).toBeVisible();
    await contestants[0].reload();
    await expect(contestants[0].locator('[data-game-phase="tossup"]')).toBeVisible();
    await contestants[0].locator('button.buzzer.ready').click();
    await expect(contestants[0].locator('[data-game-phase="tossupAnswer"]')).toBeVisible();
    await host.reload();
    await host.getByRole('button',{name:/Correct/}).click();
    await expect(host.locator('[data-game-phase="roundResult"]')).toBeVisible();
    expect(s.players[0].banked).toBe(1000);
    await host.getByRole('button',{name:/Next Frenzy Puzzle/}).click();
    await expect(host.locator('[data-game-phase="tossup"]')).toBeVisible();
    expect(s.puzzleIndex).toBe(1);
    expect(s.deadline!-Date.now()).toBeGreaterThan(27000);
    note('Buzzer judged, score banked, second Frenzy puzzle starts with fresh 30 seconds');
    // Second and third questions are host paced, never auto-advanced.
    for(let index=1;index<=2;index++){
      await contestants[0].reload();
      await contestants[0].locator('button.buzzer.ready').click();
      await host.reload();
      await host.getByRole('button',{name:/Correct/}).click();
      await expect(host.locator('[data-game-phase="roundResult"]')).toBeVisible();
      await host.getByRole('button',{name:index===2?/Next Round/:/Next Frenzy Puzzle/}).click();
    }
    await expect(host.locator('[data-game-phase="turn"]')).toBeVisible();
    note('Entire Fortune Frenzy completed with standings between all three puzzles');
    // Pause and resume, including the golden Continue icon.
    await host.getByRole('button',{name:/Pause Show/}).click();
    await expect(host.locator('.pause-banner')).toBeVisible();
    await host.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(host.locator('.pause-banner')).toHaveCount(0);
    await contestants[4].reload();
    await expect(contestants[4].locator('.personal-score')).toBeVisible();
    note('Pause, resume and refresh preserve every player score and seat');
    for(let round=1;round<=3;round++){
      const phase=await host.locator('main[data-game-phase]').getAttribute('data-game-phase');
      expect(phase).toBe('turn');
      await host.getByRole('button',{name:/Mark spoken solution correct/}).click();
      await expect(host.locator('[data-game-phase="roundResult"]')).toBeVisible();
      await host.getByRole('button',{name:/Next Round/}).click();
      note('Regular/Mystery/Prize round '+round+' banked with host-verified spoken solution');
    }
    for(let puzzle=0;puzzle<3;puzzle++){
      await contestants[0].reload();
      await contestants[0].locator('button.buzzer.ready').click();
      await host.reload();
      await host.getByRole('button',{name:/Correct/}).click();
      await expect(host.locator('[data-game-phase="roundResult"]')).toBeVisible();
      await host.getByRole('button',{name:puzzle===2?/Next Round/:/Next Toss-Up/}).click();
    }
    note('Triple Toss-Up sweep with banked winnings and three independent question reveals');
    await expect(host.locator('[data-game-phase="turn"]')).toBeVisible();
    await host.getByRole('button',{name:/Mark spoken solution correct/}).click();
    await expect(host.locator('[data-game-phase="roundResult"]')).toBeVisible();
    await host.getByRole('button',{name:/See our finalist/}).click();
    await expect(host.locator('[data-game-phase="bonusSpin"]')).toBeVisible();
    note('Round 4 selects the main-game winner');
    await host.getByRole('button',{name:/Spin Bonus Wheel/}).click();
    await expect(host.locator('[data-game-phase="bonusCategory"]')).toBeVisible();
    await host.locator('.bonus-category').first().click();
    await expect(host.locator('[data-game-phase="bonusLetters"]')).toBeVisible();
    for(const ch of ['B','C','D','A']){
      await host.locator('.bonus-stage .alphabet-key', {hasText:new RegExp('^'+ch+'$')}).click();
    }
    await host.getByRole('button',{name:/Start 10-second finale/}).click();
    await expect(host.locator('[data-game-phase="bonusTimer"]')).toBeVisible();
    await host.getByRole('button',{name:'Correct',exact:true}).click();
    await expect(host.locator('[data-game-phase="bonusResult"]')).toBeVisible();
    await host.getByRole('button',{name:/Announce the Champion/}).click();
    await expect(host.locator('[data-game-phase="finished"]')).toBeVisible();
    await expect(host.getByText(/wins!/)).toBeVisible();
    note('Bonus wheel, category, four letters, final judgment and champion confetti');
    await contestants[0].reload();
    await expect(contestants[0].locator('[data-game-phase="finished"]')).toBeVisible();
    await contestants[0].getByRole('link',{name:/Back to Home/}).click();
    await expect(contestants[0]).toHaveURL('http://127.0.0.1:3010/');
    note('Finished contestant returns to homepage, not the join form');
    expect(s.phase).toBe('finished');
    expect(s.players.every(p=>!p.removed)).toBe(true);
    const report={scope:'Offline browser fixture with real game engine; transport/Auth mocked',steps,
      playerCount:5,commands:actionCount,phase:s.phase,players:s.players.map(p=>({name:p.name,total:total(p)}))};
    const reportPath=testInfo.outputPath('game-night-report.json');
    await writeFile(reportPath,JSON.stringify(report,null,2));
    await testInfo.attach('game-night-report',{path:reportPath,contentType:'application/json'});
  }finally{
    await Promise.all(contexts.map(context=>context.close().catch(()=>{})));
  }
});
