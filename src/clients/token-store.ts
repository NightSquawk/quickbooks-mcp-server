import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface QboTokens {
  refresh_token?: string;
  realm_id?: string;
}

/** Rotating tokens only: static app credentials remain in environment/.env. */
export class TokenStore {
  constructor(private readonly filePath: string) {}

  /** Missing or unreadable stores allow migration from the legacy environment. */
  load(): QboTokens {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (!parsed || typeof parsed !== 'object') return {};
      const values = parsed as Record<string, unknown>;
      return {
        refresh_token: typeof values.refresh_token === 'string' && values.refresh_token.trim()
          ? values.refresh_token.trim() : undefined,
        realm_id: typeof values.realm_id === 'string' && values.realm_id.trim()
          ? values.realm_id.trim() : undefined,
      };
    } catch {
      return {};
    }
  }

  // Resolve symlinks before renaming so a configured symlink remains intact.
  // readlink also works when a link's target does not exist yet.
  private writePath(): string {
    let target = this.filePath;
    for (let depth = 0; depth < 40; depth++) {
      try {
        if (!fs.lstatSync(target).isSymbolicLink()) return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
        throw new Error('Cannot inspect the QuickBooks JSON token store. Check its permissions.');
      }
      const link = fs.readlinkSync(target);
      target = path.resolve(path.dirname(target), link);
    }
    throw new Error('Too many symbolic links in the QuickBooks JSON token-store path.');
  }

  /** Persist atomically, with private permissions, beside the resolved target. */
  save(partial: QboTokens): QboTokens {
    const merged: QboTokens = { ...this.load(), ...partial };
    let tmp: string | undefined;
    try {
      const target = this.writePath();
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      tmp = `${target}.tmp.${process.pid}.${crypto.randomUUID()}`;
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), {
        encoding: 'utf-8', mode: 0o600, flag: 'wx',
      });
      fs.renameSync(tmp, target);
      return merged;
    } catch {
      if (tmp) {
        try { fs.unlinkSync(tmp); } catch { /* best effort cleanup */ }
      }
      // Filesystem errors can include paths and written data. Keep the public
      // error safe for a host application to display or log.
      throw new Error('Could not persist the QuickBooks JSON token store. Check its path and permissions.');
    }
  }
}
