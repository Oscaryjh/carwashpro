import assert from "node:assert/strict";
import test from "node:test";
import {
  findSalaryBank,
  salaryBankGroups,
  salaryBankOptions,
} from "../../src/lib/payroll/payment/bank-directory";

test("salary receiving directory separates banks, digital banks and e-wallets", () => {
  assert.deepEqual(
    salaryBankGroups.map((group) => group.code),
    ["BANK", "ISLAMIC_BANK", "DEVELOPMENT_BANK", "DIGITAL_BANK", "E_WALLET"],
  );

  assert.deepEqual(findSalaryBank("BOOST_BANK"), {
    code: "BOOST_BANK",
    name: "Boost Bank",
    group: "DIGITAL_BANK",
  });
  assert.deepEqual(findSalaryBank("GX_BANK"), {
    code: "GX_BANK",
    name: "GXBank",
    group: "DIGITAL_BANK",
  });
  assert.deepEqual(findSalaryBank("TNG_EWALLET"), {
    code: "TNG_EWALLET",
    name: "Touch 'n Go eWallet",
    group: "E_WALLET",
  });
  assert.deepEqual(findSalaryBank("BOOST_EWALLET"), {
    code: "BOOST_EWALLET",
    name: "Boost eWallet",
    group: "E_WALLET",
  });
});

test("salary receiving codes remain unique and database-safe", () => {
  const codes = salaryBankOptions.map((bank) => bank.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((code) => code.length <= 32));
  assert.ok(
    salaryBankOptions.every((bank) =>
      salaryBankGroups.some((group) => group.code === bank.group),
    ),
  );
});
