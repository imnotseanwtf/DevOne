import assert from 'node:assert/strict';
import { mock } from 'bun:test';
let user={id:'admin'}, calls=[], fail=false, available=true;
const providers=[{id:'p',name:'Test provider',providerType:'custom',baseUrl:'https://upstream.example/v1',models:['m'],enabled:true,priority:1,cooldownUntil:null,authType:'api_key',format:'openai'}];
const accounts=[{id:'first',providerId:'p',apiKey:'first-secret'},{id:'second',providerId:'p',apiKey:'second-secret'}];
const state={providers,combos:[],settings:{defaultModel:'Test provider/m',compressToolOutput:false,maxToolOutputChars:30000},apiKeyFor:()=>null,targetsFor:targets=>available?targets.flatMap(target=>accounts.map(account=>({...target,connectionId:account.id}))):[],credentialFor:async target=>({...accounts.find(account=>account.id===target.connectionId),authType:'api_key'}),refreshCredential:async()=>null};
const afterTasks=[];
mock.module('../src/features/ai-router/service.ts',()=>({findCallerByKey:async()=>null,loadRouterState:async()=>state,requireAiAdmin:async id=>{if(id!=='admin')throw new Error('Administrators only');},recordProviderFailure:async()=>{},recordUsage:async()=>{},gatewayFetch:async(url,init)=>{init.signal?.throwIfAborted();calls.push({url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)});return fail?Response.json({error:{message:'Account refused'}},{status:401}):Response.json(providers[0].providerType==='codex'?{id:'r',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Selected account replied'}]}]}:{choices:[{message:{role:'assistant',content:'Selected account replied'},finish_reason:'stop'}]});}}));
mock.module('../src/lib/auth/session.ts',()=>({getCurrentUser:async()=>user}));
mock.module('next/server',()=>({after:work=>afterTasks.push(work)}));
const {handleChatCompletion}=await import('../src/features/ai-router/request.ts');
const request=(body,origin='https://devone.example')=>new Request('https://devone.example/api/ai/connections/second/test',{method:'POST',headers:{host:'devone.example',origin,'content-type':'application/json'},body:JSON.stringify(body)});
const body={model:'m',messages:[{role:'user',content:'Hello'}]};
user={id:'member'};
assert.equal((await handleChatCompletion(request(body),'openai','second')).status,403,'Members cannot test shared accounts');
user={id:'admin'};
assert.equal((await handleChatCompletion(request(body,'https://elsewhere.example'),'openai','second')).status,401);
assert.equal(calls.length,0,'Rejected callers cannot spend upstream quota');
let response=await handleChatCompletion(request(body),'openai','second');
assert.equal(response.status,200);
assert.equal((await response.json()).choices[0].message.content,'Selected account replied');
assert.equal(calls.length,1);
assert.equal(calls[0].headers.get('authorization'),'Bearer second-secret','Test must select the exact account, regardless of priority');
assert.equal(calls[0].body.stream,false);
assert.equal(calls[0].body.max_tokens,512,'Test output must be bounded');
calls=[];fail=true;
response=await handleChatCompletion(request(body),'openai','second');
assert.equal(response.status,401);
assert.equal(calls.length,1,'A failed selected account must never fall back to a sibling');
fail=false;calls=[];
assert.equal((await handleChatCompletion(request(body),'openai','missing')).status,503);
assert.equal((await handleChatCompletion(request({...body,model:'unknown'}),'openai','second')).status,400,'A test must not substitute the configured default model');
assert.equal((await handleChatCompletion(request({...body,tools:[{type:'function',function:{name:'bash'}}]}),'openai','second')).status,400,'Diagnostic chat accepts only bounded text messages');
assert.equal((await handleChatCompletion(request({...body,messages:[{role:'system',content:'hidden'}]}),'openai','second')).status,400);
assert.equal((await handleChatCompletion(request({...body,messages:[{role:'user',content:'x'.repeat(8001)}]}),'openai','second')).status,400);
assert.equal(calls.length,0);
available=false;
assert.equal((await handleChatCompletion(request(body),'openai','second')).status,503);
assert.equal(calls.length,0,'Unavailable accounts cannot be bypassed by tests');
available=true;calls=[];providers[0].providerType='codex';providers[0].format='openai-responses';
response=await handleChatCompletion(request(body),'openai','second');
assert.equal(response.status,200,'Codex diagnostic requests must not include unsupported token-limit fields');
assert.equal(calls.length,1);
assert.equal(calls[0].body.max_output_tokens,undefined);
assert.equal((await response.json()).choices[0].message.content,'Selected account replied');
const savedTimeout=AbortSignal.timeout;
try {
 AbortSignal.timeout=()=>AbortSignal.abort(new DOMException('Timed out','TimeoutError'));
 assert.equal((await handleChatCompletion(request(body),'openai','second')).status,504,'Absolute diagnostic deadline must report timeout rather than client cancellation');
} finally {AbortSignal.timeout=savedTimeout;}
await Promise.all(afterTasks.map(work=>work()));

// The browser service must keep long replies usable as subsequent test-chat history.
const {testConnection}=await import('../src/features/ai-router/api/connection-test/service.ts');
const originalFetch=globalThis.fetch;
try {
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:'x'.repeat(8001)}}]});
 const result=await testConnection('second',{model:'m',messages:[{role:'user',content:'Hello'}]},new AbortController().signal);
 assert.equal(result.message.length,8000,'Long Codex replies must fit the next diagnostic conversation');
 assert.equal(result.truncated,true);
 globalThis.fetch=async()=>Response.json({choices:[]});
 await assert.rejects(testConnection('second',{model:'m',messages:[]},new AbortController().signal),/invalid response/i);
} finally {globalThis.fetch=originalFetch;}

console.log('AI connection chat checks passed: authorization, exact account/no fallback, Codex, deadline, bounded replies and invalid responses');
