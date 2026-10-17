import { defineConfig } from '@playwright/test';
import path from 'node:path';
const artifacts=path.resolve(process.env.PLAYWRIGHT_ARTIFACT_DIR??'test-results/artifacts');
export default defineConfig({
 testDir:'./tests/e2e',workers:1,timeout:45000,
 use:{baseURL:'http://127.0.0.1:3100',trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:[['list'],['html',{outputFolder:path.join(artifacts,'e2e-report'),open:'never'}]],
 outputDir:process.env.PLAYWRIGHT_WORK_DIR??'test-results/runs',
 webServer:[
  {command:'node tests/fixtures/supabase.mjs',url:'http://127.0.0.1:54329/health',reuseExistingServer:false,timeout:30000},
  {command:'npm run start -- --hostname 127.0.0.1 --port 3100',url:'http://127.0.0.1:3100/api/v1/health',reuseExistingServer:false,timeout:60000,env:{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-e2e-anon-key',SUPABASE_SECRET_KEY:'local-e2e-service-key'}},
 ],
});
