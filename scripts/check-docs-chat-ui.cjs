// Run with a local dev server and DEVONE_PLAYWRIGHT_PATH pointing to an installed Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require(process.env.DEVONE_PLAYWRIGHT_PATH || 'playwright');
const env = { ...require('dotenv').parse(fs.readFileSync('.env')), ...process.env };
const local = ['localhost', '127.0.0.1', '[::1]'];
assert.ok(local.includes(new URL(env.DEVONE_APP_URL).hostname), 'Use a local application only');
const id = 'docs-chat-ui-fixture';
const fixturePath = 'src/app/devone-docs-chat-fixture';
assert.ok(!fs.existsSync(fixturePath), 'The temporary preview route must not already exist');
let createdFixture = false;
const original = '# Quick start\n\nRun bun run dev.\n';
let browser, page, stream, streamClosed = false, requests = [], releaseModels;
const modelGate = new Promise(resolve => releaseModels = resolve);
let modelMode = 'loading';
const textFrame = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const upstream = http.createServer(async (req, res) => {
  let raw = ''; for await (const bytes of req) raw += bytes;
  const body = JSON.parse(raw); requests.push(body);
  const question = body.messages.at(-1).content;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'access-control-allow-origin': env.DEVONE_APP_URL, 'access-control-allow-credentials': 'true', 'x-devone-can-edit': '1', 'x-devone-sources': encodeURIComponent(JSON.stringify([{ slug: 'quick-start', title: 'Quick start' }])) });
  res.flushHeaders();
  if (question === 'close' || (question === 'slow' && requests.filter(value => value.messages.at(-1).content === 'slow').length === 1)) {
    stream = res; streamClosed = false; res.on('close', () => { streamClosed = true; });
    res.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'); return;
  }
  if (question === 'error') { res.write(textFrame('Partial answer')); res.end('data: {"error":{"message":"Fixture upstream interrupted"}}\n\n'); return; }
  const answer = question === 'rewrite' ? 'Here is the proposed edit.\n\n```devone-doc\n# Updated guide\n\nUse bun run dev.\n```' : '## Getting started\n\nUse **Bun** to run the app.\n\n- Install dependencies\n- Start the server\n\n```sh\nbun run dev\n```\n\n<script>window.__unsafe = true</script>';
  res.end(textFrame(answer) + 'data: [DONE]\n\n');
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let i = 0; i < 60; i++) { if (await check()) return; await pause(100); } throw new Error(label); }
(async () => {
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(18082, '127.0.0.1', resolve); });
  // Mount the production components in a temporary Next dev route; remove it even on failure.
  fs.mkdirSync(fixturePath); createdFixture = true;
  fs.writeFileSync(fixturePath + '/page.tsx', `
'use client';
import { useEffect, useRef, useState } from 'react';
import { DocsAssistantProvider, useDocsAssistant } from '@/features/docs-chat/components/docs-assistant';
import { DocsChat, DocsChatToggle } from '@/features/docs-chat/components/docs-chat';
function Preview() {
  const { register } = useDocsAssistant();
  const [markdown, setMarkdown] = useState(${JSON.stringify(original)});
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const latest = useRef(markdown); latest.current = markdown;
  useEffect(() => { register({ docId: 'fixture', getMarkdown: () => latest.current, replaceMarkdown: setMarkdown }); return () => register(null); }, [register]);
  return <main data-ready={ready} className='mx-auto flex max-w-5xl flex-col gap-4 p-4'><div><DocsChatToggle /></div><form data-testid='outer-form' onSubmit={(event) => { event.preventDefault(); event.currentTarget.dataset.submitted = 'true'; }} className='grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_26rem]'><section className='min-w-0'><h1 className='text-xl font-semibold'>Quick start</h1><pre data-testid='document' className='mt-4 whitespace-pre-wrap'>{markdown}</pre></section><DocsChat projectId='${id}' currentSlug='quick-start' currentTitle='Quick start' /></form></main>;
}
export default function Page() { return <DocsAssistantProvider><Preview /></DocsAssistantProvider>; }
`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/ai/v1/models', async route => {
    if (modelMode === 'loading') await modelGate;
    await route.fulfill({ status: modelMode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ data: ['auto', 'claude-sonnet-5-5', 'cc/claude-sonnet-5-5', 'cx/gpt-6.1-sol'].map(id => ({ id })) }) });
  });
  await page.route(`**/api/projects/${id}/docs/chat`, route => route.continue({ url: 'http://127.0.0.1:18082/chat' }));
  const url = env.DEVONE_APP_URL + '/devone-docs-chat-fixture';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('main[data-ready="true"]').waitFor();
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const picker = page.getByLabel('AI model', { exact: true });
  await picker.getByText('Loading models…').waitFor(); await picker.click();
  await page.getByRole('status').filter({ hasText: 'Loading models…' }).waitFor();
  modelMode = 'ready'; releaseModels();
  const search = page.getByRole('combobox', { name: 'Search models' });
  await search.fill('sonnet 5.5');
  await page.getByRole('option', { name: 'Claude Sonnet 5.5 (via Claude Code)', exact: true }).click();
  await search.waitFor({ state: 'hidden' });
  assert.match(await picker.innerText(), /Claude Sonnet 5.5/);
  assert.equal(await page.evaluate(() => localStorage.getItem('devone:docs-ai-model')), 'cc/claude-sonnet-5-5');
  await picker.click(); await search.fill('nothing matches'); await page.getByText('No models found.', { exact: true }).waitFor(); await page.keyboard.press('Escape');
  const composer = page.getByRole('textbox', { name: 'Question', exact: true });
  await composer.fill('hello'); await composer.press('Shift+Enter'); assert.equal(await composer.inputValue(), 'hello\n');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const log = page.getByRole('log', { name: 'Conversation' });
  await log.getByRole('heading', { name: 'Getting started' }).waitFor();
  assert.equal(await log.locator('strong').innerText(), 'Bun'); assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  assert.equal(requests.at(-1).model, 'cc/claude-sonnet-5-5');
  assert.equal(await page.getByTestId('outer-form').getAttribute('data-submitted'), null, 'chat Send must not submit an enclosing task form');
  await page.getByRole('button', { name: 'Copy response', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /## Getting started/);
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
  assert.equal(requests.at(-1).messages.length, 1, 'regeneration replaces the previous answer without duplicating its question');
  await page.screenshot({ path: '/tmp/devone-docs-chat-desktop.png', fullPage: true });
  await composer.fill('slow'); await composer.press('Enter');
  await log.getByRole('status').filter({ hasText: 'Thinking…' }).waitFor();
  await until(() => !!stream, 'stream did not start');
  stream.write(textFrame(Array.from({ length: 35 }, (_, i) => `Paragraph ${i + 1}. This is a streamed answer with enough content to scroll.\n\n`).join('')));
  await log.getByText('Paragraph 35.', { exact: false }).waitFor();
  await log.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.getByRole('button', { name: 'Scroll to latest message' }).waitFor();
  stream.write(textFrame('\nStill streaming.\n')); await log.getByText('Still streaming.', { exact: true }).waitFor();
  assert.equal(await log.evaluate(element => element.scrollTop), 0, 'streaming must not pull someone away from older messages');
  await page.getByRole('button', { name: 'Scroll to latest message' }).click();
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await log.getByText('Response stopped', { exact: true }).waitFor(); await until(() => streamClosed, 'stop did not cancel the upstream request');
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await page.getByRole('button', { name: 'Regenerate', exact: true }).waitFor();
  await composer.fill('error'); await composer.press('Enter');
  await log.getByRole('alert').filter({ hasText: 'Fixture upstream interrupted' }).waitFor(); await log.getByText('Partial answer', { exact: true }).waitFor();
  await composer.fill('rewrite'); await composer.press('Enter');
  await page.getByRole('button', { name: 'Apply to page', exact: true }).waitFor();
  assert.equal(await page.getByTestId('document').innerText(), original, 'a proposal is not applied automatically');
  await page.getByRole('button', { name: 'Apply to page', exact: true }).click();
  await until(async () => (await page.getByTestId('document').innerText()).includes('# Updated guide'), 'apply did not update the editor');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await until(async () => (await page.getByTestId('document').innerText()).includes('# Quick start'), 'undo did not restore the editor');
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); await picker.click(); await search.fill('gpt');
  await page.getByRole('option', { name: 'GPT 6.1 Sol (via Codex)', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout overflows');
  await page.screenshot({ path: '/tmp/devone-docs-chat-mobile.png', fullPage: true });
  modelMode = 'error'; await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('main[data-ready="true"]').waitFor(); await page.getByRole('button', { name: 'Ask AI', exact: true }).click(); await picker.click();
  await page.getByRole('alert').filter({ hasText: 'Could not load models.' }).waitFor();
  modelMode = 'ready'; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await search.fill('sonnet'); await page.getByRole('option', { name: 'Claude Sonnet 5.5', exact: true }).waitFor();
  await page.getByRole('option', { name: 'Claude Sonnet 5.5', exact: true }).click(); await search.waitFor({ state: 'hidden' });
  await composer.fill('close'); await composer.press('Enter'); await log.getByRole('status').filter({ hasText: 'Thinking…' }).waitFor();
  await page.getByRole('button', { name: 'Close chat', exact: true }).click(); await until(() => streamClosed, 'closing chat did not cancel its request');
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click(); await log.getByText('Response stopped', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('outer-form').getAttribute('data-submitted'), null, 'chat actions must not submit an enclosing task form');
  assert.deepEqual(errors, []); console.log('Docs chat browser checks passed: model loading/search/retry, exact IDs, Markdown, copy, regenerate, streaming/scroll/stop, errors, apply/undo and mobile layout');
})().catch(async error => { console.error(error); if (page) await page.screenshot({ path: '/tmp/devone-docs-chat-failure.png', fullPage: true }).catch(() => {}); process.exitCode = 1; }).finally(async () => {
  releaseModels(); if (browser) await browser.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  if (createdFixture) fs.rmSync(fixturePath, { recursive: true });
});
