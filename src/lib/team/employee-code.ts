const DEFAULT_EMPLOYEE_CODE_PREFIX = "EMP-";
const DEFAULT_EMPLOYEE_CODE_WIDTH = 3;

export function suggestNextEmployeeCode(employeeCodes: readonly string[]) {
  let highestSequence = 0;
  let numberWidth = DEFAULT_EMPLOYEE_CODE_WIDTH;

  for (const employeeCode of employeeCodes) {
    const match = /^EMP-(\d+)$/i.exec(employeeCode.trim());
    if (!match) continue;

    const sequence = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(sequence)) continue;

    highestSequence = Math.max(highestSequence, sequence);
    numberWidth = Math.max(numberWidth, match[1].length);
  }

  return `${DEFAULT_EMPLOYEE_CODE_PREFIX}${String(highestSequence + 1).padStart(numberWidth, "0")}`;
}
