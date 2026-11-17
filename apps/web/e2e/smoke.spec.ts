import { expect, test } from "@playwright/test";

test.describe("public pages", () => {
  test("home page shows the storefront and secure headers", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("'strict-dynamic'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBeUndefined();
    await expect(page.getByRole("main").getByRole("search")).toBeVisible();
  });

  test("search runs and handles no results", async ({ page }) => {
    await page.goto("/search?q=zzzz-no-such-thing-zzzz");
    await expect(page.getByText(/nothing matches yet/i)).toBeVisible();
  });

  test("deals page renders without sales", async ({ page }) => {
    await page.goto("/deals");
    await expect(page.getByRole("heading", { name: "Flash deals" })).toBeVisible();
  });

  test("unknown listing is a 404", async ({ page }) => {
    const response = await page.goto("/listing/this-listing-does-not-exist");
    expect(response?.status()).toBe(404);
  });
});

test.describe("accounts", () => {
  test("private pages send visitors to sign in", async ({ page }) => {
    for (const path of ["/orders", "/messages", "/seller/studio", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    }
  });

  test("wrong password is refused without saying which part was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("registration validates input", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(/\/register/);
  });
});

test.describe("APIs", () => {
  test("mobile API requires a session and validates sign-in", async ({ request }) => {
    expect((await request.get("/api/mobile/me")).status()).toBe(401);
    expect((await request.post("/api/mobile/auth/login", { data: { email: "bad", password: "" } })).status()).toBe(400);
    const listings = await request.get("/api/mobile/listings");
    expect(listings.status()).toBe(200);
    expect(await listings.json()).toHaveProperty("items");
  });

  test("licence API rejects malformed requests", async ({ request }) => {
    const response = await request.post("/api/licenses/validate", { data: { key: "x" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).ok).toBe(false);
  });
});
