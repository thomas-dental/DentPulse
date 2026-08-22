-- Fix duplicate notifications by checking if a similar notification already exists
-- Only create a new notification if there isn't one for the same entity within the last 5 minutes

CREATE OR REPLACE FUNCTION create_sync_completion_notification()
RETURNS TRIGGER AS $$
DECLARE
  integration_name TEXT;
  entity_display_name TEXT;
  notification_title TEXT;
  notification_message TEXT;
  notification_type TEXT;
  org_user_id UUID;
  existing_notification_count INT;
BEGIN
  -- Only create notification when status changes to 'completed' or 'failed'
  IF (NEW.status = 'completed' OR NEW.status = 'failed') AND
     (OLD.status IS NULL OR OLD.status != NEW.status) THEN

    -- Get integration name
    SELECT i.integration_name INTO integration_name
    FROM integrations i
    WHERE i.id = NEW.integration_id;

    -- Format entity name
    entity_display_name := CASE NEW.entity_alias
      WHEN 'appointments' THEN 'Appointments'
      WHEN 'practitioners' THEN 'Practitioners'
      WHEN 'payment_plans' THEN 'Payment Plans'
      WHEN 'treatment_plans' THEN 'Treatment Plans'
      WHEN 'treatment_plan_items' THEN 'Treatment Plan Items'
      WHEN 'treatment_appointments' THEN 'Treatment Appointments'
      WHEN 'treatments' THEN 'Treatments'
      WHEN 'treatment_category' THEN 'Treatment Categories'
      WHEN 'locations' THEN 'Locations'
      WHEN 'patients' THEN 'Patients'
      ELSE COALESCE(NEW.entity_alias, 'Data')
    END;

    -- Get user_id from organization (creator/owner)
    SELECT o.created_by INTO org_user_id
    FROM organizations o
    WHERE o.id = NEW.organization_id;

    -- Build notification title based on status
    IF NEW.status = 'completed' THEN
      notification_type := 'success';
      notification_title := entity_display_name || ' synced successfully';
      notification_message := 'Synced ' || NEW.records_processed || ' records from ' || integration_name || '.';
    ELSE -- failed
      notification_type := 'error';
      notification_title := entity_display_name || ' sync failed';
      notification_message := COALESCE(NEW.error_message, 'An error occurred during sync.');
    END IF;

    -- Check if a similar notification already exists within the last 5 minutes
    -- This prevents duplicate notifications for the same entity
    SELECT COUNT(*) INTO existing_notification_count
    FROM public.notifications
    WHERE user_id = org_user_id
      AND organization_id = NEW.organization_id
      AND title = notification_title
      AND type = notification_type
      AND created_at > NOW() - INTERVAL '5 minutes';

    -- Only create notification if no recent duplicate exists
    IF existing_notification_count = 0 THEN
      INSERT INTO public.notifications (
        user_id,
        organization_id,
        title,
        message,
        type,
        related_entity_type,
        related_entity_id,
        is_read
      ) VALUES (
        org_user_id,
        NEW.organization_id,
        notification_title,
        notification_message,
        notification_type,
        'sync_job',
        NEW.id,
        FALSE
      );
    ELSE
      -- Log that we skipped creating a duplicate notification
      RAISE NOTICE 'Skipped duplicate notification for % (already exists within 5 minutes)', notification_title;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger already exists, so we just need to replace the function above
-- The trigger will automatically use the new function definition

COMMENT ON FUNCTION create_sync_completion_notification() IS 'Creates notifications for sync job completions/failures. Prevents duplicates by checking for similar notifications within the last 5 minutes.';
