// SDK の query({ prompt: AsyncIterable<SDKUserMessage> }) に流す、
// 後から push できる AsyncIterable 実装。
// 1 chat thread = 1 long-lived sdk.query() を実現するため、user message を
// 任意のタイミングで投入し、close で iter を終わらせる。
//
// 実装方針: バッファ + waiter の二段構え。consumer (SDK) が next を呼んだ瞬間に
// バッファがあれば即返す。空なら 1 回限りの resolver を保留 (背圧に近い形)。
// 再 push でその resolver を解決する。
export class AsyncIterableInput<T> {
  private buf: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private finished = false;

  push(value: T): void {
    if (this.finished) return;
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value, done: false });
      return;
    }
    this.buf.push(value);
  }

  close(): void {
    if (this.finished) return;
    this.finished = true;
    const w = this.waiter;
    if (w) {
      this.waiter = null;
      w({ value: undefined as never, done: true });
    }
  }

  // SDK 等に渡す iter。同一インスタンスから複数回 [Symbol.asyncIterator] を取られる
  // ことは想定しない (本パッケージでは 1 query に 1 input)。
  iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<T>> => {
          if (this.buf.length > 0) {
            const v = this.buf.shift() as T;
            return Promise.resolve({ value: v, done: false });
          }
          if (this.finished) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            this.waiter = resolve;
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
