import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  console.log('Navigating to http://127.0.0.1:8765 ...');
  await page.goto('http://127.0.0.1:8765', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 1. Verify Category Trigger Button is present
  const triggerLabel = await page.textContent('#categoryTriggerLabel');
  console.log('Initial Category Label:', triggerLabel.trim());

  // 2. Open Category Modal
  await page.click('#categoryTriggerBtn');
  await page.waitForTimeout(500);
  const modalVisible = await page.isVisible('#categoryModal');
  console.log('Category modal opened:', modalVisible);

  // 3. Check Root Brands
  const catItems = await page.$$eval('#catItemsList .cat-item', els => els.slice(0, 5).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('Sample modal brand items:', catItems);

  // 4. Test Search "i"
  await page.fill('#catSearchInput', 'i');
  await page.waitForTimeout(400);
  const searchResultsI = await page.$$eval('#catItemsList .cat-item', els => els.slice(0, 4).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('Search "i" results in UI:', searchResultsI);

  // 5. Test Search "x1 msport"
  await page.fill('#catSearchInput', 'x1 msport');
  await page.waitForTimeout(400);
  const searchResultsX1 = await page.$$eval('#catItemsList .cat-item', els => els.slice(0, 3).map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('Search "x1 msport" results in UI:', searchResultsX1);

  // 6. Select first item from "x1 msport"
  await page.click('#catItemsList .cat-item:first-child');
  await page.waitForTimeout(500);

  const updatedTrigger = await page.textContent('#categoryTriggerLabel');
  console.log('Updated Category Label after click:', updatedTrigger.trim());

  const activeTags = await page.$$eval('#activeTagsBar .active-tag', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('Active filter tags:', activeTags);

  // 7. Open Advanced Filters Drawer
  await page.click('#filterToggle');
  await page.waitForTimeout(400);
  const sheetCatDisplay = await page.textContent('#sheetCategoryDisplay');
  console.log('Drawer category card display:', sheetCatDisplay.trim());

  // 8. Test Vites Tipi chips in Drawer
  await page.click('#gearChipGroup [data-gear-val="Otomatik"]');
  await page.waitForTimeout(300);
  const isAutoActive = await page.$eval('#gearChipGroup [data-gear-val="Otomatik"]', el => el.classList.contains('active'));
  console.log('Otomatik chip active:', isAutoActive);

  // 9. Test Yakıt Tipi chips in Drawer
  await page.click('#fuelChipGroup [data-fuel-val="Dizel"]');
  await page.waitForTimeout(300);
  const isDieselActive = await page.$eval('#fuelChipGroup [data-fuel-val="Dizel"]', el => el.classList.contains('active'));
  console.log('Dizel chip active:', isDieselActive);

  // 10. Close Drawer and check results count
  await page.click('#applyFiltersBtn');
  await page.waitForTimeout(500);
  const resultsRange = await page.textContent('#resultsRangeText');
  console.log('Results text after filters:', resultsRange.trim());

  // 11. Test Clear All Tags
  if (await page.isVisible('#btnRemoveAllTags')) {
    await page.click('#btnRemoveAllTags');
    await page.waitForTimeout(400);
    const resetTrigger = await page.textContent('#categoryTriggerLabel');
    console.log('Category label after clear all:', resetTrigger.trim());
  }

  // 12. Check console errors
  console.log('Total console/page errors:', errors.length);
  if (errors.length) {
    console.log('Errors:', errors);
  }

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
