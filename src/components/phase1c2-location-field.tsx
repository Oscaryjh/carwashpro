export function Phase1c2LocationField({ mode, branches, selectedBranchId }: {
  mode: "single_outlet" | "legacy_multi_branch" | "no_location";
  branches: readonly { id: string; name: string }[];
  selectedBranchId?: string;
}) {
  if (mode === "single_outlet") return null;
  if (mode === "no_location") return <p role="alert">An active authorised outlet is required. Ask the business owner to complete setup.</p>;
  return <label>Branch<select name="branchId" required defaultValue={selectedBranchId ?? branches[0]?.id ?? ""}>
    <option value="" disabled>Select branch</option>
    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
  </select></label>;
}
