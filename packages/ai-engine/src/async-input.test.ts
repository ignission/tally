import { describe, expect, it } from 'vitest';

import { AsyncIterableInput } from './async-input';

describe('AsyncIterableInput', () => {
  it('push 後に for-await で順番に取り出せる', async () => {
    const input = new AsyncIterableInput<number>();
    input.push(1);
    input.push(2);
    input.push(3);
    input.close();
    const got: number[] = [];
    for await (const v of input.iterable()) got.push(v);
    expect(got).toEqual([1, 2, 3]);
  });

  it('iter が空の状態で next() を待ち、後の push で解決される', async () => {
    const input = new AsyncIterableInput<string>();
    const it = input.iterable()[Symbol.asyncIterator]();
    const p = it.next();
    // 待機状態を確認: 即時 resolve しない
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
    input.push(99); // 無視
    const got: number[] = [];
    for await (const v of input.iterable()) got.push(v);
    expect(got).toEqual([1]);
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

  // CodeRabbit 指摘 (PR #18): 単一 waiter スロットだと 2 回連続で next() を呼んだとき
  // 1 つ目の resolver が捨てられて Promise が永遠に未解決になる。FIFO キューで保持する
  // ことで、push 順に正しく解決されることを確認する。
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
    // p2 は未解決
    let p2Resolved = false;
    p2.then(() => {
      p2Resolved = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(p2Resolved).toBe(false);
    // close で残りの waiter が done に倒れる
    input.close();
    const r2 = await p2;
    expect(r2.done).toBe(true);
  });
});
