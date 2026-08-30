import { cronJobs } from "convex/server";

const crons = cronJobs();

export function registerCrons(): never {
  throw new Error("todo");
}

export default crons;
