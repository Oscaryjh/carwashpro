import { prisma } from "@/lib/prisma";

export async function loadEmployeeClaimsSection(input: {
  businessId: string;
  membershipId: string;
  allowedBranchIds: readonly string[];
}) {
  const claims = await prisma.employeeClaim.findMany({
    where: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      branchId: { in: [...input.allowedBranchIds] },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { reimbursement: true },
  });
  return {
    total: claims.length,
    submitted: claims.filter((claim) => claim.status === "SUBMITTED").length,
    approved: claims.filter((claim) => claim.status === "APPROVED" || claim.status === "PARTIALLY_APPROVED").length,
    reimbursementPending: claims.filter((claim) => claim.reimbursement && !["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED", "CANCELLED"].includes(claim.reimbursement.status)).length,
    recent: claims.map((claim) => ({
      id: claim.id,
      claimNumber: claim.claimNumber,
      purpose: claim.purpose,
      status: claim.status,
      submittedTotal: claim.submittedTotal.toString(),
      approvedTotal: claim.approvedTotal.toString(),
      createdAt: claim.createdAt,
      reimbursementStatus: claim.reimbursement?.status ?? null,
    })),
  };
}
