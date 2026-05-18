import type { CopyTradeEvent } from "../core/types";

export type TradeExecutor = (event: CopyTradeEvent) => Promise<void>;

const queue: CopyTradeEvent[] = [];
let running = false;
let executor: TradeExecutor = async () => {};

export function setExecutor(fn: TradeExecutor): void {
  executor = fn;
}

export function enqueue(event: CopyTradeEvent): void {
  queue.push(event);
  exec();
}

async function exec(): Promise<void> {
  if (running || queue.length === 0) return;
  running = true;
  while (queue.length > 0) {
    const event = queue.shift()!;
    executor(event).catch((err) => {
      console.error("[copy] execute error:", event.signature, err?.message ?? err);
    });
  }
  running = false;
}
