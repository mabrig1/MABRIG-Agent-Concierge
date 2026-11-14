/**
 * Public-safe, deterministic API discovery and setup planning.
 * This never provisions accounts, accesses credentials, reads private data,
 * submits to an AI provider, or performs external actions.
 */
import {recommendTemplate, templateById} from './engine.mjs';

const field=(v)=>typeof v==='string'&&v.trim().length>0;
const status=(ready,missing='needs_setup')=>ready?'ready':missing;

function canonicalOrigin(value){
  if(!field(value))return null;
  try{
    const url=new URL(value);
    const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
    if(!(url.protocol==='https:'||local)||url.username||url.password||url.search||url.hash||url.pathname!=='/')return null;
    return url.origin;
  }catch{return null;}
}
export function getSetupReadiness(env={}, {schemaReady=false, requestOrigin=null}={}){
  const db=!!env.DB;
  const google=field(env.GOOGLE_CLIENT_ID)&&field(env.GOOGLE_CLIENT_SECRET);
  const vault=field(env.CREDENTIALS_KEY);
  const canonical=canonicalOrigin(env.PUBLIC_BASE_URL);
  const domain=canonical?(!requestOrigin||requestOrigin===canonical?'ready':'host_mismatch'):'needs_setup';
  const database=db?(schemaReady?'ready':'needs_migration'):'needs_setup';
  const googleStatus=status(google);
  const vaultStatus=status(vault);
  const signIn=database==='ready'&&googleStatus==='ready'&&vaultStatus==='ready'&&domain==='ready';
  const checks={
    database:{status:database,description:database==='ready'?'Database tables available.':database==='needs_migration'?'Apply D1 migrations before using live accounts.':'D1 database binding is missing.'},
    domain:{status:domain,description:domain==='ready'?'Canonical application URL is configured for this host.':domain==='host_mismatch'?'The current hostname differs from PUBLIC_BASE_URL.':'Configure the application HTTPS origin.'},
    googleOAuth:{status:googleStatus,description:google?'Google OAuth credentials are configured; provider approval has not been checked.':'Add Google OAuth credentials as private Worker secrets.'},
    tokenVault:{status:vaultStatus,description:vault?'Credential encryption is configured.':'Add a unique 32-byte encryption key as a Worker secret.'},
    liveCalendar:{status:signIn?'consent_required':'needs_setup',description:signIn?'Calendar access is available only after a user consents.':'Complete identity, database and hostname setup first.'}
  };
  const providers=[
    {id:'google_identity',name:'Google sign-in',state:signIn?'consent_required':'needs_setup',permission:'Verified email identity only',action:signIn?'sign_in':'owner_setup'},
    {id:'google_calendar',name:'Google Calendar',state:signIn?'consent_required':'needs_setup',permission:'Read-only events, after separate consent',action:signIn?'connect_calendar':'owner_setup'},
    {id:'gmail',name:'Gmail',state:'not_enabled',permission:'No inbox access or sending is available',action:'demo_only'},
    {id:'openrouter',name:'AI model API',state:'not_enabled',permission:'No model calls or paid tokens are used',action:'future_review'},
    {id:'whatsapp',name:'WhatsApp Business',state:'not_enabled',permission:'No message sending is available',action:'future_review'},
    {id:'resend',name:'Transactional email API',state:'not_enabled',permission:'No automatic outbound email is available',action:'future_review'}
  ];
  const nextSteps=[];
  if(!db)nextSteps.push('Bind the dedicated Concierge D1 database.');
  else if(!schemaReady)nextSteps.push('Apply the dedicated D1 schema migrations.');
  if(domain!=='ready')nextSteps.push('Connect the approved HTTPS hostname and configure matching PUBLIC_BASE_URL.');
  if(!google)nextSteps.push('Add Google OAuth client credentials in Cloudflare Worker secrets.');
  if(!vault)nextSteps.push('Add CREDENTIALS_KEY in Cloudflare Worker secrets.');
  if(signIn)nextSteps.push('Sign in, then choose whether to connect Google Calendar read-only.');
  return {
    version:'0.4.0',mode:signIn?'consent_ready':'demo_only',
    checks,providers,nextSteps,automaticDiscovery:true,automaticProvisioning:false,
    notice:'Setup detection is automatic; provider authorization and external actions always require explicit approval.'
  };
}

export function planSetup(goal,readiness){
  if(typeof goal!=='string'||goal.trim().length<8||goal.trim().length>500)throw new Error('Describe your goal in 8–500 characters.');
  const id=recommendTemplate(goal.trim());
  const template=templateById(id);
  const needed=[...template.connects];
  const steps=[{id:'demo',title:'Try a safe demonstration',state:'available',action:'sample',detail:'Preview how this assistant works using fictional sample data.'}];
  if(needed.includes('Google Calendar')){
    steps.push({
      id:'calendar',title:'Connect Google Calendar (optional)',state:readiness?.mode==='consent_ready'?'consent_required':'owner_setup',
      action:readiness?.mode==='consent_ready'?'open_live_workspace':'contact_owner',
      detail:'Sign in and approve read-only calendar access on Google’s official permission screen.'
    });
  }
  if(needed.includes('Gmail')){
    steps.push({id:'gmail',title:'Gmail integration',state:'not_enabled',action:'sample',
      detail:'Real inbox access and sending are disabled. Use fictional data until a separate verified integration is approved.'});
  }
  steps.push({id:'review',title:'Review permissions before activation',state:'required',action:'review',
    detail:'Nothing is automatically sent, scheduled, purchased, or changed on an external account.'});
  return {
    suggestedAgent:{id:template.id,name:template.name,description:template.description,tasks:[...template.tasks]},
    requiredServices:needed,steps,execution:'none',source:'deterministic_local_rules',
    notice:'This plan is generated from your request. No API credentials are required from you, and no external service was called.'
  };
}
