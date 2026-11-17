import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/live-fixture',
  fullyParallel:false,workers:1,timeout:240000,
  forbidOnly:!!process.env.CI,
  retries:0,
  reporter:process.env.CI?'github':'list',
  use:{baseURL:'http://127.0.0.1:3010',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'five-profile-chromium',use:{...devices['Desktop Chrome']}}],
  webServer:{
    command:'npm run dev -- --hostname 127.0.0.1 -p 3010',url:'http://127.0.0.1:3010',
    reuseExistingServer:!process.env.CI,timeout:120000,
    env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-test-key'}
  }
});
