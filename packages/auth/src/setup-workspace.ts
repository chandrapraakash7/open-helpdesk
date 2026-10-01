/**
 * Creates the first workspace of a self-hosted instance from .env — the way in
 * when the Acme demo is switched off (SEED_DEMO=false). The migrate container
 * runs it on every start when OWNER_EMAIL is set (docker/Dockerfile); by hand:
 * pnpm workspace:setup.
 *
 * Only ever creates. Once the workspace exists, every later run says so and
 * changes nothing: values edited in .env afterwards are not applied, the
 * administration owns them from the first sign-in on.
 *
 * A bad .env exits non-zero, which keeps the web container from starting
 * (compose waits for migrate to succeed). Learning about a typo from a failed
 * start beats learning it from a "workspace not found" page.
 */
import { APIError } from "better-auth/api";
import {
  closeDb,
  createWorkspace,
  findWorkspace,
  markEmailVerified,
  readWorkspaceEnv,
} from "@openhelpdesk/db";
import { auth } from "./index";

async function main(): Promise<number> {
  const read = readWorkspaceEnv(process.env);
  if (!read.ok) {
    console.error("Workspace setup: fix these in .env, then start again:");
    for (const error of read.errors) console.error(`  - ${error}`);
    return 1;
  }
  const { setup } = read;
  const { owner } = setup;

  const existing = await findWorkspace(setup.slug, owner.email);
  if (existing) {
    console.log(`Workspace "${existing.name}" (${setup.slug}) already exists — nothing to do.`);
    if (!existing.ownerIsMember) {
      console.log(
        `  ${owner.email} is not a member of it. This step only creates a workspace; ` +
          "invite people from Settings → Team.",
      );
    }
    return 0;
  }

  // The identity first: if Better Auth refuses it, nothing exists yet and the
  // next start simply tries again.
  let passwordApplied = true;
  try {
    await auth.api.signUpEmail({
      body: { name: owner.name, email: owner.email, password: owner.password },
    });
  } catch (err) {
    // Already there (a previous attempt, or another workspace on this
    // instance): the existing password stays, as when an invitation is accepted.
    if (!(err instanceof APIError && err.status === "UNPROCESSABLE_ENTITY")) throw err;
    passwordApplied = false;
  }
  await markEmailVerified(owner.email);

  const created = await createWorkspace(setup);
  if (!created) {
    console.log(`Workspace "${setup.slug}" was created by another process — nothing to do.`);
    return 0;
  }

  const base = process.env.BETTER_AUTH_URL ?? `http://${process.env.BASE_DOMAIN ?? "localhost:3000"}`;
  console.log(`Workspace "${setup.name}" (${setup.slug}) created, owned by ${owner.email}.`);
  if (setup.starterSettings) {
    console.log("  Starter settings installed: business hours, teams, SLA, macros, rules, fields.");
  }
  if (!passwordApplied) {
    console.log(`  ${owner.email} already had a sign-in: its password was kept, OWNER_PASSWORD was not used.`);
  }
  console.log(`  Sign in at ${base}/login — then remove OWNER_PASSWORD from .env.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("Workspace setup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    // Normally the process ends on its own here. A verification email (when
    // SEND_EMAIL_VERIFICATION is on) can leave a queue connection open, and a
    // migrate container that never exits keeps the web container from starting.
    setTimeout(() => process.exit(), 5000).unref();
  });
