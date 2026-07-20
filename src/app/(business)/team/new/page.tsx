import { BackButton } from "@/components/back-button";
import { StaffForm } from "@/components/staff-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import { createStaffAction } from "../actions";

export default async function NewStaffPage() {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "TEAM");

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
            submitLabel="Create staff"
          />
        </div>
      </section>
    </>
  );
}
