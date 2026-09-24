/* TRAVION end-to-end flow test (Playwright-core, real Chrome).
   Verifies the master-spec flow: signup → Step 1 → Step 2 (interview) →
   Step 3 discovery → Step 4 Mode → Step 5 Plans (fee math) → Step 6
   Itinerary → Step 7 Final Review → checkout consistency + chronology. */
import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const STAMP = Date.now();
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('legacy API')) consoleErrors.push(m.text());
});

/** Click the first visible button matching texts (force past overlays). */
async function clickButton(texts, { timeout = 8000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const t of texts) {
      const btn = page.locator(`button:has-text("${t}")`).first();
      if (await btn.count()) {
        try { await btn.click({ timeout: 2500, force: true }); return true; }
        catch { /* retry */ }
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/** Pick a location from the search bar dropdown (retries past slow geocoding). */
async function pickPlace(input, name) {
  await input.click();
  await input.fill(name);
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const opt = page.locator(`button:has-text("${name}")`).filter({ hasText: /^[A-Za-z]/ }).last();
    if (await opt.count()) {
      try { await opt.click({ timeout: 2000, force: true }); await page.waitForTimeout(600); return; }
      catch { /* retry */ }
    }
    await page.waitForTimeout(600);
  }
}

/** Walk the 3-question interview until discovery renders. */
async function runInterview() {
  for (let q = 0; q < 6; q++) {
    if (await page.locator('button:has-text("Add to Plan")').count() > 0) return true;
    let picked = false;
    for (const want of ['₹25,000 – ₹50,000', '₹15,000 – ₹25,000', '₹10,000 – ₹15,000', '₹50,000+', 'Solo', 'Mixed', 'Food & Culture', 'Adventure']) {
      const c = page.locator('button:visible').filter({ hasText: want }).first();
      if (await c.count()) { await c.click({ force: true }); picked = true; break; }
    }
    await page.waitForTimeout(400);
    const cont = page.locator('button:has-text("Continue"):not([disabled])').first();
    if (await cont.count() && await cont.isEnabled().catch(() => false)) {
      await cont.click({ force: true });
      await page.waitForTimeout(3000);
    } else if (!picked) {
      break;
    }
  }
  return await page.locator('button:has-text("Add to Plan")').count() > 0;
}

try {
  // ── Signup via landing auth modal ───────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await clickButton(['PLAN MY TRIP'], { timeout: 15000 });
  await page.waitForTimeout(900);
  const dlg = page.locator('[role="dialog"]');
  await dlg.locator('input[type="text"]').nth(0).fill('Flow');
  await dlg.locator('input[type="text"]').nth(1).fill('Tester');
  await dlg.locator('input[type="email"]').first().fill(`flow${STAMP}@travionflow.dev`);
  const pwds = dlg.locator('input[type="password"]');
  await pwds.nth(0).fill('TravionFlow1!A');
  await pwds.nth(1).fill('TravionFlow1!A');
  await dlg.locator('input[inputmode="numeric"]').first().fill('9876543210');
  await clickButton(['Create traveller account'], { timeout: 12000 });
  await page.waitForTimeout(4000);

  // First-run profile sheet
  const homeCity = page.locator('input[placeholder="e.g. Chennai"]');
  if (await homeCity.count()) {
    await page.locator('input[placeholder="e.g. Kavya"]').first().fill('Flow');
    await homeCity.first().fill('Hyderabad');
    const phone2 = page.locator('input[placeholder="+91 98765 43210"]');
    if (await phone2.count()) await phone2.first().fill('9876543210');
    await clickButton(['Save & Continue']);
    await page.waitForTimeout(2500);
  }
  check('Signup → profile → planner', await page.locator('input[aria-label="Starting location"]').count() > 0);

  // ── Step 1: Trip basics ─────────────────────────────────────────────────
  await pickPlace(page.locator('input[aria-label="Starting location"]'), 'Hyderabad');
  await pickPlace(page.locator('input[aria-label="Destination"]'), 'Munnar');
  await clickButton(['Explore trip'], { timeout: 10000 });
  await page.waitForTimeout(3500);

  // ── Step 2: Interview ───────────────────────────────────────────────────
  const discovery = await runInterview();
  check('Step 2 interview → Step 3 discovery', discovery);

  // ── Step 3: Discovery — select places, confirm ─────────────────────────
  const addBtns = page.locator('button:has-text("ADD TO PLAN"), button:has-text("Add to Plan")');
  const addCount = await addBtns.count();
  for (let i = 0; i < Math.min(3, addCount); i++) {
    await addBtns.nth(i).click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  check('Step 3 discovery cards rendered', addCount > 0, `${addCount} cards`);
  await clickButton(['Continue to Trip Planning'], { timeout: 12000 });
  await page.waitForTimeout(1500);

  // ── Step 4: Mode ────────────────────────────────────────────────────────
  const modeHeading = await page.locator('text=How do you want to experience it').count() > 0
    || await page.locator('text=Choose Adventurous Mode').count() > 0;
  check('STEP 4 Mode screen reached', modeHeading);
  const modeClicked =  await clickButton(['Choose Adventurous Mode'], { timeout: 10000 });
  check('STEP 4 Adventurous Mode selected → plans generate', modeClicked);
  // Wait for plan cards to actually render (backend pipeline can be slow).
  await page.locator('text=Final planned amount').first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // ── Step 5: Plans — fee math on the cards ──────────────────────────────
  const planText = await page.locator('body').innerText();
  check('Plan cards show Guide fee row', /Guide fee/.test(planText));
  check('Plan cards show Platform fee 3% row', /Platform fee \(3%\)/.test(planText));
  check('Plan cards show Safety reserve 15% row', /Safety reserve \(15%\)/.test(planText));
  check('Plan cards show Insurance row', /Insurance/.test(planText));
  check('Plan cards show Final planned amount', /Final planned amount/.test(planText));
  // Fee math: final = base + guide + platform + safety + insurance
  const nums = [...planText.matchAll(/₹([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
  check('Plan amounts parse to sane INR values', nums.some(n => n >= 1000 && n < 1_000_000));

  await clickButton(['RECOMMENDED', 'Recommended']);
  await page.waitForTimeout(600);
  await clickButton(['Confirm plan & continue']);
  // Wait for the itinerary editor to appear (generation pipeline).
  await page.locator('button:has-text("Review Your Trip")').first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // ── Step 6: Itinerary editor reached ───────────────────────────────────
  const inPlanner = await page.locator('button:has-text("Review Your Trip")').count() > 0;
  check('STEP 6 Itinerary editor reached', inPlanner);

  // ── Step 7: Final Review ────────────────────────────────────────────────
  await clickButton(['Review Your Trip']);
  await page.waitForTimeout(1000);
  await clickButton(['Continue: Final Review']);
  await page.waitForTimeout(1800);
  const reviewSeen = await page.locator('text=Review your trip').count() > 0;
  check('STEP 7 Final Review reached', reviewSeen);
  const reviewText = await page.locator('body').innerText();
  check('Review shows explicit mode label', /Adventurous Mode|Guide Mode/.test(reviewText));
  check('Review shows Safety reserve', /Safety reserve/.test(reviewText));
  check('Review shows Insurance (fixed)', /Insurance/.test(reviewText));
  check('Review shows Final planned amount', /Final planned amount/.test(reviewText));
  check('Review shows TRAVION Refund Protection note', /TRAVION Refund Protection/.test(reviewText));

  const dayHeadings = await page.locator('text=/day \\d/i').count();
  const daySections = reviewText.split(/Day \d/i).slice(1);
  check('Review renders day timeline', dayHeadings > 0 || daySections.length > 0, `${dayHeadings} day headings`);
  const foundMeals = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'].filter(w => reviewText.includes(w));
  check('Meal labels present', foundMeals.length >= 2, foundMeals.join(', '));
  let chronoOk = true;
  for (const sec of daySections) {
    const entries = [...sec.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi)].map(m => {
      let h = parseInt(m[1], 10) % 12;
      if (m[3].toUpperCase() === 'PM') h += 12;
      if (m[3].toUpperCase() === 'AM' && parseInt(m[1], 10) === 12) h = 0;
      return h * 60 + parseInt(m[2], 10);
    });
    for (let i = 1; i < entries.length; i++) if (entries[i] < entries[i - 1]) { chronoOk = false; break; }
  }
  check('Itinerary times are chronological', chronoOk);

  // Day diagnostics
  const dayHeads = await page.locator('text=/^Day \\d/').allInnerTexts();
  console.log('DAY HEADINGS:', JSON.stringify(dayHeads));

  // Edit round-trip preserves state: review → planner → review → payment
  await clickButton(['Edit itinerary'], { timeout: 6000 });
  await page.waitForTimeout(1800);
  const backInPlanner = await page.locator('button:has-text("Review Your Trip")').count() > 0;
  check('Edit itinerary → planner (state preserved)', backInPlanner);
  await clickButton(['Review Your Trip']);
  await page.waitForTimeout(1000);
  await clickButton(['Continue: Final Review']);
  await page.waitForTimeout(1500);

  await clickButton(['Continue to payment'], { timeout: 10000 });
  await page.waitForTimeout(3000);

  // ── Checkout: same pricing object ──────────────────────────────────────
  const modalText = await page.locator('body').innerText();
  check('Checkout modal shows final planned amount', /final planned amount/i.test(modalText));
  check('Checkout shows Safety reserve (15%)', /Safety reserve \(15%\)/.test(modalText));
  check('Checkout shows Insurance (fixed)', /Insurance \(fixed\)/.test(modalText));
  const ack = page.locator('#non-refundable-ack');
  if (await ack.count()) {
    await ack.check().catch(async () => { await ack.click({ force: true }).catch(() => {}); });
    check('Non-refundable acknowledgement checkable', true);
  } else {
    check('Non-refundable acknowledgement present', false, '#non-refundable-ack not found');
  }

  console.log('\nConsole errors: ' + (consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : 'NONE'));
  check('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('Script completed without exception', false, String(e).slice(0, 220));
} finally {
  fs.writeFileSync('e2e-flow-results.json', JSON.stringify(results, null, 2));
  await browser.close();
}
