export function ExpenseEditScopeField({ mode, branches, branchId, branchName, includeBusinessWide }: {
  mode: "single_outlet" | "legacy_multi_branch" | "no_location";
  branches: readonly { id: string; name: string }[];
  branchId: string | null;
  branchName?: string;
  includeBusinessWide: boolean;
}) {
  if (mode === "no_location" || (branchId && !branches.some(branch => branch.id === branchId))) {
    return <p>Expense scope: {branchId ? branchName ?? "Original outlet" : "Business-wide"}</p>;
  }
  return <label>{mode === "single_outlet" ? "Expense scope" : "Branch"}<select name="branchId" required={!includeBusinessWide} defaultValue={branchId ?? ""}>
    {includeBusinessWide ? <option value="">Business-wide</option> : mode === "legacy_multi_branch" ? <option value="" disabled>Select branch</option> : null}
    {branches.map(branch => <option value={branch.id} key={branch.id}>{mode === "single_outlet" ? "This outlet" : branch.name}</option>)}
  </select></label>;
}
