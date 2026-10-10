import { BranchSelect } from "@/components/branch-select";
import type { BranchOption } from "@/lib/branches";

/** Presentation only. The page and fresh server guard own topology and access. */
export function PosOutletBranchField({ singleOutlet, branchId, branches }: {
  singleOutlet: boolean; branchId?: string | null; branches: BranchOption[];
}) {
  return singleOutlet ? <input type="hidden" name="branchId" value={branchId ?? ""} />
    : <BranchSelect branches={branches} selectedBranchId={branchId} />;
}

export function PosLocationGuidance({ owner }: { owner: boolean }) {
  return <p role="status" className="empty-state">This business does not have an operating location set up yet. {owner
    ? "Contact the Platform Admin or complete the existing business setup."
    : "Ask the business owner to complete the setup."}</p>;
}
