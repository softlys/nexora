import { PageHeader } from "@/components/patterns/page-header";
import { getRepoContext } from "@/server/auth";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Help") };

const DOCS: Array<[string, string]> = [
  ["README.md", tr("Overview, setup and demo mode")],
  ["docs/data-model.md", tr("Tables, relationships and the ER diagram")],
  ["docs/security.md", tr("Roles, permission matrix and RLS policies")],
  ["PROGRESS.md", tr("What is built, what is next, known issues")],
];

export default async function HelpPage() {
  const { user } = await getRepoContext();
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Help")} description={tr("How NEXORA works and where to find documentation.")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-md font-semibold">{tr("Roles")}</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">{tr("Admin")}</dt>
              <dd className="text-text-muted">{tr("Sees and manages everything, including team roles, pipeline stages and demo data.")}</dd>
            </div>
            <div>
              <dt className="font-medium">{tr("Manager")}</dt>
              <dd className="text-text-muted">{tr("Sees their own records and those of the reps who report to them. Can build automations.")}</dd>
            </div>
            <div>
              <dt className="font-medium">{tr("Sales Rep")}</dt>
              <dd className="text-text-muted">{tr("Sees and edits only the records they own.")}</dd>
            </div>
          </dl>
          <p className="pt-2 text-xs text-text-muted">{tr("The same rules are enforced on the server and, in Supabase mode, by row-level security in the database.")}</p>
        </section>
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-md font-semibold">{user.mode === "demo" ? tr("Demo mode") : tr("Supabase mode")}</h2>
          {user.mode === "demo" ? (
            <p className="text-sm text-text-muted">{tr("No account is needed. The data is fictional and stored on the server in")} <code className="font-mono text-xs">{tr(".data/demo.json")}</code>{tr(". Use the user menu to act as an admin, manager or sales rep. An admin can restore the original dataset from Settings, Demo data.")}</p>
          ) : (
            <p className="text-sm text-text-muted">{tr("You are signed in with Supabase Auth. Your role is stored on your profile and managed by an admin.")}</p>
          )}
        </section>
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="text-md font-semibold">{tr("Documentation in the repository")}</h2>
          <ul className="divide-y divide-border text-sm">
            {DOCS.map(([path, about]) => (
              <li key={path} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                <code className="font-mono text-xs">{path}</code>
                <span className="text-text-muted">{about}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
