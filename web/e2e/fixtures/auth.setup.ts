import { test as setup, expect } from "@playwright/test";

/**
 * Authentication setup for E2E tests
 *
 * This setup project runs before all other tests and saves the
 * authenticated state for reuse. Since we use GitHub OAuth,
 * we'll need to either:
 * 1. Mock the OAuth flow for tests
 * 2. Use a test account with stored credentials
 * 3. Skip auth for public pages
 */

setup("authenticate", async ({ page }) => {
  // For now, we'll test unauthenticated flows
  // Full auth testing will require OAuth mocking

  // Navigate to landing page to verify the app loads
  await page.goto("/");

  // Verify the page loads correctly
  await expect(page).toHaveTitle(/Tabbi|Coding Agent/i);

  // Note: For authenticated tests, you would:
  // 1. Set up mock OAuth responses via page.route()
  // 2. Complete the login flow
  // 3. Save auth state with:
  //    await page.context().storageState({ path: "./fixtures/.auth/user.json" });
});

setup.describe("OAuth mocking example", () => {
  setup.skip(true, "Enable when implementing full auth tests");

  setup("mock GitHub OAuth", async ({ page }) => {
    // Intercept the OAuth redirect
    await page.route("**/api/auth/**", async (route) => {
      const url = route.request().url();

      if (url.includes("/callback")) {
        // Return mock successful auth response
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            user: {
              id: "test-user-123",
              name: "Test User",
              email: "test@example.com",
            },
            session: {
              id: "test-session",
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/login");
    await page.getByRole("button", { name: /github/i }).click();

    // After mock auth, should redirect to app
    await page.waitForURL("/app");

    // Save authenticated state
    await page.context().storageState({ path: "./fixtures/.auth/user.json" });
  });
});
