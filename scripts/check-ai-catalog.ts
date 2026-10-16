import assert from 'node:assert/strict';
import { providerAccountStats, providerPresetId } from '../src/features/ai-router/provider-catalog';
import type { AiProviderSummary, AiConnectionSummary } from '../src/features/ai-router/api/types';
const now = 1000;
const provider: AiProviderSummary = { id:'p', name:'OpenAI', providerType:'openai', alias:null, format:'openai', authType:'api_key', baseUrl:'https://api.openai.com/v1',models:[],priority:1,enabled:true,cooldownUntil:null,lastError:null,hasApiKey:false,oauthConfigured:true };
const account: AiConnectionSummary = { id:'a',providerId:'p',name:'One',authType:'api_key',priority:1,isActive:true,allowedModels:[],expiresAt:null,rateLimitedUntil:null,lastError:null,hasApiKey:true,hasAccessToken:false,hasRefreshToken:false };
const accounts = [account,{...account,id:'disabled',isActive:false},{...account,id:'missing',hasApiKey:false},{...account,id:'cooldown',rateLimitedUntil:new Date(2000)},{...account,id:'expired',authType:'oauth' as const,hasApiKey:false,hasAccessToken:true,expiresAt:new Date(500)},{...account,id:'refreshable',authType:'oauth' as const,hasApiKey:false,hasAccessToken:true,hasRefreshToken:true,expiresAt:new Date(500)},{...account,id:'other',providerId:'other'}];
assert.deepEqual(providerAccountStats({...provider,oauthConfigured:false},accounts,now),{total:6,available:1});
assert.deepEqual(providerAccountStats(provider, accounts, now), {total:6,available:2});
assert.deepEqual(providerAccountStats({...provider,enabled:false},accounts,now),{total:6,available:0});
assert.deepEqual(providerAccountStats({...provider,cooldownUntil:new Date(2000)},accounts,now),{total:6,available:2});
assert.equal(providerPresetId(provider),'openai');
assert.equal(providerPresetId({...provider,providerType:'custom',baseUrl:'https://openrouter.ai/api/v1/'}),'openrouter');
assert.equal(providerPresetId({...provider,providerType:'custom',baseUrl:'https://private.example/v1'}),'custom');
console.log('AI catalog checks passed: account availability, counts and preset matching');

// Snippets must round-trip model IDs without altering shell/JSON quoting.
const { gatewayRequestExample } = await import('../src/features/ai-router/client-setup');
const quotedModel = `provider/a'"b`;
for (const format of ['openai', 'claude', 'openai-responses'] as const) {
  const curl = gatewayRequestExample('https://devone.example/api/ai/v1', quotedModel, format);
  const payloadText = curl.split("  -d ")[1];
  const decoded = payloadText.slice(1, -1).replaceAll("'\\''", "'");
  assert.equal(JSON.parse(decoded).model, quotedModel);
  assert.ok(curl.includes('Authorization: Bearer $DEVONE_AI_KEY'));
}
console.log('AI client setup checks passed: protocol examples and safe quoting');
