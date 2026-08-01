import { BackButton } from "@/components/back-button";
import { StaffForm } from "@/components/staff-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { createStaffAction } from "../actions";

export default async function NewStaffPage() {
  const { access, user, businessId, industryType } =
    await requireBusinessUser("EDIT_COMPENSATION");
  if (access.source === "DIRECT_BUSINESS") {
    assertStaffPermission(user, "TEAM");
  }

  const branches = await getActiveBranches(businessId);

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Create staff</h1>
            <p>Create a staff record, assign branches, and optionally enable login.</p>
          </div>
          <BackButton fallbackHref="/team" />
        </div>

        {!branches.length ? (
          <div className="warning">
            Create an active branch before adding staff. Staff records must belong to at least
            one branch.
          </div>
        ) : null}

        <div className="panel team-create-card">
          <div className="section-header">
            <h2>Staff details</h2>
          </div>
          <StaffForm
            action={createStaffAction}
            branches={branches}
            canManagePermissions={hasBusinessCapability(
              access,
              "MANAGE_TEAM_PERMISSIONS",
            )}
            industryType={industryType}
            submitLabel="Create staff"
          />
        </div>
      </section>
    </>
  );
}
