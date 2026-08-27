export const AI_INTENTS = [
  "SALES",
  "PEOPLE",
  "EXPENSES",
  "INVENTORY",
  "SUPPLIER_BILLS",
  "APPOINTMENTS",
  "PAYMENTS",
  "GENERAL_BUSINESS",
  "UNSUPPORTED",
] as const;

export type AiIntent = (typeof AI_INTENTS)[number];
export type AiAnswerLanguage = "en" | "zh";
export type AiTemporalSemantics = "PERIOD" | "SNAPSHOT";

export type AiIntentClassification = {
  intent: AiIntent;
  language: AiAnswerLanguage;
  temporalSemantics: AiTemporalSemantics;
  confidence: "HIGH" | "MEDIUM";
};

export function classifyAiQuestion(question: string): AiIntentClassification {
  const normalized = question.trim().toLowerCase();
  const language = detectAiQuestionLanguage(question);
  const forecast = /forecast|predict|guarantee|exactly.*next|next year|明年|下个月|下個月|预测|預測|一定.*赚|一定.*賺/.test(normalized);
  const people = /employee|employees|staff|headcount|workforce|员工|員工|职员|職員|人手|入职|入職|离职|離職/.test(normalized);
  const inventory = /inventory|stock|out of stock|low stock|reorder|库存|庫存|缺货|缺貨|存货|存貨/.test(normalized);
  const supplierBills = /supplier bill|supplier bills|payable|accounts payable|vendor bill|供应商.*账单|供應商.*帳單|供应商.*欠款|供應商.*欠款/.test(normalized);
  const appointments = /appointment|appointments|booking|bookings|no-show|no show|预约|預約|约会|約會|爽约|爽約/.test(normalized);
  const payments = /payment|payments|collected|collection|cash|card|duitnow|bank transfer|收到.*钱|收到.*錢|收款|付款方式/.test(normalized);
  const expenses = /expense|expenses|spend|spending|operating balance|cost|花了|开销|開銷|支出|费用|費用|营运余额|營運餘額/.test(normalized);
  const sales = /sales|sell|sold|revenue|transaction|average sale|生意|销售|銷售|营业额|營業額|交易|客单|客單/.test(normalized);
  const profit = /profit|利润|利潤|盈利|赚了|賺了/.test(normalized);
  const branchComparison = /branch|store|分店|门店|門店/.test(normalized);
  const general = /overall|business.*doing|attention today|summary|整体|整體|情况|情況|需要.*注意/.test(normalized);

  if (forecast) return result("UNSUPPORTED", language, "PERIOD", "HIGH");
  if (people) return result("PEOPLE", language, peoplePeriodQuestion(normalized) ? "PERIOD" : "SNAPSHOT", "HIGH");
  if (supplierBills) return result("SUPPLIER_BILLS", language, supplierBillPeriodQuestion(normalized) ? "PERIOD" : "SNAPSHOT", "HIGH");
  if (inventory) return result("INVENTORY", language, inventoryPeriodQuestion(normalized) ? "PERIOD" : "SNAPSHOT", "HIGH");
  if (appointments) return result("APPOINTMENTS", language, "PERIOD", "HIGH");
  if (profit) return result("GENERAL_BUSINESS", language, "PERIOD", "HIGH");
  if (sales && expenses) return result("GENERAL_BUSINESS", language, "PERIOD", "HIGH");
  if (payments) return result("PAYMENTS", language, "PERIOD", "HIGH");
  if (expenses) return result("EXPENSES", language, "PERIOD", "HIGH");
  if (sales) return result("SALES", language, "PERIOD", "HIGH");
  if (branchComparison) return result("SALES", language, "PERIOD", "MEDIUM");
  if (general) return result("GENERAL_BUSINESS", language, "PERIOD", "MEDIUM");
  return result("UNSUPPORTED", language, "PERIOD", "MEDIUM");
}

export function detectAiQuestionLanguage(question: string): AiAnswerLanguage {
  const chineseCharacters = question.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = question.match(/[a-z]+/gi)?.length ?? 0;
  return chineseCharacters > 0 && chineseCharacters >= latinWords ? "zh" : "en";
}

export function isAiIntent(value: unknown): value is AiIntent {
  return typeof value === "string" && (AI_INTENTS as readonly string[]).includes(value);
}

function peoplePeriodQuestion(question: string) {
  return /join|joined|hire|hired|start|started|leave|left|terminate|入职|入職|新员工|新員工|离职|離職/.test(question);
}

function inventoryPeriodQuestion(question: string) {
  return /sold|fastest|movement|used|this month|本月|这个月|這個月|卖得|賣得/.test(question);
}

function supplierBillPeriodQuestion(question: string) {
  return /paid|settled|payment|this month|本月|这个月|這個月|已付|支付/.test(question);
}

function result(intent: AiIntent, language: AiAnswerLanguage, temporalSemantics: AiTemporalSemantics, confidence: "HIGH" | "MEDIUM") {
  return { intent, language, temporalSemantics, confidence } satisfies AiIntentClassification;
}
