"use client";

import { Building2, Handshake, ListChecks, Package, Plus, SquareKanban, Target, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useShell } from "./shell-context";

const ICONS = { company: Building2, contact: Users, lead: Target, deal: Handshake, order: Package, task: ListChecks, stage: SquareKanban };

/** Lists only create actions that exist and that the current role may perform. Hidden when empty. */
export function QuickCreate() {
  const { quickCreate } = useShell();
  if (quickCreate.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" aria-label="Create new">
          <Plus aria-hidden />
          <span className="hidden sm:inline">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {quickCreate.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href}>
                <Icon aria-hidden />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
