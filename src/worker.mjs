/**
 * MABRIG Agent Concierge — opt-in Google Calendar pilot backend.
 * Isolated from the single-operator AgentOS worker. No external account writes.
 * Depends on Cloudflare D1 + explicitly supplied server-side credentials.
 */
import {TEMPLATES, createAgent} from './engine.mjs';

export const CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
export const ID_SCOPES='openid email profile';
const GOOGLE_AUTH='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO='https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_EVENTS='https://www.googleapis.com/calendar/v3/calendars/primary/events';
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const CORS_DENIED='Request origin is not allowed.';
const NOW=()=>Date.now();

export const b64u=(data)=>{
  const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
  let result='';for(let i=0;i<bytes.length;i++) result+=String.fromCharCode(bytes[i]);
  return btoa(result).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
export const fromB64u=(s)=>{
  if(!/^[A-Za-z0-9_-]+$/.test(s))throw new Error('Invalid encoded value');
  const str=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
  return Uint8Array.from(str,c=>c.charCodeAt(0));
};
const random=(n=32)=>b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha=async(value)=>b64u(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const cookieValue=(request,name)=>{
  const header=request.headers.get('cookie')||'';
  for(const entry of header.split(';')){const [key,...value]=entry.trim().split('=');if(key===name)return value.join('=');}
  return null;
};
const json=(obj,status=200,extra={})=>new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
const error=(msg,status=400)=>json({error:msg},status);
const redirect=(url,extra={})=>new Response(null,{status:303,headers:{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
const redirectCookies=(url,cookies)=>{const headers=new Headers({Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});for(const cookie of cookies)headers.append('Set-Cookie',cookie);return new Response(null,{status:303,headers});};
const unixSeconds=()=>Math.floor(NOW()/1000);
const cookieAttr=(base)=>`Path=/; HttpOnly; SameSite=Lax; ${base.protocol==='https:'?'Secure; ':''}`;
export const sessionCookie=(base)=>base.protocol==='https:'?'__Host-mac_session':'mac_session';
export const oauthCookie=(base)=>base.protocol==='https:'?'__Host-mac_oauth':'mac_oauth';
const setCookie=(key,value,base,age)=>`${key}=${value}; ${cookieAttr(base)}Max-Age=${age}`;
const deleteCookie=(key,base)=>setCookie(key,'',base,0);
function config(env){
  const configured=!!(env.DB&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.CREDENTIALS_KEY&&env.PUBLIC_BASE_URL);
  return {configured,calendarReady:configured};
}
export function safeBaseUrl(env){
  const raw=env.PUBLIC_BASE_URL;
  if(!raw)throw new Error('PUBLIC_BASE_URL missing');
  const u=new URL(raw);
  const local=u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname);
  if(!((u.protocol==='https:'||local)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'))throw new Error('Unsafe PUBLIC_BASE_URL');
  return u;
}
function checkOrigin(request,base){
  const incoming=new URL(request.url);
  // Cloudflare may receive a request with a different host; validate configured canonical host for API.
  if(incoming.origin!==base.origin)return false;
  const origin=request.headers.get('Origin');
  return origin===base.origin;
}
async function keyFromEnv(env){
  const raw=fromB64u(env.CREDENTIALS_KEY||'');
  if(raw.length!==32)throw new Error('CREDENTIALS_KEY must be 32 random base64url bytes');
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptCredential(value,key,aad){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=encoder.encode(JSON.stringify(value));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,bytes);
  return `${b64u(iv)}.${b64u(cipher)}`;
}
export async function decryptCredential(value,key,aad){
  const parts=String(value).split('.');
  if(parts.length!==2)throw new Error('Invalid encrypted data');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64u(parts[0]),additionalData:encoder.encode(aad)},key,fromB64u(parts[1]));
  return JSON.parse(decoder.decode(plain));
}
async function sessionUser(request,env,base){
  const token=cookieValue(request,sessionCookie(base));
  if(!token||!/^[A-Za-z0-9_-]{40,64}$/.test(token))return null;
  const tokenHash=await sha(token);
  const row=await env.DB.prepare('SELECT s.user_id, s.expires_at, s.created_at, u.email, u.google_sub FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').bind(tokenHash).first();
  if(!row||row.expires_at<=unixSeconds())return null;
  return {id:row.user_id,email:row.email,googleSub:row.google_sub,tokenHash,sessionCreatedAt:row.created_at};
}
async function writeSession(env,userId,base){
  const token=random();const hash=await sha(token);const expires=unixSeconds()+7*86400;
  await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(hash,userId,expires,unixSeconds()).run();
  return setCookie(sessionCookie(base),token,base,7*86400);
}
async function logActivity(env,userId,event){
  // Only event types are persisted. No event subjects, messages, credentials or tokens.
  await env.DB.prepare('INSERT INTO activity (user_id,event,created_at) VALUES (?,?,?)').bind(userId,event,unixSeconds()).run();
}
async function checkOAuthThrottle(request,env){
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip)return true; // Local development; production WAF remains mandatory.
  const keyHash=await sha(`${env.CREDENTIALS_KEY}:${ip}`);
  const timestamp=unixSeconds();
  await env.DB.prepare('INSERT INTO oauth_throttle (key_hash,window_start,count) VALUES (?,?,1) ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END').bind(keyHash,timestamp,timestamp-600,timestamp-600).run();
  const state=await env.DB.prepare('SELECT count FROM oauth_throttle WHERE key_hash=?').bind(keyHash).first();
  return state.count<=20;
}
async function oauthStart(request,env,base,action){
  if(!config(env).configured)return error('Server integration is not configured.',503);
  if(!(await checkOAuthThrottle(request,env)))return error('Too many login attempts. Please try again later.',429);
  const user=action==='calendar'?await sessionUser(request,env,base):null;
  if(action==='calendar'&&!user)return error('Sign in before connecting Calendar.',401);
  const state=random(),verifier=random(48),nonce=random();
  const challenge=await sha(verifier),stateHash=await sha(state);
  await env.DB.prepare('INSERT INTO oauth_states (state_hash, verifier, nonce, action, user_id, session_hash, expires_at) VALUES (?,?,?,?,?,?,?)').bind(stateHash,verifier,nonce,action,user?.id||null,user?.tokenHash||null,unixSeconds()+600).run();
  const scope=action==='calendar'?`${ID_SCOPES} ${CALENDAR_SCOPE}`:ID_SCOPES;
  const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/api/oauth/google/callback',base).href,response_type:'code',scope,state,code_challenge:challenge,code_challenge_method:'S256',nonce});
  if(action==='calendar'){params.set('access_type','offline');params.set('prompt','consent');}
  return redirect(`${GOOGLE_AUTH}?${params}`,{'Set-Cookie':setCookie(oauthCookie(base),state,base,600)});
}
async function tokenRequest(env,params){
  const response=await fetch(GOOGLE_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params})});
  if(!response.ok)throw new Error('Google token exchange failed');
  const data=await response.json();if(!data.access_token)throw new Error('Missing provider access token');
  return data;
}
async function googleInfo(token){
  const response=await fetch(GOOGLE_USERINFO,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error('Could not verify Google account identity');
  const data=await response.json();
  if(!data.sub||!data.email||data.email_verified!==true)throw new Error('Google account email is not verified');
  return data;
}
async function oauthCallback(request,env,base){
  const u=new URL(request.url);
  const storedState=cookieValue(request,oauthCookie(base));
  const incomingState=u.searchParams.get('state')||'';
  const cleared=deleteCookie(oauthCookie(base),base);
  if(!storedState||incomingState!==storedState||!u.searchParams.get('code')||u.searchParams.has('error'))return error('Authorization was declined or expired.',400);
  const stateHash=await sha(incomingState);
  const row=await env.DB.prepare('SELECT * FROM oauth_states WHERE state_hash=?').bind(stateHash).first();
  if(!row||row.expires_at<=unixSeconds())return error('Authorization request expired. Start again.',400);
  // Consume a state before calling any provider APIs; a callback cannot be replayed.
  const deleted=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=?').bind(stateHash).run();
  if((deleted.meta?.changes??0)!==1)return error('Authorization request already used.',400);
  const current=row.action==='calendar'?await sessionUser(request,env,base):null;
  if(row.action==='calendar'&&(!current||row.user_id!==current.id||row.session_hash!==current.tokenHash))return error('Session changed. Start the connection again.',401);
  let tokens,info;
  try{
    tokens=await tokenRequest(env,{code:u.searchParams.get('code'),code_verifier:row.verifier,redirect_uri:new URL('/api/oauth/google/callback',base).href,grant_type:'authorization_code'});
    info=await googleInfo(tokens.access_token);
  }catch{return error('Google authorization could not be completed. Please try again.',502);}
  if(row.action==='login'){
    const userId=await sha(`google:${info.sub}`);
    await env.DB.prepare('INSERT INTO users (id,google_sub,email,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email').bind(userId,info.sub,info.email,unixSeconds()).run();
    const cookie=await writeSession(env,userId,base);
    await logActivity(env,userId,'google_sign_in');
    return redirectCookies('/?connected=signin',[cookie,cleared]);
  }
  if(row.action!=='calendar'||current.googleSub!==info.sub)return error('Connected Google account must match your signed-in account.',403);
  // Defensive scope check: never claim calendar is connected without its read scope.
  if(!String(tokens.scope||'').split(/\s+/).includes(CALENDAR_SCOPE))return error('Calendar permission was not granted.',403);
  const key=await keyFromEnv(env);
  const previous=await env.DB.prepare('SELECT encrypted_tokens FROM connections WHERE user_id=? AND provider=?').bind(current.id,'google_calendar').first();
  let oldRefresh;
  if(previous){try{oldRefresh=(await decryptCredential(previous.encrypted_tokens,key,`${current.id}:google_calendar`)).refresh_token;}catch{/* revoked/incompatible key; require new token */}}
  const stored={access_token:tokens.access_token,refresh_token:tokens.refresh_token||oldRefresh||null,expires_at:unixSeconds()+Math.max(60,Number(tokens.expires_in)||3600)-60,scope:tokens.scope};
  const blob=await encryptCredential(stored,key,`${current.id}:google_calendar`);
  await env.DB.prepare('INSERT INTO connections (user_id,provider,encrypted_tokens,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens, updated_at=excluded.updated_at').bind(current.id,'google_calendar',blob,unixSeconds(),unixSeconds()).run();
  await logActivity(env,current.id,'calendar_connected');
  return redirect('/?connected=calendar',{'Set-Cookie':cleared});
}
async function connections(env,user){
  const row=await env.DB.prepare('SELECT 1 AS connected FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').first();
  return {googleCalendar:!!row, gmail:false};
}
async function calendarAccess(env,user){
  const row=await env.DB.prepare('SELECT encrypted_tokens FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').first();
  if(!row)throw Object.assign(new Error('Connect Google Calendar first.'),{status:409});
  const key=await keyFromEnv(env);
  const stored=await decryptCredential(row.encrypted_tokens,key,`${user.id}:google_calendar`);
  if(stored.expires_at>unixSeconds()+20)return stored.access_token;
  if(!stored.refresh_token)throw Object.assign(new Error('Calendar access expired. Reconnect your Google account.'),{status:409});
  let fresh;
  try{fresh=await tokenRequest(env,{refresh_token:stored.refresh_token,grant_type:'refresh_token'});}catch{throw Object.assign(new Error('Calendar access expired. Reconnect your Google account.'),{status:409});}
  const updated={...stored,access_token:fresh.access_token,refresh_token:fresh.refresh_token||stored.refresh_token,expires_at:unixSeconds()+Math.max(60,Number(fresh.expires_in)||3600)-60};
  const blob=await encryptCredential(updated,key,`${user.id}:google_calendar`);
  await env.DB.prepare('UPDATE connections SET encrypted_tokens=?,updated_at=? WHERE user_id=? AND provider=?').bind(blob,unixSeconds(),user.id,'google_calendar').run();
  return updated.access_token;
}
export function makeCalendarBrief(items,now=new Date()){
  const events=(Array.isArray(items)?items:[]).filter(e=>e?.start?.dateTime||e?.start?.date).slice(0,20).map(e=>({id:String(e.id||'').slice(0,160),title:String(e.summary||'Untitled event').slice(0,160),start:e.start.dateTime||e.start.date,end:e.end?.dateTime||e.end?.date||null,location:String(e.location||'').slice(0,160)}));
  const today=now.toISOString().slice(0,10);
  return {source:'GOOGLE_CALENDAR_READ_ONLY',windowDays:7,count:events.length,todayCount:events.filter(e=>e.start.slice(0,10)===today).length,events,generatedAt:now.toISOString(),warning:'Events are shown only to you. Nothing was modified or sent to an AI provider.'};
}
async function liveBrief(env,user){
  const token=await calendarAccess(env,user);
  const start=new Date().toISOString();const end=new Date(NOW()+7*86400000).toISOString();
  const url=new URL(GOOGLE_EVENTS);
  url.search=new URLSearchParams({timeMin:start,timeMax:end,maxResults:'20',singleEvents:'true',orderBy:'startTime',fields:'items(id,summary,start,end,location),nextPageToken'}).toString();
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  if(response.status===401||response.status===403)throw Object.assign(new Error('Calendar permissions need attention. Reconnect your Google account.'),{status:409});
  if(!response.ok)throw Object.assign(new Error('Google Calendar is temporarily unavailable.'),{status:502});
  const body=await response.json();return makeCalendarBrief(body.items);
}
async function readBody(request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Object.assign(new Error('Content-Type must be application/json'),{status:415});
  if(Number(request.headers.get('content-length')||0)>5000)throw Object.assign(new Error('Request is too large'),{status:413});
  const text=await request.text();if(text.length>5000)throw Object.assign(new Error('Request is too large'),{status:413});
  try{return JSON.parse(text);}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
}
async function listAgents(env,user){
  const rows=await env.DB.prepare('SELECT id,name,goal,template_id,status,created_at FROM agents WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
  return rows.results||[];
}
async function createSavedAgent(request,env,user){
  const body=await readBody(request);
  if(!body||typeof body.goal!=='string'||body.goal.trim().length<8||body.goal.length>500||!TEMPLATES.some(t=>t.id===body.templateId))return error('Choose a valid assistant type and describe its goal (8–500 characters).');
  const total=await env.DB.prepare('SELECT COUNT(*) AS total FROM agents WHERE user_id=?').bind(user.id).first();
  if((total?.total||0)>=50)return error('This pilot supports up to 50 saved assistants per workspace.',409);
  const agent=createAgent({goal:body.goal,templateId:body.templateId,customName:body.customName||''});
  await env.DB.prepare('INSERT INTO agents (id,user_id,name,goal,template_id,status,created_at) VALUES (?,?,?,?,?,?,?)').bind(agent.id,user.id,agent.name,agent.goal,agent.templateId,'paused',unixSeconds()).run();
  await logActivity(env,user.id,'agent_recipe_saved');
  return json({id:agent.id,name:agent.name,status:'paused',message:'Saved privately. Execution is off until live actions are enabled.'},201);
}
async function toggleSavedAgent(request,env,user,id){
  const data=await readBody(request);
  if(!['paused','ready'].includes(data?.status))return error('Status must be paused or ready.');
  const result=await env.DB.prepare('UPDATE agents SET status=? WHERE id=? AND user_id=?').bind(data.status,id,user.id).run();
  if((result.meta?.changes??0)!==1)return error('Agent not found.',404);
  await logActivity(env,user.id,data.status==='paused'?'agent_paused':'agent_marked_ready');
  return json({id,status:data.status,notice:'Ready means available for read-only preparation; no background task or message sending is enabled.'});
}
async function disconnect(env,user){
  const connection=await env.DB.prepare('SELECT encrypted_tokens FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').first();
  if(!connection)return json({disconnected:true,providerRevoked:false,note:'Already disconnected locally.'});
  // Delete the token first so our service can no longer access Calendar, even if revocation fails.
  await env.DB.prepare('DELETE FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').run();
  await logActivity(env,user.id,'calendar_disconnected');
  let revoked=false;
  try{
    const key=await keyFromEnv(env);const decoded=await decryptCredential(connection.encrypted_tokens,key,`${user.id}:google_calendar`);
    const token=decoded.refresh_token||decoded.access_token;
    if(token){const resp=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})});revoked=resp.ok;}
  }catch{/* revoke best effort; local access already deleted */}
  return json({disconnected:true,providerRevoked:revoked,note:revoked?'Google authorization revoked.':'Disconnected locally. For complete revocation, remove MABRIG access in your Google Account permissions.'});
}

/** Probe the already-authorized Calendar events endpoint with the smallest possible
 * response. No private event content is returned, persisted or forwarded. */
async function calendarHealth(env,user){
  const existing=await env.DB.prepare('SELECT 1 AS connected FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').first();
  if(!existing)return json({status:'not_connected',action:'connect',message:'Connect Google Calendar to prepare a read-only agenda.'});
  let token;
  try{token=await calendarAccess(env,user);}catch(e){
    if(e?.status===409)return json({status:'needs_reconnect',action:'reconnect',message:'Authorization expired. Disconnect and reconnect Google Calendar.'});
    return json({status:'temporarily_unavailable',action:'retry',message:'Unable to check this connection. Try again later.'});
  }
  try{
    const url=new URL(GOOGLE_EVENTS);
    url.search=new URLSearchParams({maxResults:'1',fields:'items(id)',showDeleted:'false'}).toString();
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    if(response.status===401||response.status===403)return json({status:'needs_reconnect',action:'reconnect',message:'Google rejected this authorization. Disconnect and reconnect.'});
    if(!response.ok)return json({status:'temporarily_unavailable',action:'retry',message:'Google Calendar could not be reached. Try again later.'});
    await logActivity(env,user.id,'calendar_connection_checked');
    return json({status:'healthy',action:'none',checkedAt:new Date().toISOString(),message:'Calendar connection is working. No event details were retrieved.'});
  }catch{
    return json({status:'temporarily_unavailable',action:'retry',message:'Connection check failed. Try again later.'});
  }
}
/** JSON-only export of user-owned service records: no OAuth tokens, subject IDs,
 * session hashes, keys or Calendar event details are included. */
async function exportAccount(env,user){
  const [u,agents,activity,connections]=await Promise.all([
    env.DB.prepare('SELECT email,created_at FROM users WHERE id=?').bind(user.id).first(),
    env.DB.prepare('SELECT id,name,goal,template_id,status,created_at FROM agents WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all(),
    env.DB.prepare('SELECT event,created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 1000').bind(user.id).all(),
    env.DB.prepare('SELECT provider,created_at,updated_at FROM connections WHERE user_id=?').bind(user.id).all()
  ]);
  if(!u)return error('Account no longer exists.',404);
  return json({format:'mabrig-agent-concierge-account-export',version:1,exportedAt:new Date().toISOString(),account:u,agents:agents.results||[],activity:activity.results||[],connections:connections.results||[],note:'Secrets, provider credentials, Google Calendar events and sessions are intentionally excluded.'},200,{'Content-Disposition':'attachment; filename="concierge-account-export.json"'});
}
async function deleteSavedAgent(env,user,id){
  const deleted=await env.DB.prepare('DELETE FROM agents WHERE id=? AND user_id=?').bind(id,user.id).run();
  if((deleted.meta?.changes??0)!==1)return error('Assistant not found.',404);
  await logActivity(env,user.id,'agent_recipe_deleted');
  return json({deleted:true,id});
}
/** Destructive account deletion is origin-protected and requires an exact confirmation
 * plus a recently created session. D1 batch is transactional; child rows must not linger.
 * Provider revocation is best-effort *after* local records are removed. */
async function deleteAccount(request,env,user,base){
  const body=await readBody(request);
  if(body?.confirmation!=='DELETE MY ACCOUNT'||body?.email!==user.email)return error('Confirm deletion with your exact signed-in email and DELETE MY ACCOUNT.',400);
  if(unixSeconds()-user.sessionCreatedAt>1800)return error('For account deletion, sign in again so your session is less than 30 minutes old.',409);
  const connection=await env.DB.prepare('SELECT encrypted_tokens FROM connections WHERE user_id=? AND provider=?').bind(user.id,'google_calendar').first();
  if(typeof env.DB.batch!=='function')return error('Secure account deletion is unavailable. Contact support; your data was not deleted.',503);
  const statements=[
    env.DB.prepare('DELETE FROM oauth_states WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM connections WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM agents WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM activity WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id)
  ];
  await env.DB.batch(statements);
  let providerRevoked=false;
  if(connection){try{
    const key=await keyFromEnv(env);
    const decoded=await decryptCredential(connection.encrypted_tokens,key,`${user.id}:google_calendar`);
    const token=decoded.refresh_token||decoded.access_token;
    if(token){const response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})});providerRevoked=response.ok;}
  }catch{/* account deletion is durable; provider revocation remains manual if necessary */}}
  return json({deleted:true,providerRevoked,notice:providerRevoked||!connection?'Your Concierge account and its stored data were deleted.':'Your Concierge account and its stored data were deleted. To revoke Google access fully, remove MABRIG from your Google Account permissions.'},200,{'Set-Cookie':deleteCookie(sessionCookie(base),base)});
}

export async function handleApi(request,env){
  const u=new URL(request.url);const path=u.pathname;
  if(path==='/api/health')return json({ok:true,app:'mabrig-agent-concierge',version:'0.3.0'});
  if(!config(env).configured){if(path==='/api/status')return json({configured:false,signedIn:false,connection:{googleCalendar:false,gmail:false},notice:'Owner must configure a separate Worker and verified Google OAuth first.'});return error('Live service is not configured. You can still use safe sample demos.',503);}
  let base;try{base=safeBaseUrl(env);}catch{return error('Service URL configuration is invalid.',503);}
  if(u.origin!==base.origin)return error('Unrecognized host.',403);
  if(path==='/api/oauth/google/callback'&&request.method==='GET')return oauthCallback(request,env,base);
  if(path==='/api/auth/google/start'&&request.method==='GET')return oauthStart(request,env,base,'login');
  if(path==='/api/calendar/connect/start'&&request.method==='GET')return oauthStart(request,env,base,'calendar');
  const user=await sessionUser(request,env,base);
  if(path==='/api/status'&&request.method==='GET')return json({configured:true,signedIn:!!user,email:user?.email||null,connection:user?await connections(env,user):{googleCalendar:false,gmail:false},notice:'Gmail remains disabled pending separate approval and verification.'});
  if(!user)return error('Sign in with Google to access this workspace.',401);
  if(request.method!=='GET'&&!checkOrigin(request,base))return error(CORS_DENIED,403);
  if(path==='/api/auth/logout'&&request.method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(user.tokenHash).run();
    return json({signedOut:true},200,{'Set-Cookie':deleteCookie(sessionCookie(base),base)});
  }
  if(path==='/api/account/export'&&request.method==='GET')return exportAccount(env,user);
  if(path==='/api/account/delete'&&request.method==='POST')return deleteAccount(request,env,user,base);
  if(path==='/api/connections/google-calendar/health'&&request.method==='GET')return calendarHealth(env,user);
  if(path==='/api/connections'&&request.method==='GET')return json(await connections(env,user));
  if(path==='/api/activity'&&request.method==='GET'){const rows=await env.DB.prepare('SELECT event,created_at FROM activity WHERE user_id=? ORDER BY id DESC LIMIT 50').bind(user.id).all();return json({activity:rows.results||[]});}
  if(path==='/api/connections/google-calendar/disconnect'&&request.method==='POST')return disconnect(env,user);
  if(path==='/api/calendar/brief'&&request.method==='GET')return json(await liveBrief(env,user));
  if(path==='/api/agents'&&request.method==='GET')return json({agents:await listAgents(env,user)});
  if(path==='/api/agents'&&request.method==='POST')return createSavedAgent(request,env,user);
  const prepare=path.match(/^\/api\/agents\/([a-f0-9-]{36})\/prepare$/);
  if(prepare&&request.method==='POST'){
    const agent=await env.DB.prepare('SELECT template_id,status FROM agents WHERE id=? AND user_id=?').bind(prepare[1],user.id).first();
    if(!agent)return error('Agent not found.',404);
    if(agent.status!=='ready')return error('Mark this assistant ready before running it.',409);
    if(!['meetings','personal'].includes(agent.template_id))return error('Only Calendar-based assistants have a live read-only task in this pilot.',409);
    const brief=await liveBrief(env,user);
    await logActivity(env,user.id,'calendar_brief_prepared');
    return json({...brief,agentId:prepare[1]});
  }
  const deleteAgent=path.match(/^\/api\/agents\/([a-f0-9-]{36})$/);
  if(deleteAgent&&request.method==='DELETE')return deleteSavedAgent(env,user,deleteAgent[1]);
  const toggle=path.match(/^\/api\/agents\/([a-f0-9-]{36})\/status$/);
  if(toggle&&request.method==='POST')return toggleSavedAgent(request,env,user,toggle[1]);
  return error('Not found.',404);
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      try{return await handleApi(request,env);}catch(e){
        // Intentionally avoid logging details, tokens, event titles or provider responses.
        if(e?.status)return error(e.message,e.status);
        return error('The service could not complete this request. Please try again.',503);
      }
    }
    if(env.ASSETS)return env.ASSETS.fetch(request);
    return error('Static assets binding is not configured.',503);
  }
};