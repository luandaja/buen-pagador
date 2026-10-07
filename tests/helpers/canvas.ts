export type Call = [method: string, ...args: unknown[]];

export function fakeContext() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, key: string) {
      if (key === 'calls') return calls;
      if (key === 'measureText')
        return (text: string) => {
          const size = Number(/(\d+)px/.exec(String(target.font ?? ''))?.[1] ?? 10);
          return { width: text.length * size * 0.5 };
        };
      if (key === 'createRadialGradient') return () => ({ addColorStop: () => {} });
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push([key, ...args]);
    },
    set(target, key: string, value) {
      target[key] = value;
      calls.push([`set:${key}`, value]);
      return true;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] };
}

export function installFakeCanvas(opts: { failBlob?: boolean } = {}) {
  const contexts: ReturnType<typeof fakeContext>[] = [];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = () => {
    const ctx = fakeContext();
    contexts.push(ctx);
    return ctx;
  };
  proto.toDataURL = function (this: HTMLCanvasElement, type = 'image/png') {
    return `data:${type};base64,ZmFrZQ`;
  };
  proto.toBlob = function (this: HTMLCanvasElement, cb: (b: Blob | null) => void, type = 'image/png') {
    cb(opts.failBlob ? null : new Blob(['fake-image'], { type }));
  };
  return contexts;
}

export class FakeImage {
  naturalWidth = 800;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    setTimeout(() => (value.includes('broken') ? this.onerror?.() : this.onload?.()), 0);
  }
  decode() {
    return Promise.resolve();
  }
}
