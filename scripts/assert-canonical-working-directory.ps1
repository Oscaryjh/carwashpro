$ErrorActionPreference = "Stop"

$expectedRoot = "C:\CodexTetamuP0"
$reportedRoot = (& git rev-parse --show-toplevel 2>$null)

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($reportedRoot)) {
  Write-Error "WRONG WORKING DIRECTORY: this directory is not a Git working tree."
  exit 1
}

$reportedRoot = $reportedRoot.Trim().Replace("/", "\")
$resolvedRoot = (Resolve-Path -LiteralPath $reportedRoot).Path.TrimEnd("\")
$expectedRoot = $expectedRoot.TrimEnd("\")
$rootItem = Get-Item -LiteralPath $resolvedRoot -Force

if (-not $resolvedRoot.Equals($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Error "WRONG WORKING DIRECTORY: expected $expectedRoot but found $resolvedRoot."
  exit 1
}

if ($resolvedRoot -match "(?i)OneDrive|\.p0-testing-deploy") {
  Write-Error "WRONG WORKING DIRECTORY: OneDrive and .p0-testing-deploy are not canonical development roots."
  exit 1
}

if ($rootItem.LinkType -or ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  Write-Error "WRONG WORKING DIRECTORY: $expectedRoot must be a physical directory, not a link or reparse point."
  exit 1
}

Write-Output "Canonical working directory verified: $resolvedRoot"
