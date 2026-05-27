#!/usr/bin/env node
import { runBackfillTag } from "./backfill-paper-tag.mjs";

runBackfillTag("slam").catch((error) => {
  console.error(error);
  process.exit(1);
});
