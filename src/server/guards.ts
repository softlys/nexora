import "server-only";
import { forbidden } from "next/navigation";
import { can, type Action, type Resource } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";

/**
 * Page guard. Renders the 403 page when the current role lacks the permission,
 * so a direct URL is refused exactly like a hidden navigation item.
 */
export async function requirePermission(action: Action, resource: Resource) {
  const result = await getRepoContext();
  if (!can(result.user.actor, action, resource)) forbidden();
  return result;
}
