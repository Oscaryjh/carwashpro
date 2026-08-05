export const salaryBankOptions = [
  { code: "MAYBANK", name: "Maybank" },
  { code: "CIMB", name: "CIMB Bank" },
  { code: "PBB", name: "Public Bank" },
  { code: "RHB", name: "RHB Bank" },
  { code: "HLB", name: "Hong Leong Bank" },
  { code: "AMBANK", name: "AmBank" },
  { code: "UOB", name: "UOB Malaysia" },
  { code: "OCBC", name: "OCBC Bank Malaysia" },
  { code: "BANKISLAM", name: "Bank Islam" },
  { code: "BANKRAKYAT", name: "Bank Rakyat" },
  { code: "BSN", name: "Bank Simpanan Nasional" },
  { code: "ALLIANCE", name: "Alliance Bank" },
  { code: "AFFIN", name: "Affin Bank" },
  { code: "HSBC", name: "HSBC Malaysia" },
  { code: "SCB", name: "Standard Chartered Malaysia" },
] as const;

export type SalaryBankCode = (typeof salaryBankOptions)[number]["code"];

export function findSalaryBank(code: string) {
  return salaryBankOptions.find((bank) => bank.code === code) ?? null;
}
