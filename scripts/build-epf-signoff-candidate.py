"""Build the immutable, machine-readable EPF human sign-off candidate."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "statutory/official/classifications/malaysia-epf-2025-10-signoff-candidate-v1.json"


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def classification(
    code: str,
    name: str,
    meaning: str,
    source_type: str,
    component_type: str,
    treatment: str,
    basis: list[str],
    recommendation: str,
    notes: str,
) -> dict:
    unknown = treatment == "UNKNOWN"
    return {
        "componentCode": code,
        "displayName": name,
        "businessMeaning": meaning,
        "sourceType": source_type,
        "componentType": component_type,
        "EPF": treatment,
        "officialBasis": basis,
        "technicalRecommendation": recommendation,
        "humanDecisionRequired": unknown,
        "reviewStatus": "HUMAN_DECISION_REQUIRED" if unknown else "TECHNICAL_EVIDENCE_PASS",
        "risk": "HIGH" if unknown else "LOW",
        "notes": notes,
    }


def main() -> None:
    wage = ["KWSP_WAGES_DEFINITION", "KWSP_PAYMENTS_LIABLE_GUIDANCE"]
    non_wage = ["KWSP_PAYMENTS_NOT_LIABLE_GUIDANCE"]
    holiday = ["KWSP_HOLIDAY_WAGES_FAQ", "KWSP_OVERTIME_EXCLUSION"]
    classifications = [
        classification("BASIC_SALARY", "Monthly basic salary", "Contractual monthly salary", "BASIC_SALARY", "EARNING", "INCLUDED", wage, "INCLUDE", "Salary is monetary remuneration and is expressly liable."),
        classification("REGULAR_DAILY_PAY", "Regular daily pay", "Ordinary daily-rated remuneration", "ATTENDANCE", "EARNING", "INCLUDED", wage + ["KWSP_HOURLY_DAILY_WAGE_FAQ"], "INCLUDE", "KWSP expressly covers daily-rated wages."),
        classification("REGULAR_HOURLY_PAY", "Regular hourly pay", "Ordinary hourly-rated remuneration", "ATTENDANCE", "EARNING", "INCLUDED", wage + ["KWSP_HOURLY_DAILY_WAGE_FAQ"], "INCLUDE", "KWSP expressly covers hourly-rated wages."),
        classification("PAID_LEAVE_PAY", "Paid leave pay", "Remuneration for approved paid leave", "ATTENDANCE", "EARNING", "INCLUDED", wage + ["KWSP_PAID_LEAVE_GUIDANCE"], "INCLUDE", "Paid annual, medical, maternity, study and half-day leave wages are expressly liable."),
        classification("LEAVE_PAY", "Leave pay", "Paid-leave remuneration alias", "PAYROLL_CALCULATION", "EARNING", "INCLUDED", wage + ["KWSP_PAID_LEAVE_GUIDANCE"], "INCLUDE_WHEN_PAID_LEAVE", "This mapping is only for paid-leave remuneration."),
        classification("OVERTIME_PAY", "Overtime pay", "Approved overtime remuneration", "PAYROLL_CALCULATION", "EARNING", "EXCLUDED", non_wage + ["KWSP_OVERTIME_EXCLUSION"], "EXCLUDE", "KWSP expressly lists overtime payment as not liable."),
        classification("REST_DAY_PAY", "Rest-day pay", "Remuneration for work on a rest day", "PAYROLL_CALCULATION", "EARNING", "UNKNOWN", holiday, "SEMANTIC_REVIEW_REQUIRED", "KWSP says holiday wages are liable unless the attendance is overtime; the current component does not freeze that statutory distinction."),
        classification("PUBLIC_HOLIDAY_PAY", "Public-holiday pay", "Remuneration for work on a public holiday", "PAYROLL_CALCULATION", "EARNING", "UNKNOWN", holiday, "SEMANTIC_REVIEW_REQUIRED", "The payment is liable unless it is overtime; current metadata does not prove which meaning applies."),
        classification("COMMISSION", "Commission", "Approved sales or service commission", "VARIABLE_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "Commission is expressly listed as liable."),
        classification("INCENTIVE", "Incentive", "Approved performance incentive", "VARIABLE_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "Incentive is expressly listed as liable."),
        classification("BONUS", "Bonus", "Approved contractual or discretionary bonus", "VARIABLE_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "Bonus is expressly listed as liable; the Third Schedule contains the RM5,000 employer-rate note."),
        classification("ONE_OFF_EARNING", "One-off earning", "Generic one-off positive payment", "VARIABLE_PAY", "EARNING", "UNKNOWN", wage + non_wage, "SOURCE_NATURE_REQUIRED", "A generic one-off label can represent liable wages or an excluded payment."),
        classification("ONE_OFF_DEDUCTION", "One-off deduction", "Generic employee deduction", "VARIABLE_PAY", "DEDUCTION", "EXCLUDED", ["EPF_WAGE_BASE_EARNINGS_ONLY"], "EXCLUDE_FROM_WAGE_BASE", "An employee deduction is not a positive wage component."),
        classification("ARREARS", "Arrears", "Generic arrears without original earning nature", "CORRECTION", "EARNING", "UNKNOWN", wage, "ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED", "KWSP includes arrears of wages, but this generic label does not prove that the source was contribution wages."),
        classification("SALARY_ARREARS", "Salary arrears", "Arrears explicitly tied to salary", "CORRECTION", "EARNING", "INCLUDED", wage, "INCLUDE", "Arrears of salary/wages are expressly liable."),
        classification("RECOVERY", "Recovery", "Employee recovery deduction", "CORRECTION", "DEDUCTION", "EXCLUDED", ["EPF_WAGE_BASE_EARNINGS_ONLY"], "EXCLUDE_FROM_WAGE_BASE", "A recovery deduction is not remuneration due to the employee."),
        classification("PAYROLL_RECOVERY", "Payroll recovery", "Payroll correction recovery", "CORRECTION", "DEDUCTION", "EXCLUDED", ["EPF_WAGE_BASE_EARNINGS_ONLY"], "EXCLUDE_FROM_WAGE_BASE", "A recovery deduction is not remuneration due to the employee."),
        classification("TRANSPORT_ALLOWANCE", "Transport allowance", "Business-defined transport payment", "RECURRING_PAY", "EARNING", "UNKNOWN", wage + non_wage, "SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION", "KWSP excludes travelling allowance or travel concession, while an ordinary non-travel allowance can be liable. Tetamu does not freeze that distinction."),
        classification("MEAL_ALLOWANCE", "Meal allowance", "Fixed cash meal allowance", "RECURRING_PAY", "EARNING", "INCLUDED", wage, "INCLUDE_WHEN_FIXED_CASH_ALLOWANCE", "A fixed cash allowance due under the contract of service is within the express allowance category."),
        classification("HOUSING_ALLOWANCE", "Housing allowance", "Fixed cash housing allowance", "RECURRING_PAY", "EARNING", "INCLUDED", wage, "INCLUDE_WHEN_FIXED_CASH_ALLOWANCE", "A fixed cash allowance due under the contract of service is within the express allowance category."),
        classification("SHIFT_ALLOWANCE", "Shift allowance", "Fixed cash shift allowance", "RECURRING_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "An allowance paid for shift work is monetary remuneration under the service contract."),
        classification("COST_OF_LIVING_ALLOWANCE", "Cost-of-living allowance", "Fixed cash COLA", "RECURRING_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "A fixed cash allowance due under the service contract is liable."),
        classification("ATTENDANCE_ALLOWANCE", "Attendance allowance", "Fixed cash attendance incentive", "RECURRING_PAY", "EARNING", "INCLUDED", wage, "INCLUDE", "This is an allowance/incentive, both expressly liable categories."),
        classification("PHONE_ALLOWANCE", "Phone allowance", "Business-defined phone payment", "RECURRING_PAY", "EARNING", "UNKNOWN", wage + non_wage, "SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION", "The code does not distinguish fixed cash allowance from expense reimbursement."),
        classification("FIXED_ALLOWANCE", "Fixed allowance", "Generic fixed allowance", "RECURRING_PAY", "EARNING", "UNKNOWN", wage + non_wage, "SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION", "Generic allowance metadata cannot rule out an excluded reimbursement or travel payment."),
        classification("RECURRING_ALLOWANCE", "Recurring allowance", "Generic recurring allowance", "RECURRING_PAY", "EARNING", "UNKNOWN", wage + non_wage, "SEMANTIC_CLASSIFICATION_REQUIRES_BUSINESS_DEFINITION", "Generic allowance metadata cannot rule out an excluded reimbursement or travel payment."),
        classification("STAFF_LOAN", "Staff loan", "Employee loan deduction", "RECURRING_PAY", "DEDUCTION", "EXCLUDED", ["EPF_WAGE_BASE_EARNINGS_ONLY"], "EXCLUDE_FROM_WAGE_BASE", "A loan deduction is not contribution wages."),
        classification("UNIFORM_DEDUCTION", "Uniform deduction", "Employee uniform deduction", "RECURRING_PAY", "DEDUCTION", "EXCLUDED", ["EPF_WAGE_BASE_EARNINGS_ONLY"], "EXCLUDE_FROM_WAGE_BASE", "An employee deduction is not contribution wages."),
        classification("MANUAL_ADJUSTMENT", "Manual adjustment", "Generic operator-authored adjustment", "MANUAL_ADJUSTMENT", "EARNING", "UNKNOWN", wage + non_wage, "SOURCE_NATURE_REQUIRED", "A generic manual adjustment can represent either liable remuneration or a non-wage payment."),
        classification("CUSTOM_UNKNOWN_EARNING", "Custom earning", "Unclassified custom positive payment", "MANUAL_ADJUSTMENT", "EARNING", "UNKNOWN", wage + non_wage, "SOURCE_NATURE_REQUIRED", "No official classification can be inferred from an unknown custom code."),
    ]
    unresolved = [item["componentCode"] for item in classifications if item["EPF"] == "UNKNOWN"]
    candidate = {
        "schemaVersion": 1,
        "version": "MALAYSIA_EPF_2025_10_SIGNOFF_CANDIDATE_1",
        "effectiveFrom": "2025-10-01",
        "effectiveTo": None,
        "scheme": "EPF",
        "status": "READY_FOR_HUMAN_SIGN_OFF",
        "technicalReviewStatus": "TECHNICAL_REVIEW_COMPLETE",
        "approvalStatus": "NOT_SIGNED_OFF",
        "immutableRevision": True,
        "reviewedOn": "2026-08-08",
        "reviewer": {"type": "AI_ASSISTED_TECHNICAL_REVIEW", "humanApproval": False, "legalApproval": False, "governmentCertification": False},
        "officialSources": {
            "schedule": "https://www.kwsp.gov.my/en/epf-act-1991-third-schedule",
            "wageDefinition": "https://www.kwsp.gov.my/en/what-you-need-to-know-1",
            "employerGuidance": "https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution",
        },
        "evidence": {
            "artifactSha256": "c4904e44f0cb15a251a59e4f34c11a1ededa0868b962b2ebd9b81270285358b1",
            "datasetDigest": "17c6787a8b28fb0e1b30f9c350a70491a0f882e833b7cf17a3d1251acc45a4b3",
            "independentReviewDigest": "2979a295a770db12a2f887a4e7510f12b5b5f6952beda1216ad5acfe67108e83",
            "fixtureDigest": "c087a139b15eed9eadcba55ad99c3131eb67230acb81712744ee9f4c99487860",
            "goldenCertificationDigest": "576d19b807e127637c867a98b99a78c38fa7dcb72f9c020baf180eb607b39e79",
            "parserVersion": "2.0.0",
            "calculatorVersion": "statutory-p2c-epf-calculator/1.0.0",
            "calculatorTestDigest": "7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14",
        },
        "categoryMatrix": [
            {"facts": "Malaysian; age 14-59", "category": "PART_A"},
            {"facts": "Malaysian; age 60-74", "category": "PART_E"},
            {"facts": "Permanent resident; age 14-59", "category": "PART_A"},
            {"facts": "Permanent resident; age 60-74", "category": "PART_C"},
            {"facts": "Non-Malaysian elected before 1 August 1998; age 14-59", "category": "PART_A"},
            {"facts": "Non-Malaysian elected before 1 August 1998; age 60-74", "category": "PART_C"},
            {"facts": "Other non-Malaysian; age 14-74", "category": "PART_F"},
            {"facts": "Below 14 or age 75 and above", "category": "NOT_APPLICABLE"},
        ],
        "classificationDigest": "",
        "unresolvedComponentCount": len(unresolved),
        "unresolvedComponents": unresolved,
        "classifications": classifications,
        "activation": {"allowed": False, "blocker": "HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED", "productionActivationPerformed": False},
        "approvalRecord": {"approvedByActorId": None, "approvedAt": None, "approvalReason": None, "approvalRecordDigest": None},
        "candidateDigest": "",
    }
    candidate["classificationDigest"] = digest(classifications)
    candidate["candidateDigest"] = digest({key: value for key, value in candidate.items() if key != "candidateDigest"})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"classifications={len(classifications)} unresolved={len(unresolved)}")
    print(f"classificationDigest={candidate['classificationDigest']}")
    print(f"candidateDigest={candidate['candidateDigest']}")


if __name__ == "__main__":
    main()
