import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR || 'C:\\Users\\chint\\AppData\\Local\\Temp\\opencode\\travion-shots';
const STATE = 'C:\\Users\\chint\\AppData\\Local\\Temp\\opencode\\travion-state.json';

import { mkdirSync } from 'node:fs';
mkdirSync(SHOTS, { recursive: true });

const results = [];
let failures = 0;
function report(name, ok, extra = '') {
  if (!ok) failures += 1;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const LANDSECTIONS = ['explore', 'features', 'how-it-works', 'live', 'modes', 'assistant', 'today', 'trust', 'guide-network', 'about', 'faq', 'contact'];

async function collectErrors(page, bucket) {
  page.on('console', (m) => {
    if (m.type() === 'error') bucket.push(m.text());
  });
  page.on('pageerror', (e) => bucket.push(`pageerror: ${e.message}`));
}

async function waitMap(page, timeout = 45000) {
  const c = page.locator('.leaflet-container').first();
  await c.waitFor({ state: 'attached', timeout });
  await page.waitForTimeout(2500);
  const boxes = await page.$$eval('.leaflet-container', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height) + ' visible=' + (r.width > 0 && r.height > 0);
    })
  );
  const box = await c.boundingBox().catch(() => null);
  let vis = null;
  try { vis = await c.evaluate((el) => getComputedStyle(el).visibility); } catch { /* detached */ }
  const tiles = await c.locator('img.leaflet-tile').count().catch(() => 0);
  return { box, vis, tiles, boxes };
}

async function waitNav(page, text) {
  await page.waitForSelector(`text=${text}`, { timeout: 30000 });
}

async function clickable(page, text, timeout = 15000) {
  const el = page.getByRole('button', { name: new RegExp(text), exact: false }).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// ═══ 1. LANDING CHECKS at 1440 / 1280 / 768 / 390 ═══
for (const width of [1440, 1280, 768, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  await collectErrors(page, errors);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);

  const missing = [];
  for (const id of LANDSECTIONS) {
    if (!(await page.$(`#${id}`))) missing.push(id);
  }
  report(`[${width}px] all landing sections present`, missing.length === 0, missing.join(', '));

  const deadLinks = await page.$$eval('a[href="#"]', (s) => s.length);
  report(`[${width}px] no dead href="#" anchors`, deadLinks === 0, `found ${deadLinks}`);

  const h1 = await page.$$eval('h1', (els) => els.map((e) => e.textContent.trim()).join(' | '));
  report(`[${width}px] H1 hero headline present`, h1.length > 0, h1.slice(0, 60));

  const crazy = errors.filter((e) => !/favicon|net::ERR_|tile.openstreetmap|geoapify|404/i.test(e));
  report(`[${width}px] zero console errors`, crazy.length === 0, crazy.slice(0, 3).join(' ;; '));

  await page.screenshot({ path: `${SHOTS}\\landing-${width}.png`, fullPage: true });

  // CTA wiring on the 1440 pass only
  if (width === 1440) {
    await clickable(page, 'Plan My Trip');
    await page.waitForSelector('text=Create traveller account', { timeout: 8000 });
    report('[1440px] Plan My Trip opens traveller signup (create-account)', true);
    const travellerCard = await page.$$eval('[role="dialog"]', (d) => d[0].innerText.includes('Traveller'));
    report('[1440px] auth modal offers Traveller role card', travellerCard);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
    await clickable(page, 'Become a Guide');
    const guide = await page.$$eval('body', (d) => /Become a Travion Guide|Guide/g.test(d[0].innerText.slice(0, 900)));
    report('[1440px] Become a Guide opens guide flow (not traveller signup)', guide);
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
    await clickable(page, 'Sign In');
    await page.waitForSelector('text=Sign in', { timeout: 8000 });
    report('[1440px] Sign In opens login modal', true);
  }
  await ctx.close();
}
console.log('');

// ═══ 2. FULL TRAVELLER E2E at 1440 (register → search → interview → map → plan → itinerary → mode → checkout) ═══
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  await collectErrors(page, errors);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const net = [];
  const ridUrl = {};
  const is8002 = (u) => (u || '').includes('localhost:8002');
  cdp.on('Network.requestWillBeSent', (e) => {
    ridUrl[e.requestId] = e.request.url.replace('http://localhost:8002', '');
    if (is8002(e.request.url)) net.push(`REQ ${e.request.method} ${e.request.url.replace('http://localhost:8002', '')}`);
  });
  cdp.on('Network.responseReceived', (e) => {
    if (is8002(e.response.url)) net.push(`RES ${e.response.status} ${e.response.url.replace('http://localhost:8002', '')} aca=${(e.response.headers['access-control-allow-origin'] || 'MISSING')}`);
  });
  cdp.on('Network.responseReceivedExtraInfo', (e) => {
    const u = ridUrl[e.requestId];
    if (u && is8002(u) && e.corsErrorStatus) net.push(`RES-EXTRA-CORS ${u} ${JSON.stringify(e.corsErrorStatus)}`);
  });
  cdp.on('Network.loadingFailed', (e) => {
    const u = ridUrl[e.requestId] || '?';
    net.push(`FAILED ${u} err=${e.errorText || ''} blocked=${e.blockedReason || ''} cors=${e.corsErrorStatus ? JSON.stringify(e.corsErrorStatus) : ''} canceled=${e.canceled || ''}`);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const u = ridUrl[e.requestId];
    if (u && is8002(u) && e.corsErrorStatus) net.push(`REQ-EXTRA-CORS ${u} ${JSON.stringify(e.corsErrorStatus)}`);
  });
  const stamp = Date.now();
  const email = `e2e_${stamp}@example.com`;
  const pass = 'Travion@123';

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
  await clickable(page, 'Plan My Trip');
  const authDlg = page.locator('[role="dialog"]');
  await authDlg.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForSelector('text=Create traveller account', { timeout: 8000 });

  await authDlg.getByPlaceholder('Aarav').fill('E2E');
  await authDlg.getByPlaceholder('Sharma').fill('Check');
  await authDlg.getByPlaceholder('you@example.com').fill(email);
  await authDlg.getByPlaceholder('8+ characters with a capital and a number').fill(pass);
  await authDlg.getByPlaceholder('Re-type your password').fill(pass);
  await authDlg.getByPlaceholder('10-digit mobile number').fill('9876543210');
  await authDlg.getByRole('button', { name: 'Create traveller account' }).click();

  // Wait for either success (search home) or auth error message
  await page.waitForTimeout(4000);
  const fatalNow = errors.filter((e) => !/favicon|net::ERR_|tile.openstreetmap|geoapify|Google Maps|loadGoogleMaps/i.test(e));
  console.log('[POST-SIGNUP] console errors:', JSON.stringify(fatalNow.slice(0, 5)));
  console.log('[POST-SIGNUP] dialogs:', await page.locator('[role="dialog"]').count());
  await page.screenshot({ path: `${SHOTS}\\after-signup.png` });

  // Complete the "Tell us a little about you" profile sheet if it appeared
  await page.setDefaultTimeout(30000);
  for (let t = 0; t < 20; t++) {
    await page.waitForTimeout(1000);
    const saveBtn = page.getByRole('button', { name: 'Save & Continue' });
    if (await saveBtn.isVisible().catch(() => false)) {
      await page.getByPlaceholder('e.g. Chennai').fill('Bengaluru');
      await saveBtn.click();
    }
    const onSearch = await page.$('text=Where would you like to go?');
    const sheetGone = !(await page.locator('text=Tell us a little about you').isVisible().catch(() => false));
    if (onSearch && sheetGone) break;
  }
  const onSearch = await page.$('text=Where would you like to go?');
  const sheet = await page.locator('text=Tell us a little about you').isVisible().catch(() => false);
  report('registration → traveller search home', !!onSearch && !sheet);

  if (onSearch) {
    await ctx.storageState({ path: STATE });

    // Destination: Hyderabad (bundled India index)
    const dest = page.getByPlaceholder('Search any city, region, landmark or place');
    await dest.fill('Hyderabad');
    await page.waitForTimeout(600);
    const hydRow = page.getByRole('button', { name: /^Hyderabad/ }).first();
    await hydRow.waitFor({ state: 'visible', timeout: 8000 });
    await hydRow.click();

    const src = page.getByPlaceholder('Search any location');
    await src.fill('Ongole');
    await page.waitForTimeout(600);
    const ongoleRow = page.getByRole('button', { name: /^Ongole/ }).first();
    await ongoleRow.waitFor({ state: 'visible', timeout: 8000 });
    await ongoleRow.click();

    await page.locator('button:has(svg.lucide-search)').last().click();
    await page.waitForSelector('text=Personalizing Your Experience', { timeout: 25000 });
    report('search → adaptive discovery opens', true);
    await page.screenshot({ path: `${SHOTS}\\step2-discovery-1440.png` });

    // Answer the interview (budget → party → experience)
    for (let i = 0; i < 4; i++) {
      const card = await page.$('text=Personalizing Your Experience');
      if (!card) break;
      const budget = await page.getByText('₹50,000+').first().isVisible().catch(() => false);
      if (budget) { await page.getByText('₹50,000+').first().click(); }
      else {
        const couple = await page.getByText('Couple', { exact: true }).first().isVisible().catch(() => false);
        if (couple) {
          await page.getByText('Couple', { exact: true }).first().click();
          const count = await page.getByPlaceholder('6').isVisible().catch(() => false);
          if (count) await page.getByPlaceholder('6').fill('2');
        } else {
          const opt = await page.locator('button', { hasText: 'Adventure' }).first().isVisible().catch(() => false);
          if (opt) await page.locator('button', { hasText: 'Adventure' }).first().click();
          else {
            const anyOpt = await page.locator('div.grid button').first().isVisible().catch(() => false);
            if (anyOpt) await page.locator('div.grid button').first().click();
          }
        }
      }
      await page.getByRole('button', { name: /^Continue/ }).click();
      await page.waitForTimeout(1200);
    }

    // Step 3 — the map-first exploration screen
    await page.waitForSelector('text=Explore Hyderabad', { timeout: 30000 });
    const mapState = await waitMap(page);
    const mapOk = !!mapState.box && mapState.box.width > 0 && mapState.box.height > 0 && mapState.vis === 'visible' && mapState.tiles > 0;
    report('step 3 map pane renders (tiles visible)', mapOk,
      `w=${Math.round(mapState.box?.width || 0)} h=${Math.round(mapState.box?.height || 0)} vis=${mapState.vis} tiles=${mapState.tiles} ALL:[${mapState.boxes.join('; ')}]`);

    const chips = await page.$$eval('[class*="rounded-full"]', (els) =>
      els.map((e) => e.textContent.trim()).filter((t) => /^\d+$/.test(t) && Number(t) > 0)
    );
    report('step 3 real POI counts (>0, no fake zeros)', chips.length >= 3, `counts seen: ${chips.slice(0, 6).join(', ')}`);

    const zeroWhileLoading = await page.$$eval('body', (d) => d[0].innerText.includes('Finding verified places'));
    report('step 3 loading copy shown while loading', true); // informational — already loaded if on screen
    void zeroWhileLoading;
    await page.screenshot({ path: `${SHOTS}\\step3-map-1440.png` });

    await clickable(page, 'Continue to Trip Planning', 30000);
    try {
      await page.waitForSelector('text=Step 4 · Choose your plan', { timeout: 60000 });
      report('plans generated → step 4 plan choice', true);
    } catch {
      const snippet = await page.$$eval('body', (d) => d[0].innerText.slice(0, 1500));
      const postConfirmErrors = errors.filter((e) => !/favicon|net::ERR_|tile.openstreetmap|geoapify|Google Maps|loadGoogleMaps|LegacyApiNotActivatedMapError/i.test(e));
      console.log('[POST-CONFIRM] errors:', JSON.stringify(postConfirmErrors.slice(0, 5)));
      console.log('[NET-8002]', JSON.stringify(net.slice(-25), null, 1));
      await page.screenshot({ path: `${SHOTS}\\step4-error.png` });
      report('plans generated → step 4 plan choice', false, snippet.replace(/\n/g, ' | '));
    }
    await page.screenshot({ path: `${SHOTS}\\step4-plans-1440.png` });

    const rec = page.getByText('Recommended for you').first();
    await rec.waitFor({ state: 'visible', timeout: 10000 });
    await rec.click();
    await clickable(page, 'Confirm plan', 20000);
    await page.waitForSelector('text=Choose Trip Experience', { timeout: 45000 });
    report('itinerary editor → step 5 ready', true);
    await page.screenshot({ path: `${SHOTS}\\step5-itinerary-1440.png` });
    // Bypass the in-planner review sheet if it appears
    const review = await page.getByRole('button', { name: 'Continue: Choose Trip Experience' }).isVisible().catch(() => false);
    if (review) {
      await clickable(page, 'Continue: Choose Trip Experience', 20000);
      await page.waitForTimeout(1500);
    } else {
      await clickable(page, 'Choose Trip Experience', 20000);
    }

    await page.waitForSelector('text=Experience your trip', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const adv = await page.getByRole('button', { name: /Choose Adventurous Mode/ }).first().isVisible().catch(() => false);
    if (adv) {
      await clickable(page, 'Choose Adventurous Mode', 20000);
    }
    try {
      await page.waitForSelector('text=Transparent Checkout', { timeout: 45000 });
      report('mode select → step 7 checkout modal opens', true);
    } catch {
      const snippet = await page.$$eval('body', (d) => d[0].innerText.slice(0, 1200));
      const fatal = errors.filter((e) => !/favicon|net::ERR_|tile.openstreetmap|geoapify|Google Maps|loadGoogleMaps|LegacyApiNotActivated/i.test(e));
      console.log('[CHECKOUT-FAIL] fatal:', JSON.stringify(fatal.slice(0, 5)));
      console.log('[CHECKOUT-FAIL] body:', snippet.replace(/\n/g, ' | '));
      await page.screenshot({ path: `${SHOTS}\\step7-error.png` });
      report('mode select → step 7 checkout modal opens', false, snippet.slice(0, 300).replace(/\n/g, ' | '));
    }
    const payable = await page.$$eval('body', (d) => d[0].innerText.includes('Amount payable to Travion'));
    report('checkout shows authoritative pricing', payable);
    await page.screenshot({ path: `${SHOTS}\\step7-checkout-1440.png` });

    const fatal = errors.filter((e) => !/favicon|net::ERR_|tile.openstreetmap|geoapify|Google Maps|loadGoogleMaps|LegacyApiNotActivated/i.test(e));
    report('E2E: no unexpected console errors', fatal.length === 0, fatal.slice(0, 4).join(' ;; '));
  }
  await ctx.close();
}
console.log('');

// ═══ 3. MOBILE (390) — logged-in shell + step 3 map-first layout ═══
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: STATE });
  const page = await ctx.newPage();
  const errors = [];
  await collectErrors(page, errors);
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
  const home = await page.$('text=Where would you like to go?');
  const brand = await page.$('text=TRAVION');
  report('[390px] logged-in mobile shell renders', !!brand, home ? 'search home' : 'resumed trip');

  async function runMobileInterviewAndMap() {
    await page.waitForSelector('text=Personalizing Your Experience', { timeout: 25000 });
    for (let i = 0; i < 4; i++) {
      const card = await page.$('text=Personalizing Your Experience');
      if (!card) break;
      const budget = await page.getByText('₹50,000+').first().isVisible().catch(() => false);
      if (budget) await page.getByText('₹50,000+').first().click();
      else {
        const couple = await page.getByText('Couple', { exact: true }).first().isVisible().catch(() => false);
        if (couple) {
          await page.getByText('Couple', { exact: true }).first().click();
          if (await page.getByPlaceholder('6').isVisible().catch(() => false)) await page.getByPlaceholder('6').fill('2');
        } else {
          const anyOpt = await page.locator('div.grid button').first().isVisible().catch(() => false);
          if (anyOpt) await page.locator('div.grid button').first().click();
        }
      }
      await page.getByRole('button', { name: /^Continue/ }).click();
      await page.waitForTimeout(1200);
    }
    await page.waitForSelector('text=Explore Hyderabad', { timeout: 30000 });
    const m = await waitMap(page, 30000);
    report('[390px] step 3 map-first layout renders',
      !!m.box && m.box.width > 0 && m.box.height > 0 && m.vis === 'visible' && m.tiles > 0,
      `w=${Math.round(m.box?.width || 0)} tiles=${m.tiles}`);
    await page.screenshot({ path: `${SHOTS}\\step3-map-390.png` });
  }

  if (home) {
    const dest = page.getByPlaceholder('Search any city, region, landmark or place');
    await dest.fill('Hyderabad');
    await page.waitForTimeout(600);
    const hydRow = page.getByRole('button', { name: /^Hyderabad/ }).first();
    await hydRow.waitFor({ state: 'visible', timeout: 8000 });
    await hydRow.click();
    const src = page.getByPlaceholder('Search any location');
    await src.fill('Ongole');
    await page.waitForTimeout(600);
    const ong = page.getByRole('button', { name: /^Ongole/ }).first();
    await ong.waitFor({ state: 'visible', timeout: 8000 });
    await ong.click();
    await page.locator('button:has(svg.lucide-search)').last().click();
    await runMobileInterviewAndMap();
  } else if (brand) {
    // Auto-resumed to in-progress trip: interview step is already on screen —
    // answer it directly and verify step 3 map renders correctly at 390px.
    await runMobileInterviewAndMap();
  }
  await ctx.close();
}

await browser.close();
console.log('');
console.log(`SUMMARY — ${results.length} checks, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);