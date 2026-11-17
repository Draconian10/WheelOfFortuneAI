import {test,expect} from '@playwright/test';
test('homepage shows the wheel and both game entry paths without horizontal overflow',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Make every spin');
  await expect(page.locator('.wheel-assembly svg[role="img"]')).toBeVisible();
  await expect(page.locator('.entry-card.host-entry')).toBeVisible();
  await expect(page.locator('.entry-card.player-entry')).toBeVisible();
  await expect(page.locator('.entry-card.host-entry')).toHaveAttribute('href','/host');
  await expect(page.locator('.entry-card.player-entry')).toHaveAttribute('href','/join');
  const viewport=await page.evaluate(()=>({content:document.documentElement.scrollWidth,screen:window.innerWidth}));
  expect(viewport.content).toBeLessThanOrEqual(viewport.screen+2);
});
test('host and player start screens remain usable before Supabase setup',async({page})=>{
  await page.goto('/host');
  await expect(page.getByText('ONE-TIME SETUP')).toBeVisible();
  await page.goto('/join');
  await expect(page.getByText('ONE-TIME SETUP')).toBeVisible();
});

test('shared host navigation and audience controls stay aligned across desktop and mobile',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const account=document.createElement('div');
    account.className='account-row';
    account.innerHTML='<span class="account-email"><span>long-host-account-email-address@example.com</span></span><button class="text-button account-signout">Sign out</button>';
    document.body.appendChild(account);
    const display=document.createElement('div');
    display.className='display-access display-access--lobby';
    display.innerHTML='<button class="text-button">Open audience display</button><details class="display-options"><summary aria-label="Audience display options">•••</summary><div class="display-options-menu"><button>Copy display link</button></div></details>';
    document.body.appendChild(display);
    const awake=document.createElement('div');
    awake.className='awake-control';
    awake.innerHTML='<button class="button secondary small-button awake-button"><span>Keep screen awake</span><span class="awake-state is-active">On</span></button>';
    document.body.appendChild(awake);
  });
  const account=await page.locator('.account-row').boundingBox();
  const header=await page.locator('.site-header').boundingBox();
  expect(account).not.toBeNull();expect(header).not.toBeNull();
  expect(Math.abs(account!.x-header!.x)).toBeLessThanOrEqual(2);
  expect(account!.x+account!.width).toBeLessThanOrEqual(header!.x+header!.width+2);
  await expect(page.locator('.account-row .account-signout')).toBeVisible();
  const summary=page.locator('.display-options summary');
  expect(await summary.evaluate(el=>getComputedStyle(el).display)).toBe('flex');
  expect(await summary.evaluate(el=>getComputedStyle(el).listStyleType)).toBe('none');
  await summary.click();
  await expect(page.locator('.display-options')).toHaveAttribute('open','');
  await expect(page.locator('.display-options-menu button')).toBeVisible();
  const vp=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(vp.scroll).toBeLessThanOrEqual(vp.width+2);
});
