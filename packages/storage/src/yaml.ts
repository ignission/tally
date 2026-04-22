import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  type Document,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type YAMLMap,
  type YAMLSeq,
  type Node as YamlNode,
} from 'yaml';
import type { z } from 'zod';

// YAML を読み込んで Zod で検証。ファイルが無い場合は null を返す。
export async function readYaml<S extends z.ZodTypeAny>(
  filePath: string,
  schema: S,
): Promise<z.infer<S> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  // eemeli/yaml は ISO8601 文字列をデフォルトで string のまま扱う (YAML 1.2)。
  // createdAt / updatedAt が Date オブジェクト化しないので Zod の string 検証がそのまま通る。
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new YamlValidationError(filePath, doc.errors.map((e) => e.message).join('\n'));
  }
  const parsed = doc.toJS();
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new YamlValidationError(filePath, result.error.message);
  }
  return result.data;
}

// 値を YAML として書き込む。既存ファイルがあればコメント・キー順を可能な限り保存する。
// 親ディレクトリが無ければ作る。
export async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let existingDoc: Document | null = null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const doc = parseDocument(raw);
    if (doc.errors.length === 0) existingDoc = doc;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const text =
    existingDoc && isPlainObject(data)
      ? serializePreservingComments(existingDoc, data as Record<string, unknown>)
      : stringify(data, { lineWidth: 120, blockQuote: true });

  await atomicWriteFile(filePath, text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 既存 Document の top-level key 単位でコメントを保持しつつ新しい値に差し替える。
// - data にない key は Document から削除
// - data にあるが Document にない key は末尾に追加
// - 既存 key に設定された commentBefore / comment は doc.set() では失われないため保存される
// 配列要素 (特に id 持ちオブジェクトの配列) は ID マッチングで in-place 更新し、
// 既存要素に付いた commentBefore を保全する。
function serializePreservingComments(doc: Document, data: Record<string, unknown>): string {
  const contents = doc.contents;
  if (!isMap(contents)) {
    // top-level が Map でない (空 Document など) → 全面書き換え
    doc.contents = doc.createNode(data) as typeof doc.contents;
    return String(doc);
  }

  const currentKeys: string[] = contents.items
    .map((item) => (isScalar(item.key) ? String(item.key.value) : null))
    .filter((k): k is string => k !== null);

  // data にない key は削除
  for (const k of currentKeys) {
    if (!(k in data)) doc.delete(k);
  }

  // data の key を更新。配列 (id 持ちオブジェクトの配列) は要素単位でマージ、
  // それ以外は単純な set。set は既存 Pair の commentBefore / comment を保持する。
  for (const [k, v] of Object.entries(data)) {
    const existingValue = contents.get(k, true);
    if (Array.isArray(v) && isSeq(existingValue) && isArrayOfIdObjects(v)) {
      mergeSeqById(existingValue, v, doc);
    } else {
      doc.set(k, v);
    }
  }
  return String(doc);
}

function isArrayOfIdObjects(
  arr: unknown[],
): arr is Array<Record<string, unknown> & { id: string }> {
  return arr.every(
    (x) =>
      x !== null &&
      typeof x === 'object' &&
      !Array.isArray(x) &&
      typeof (x as Record<string, unknown>).id === 'string',
  );
}

// YAMLSeq を id ベースで in-place マージする。
// - 既存要素は ID 一致で残し、各フィールドのみ差替え (コメントを保全)
// - 新規要素は末尾追加、削除要素は取り除く
// - 配列順は data の順を正とする
function mergeSeqById(
  seq: YAMLSeq,
  data: Array<Record<string, unknown> & { id: string }>,
  doc: Document,
): void {
  // 既存アイテムを id で引ける Map にする
  const existingById = new Map<string, YAMLMap>();
  for (const item of seq.items) {
    if (isMap(item)) {
      const idNode = item.get('id', true);
      if (isScalar(idNode) && typeof idNode.value === 'string') {
        existingById.set(idNode.value, item);
      }
    }
  }

  const nextItems: YamlNode[] = [];
  for (const obj of data) {
    const existing = existingById.get(obj.id);
    if (existing) {
      updateMapInPlace(existing, obj, doc);
      nextItems.push(existing);
    } else {
      const newNode = doc.createNode(obj);
      nextItems.push(newNode as YamlNode);
    }
  }
  seq.items = nextItems;
}

// YAMLMap のフィールドを in-place で更新。既存 key は value だけ差替え、
// 無い key は削除、新規 key は末尾追加。key に付いたコメントは保持される。
function updateMapInPlace(map: YAMLMap, data: Record<string, unknown>, doc: Document): void {
  const currentKeys: string[] = map.items
    .map((pair) => (isPair(pair) && isScalar(pair.key) ? String(pair.key.value) : null))
    .filter((k): k is string => k !== null);

  for (const k of currentKeys) {
    if (!(k in data)) map.delete(k);
  }
  for (const [k, v] of Object.entries(data)) {
    // set は既存 key のコメントを保持する。value だけ新しいノードに差替え。
    map.set(k, doc.createNode(v));
  }
}

export class YamlValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly validationMessage: string,
  ) {
    super(`YAML validation failed: ${filePath}\n${validationMessage}`);
    this.name = 'YamlValidationError';
  }
}

// 書き込み途中のプロセスダウンでファイルが半壊するのを防ぐため、
// 同じディレクトリに .tmp-<pid>-<rand> を書いてから rename で置き換える。
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
