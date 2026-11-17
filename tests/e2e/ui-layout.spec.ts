import {expect,test,type Page} from '@playwright/test';

async function fixture(page:Page,classNames:string,html:string){
  await page.goto('/');
  await page.evaluate(({classNames,html})=>{
    const main=document.querySelector('main');
    if(!main)throw new Error('Missing main content.');
    main.className=classNames;
    main.innerHTML=html;
  },{classNames,html});
}
async function fits(page:Page){
  const result=await page.evaluate(()=>{
    const viewport=window.innerWidth;
    const nodes=[...document.querySelectorAll('.site-header-inner,main,.panel,.puzzle-display,.wheel-area,.turn-panel')];
    const offscreen=nodes.filter(node=>{
      const b=node.getBoundingClientRect();
      return b.width>0&&(b.left < -2||b.right>viewport+2);
    }).map(node=>node.className.toString());
    return {viewport,scroll:document.documentElement.scrollWidth,offscreen};
  });
  expect(result.offscreen).toEqual([]);
  expect(result.scroll).toBeLessThanOrEqual(result.viewport+2);
}
const tiles=(count:number)=>Array.from({length:count},()=>'<span class="puzzle-tile hidden"></span>').join('');
const board='<section class="puzzle-display"><div class="puzzle-category">BEFORE & AFTER</div><div class="puzzle-tiles">'+
  [9,5,12].map(n=>'<div class="puzzle-word">'+tiles(n)+'</div>').join('')+'</div></section>';
const sidebar='<aside class="game-sidebar"><div class="panel"><section class="standings"><div class="section-heading"><h2>Live Standings</h2><span class="badge">5 PLAYERS</span></div>'+
  [0,1,2,3,4].map(i=>'<div class="standing-row"><span class="standing-rank">'+(i+1)+'</span><span class="avatar seat-'+i+'">A</span><div class="standing-person"><strong>Contestant '+(i+1)+'</strong><small>This round</small></div><div class="standing-money"><strong>$17,100</strong></div></div>').join('')+
  '</section></div><div class="panel host-tools"><div class="eyebrow">SHOW CONTROLS</div><button class="button secondary full">Pause Show</button><div class="display-access display-access--sidebar"><button class="button secondary full">Audience display</button><details class="display-options"><summary>•••</summary></details></div></div></aside>';
const fakeWheel='<div class="wheel-area"><div class="wheel-assembly"><div class="wheel-disc"></div><span class="wheel-pointer"></span></div></div>';

test('single shared header accommodates a signed-in host',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.site-header .brand-wheel')).toBeVisible();
  await expect(page.locator('.brand-live')).toHaveText('LIVE');
  await expect(page.locator('.site-header .site-nav')).toHaveCount(0);
  await expect(page.locator('.site-header a[href="/host"]')).toHaveCount(0);
  await expect(page.locator('.site-header a[href="/join"]')).toHaveCount(0);
  await expect(page.locator('.entry-card.host-entry')).toBeVisible();
  await expect(page.locator('.entry-card.player-entry')).toBeVisible();
  await page.evaluate(()=>{
    const el=document.createElement('div');
    el.className='site-account';
    el.innerHTML='<span class="site-account-icon">●</span><span class="site-account-email">longhostemailaddress@example.org</span><button type="button" class="site-logout">Sign out</button>';
    document.querySelector('.site-header-inner')?.appendChild(el);
  });
  await expect(page.locator('.site-account')).toBeVisible();
  await fits(page);
});
test('SVG wheel uses fitted wedge labels and readable WHEEL and FORTUNE arcs',async({page})=>{
  await page.goto('/');
  const wheel=page.locator('.wheel-disc svg');
  await expect(wheel).toBeVisible();
  const data=await wheel.evaluate(svg=>{
    const texts=[...svg.querySelectorAll('textPath')].map(node=>{
      const text=node.parentElement as unknown as SVGTextElement;
      const bounds=text.getBBox();
      return {name:node.textContent,x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
    });
    return {texts,wedgeLabels:[...svg.querySelectorAll('g > text[textLength]')].length};
  });
  expect(data.texts.map(t=>t.name)).toEqual(['WHEEL','FORTUNE']);
  for(const label of data.texts){
    expect(label.width).toBeGreaterThan(55);
    expect(label.height).toBeGreaterThan(15);
    expect(label.x).toBeGreaterThan(190);
    expect(label.x+label.width).toBeLessThan(510);
    expect(label.y).toBeGreaterThan(185);
    expect(label.y+label.height).toBeLessThan(515);
  }
  expect(data.wedgeLabels).toBe(24);
  await fits(page);
});
test('deep royal-blue palette provides WCAG AA contrast for normal text',async({page})=>{
  await page.goto('/');
  const values=await page.evaluate(()=>{
    const s=getComputedStyle(document.documentElement);
    return ['--panel','--text','--muted'].map(x=>s.getPropertyValue(x).trim());
  });
  const luminance=(hex:string)=>{
    const c=hex.slice(1).match(/.{2}/g)!.map(ch=>parseInt(ch,16)/255)
      .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  };
  const ratio=(a:string,b:string)=>{
    const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
    return (hi+.05)/(lo+.05);
  };
  expect(ratio(values[0],values[1])).toBeGreaterThan(7);
  expect(ratio(values[0],values[2])).toBeGreaterThan(4.5);
});
test('host game library and editor controls fit the viewport',async({page})=>{
  await fixture(page,'container shell-section','<header class="page-heading"><div><div class="eyebrow">HOST STUDIO</div><h1>Your game night starts here.</h1><p class="muted">Make a show</p></div><button class="button primary">Create New Game</button></header>'+
    '<div class="section-heading"><h2>Saved game shows</h2><button class="text-button">Archive</button></div><div class="games-grid">'+
    [0,1,2].map(i=>'<article class="game-card"><div class="game-card-banner"><span>WHEEL OF FORTUNE</span></div><div class="game-card-body"><h3>Friday Night Fortune</h3><div class="card-actions"><button class="button primary">Start</button><button class="icon-button">✎</button></div></div></article>').join('')+'</div>');
  await fits(page);
  await fixture(page,'container shell-section editor-container','<header class="page-heading"><div><h1>Build your show.</h1></div><div class="button-row"><button class="button secondary">Preview</button><button class="button primary">Save</button></div></header>'+
    '<div class="panel editor-meta"><label class="grow">Game title<input value="Friday Night Fortune"/></label><label>Host PIN<input value="123456"/></label></div>'+
    '<div class="panel round-tabs-panel"><div class="round-tabs">'+Array.from({length:8},(_,i)=>'<button class="round-tab">Round '+i+'</button>').join('')+'</div></div>'+
    '<div class="editor-main"><div class="panel puzzle-list"><div class="section-heading"><h2>Categories</h2></div><div class="puzzle-list-items"><button class="puzzle-row">Before and After</button></div></div>'+
    '<div class="panel puzzle-editor"><h2>Make them say aha!</h2><div class="puzzle-preview"><div class="tile-preview"><span class="word">'+tiles(12)+'</span></div></div><label>Puzzle<input value="BEFORE AND AFTER"/></label></div></div>'+
    '<div class="panel json-panel"><h2>Import JSON</h2><textarea class="json-textarea"></textarea></div>');
  await fits(page);
});
test('join form and five-seat lobby adapt to phone and laptop',async({page})=>{
  await fixture(page,'container join-layout','<div class="join-story"><div class="eyebrow">JOIN THE SHOW</div><h1>It is your turn to shine.</h1></div>'+
    '<div class="join-main"><div class="panel join-card"><h2>Grab your spot</h2><label>Room<input class="code-input" placeholder="000000"/></label><label>Name<input placeholder="Your name"/></label><button class="button primary full">Join Game</button></div></div>');
  await fits(page);
  await fixture(page,'container shell-section session-container','<div class="live-heading"><div><h1>Friday Night Fortune</h1></div><div class="live-code"><small>GAME CODE</small><strong>123456</strong></div></div>'+
    '<div class="lobby-layout"><section class="panel invite-panel"><h2>Invite your contenders.</h2><div class="qr-wrap" style="width:170px;height:170px"></div><div class="join-code">123456</div><div class="lobby-actions"><button class="button primary full">Start</button></div></section>'+
    '<section class="panel lobby-players"><div class="section-heading"><h2>Our contestants</h2><span class="count">5/5</span></div>'+
    [0,1,2,3,4].map(i=>'<div class="lobby-player"><span class="avatar seat-'+i+'">A</span><div><strong>Player '+(i+1)+'</strong></div><span class="ready-pill">READY</span></div>').join('')+'</section></div>');
  await fits(page);
});
test('host gameplay, player buzzer, and audience layouts fit',async({page})=>{
  await fixture(page,'container shell-section session-container','<div class="game-layout"><div class="game-primary">'+board+
    '<div class="wheel-game-grid">'+fakeWheel+'<section class="panel turn-panel"><h2>Current turn</h2><div class="round-money"><div><small>Round</small><strong>$800</strong></div><div><small>Banked</small><strong>$17,100</strong></div></div><div class="alphabet">'+
    'BCDFGHJKLMNPQRSTVWXYZ'.split('').map(ch=>'<button class="alphabet-key">'+ch+'</button>').join('')+
    '</div><button class="button primary">Solve Puzzle</button></section></div></div>'+sidebar+'</div>');
  await fits(page);
  await fixture(page,'container shell-section session-container player-container','<div class="game-layout"><div class="game-primary">'+board+
    '<div class="panel tossup-stage"><h2>Know the answer?</h2><button class="buzzer ready">BUZZ!</button></div></div><aside class="game-sidebar"><div class="panel personal-score"><strong>$17,100</strong></div></aside></div>');
  await fits(page);
  await fixture(page,'container shell-section session-container audience-container','<div class="live-heading"><div><h1>Friday Night Fortune</h1></div></div><div class="game-layout"><div class="game-primary">'+board+fakeWheel+'</div>'+sidebar+'</div>');
  await expect(page.locator('.site-header')).toBeHidden();
  await fits(page);
});


test('light broadcast header contrasts with navy application canvas',async({page})=>{
  await page.goto('/');
  const colors=await page.evaluate(()=>{
    const header=getComputedStyle(document.querySelector('.site-header')!).backgroundColor;
    const root=getComputedStyle(document.documentElement);
    const panel=root.getPropertyValue('--panel').trim();
    const main=getComputedStyle(document.body).backgroundImage;
    return {header,panel,main};
  });
  expect(colors.header).toBe('rgb(250, 250, 255)');
  expect(colors.panel).toBe('#17234d');
  expect(colors.main).toContain('rgb(16, 22, 54)');
});
test('lobby action area clearly distinguishes starting from ending',async({page})=>{
  await fixture(page,'container shell-section session-container',
    '<div class="lobby-layout"><section class="panel invite-panel"><div class="lobby-actions">'+
    '<button class="button primary full">Start the Show</button><div class="lobby-end-divider"></div>'+
    '<button class="button lobby-end-button full">End Session</button></div></section></div>');
  const begin=page.getByRole('button',{name:'Start the Show'});
  const end=page.getByRole('button',{name:'End Session'});
  await expect(begin).toBeVisible();
  await expect(end).toBeVisible();
  const colors=await page.evaluate(()=>{
    const primary=getComputedStyle(document.querySelector('.lobby-actions .primary')!).backgroundImage;
    const end=getComputedStyle(document.querySelector('.lobby-end-button')!).backgroundColor;
    return {primary,end};
  });
  expect(colors.primary).toContain('linear-gradient');
  expect(colors.end).toBe('rgb(58, 36, 67)');
  const dividers=await page.evaluate(()=>{
    const lobby=document.querySelector('.invite-panel');
    const audience=document.createElement('div');
    audience.className='display-access display-access--lobby';
    lobby?.appendChild(audience);
    return {
      end:document.querySelectorAll('.lobby-end-divider').length,
      audienceBorder:getComputedStyle(audience).borderTopWidth
    };
  });
  expect(dividers).toEqual({end:0,audienceBorder:'0px'});
  await fits(page);
});

test('host PIN reclaim is compact and show controls have separate readable actions',async({page})=>{
  await fixture(page,'container shell-section session-container',
    '<section class="panel claim-panel">'+
    '<div class="claim-heading"><div><h2>Reclaim host controls</h2><p>Enter your six-digit host PIN.</p></div></div>'+
    '<form class="claim-form"><label>Host PIN</label><div class="claim-form-row"><input type="password" value="123456"/>'+
    '<button class="button primary">Take control</button></div></form></section>'+
    '<aside class="game-sidebar"><div class="panel host-tools"><div class="eyebrow">SHOW CONTROLS</div>'+
    '<div class="host-action-stack"><button class="button secondary full">Pause Show</button>'+
    '<div class="display-access display-access--sidebar"><button class="button secondary full">Audience display</button>'+
    '<details class="display-options"><summary>•••</summary></details></div>'+
    '<button class="button host-end-game full">End Game</button></div></div></aside>');
  const reclaim=page.locator('.claim-panel');
  await expect(reclaim).toBeVisible();
  const frame=await reclaim.boundingBox();
  expect(frame).not.toBeNull();
  expect(frame!.width).toBeLessThanOrEqual(573);
  const controls=page.locator('.host-action-stack>.button');
  await expect(controls).toHaveCount(2);
  const pause=await controls.nth(0).boundingBox(),end=await controls.nth(1).boundingBox();
  expect(pause).not.toBeNull();expect(end).not.toBeNull();
  expect(end!.y).toBeGreaterThan(pause!.y+pause!.height);
  await fits(page);
});
test('winner text remains stationary while confetti overlay is present or removed',async({page})=>{
  await fixture(page,'container shell-section session-container',
    '<section class="panel celebration">'+
    '<canvas class="results-confetti" aria-hidden="true"></canvas>'+
    '<div class="celebration-icon">🏆</div>'+
    '<div class="eyebrow">SHOW CHAMPION</div><h2>Jon wins!</h2>'+
    '<p>Bonus Round: No solve this time.</p>'+
    '<div class="standings"><h3>Final standings</h3><p>Jon: $13,000</p></div>'+
    '</section>');
  await expect(page.getByRole('heading',{name:'Jon wins!'})).toBeVisible();
  const before=await page.getByRole('heading',{name:'Jon wins!'}).boundingBox();
  const style=await page.locator('.results-confetti').evaluate(el=>{
    const css=getComputedStyle(el);
    return {position:css.position,pointerEvents:css.pointerEvents,zIndex:css.zIndex};
  });
  expect(style).toEqual({position:'fixed',pointerEvents:'none',zIndex:'100'});
  await page.locator('.results-confetti').evaluate(el=>el.remove());
  const after=await page.getByRole('heading',{name:'Jon wins!'}).boundingBox();
  expect(before).not.toBeNull();expect(after).not.toBeNull();
  expect(Math.abs(before!.y-after!.y)).toBeLessThan(1);
  await fits(page);
});

test('continued game button has a high-contrast dark play triangle',async({page})=>{
  await fixture(page,'container shell-section session-container',
    '<div class="pause-banner"><svg aria-hidden="true" viewBox="0 0 24 24"></svg><div><strong>Host reconnecting — game paused</strong></div>'+
    '<button class="button primary pause-resume-button"><svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l15 9L5 21z"/></svg>Continue</button></div>');
  const button=page.getByRole('button',{name:'Continue'});
  await expect(button).toBeVisible();
  const colors=await page.locator('.pause-resume-button svg').evaluate(svg=>{
    const style=getComputedStyle(svg);
    return {color:style.color,fill:style.fill,stroke:style.stroke,opacity:style.opacity};
  });
  expect(colors).toEqual({
    color:'rgb(24, 32, 67)',fill:'rgb(24, 32, 67)',
    stroke:'rgb(24, 32, 67)',opacity:'1'
  });
  await fits(page);
});
test('masthead stays a single row with account controls on mobile',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const el=document.createElement('div');
    el.className='site-account';
    el.innerHTML='<span class="site-account-icon">●</span><span class="site-account-email">host@example.org</span><button type="button" class="site-logout">Sign out</button>';
    document.querySelector('.site-header-inner')?.appendChild(el);
  });
  const position=await page.evaluate(()=>{
    const brand=document.querySelector('.site-header .brand')!.getBoundingClientRect();
    const account=document.querySelector('.site-header .site-account')!.getBoundingClientRect();
    const inner=document.querySelector('.site-header-inner')!.getBoundingClientRect();
    return {sameRow:Math.abs(brand.y-account.y)<18,accountOnRight:account.x>brand.x,headerHeight:inner.height};
  });
  expect(position.sameRow).toBe(true);
  expect(position.accountOnRight).toBe(true);
  expect(position.headerHeight).toBeLessThan(94);
  await fits(page);
});
