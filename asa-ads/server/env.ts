// Load asa-ads/.env from the package root, not from the process cwd: the studio
// gateway runs every product in one process started from the monorepo root.
// Existing env vars win (dotenv never overrides), same as `dotenv/config`.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
