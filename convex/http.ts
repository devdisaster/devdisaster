import { httpRouter } from "convex/server";
import { handleContextWebhook, handleErrorIngest } from "./incidents";
import { handleDocs, handleDocsControl, handlePaymentIntents } from "./vendor";

const http = httpRouter();

http.route({
  path: "/webhooks/context",
  method: "POST",
  handler: handleContextWebhook,
});

http.route({
  path: "/ingest/errors",
  method: "POST",
  handler: handleErrorIngest,
});

http.route({
  path: "/demo/stripe/v1/payment_intents",
  method: "POST",
  handler: handlePaymentIntents,
});

http.route({
  pathPrefix: "/demo/stripe/v1/payment_intents/",
  method: "GET",
  handler: handlePaymentIntents,
});

http.route({
  path: "/demo/stripe/docs",
  method: "GET",
  handler: handleDocs,
});

http.route({
  path: "/demo/stripe/docs",
  method: "POST",
  handler: handleDocsControl,
});

export default http;
