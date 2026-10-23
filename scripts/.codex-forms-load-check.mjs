import { chromium } from "playwright";
import { SignJWT } from "jose";

const userId = "f326b6ea-37e9-4e37-805d-437b48b432c1";
const secret = process.env.JWT_SECRET || "";

if (secret.length < 32) {
  throw new Error("JWT_SECRET is unavailable.");
}

const token = await new SignJWT({
  email: "test@example.com",
  userId,
})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("maxform")
  .setAudience("maxform-dashboard")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  colorScheme: "dark",
  viewport: { height: 900, width: 1440 },
});
const requests = [];
const startedAt = Date.now();

await page.addInitScript(
  ({ accessToken }) => {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", "diagnostic-refresh-token");
  },
  { accessToken: token },
);

page.on("request", (request) => {
  if (
    request.url().includes("/api/") ||
    request.url().includes("neon.tech")
  ) {
    requests.push({
      method: request.method(),
      startedAt: Date.now(),
      url: request.url(),
    });
  }
});

page.on("response", (response) => {
  const requestUrl = response.url();
  const request = requests.findLast(
    (item) => item.url === requestUrl && item.finishedAt == null,
  );
  if (request) {
    request.finishedAt = Date.now();
    request.status = response.status();
  }
});

page.on("requestfailed", (request) => {
  const item = requests.findLast(
    (candidate) =>
      candidate.url === request.url() && candidate.finishedAt == null,
  );
  if (item) item.failure = request.failure()?.errorText || "Request failed";
});

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(
  "http://127.0.0.1:8080/dashboard?tab=forms&view=overview",
  { timeout: 30_000, waitUntil: "domcontentloaded" },
);

let result = "timed-out";
try {
  await page
    .getByText("Paid client onboarding", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 25_000 });
  result = "form-visible";
} catch {
  if (
    await page
      .getByText("No forms yet", { exact: false })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    result = "empty-visible";
  }
}

console.log(
  JSON.stringify(
    {
      elapsedMs: Date.now() - startedAt,
      errors: errors.map((error) => error.slice(0, 300)),
      requests: requests.map((request) => {
        const url = new URL(request.url);
        return {
          failure: request.failure || null,
          method: request.method,
          ms: request.finishedAt
            ? request.finishedAt - request.startedAt
            : null,
          path: `${url.pathname}${url.search}`,
          status: request.status || null,
        };
      }),
      result,
    },
    null,
    2,
  ),
);

await browser.close();
