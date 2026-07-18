import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultWhatsAppTemplate,
  getUnsupportedWhatsAppTemplateVariables,
  getWhatsAppTemplateLabel,
  getWhatsAppTemplateVariables,
} from "../../src/lib/whatsapp/template-defaults";

test("Auto WhatsApp templates keep vehicle-specific fields", () => {
  const template = getDefaultWhatsAppTemplate(
    "READY_FOR_PICKUP",
    "AUTO_DETAILING",
  );

  assert.ok(template?.body.includes("{{plateNumber}}"));
  assert.ok(
    (getWhatsAppTemplateVariables("AUTO_DETAILING") as readonly string[]).includes(
      "plateNumber",
    ),
  );
  const variables = getWhatsAppTemplateVariables("AUTO_DETAILING") as readonly string[];
  assert.ok(variables.includes("vehicleBrand"));
  assert.ok(variables.includes("vehicleModel"));
  assert.ok(variables.includes("vehicleDisplayName"));
});

test("Salon WhatsApp templates do not require vehicle fields", () => {
  const template = getDefaultWhatsAppTemplate(
    "READY_FOR_PICKUP",
    "SALON_BEAUTY",
  );
  const variables = getWhatsAppTemplateVariables("SALON_BEAUTY");

  assert.ok(template?.body.includes("{{services}}"));
  assert.equal(template?.body.includes("{{plateNumber}}"), false);
  assert.equal((variables as readonly string[]).includes("plateNumber"), false);
  assert.ok((variables as readonly string[]).includes("services"));
});

test("other industries use generic service templates", () => {
  const template = getDefaultWhatsAppTemplate(
    "SERVICE_CONFIRMATION",
    "PET_GROOMING",
  );

  assert.equal(template?.body.includes("{{plateNumber}}"), false);
  assert.ok(template?.body.includes("{{services}}"));
});

test("Salon template labels use salon language", () => {
  assert.equal(
    getWhatsAppTemplateLabel("READY_FOR_PICKUP", "SALON_BEAUTY"),
    "Service completed",
  );
  assert.equal(
    getWhatsAppTemplateLabel("INVOICE_SENT", "SALON_BEAUTY"),
    "Receipt sent",
  );
});

test("Salon template validation rejects vehicle-only variables", () => {
  const result = getUnsupportedWhatsAppTemplateVariables(
    "Hi {{customerName}}, {{plateNumber}} is ready at {{companyName}}.",
    "SALON_BEAUTY",
  );

  assert.deepEqual(result.unsupportedVariables, ["plateNumber"]);
  assert.deepEqual(result.usedVariables, [
    "customerName",
    "plateNumber",
    "companyName",
  ]);
});
