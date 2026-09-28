import type { BranchOption } from "@/lib/branches";

type BranchSelectProps = {
  branches: BranchOption[];
  selectedBranchId?: string | null;
  name?: string;
};

export function BranchSelect({ branches, selectedBranchId, name = "branchId" }: BranchSelectProps) {
  if (!branches.length) {
    return <p className="form-error" role="alert">No active store location is available. Contact your administrator.</p>;
  }

  if (branches.length === 1) {
    return <input type="hidden" name={name} value={branches[0].id} />;
  }

  return (
    <label>
      <span>Branch</span>
      <select name={name} defaultValue={selectedBranchId ?? ""} required>
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
