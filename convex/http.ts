import { httpRouter } from "convex/server";
import { handleContextWebhook, handleErrorIngest } from "./incidents";
import { handleChatCompletions, handleDocs, handleDocsControl } from "./vendor";

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
  path: "/demo/openai/v1/chat/completions",
  method: "POST",
  handler: handleChatCompletions,
});

http.route({
  path: "/demo/openai/docs",
  method: "GET",
  handler: handleDocs,
});

http.route({
  path: "/demo/openai/docs",
  method: "POST",
  handler: handleDocsControl,
});

export default http;
