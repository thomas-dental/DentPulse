-- ============================================================================
-- Migration: Create function to delete users and all their associated data
-- Created: 2026-02-18
-- Description: Creates a reusable stored function that safely deletes users
--              and all their organization data across all tables
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_users_and_data(
  p_user_ids UUID[]
)
RETURNS TABLE (
  deleted_user_id UUID,
  deleted_organization_id UUID,
  deletion_status TEXT,
  deletion_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER -- Run with elevated privileges to bypass RLS
AS $$
DECLARE
  v_current_user_id UUID;
  v_org_id UUID;
  v_total_users INT;
  v_processed INT := 0;
BEGIN

  v_total_users := array_length(p_user_ids, 1);
  RAISE NOTICE 'Starting deletion for % users', v_total_users;

  -- Loop through each user
  FOREACH v_current_user_id IN ARRAY p_user_ids
  LOOP
    v_processed := v_processed + 1;
    RAISE NOTICE '[%/%] Processing user: %', v_processed, v_total_users, v_current_user_id;

    -- Get organization ID for this user
    SELECT organizations.id INTO v_org_id FROM organizations
    WHERE organizations.user_id = v_current_user_id OR organizations.created_by = v_current_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
      -- Return error status for this user
      deleted_user_id := v_current_user_id;
      deleted_organization_id := NULL;
      deletion_status := 'SKIPPED';
      deletion_message := 'No organization found';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Start deletion
    BEGIN
      -- Level 1: User-specific data
      DELETE FROM notifications WHERE organization_id = v_org_id OR user_id = v_current_user_id;
      DELETE FROM user_roles WHERE organization_id = v_org_id OR user_id = v_current_user_id;

      -- Level 2: Inbound emails
      DELETE FROM inbound_email_attachments
      WHERE inbound_email_id IN (SELECT id FROM inbound_emails WHERE organization_id = v_org_id);
      DELETE FROM inbound_emails WHERE organization_id = v_org_id;

      -- Level 3: Invoice data
      DELETE FROM accounts_payable_invoice_line_item
      WHERE accounts_payable_invoice_id IN (SELECT id FROM accounts_payable_invoice WHERE organization_id = v_org_id);
      DELETE FROM invoice_tag_assignments
      WHERE invoice_id IN (SELECT id FROM accounts_payable_invoice WHERE organization_id = v_org_id);
      DELETE FROM accounts_payable_invoice WHERE organization_id = v_org_id;
      DELETE FROM invoice_tags WHERE organization_id = v_org_id;
      DELETE FROM invoice_folders WHERE organization_id = v_org_id;
      DELETE FROM accounts_payable_invoice_rules_mapping WHERE organization_id = v_org_id;

      -- Level 4: Treatment & Appointment data
      DELETE FROM treatment_appointments WHERE organization_id = v_org_id;
      DELETE FROM treatment_plan_items WHERE organization_id = v_org_id;
      DELETE FROM treatment_plans WHERE organization_id = v_org_id;
      DELETE FROM appointments WHERE organization_id = v_org_id;
      DELETE FROM patients WHERE organization_id = v_org_id;
      DELETE FROM payment_plans WHERE organization_id = v_org_id;
      DELETE FROM treatments WHERE organization_id = v_org_id;
      DELETE FROM treatment_categories WHERE organization_id = v_org_id;
      DELETE FROM treatment_goal_targets WHERE organization_id = v_org_id;

      -- Level 5: Provider data
      DELETE FROM provider_sliding_scales WHERE organization_id = v_org_id;
      DELETE FROM planned_daily_production WHERE organization_id = v_org_id;
      DELETE FROM providers WHERE organization_id = v_org_id;
      DELETE FROM specialties WHERE organization_id = v_org_id;
      DELETE FROM provider_types WHERE organization_id = v_org_id;

      -- Level 6: Locations & Practices
      DELETE FROM practice_locations WHERE organization_id = v_org_id;
      DELETE FROM regions WHERE organization_id = v_org_id;
      DELETE FROM practices WHERE organization_id = v_org_id;

      -- Level 7: Integration data
      DELETE FROM integration_sync_entities
      WHERE integration_id IN (SELECT id FROM integrations WHERE organization_id = v_org_id);
      DELETE FROM sync_jobs WHERE organization_id = v_org_id;
      DELETE FROM integrations WHERE organization_id = v_org_id;

      -- Level 8: Platform integration data
      DELETE FROM platform_integration_invoice_line_items
      WHERE invoice_id IN (SELECT id FROM platform_integration_invoices WHERE organization_id = v_org_id);
      DELETE FROM platform_integration_invoices WHERE organization_id = v_org_id;
      DELETE FROM platform_integration_chart_of_accounts WHERE organization_id = v_org_id;
      DELETE FROM platform_integration_organization_mapping WHERE organization_id = v_org_id;
      DELETE FROM platform_integration_organizations WHERE organization_id = v_org_id;

      -- Level 9: Organization settings
      DELETE FROM organization_settings WHERE organization_id = v_org_id;
      DELETE FROM organization_inbound_emails WHERE organization_id = v_org_id;

      -- Level 10: Delete organization
      DELETE FROM organizations WHERE id = v_org_id;

      -- Level 11: Delete user
      DELETE FROM profiles WHERE id = v_current_user_id;
      DELETE FROM auth.users WHERE id = v_current_user_id;

      -- Return success status
      deleted_user_id := v_current_user_id;
      deleted_organization_id := v_org_id;
      deletion_status := 'SUCCESS';
      deletion_message := 'User and all associated data deleted successfully';
      RETURN NEXT;

      RAISE NOTICE '  ✓ Completed user %', v_current_user_id;

    EXCEPTION WHEN OTHERS THEN
      -- Return error status if something went wrong
      deleted_user_id := v_current_user_id;
      deleted_organization_id := v_org_id;
      deletion_status := 'ERROR';
      deletion_message := SQLERRM;
      RETURN NEXT;

      RAISE NOTICE '  ✗ Error for user %: %', v_current_user_id, SQLERRM;
    END;

  END LOOP;

  RAISE NOTICE 'Deletion complete - processed % users', v_processed;
  RETURN;

END;
$$;

-- Add function documentation
COMMENT ON FUNCTION delete_users_and_data(UUID[]) IS
'Deletes one or more users and ALL their associated data across all tables.
This function handles all foreign key relationships and deletes data in the correct order.

USAGE EXAMPLES:

1. Delete single user:
   SELECT * FROM delete_users_and_data(ARRAY[''user-id-here'']::UUID[]);

2. Delete multiple users:
   SELECT * FROM delete_users_and_data(
     ARRAY[''user-id-1'', ''user-id-2'', ''user-id-3'']::UUID[]
   );

3. Delete users by email:
   SELECT * FROM delete_users_and_data(
     ARRAY(SELECT id FROM auth.users WHERE email IN (''user1@example.com'', ''user2@example.com''))
   );

RETURNS:
  - deleted_user_id: The user ID that was processed
  - deleted_organization_id: The organization ID that was deleted (NULL if no org found)
  - deletion_status: SUCCESS, SKIPPED, or ERROR
  - deletion_message: Description of what happened

SECURITY:
  - Function runs with SECURITY DEFINER to bypass RLS policies
  - Only use this function when you need to completely remove test/dummy users

TABLES AFFECTED:
  - notifications, user_roles
  - inbound_emails, inbound_email_attachments
  - accounts_payable_invoice, accounts_payable_invoice_line_item
  - invoice_tags, invoice_tag_assignments, invoice_folders
  - treatment_appointments, treatment_plan_items, treatment_plans
  - appointments, patients, payment_plans
  - treatments, treatment_categories, treatment_goal_targets
  - providers, provider_sliding_scales, planned_daily_production
  - specialties, provider_types
  - practice_locations, regions, practices
  - integrations, integration_sync_entities, sync_jobs
  - platform_integration_* tables
  - organization_settings, organization_inbound_emails
  - organizations
  - profiles, auth.users
';
