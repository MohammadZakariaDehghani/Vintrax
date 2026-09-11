import { expect, test } from '@playwright/test';

const DEMO_PASSWORD = 'VintraxDemo123!';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', DEMO_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard/);
}

test.describe('public marketplace', () => {
  test('renders inventory on the server', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Find your next vehicle');
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('filters narrow results and are shareable through the URL', async ({ page }) => {
    await page.goto('/vehicles');
    await expect(page.locator('article').first()).toBeVisible();

    await page
      .getByRole('checkbox', { name: /^Electric/ })
      .first()
      .click();
    await expect(page).toHaveURL(/fuelType=ELECTRIC/);

    // Reloading the shared URL must reproduce the same filtered view.
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /^Electric/ }).first()).toBeChecked();
  });

  test('a misspelled make still finds results via trigram fallback', async ({ page }) => {
    await page.goto('/vehicles?q=teslla');
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('vehicle detail shows specifications and the inspection report', async ({ page }) => {
    await page.goto('/vehicles');
    await page.locator('article h3').first().click();
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('dl').first()).toBeVisible();
  });
});

test.describe('authentication and access control', () => {
  test('a buyer cannot reach the dealer area', async ({ page }) => {
    await signIn(page, 'jordan.lee@example.test');
    await page.goto('/dealer/dashboard');
    await expect(page.locator('h1')).toContainText('Seller account required');
  });

  test('a dealer sees their own inventory', async ({ page }) => {
    await signIn(page, 'sales@northshoremotors.test');
    await page.goto('/dealer/inventory');
    await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
  });
});

test.describe('auctions', () => {
  test('an unverified account is blocked from bidding', async ({ page }) => {
    await signIn(page, 'unverified.buyer@example.test');
    await page.goto('/auctions');
    await page.locator('h2').first().click();
    await page.waitForSelector('#bid-amount');
    await page.click('button:has-text("Place bid")');
    await expect(page.getByRole('alert').first()).toContainText(/verify/i);
  });

  test('placing a bid raises the current price', async ({ page }) => {
    await signIn(page, 'jordan.lee@example.test');
    await page.goto('/auctions');
    await page.locator('h2').first().click();
    await page.waitForSelector('#bid-amount');

    const before = await page.locator('[aria-live="polite"]').first().innerText();
    await page.click('button:has-text("Place bid")');

    await expect
      .poll(async () => page.locator('[aria-live="polite"]').first().innerText(), {
        timeout: 10_000,
      })
      .not.toBe(before);
  });
});
