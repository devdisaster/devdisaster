import { httpRouter } from "convex/server";

const http = httpRouter();

export async function handleRequest(_request: Request): Promise<never> {
  throw new Error("todo");
}

export default http;
