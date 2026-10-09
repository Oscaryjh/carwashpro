"use client";

import { useState } from "react";

/** An empty selection is absence of a filter, never an explicit empty UUID. */
export function WalletHubBranchFilter({ branches, selected }: { branches: Array<{ id: string; name: string }>; selected?: string }) {
  const [value, setValue] = useState(selected ?? "");
  return <><label>Branch<select value={value} onChange={event => setValue(event.target.value)}><option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{value ? <input type="hidden" name="branchId" value={value} /> : null}</>;
}
