import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("poll active Devin sessions", { seconds: 20 }, internal.devin.poll, {});

export default crons;
