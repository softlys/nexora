import { Lock } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function Forbidden() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-xl items-center px-4 py-10">
      <EmptyState
        icon={Lock}
        title="You don't have access to this page"
        description="Your role does not include this area. Ask an admin if you need access."
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to overview</Link>
          </Button>
        }
        className="w-full"
      />
    </div>
  );
}
