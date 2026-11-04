import fs from 'fs';
import path from 'path';

export interface QboTokens {
  refresh_token?: string;
  realm_id?: string;
}

/**
 * Persists QuickBooks OAuth tokens to a gitignored JSON file.
 *
 * The rotating refresh/access tokens live here instead of in `.env` so that
 * persisting a rotated token is an atomic, structured write rather than a
 * read-modify-write of a tracked config file (which clobbers comments, races
 * across processes, and leaks secrets into git).
 */
export class TokenStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Read the persisted tokens. Returns `{}` if the file is absent or unreadable. */
  load(): QboTokens {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as QboTokens;
    } catch {
      return {};
    }
  }

  /**
   * Merge `partial` into the stored tokens and persist atomically: write a temp
   * file in the same directory, then rename it over the target. A reader never
   * observes a half-written file, and a crash mid-write can't corrupt the store.
   */
  save(partial: QboTokens): QboTokens {
    const merged: QboTokens = { ...this.load(), ...partial };
    const tmp = path.join(path.dirname(this.filePath), `.qbo-tokens.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    return merged;
  }
}
