/**
 * Small in-process event bus. Handlers run sequentially, in subscription order,
 * inside the same unit of work as the change that produced the event, so a failing
 * handler rolls the change back in demo mode.
 */
import type { DomainEvent, EventType } from "./types";

export type EventHandler<C> = (event: DomainEvent, context: C) => Promise<void> | void;

export class EventBus<C> {
  private handlers: Array<{ name: string; handler: EventHandler<C>; types: EventType[] | "*" }> = [];

  subscribe(name: string, handler: EventHandler<C>, types: EventType[] | "*" = "*"): () => void {
    if (this.handlers.some((h) => h.name === name)) throw new Error(`Handler "${name}" already subscribed`);
    const entry = { name, handler, types };
    this.handlers.push(entry);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== entry);
    };
  }

  has(name: string): boolean {
    return this.handlers.some((h) => h.name === name);
  }

  async publish(events: DomainEvent[], context: C): Promise<void> {
    for (const event of events) {
      for (const h of this.handlers) {
        if (h.types === "*" || h.types.includes(event.type)) await h.handler(event, context);
      }
    }
  }
}
