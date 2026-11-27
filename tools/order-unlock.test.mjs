// Mocked order-unlock checks for 隐藏人设. Synthetic ids only.
// Chrome pins the API host to 127.0.0.1, so a missed mock cannot redeem a real code.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const API = 'https://' + API_HOST;
const ORDER = 'P847291038475610293';
const OTHER = 'P102938475610293847';
const CODE = 'SBABCD';
const PORT = 8947;
const BASE = `http://127.0.0.1:${PORT}/`;

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER)) throw new Error('synthetic order is not a legal id: ' + patternError(ORDER));
if (patternError(OTHER)) throw new Error('second synthetic order is not a legal id: ' + patternError(OTHER));
if (!/^SB[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleApi(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.pathname + u.search);
  if (u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.startsWith('/order/')) {
    state.unexpected.push('vercel-order ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    if (u.searchParams.get('quiz') !== 'sbti') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push('api ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function handleMantle(req, u, state) {
  state.urls.push(req.method() + ' mantle ' + u.pathname);
  if (u.pathname.includes('/orders/')) state.unexpected.push('mantle-order ' + u.pathname);
  else state.unexpected.push('mantle ' + u.pathname);
  if (req.method() === 'GET') state.mantleGets++;
  if (req.method() === 'POST' && u.pathname.includes('/increment/')) {
    const body = JSON.parse(req.postData() || '{}');
    if (body.by === -1) state.mantleDecr++;
    else if (body.by === 1) state.mantleIncr++;
  }
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === API_HOST) return await handleApi(req, u, state);
      if (u.hostname === 'mantledb.sh') return await handleMantle(req, u, state);
      state.unexpected.push(u.hostname + ' ' + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      vaultPosts: state.vaultPosts,
      vaultGets: state.vaultGets,
      mantleGets: state.mantleGets,
      mantleDecr: state.mantleDecr,
      mantleIncr: state.mantleIncr,
      bodies: state.bodies,
      urls: state.urls,
      unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function newPage(browser, state) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function' && typeof shownOrderUses === 'function');
  return { page, errors };
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes('/orders/') || u.includes('/order/') || u.includes('vercel') || u.includes('mantle'));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, msg, state);
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep SB codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order, other) => {
    const splitA = order;
    noteDisplayedUse(splitA);
    const noted = shownOrderUses(splitA);
    const separate = shownOrderUses(other);
    const res = noteDisplayedUse(other);
    const otherUses = shownOrderUses(other);
    localStorage.removeItem(ORDER_USES_KEY);
    return {
      good: orderFormatError(order),
      repeat: orderFormatError('P111111111111111111'),
      seq: orderFormatError('P123456789012345678'),
      down: orderFormatError('P987654321098765432'),
      pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
      code: classifyInput(' sb ab cd '),
      junk: classifyInput('hello'),
      badCode: classifyInput('SBIIII'),
      shortP: classifyInput('P12345'),
      quiz: QUIZ_KEY,
      api: API_BASE,
      key: ORDER_USES_KEY,
      p19: orderFormatError('P9900000000000001378'),
      p19c: classifyInput('P9900000000000001378').type,
      copy: orderSuccessText({ ok: true, uses: 1, remaining: 2, paidVerified: false }),
      lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0, paidVerified: false }),
      laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0, paidVerified: false }),
      noted,
      separate,
      otherUses,
      paid: res.paidVerified,
      codeCopy: codeSuccessText({ ok: true, remaining: 2 }),
    };
  }, ORDER, OTHER);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid' && out.down === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced SB code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'reject' && out.badCode.type === 'reject' && out.shortP.type === 'reject', 'classifier mixed');
  assert(out.quiz === 'sbti' && out.api === API, 'quiz/api constants');
  assert(out.key === 'hidden_persona_order_uses' && !out.key.includes('soft_persimmon'), 'storage key ' + out.key);
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.noted === 1 && out.separate === 0 && out.otherUses === 1, 'counts must be stored per order id');
  assert(out.paid === false, 'paidVerified must stay false');
  assert(out.codeCopy === '验证成功，还可以测 2 次', out.codeCopy);
  const src = await page.content();
  assert(!src.includes('/order/'), 'page still contains an order endpoint');
  assert(!src.includes('soft_persimmon_order_uses'), 'page reuses the other quiz key');
  assert(!src.includes('mantledb'), 'page calls Mantle');
  assert(state.vaultPosts === 0 && state.unexpected.length === 0, 'format checks must not hit the network', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid order starts with no order network request', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(visible.includes('隐藏人设测试'), 'product title');
  assert(!visible.includes('验证码') && !visible.includes('paidVerified') && !visible.includes('次数已经用完'), 'start copy');
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  const heading = await page.evaluate(() => document.querySelector('#codeMask h3').textContent);
  assert(heading === '输入订单号', heading);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次', 'success copy ' + toast);
  const known = await page.evaluate(() => {
    const t = document.getElementById('qtext').textContent;
    return QS.some((q) => q.t === t) && document.getElementById('qprog').textContent === '1 / 18';
  });
  assert(known, 'quiz did not open on a real question');
  const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem(ORDER_USES_KEY) || '{}')[id], ORDER);
  assert(stored === 1, 'stored display count ' + stored);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('refresh, continue, and result restore do not change the display', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'refresh at question 1 must not change the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog === '3 / 18', 'progress ' + prog);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh must not change the display count');
  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '1 / 18' && cont.sel === 1 && cont.a0 === 1, 'continue reset the attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue must not change the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result refresh and 查看上次结果 do not advance; 重新测试 does; later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstIndex = await page.$eval('.index-num', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.index-num', (el) => el.textContent);
  assert(peeked === firstIndex, 'result refresh changed the index');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, 'view last changed the display count');
  assertNoOrderNet(state, 'view last must not call the network for an order');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast.includes('还可以测 1 次'), secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const thirdToast = await page.$eval('#toast', (el) => el.textContent);
  assert(thirdToast.includes('这是最后一次'), thirdToast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(after.uses === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the page', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'P111111111111111111');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  let onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz, 'repeating id started the quiz');
  await page.$eval('#codeInput', (el) => { el.value = 'P123456789012345678'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'P987654321098765432'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'P9900000000000001378'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'hello'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz, 'invalid id started the quiz');
  assert(await shownUses(page) === 0, 'invalid id recorded a display count');
  assertNoOrderNet(state, 'invalid input reached the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access code hits the vault and does not call Mantle or order endpoints', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'sb ab cd');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'sbti' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!state.bodies[0].orderId, 'code redeem must not send orderId', state);
  assert(state.urls.some((u) => u.startsWith('POST /redeem')), 'vault url', state);
  assert(!state.urls.some((u) => u.includes('/order/')), 'code redeem called an order endpoint', state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, 'this quiz has no Mantle collection', state);
  assert(state.unexpected.length === 0, 'unexpected', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次'), toast);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();

  const miss = freshState();
  miss.vaultMode = 'not_found';
  const missed = await newPage(browser, miss);
  await openAndSubmit(missed.page, CODE);
  await missed.page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号不对'));
  const missQuiz = await missed.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!missQuiz, 'vault miss started the quiz');
  assert(miss.vaultPosts === 1 && miss.mantleGets === 0 && miss.mantleDecr === 0, 'vault miss must not call Mantle', miss);
  assert(!miss.urls.some((u) => u.includes('/order/')), 'vault miss called an order endpoint', miss);
  assert(await missed.page.evaluate(() => !isUnlocked()), 'vault miss unlocked');
  await missed.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完'));
  const doneQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!doneQuiz && done.vaultPosts === 1 && done.mantleGets === 0 && done.mantleDecr === 0, 'exhausted vault fell through', done);
  await second.page.close();
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${API_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
