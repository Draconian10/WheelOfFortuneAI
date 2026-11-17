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
