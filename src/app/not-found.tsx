import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Not found") };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl items-center px-4 py-10">
      <EmptyState
        icon={SearchX}
        title={tr("Page not found")}
        description={tr("The page or record does not exist, or you don't have access to it.")}
        action={
          <Button asChild variant="outline">
            <Link href="/">{tr("Back to overview")}</Link>
          </Button>
        }
        className="w-full"
      />
    </div>
  );
}
