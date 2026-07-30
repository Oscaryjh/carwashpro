import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getServicesForStaff,
  reconcileServicesForStaff,
} from "../../src/lib/appointments/staff-services";

const services = [
  { id: "haircut", staffIds: ["staff-a", "staff-b"] },
  { id: "coloring", staffIds: ["staff-b"] },
  { id: "facial", staffIds: [] },
];

describe("appointment staff services", () => {
  it("shows only services assigned to the selected staff member", () => {
    assert.deepEqual(
      getServicesForStaff(services, "staff-a").map((service) => service.id),
      ["haircut"],
    );
    assert.deepEqual(
      getServicesForStaff(services, "staff-b").map((service) => service.id),
      ["haircut", "coloring"],
    );
  });

  it("shows no services until a staff member is selected", () => {
    assert.deepEqual(getServicesForStaff(services, ""), []);
  });

  it("removes selected services that the next staff member cannot perform", () => {
    assert.deepEqual(
      reconcileServicesForStaff(["haircut", "coloring"], services, "staff-a"),
      {
      removedCount: 1,
      retainedServiceIds: ["haircut"],
      },
    );
  });
});
