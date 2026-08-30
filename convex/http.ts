import { httpRouter } from "convex/server";
import { handleDocs, handlePaymentIntents } from "./vendor";

const http = httpRouter();

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

export default http;
