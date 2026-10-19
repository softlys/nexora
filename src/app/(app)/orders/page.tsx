import { Package } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const { ctx } = await requirePermission("view", "order");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Orders"
      description="Orders, line items, simulated payments and fulfillment."
      icon={Package}
      emptyTitle="Orders will be listed here"
      emptyDescription="Every order with its items, totals, payment and fulfillment status."
      planned={["Line-item editor with discounts and tax", "Payment status derived from simulated payments and due date", "Enforced status transitions (a delivered order cannot return to draft)"]}
      dataNote={`${counts.orders} orders visible to your role are already in the dataset.`}
    />
  );
}
