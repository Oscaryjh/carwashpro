export const salaryBankOptions = [
  { code: "MAYBANK", name: "Maybank", group: "BANK" },
  { code: "CIMB", name: "CIMB Bank", group: "BANK" },
  { code: "PBB", name: "Public Bank", group: "BANK" },
  { code: "RHB", name: "RHB Bank", group: "BANK" },
  { code: "HLB", name: "Hong Leong Bank", group: "BANK" },
  { code: "AMBANK", name: "AmBank", group: "BANK" },
  { code: "ALLIANCE", name: "Alliance Bank", group: "BANK" },
  { code: "AFFIN", name: "Affin Bank", group: "BANK" },
  { code: "UOB", name: "UOB Malaysia", group: "BANK" },
  { code: "OCBC", name: "OCBC Bank Malaysia", group: "BANK" },
  { code: "HSBC", name: "HSBC Malaysia", group: "BANK" },
  { code: "SCB", name: "Standard Chartered Malaysia", group: "BANK" },
  { code: "BANGKOK_BANK", name: "Bangkok Bank Malaysia", group: "BANK" },
  { code: "BANK_OF_AMERICA_MY", name: "Bank of America Malaysia", group: "BANK" },
  { code: "BANK_OF_CHINA_MY", name: "Bank of China Malaysia", group: "BANK" },
  { code: "BNP_PARIBAS_MY", name: "BNP Paribas Malaysia", group: "BANK" },
  { code: "CCB_MY", name: "China Construction Bank Malaysia", group: "BANK" },
  { code: "CITIBANK_MY", name: "Citibank Malaysia", group: "BANK" },
  { code: "DEUTSCHE_BANK_MY", name: "Deutsche Bank Malaysia", group: "BANK" },
  { code: "ICBC_MY", name: "ICBC Malaysia", group: "BANK" },
  { code: "JPMORGAN_MY", name: "J.P. Morgan Malaysia", group: "BANK" },
  { code: "MIZUHO_MY", name: "Mizuho Bank Malaysia", group: "BANK" },
  { code: "MUFG_MY", name: "MUFG Bank Malaysia", group: "BANK" },
  { code: "SMBC_MY", name: "SMBC Malaysia", group: "BANK" },

  { code: "MAYBANK_ISLAMIC", name: "Maybank Islamic", group: "ISLAMIC_BANK" },
  { code: "CIMB_ISLAMIC", name: "CIMB Islamic", group: "ISLAMIC_BANK" },
  { code: "PBB_ISLAMIC", name: "Public Islamic Bank", group: "ISLAMIC_BANK" },
  { code: "RHB_ISLAMIC", name: "RHB Islamic Bank", group: "ISLAMIC_BANK" },
  { code: "HLB_ISLAMIC", name: "Hong Leong Islamic Bank", group: "ISLAMIC_BANK" },
  { code: "AMBANK_ISLAMIC", name: "AmBank Islamic", group: "ISLAMIC_BANK" },
  { code: "ALLIANCE_ISLAMIC", name: "Alliance Islamic Bank", group: "ISLAMIC_BANK" },
  { code: "AFFIN_ISLAMIC", name: "Affin Islamic Bank", group: "ISLAMIC_BANK" },
  { code: "BANKISLAM", name: "Bank Islam", group: "ISLAMIC_BANK" },
  { code: "BANK_MUAMALAT", name: "Bank Muamalat", group: "ISLAMIC_BANK" },
  { code: "ALRAJHI_MY", name: "Al Rajhi Bank Malaysia", group: "ISLAMIC_BANK" },
  { code: "HSBC_AMANAH", name: "HSBC Amanah", group: "ISLAMIC_BANK" },
  { code: "KFH_MY", name: "Kuwait Finance House Malaysia", group: "ISLAMIC_BANK" },
  { code: "MBSB", name: "MBSB Bank", group: "ISLAMIC_BANK" },
  { code: "OCBC_AL_AMIN", name: "OCBC Al-Amin", group: "ISLAMIC_BANK" },
  { code: "SC_SAADIQ", name: "Standard Chartered Saadiq", group: "ISLAMIC_BANK" },

  { code: "BANKRAKYAT", name: "Bank Rakyat", group: "DEVELOPMENT_BANK" },
  { code: "BSN", name: "Bank Simpanan Nasional", group: "DEVELOPMENT_BANK" },
  { code: "AGROBANK", name: "Agrobank", group: "DEVELOPMENT_BANK" },

  { code: "GX_BANK", name: "GXBank", group: "DIGITAL_BANK" },
  { code: "BOOST_BANK", name: "Boost Bank", group: "DIGITAL_BANK" },
  { code: "AEON_BANK", name: "AEON Bank", group: "DIGITAL_BANK" },
  { code: "RYT_BANK", name: "Ryt Bank", group: "DIGITAL_BANK" },
  { code: "KAF_DIGITAL", name: "KAF Digital Bank", group: "DIGITAL_BANK" },

  { code: "TNG_EWALLET", name: "Touch 'n Go eWallet", group: "E_WALLET" },
  { code: "BOOST_EWALLET", name: "Boost eWallet", group: "E_WALLET" },
  { code: "BIGPAY", name: "BigPay", group: "E_WALLET" },
  { code: "GRABPAY", name: "GrabPay Wallet", group: "E_WALLET" },
  { code: "SHOPEEPAY", name: "ShopeePay", group: "E_WALLET" },
  { code: "SETEL", name: "Setel", group: "E_WALLET" },
  { code: "WISE_MY", name: "Wise Malaysia", group: "E_WALLET" },
] as const;

export const salaryBankGroups = [
  { code: "BANK", label: "Banks" },
  { code: "ISLAMIC_BANK", label: "Islamic banks" },
  { code: "DEVELOPMENT_BANK", label: "Development financial institutions" },
  { code: "DIGITAL_BANK", label: "Digital banks" },
  { code: "E_WALLET", label: "E-wallets" },
] as const;

export type SalaryBankCode = (typeof salaryBankOptions)[number]["code"];

export function findSalaryBank(code: string) {
  return salaryBankOptions.find((bank) => bank.code === code) ?? null;
}
