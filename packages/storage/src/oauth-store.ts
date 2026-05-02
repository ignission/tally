import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { type McpOAuthToken, McpOAuthTokenSchema, McpServerIdRegex } from '@tally/core';
import { stringify } from 'yaml';

import { resolveProjectPaths } from './project-dir';
import { readYaml, YamlValidationError } from './yaml';

// ADR-0011: 外部 MCP server の OAuth 2.1 token store。
// `<projectDir>/oauth/<mcpServerId>.yaml` 1 ファイル 1 server。
//
// 設計判断:
// - 平文 YAML で書き込み、ファイル mode を 0o600 に絞る (MVP)。OS keychain 統合は
//   ADR-0012 で別途検討する。
// - mcpServerId は file 名にそのまま使うので、core の McpServerIdRegex
//   (英小文字 / 数字 / ハイフン) で予め検証されている前提。`../foo` 等の path
//   traversal は McpServerConfigSchema で弾かれる。
// - 1 server 1 file にすることで、削除 / 個別読み出しが O(1) になる。プロジェクト
//   切替や server 削除時の cleanup も `unlink` 1 回で済む。
// - 破損ファイル (YamlValidationError) は warn して null を返す。FS 系 IO エラー
//   (EACCES 等) は再 throw する (chat-store.ts の listChats と同じ方針)。
export interface OAuthStore {
  // 該当 server の token を読む。未保存・破損なら null。
  read(mcpServerId: string): Promise<McpOAuthToken | null>;
  // token を書き込む。ファイル mode は 0o600 に強制する。
  write(token: McpOAuthToken): Promise<void>;
  // 該当 server の token を削除する。存在しなければ no-op。
  delete(mcpServerId: string): Promise<void>;
  // 保存済み mcpServerId の一覧を返す (ソート済み)。
  list(): Promise<string[]>;
}

export class FileSystemOAuthStore implements OAuthStore {
  private readonly oauthDir: string;

  constructor(projectDir: string) {
    this.oauthDir = resolveProjectPaths(projectDir).oauthDir;
  }

  private filePath(mcpServerId: string): string {
    // ストレージ境界での path traversal 防御 (CR Major)。上流で McpServerConfigSchema
    // が同じ regex で検証している前提だが、それに依存せず自己防衛する。
    if (!McpServerIdRegex.test(mcpServerId)) {
      throw new Error(`invalid mcpServerId for oauth store: ${mcpServerId}`);
    }
    return path.join(this.oauthDir, `${mcpServerId}.yaml`);
  }

  async read(mcpServerId: string): Promise<McpOAuthToken | null> {
    try {
      return await readYaml(this.filePath(mcpServerId), McpOAuthTokenSchema);
    } catch (err) {
      // YAML 破損は warn + null。FS 系エラーは再スロー (silent fail で原因隠蔽を防ぐ)。
      if (err instanceof YamlValidationError) {
        console.warn(`[oauth-store] skip broken token file for ${mcpServerId}:`, err);
        return null;
      }
      throw err;
    }
  }

  async write(token: McpOAuthToken): Promise<void> {
    await fs.mkdir(this.oauthDir, { recursive: true });
    const filePath = this.filePath(token.mcpServerId);
    const yaml = stringify(token, { lineWidth: 120, blockQuote: true });
    // TOCTOU 防止: tmp ファイルを最初から 0o600 で open → 書き込み → rename する。
    // writeYaml + 後で chmod の経路だと、rename 直後 (0o644) に別プロセスが
    // accessToken を読める瞬間がある (codex P1 指摘)。fs.open(mode) で初期パーミッションを
    // owner-only に固定し、rename で perms を保つ。
    // Windows は POSIX permission を持たないが、open mode 引数は ignored で問題なし。
    // tmp suffix は 1 書き込みごとに一意。同 mcpServerId への並行 write が
    // 同一プロセス内で起きても互いの tmp を上書きしない (CR Major)。
    const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    const fd = await fs.open(tmpPath, 'w', 0o600);
    try {
      await fd.writeFile(yaml, 'utf8');
    } finally {
      await fd.close();
    }
    try {
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      // rename 失敗時は tmp を残さない。unlink 自体の失敗は元エラーを優先。
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  async delete(mcpServerId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(mcpServerId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async list(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.oauthDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    return entries
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''))
      .sort();
  }
}
