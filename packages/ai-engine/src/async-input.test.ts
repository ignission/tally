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
});
