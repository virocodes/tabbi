import { test, expect } from "@playwright/test";

/**
 * Session flow E2E tests
 * Tests the core session creation and interaction flows
 *
 * Note: These tests require authentication. They are currently
 * skipped and serve as a template for when auth mocking is set up.
 */

test.describe("Session Management", () => {
  // Skip until auth is set up
  test.skip(({ browserName }) => true, "Requires authentication setup");

  test.describe("Session Creation", () => {
    test("should create a new session from repo selection", async ({ page }) => {
      await page.goto("/app");

      // Should see the home page with repo selection
      await expect(page.getByText(/select.*repo|choose.*repository/i)).toBeVisible();

      // Select a repository (mock would need to provide repos)
      const repoSelector = page.getByRole("combobox");
      await repoSelector.click();

      // Should show repo options
      await expect(page.getByRole("option")).toBeVisible();
    });

    test("should show loading state while creating session", async ({ page }) => {
      await page.goto("/app");

      // Type in the input to trigger session creation
      const input = page.getByRole("textbox");
      await input.fill("Hello, start working on the project");
      await input.press("Enter");

      // Should show loading/starting state
      await expect(page.getByText(/starting|loading|creating/i)).toBeVisible();
    });
  });

  test.describe("Chat Interface", () => {
    test("should display messages in chat", async ({ page }) => {
      // Navigate to an existing session
      await page.goto("/app/session/test-session-id");

      // Should see the chat interface
      const chatContainer = page.getByRole("main");
      await expect(chatContainer).toBeVisible();
    });

    test("should allow sending messages", async ({ page }) => {
      await page.goto("/app/session/test-session-id");

      // Find and use the message input
      const input = page.getByRole("textbox", { name: /message|prompt/i });
      await input.fill("List all files in the project");
      await input.press("Enter");

      // Should show the sent message
      await expect(page.getByText("List all files in the project")).toBeVisible();
    });

    test("should display tool calls", async ({ page }) => {
      await page.goto("/app/session/test-session-id");

      // Tool calls should be visible as chips or expandable sections
      const toolChip = page.locator("[data-testid='tool-chip']");
      // If there are tool calls, they should be visible
      if ((await toolChip.count()) > 0) {
        await expect(toolChip.first()).toBeVisible();
      }
    });
  });

  test.describe("Session Controls", () => {
    test("should allow pausing a session", async ({ page }) => {
      await page.goto("/app/session/test-session-id");

      // Find pause button
      const pauseButton = page.getByRole("button", { name: /pause/i });
      if (await pauseButton.isVisible()) {
        await pauseButton.click();

        // Should show paused state
        await expect(page.getByText(/paused/i)).toBeVisible();
      }
    });

    test("should allow resuming a paused session", async ({ page }) => {
      // Navigate to a paused session
      await page.goto("/app/session/paused-session-id");

      // Find resume button
      const resumeButton = page.getByRole("button", { name: /resume/i });
      if (await resumeButton.isVisible()) {
        await resumeButton.click();

        // Should show running/resuming state
        await expect(page.getByText(/running|resuming/i)).toBeVisible();
      }
    });
  });
});

test.describe("Sidebar Navigation", () => {
  test.skip(({ browserName }) => true, "Requires authentication setup");

  test("should display session list in sidebar", async ({ page }) => {
    await page.goto("/app");

    // Sidebar should be visible
    const sidebar = page.getByRole("complementary");
    await expect(sidebar).toBeVisible();
  });

  test("should filter sessions by search", async ({ page }) => {
    await page.goto("/app");

    // Find search input
    const searchInput = page.getByRole("searchbox");
    if (await searchInput.isVisible()) {
      await searchInput.fill("test-repo");

      // Should filter visible sessions
      // (Implementation depends on how sessions are rendered)
    }
  });

  test("should navigate between sessions", async ({ page }) => {
    await page.goto("/app");

    // Click on a session in the sidebar
    const sessionLink = page.getByRole("link", { name: /session/i }).first();
    if (await sessionLink.isVisible()) {
      await sessionLink.click();

      // Should navigate to session page
      await expect(page).toHaveURL(/\/app\/session\//);
    }
  });
});
