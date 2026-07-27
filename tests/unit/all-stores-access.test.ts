import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessIndustry } from "@prisma/client";
import {
  getAvailableGroupReportingContexts,
  resolveAuthorizedGroupReportingScope,
} from "../../src/lib/business-groups/all-stores-access";

const salon = {
  id: "business-salon",
  name: "QA Salon",
  industryType: "SALON_BEAUTY" as const,
  logoUrl: null,
};
const auto = {
  id: "business-auto",
  name: "QA Auto",
  industryType: "AUTO_DETAILING" as const,
  logoUrl: null,
};
const secondGroupStore = {
  id: "business-second-group",
  name: "QA Second Group",
  industryType: "GENERAL_SERVICE" as const,
  logoUrl: null,
};
type TestBusiness = {
  id: string;
  name: string;
  industryType: BusinessIndustry;
  logoUrl: null;
};

test("group owner contexts stay separated by group and exclude inactive stores", async () => {
  const database = createDatabase({
    grants: [
      ownerGrant("group-a", "QA Group A", [salon, auto]),
      ownerGrant("group-b", "QA Group B", [secondGroupStore]),
    ],
  });

  const contexts = await getAvailableGroupReportingContexts(
    "user-owner",
    salon.id,
    database,
  );

  assert.equal(contexts.length, 2);
  assert.deepEqual(
    contexts.map((context) => ({
      groupId: context.groupId,
      businesses: context.businesses.map((business) => business.id),
      canViewAllStores: context.canViewAllStores,
    })),
    [
      {
        groupId: "group-a",
        businesses: [salon.id, auto.id],
        canViewAllStores: true,
      },
      {
        groupId: "group-b",
        businesses: [secondGroupStore.id],
        canViewAllStores: false,
      },
    ],
  );
  assert.equal(contexts[0]?.businesses[0]?.isCurrent, true);
});

test("group manager sees only scoped active members and needs VIEW_REPORTS", async () => {
  const database = createDatabase({
    grants: [
      {
        role: "GROUP_MANAGER",
        accessScope: "SELECTED_BUSINESSES",
        group: {
          id: "group-a",
          name: "QA Group A",
          members: [{ business: salon }, { business: auto }],
        },
        businessAccesses: [{ businessId: auto.id }],
      },
    ],
  });

  const contexts = await getAvailableGroupReportingContexts(
    "user-manager",
    auto.id,
    database,
  );
  assert.deepEqual(
    contexts[0]?.businesses.map((business) => business.id),
    [auto.id],
  );
  assert.equal(contexts[0]?.canViewAllStores, false);

  const denied = await getAvailableGroupReportingContexts(
    "user-manager",
    auto.id,
    database,
    { canManagerViewReports: () => false },
  );
  assert.deepEqual(denied, []);
});

test("scope resolution does not disclose unauthorized groups", async () => {
  const database = createDatabase({
    grants: [ownerGrant("group-a", "QA Group A", [salon, auto])],
  });

  const allowed = await resolveAuthorizedGroupReportingScope(
    "user-owner",
    "group-a",
    salon.id,
    database,
  );
  assert.equal(allowed?.groupName, "QA Group A");

  const denied = await resolveAuthorizedGroupReportingScope(
    "user-owner",
    "group-outside",
    salon.id,
    database,
  );
  assert.equal(denied, null);
});

test("inactive, platform, and direct-only users receive no group contexts", async () => {
  for (const user of [
    { id: "inactive", role: "STAFF", status: "inactive", loginEnabled: true },
    {
      id: "disabled",
      role: "BUSINESS_OWNER",
      status: "active",
      loginEnabled: false,
    },
    {
      id: "platform",
      role: "PLATFORM_ADMIN",
      status: "active",
      loginEnabled: true,
    },
  ]) {
    const contexts = await getAvailableGroupReportingContexts(
      user.id,
      null,
      createDatabase({ user, grants: [] }),
    );
    assert.deepEqual(contexts, []);
  }

  const directOnly = await getAvailableGroupReportingContexts(
    "direct-owner",
    salon.id,
    createDatabase({ grants: [] }),
  );
  assert.deepEqual(directOnly, []);
});

function ownerGrant(
  groupId: string,
  groupName: string,
  businesses: TestBusiness[],
) {
  return {
    role: "GROUP_OWNER",
    accessScope: "ALL_GROUP_BUSINESSES",
    group: {
      id: groupId,
      name: groupName,
      members: businesses.map((business) => ({ business })),
    },
    businessAccesses: [],
  };
}

function createDatabase({
  user = {
    id: "user-owner",
    role: "BUSINESS_OWNER",
    status: "active",
    loginEnabled: true,
  },
  grants,
}: {
  user?: {
    id: string;
    role: string;
    status: string;
    loginEnabled: boolean;
  };
  grants: unknown[];
}) {
  return {
    user: {
      findUnique: async () => user,
    },
    businessGroupUser: {
      findMany: async () => grants,
    },
  } as never;
}
