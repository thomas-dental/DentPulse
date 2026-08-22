# Dentally API Reference — Node Sync Process

> Auto-generated documentation for all Dentally API endpoints used by the DentPulse Node sync engine.
> Base URL: `https://api.dentally.co`

---

## Table of Contents

1. [Authentication](#authentication)
2. [Common Parameters](#common-parameters)
3. [Sync Order & Architecture](#sync-order--architecture)
4. [API 1: Sites (Locations)](#api-1-sites-locations)
5. [API 2: Treatment Categories](#api-2-treatment-categories)
6. [API 3: Payment Plans](#api-3-payment-plans)
7. [API 4: Treatments](#api-4-treatments)
8. [API 5: Practitioners](#api-5-practitioners)
9. [API 6: Patients](#api-6-patients)
10. [API 6b: Accounts](#api-6b-accounts)
11. [API 7: Treatment Plans](#api-7-treatment-plans)
11. [API 8: Treatment Plan Items](#api-8-treatment-plan-items)
12. [API 9: Treatment Appointments](#api-9-treatment-appointments)
13. [API 10: Appointments](#api-10-appointments)
14. [API 11: Invoices (List)](#api-11-invoices-list)
15. [API 12: Invoice Detail](#api-12-invoice-detail)
16. [API 13: NHS Claims (Disabled)](#api-13-nhs-claims-disabled)
17. [Rate Limiting](#rate-limiting)
18. [Monthly Chunking](#monthly-chunking)

---

## Authentication

All requests use Bearer token authentication.

```
Authorization: Bearer {DENTALLY_API_KEY}
User-Agent: DentPulse/1.0
Content-Type: application/json
```

---

## Common Parameters

Every paginated list endpoint accepts:

| Parameter  | Type    | Default | Description                    |
|------------|---------|---------|--------------------------------|
| `page`     | Integer | 1       | Page number (1-indexed)        |
| `per_page` | Integer | 100     | Records per page (max 100)     |

**Response pagination metadata:**
```json
{
  "meta": {
    "total_pages": 15
  },
  "<entity_key>": [ ... ]
}
```

---

## Sync Order & Architecture

Entities are synced sequentially by priority. Non-date entities fetch all records at once. Date-filterable entities are split into monthly chunks.

| Priority | Entity                | Type      | Depends On        |
|----------|-----------------------|-----------|-------------------|
| 1        | locations             | Non-date  | -                 |
| 2        | treatment_category    | Non-date  | -                 |
| 3        | payment_plans         | Non-date  | locations         |
| 4        | treatments            | Non-date  | treatment_category|
| 5        | practitioners         | Non-date  | -                 |
| 6        | patients              | Date      | locations         |
| 6        | accounts              | Non-date  | locations         |
| 7        | treatment_plans       | Date      | locations         |
| 8        | treatment_plan_items  | Date      | locations         |
| 9        | treatment_appointments| Date      | locations         |
| 10       | appointments          | Date      | locations         |
| 11       | invoices              | Date      | locations         |
| 12       | nhs_claims (disabled) | Date      | locations         |

---

## API 1: Sites (Locations)

### Endpoint

```
GET /v1/sites
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all sites at once.

### Example Request

```
GET /v1/sites?page=1&per_page=100
```

### Response Key

```json
{ "sites": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field | DB Column (`practice_locations`) | Transform        |
|--------------------|----------------------------------|------------------|
| `id`               | `api_record_unique_id`           | `String()`       |
| `name`             | `location_name`                  | Fallback: name → nickname → 'Practice Location' |
| `nickname`         | `location_code`                  | Direct           |
| `address_line_1`   | `address_line1`                  | Direct           |
| `address_line_2`   | `address_line2`                  | Direct           |
| `town`             | `city`                           | Direct           |
| `county`           | `state`                          | Direct           |
| `postcode`         | `postal_code`                    | Direct           |
| `phone_number`     | `phone`                          | `truncate(20)`   |
| `email_address`    | `email`                          | `truncate(255)`  |
| `active`           | `is_active`                      | `!== false`      |
| `website`          | `notes`                          | `"Website: {value}"` |
| —                  | `is_primary`                     | Always `false`   |
| —                  | `organization_id`                | From context     |
| —                  | `user_id`                        | From context     |

### Upsert Strategy

Check-then-insert/update by `organization_id` + `api_record_unique_id` (no DB unique constraint on this column).

---

## API 2: Treatment Categories

### Endpoint

```
GET /v1/treatment_categories
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all categories at once.

### Example Request

```
GET /v1/treatment_categories?page=1&per_page=100
```

### Response Key

```json
{ "treatment_categories": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field | DB Column (`treatment_categories`) | Transform    |
|--------------------|-------------------------------------|-------------|
| `id`               | `external_id`                       | Direct      |
| `name`             | `name`                              | Fallback: 'Unknown Category' |
| `description`      | `description`                       | Direct      |
| `display_order`    | `display_order`                     | Default: `0` |
| —                  | `organization_id`                   | From context |
| —                  | `user_id`                           | From context |

### Upsert Strategy

`ON CONFLICT (organization_id, external_id)`

---

## API 3: Payment Plans

### Endpoint

```
GET /v1/payment_plans
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all payment plans at once.

### Example Request

```
GET /v1/payment_plans?page=1&per_page=100
```

### Response Key

```json
{ "payment_plans": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field             | DB Column (`payment_plans`)      | Transform                    |
|-------------------------------|----------------------------------|------------------------------|
| `id`                          | `pp_id`                          | Direct                       |
| `name`                        | `pp_name`                        | Direct                       |
| `active`                      | `pp_is_active`                   | Direct                       |
| `site_id`                     | `location_id`                    | `mapSiteIdToLocationId()`    |
| `site_id`                     | `pp_site_id`                     | `mapSiteIdToLocationId()`    |
| `dentist_recall_interval`     | `pp_dentist_recall_interval`     | Direct                       |
| `emergency_duration`          | `pp_emergency_duration`          | Direct                       |
| `exam_appointments_included`  | `pp_exam_appointments_included`  | Direct                       |
| `exam_duration`               | `pp_exam_duration`               | Direct                       |
| `exam_scale_and_polish_duration` | `pp_exam_scale_and_polish_duration` | Direct                |
| `hygiene_appointments_included` | `pp_hygiene_appointments_included` | Direct                  |
| `hygienist_recall_interval`   | `pp_hygienist_recall_interval`   | Direct                       |
| `monthly_memberhsip_fee`      | `pp_monthly_memberhsip_fee`      | `parseFloat()`               |
| `patient_friendly_name`       | `pp_patient_friendly_name`       | Direct                       |
| `recall_method`               | `pp_recall_method`               | Direct                       |
| `scale_and_polish_duration`   | `pp_scale_and_polish_duration`   | Direct                       |
| `colour`                      | `pp_colour`                      | Direct                       |
| `created_at`                  | `pp_created_at`                  | Direct                       |
| —                             | `organization_id`                | From context                 |
| —                             | `user_id`                        | From context                 |

### Upsert Strategy

`ON CONFLICT (organization_id, pp_id)`

---

## API 4: Treatments

### Endpoint

```
GET /v1/treatments
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all treatments at once.

### Example Request

```
GET /v1/treatments?page=1&per_page=100
```

### Response Key

```json
{ "treatments": [ ... ] }
```

### Pre-requisite

Requires **category map** pre-loaded from `treatment_categories` table:
`Dentally category_id (external_id) → DB category UUID (id)`

### API Response Fields → DB Mapping

| Dentally API Field         | DB Column (`treatments`)     | Transform                                      |
|---------------------------|------------------------------|------------------------------------------------|
| `id`                      | `external_id`                | Direct                                         |
| `treatment_category_id`   | `category_id`                | Lookup via categoryMap (type-safe: number + string) |
| `nomenclature`            | `treatment_name`             | Fallback: nomenclature → description → patient_nomenclature → 'Treatment' |
| `code`                    | `treatment_code`             | Direct                                         |
| `description`             | `description`                | Fallback: description → patient_description    |
| `nhs_treatment_cat`       | `treatment_type`             | `nhs_treatment_cat ? 'nhs' : 'private'`        |
| `uda_band`                | `nhs_band`                   | `mapNhsBand()` — see mapping table below       |
| `active`                  | `is_active`                  | `!== false`                                    |
| `insurance_classification`| `insurance_classification`   | Direct                                         |
| `nhs_treatment_cat`       | `nhs_treatment_cat`          | Direct                                         |
| `nomenclature`            | `nomenclature`               | Direct                                         |
| `owner`                   | `owner`                      | Direct                                         |
| `patient_description`     | `patient_description`        | Direct                                         |
| `patient_nomenclature`    | `patient_nomenclature`       | Direct                                         |
| `region`                  | `region`                     | Direct                                         |
| `uda_band`                | `uda_band`                   | Direct (raw value preserved)                   |
| —                         | `price`                      | Always `0`                                     |
| —                         | `organization_id`            | From context                                   |
| —                         | `user_id`                    | From context                                   |

### NHS Band Mapping (`mapNhsBand`)

| Dentally `uda_band` Value | DB `nhs_band` Value | Rule                        |
|---------------------------|--------------------|-----------------------------|
| `"Band 1"`               | `'Band 1'`         | Direct match                |
| `"Band 2"`               | `'Band 2'`         | Direct match                |
| `"Band 3"`               | `'Band 3'`         | Direct match                |
| `0` — `1.49`             | `'Band 1'`         | Numeric: `>= 0 && < 1.5`   |
| `1.5` — `2.49`           | `'Band 2'`         | Numeric: `>= 1.5 && < 2.5` |
| `2.5+`                   | `'Band 3'`         | Numeric: `>= 2.5`          |
| `null` / empty            | `null`             | No mapping                  |
| Unrecognized              | `null`             | Avoid CHECK constraint violation |

> **DB CHECK constraint:** `nhs_band IS NULL OR nhs_band IN ('Band 1', 'Band 2', 'Band 3')`

### Upsert Strategy

`ON CONFLICT (organization_id, external_id)`

---

## API 5: Practitioners

### Endpoint

```
GET /v1/practitioners
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all practitioners at once.

### Example Request

```
GET /v1/practitioners?page=1&per_page=100
```

### Response Key

```json
{ "practitioners": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field     | DB Column (`providers`)    | Transform                             |
|------------------------|---------------------------|---------------------------------------|
| `id`                   | `external_id`             | Direct                                |
| `user.first_name`      | `name`                    | `"{first_name} {last_name}"` or 'Provider' |
| `user.last_name`       | `name`                    | (combined with first_name)            |
| `user.email`           | `email`                   | Direct                                |
| `user.mobile_phone`    | `phone`                   | Direct                                |
| `user.image_url`       | `photo_url`               | Direct                                |
| `user.role`            | `provider_role`           | Direct                                |
| `user.created_at`      | `joining_date`            | Fallback: user.created_at → created_at |
| `active`               | `is_active`               | `!== false`                           |
| `gdc_number`           | `gdc_number`              | Direct                                |
| `nhs_number`           | `nhs_number`              | Direct                                |
| `uda_target`           | `uda_target`              | Direct                                |
| `uoa_target`           | `uoa_target`              | Direct                                |
| —                      | `revenue`                 | Always `0`                            |
| —                      | `patients`                | Always `0`                            |
| —                      | `avg_rev_per_patient`     | Always `0`                            |
| —                      | `utilisation`             | Always `0`                            |
| —                      | `trend`                   | Always `0`                            |
| —                      | `organization_id`         | From context                          |
| —                      | `user_id`                 | From context                          |

### Upsert Strategy

`ON CONFLICT (organization_id, external_id)`

---

## API 6: Patients

### Endpoint

```
GET /v1/patients
```

### Request Parameters

| Parameter        | Value        | Description                              |
|------------------|--------------|------------------------------------------|
| `page`           | 1..N         | Page number                              |
| `per_page`       | 100          | Records per page                         |
| `created_after`  | `YYYY-MM-DD` | Only patients created after this date    |
| `created_before` | `YYYY-MM-DD` | Only patients created before this date   |
| `sort_by`        | `created_at` | Sort results by creation date            |

### Example Request

```
GET /v1/patients?page=1&per_page=100&created_after=2026-01-01&created_before=2026-01-31&sort_by=created_at
```

### Response Key

```json
{ "patients": [ ... ] }
```

### Pre-requisite

Requires **location map** pre-loaded from `practice_locations` table:
`Dentally site_id (api_record_unique_id) → DB location UUID (id)`

### API Response Fields → DB Mapping

| Dentally API Field                 | DB Column (`patients`)                 | Transform                  |
|------------------------------------|----------------------------------------|----------------------------|
| `uuid`                             | `pt_unique_id`                         | `parseUuid()`              |
| `id`                               | `pt_id`                                | `parseBigInt()`            |
| `account_id`                       | `pt_account_id`                        | `String()`                 |
| `active`                           | `is_active`                            | `!== false`                |
| `title`                            | `pt_title`                             | `truncate(50)`             |
| `first_name`                       | `pt_first_name`                        | `truncate(255)`            |
| `middle_name`                      | `pt_middle_name`                       | `truncate(255)`            |
| `last_name`                        | `pt_last_name`                         | `truncate(255)`            |
| `site_id`                          | `location_id`                          | `mapSiteIdToLocationId()`  |
| `site_id`                          | `pt_site_id`                           | `parseUuid()` (raw UUID)   |
| `address_line_1`                   | `pt_address_line_1`                    | `truncate(255)`            |
| `address_line_2`                   | `pt_address_line_2`                    | `truncate(255)`            |
| `address_line_3`                   | `pt_address_line_3`                    | `truncate(255)`            |
| `county`                           | `pt_county`                            | `truncate(255)`            |
| `date_of_birth`                    | `pt_dob`                               | Direct                     |
| `dentist_id`                       | `pt_dentist_id`                        | `parseBigInt()`            |
| `dentist_recall_date`              | `pt_dentist_recall_date`               | Direct                     |
| `dentist_recall_interval`          | `pt_dentist_recall_interval`           | Direct                     |
| `doctor_id`                        | `pt_doctor_id`                         | `parseBigInt()`            |
| `email`                            | `pt_email`                             | `truncate(255)`            |
| `family_id`                        | `pt_family_id`                         | `parseBigInt()`            |
| `gender`                           | `pt_gender`                            | `truncate(50)`             |
| `image_url`                        | `pt_image_url`                         | Direct                     |
| `is_student`                       | `pt_is_student`                        | Default: `false`           |
| `mobile_phone`                     | `pt_mobile_phone`                      | `truncate(50)`             |
| `payment_plan_id`                  | `pt_payment_plan_id`                   | `parseBigInt()`            |
| `payment_plan_subscription_id`     | `pt_payment_plan_subscription_id`      | `String()`                 |
| `payment_plan_subscription_status` | `pt_payment_plan_subscription_status`  | `truncate(100)`            |
| `postcode`                         | `pt_postcode`                          | `truncate(20)`             |
| `region`                           | `pt_region`                            | `truncate(255)`            |
| `town`                             | `pt_town`                              | `truncate(255)`            |
| `created_at`                       | `pt_created_at`                        | Direct                     |
| `updated_at`                       | `pt_updated_at`                        | Direct                     |
| —                                  | `organization_id`                      | From context               |
| —                                  | `user_id`                              | From context               |

### Upsert Strategy

`ON CONFLICT (organization_id, pt_unique_id)`

---

## API 6b: Accounts

### Endpoint

```
GET /v1/accounts
```

### Request Parameters

| Parameter  | Value | Description          |
|------------|-------|----------------------|
| `page`     | 1..N  | Page number          |
| `per_page` | 100   | Records per page     |

> No date filter — fetches all accounts at once. No site_id in response, so no location map lookup.

### Example Request

```
GET /v1/accounts?page=1&per_page=100
```

### Example Response

```json
{
  "accounts": [
    {
      "id": 64700790,
      "current_balance": "0.0",
      "opening_balance": "0.0",
      "patient_id": 20605,
      "patient_name": "Izzy Gwilliam",
      "planned_nhs_treatment_value": "0.0",
      "planned_private_treatment_value": "0.0"
    }
  ]
}
```

### API Response Fields → DB Mapping

| Dentally API Field                | DB Column (`dentally_patients_accounts`)  | Transform        |
|-----------------------------------|--------------------------------------------|------------------|
| `id`                              | `da_id`                                    | `parseBigInt()`  |
| `patient_id`                      | `da_patient_id`                            | `parseBigInt()`  |
| `patient_name`                    | `da_patient_name`                          | `truncate(510)`  |
| `current_balance`                 | `da_current_balance`                       | `parseFloat()`   |
| `opening_balance`                 | `da_opening_balance`                       | `parseFloat()`   |
| `planned_nhs_treatment_value`     | `da_planned_nhs_treatment_value`           | `parseFloat()`   |
| `planned_private_treatment_value` | `da_planned_private_treatment_value`       | `parseFloat()`   |
| —                                 | `organization_id`                          | From context     |
| —                                 | `user_id`                                  | From context     |
| —                                 | `location_id`                              | Resolved post-sync from `patients.location_id` (API has no site_id) |

### Upsert Strategy

`ON CONFLICT (organization_id, da_id)`. Listed in `NO_SITE_ID_ENTITIES` in `upsert.js` so routing-by-site is skipped.

---

## API 7: Treatment Plans

### Endpoint

```
GET /v1/treatment_plans
```

### Request Parameters

| Parameter       | Value        | Description                                 |
|-----------------|--------------|---------------------------------------------|
| `page`          | 1..N         | Page number                                 |
| `per_page`      | 100          | Records per page                            |
| `created_after` | `YYYY-MM-DD` | Only treatment plans created after this date |
| `sort_by`       | `created_at` | Sort results by creation date               |

> Note: No `created_before` end date filter — only start date used.

### Example Request

```
GET /v1/treatment_plans?page=1&per_page=100&created_after=2026-01-01&sort_by=created_at
```

### Response Key

```json
{ "treatment_plans": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field        | DB Column (`treatment_plans`)    | Transform                   |
|---------------------------|----------------------------------|-----------------------------|
| `id`                      | `tp_id`                          | `parseBigInt()`             |
| `site_id`                 | `location_id`                    | `mapSiteIdToLocationId()`   |
| `nickname`                | `tp_nickname`                    | Direct                      |
| `patient_id`              | `tp_patient_id`                  | `parseBigInt()`             |
| `practitioner_id`         | `tp_practitioner_id`             | `parseBigInt()`             |
| `private_treatment_value` | `tp_private_treatment_value`     | Direct                      |
| `start_date`              | `tp_start_date`                  | Direct                      |
| `completed_at`            | `tp_completed_at`                | Direct                      |
| `completed_at`            | `tp_is_completed`                | `completed_at ? true : false` |
| `end_date`                | `tp_end_date`                    | Direct                      |
| `last_completed_at`       | `tp_last_completed_at`           | Direct                      |
| `created_at`              | `tp_created_at`                  | Direct                      |
| `updated_at`              | `tp_updated_at`                  | Direct                      |
| —                         | `organization_id`                | From context                |
| —                         | `user_id`                        | From context                |

### Upsert Strategy

`ON CONFLICT (organization_id, tp_id)`

---

## API 8: Treatment Plan Items

### Endpoint

```
GET /v1/treatment_plan_items
```

### Request Parameters

| Parameter        | Value        | Description                                    |
|------------------|--------------|------------------------------------------------|
| `page`           | 1..N         | Page number                                    |
| `per_page`       | 100          | Records per page                               |
| `updated_after`  | `YYYY-MM-DD` | Only items updated after this date             |
| `updated_before` | `YYYY-MM-DD` | Only items updated before this date (special)  |
| `sort_by`        | `updated_at` | Sort results by update date                    |

> Note: `updated_before` is added via special handling in code (not from entityConfig `dateFilterEnd`).

### Example Request

```
GET /v1/treatment_plan_items?page=1&per_page=100&updated_after=2026-01-01&sort_by=updated_at&updated_before=2026-01-31
```

### Response Key

```json
{ "treatment_plan_items": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field         | DB Column (`treatment_plan_items`) | Transform                   |
|----------------------------|------------------------------------|-----------------------------|
| `id`                       | `tpi_id`                           | `parseBigInt()`             |
| `site_id`                  | `location_id`                      | `mapSiteIdToLocationId()`   |
| `charged`                  | `tpi_charged`                      | Default: `false`            |
| `completed_at`             | `tpi_completed_at`                 | Direct                      |
| `completed`                | `tpi_completed`                    | Default: `false`            |
| `invoice_id`               | `tpi_invoice_id`                   | `parseBigInt()`             |
| `patient_id`               | `tpi_patient_id`                   | `parseBigInt()`             |
| `patient_nomenclature`     | `tpi_patient_nomenclature`         | Direct                      |
| `payment_plan_id`          | `tpi_payment_plan_id`              | `parseBigInt()`             |
| `practitioner_id`          | `tpi_practitioner_id`              | `parseBigInt()`             |
| `price`                    | `tpi_price`                        | `parseFloat()`              |
| `treatment_appointment_id` | `tpi_treatment_appointment_id`     | `parseBigInt()`             |
| `treatment_plan_id`        | `tpi_treatment_plan_id`            | `parseBigInt()`             |
| `treatment_id`             | `tpi_treatment_id`                 | `parseBigInt()`             |
| `updated_at`               | `tpi_updated_at`                   | Direct                      |
| `duration`                 | `duration`                         | `parseInt()`                |
| `created_at`               | `tpi_created_at`                   | Direct                      |
| —                          | `organization_id`                  | From context                |
| —                          | `user_id`                          | From context                |

### Upsert Strategy

`ON CONFLICT (organization_id, tpi_id)`

---

## API 9: Treatment Appointments

### Endpoint

```
GET /v1/treatment_appointments
```

### Request Parameters

| Parameter       | Value        | Description                                       |
|-----------------|--------------|---------------------------------------------------|
| `page`          | 1..N         | Page number                                       |
| `per_page`      | 100          | Records per page                                  |
| `updated_after` | `YYYY-MM-DD` | Only treatment appointments updated after this date |
| `sort_by`       | `updated_at` | Sort results by update date                       |

> Note: No end date filter — only start date used.

### Example Request

```
GET /v1/treatment_appointments?page=1&per_page=100&updated_after=2026-01-01&sort_by=updated_at
```

### Response Key

```json
{ "treatment_appointments": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field  | DB Column (`treatment_appointments`) | Transform                   |
|---------------------|--------------------------------------|-----------------------------|
| `id`                | `ta_id`                              | `parseBigInt()`             |
| `site_id`           | `location_id`                        | `mapSiteIdToLocationId()`   |
| `appointment_id`    | `ta_appointment_id`                  | `parseBigInt()`             |
| `bookable`          | `ta_bookable`                        | Default: `false`            |
| `patient_id`        | `ta_patient_id`                      | `parseBigInt()`             |
| `treatment_plan_id` | `ta_treatment_plan_id`               | `parseBigInt()`             |
| `created_at`        | `ta_created_at`                      | Direct                      |
| `updated_at`        | `ta_updated_at`                      | Direct                      |
| —                   | `organization_id`                    | From context                |
| —                   | `user_id`                            | From context                |

### Upsert Strategy

`ON CONFLICT (organization_id, ta_id)`

---

## API 10: Appointments

### Endpoint

```
GET /v1/appointments
```

### Request Parameters

| Parameter | Value        | Description                               |
|-----------|--------------|-------------------------------------------|
| `page`    | 1..N         | Page number                               |
| `per_page`| 100          | Records per page                          |
| `after`   | `YYYY-MM-DD` | Only appointments after this date         |
| `before`  | `YYYY-MM-DD` | Only appointments before this date        |
| `sort_by` | `updated_at` | Sort results by update date               |

### Example Request

```
GET /v1/appointments?page=1&per_page=100&after=2026-01-01&before=2026-01-31&sort_by=updated_at
```

### Response Key

```json
{ "appointments": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field                     | DB Column (`appointments`)                   | Transform                   |
|----------------------------------------|----------------------------------------------|-----------------------------|
| `uuid`                                 | `apmt_unique_id`                             | Direct                      |
| `id`                                   | `apmt_id`                                    | Direct                      |
| `site_id` or `practitioner_site_id`    | `location_id`                                | `mapSiteIdToLocationId()`   |
| `practitioner_id`                      | `apmt_practitioner_id`                       | Direct                      |
| `practitioner_name`                    | `apmt_practitioner_name`                     | `truncate(255)`             |
| `practitioner_site_id`                 | `apmt_practitioner_site_id`                  | Direct                      |
| `user_id`                              | `apmt_user_id`                               | Direct                      |
| `arrived_at`                           | `apmt_arrived_at`                            | Direct                      |
| `cancelled_at`                         | `apmt_cancelled_at`                          | Direct                      |
| `completed_at`                         | `apmt_completed_at`                          | Direct                      |
| `confirmed_at`                         | `apmt_confirmed_at`                          | Direct                      |
| `created_at`                           | `apmt_created_at`                            | Direct                      |
| `duration`                             | `apmt_duration`                              | Direct                      |
| `finish_time`                          | `apmt_finish_time`                           | Direct                      |
| `in_surgery_at`                        | `apmt_in_surgery_at`                         | Direct                      |
| `patient_id`                           | `apmt_patient_id`                            | Direct                      |
| `patient_image_url`                    | `apmt_patient_image_url`                     | Direct                      |
| `patient_name`                         | `apmt_patient_name`                          | `truncate(255)`             |
| `payment_plan_id`                      | `apmt_payment_plan_id`                       | Direct                      |
| `pending_at`                           | `apmt_pending_at`                            | Direct                      |
| `reason`                               | `apmt_reason`                                | `truncate(255)`             |
| `start_time`                           | `apmt_start_time`                            | Direct                      |
| `state`                                | `apmt_state`                                 | `truncate(50)`              |
| `treatment_description`               | `apmt_treatment_description`                 | Direct                      |
| `booked_via_api`                       | `apmt_booked_via_api`                        | Default: `false`            |
| `updated_at`                           | `apmt_updated_at`                            | Direct                      |
| `appointment_cancellation_reason_id`   | `apmt_appointment_cancellation_reason_id`    | `parseBigInt()`             |
| `did_not_attend_at`                    | `apmt_did_not_attend_at`                     | Direct                      |
| `notes`                                | `apmt_notes`                                 | Direct                      |
| —                                      | `organization_id`                            | From context                |
| —                                      | `user_id`                                    | From context                |

### Upsert Strategy

Split by UUID presence:
- **With `apmt_unique_id`:** Batch upsert with `ON CONFLICT (organization_id, apmt_unique_id)`
- **Without UUID:** Check-then-insert/update by `organization_id` + `apmt_id` + `apmt_unique_id IS NULL`

---

## API 11: Invoices (List)

### Endpoint

```
GET /v1/invoices
```

### Request Parameters

| Parameter        | Value        | Description                           |
|------------------|--------------|---------------------------------------|
| `page`           | 1..N         | Page number                           |
| `per_page`       | 100          | Records per page                      |
| `dated_on_after` | `YYYY-MM-DD` | Only invoices dated after this date   |
| `dated_on_before`| `YYYY-MM-DD` | Only invoices dated before this date  |
| `sort_by`        | `dated_on`   | Sort results by invoice date          |

### Example Request

```
GET /v1/invoices?page=1&per_page=100&dated_on_after=2026-01-01&dated_on_before=2026-01-31&sort_by=dated_on
```

### Response Key

```json
{ "invoices": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field     | DB Column (`platform_integration_invoices`) | Transform                           |
|------------------------|---------------------------------------------|-------------------------------------|
| `id`                   | `platform_invoice_id`                       | `String()`                          |
| `id`                   | `invoice_number`                            | `String()`                          |
| `invoice_items[0].id`  | `invoice_uuid`                              | First line item's UUID (invoiced-item id). The invoice object has no UUID and `invoice_id` is numeric; the web app opens the invoice via this invoiced-item UUID. |
| `reference`            | `reference`                                 | Direct                              |
| `dated_on`             | `invoice_date`                              | Direct                              |
| `due_on`               | `due_date`                                  | Direct                              |
| `paid_on`              | `paid_date`                                 | Direct                              |
| `sent_at`              | `sent_at`                                   | Direct                              |
| `paid`                 | `status`                                    | `paid ? 'paid' : (sent_at ? 'sent' : 'draft')` |
| `paid`                 | `is_paid`                                   | Default: `false`                    |
| `amount`               | `subtotal`                                  | `parseFloat()`                      |
| `amount_outstanding`   | `amount_outstanding`                        | `parseFloat()`                      |
| `nhs_amount`           | `nhs_amount`                                | `parseFloat()`                      |
| `site_id`              | `location_id`                               | `mapSiteIdToLocationId()`           |
| `site_id`              | `site_id`                                   | Direct (raw value)                  |
| `patient_id`           | `patient_id`                                | Direct                              |
| `account_id`           | `account_id`                                | Direct                              |
| `payment_terms`        | `payment_terms`                             | Direct                              |
| `footnote`             | `footnote`                                  | Direct                              |
| `user_id`              | `invoice_user_id`                           | Direct                              |
| `created_at`           | `api_record_created_at`                     | Direct                              |
| `updated_at`           | `api_record_updated_at`                     | Direct                              |
| `invoice_items`        | —                                           | Extracted for separate processing   |
| —                      | `platform_type`                             | Always `'dentally'`                 |
| —                      | `currency`                                  | Always `'GBP'`                      |
| —                      | `organization_id`                           | From context                        |
| —                      | `user_id`                                   | From context                        |

### Upsert Strategy

`ON CONFLICT (organization_id, platform_type, platform_invoice_id)`

---

## API 12: Invoice Detail

For each invoice from the list endpoint, a **detail request** is made to fetch `invoice_items`.

### Endpoint

```
GET /v1/invoices/{invoice_id}
```

### Request Parameters

None (invoice ID is in the URL path).

### Example Request

```
GET /v1/invoices/37353
```

### Response Key

```json
{ "invoice": { ..., "invoice_items": [ ... ] } }
```

### Invoice Line Items → DB Mapping

| Dentally API Field         | DB Column (`platform_integration_invoice_line_items`) | Transform                        |
|----------------------------|-------------------------------------------------------|----------------------------------|
| `id`                       | `platform_line_id`                                    | Dedup logic (see below)          |
| `id`                       | `dentally_invoice_id`                                 | The invoiced-item UUID — what the web app uses to open the invoice. (NOT the internal `invoice_id` FK.) |
| `name`                     | `item_name`                                           | Direct                           |
| `name` or `description`    | `description`                                         | Fallback: name → description     |
| `treatment_id`             | `treatment_id`                                        | `parseInt()`                     |
| `treatment_id`             | `treatment_category`                                  | Lookup via treatmentCategoryMap  |
| `practitioner_id`          | `practitioner_id`                                     | `String()`                       |
| `sundry_id`                | `sundry_id`                                           | `String()`                       |
| `treatment_plan_id`        | `treatment_plan_id`                                   | `String()`                       |
| `treatment_plan_item_id`   | `treatment_plan_item_id`                              | `String()`                       |
| `quantity`                 | `quantity`                                            | Default: `0`                     |
| `total_price`              | `line_amount`                                         | `parseFloat()`                   |
| `total_price`              | `gross`                                               | `parseFloat()`                   |
| `total_price`              | `net`                                                 | `parseFloat()`                   |
| —                          | `discount`                                            | Always `0`                       |
| —                          | `tax`                                                 | Always `0`                       |
| `created_at`               | `api_record_created_at`                               | Direct                           |
| `updated_at`               | `api_record_updated_at`                               | Direct                           |
| —                          | `invoice_id`                                          | DB UUID of parent invoice        |
| —                          | `organization_id`                                     | From context                     |

### Line Item ID Dedup Logic

```
if item.id exists:
  if duplicate ID in same invoice → "{id}-{index}"
  else → "{id}"
else → "{platform_invoice_id}-{index}"
```

### Upsert Strategy

`ON CONFLICT (organization_id, platform_line_id, invoice_id)`

---

## API 13: NHS Claims (Disabled)

> Currently disabled — table migration not yet applied.

### Endpoint

```
GET /v1/nhs_claims
```

### Request Parameters (When Enabled)

| Parameter        | Value        | Description                             |
|------------------|--------------|---------------------------------------- |
| `page`           | 1..N         | Page number                             |
| `per_page`       | 100          | Records per page                        |
| `updated_after`  | `YYYY-MM-DD` | Only claims updated after this date     |
| `updated_before` | `YYYY-MM-DD` | Only claims updated before this date    |
| `sort_by`        | `updated_at` | Sort results by update date             |

### Example Request

```
GET /v1/nhs_claims?page=1&per_page=100&updated_after=2026-01-01&updated_before=2026-01-31&sort_by=updated_at
```

### Response Key

```json
{ "nhs_claims": [ ... ] }
```

### API Response Fields → DB Mapping

| Dentally API Field              | DB Column (`nhs_claims`)       | Transform                    |
|---------------------------------|--------------------------------|------------------------------|
| `id`                            | `nc_id`                        | `parseBigInt()`              |
| `site_id`                       | `location_id`                  | `mapSiteIdToLocationId()`    |
| `claim_status`                  | `nc_claim_status`              | Direct                       |
| `sequence_number`               | `nc_sequence_number`           | Direct                       |
| `approval_date`                 | `nc_approval_date`             | Direct                       |
| `submitted_date`                | `nc_submitted_date`            | Direct                       |
| `awarded_uda`                   | `nc_awarded_uda`               | `parseFloat()`               |
| `expected_uda`                  | `nc_expected_uda`              | `parseFloat()`               |
| `uda_band`                      | `nc_uda_band`                  | Direct                       |
| `dentist_charge`                | `nc_dentist_charge`            | `parseFloat()`               |
| `patient_charge`                | `nc_patient_charge`            | `parseFloat()`               |
| `patient_id`                    | `nc_patient_id`                | `parseBigInt()`              |
| `practitioner_id`               | `nc_practitioner_id`           | `parseBigInt()`              |
| `treatment_plan_id`             | `nc_treatment_plan_id`         | `parseBigInt()`              |
| `site_id`                       | `nc_site_id`                   | Direct (raw value)           |
| `contract_id`                   | `nc_contract_id`               | `parseBigInt()`              |
| `ortho`                         | `nc_ortho`                     | Default: `false`             |
| `continuation_part_number`      | `nc_continuation_part_number`  | Direct                       |
| `status_comments`               | `nc_status_comments`           | Direct                       |
| `ni_calculated_dentist_fee`     | `nc_ni_dentist_fee`            | `parseFloat()`               |
| `ni_calculated_patient_fee`     | `nc_ni_patient_fee`            | `parseFloat()`               |
| `scot_amount_authorised`        | `nc_scot_amount_authorised`    | `parseFloat()`               |
| `scot_amount_expected`          | `nc_scot_amount_expected`      | `parseFloat()`               |
| `created_at`                    | `nc_created_at`                | Direct                       |
| `updated_at`                    | `nc_updated_at`                | Direct                       |
| `nhs_updated_at`                | `nc_nhs_updated_at`            | Direct                       |
| —                               | `organization_id`              | From context                 |
| —                               | `user_id`                      | From context                 |

### Upsert Strategy (When Enabled)

`ON CONFLICT (organization_id, nc_id)`

---

## Rate Limiting

Dentally returns **HTTP 403** with body containing `"Rate limit exceeded"` (not standard 429). The hourly budget is 3600 requests per account (`x-ratelimit-limit`), refilled on the hour (`x-ratelimit-reset`).

Two distinct 403 cases are handled differently (`api/dentally/client.js`):

| Case | Detection | Response |
|------|-----------|----------|
| **Blip** (rollover lag / burst) | 403 but its own headers show > 50 remaining | Short escalating backoff: 30s, 60s, 90s… — no hourly cooldown. Final attempt falls through to the exhaustion path. |
| **Real exhaustion** | 403 with low/no remaining | Global cooldown until the reset header (or next hour boundary), persisted to DB + file so restarts and sibling instances honour it. |

During any cooldown, workers no longer sleep blind: every 3 minutes one worker sends a single probe (`/v1/sites?per_page=1`); a 200 clears the shared cooldown immediately so all workers resume as soon as the limiter actually recovers.

| Setting | Default | Env override |
|---------|---------|--------------|
| Max retries per request | 8 | — |
| Blip threshold (remaining >) | 50 | `DENTALLY_BLIP_MIN_REMAINING` |
| Blip backoff step | 30s | `DENTALLY_BLIP_RETRY_MS` |
| Cooldown probe interval | 3 min | `DENTALLY_PROBE_INTERVAL_MS` |

Why the blip path exists: observed in production (2026-08-04), a 403 landed 3 seconds after the hourly rollover with `remaining=3589`; the old logic saw the advertised reset already in the past and slept until the *next* hour — a needless 59-minute stall.

---

## Monthly Chunking

Date-filterable entities are split into **monthly chunks** for efficient pagination.

### Logic

```
Start: 1st of start_date month
End:   Last day of month (or today for current month)
Order: Reverse chronological (newest month first)
Default range: Current year (Jan 1 to today)
```

### Example

For sync started on `2026-02-17`, default chunks would be:
```
Feb 2026: 2026-02-01 → 2026-02-17
Jan 2026: 2026-01-01 → 2026-01-31
```

Each chunk creates a separate `sync_jobs` row and is processed sequentially.

---

## Location Mapping

All entities with `site_id` use a pre-loaded **location map** for mapping:

```
Dentally site_id (UUID) → practice_locations.api_record_unique_id → practice_locations.id (our UUID)
```

Entities using location map: `appointments`, `payment_plans`, `patients`, `treatment_plans`, `treatment_plan_items`, `treatment_appointments`, `invoices`.

---

## Helper Functions

| Function                  | Purpose                                                    |
|---------------------------|-----------------------------------------------------------|
| `parseBigInt(value)`      | Safely parse numeric ID; returns `null` for UUIDs/non-numeric |
| `parseUuid(value)`        | Validate UUID format; returns `null` if invalid            |
| `truncate(value, maxLen)` | Truncate string to max length to prevent DB overflow       |
| `mapSiteIdToLocationId()` | Map Dentally `site_id` to internal `location_id` via lookup map |
| `mapNhsBand(udaBand)`     | Convert Dentally `uda_band` to valid `nhs_band` value     |

---

## Source Files

| File                       | Purpose                              |
|---------------------------|--------------------------------------|
| `sync/entityConfig.js`    | Entity definitions and priorities     |
| `sync/dentallyClient.js`  | API client with retry/rate limiting   |
| `sync/entityTransformers.js` | Field mapping transformations      |
| `sync/upsertService.js`   | DB upsert with fallback logic         |
| `sync/syncEngine.js`      | Page loop and job processing          |
| `sync/jobQueue.js`        | Job queue and concurrency control     |
| `sync/monthChunker.js`    | Date range splitting                  |
| `sync/helpers.js`         | Utility functions                     |
| `sync/syncLogger.js`      | Job status updates                    |
