import { defineConfig } from "vite";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

import { handleIntegrationOAuth } from "./server/integration-oauth";
import { handleEventsData } from "./server/events-data";
import { handleEventTickets } from "./server/event-tickets";
import { handlePaymentProviders } from "./server/payment-providers";
import { handlePaymentCheckout } from "./server/payment-checkout";
import { handlePaymentData } from "./server/payment-data";
import { handleAuth } from "./server/auth";
import { handleFormsData } from "./server/forms-data";
import { handleGeoAddress } from "./server/geo-address";
import { handlePublicSubmissionLocation } from "./server/public-submission-location";
import { handleSettings } from "./server/settings";
import { handleAnalyticsData } from "./server/analytics-data";
import { handleEmailData } from "./server/email-data";
import { handleEmailInbound } from "./server/email-inbound";
import { handleEmailEvents } from "./server/email-events";
import { handleEmailAutomation } from "./server/email-automation";
import { handleNotificationsData } from "./server/notifications-data";
import { handleOrdersData } from "./server/orders-data";
import { handleProjectsData } from "./server/projects-data";
import { handleCrmData } from "./server/crm-data";
import { handleContactsData } from "./server/contacts-data";
import { handleCampaignCountdown } from "./server/campaign-countdown";
import { handleCampaignDispatch } from "./server/campaign-dispatch-api";
import { dispatchDueCampaignBatches } from "./server/campaign-dispatch";
import {
  handleCampaignAnalyticsApi,
  handleCampaignAnalyticsRealtime,
  handleCampaignAnalyticsWorker,
} from "./server/campaign-analytics-api";
import { processCampaignAnalyticsEvents } from "./server/campaign-analytics-engine";
import {
  handleCampaignTracking,
  handleCampaignUnsubscribe,
} from "./server/campaign-tracking";
import { handleOnboardingData } from "./server/onboarding-data";
import { handleAppointmentsData } from "./server/appointments-data";
import { handleSchedulingIntegrations } from "./server/scheduling-oauth";
import { handleIntegrationsData } from "./server/integrations-data";
import { handleFilesDocumentsData } from "./server/files-documents-data";
import { handleStorageApi } from "./server/storage-api";
import {
  handleAiAssistant,
  handleAiModuleAccess,
} from "./server/ai-assistant";
import { handleHealth } from "./server/health";
import { handleToSendWebhook } from "./server/tosend-webhook";
import { handleEmailHealth } from "./server/email-health";
import {
  handleWorkflowCron,
  handleWorkflowWebhook,
  handleWorkflowsData,
} from "./server/workflows-data";
import { handleCmsCron, handleCmsData, handleCmsWebhook } from "./server/cms-data";

const waitForDevelopmentScheduler = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isTransientDevelopmentDatabaseError = (error: unknown) => {
  const details = [
    error instanceof Error ? error.message : String(error),
    error instanceof Error && error.cause ? String(error.cause) : "",
  ]
    .join(" ")
    .toLowerCase();
  return /fetch failed|eai_again|enotfound|econnreset|econnrefused|etimedout|enetwork|socket hang up|networkerror/.test(
    details,
  );
};

const describeDevelopmentSchedulerError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause
      ? ` (${String(error.cause).slice(0, 240)})`
      : "";
  return `${message.slice(0, 400)}${cause}`;
};

const withDevelopmentDatabaseRetry = async <Result>(
  operation: () => Promise<Result>,
) => {
  let lastError: unknown;
  for (const delay of [0, 750, 2_000]) {
    if (delay) await waitForDevelopmentScheduler(delay);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDevelopmentDatabaseError(error)) throw error;
    }
  }
  throw lastError;
};

const integrationOAuthPlugin = (): Plugin => ({
  name: "maxform-integration-oauth",
  configureServer(server) {
    server.middlewares.use(
      "/api/integrations/oauth",
      (request, response) => {
        void handleIntegrationOAuth(request, response);
      },
    );
  },
});

const eventTicketsPlugin = (): Plugin => ({
  name: "maxform-event-tickets",
  configureServer(server) {
    server.middlewares.use(
      "/api/events/tickets",
      (request, response) => {
        void handleEventTickets(request, response);
      },
    );
  },
});

const eventsDataPlugin = (): Plugin => ({
  name: "maxform-events-data",
  configureServer(server) {
    server.middlewares.use("/api/events/data", (request, response) => {
      void handleEventsData(request, response);
    });
  },
});

const paymentProvidersPlugin = (): Plugin => ({
  name: "maxform-payment-providers",
  configureServer(server) {
    server.middlewares.use(
      "/api/payments/providers",
      (request, response) => {
        void handlePaymentProviders(request, response);
      },
    );
  },
});

const paymentCheckoutPlugin = (): Plugin => ({
  name: "maxform-payment-checkout",
  configureServer(server) {
    server.middlewares.use(
      "/api/payments/checkout",
      (request, response) => {
        void handlePaymentCheckout(request, response);
      },
    );
  },
});

const paymentDataPlugin = (): Plugin => ({
  name: "maxform-payment-data",
  configureServer(server) {
    server.middlewares.use("/api/payments/data", (request, response) => {
      void handlePaymentData(request, response);
    });
  },
});

const healthPlugin = (): Plugin => ({
  name: "maxform-health",
  configureServer(server) {
    server.middlewares.use("/api/health", (request, response) => {
      void handleHealth(request, response);
    });
  },
});

const toSendWebhookPlugin = (): Plugin => ({
  name: "maxform-tosend-webhook",
  configureServer(server) {
    server.middlewares.use("/api/webhooks/email/tosend", (request, response) => {
      void handleToSendWebhook(request, response);
    });
  },
});

const emailHealthPlugin = (): Plugin => ({
  name: "maxform-email-health",
  configureServer(server) {
    server.middlewares.use("/api/internal/email/health", (request, response) => {
      void handleEmailHealth(request, response);
    });
  },
});

const analyticsDataPlugin = (): Plugin => ({
  name: "maxform-analytics-data",
  configureServer(server) {
    server.middlewares.use("/api/analytics/data", (request, response) => {
      void handleAnalyticsData(request, response);
    });
  },
});

const aiAssistantPlugin = (): Plugin => ({
  name: "maxform-ai-assistant",
  configureServer(server) {
    server.middlewares.use("/api/ai/assistant", (request, response) => {
      void handleAiAssistant(request, response);
    });
  },
});

const aiModuleAccessPlugin = (): Plugin => ({
  name: "maxform-ai-module-access",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url || "", "http://localhost").pathname;
      if (!/^\/api\/workspaces\/[^/]+\/ai-module-access\/?$/i.test(pathname)) {
        next();
        return;
      }
      void handleAiModuleAccess(request, response);
    });
  },
});

const emailDataPlugin = (): Plugin => ({
  name: "maxform-email-data",
  configureServer(server) {
    server.middlewares.use("/api/email/data", (request, response) => {
      void handleEmailData(request, response);
    });
  },
});

const emailInboundPlugin = (): Plugin => ({
  name: "maxform-email-inbound",
  configureServer(server) {
    server.middlewares.use("/api/email/inbound", (request, response) => {
      void handleEmailInbound(request, response);
    });
  },
});

const emailEventsPlugin = (): Plugin => ({
  name: "maxform-email-events",
  configureServer(server) {
    server.middlewares.use("/api/email/events", (request, response) => {
      void handleEmailEvents(request, response);
    });
  },
});

const emailAutomationPlugin = (): Plugin => ({
  name: "maxform-email-automation",
  configureServer(server) {
    server.middlewares.use("/api/email/automation", (request, response) => {
      void handleEmailAutomation(request, response);
    });
  },
});

const crmDataPlugin = (): Plugin => ({
  name: "maxform-crm-data",
  configureServer(server) {
    server.middlewares.use("/api/crm/data", (request, response) => {
      void handleCrmData(request, response);
    });
  },
});

const contactsDataPlugin = (): Plugin => ({
  name: "maxform-contacts-data",
  configureServer(server) {
    server.middlewares.use("/api/contacts/data", (request, response) => {
      void handleContactsData(request, response);
    });
  },
});

const campaignCountdownPlugin = (): Plugin => ({
  name: "maxform-campaign-countdown",
  configureServer(server) {
    server.middlewares.use("/api/campaigns/countdown", (request, response) => {
      void handleCampaignCountdown(request, response);
    });
  },
});

const campaignDispatchPlugin = (): Plugin => ({
  name: "maxform-campaign-dispatch",
  configureServer(server) {
    server.middlewares.use("/api/campaigns/dispatch", (request, response) => {
      void handleCampaignDispatch(request, response);
    });
  },
});

const appointmentsDataPlugin = (): Plugin => ({
  name: "maxform-appointments-data",
  configureServer(server) {
    server.middlewares.use("/api/appointments/data", (request, response) => {
      void handleAppointmentsData(request, response);
    });
  },
});

const schedulingIntegrationsPlugin = (): Plugin => ({
  name: "maxform-scheduling-integrations",
  configureServer(server) {
    server.middlewares.use("/api/appointments/integrations", (request, response) => {
      void handleSchedulingIntegrations(request, response);
    });
  },
});

const campaignAnalyticsPlugin = (): Plugin => ({
  name: "maxform-campaign-analytics",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(
        request.url || "/",
        "http://localhost",
      ).pathname.replace(/\/+$/, "") || "/";
      if (pathname === "/api/campaigns/analytics-worker") {
        void handleCampaignAnalyticsWorker(request, response);
        return;
      }
      if (
        pathname === "/api/campaigns/realtime" ||
        pathname === "/api/campaigns/analytics-stream"
      ) {
        void handleCampaignAnalyticsRealtime(request, response);
        return;
      }
      if (
        pathname === "/api/campaigns/analytics" ||
        /^\/api\/campaigns\/[0-9a-f-]{36}\/analytics$/i.test(pathname)
      ) {
        void handleCampaignAnalyticsApi(request, response);
        return;
      }
      next();
    });
  },
});

/**
 * Vercel drives the production dispatcher from vercel.json. A local Vite
 * server has no cron runtime, so development would otherwise leave a due
 * campaign waiting forever. This poller is serve-only and never runs in a
 * Vercel build or production process.
 */
const campaignDevelopmentSchedulerPlugin = (): Plugin => ({
  name: "maxform-campaign-development-scheduler",
  apply: "serve",
  configureServer(server) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production") return;

    let tickInFlight = false;
    let nextAttemptAt = 0;
    let consecutiveFailures = 0;

    const tick = async () => {
      if (tickInFlight || Date.now() < nextAttemptAt) return;
      tickInFlight = true;
      try {
        const result = await withDevelopmentDatabaseRetry(() =>
          dispatchDueCampaignBatches(5),
        );
        if (result.batchCount) {
          console.info(
            `[campaign-dev-dispatch] dispatched ${result.batchCount} due batch${
              result.batchCount === 1 ? "" : "es"
            }`,
          );
        }
        const analytics = await withDevelopmentDatabaseRetry(() =>
          processCampaignAnalyticsEvents({ limit: 1_000 }),
        );
        if (analytics.processed) {
          console.info(
            `[campaign-dev-analytics] processed ${analytics.processed} event${
              analytics.processed === 1 ? "" : "s"
            } across ${analytics.campaigns} campaign${
              analytics.campaigns === 1 ? "" : "s"
            }`,
          );
        }
        consecutiveFailures = 0;
        nextAttemptAt = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const retryDelay = Math.min(
          5 * 60_000,
          15_000 * 2 ** Math.min(consecutiveFailures - 1, 4),
        );
        nextAttemptAt = Date.now() + retryDelay;
        console.warn(
          `[campaign-dev-dispatch] tick failed; retrying in ${Math.ceil(
            retryDelay / 1_000,
          )}s`,
          describeDevelopmentSchedulerError(error),
        );
      } finally {
        tickInFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    server.httpServer?.once("close", () => clearInterval(timer));
  },
});

const integrationsDataPlugin = (): Plugin => ({
  name: "maxform-integrations-data",
  configureServer(server) {
    server.middlewares.use("/api/integrations/data", (request, response) => {
      void handleIntegrationsData(request, response);
    });
  },
});

const campaignTrackingPlugin = (): Plugin => ({
  name: "maxform-campaign-tracking",
  configureServer(server) {
    server.middlewares.use("/api/campaigns/track", (request, response) => {
      void handleCampaignTracking(request, response);
    });
    server.middlewares.use("/api/campaigns/unsubscribe", (request, response) => {
      void handleCampaignUnsubscribe(request, response);
    });
  },
});

const onboardingPlugin = (): Plugin => ({
  name: "maxform-onboarding",
  configureServer(server) {
    server.middlewares.use("/api/onboarding", (request, response) => {
      void handleOnboardingData(request, response);
    });
  },
});

const ordersDataPlugin = (): Plugin => ({
  name: "maxform-orders-data",
  configureServer(server) {
    server.middlewares.use("/api/orders/data", (request, response) => {
      void handleOrdersData(request, response);
    });
  },
});

const projectsDataPlugin = (): Plugin => ({
  name: "maxform-projects-data",
  configureServer(server) {
    server.middlewares.use("/api/projects/data", (request, response) => {
      void handleProjectsData(request, response);
    });
  },
});

const notificationsDataPlugin = (): Plugin => ({
  name: "maxform-notifications-data",
  configureServer(server) {
    server.middlewares.use("/api/notifications/data", (request, response) => {
      void handleNotificationsData(request, response);
    });
  },
});

const filesDocumentsDataPlugin = (): Plugin => ({
  name: "maxform-files-documents-data",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(
        request.url || "/",
        "http://localhost",
      ).pathname;
      if (request.method !== "GET") {
        next();
        return;
      }
      const shared = pathname.match(
        /^\/([A-Za-z0-9]{4,6})\/content\/([A-Za-z0-9_-]{22}|[0-9a-fA-F]{48})$/,
      );
      const branded = pathname.match(
        /^\/([A-Za-z0-9]{4,6})\/file\/([A-Za-z0-9_-]{44})$/,
      );
      if (!shared && !branded) {
        next();
        return;
      }
      const params = shared
        ? new URLSearchParams({
            module: "files",
            action: "clean-shared-content",
            workspaceId: shared[1],
            fileId: shared[2],
          })
        : new URLSearchParams({
            module: "files",
            action: "branded-file",
            workspaceId: branded![1],
            fileToken: branded![2],
          });
      request.url = `/?${params.toString()}`;
      void handleFilesDocumentsData(request, response);
    });
    server.middlewares.use("/api/workspace/content", (request, response) => {
      void handleFilesDocumentsData(request, response);
    });
  },
});

const storagePlugin = (): Plugin => ({
  name: "maxform-r2-storage",
  configureServer(server) {
    server.middlewares.use("/api/storage", (request, response) => {
      void handleStorageApi(request, response);
    });
  },
});

const authPlugin = (): Plugin => ({
  name: "maxform-auth",
  configureServer(server) {
    server.middlewares.use("/api/auth", (request, response) => {
      void handleAuth(request, response);
    });
  },
});

const formsDataPlugin = (): Plugin => ({
  name: "maxform-forms-data",
  configureServer(server) {
    server.middlewares.use("/api/forms/data", (request, response) => {
      void handleFormsData(request, response);
    });
  },
});

const workflowsPlugin = (): Plugin => ({
  name: "maxform-workflows",
  configureServer(server) {
    server.middlewares.use("/api/workflows/data", (request, response) => {
      void handleWorkflowsData(request, response);
    });
    server.middlewares.use("/api/workflows/webhook", (request, response) => {
      void handleWorkflowWebhook(request, response);
    });
    server.middlewares.use("/api/workflows/cron", (request, response) => {
      void handleWorkflowCron(request, response);
    });
  },
});

const cmsStoresPlugin = (): Plugin => ({
  name: "maxform-cms-stores",
  configureServer(server) {
    server.middlewares.use("/api/cms/data", (request, response) => {
      void handleCmsData(request, response);
    });
    server.middlewares.use("/api/cms/webhook", (request, response) => {
      void handleCmsWebhook(request, response);
    });
    server.middlewares.use("/api/cms/cron", (request, response) => {
      void handleCmsCron(request, response);
    });
  },
});

const settingsPlugin = (): Plugin => ({
  name: "maxform-settings",
  configureServer(server) {
    server.middlewares.use("/api/settings", (request, response) => {
      void handleSettings(request, response);
    });
  },
});

const geoAddressPlugin = (): Plugin => ({
  name: "maxform-geo-address",
  configureServer(server) {
    server.middlewares.use("/api/geo/address", (request, response) => {
      void handleGeoAddress(request, response);
    });
  },
});

const publicSubmissionLocationPlugin = (): Plugin => ({
  name: "maxform-public-submission-location",
  configureServer(server) {
    server.middlewares.use("/api/forms/submission-location", (request, response) => {
      void handlePublicSubmissionLocation(request, response);
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  const tunnelHost = (() => {
    // PUBLIC_APP_URL is the single canonical origin used by tracking,
    // callbacks, and local tunnels. Keep the older DEV_PUBLIC_APP_URL as an
    // optional override for existing setups, but do not require a duplicate
    // URL in .env just to satisfy Vite's host protection.
    const candidate = String(
      process.env.DEV_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || "",
    ).trim();
    if (!candidate) return "";
    try {
      return new URL(candidate).hostname;
    } catch {
      return "";
    }
  })();
  const configuredAllowedHosts = String(
    process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || "",
  )
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  // Cloudflare Quick Tunnels rotate their random subdomain on every start.
  // Allow only that provider's subdomain family during local development so
  // a tunnel rotation does not require another source change. Never carry the
  // wildcard into a production Vite server.
  const developmentTunnelHosts =
    mode === "development" ? [".trycloudflare.com"] : [];
  const allowedHosts = Array.from(
    new Set(
      [...configuredAllowedHosts, tunnelHost, ...developmentTunnelHosts].filter(
        Boolean,
      ),
    ),
  );
  return {
    server: {
      host: "::",
      port: 8080,
      // Keep Vite's host protection enabled, but allow the exact tunnel host
      // configured for this development session. Restart Vite after rotating
      // an ngrok/Cloudflare URL so the new hostname is loaded.
      allowedHosts,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "favicon.svg", "apple-touch-icon.png"],
        manifest: {
          name: "MaxForm",
          short_name: "MaxForm",
          description:
            "Forms, events, payments, CRM and automation in one workspace.",
          theme_color: "#ff5a1f",
          background_color: "#ffffff",
          icons: [
            {
              src: "/pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "/pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          // Precache only the application shell. Feature modules are already
          // route-split and the runtime strategy caches each module when it is
          // actually opened; precaching every lazy chunk made a fresh install
          // download the entire workspace up front.
          globPatterns: [
            "**/*.{html,ico,png,svg,webp,jpg,jpeg,woff2}",
            "assets/*.css",
            "assets/index-*.js",
            "assets/react-core-*.js",
            "assets/ui-vendor-*.js",
          ],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/[A-Za-z0-9]{4,6}\/content\//,
            /^\/[A-Za-z0-9]{4,6}\/file\//,
          ],
          runtimeCaching: [
            {
              // Workspace file responses are private and short-lived, so they
              // must never land in the shared runtime cache.
              urlPattern: ({ request, url }) =>
                ["font", "image", "script", "style"].includes(
                  request.destination,
                ) &&
                !/^\/[A-Za-z0-9]{4,6}\/(file|content)\//.test(url.pathname),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "maxform-static-assets",
                expiration: {
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                  maxEntries: 180,
                },
              },
            },
          ],
        },
      }),
      integrationOAuthPlugin(),
      eventsDataPlugin(),
      eventTicketsPlugin(),
      paymentProvidersPlugin(),
      paymentCheckoutPlugin(),
      paymentDataPlugin(),
      healthPlugin(),
      analyticsDataPlugin(),
    aiAssistantPlugin(),
    aiModuleAccessPlugin(),
      emailDataPlugin(),
      emailInboundPlugin(),
      emailEventsPlugin(),
      emailAutomationPlugin(),
      notificationsDataPlugin(),
      ordersDataPlugin(),
      projectsDataPlugin(),
      campaignCountdownPlugin(),
      campaignDispatchPlugin(),
      campaignAnalyticsPlugin(),
      campaignDevelopmentSchedulerPlugin(),
      campaignTrackingPlugin(),
      toSendWebhookPlugin(),
      emailHealthPlugin(),
      onboardingPlugin(),
      appointmentsDataPlugin(),
      schedulingIntegrationsPlugin(),
      integrationsDataPlugin(),
    crmDataPlugin(),
    contactsDataPlugin(),
      filesDocumentsDataPlugin(),
      storagePlugin(),
      authPlugin(),
      formsDataPlugin(),
      workflowsPlugin(),
      cmsStoresPlugin(),
      geoAddressPlugin(),
      publicSubmissionLocationPlugin(),
      settingsPlugin(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // `world-countries` is an intentionally lazy metadata chunk (~616 kB
      // raw / ~123 kB gzip). Keep the warning threshold just above that
      // audited exception; feature chunks remain split and independently
      // cached rather than being merged into a large initial vendor bundle.
      chunkSizeWarningLimit: 630,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/scheduler/")
            ) {
              return "react-core";
            }
            if (id.includes("node_modules/recharts")) return "charts";
            if (
              id.includes("node_modules/@react-three") ||
              id.includes("node_modules/three")
            ) {
              return "three";
            }
            if (id.includes("node_modules/@tanstack")) return "tanstack";
            if (id.includes("node_modules/lucide-react")) return "icons";
            if (
              id.includes("node_modules/@radix-ui") ||
              id.includes("node_modules/@floating-ui") ||
              id.includes("node_modules/cmdk") ||
              id.includes("node_modules/vaul") ||
              id.includes("node_modules/aria-hidden") ||
              id.includes("node_modules/react-remove-scroll") ||
              id.includes("node_modules/react-style-singleton") ||
              id.includes("node_modules/use-callback-ref") ||
              id.includes("node_modules/use-sidecar")
            ) {
              return "ui-vendor";
            }
            if (
              id.includes("node_modules/libphonenumber-js")
            ) {
              return "phone-data";
            }
            if (id.includes("node_modules/react-phone-number-input")) {
              return "phone-ui";
            }
            if (
              id.includes("node_modules/countries-and-timezones")
            ) {
              return "timezone-vendor";
            }
            if (id.includes("node_modules/world-countries")) return "countries-vendor";
            if (id.includes("node_modules/date-fns")) return "date-vendor";
            if (id.includes("node_modules/@neondatabase")) return "database-vendor";
            if (
              id.includes("node_modules/jose") ||
              id.includes("node_modules/jsonwebtoken") ||
              id.includes("node_modules/bcrypt-ts")
            ) {
              return "auth-vendor";
            }
            if (id.includes("node_modules/dexie")) return "storage-vendor";
            if (id.includes("node_modules/qrcode")) return "qr-vendor";
            // Keep the remaining dependencies independently cacheable instead
            // of accumulating every uncategorized package in one megachunk.
            const packagePath = id.split("node_modules/").pop() || "dependency";
            const packageParts = packagePath.split("/");
            const packageName = packageParts[0].startsWith("@")
              ? `${packageParts[0]}-${packageParts[1] || "package"}`
              : packageParts[0];
            if (
              packageName === "detect-node" ||
              packageName === "detect-node-es" ||
              packageName === "dom-helpers"
            ) {
              return undefined;
            }
            return `dep-${packageName.replace(/[^A-Za-z0-9_-]/g, "-")}`;
          },
        },
      },
    },
  };
});
