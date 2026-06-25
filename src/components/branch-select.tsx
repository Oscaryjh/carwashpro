import type { BranchOption } from "@/lib/branches";

type BranchSelectProps = {
  branches: BranchOption[];
  selectedBranchId?: string | null;
};

export function BranchSelect({ branches, selectedBranchId }: BranchSelectProps) {
  if (!branches.length) {
    return null;
  }

  if (branches.length === 1) {
    return <input type="hidden" name="branchId" value={branches[0].id} />;
  }

  return (
    <label>
      <span>Branch</span>
      <select name="branchId" defaultValue={selectedBranchId ?? ""} required>
        <option value="" disabled>
          Select branch
        </option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
