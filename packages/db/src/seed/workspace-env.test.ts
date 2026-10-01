import { describe, expect, it } from "vitest";
import { readWorkspaceEnv } from "./workspace-env";

const VALID = {
  DEFAULT_TENANT_SLUG: "northwind",
  WORKSPACE_NAME: "Northwind Support",
  OWNER_NAME: "Priya Raman",
  OWNER_EMAIL: "priya@northwind.example",
  OWNER_PASSWORD: "correct horse battery",
};

function errorsOf(env: Record<string, string | undefined>): string[] {
  const result = readWorkspaceEnv(env);
  return result.ok ? [] : result.errors;
}

describe("readWorkspaceEnv", () => {
  it("reads a complete .env", () => {
    const result = readWorkspaceEnv({
      ...VALID,
      WORKSPACE_LOCALE: "de",
      WORKSPACE_TIMEZONE: "Asia/Kolkata",
      WORKSPACE_STARTER_SETTINGS: "false",
    });
    expect(result).toEqual({
      ok: true,
      setup: {
        slug: "northwind",
        name: "Northwind Support",
        locale: "de",
        timezone: "Asia/Kolkata",
        starterSettings: false,
        owner: { name: "Priya Raman", email: "priya@northwind.example", password: "correct horse battery" },
      },
    });
  });

  it("defaults to English, the column's time zone and the starter settings", () => {
    const result = readWorkspaceEnv(VALID);
    expect(result.ok && result.setup).toMatchObject({ locale: "en", timezone: null, starterSettings: true });
  });

  it("treats blank optional values as unset", () => {
    const result = readWorkspaceEnv({ ...VALID, WORKSPACE_LOCALE: " ", WORKSPACE_TIMEZONE: "" });
    expect(result.ok && result.setup).toMatchObject({ locale: "en", timezone: null });
  });

  it("lower-cases the owner's address, as Better Auth stores it", () => {
    const result = readWorkspaceEnv({ ...VALID, OWNER_EMAIL: "  Priya@NorthWind.example " });
    expect(result.ok && result.setup.owner.email).toBe("priya@northwind.example");
  });

  it("keeps a password exactly as written, spaces included", () => {
    const result = readWorkspaceEnv({ ...VALID, OWNER_PASSWORD: " leading and trailing " });
    expect(result.ok && result.setup.owner.password).toBe(" leading and trailing ");
  });

  it("reports every missing variable in one pass", () => {
    const errors = errorsOf({});
    expect(errors).toHaveLength(5);
    for (const key of ["DEFAULT_TENANT_SLUG", "WORKSPACE_NAME", "OWNER_NAME", "OWNER_EMAIL", "OWNER_PASSWORD"]) {
      expect(errors.some((e) => e.startsWith(key))).toBe(true);
    }
  });

  it.each(["North", "north wind", "-north", "north-", "a".repeat(64), "north.wind"])(
    "refuses the slug %j",
    (slug) => {
      expect(errorsOf({ ...VALID, DEFAULT_TENANT_SLUG: slug })).toEqual([
        expect.stringContaining("lowercase letters, digits and hyphens"),
      ]);
    },
  );

  it("refuses a reserved slug", () => {
    expect(errorsOf({ ...VALID, DEFAULT_TENANT_SLUG: "www" })).toEqual([expect.stringContaining("reserved")]);
  });

  it("refuses a language the interface does not have", () => {
    expect(errorsOf({ ...VALID, WORKSPACE_LOCALE: "english" })).toEqual([
      expect.stringContaining('WORKSPACE_LOCALE "english"'),
    ]);
  });

  it("refuses a time zone that does not exist", () => {
    expect(errorsOf({ ...VALID, WORKSPACE_TIMEZONE: "Mars/Olympus_Mons" })).toEqual([
      expect.stringContaining("IANA time zone"),
    ]);
  });

  it("accepts true/false in any case and nothing else for the starter settings", () => {
    const off = readWorkspaceEnv({ ...VALID, WORKSPACE_STARTER_SETTINGS: "FALSE" });
    expect(off.ok && off.setup.starterSettings).toBe(false);
    expect(errorsOf({ ...VALID, WORKSPACE_STARTER_SETTINGS: "yes" })).toEqual([
      expect.stringContaining("WORKSPACE_STARTER_SETTINGS"),
    ]);
  });

  it("refuses an address that is not one", () => {
    expect(errorsOf({ ...VALID, OWNER_EMAIL: "priya" })).toEqual([expect.stringContaining("not an email address")]);
  });

  it.each(["short", "x".repeat(129)])("refuses a password Better Auth would refuse (%#)", (password) => {
    expect(errorsOf({ ...VALID, OWNER_PASSWORD: password })).toEqual([expect.stringContaining("8 to 128")]);
  });
});
