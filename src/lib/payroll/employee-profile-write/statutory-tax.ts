import { prisma } from "@/lib/prisma";

import type {
  UpdateEmployeeStatutoryProfileCommand,
  UpdateEmployeeStatutoryProfileResult,
} from "./statutory";
import {
  updateEmployeeStatutoryProfileInTransaction,
} from "./statutory";
import type {
  UpdateEmployeeTaxProfileCommand,
  UpdateEmployeeTaxProfileResult,
} from "./tax";
import { updateEmployeeTaxProfileInTransaction } from "./tax";
import type { PayrollProfileWriteContext } from "./types";

export async function updateEmployeeStatutoryAndTaxProfiles(input: {
  statutory: {
    command: UpdateEmployeeStatutoryProfileCommand;
    context: PayrollProfileWriteContext;
  };
  tax: {
    command: UpdateEmployeeTaxProfileCommand;
    context: PayrollProfileWriteContext;
  };
}): Promise<{
  statutory: UpdateEmployeeStatutoryProfileResult;
  tax: UpdateEmployeeTaxProfileResult;
}> {
  return prisma.$transaction(async (transaction) => {
    const statutory = await updateEmployeeStatutoryProfileInTransaction(
      input.statutory,
      transaction,
    );
    const tax = await updateEmployeeTaxProfileInTransaction(
      input.tax,
      transaction,
    );

    return { statutory, tax };
  });
}
