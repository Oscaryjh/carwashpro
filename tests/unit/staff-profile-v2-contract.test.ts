import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildStaffNavigation } from "../../src/lib/staff-pwa/navigation";

const profile = source("src/components/staff-pwa/staff-profile.tsx");
const profileCss = source("src/components/staff-pwa/staff-profile-v2.module.css");
const avatar = source("src/components/staff-pwa/staff-avatar-upload.tsx");
const chrome = source("src/components/staff-pwa/staff-pwa-chrome.tsx");
const device = source("src/app/staff/device/page.tsx");
const meRoute = source("src/app/api/employee-auth/me/route.ts");
const avatarRoute = source("src/app/api/employee-auth/avatar/route.ts");

test("Profile V2 uses the approved identity-first IA without a legacy hero", () => {
  assert.match(profile, /StaffV2PageHeader title="Profile"/);
  assert.match(profile, />Identity</);
  assert.match(profile, />Current workplace</);
  assert.match(profile, />Employment</);
  assert.match(profile, />This phone</);
  assert.match(profile, />Security</);
  assert.match(profile, />Account</);
  assert.doesNotMatch(profile, /staff-profile-hero|ProfileHero|Active badge/);
});

test("Profile V2 keeps optional identity data honest and compact", () => {
  assert.match(profile, /profile\.employee\.position \? <p>/);
  assert.doesNotMatch(profile, /Not specified|N\/A/);
  assert.match(profileCss, /height:\s*56px/);
  assert.match(profileCss, /min-height:\s*56px/);
  assert.match(avatar, /aria-label="Change profile photo"/);
  assert.match(avatar, /\/api\/employee-auth\/avatar/);
});

test("Profile V2 shows only canonical employment facts", () => {
  assert.match(profile, /label="Employee ID" value=\{profile\.employee\.employeeCode\}/);
  assert.match(profile, /humanizeProfileValue\(profile\.employee\.employmentType\)/);
  assert.match(profile, /formatProfileDate\(profile\.employee\.joinedAt\)/);
  assert.doesNotMatch(profile, /employmentStatus|membershipId|employeeAccountId|businessId|branchId/);
});

test("Profile V2 device copy distinguishes authorization from sign in", () => {
  assert.match(profile, /This phone can access Staff App/);
  assert.match(profile, /Authorized on/);
  assert.match(profile, /formatProfileActivity\(profile\.device\.lastActiveAt\)/);
  assert.match(profile, /formatProfileDate\(profile\.device\.firstVerifiedAt\)/);
  assert.match(profile, /<summary>About this phone<\/summary>/);
  assert.doesNotMatch(profile, /Signed in|Last signed in|displayName|deviceIdentifier|deviceId|sessionId|canView|canPunch/);
});

test("Profile V2 defers phone, session and cross-module summaries", () => {
  assert.match(profile, /value="Phone verification"/);
  assert.doesNotMatch(profile, /phoneNumber|masked|OTP|SMS123|Twilio|expiresAt|createdAt/);
  assert.doesNotMatch(profile, /approval|salary|commission amount|claim count|leave balance|current shift/i);
  assert.doesNotMatch(meRoute, /phoneMasked|sessionCreatedAt|lastSignedIn/);
});

test("Profile reuses canonical workplace and logout operations", () => {
  assert.match(profile, /workplaces\.length > 1/);
  assert.match(profile, /onClick=\{openWorkplaceSwitcher\}/);
  assert.match(profile, /onClick=\{\(\) => void logout\(\)\}/);
  assert.match(profile, /disabled=\{switching\}/);
  assert.match(chrome, /\/api\/employee-auth\/switch-workplace/);
  assert.match(chrome, /body: JSON\.stringify\(\{ membershipId \}\)/);
  assert.match(chrome, /clearStaffTenantClientState\(\)/);
  assert.match(chrome, /window\.location\.replace\("\/staff"\)/);
  assert.match(chrome, /\/api\/employee-auth\/logout/);
  assert.match(chrome, /window\.location\.replace\("\/staff\/login\?reason=logged-out"\)/);
  assert.doesNotMatch(profile, /confirm\(|confirmation|modal/i);
});

test("Shared workplace chooser has dialog focus containment and restoration", () => {
  assert.match(chrome, /role="dialog"/);
  assert.match(chrome, /aria-labelledby="staff-workplace-dialog-title"/);
  assert.match(chrome, /workplaceCloseRef\.current\?\.focus\(\)/);
  assert.match(chrome, /event\.key !== "Tab"/);
  assert.match(chrome, /event\.key === "Escape"/);
  assert.match(chrome, /returnTarget\?\.focus\(\)/);
});

test("Avatar update remains same-origin, membership-scoped and audited", () => {
  assert.match(avatarRoute, /assertEmployeeAuthSameOrigin\(request\)/);
  assert.match(avatarRoute, /requireEmployeeSelfServiceAuthContext\(request\)/);
  assert.match(avatarRoute, /employeeAccountId: auth\.employeeAccountId/);
  assert.match(avatarRoute, /businessId: auth\.businessId/);
  assert.match(avatarRoute, /EMPLOYEE_SELF_AVATAR_UPDATED/);
  assert.match(avatarRoute, /MAX_AVATAR_BYTES/);
});

test("Device compatibility routes converge on canonical Profile", () => {
  assert.match(device, /redirect\(verified === "1" \? "\/staff\/profile\?device=verified" : "\/staff\/profile"\)/);
  assert.doesNotMatch(device, /StaffProfile/);
});

test("Profile preserves the five canonical bottom navigation destinations", () => {
  const navigation = buildStaffNavigation(["CORE", "HR", "CLAIMS", "COMMISSION", "PAYROLL"]);
  assert.deepEqual(navigation.primary.map((item) => item.label), ["Home", "Time", "Requests", "Pay", "Profile"]);
});

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
