/**
 * The workspace a self-hosted instance creates for itself, read from .env.
 *
 * Without the demo there was no way to get a first workspace: the only code
 * that created one was the Acme seed, and a hosted install gets its own from a
 * control plane that is not part of this repository. These variables describe
 * that first workspace and its owner; `pnpm workspace:setup` creates them once.
 *
 * Pure on purpose — no database, no network — so every refusal below is tested
 * without infrastructure (workspace-env.test.ts).
 */
import { RESERVED_SUBDOMAINS } from "@openhelpdesk/config";

/** The 25 interface languages — the same list as apps/web/src/i18n/locales.ts. */
const LOCALES = [
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu",
  "it", "lt", "lv", "mt", "nb", "nl", "pl", "pt", "ro", "sk", "sl", "sv",
] as const;

/** Better Auth refuses anything outside these bounds at sign-up. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/** A DNS label: the slug is also the workspace's subdomain and mail domain. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WorkspaceSetup = {
  slug: string;
  name: string;
  locale: string;
  /** Null: the column default applies. */
  timezone: string | null;
  starterSettings: boolean;
  owner: { name: string; email: string; password: string };
};

export type WorkspaceEnvResult =
  | { ok: true; setup: WorkspaceSetup }
  | { ok: false; errors: string[] };

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every problem at once, not the first one: this runs inside a container that
 * takes a rebuild-and-restart to try again, and fixing one variable per round
 * trip is how an install takes an afternoon.
 */
export function readWorkspaceEnv(env: Record<string, string | undefined>): WorkspaceEnvResult {
  const value = (key: string) => env[key]?.trim() ?? "";
  const errors: string[] = [];

  const slug = value("DEFAULT_TENANT_SLUG");
  if (!slug) {
    errors.push("DEFAULT_TENANT_SLUG is missing — it names the workspace served on the plain address.");
  } else if (!SLUG.test(slug)) {
    errors.push(
      `DEFAULT_TENANT_SLUG "${slug}" must be lowercase letters, digits and hyphens (1–63, no hyphen at either end).`,
    );
  } else if ((RESERVED_SUBDOMAINS as readonly string[]).includes(slug)) {
    errors.push(`DEFAULT_TENANT_SLUG "${slug}" is reserved by the product — pick another one.`);
  }

  const name = value("WORKSPACE_NAME");
  if (!name) errors.push("WORKSPACE_NAME is missing.");

  const locale = value("WORKSPACE_LOCALE") || "en";
  if (!(LOCALES as readonly string[]).includes(locale)) {
    errors.push(`WORKSPACE_LOCALE "${locale}" is not one of: ${LOCALES.join(", ")}.`);
  }

  const timezone = value("WORKSPACE_TIMEZONE") || null;
  if (timezone && !isTimeZone(timezone)) {
    errors.push(`WORKSPACE_TIMEZONE "${timezone}" is not an IANA time zone (e.g. Europe/Paris, Asia/Kolkata).`);
  }

  const starter = (value("WORKSPACE_STARTER_SETTINGS") || "true").toLowerCase();
  if (starter !== "true" && starter !== "false") {
    errors.push(`WORKSPACE_STARTER_SETTINGS must be true or false, not "${starter}".`);
  }

  const ownerName = value("OWNER_NAME");
  if (!ownerName) errors.push("OWNER_NAME is missing.");

  // Lower-cased because Better Auth stores it that way, and app.users is matched
  // against the session's address character for character.
  const ownerEmail = value("OWNER_EMAIL").toLowerCase();
  if (!ownerEmail) {
    errors.push("OWNER_EMAIL is missing.");
  } else if (!EMAIL.test(ownerEmail)) {
    errors.push(`OWNER_EMAIL "${ownerEmail}" is not an email address.`);
  }

  // Not trimmed: spaces are legitimate characters of a password.
  const password = env.OWNER_PASSWORD ?? "";
  if (!password) {
    errors.push("OWNER_PASSWORD is missing.");
  } else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    errors.push(`OWNER_PASSWORD must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters long.`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    setup: {
      slug,
      name,
      locale,
      timezone,
      starterSettings: starter === "true",
      owner: { name: ownerName, email: ownerEmail, password },
    },
  };
}
