// Explicit staging verification helper; never imported by runtime application code.
// Supply credentials only through private Preview environment variables.
import { createClient } from '@supabase/supabase-js';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY;
const email=process.env.STAGING_QA_EMAIL;
const password=process.env.STAGING_QA_PASSWORD;
if(!url||!key||!email||!password||!email.startsWith('agentmeet-qa-')||!email.endsWith('@example.invalid'))throw Error('Explicit staging QA credentials required');
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'AgentMeet QA',full_name:'AgentMeet QA'}});
if(error){
 const login=await admin.auth.signInWithPassword({email,password});
 if(login.error)throw Error('Unable to create or verify isolated staging QA user');
 console.log('STAGING_QA_USER_ID='+login.data.user.id);
}else console.log('STAGING_QA_USER_ID='+data.user.id);
