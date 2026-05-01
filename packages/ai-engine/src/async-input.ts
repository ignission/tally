// SDK の query({ prompt: AsyncIterable<SDKUserMessage> }) に流す、
// 後から push できる AsyncIterable 実装。
// 1 chat thread = 1 long-lived sdk.query() を実現するため、user message を
// 任意のタイミングで投入し、close で iter を終わらせる。
//
// 実装方針: バッファ + waiter キュー。consumer が next を複数回連続で呼んでも
// 各 promise が独立に保持される。AsyncIterator 仕様に沿うため waiter は
// 単一スロットではなく FIFO キューで持つ (consumer が並行で next() を呼ぶ
// ケースに耐える)。
// close() は finished フラグを立てた上で残バッファをクリアし、待機中の
// waiter を done で全て倒す。next() は finished を最優先で確認するため、
// close 後の再 next() はバッファに値が残っていても即 done を返す。
export class AsyncIterableInput<T> {
  private buf: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private finished = false;

  push(value: T): void {
    if (this.finished) return;
    const w = this.waiters.shift();
    if (w) {
      w({ value, done: false });
      return;
    }
    this.buf.push(value);
  }

  // close 後は残バッファを捨てて即時に終了させる (teardown 用)。
  close(): void {
    if (this.finished) return;
    this.finished = true;
    this.buf.length = 0;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as never, done: true });
    }
  }

  // SDK 等に渡す iter。同一インスタンスから複数回 [Symbol.asyncIterator] を取られる
  // ことは想定しない (本パッケージでは 1 query に 1 input)。
  iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<T>> => {
          // close 後は即座に done。残バッファに値が乗っていても無視する。
          if (this.finished) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          if (this.buf.length > 0) {
            const v = this.buf.shift() as T;
            return Promise.resolve({ value: v, done: false });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            this.waiters.push(resolve);
          });
        },
        return: (): Promise<IteratorResult<T>> => {
          this.close();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      }),
    };
  }
}
