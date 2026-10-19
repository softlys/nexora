import { Palette } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "Figma & UI Kit" };

export default async function UiKitPage() {
  await requirePermission("view", "ui_kit");
  return (
    <SectionPlaceholder
      title="Figma & UI Kit"
      description="The NEXORA design system: tokens, components and usage guidelines."
      icon={Palette}
      emptyTitle="The living style guide will appear here"
      emptyDescription="Rendered from the same components and tokens the app uses. No live Figma connection is claimed."
      planned={[
        "Color, typography, spacing, radius and shadow tokens from tokens/tokens.json",
        "Buttons, inputs, tables, badges, dialogs, navigation and charts with their states",
        "Token export for Figma variable import, with step-by-step instructions",
      ]}
      dataNote="Design tokens already live in tokens/tokens.json and drive every color and size in the app."
    />
  );
}
