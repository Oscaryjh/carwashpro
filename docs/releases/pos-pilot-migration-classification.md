# TETAMU POS Pilot migration classification

- Exact source base: `c48fb152631646da4a7f98dca16e5f8fbc93c40a`
- Ordered migration directories: **213**
- Production historical prefix: **51**, ending at `20260711143000_scope_whatsapp_message_ids_by_business`
- Proposed Phase 1 candidate baseline: **213**. This is not because every later feature is in Pilot scope. It is because Prisma deploy consumes the canonical ordered history and the exact candidate schema/call sites depend on the later shared chain; selecting a sparse subset would create an unsafe migration fork. Frozen-domain structures remain dormant and hard-denied.

## Complete ordered classification

| # | Migration | Classification | Reason |
|---:|---|---|---|
| 1 | `20260624143000_init_multitenant` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 2 | `20260624160000_add_crm_customers_vehicles` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 3 | `20260624160747_align_schema` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 4 | `20260624170000_add_services_work_orders` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 5 | `20260624180000_add_pos_payments_invoices` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 6 | `20260624190000_add_whatsapp_messages` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 7 | `20260625100000_add_packages` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 8 | `20260625101000_align_package_schema` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 9 | `20260625110000_add_whatsapp_queue_status` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 10 | `20260625120000_add_multi_branch` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 11 | `20260625121000_align_branch_schema` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 12 | `20260626042236_add_vehicle_contact_ownership` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 13 | `20260626122947_add_package_pos_checkout` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 14 | `20260626123030_finish_package_pos_checkout` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 15 | `20260626133338_add_payment_void_status` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 16 | `20260626153700_add_invoice_void_reason` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 17 | `20260627010000_add_business_logo` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 18 | `20260627023000_add_staff_permissions` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 19 | `20260627024500_add_service_category` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 20 | `20260627031000_add_service_category_management` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 21 | `20260627033000_add_business_company_no` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 22 | `20260627034000_add_package_categories` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 23 | `20260628030000_whatsapp_manual_deep_link` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 24 | `20260628031000_align_category_defaults` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 25 | `20260628043000_add_whatsapp_inbox_foundation` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 26 | `20260628170000_add_whatsapp_conversation_remote_jid` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 27 | `20260629122956_sync_whatsapp_inbox_state` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 28 | `20260629161000_add_whatsapp_audio_messages` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 29 | `20260630020000_add_whatsapp_templates` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 30 | `20260630093000_add_whatsapp_document_messages` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 31 | `20260630190318_add_whatsapp_worker_commands` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 32 | `20260701090000_add_whatsapp_phone_pairing` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 33 | `20260702161718_add_notification_queue` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 34 | `20260702162503_add_notification_queue_retry` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 35 | `20260702163856_add_notification_queue_message_log_id` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 36 | `20260703104500_add_whatsapp_inbox_reply_message_type` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 37 | `20260703171315_add_whatsapp_history_sync` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 38 | `20260703191500_add_whatsapp_delivery_status` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 39 | `20260704090000_add_whatsapp_history_sync` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 40 | `20260704091500_restore_notification_queue_provider_message_index` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 41 | `20260708162604_add_cashier_shifts` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 42 | `20260708183000_add_notification_queue_document_attachment` | `SHARED_BUT_REQUIRED` | Production 51-prefix 中已存在；Pilot 不回退或重写既有历史。 |
| 43 | `20260709133000_add_whatsapp_image_messages` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 44 | `20260709151500_add_whatsapp_delivery_read_statuses` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 45 | `20260709165000_add_user_branch_scope` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 46 | `20260709182000_add_work_order_picked_up_at` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 47 | `20260709192000_add_appointments` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 48 | `20260709205000_add_appointment_assigned_staff` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 49 | `20260710162000_add_appointment_service_ids` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 50 | `20260710184500_add_appointment_pickup_contact` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 51 | `20260711143000_scope_whatsapp_message_ids_by_business` | `REQUIRED_FOR_POS_PILOT` | Production 51-prefix 中已存在，且直接支撑 POS/WhatsApp。 |
| 52 | `20260713123000_add_audit_logs` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 53 | `20260713150000_add_appointment_reminders` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 54 | `20260713190000_add_payment_refunds` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 55 | `20260713210000_add_membership_loyalty` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 56 | `20260713220000_harden_payment_refunds` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 57 | `20260713230000_add_vehicle_size_rules` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 58 | `20260713233000_add_package_purchase_invoices` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 59 | `20260716120000_add_business_industry` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 60 | `20260716140000_add_salon_service_foundation` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 61 | `20260716143000_seed_salon_service_categories` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 62 | `20260716150000_allow_customer_only_appointments` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 63 | `20260716151136_add_staff_availability` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 64 | `20260716162000_add_salon_appointment_service_statuses` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 65 | `20260716173000_add_salon_appointment_checkout` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 66 | `20260716190000_add_salon_customer_profile_fields` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 67 | `20260716190000_align_vehicle_size_indexes` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 68 | `20260716210000_add_appointment_duration` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 69 | `20260716223000_add_appointment_reminder_settings` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 70 | `20260717033518_add_staff_login_access` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 71 | `20260717033950_allow_staff_without_login` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 72 | `20260717040305_add_cross_industry_employee_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 73 | `20260717150000_add_salon_invoice_adjustments` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 74 | `20260717180000_add_supported_business_industries` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 75 | `20260718074146_add_credit_notes` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 76 | `20260718090000_scope_whatsapp_templates_by_industry` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 77 | `20260718140000_add_business_sst_settings` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 78 | `20260718170000_add_sst_invoice_snapshots` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 79 | `20260719120000_add_products_and_inventory` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 80 | `20260719123000_add_product_category_management` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 81 | `20260719190000_add_invoice_item_customer_package` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 82 | `20260720173000_add_loyalty_redemption_and_invoice_discount` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 83 | `20260720223000_add_appointment_sale_items` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 84 | `20260721090000_add_multi_service_package_benefits` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 85 | `20260721153000_add_customer_date_of_birth` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 86 | `20260721170000_add_user_appointment_bookable` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 87 | `20260721183000_add_catalog_discounts` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 88 | `20260721193000_add_fixed_catalog_discounts` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 89 | `20260722143000_add_staff_roles_and_levels` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 90 | `20260723120000_add_daily_closing_snapshots` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 91 | `20260723130000_reconcile_product_uuid_defaults` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 92 | `20260724100000_add_closing_whatsapp_automation` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 93 | `20260726190000_add_business_day_cutoff_time` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 94 | `20260727100000_add_business_groups` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 95 | `20260727130000_add_business_time_settings` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 96 | `20260729130000_add_business_group_logo` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 97 | `20260729143000_enforce_group_membership_history` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 98 | `20260729170000_create_analytics_daily_summaries` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 99 | `20260730100000_create_analytics_refresh_checkpoint` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 100 | `20260730110000_harden_analytics_refresh_worker` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 101 | `20260730130000_attendance_phase_1a_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 102 | `20260730133000_attendance_phase_1a_guard_hardening` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 103 | `20260730170000_attendance_assignment_history` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 104 | `20260730183000_attendance_phase_1c_auth_and_idempotency` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 105 | `20260730193000_attendance_phase_1c_compatibility_hardening` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 106 | `20260730210000_team_people_unification` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 107 | `20260731110000_attendance_operations_completion` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 108 | `20260731111500_attendance_branch_guard_order` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 109 | `20260731130000_attendance_work_break_pay_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 110 | `20260731160000_payroll_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 111 | `20260731170000_payroll_trigger_fix` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 112 | `20260731180000_statutory_contribution_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 113 | `20260801090000_payroll_review_status` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 114 | `20260801090500_payroll_review_release` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 115 | `20260801130000_statutory_submission_center` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 116 | `20260801170000_leave_management_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 117 | `20260802170000_statutory_export_artifact_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 118 | `20260802171000_statutory_artifact_identity_guard` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 119 | `20260803100000_compensation_version_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 120 | `20260803103000_compensation_version_entry_scope` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 121 | `20260803130000_payroll_profile_canonical_write` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 122 | `20260803170000_attendance_resolution_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 123 | `20260803190000_attendance_resolution_workflow` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 124 | `20260803193000_attendance_resolution_gap_hardening` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 125 | `20260803193100_attendance_resolution_gap_guards` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 126 | `20260803210000_attendance_monthly_timesheet_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 127 | `20260803230000_attendance_payroll_timesheet_bridge` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 128 | `20260804120000_payment_integrity_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 129 | `20260808120000_payroll_p4a_recurring_pay_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 130 | `20260808150000_payroll_p4b_component_calculation_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 131 | `20260808180000_payroll_p4c_variable_pay_correction_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 132 | `20260808210000_payroll_p4d_payslip_publication` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 133 | `20260808225000_attendance_timesheet_approved_status` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 134 | `20260808230000_attendance_p2_resolution_workflow` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 135 | `20260808234000_payroll_p5_attendance_integration` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 136 | `20260809010000_statutory_p2_calculation_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 137 | `20260809040000_statutory_p2b_artifact_verification_pipeline` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 138 | `20260809070000_statutory_p2c_certification_activation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 139 | `20260809100000_statutory_component_reconciliation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 140 | `20260809130000_lindung24_participation_closure` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 141 | `20260809160000_pos_financial_idempotency` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 142 | `20260809190000_login_authentication_security_hardening` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 143 | `20260809220000_whatsapp_testing_hardening` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 144 | `20260810010000_leave_management_final_closure` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 145 | `20260810030000_business_module_feature_entitlement_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 146 | `20260810060000_simple_invoice_number` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 147 | `20260810090000_claims_reimbursements_final_closure` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 148 | `20260810143000_statutory_human_signoff_activation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 149 | `20260810170000_statutory_human_governance_closure` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 150 | `20260810190000_sensitive_action_step_up_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 151 | `20260810220000_true_mfa_totp_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 152 | `20260810223000_true_mfa_enrollment_session_lifecycle` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 153 | `20260810233000_commission_engine_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 154 | `20260810234000_commission_tenant_scope_guards` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 155 | `20260811010000_commission_rate_guard` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 156 | `20260811013000_commission_void_idempotency` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 157 | `20260811120000_inventory_phase1_core_stock_foundation` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 158 | `20260811123000_inventory_movement_lookup_guards` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 159 | `20260811160000_inventory_phase2_purchasing_foundation` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 160 | `20260811190000_inventory_phase3_stock_count_reorder` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 161 | `20260811210000_expense_phase1_business_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 162 | `20260811233000_expense_phase2a_claims_payroll_integration` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 163 | `20260811234000_expense_phase2a_payroll_claim_reconciliation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 164 | `20260811235000_expense_phase2a_snapshot_immutability` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 165 | `20260812010000_roster_shift_scheduling_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 166 | `20260812020000_supplier_bill_accounts_payable_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 167 | `20260812050000_expense_phase2b_inventory_purchase` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 168 | `20260812070000_ai_business_analysis_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 169 | `20260812100000_ai_usage_quota_commercial_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 170 | `20260812150000_commercial_pricing_foundation_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 171 | `20260812180000_subscription_billing_payment_foundation_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 172 | `20260813120000_staff_app_twilio_verify_sms` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 173 | `20260813121000_staff_otp_provider_reference_reuse` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 174 | `20260814070000_expense_document_autofill` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 175 | `20260814120000_expense_reporting_settlement` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 176 | `20260814121000_expense_partial_payment_constraint` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 177 | `20260814122000_expense_partial_payment_summary_constraint` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 178 | `20260814130000_expense_pos_drawer_payouts` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 179 | `20260814150000_roster_shift_templates_phase1` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 180 | `20260815100000_business_payment_methods` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 181 | `20260815113000_training_complimentary_checkout` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 182 | `20260815150000_payment_currency_asset` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 183 | `20260815160000_automatic_product_sku` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 184 | `20260815170000_roster_employee_default_schedule` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 185 | `20260817110000_configurable_hr_two_level_approvals` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 186 | `20260817140000_public_holiday_foundation` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 187 | `20260817190000_payroll_holiday_pay_policy` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 188 | `20260817200000_custom_leave_types` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 189 | `20260817223000_leave_management_phase2a` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 190 | `20260817233000_leave_management_phase2b` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 191 | `20260817235900_leave_management_phase2c_sabah_statutory_rule_pack` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 192 | `20260818143000_leave_management_phase2d_payroll_handoff` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 193 | `20260818170000_leave_management_phase2e_supporting_documents` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 194 | `20260818190000_attendance_payroll_context_hardening` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 195 | `20260818220000_attendance_overtime_approval` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 196 | `20260818233000_payroll_p6b_cross_midnight_segmentation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 197 | `20260819090000_payroll_p6c_sabah_work_pay` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 198 | `20260819153000_employee_membership_avatar` | `REQUIRED_FOR_POS_PILOT` | 直接支撑 Pilot POS、CRM、finance、closing、inventory 或 WhatsApp 能力。 |
| 199 | `20260819190000_employee_commission_override` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 200 | `20260819220000_employee_item_commission_override` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 201 | `20260820110000_employee_working_days_override` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 202 | `20260820111500_employee_working_days_guard` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 203 | `20260820130000_company_work_pay_rules` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 204 | `20260821090000_mfa_disabled_authorization` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 205 | `20260821143000_employee_pcb_profile` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 206 | `20260821153000_statutory_additional_remuneration_review_decision` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 207 | `20260821170000_pcb_cp38_engineering_closure` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 208 | `20260824190000_staff_app_sms123_otp` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 209 | `20260826173000_non_production_statutory_fixture_evidence_facility` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 210 | `20260827153000_pcb_2026_p1_correctness_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 211 | `20260827170000_effective_dated_statutory_participation` | `FROZEN_DOMAIN_NOT_REQUIRED` | 该功能不属于 POS Pilot；结构仅因 canonical 有序 migration 线保留，runtime hard deny。 |
| 212 | `20260829110000_canonical_staff_app_appearance` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |
| 213 | `20260902120000_staff_otp_forward_hardening` | `SHARED_BUT_REQUIRED` | 共享 auth/RBAC/staff/tenant/security 或有序 schema 依赖，不能安全跳过。 |

## Destructive or tightening semantic review

The following list is based on SQL semantics, not keyword approval. A `TRUNCATE` token used only to create a rejecting trigger is explicitly identified as non-destructive.

| Migration | Domain classification | Real effect and risk disposition |
|---|---|---|
| `20260628030000_whatsapp_manual_deep_link` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 把旧 WhatsApp status enum 映射到新 enum 后删除旧 type；旧 SENT/DELIVERED/READ 被不可逆归并为 SENT_MANUALLY，FAILED 归并为 CANCELLED。需要 backup rehearsal 与映射计数核对。 |
| `20260704090000_add_whatsapp_history_sync` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 以 business+instance+phone 唯一键替换旧 business+phone 约束，并新增 external message 唯一键；不删除行，但若现存重复会阻塞建索引。 |
| `20260711143000_scope_whatsapp_message_ids_by_business` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 把 external message 唯一键扩大到 business scope；不删数据，先 drop 旧 index 再建新 index，失败窗口需由受控 migration 处理。 |
| `20260718090000_scope_whatsapp_templates_by_industry` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 新增带默认值的 NOT NULL industry，并以 industry 维度替换模板唯一索引；数据保留，重复组合会阻塞新索引。 |
| `20260727130000_add_business_time_settings` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 验证/回填 timezone 与 business-day cutoff 后收紧为 NOT NULL；直接影响 Daily Closing 日界线，必须在 rehearsal 核对无空值和格式异常。 |
| `20260730130000_attendance_phase_1a_foundation` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 转换 membership/attendance enums、规范化手机号并回填多列后 SET NOT NULL；不可逆 enum 归并与数据收紧，虽属共享员工结构仍需逐表计数核对。 |
| `20260730133000_attendance_phase_1a_guard_hardening` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 所有 TRUNCATE 命中均是 BEFORE TRUNCATE 拒绝触发器，不执行 truncate；属于保护性强化，无数据删除。 |
| `20260730170000_attendance_assignment_history` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 删除旧唯一索引以允许历史 assignment，再建普通索引；不删行，但约束放宽改变重复语义。 |
| `20260801090500_payroll_review_release` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 先回填 finalized run 的 review 字段，再替换 lifecycle CHECK；冻结域结构，不删数据，但不合规旧行会阻塞。 |
| `20260802170000_statutory_export_artifact_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 转换 statutory submission enum、放宽部分非空列并替换唯一索引；冻结域，不删行，enum cast 与新 revision 唯一性需 rehearsal。 |
| `20260803103000_compensation_version_entry_scope` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 以 tenant-scoped composite FK 替换单列 FK；冻结域，不删行，跨 business 旧引用会阻塞。 |
| `20260803170000_attendance_resolution_foundation` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中为不可变性拒绝触发器；其余为 additive 表和 legacy backfill，不执行数据清空。 |
| `20260803190000_attendance_resolution_workflow` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中为 append-only 拒绝触发器；保留历史并回填 workflow records。 |
| `20260803193100_attendance_resolution_gap_guards` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 actor CHECK 并新增 update/delete/truncate 拒绝触发器；不清空数据，旧 actor 组合需先满足新 CHECK。 |
| `20260803210000_attendance_monthly_timesheet_foundation` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中全部为不可变性保护触发器；不执行 truncate。 |
| `20260804120000_payment_integrity_foundation` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中全部位于 payroll bank/payment append-only 拒绝触发器；不会清空数据，但冻结域表结构加入共享线。 |
| `20260808150000_payroll_p4b_component_calculation_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中为 payroll component append-only 拒绝触发器；不执行 truncate。 |
| `20260808180000_payroll_p4c_variable_pay_correction_foundation` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中为 variable-pay/correction 不可变性拒绝触发器；不执行 truncate。 |
| `20260808230000_attendance_p2_resolution_workflow` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 timesheet state CHECK 并新增多组 append-only truncate guard；不清空数据，旧 timesheet 状态须满足新 evidence CHECK。 |
| `20260808234000_payroll_p5_attendance_integration` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | TRUNCATE 命中为 payroll attendance snapshot 拒绝触发器；不执行 truncate。 |
| `20260810010000_leave_management_final_closure` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 先从 policy/version 和 request day 回填，再对 policy/treatment/balance 列 SET NOT NULL；空或无匹配旧行会阻塞。 |
| `20260810220000_true_mfa_totp_foundation` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 sensitive-action verification method CHECK；不删数据，新增允许值且旧值须符合新集合。 |
| `20260810223000_true_mfa_enrollment_session_lifecycle` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 主动把 ACTIVE/REVOKED enrollment_session_id 清空并替换状态 CHECK/FK；是有意且不可逆的状态规范化。 |
| `20260811010000_commission_rate_guard` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 commission rate CHECK 并收紧百分比上限；不删数据，超限旧规则会阻塞。 |
| `20260811120000_inventory_phase1_core_stock_foundation` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 以 tenant-scoped composite FK 替换 stock 的单列 FK；POS inventory 需要，跨 tenant 错误引用会阻塞而不会被删除。 |
| `20260812050000_expense_phase2b_inventory_purchase` | `REQUIRED_FOR_POS_PILOT` / `REQUIRES_MANUAL_REVIEW` | 替换 expense integration CHECK/index 以纳入 inventory purchase；不删数据，现存行必须符合新 source/category 约束。 |
| `20260813120000_staff_app_twilio_verify_sms` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 放宽 otp_hash 可空并替换 provider CHECK；不删 challenge，改变 provider lifecycle 约束。 |
| `20260813121000_staff_otp_provider_reference_reuse` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 把 provider reference 唯一索引替换为普通条件索引以允许 provider SID 重用；不删数据但放宽唯一性。 |
| `20260814120000_expense_reporting_settlement` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 回填后将 amount/payment_source SET NOT NULL，并替换状态 CHECK/index；旧空值或不合规状态会阻塞。 |
| `20260814121000_expense_partial_payment_constraint` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 expense payment CHECK 以允许 partial 状态；不删数据，旧行须满足新组合。 |
| `20260814122000_expense_partial_payment_summary_constraint` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 再次替换 expense payment CHECK 修正 summary 语义；不删数据，旧行须满足新组合。 |
| `20260815170000_roster_employee_default_schedule` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 回填 roster resolved_source 后 SET NOT NULL，并调整 index；无匹配来源的旧 assignment 会阻塞。 |
| `20260817200000_custom_leave_types` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 把 enum code 转成 VARCHAR 后删除 enum type；值保留但类型变更不可逆。 |
| `20260817235900_leave_management_phase2c_sabah_statutory_rule_pack` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 先以明确 legacy marker 回填 statutory_section，再 SET NOT NULL；保留行但产生需后续人工确认的来源标记。 |
| `20260821090000_mfa_disabled_authorization` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 sensitive-action method CHECK 以加入 disabled path；不删数据，但必须由 runtime policy 保证 Production 不滥用。 |
| `20260824190000_staff_app_sms123_otp` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 OTP provider CHECK 以纳入 SMS123 并兼容旧 mock row；不删数据，provider tuple 必须满足新约束。 |
| `20260826173000_non_production_statutory_fixture_evidence_facility` | `FROZEN_DOMAIN_NOT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 放宽两个 evidence source 列并新增明确 provenance/eligibility 列；不删数据，但 Production runtime 必须拒绝 synthetic provenance。 |
| `20260902120000_staff_otp_forward_hardening` | `SHARED_BUT_REQUIRED` / `REQUIRES_MANUAL_REVIEW` | 替换 provider message code CHECK；不删数据，非空 code 必须同时有 provider reference 和 accepted timestamp。 |

## Gate conclusion

Static semantics are classified, but Production execution is **not approved**. Phase 2 must restore a fresh Production backup into a local disposable PostgreSQL instance and rehearse the exact 51→213 chain with pre/post row counts, constraint validation, POS financial regression, and rollback evidence. No sparse migration selection, history rewrite, or fork is approved.

