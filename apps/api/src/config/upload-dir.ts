import { resolve, join } from 'path';

/**
 * Resolved once at import time — the single source of truth for where
 * uploaded resumes live, shared by main.ts (startup mkdir), the resume
 * upload multer config, and the resume reader. Defaults to ./uploads
 * (relative to cwd) to match prior behavior when UPLOAD_DIR isn't set.
 *
 * On Render, this directory is on ephemeral local disk unless a Render
 * "Disk" is explicitly attached and mounted at this path — without one,
 * anything uploaded here is lost on every redeploy/restart.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR)
  : join(process.cwd(), 'uploads');
