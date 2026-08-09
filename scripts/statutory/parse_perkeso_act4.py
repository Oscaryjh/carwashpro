"""Deterministically parse the text-extractable PERKESO Act 4/SKBBK table.

The script writes normalized JSON to stdout and never activates a rule. It
requires pypdf and an exact artifact whose checksum is verified separately.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader


ARTIFACT_ID = "perkeso-act4-lindung24-2026-06"
ARTIFACT_SHA256 = "e76b2a03740f6da4a305919c677d4935a05e9166502e5f06afe1030b7407caa1"
EXPECTED_ROWS = 65
ROW_PATTERN = re.compile(r"\b(\d{1,2})\.\s+(.*?)(?=\b\d{1,2}\.\s+|$)")
MONEY_PATTERN = re.compile(r"RM\s*([0-9,]+(?:\.[0-9]{1,2})?)")


def money_cents(value: str) -> int:
    return int(Decimal(value.replace(",", "")) * 100)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def main() -> None:
    if len(sys.argv) not in {2, 3}:
        raise SystemExit("usage: parse_perkeso_act4.py <official-pdf> [normalized-json]")
    artifact = Path(sys.argv[1])
    artifact_bytes = artifact.read_bytes()
    if hashlib.sha256(artifact_bytes).hexdigest() != ARTIFACT_SHA256:
        raise SystemExit("OFFICIAL_ARTIFACT_CHECKSUM_MISMATCH")

    text = " ".join(
        " ".join((page.extract_text() or "").split())
        for page in PdfReader(str(artifact)).pages
    )
    matches = ROW_PATTERN.findall(text)
    rows = []
    previous_upper = -1
    for number_text, row_text in matches:
        number = int(number_text)
        if number != len(rows) + 1:
            continue
        amounts = [money_cents(item) for item in MONEY_PATTERN.findall(row_text)]
        if number == 1:
            upper = amounts[0]
        elif number == EXPECTED_ROWS:
            upper = None
        else:
            upper = amounts[1]
        contributions = amounts[-7:]
        if len(contributions) != 7:
            raise SystemExit("ARTIFACT_PARSE_REVIEW_REQUIRED")
        employer_first, employee_first, lindung, total_first, employer_second, lindung_second, total_second = contributions
        if employer_first + employee_first + lindung != total_first:
            raise SystemExit("ARTIFACT_PARSE_REVIEW_REQUIRED")
        if employer_second + lindung_second != total_second or lindung != lindung_second:
            raise SystemExit("ARTIFACT_PARSE_REVIEW_REQUIRED")
        rows.append(
            {
                "key": f"ACT4-{number:02d}",
                "lowerInclusiveCents": previous_upper + 1,
                "upperInclusiveCents": upper,
                "contributions": {
                    "socsoEmployerFirstCents": employer_first,
                    "socsoEmployeeFirstCents": employee_first,
                    "lindung24EmployeeCents": lindung,
                    "socsoEmployerSecondCents": employer_second,
                },
                "sourceReference": f"official contribution schedule row {number}",
            }
        )
        if upper is not None:
            previous_upper = upper

    if len(rows) != EXPECTED_ROWS:
        raise SystemExit("ARTIFACT_PARSE_REVIEW_REQUIRED")
    dataset = {
        "schemaVersion": 1,
        "id": "perkeso-act4-lindung24-2026-06-v1",
        "schemes": ["SOCSO", "LINDUNG24"],
        "artifactId": ARTIFACT_ID,
        "artifactSha256": ARTIFACT_SHA256,
        "parserName": "perkeso-act4-skbbk-table",
        "parserVersion": "1.0.0",
        "extractionMode": "TEXT_EXTRACTED",
        "verificationStatus": "PARSED",
        "expectedRowCount": EXPECTED_ROWS,
        "rows": rows,
    }
    dataset["datasetDigest"] = hashlib.sha256(canonical_json(dataset).encode()).hexdigest()
    output = json.dumps(dataset, ensure_ascii=False, indent=2) + "\n"
    if len(sys.argv) == 3:
        output_path = Path(sys.argv[2])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output, encoding="utf-8", newline="\n")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
