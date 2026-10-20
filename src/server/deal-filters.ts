import { first, stringFilter } from "@/domain/list";
import type { DealFilters } from "@/server/services/deals";
import type { Params } from "@/lib/url";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function amount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Parses deal filters from URL params; invalid values are ignored. */
export function parseDealFilters(params: Params): DealFilters {
  const from = first(params.from);
  const to = first(params.to);
  const status = first(params.status);
  const date = (key: string) => {
    const v = first(params[key]);
    return v && DATE.test(v) ? v : undefined;
  };
  return {
    stage: stringFilter(params, "stage", 36),
    owner: stringFilter(params, "owner", 36),
    company: stringFilter(params, "company", 36),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
    min: amount(first(params.min)),
    max: amount(first(params.max)),
    status: status === "open" || status === "won" || status === "lost" || status === "closed" ? status : undefined,
    created_from: date("created_from"),
    created_to: date("created_to"),
    closed_from: date("closed_from"),
    closed_to: date("closed_to"),
  };
}
