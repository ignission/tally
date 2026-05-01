import { describe, expect, it } from 'vitest';

import { AsyncIterableInput } from './async-input';

describe('AsyncIterableInput', () => {
  it('push 後に next() で順番に取り出せる (close は drain 後に呼ぶ)', async () => {
    // close 後はバッファをクリアして即時 done に倒す仕様 (teardown 用) のため、
    // 「push してから close、その後 iterate」では値が取れない。
    // 実運用では push → consumer が next() でドレイン → close の順。
    const input = new AsyncIterableInput<number>();
    input.push(1);
    input.push(2);
    input.push(3);
    const it = input.iterable()[Symbol.asyncIterator]();
    const got: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await it.next();
      if (r.done) break;
      got.push(r.value);
    }
    expect(got).toEqual([1, 2, 3]);
    input.close();
    const r = await it.next();
    expect(r.done).toBe(true);
  });

  it('iter が空の状態で next() を待ち、後の push で解決される', async () => {
    const input = new AsyncIterableInput<string>();
    const it = input.iterable()[Symbol.asyncIterator]();
    const p = it.next();
    let resolved = false;
    p.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(resolved).toBe(false);
    input.push('hi');
    const r = await p;
    expect(r).toEqual({ value: 'hi', done: false });
  });

  it('close() で待機中の next() が done: true で解決される', async () => {
    const input = new AsyncIterableInput<number>();
    const it = input.iterable()[Symbol.asyncIterator]();
    const p = it.next();
    input.close();
    const r = await p;
    expect(r.done).toBe(true);
  });

  it('close 後の push は無視される', async () => {
    const input = new AsyncIterableInput<number>();
    input.push(1);
    input.close();
    input.push(99);
    const got: number[] = [];
    for await (const v of input.iterable()) got.push(v);
    // close 時点で残バッファもクリアされるため即終了
    expect(got).toEqual([]);
  });

  it('iterator.return() で残りの push が消費されず終了', async () => {
    const input = new AsyncIterableInput<number>();
    input.push(1);
    input.push(2);
    const it = input.iterable()[Symbol.asyncIterator]();
    const r1 = await it.next();
    expect(r1.value).toBe(1);
    if (it.return) {
      const r2 = await it.return();
      expect(r2.done).toBe(true);
    }
  });

  // FIFO キュー化: next() を 2 回連続で呼んで push 1 回だけのとき、
  // 1 つ目だけ resolve され 2 つ目は close まで残る。
  it('next() を複数回先に呼んでから push しても、push 順に各 promise が解決される', async () => {
    const input = new AsyncIterableInput<number>();
    const it = input.iterable()[Symbol.asyncIterator]();
    const p1 = it.next();
    const p2 = it.next();
    input.push(10);
    input.push(20);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ value: 10, done: false });
    expect(r2).toEqual({ value: 20, done: false });
  });

  it('next() を 2 回先に呼んで push を 1 回だけしても、未解決の Promise は close で done に倒れる', async () => {
    const input = new AsyncIterableInput<number>();
    const it = input.iterable()[Symbol.asyncIterator]();
    const p1 = it.next();
    const p2 = it.next();
    input.push(42);
    const r1 = await p1;
    expect(r1).toEqual({ value: 42, done: false });
    let p2Resolved = false;
    p2.then(() => {
      p2Resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(p2Resolved).toBe(false);
    input.close();
    const r2 = await p2;
    expect(r2.done).toBe(true);
  });

  // CR Major (PR #18 2nd review): close 後にバッファ済み値を返し続けると
  // teardown で残メッセージが消費されてしまう。close 時点で打ち切りたい。
  it('close 後の next() はバッファに値が残っていても即 done', async () => {
    const input = new AsyncIterableInput<number>();
    input.push(1);
    input.push(2);
    input.close();
    const it = input.iterable()[Symbol.asyncIterator]();
    const r = await it.next();
    expect(r.done).toBe(true);
  });
});
