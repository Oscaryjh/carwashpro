CREATE INDEX "vehicle_model_size_defaults_size_idx"
ON "vehicle_model_size_defaults"("size");

CREATE INDEX "vehicles_business_id_size_idx"
ON "vehicles"("business_id", "size");
