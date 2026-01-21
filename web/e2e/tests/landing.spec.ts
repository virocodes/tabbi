import { test, expect } from "@playwright/test";

/**
 * Landing page E2E tests
 * Tests the public-facing landing page functionality
 */

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the landing page", async ({ page }) => {
    // Check that the page loads
    await expect(page).toHaveTitle(/Tabbi|Coding Agent/i);
  });

  test("should display the main heading", async ({ page }) => {
    // Look for a main heading or hero text
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
  });

  test("should have a login/sign-in button", async ({ page }) => {
    // Look for authentication CTA
    const loginButton = page.getByRole("link", { name: /sign in|login|get started/i });
    await expect(loginButton).toBeVisible();
  });

  test("should navigate to login page when clicking sign in", async ({ page }) => {
    const loginButton = page.getByRole("link", { name: /sign in|login|get started/i });
    await loginButton.click();

    // Should navigate to login page
    await expect(page).toHaveURL(/\/login/);
  });

  test("should be responsive on mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Page should still be usable
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("Login Page", () => {
  test("should display GitHub OAuth button", async ({ page }) => {
    await page.goto("/login");

    // Look for GitHub sign-in button
    const githubButton = page.getByRole("button", { name: /github|sign in/i });
    await expect(githubButton).toBeVisible();
  });

  test("should have accessible elements", async ({ page }) => {
    await page.goto("/login");

    // Check for proper heading structure
    const mainHeading = page.getByRole("heading");
    await expect(mainHeading.first()).toBeVisible();
  });
});
