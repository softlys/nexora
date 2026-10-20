# Metrics

Every number on the Overview dashboard and the Analytics page is computed from data by a pure function in [`src/domain/metrics/index.ts`](../src/domain/metrics/index.ts) and is covered by a unit test against a fixed fixture ([`tests/unit/metrics.test.ts`](../tests/unit/metrics.test.ts)).

## Rules that apply to every metric

- **Visibility.** Metrics run only over records the current role may see (admin: everything; manager: own + direct reports; sales rep: own). A sales rep's dashboard never includes other reps' records.
- **Period.** A period is an inclusive date range in UTC (`from`, `to`). The dashboard offers this month, last 30 days, last 90 days, this quarter, this year and a custom range, kept in the URL (`?range=` or `?from=&to=`).
- **Comparison.** "vs previous period" compares with the period of the same length that ends the day before the current one starts. The change is `(current − previous) / |previous|`; it is not shown when the previous value is zero.
- **Archived records** are excluded.
- **Point-in-time metrics** (open pipeline, weighted pipeline, active deals, outstanding receivables, overdue tasks) are measured at the end of the period. For past periods they use each record's current amount and probability; NEXORA does not keep historical amounts, so these are reconstructions, not snapshots.

## Money: six numbers that are never interchangeable

| Metric | Definition | Function |
| --- | --- | --- |
| **Won deal value** | Sum of `amount` of deals in a won stage whose `closed_at` falls in the period. | `wonDealValue` |
| **Order value** | Sum of `total` of non-cancelled orders whose `order_date` falls in the period. | `orderValue` |
| **Collected** | Sum of simulated payments whose `paid_at` falls in the period. | `collected` |
| **Outstanding receivables** | At the end of the period: for orders in confirmed, processing, shipped or delivered status dated on or before that moment, `total` minus payments received by then (never below zero). | `outstandingReceivables` |
| **Open pipeline** | At the end of the period: sum of `amount` of deals created by then and not closed by then. | `openPipeline` |
| **Weighted pipeline** | Same deals as open pipeline, summing `amount × probability / 100`. | `weightedPipeline` |

Won deal value is what sales closed; order value is what customers ordered (a won deal becomes an order only when converted, and orders can exist without deals); collected is cash in (simulated); outstanding is what is still owed.

## Deals

| Metric | Definition | Function |
| --- | --- | --- |
| **Active deals** | Number of deals open at the end of the period (as for open pipeline). | `activeDeals` |
| **Conversion rate** | Deals won in the period ÷ (deals won + deals lost in the period). Not shown when no deal closed. | `conversionRate` |
| **Average deal size** | Won deal value ÷ number of deals won in the period. | `averageDealSize` |
| **Sales cycle length** | Average days from `created_at` to `closed_at` for deals won in the period. | `salesCycleDays` |
| **Deals by stage** | Deals created in the period, grouped by their current stage (count and amount). | `dealsByStage` |
| **Conversion funnel** | Of deals created in the period, how many reached each open stage or a later one (from stage history), and how many were won. | `conversionFunnel` |
| **Sales by owner / by source** | Won deal value and count for deals won in the period, grouped by owner or by source. | `salesByOwner`, `salesBySource` |
| **Pipeline distribution** | Open deals at the end of the period by current stage: count, amount, weighted amount. | `pipelineDistribution` |

## Orders

| Metric | Definition | Function |
| --- | --- | --- |
| **Orders by status** | Number of orders dated in the period, per status. | `ordersByStatus` |
| **Receivables ageing** | Outstanding receivables at the end of the period, bucketed by days past the payment due date: 0–30 (including not yet due), 31–60, 61–90, 90+. | `receivablesAgeing` |

## Tasks

| Metric | Definition | Function |
| --- | --- | --- |
| **Overdue tasks** | Tasks not cancelled, due before the end of the period (or now, if earlier), created by then and not completed by then. | `overdueTasks` |
| **Task completion** | Of tasks due in the period (excluding cancelled), the share whose status is done. | `taskCompletionRate` |

## Series

| Series | Definition | Function |
| --- | --- | --- |
| **Sales over time / Revenue over time** | Won deal value (by `closed_at`) and collected payments (by `paid_at`) per day, week (starting Monday) or month, depending on the period length. Shown as two separate, labelled series. | `revenueSeries` |

## Illustrative numbers

None. If a number cannot be computed from data it is not shown; an empty state explains why instead.
