import assert from 'node:assert/strict';
import { getProviderDefinition } from '../src/lib/ai-router/registry';
import { forwardChatCompletion } from '../src/lib/ai-router/forward';
import type { RouteTarget } from '../src/lib/ai-router/routing';
import { translateRequest } from '../src/lib/ai-router/translation';
import type { JsonObject } from '../src/lib/ai-router/translation';

const definition = getProviderDefinition('opencode');
assert.ok(definition, 'OpenCode Free must be a registered no-key provider');
assert.deepEqual(definition.authTypes, ['none']);
const { openCodeFreeModels, prepareOpenCodeRequest } = await import('../src/lib/ai-router/opencode-free');
assert.deepEqual(openCodeFreeModels(['gpt-paid','big-pickle','example-free','jev-1.13-free','muse-spark-1.3-contributor-free']),['big-pickle','example-free']);
const original = {model:'big-pickle',messages:[{role:'user',content:'Hello'}],tools:[{type:'function',function:{name:'Bash',parameters:{type:'object',properties:{}}}}],tool_choice:{type:'function',function:{name:'Bash'}}};
const originalCopy=structuredClone(original);
const prepared=prepareOpenCodeRequest(original,'account-1');
const schemaRequest=structuredClone(original);
Object.assign(schemaRequest.tools[0].function.parameters.properties,{template:{default:{function:{name:'Bash'}}}});
assert.deepEqual((prepareOpenCodeRequest(schemaRequest,'account-1').body.tools as typeof schemaRequest.tools)[0].function.parameters,schemaRequest.tools[0].function.parameters,'tool schemas must retain arbitrary function/name data');
assert.equal(prepared.body.stream,true);
assert.deepEqual((prepared.body.tools as {function:{name:string}}[]).map(tool=>tool.function.name),['bash','glob','grep','read']);
assert.equal((prepared.body.tool_choice as {function:{name:string}}).function.name,'bash');
assert.deepEqual(original,originalCopy,'transport preparation cannot mutate the caller request');
assert.equal(prepareOpenCodeRequest(original,'account-1').headers['x-opencode-session'],prepared.headers['x-opencode-session']);
assert.notEqual(prepareOpenCodeRequest(original,'account-2').headers['x-opencode-session'],prepared.headers['x-opencode-session']);
assert.match(prepared.headers['x-opencode-session'],/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
assert.match(prepared.headers['x-opencode-request'],/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
assert.equal(prepareOpenCodeRequest({model:'big-pickle',messages:[]},'account-1').body.tool_choice,'none');
const target:RouteTarget={provider:{id:'oc',name:'OpenCode Free',providerType:'opencode',baseUrl:definition.transport.baseUrl,models:['big-pickle'],priority:40,enabled:true,cooldownUntil:null,authType:'none',format:'openai',headers:definition.transport.headers,forceStream:true},model:'big-pickle',connectionId:'account-1'};
let captured:RequestInit|undefined;
for(const streamed of [false,true]) {
 const upstream={id:'answer',model:'big-pickle',choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'bash',arguments:'{}'}}]},finish_reason:'tool_calls'}]};
 const event={...upstream,choices:[{index:0,delta:upstream.choices[0].message,finish_reason:'tool_calls'}]};
 const response=await forwardChatCompletion({body:{...original,stream:streamed},targets:[target],apiKeyFor:()=>null,fetchImpl:async(_url,init)=>{captured=init;return streamed?new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json(upstream);}});
 assert.equal(response.status,200);
 const headers=new Headers(captured?.headers);
 assert.equal(headers.get('authorization'),'Bearer public');
 assert.match(headers.get('x-opencode-session')!,/^ses_/);
 assert.equal(JSON.parse(captured?.body as string).stream,true);
 assert.ok((await response.text()).includes('Bash'),'JSON and SSE must restore the caller’s tool spelling');
}
for(const sourceFormat of ['openai','claude','openai-responses'] as const) for(const streamed of [false,true]) {
 const frames:JsonObject[]=['ba','sh'].map((name,index)=>({choices:[{index:0,delta:{tool_calls:[{index:0,...(index===0?{id:'call-1',type:'function'}:{}),function:{name,arguments:''}}]},finish_reason:null}]}));
 frames.push({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'{}'}}]},finish_reason:'tool_calls'}]});
 const response=await forwardChatCompletion({body:translateRequest({...original,max_tokens:128,stream:streamed},'openai',sourceFormat,'big-pickle'),sourceFormat,targets:[target],apiKeyFor:()=>null,fetchImpl:async()=>new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 assert.equal(response.status,200);
 assert.ok((await response.text()).includes('Bash'),'fragmented tool names must restore caller spelling for JSON and SSE clients');
}
assert.throws(()=>prepareOpenCodeRequest(original,'account-1').restore({choices:[{message:{tool_calls:[{function:{name:'read',arguments:'{}'}}]}}]}),/undeclared/i,'compatibility tools must never become executable client tools');
for(const streamed of [false,true]) for(const terminator of ['data: [DONE]\n\n','']) {
 const event={choices:[{index:0,delta:{tool_calls:[{index:0,id:'partial',type:'function',function:{name:'ba',arguments:''}}]},finish_reason:null}]};
 const response=await forwardChatCompletion({body:{...original,stream:streamed},targets:[target],apiKeyFor:()=>null,fetchImpl:async()=>new Response('data: '+JSON.stringify(event)+'\n\n'+terminator,{headers:{'content-type':'text/event-stream'}})});
 assert.equal(response.status,502,'terminal markers must reject incomplete buffered tool names');
}
for(const streamed of [false,true]) {
 const event={choices:[{index:0,delta:{tool_calls:[{index:0,id:'complete',type:'function',function:{name:'bash',arguments:'{}'}}]},finish_reason:null}]};
 const response=await forwardChatCompletion({body:{...original,tools:[...original.tools,{type:'function',function:{name:'bash_extra',parameters:{type:'object',properties:{}}}}],stream:streamed},targets:[target],apiKeyFor:()=>null,fetchImpl:async()=>new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 assert.equal(response.status,200);
 assert.ok((await response.text()).includes('Bash'),'terminal markers must flush complete buffered tool names');
}
for(const streamed of [false,true]) {
 const event={choices:[{index:0,delta:{tool_calls:[{index:0,id:'undeclared',type:'function',function:{name:'read',arguments:'{}'}}]},finish_reason:'tool_calls'}]};
 const response=await forwardChatCompletion({body:{...original,stream:streamed},targets:[target],apiKeyFor:()=>null,fetchImpl:async()=>new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 assert.equal(response.status,502,'undeclared compatibility tools must fail before reaching clients');
}
console.log('OpenCode Free checks passed: filtered models, no-key transport, stable sessions, caller tools and JSON/SSE');
