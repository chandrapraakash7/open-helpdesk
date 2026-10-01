/**
 * Creates the first workspace of a self-hosted instance and its owner — the
 * database half of `pnpm workspace:setup` (packages/auth/src/setup-workspace.ts
 * adds the sign-in identity, which only Better Auth can hash).
 *
 * Creation only. A workspace that already exists is left exactly as it is:
 * after the first start, the administration owns the name, the language and
 * the team, and a restart must not quietly put back an owner someone removed.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { authUsers, businessHours, tenants, users } from "../schema";
import { installDefaults } from "./defaults";
import type { WorkspaceSetup } from "./workspace-env";

export type ExistingWorkspace = {
  id: string;
  name: string;
  /** Whether OWNER_EMAIL already belongs to it — false is worth a warning. */
  ownerIsMember: boolean;
};

export async function findWorkspace(slug: string, ownerEmail: string): Promise<ExistingWorkspace | null> {
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, slug));
  if (!tenant) return null;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.email, ownerEmail)));
  return { ...tenant, ownerIsMember: Boolean(owner) };
}

/**
 * Returns null when the slug was taken in the meantime. On any failure the
 * half-made workspace is deleted — every tenant table cascades from it — so the
 * next start begins clean instead of finding a workspace with no owner and
 * concluding there is nothing to do.
 */
export async function createWorkspace(setup: WorkspaceSetup): Promise<{ id: string } | null> {
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: setup.slug,
      name: setup.name,
      locale: setup.locale,
      ...(setup.timezone ? { timezone: setup.timezone } : {}),
    })
    .onConflictDoNothing({ target: tenants.slug })
    .returning();
  if (!tenant) return null;

  try {
    await db.insert(users).values({
      tenantId: tenant.id,
      name: setup.owner.name,
      email: setup.owner.email,
      role: "owner",
      status: "active",
    });

    if (setup.starterSettings) {
      await installDefaults(tenant.id, setup.locale);
      // The main calendar is written in UTC. Left there, every SLA target counts
      // the wrong working day, and onboarding flags it as unfinished. Only that
      // one: the other examples carry a zone of their own on purpose.
      await db
        .update(businessHours)
        .set({ timezone: tenant.timezone })
        .where(and(eq(businessHours.tenantId, tenant.id), eq(businessHours.position, 0)));
    }
  } catch (err) {
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    throw err;
  }

  return { id: tenant.id };
}

/**
 * Whoever runs the instance wrote this address into .env — the same proof of
 * control as clicking an invitation link, which marks it verified too. Without
 * it, REQUIRE_EMAIL_VERIFICATION=true would lock the only owner out.
 */
export async function markEmailVerified(email: string): Promise<void> {
  await db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.email, email));
}
