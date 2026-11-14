/** Pure, offline concierge planning and sample-data simulation.
 * This module never calls external APIs or handles credentials.
 */
export const TEMPLATES = Object.freeze([
  {id:'inbox', emoji:'✉', name:'Email Assistant', category:'Communication', description:'Triage important messages and prepare thoughtful reply drafts.', connects:['Gmail'], tasks:['Summarize priority messages','Prepare reply drafts','Flag messages requiring attention']},
  {id:'meetings', emoji:'◷', name:'Meeting Assistant', category:'Productivity', description:'Prepare meeting briefs, action items and daily agendas.', connects:['Google Calendar','Gmail'], tasks:['Prepare a daily meeting brief','List preparation notes','Surface follow-up actions']},
  {id:'customers', emoji:'◎', name:'Customer Follow-ups', category:'Business', description:'Organize leads, follow-up reminders and approval-ready customer messages.', connects:['Gmail'], tasks:['Organize customer requests','Prepare follow-up drafts','Highlight unanswered enquiries']},
  {id:'personal', emoji:'✦', name:'Personal Organizer', category:'Everyday life', description:'Turn a busy schedule into a simple daily plan.', connects:['Google Calendar'], tasks:['Prepare tomorrow’s plan','Highlight schedule conflicts','Create an easy-to-read checklist']},
]);
export const SAFETY_RULES = Object.freeze([
  {id:'approval',title:'Require approval before sending',description:'Never send an email or message without you reviewing it.'},
  {id:'readOnly',title:'Read-only access by default',description:'Only suggest changes until you explicitly allow them.'},
  {id:'restricted',title:'No financial or account changes',description:'Never make purchases, payments or security changes.'},
]);
export function recommendTemplate(goal='') {
  const g=goal.toLowerCase();
  if (/(meeting|appointment|calendar|agenda|schedule|conference)/.test(g)) return 'meetings';
  if (/(customer|client|lead|sales|order|business|follow.up|enquir|enquir|whatsapp)/.test(g)) return 'customers';
  if (/(personal|family|organize my day|daily plan|remind|todo|to.do)/.test(g)) return 'personal';
  return 'inbox';
}
export function templateById(id) { return TEMPLATES.find(t=>t.id===id) ?? TEMPLATES[0]; }
export function createAgent({goal,templateId,customName,settings={}}) {
  const safeGoal=String(goal??'').trim().slice(0,500);
  if(safeGoal.length<8) throw new Error('Describe what you want your assistant to do in at least 8 characters.');
  const template=templateById(templateId??recommendTemplate(safeGoal));
  const name=String(customName??'').trim().slice(0,60)||template.name;
  return {
    id: typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`agent-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name,goal:safeGoal,templateId:template.id,connections:[...template.connects],
    rules:{approval:true,readOnly:true,restricted:true,...Object.fromEntries(Object.entries(settings).filter(([k])=>['approval','readOnly','restricted'].includes(k)))},
    status:'demo-ready',createdAt:new Date().toISOString(),lastRun:null,runCount:0
  };
}
const EXAMPLES={
  inbox:{heading:'Your inbox, under control',summary:'Example: 3 messages reviewed • 2 reply drafts prepared • 1 message flagged.',items:[
    {label:'Priority',title:'Meeting confirmation from Ada',detail:'Reply draft: “Thank you, Ada. I confirm Thursday at 10:00 AM.”',approval:true},
    {label:'Draft',title:'Enquiry about service pricing',detail:'Reply draft: “Thanks for reaching out. Could you share your project requirements?”',approval:true},
    {label:'Flagged',title:'Account sign-in alert',detail:'Potential security notification: review this yourself; no action taken.',approval:false}
  ]},
  meetings:{heading:'Tomorrow, prepared',summary:'Example: 2 meetings summarized • 1 schedule conflict flagged.',items:[
    {label:'Brief',title:'10:00 AM — Project review',detail:'Prepare a progress summary and list two key decisions.',approval:false},
    {label:'Brief',title:'2:00 PM — Client introduction',detail:'Prepare three discovery questions and a short agenda.',approval:false},
    {label:'Flagged',title:'Overlapping invitation',detail:'Example calendar overlap detected. Review before responding.',approval:false}
  ]},
  customers:{heading:'Every customer matters',summary:'Example: 3 enquiries reviewed • 2 follow-up drafts prepared.',items:[
    {label:'Draft',title:'New customer — app quotation',detail:'Draft: “Thank you for your interest. What features would you like in your app?”',approval:true},
    {label:'Draft',title:'Follow-up — pending proposal',detail:'Draft: “I’m checking whether you had a chance to review the proposal.”',approval:true},
    {label:'Reminder',title:'Response due tomorrow',detail:'One sample customer thread still needs your attention.',approval:false}
  ]},
  personal:{heading:'A calmer day, organized',summary:'Example: 3 priorities arranged • 1 scheduling suggestion.',items:[
    {label:'Plan',title:'Morning focus block',detail:'Set aside 45 minutes to work on the most important task.',approval:false},
    {label:'Reminder',title:'Prepare for an appointment',detail:'Collect your questions and documents the night before.',approval:false},
    {label:'Suggestion',title:'Protect a break',detail:'Leave a short buffer between commitments.',approval:false}
  ]}
};
export function simulateAgent(agent) {
  if(!agent||agent.status==='paused') throw new Error('Resume this assistant before running its demonstration.');
  const example=EXAMPLES[agent.templateId]||EXAMPLES.inbox;
  return {...example,source:'SAMPLE_DATA_ONLY',agentId:agent.id,createdAt:new Date().toISOString(),items:example.items.map((item,i)=>({...item,id:`${agent.id}-${Date.now()}-${i}`}))};
}
export function connectionList(agents) {return [...new Set((agents||[]).flatMap(a=>a.connections||[]))];}
export function safeExport(state) {return JSON.stringify({format:'mabrig-agent-concierge-demo-v1',agents:state.agents??[],activity:state.activity??[],approvals:state.approvals??[]},null,2);}