"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_STAFF_APP_ICONS,
  resolveStaffAppAppearance,
  STAFF_APP_DOMAINS,
  STAFF_APP_ICON_OPTIONS,
  type StaffAppAppearance,
  type StaffAppDomain,
  type StaffAppIconName,
  toStoredStaffAppAppearance,
} from "@/lib/staff-pwa/appearance-config";
import {
  type StaffAppLogoExtension,
  writeRuntimeStaffAppLogo,
} from "@/lib/runtime-staff-app-logo";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_EXTENSIONS = new Map<string, StaffAppLogoExtension>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);
const iconNames = new Set<string>(STAFF_APP_ICON_OPTIONS.map((option) => option.value));

export type StaffAppAppearanceActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  appearance?: StaffAppAppearance;
}>;

export const initialStaffAppAppearanceActionState: StaffAppAppearanceActionState = {
  status: "idle",
  message: "",
};

export async function updateStaffAppAppearanceAction(
  _previousState: StaffAppAppearanceActionState,
  formData: FormData,
): Promise<StaffAppAppearanceActionState> {
  const { user, businessId } = await requireBusinessUser("MODIFY_BUSINESS_SETTINGS");
  assertRole(user, ["BUSINESS_OWNER"]);
  const auditRequest = await getAuditRequestContext();

  try {
    const current = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        id: true,
        staffAppLogoUrl: true,
        staffAppAppearance: true,
      },
    });
    const reset = formData.get("intent") === "reset";
    const quickAccessIcons = reset
      ? { ...DEFAULT_STAFF_APP_ICONS }
      : readIconSelection(formData);
    const uploadedLogoUrl = reset
      ? null
      : await saveStaffAppLogo(formData.get("logo"), businessId);
    const logoUrl = reset
      ? null
      : uploadedLogoUrl ?? current.staffAppLogoUrl;
    const storedAppearance = reset
      ? Prisma.DbNull
      : (toStoredStaffAppAppearance(quickAccessIcons) as Prisma.InputJsonValue);

    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: {
          staffAppLogoUrl: logoUrl,
          staffAppAppearance: storedAppearance,
        },
      });
      await writeAuditLog(
        {
          businessId,
          actor: user,
          action: "STAFF_APP_APPEARANCE_UPDATED",
          entityType: "Business",
          entityId: businessId,
          summary: reset
            ? "Restored default Staff App appearance"
            : "Updated Staff App appearance",
          before: {
            logoUrl: current.staffAppLogoUrl,
            appearance: current.staffAppAppearance,
          },
          after: {
            logoUrl,
            appearance: reset ? null : storedAppearance,
          },
          metadata: {
            logoChanged: reset || Boolean(uploadedLogoUrl),
            reset,
          },
          request: auditRequest,
        },
        tx,
      );
    });

    revalidatePath("/business/settings");
    revalidatePath("/business/settings/staff-app");
    revalidatePath("/staff", "layout");

    return {
      status: "success",
      message: reset
        ? "Default Staff App appearance restored."
        : "Staff App appearance saved.",
      appearance: resolveStaffAppAppearance(
        reset ? null : storedAppearance,
        logoUrl,
      ),
    };
  } catch (error) {
    console.error("[staff-app-appearance] Unable to save appearance.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: "error",
      message:
        error instanceof Error && error.message.startsWith("Staff App ")
          ? error.message
          : "Unable to save Staff App appearance. Please try again.",
    };
  }
}

function readIconSelection(formData: FormData) {
  return Object.fromEntries(
    STAFF_APP_DOMAINS.map((domain) => {
      const value = formData.get(`icon_${domain}`);
      if (typeof value !== "string" || !iconNames.has(value)) {
        throw new Error(`Staff App icon for ${domain} is invalid.`);
      }
      return [domain, value as StaffAppIconName];
    }),
  ) as Record<StaffAppDomain, StaffAppIconName>;
}

async function saveStaffAppLogo(
  fileEntry: FormDataEntryValue | null,
  businessId: string,
) {
  if (!fileEntry || typeof fileEntry === "string" || fileEntry.size === 0) {
    return null;
  }
  if (fileEntry.size > LOGO_MAX_BYTES) {
    throw new Error("Staff App logo must be smaller than 2MB.");
  }
  const extension = LOGO_EXTENSIONS.get(fileEntry.type);
  if (!extension) {
    throw new Error("Staff App logo must be a PNG, JPG, or WebP image.");
  }
  const saved = await writeRuntimeStaffAppLogo({
    businessId,
    bytes: Buffer.from(await fileEntry.arrayBuffer()),
    extension,
  });
  return saved.logoUrl;
}

