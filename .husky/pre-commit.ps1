# agent_1 Pre-Commit Hook (PowerShell)
# Runs quality gates before every commit

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  agent_1 Pre-Commit Quality Gates" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

$failed = $false

Write-Host ""
Write-Host "  [1/3] TypeScript Type Check..." -ForegroundColor Yellow
try {
    npx tsc --noEmit 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  TYPE CHECK FAILED" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  TypeScript OK" -ForegroundColor Green
    }
} catch {
    Write-Host "  TypeScript check error: $_" -ForegroundColor Red
    $failed = $true
}

Write-Host ""
Write-Host "  [2/3] Lint Check..." -ForegroundColor Yellow
try {
    npx eslint src/ --no-error-on-unmatched-pattern --max-warnings 5 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  LINT FAILED" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "  Lint OK" -ForegroundColor Green
    }
} catch {
    Write-Host "  Lint check error: $_" -ForegroundColor Red
    $failed = $true
}

Write-Host ""
Write-Host "  [3/3] Quick Test Sanity..." -ForegroundColor Yellow
try {
    $result = node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.cjs --testPathPattern="result|permissions|healer" --passWithNoTests --silent 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  TESTS FAILED" -ForegroundColor Red
        Write-Host $result
        $failed = $true
    } else {
        Write-Host "  Tests OK" -ForegroundColor Green
    }
} catch {
    Write-Host "  Test error: $_" -ForegroundColor Red
    $failed = $true
}

if ($failed) {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Red
    Write-Host "  QUALITY GATES FAILED - Commit blocked" -ForegroundColor Red
    Write-Host "  Fix issues above and try again." -ForegroundColor Red
    Write-Host "================================================" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  All checks passed! Proceeding to commit." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
exit 0