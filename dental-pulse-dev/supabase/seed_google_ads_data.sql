-- Seed Google Ads data from CSV into platform_integration_google_ads_data
-- Run this after you have an organization set up

-- First, we need to get the organization_id and create a platform_integration if not exists
-- Replace 'YOUR_ORGANIZATION_ID' and 'YOUR_USER_ID' with actual values

DO $$
DECLARE
    v_org_id UUID;
    v_user_id UUID;
    v_integration_id UUID;
BEGIN
    -- Get the first organization with its user_id (or specify your org ID)
    SELECT id, COALESCE(user_id, created_by) INTO v_org_id, v_user_id
    FROM organizations
    WHERE COALESCE(user_id, created_by) IS NOT NULL
    LIMIT 1;

    IF v_org_id IS NULL OR v_user_id IS NULL THEN
        RAISE NOTICE 'No organization or user found. Please create an organization first.';
        RETURN;
    END IF;

    -- Check if platform_integration exists for google_ads
    SELECT id INTO v_integration_id
    FROM platform_integrations
    WHERE organization_id = v_org_id AND platform_name = 'google_ads';

    -- If not exists, create one
    IF v_integration_id IS NULL THEN
        INSERT INTO platform_integrations (
            organization_id,
            user_id,
            platform_name,
            is_connected,
            created_at,
            updated_at
        ) VALUES (
            v_org_id,
            v_user_id,
            'google_ads',
            true,
            NOW(),
            NOW()
        )
        RETURNING id INTO v_integration_id;

        RAISE NOTICE 'Created platform_integration with ID: %', v_integration_id;
    END IF;

    -- Upsert the Google Ads data
    INSERT INTO platform_integration_google_ads_data (
        organization_id,
        platform_integration_id,
        user_id,
        customer_id,
        login_customer_id,
        account_name,
        currency,
        timezone,
        total_spend,
        total_conversions,
        total_clicks,
        total_impressions,
        average_cpc,
        cost_per_conversion,
        last_sync_at,
        raw_campaigns,
        raw_metrics,
        status,
        is_selected
    ) VALUES (
        v_org_id,
        v_integration_id,
        v_user_id,
        '9859949182',
        '9859949182',
        'Denish Faldu - SK Marketing',
        'GBP',
        'Europe/London',
        42020.94,
        7664,
        31889,
        551462,
        1.32,
        5.48,
        NOW(),
        '[
            {
                "id": "1",
                "name": "DEEP | PMAX NEW | Emergency - Dec 2025",
                "status": "Enabled",
                "campaignType": "Performance Max",
                "budget": 10.00,
                "clicks": 7449,
                "impressions": 126403,
                "ctr": "5.89%",
                "cost": 648.20,
                "conversions": 2989,
                "conversionRate": "40.13%",
                "costPerConversion": 0.22,
                "avgCpc": 0.09
            },
            {
                "id": "2",
                "name": "DEEP | PMAX | Emergency - Nov 2025",
                "status": "Paused",
                "campaignType": "Performance Max",
                "budget": 25.00,
                "clicks": 1282,
                "impressions": 28342,
                "ctr": "4.52%",
                "cost": 379.53,
                "conversions": 829,
                "conversionRate": "64.66%",
                "costPerConversion": 0.46,
                "avgCpc": 0.30
            },
            {
                "id": "3",
                "name": "DEEP | PMAX - Local",
                "status": "Paused",
                "campaignType": "Performance Max",
                "budget": 20.00,
                "clicks": 0,
                "impressions": 0,
                "ctr": "0%",
                "cost": 0,
                "conversions": 0,
                "conversionRate": "0%",
                "costPerConversion": 0,
                "avgCpc": 0
            },
            {
                "id": "4",
                "name": "DEEP | SEARCH | Emergency - Oct 2025",
                "status": "Paused",
                "campaignType": "Search",
                "budget": 10.00,
                "clicks": 864,
                "impressions": 12033,
                "ctr": "7.18%",
                "cost": 1710.18,
                "conversions": 82,
                "conversionRate": "9.49%",
                "costPerConversion": 20.85,
                "avgCpc": 1.98
            },
            {
                "id": "5",
                "name": "DEEP | SEARCH | Dr Imran Saeed Implant Open Day",
                "status": "Enabled",
                "campaignType": "Search",
                "budget": 50.00,
                "clicks": 368,
                "impressions": 4146,
                "ctr": "8.88%",
                "cost": 554.75,
                "conversions": 31,
                "conversionRate": "8.51%",
                "costPerConversion": 17.70,
                "avgCpc": 1.51
            },
            {
                "id": "6",
                "name": "DEEP | PMAX 2 | Emergency - Dec 2025",
                "status": "Paused",
                "campaignType": "Performance Max",
                "budget": 25.00,
                "clicks": 66,
                "impressions": 3534,
                "ctr": "1.87%",
                "cost": 24.44,
                "conversions": 5,
                "conversionRate": "7.58%",
                "costPerConversion": 4.89,
                "avgCpc": 0.37
            },
            {
                "id": "7",
                "name": ". G GEO - Emergency",
                "status": "Paused",
                "campaignType": "Search",
                "budget": 100.00,
                "clicks": 768,
                "impressions": 10325,
                "ctr": "7.44%",
                "cost": 1875.73,
                "conversions": 102,
                "conversionRate": "13.27%",
                "costPerConversion": 18.40,
                "avgCpc": 2.44
            },
            {
                "id": "8",
                "name": ". G GEO - Emergency - Barnsley",
                "status": "Paused",
                "campaignType": "Search",
                "budget": 60.00,
                "clicks": 69,
                "impressions": 765,
                "ctr": "9.02%",
                "cost": 252.87,
                "conversions": 10,
                "conversionRate": "14.49%",
                "costPerConversion": 25.29,
                "avgCpc": 3.66
            },
            {
                "id": "9",
                "name": "DEEP | SEARCH | Emergency - Aug 2025",
                "status": "Enabled",
                "campaignType": "Search",
                "budget": 500.00,
                "clicks": 16216,
                "impressions": 236049,
                "ctr": "6.87%",
                "cost": 30444.49,
                "conversions": 3155,
                "conversionRate": "19.46%",
                "costPerConversion": 9.65,
                "avgCpc": 1.88
            },
            {
                "id": "10",
                "name": "Sales-Taha ads-google",
                "status": "Enabled",
                "campaignType": "Search",
                "budget": 20.00,
                "clicks": 554,
                "impressions": 8892,
                "ctr": "6.23%",
                "cost": 542.68,
                "conversions": 188,
                "conversionRate": "33.93%",
                "costPerConversion": 2.89,
                "avgCpc": 0.98
            },
            {
                "id": "11",
                "name": ".G Emergency - PMAX",
                "status": "Paused",
                "campaignType": "Performance Max",
                "budget": 150.00,
                "clicks": 2848,
                "impressions": 110144,
                "ctr": "2.59%",
                "cost": 1181.44,
                "conversions": 19,
                "conversionRate": "0.26%",
                "costPerConversion": 62.18,
                "avgCpc": 0.16
            },
            {
                "id": "12",
                "name": "DEEP | SEARCH | Emergency | LEEDS - Oct 2025",
                "status": "Paused",
                "campaignType": "Search",
                "budget": 25.00,
                "clicks": 107,
                "impressions": 1518,
                "ctr": "7.05%",
                "cost": 159.89,
                "conversions": 6,
                "conversionRate": "5.61%",
                "costPerConversion": 26.65,
                "avgCpc": 1.49
            },
            {
                "id": "13",
                "name": "taha-Search-new keywords-1",
                "status": "Enabled",
                "campaignType": "Search",
                "budget": 40.00,
                "clicks": 20,
                "impressions": 265,
                "ctr": "7.55%",
                "cost": 121.61,
                "conversions": 0,
                "conversionRate": "0%",
                "costPerConversion": 0,
                "avgCpc": 6.08
            },
            {
                "id": "14",
                "name": ". G LM - Emergency",
                "status": "Paused",
                "campaignType": "Search",
                "budget": 100.00,
                "clicks": 1278,
                "impressions": 9046,
                "ctr": "14.13%",
                "cost": 4125.14,
                "conversions": 248,
                "conversionRate": "19.41%",
                "costPerConversion": 16.63,
                "avgCpc": 3.23
            }
        ]'::jsonb,
        '{
            "totalImpressions": 551462,
            "totalClicks": 31889,
            "totalCost": 42020.94,
            "totalConversions": 7664,
            "costPerLead": 5.48,
            "averageCtr": "5.78%",
            "currency": "GBP"
        }'::jsonb,
        'active',
        true
    )
    ON CONFLICT (organization_id, customer_id)
    DO UPDATE SET
        total_spend = EXCLUDED.total_spend,
        total_conversions = EXCLUDED.total_conversions,
        total_clicks = EXCLUDED.total_clicks,
        total_impressions = EXCLUDED.total_impressions,
        average_cpc = EXCLUDED.average_cpc,
        cost_per_conversion = EXCLUDED.cost_per_conversion,
        last_sync_at = NOW(),
        raw_campaigns = EXCLUDED.raw_campaigns,
        raw_metrics = EXCLUDED.raw_metrics,
        updated_at = NOW();

    RAISE NOTICE 'Google Ads data seeded successfully for organization: %', v_org_id;
END $$;
