import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cashflow Archive Report Edge Function
 * Proxies GET /api/Transactions/GetArchiveCashflowReport to backend API
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get request body
    const body = await req.json();
    const {
      organizationId,
      fromDate,
      toDate,
      // Optional flags/actions:
      // - archive: when true, archive the current cashflow report for the given range
      // - archiveId: when provided, load a specific archived cashflow report by id
      // - downloadFormat: backend DownloadFormat flag (e.g. 1 = Excel, 2 = PDF, etc.)
      archive = false,
      archiveId,
      downloadFormat = 1,
    } = body;

    if (!organizationId || (!fromDate && !toDate && !archiveId)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: organizationId, and either (fromDate & toDate) or archiveId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Implement archive logic directly against Supabase database
    const nowUtc = new Date().toISOString();

    // 1) Archive current cashflow report for range
    if (archive && !archiveId) {
      if (!fromDate || !toDate) {
        return new Response(
          JSON.stringify({
            error: 'Missing fromDate or toDate for archive operation',
            resultMsg: 'fromDate and toDate are required to archive a cashflow statement',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Call local cashflow-report Edge Function to generate current statement
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const functionsBaseUrl = supabaseUrl.replace(/\/$/, '') + '/functions/v1/cashflow-report';

      const cashflowResponse = await fetch(functionsBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({ organizationId, fromDate, toDate }),
      });

      if (!cashflowResponse.ok) {
        const errorText = await cashflowResponse.text();
        console.error(`cashflow-report error: ${cashflowResponse.status} - ${errorText}`);
        return new Response(
          JSON.stringify({
            error: `cashflow-report error: ${cashflowResponse.statusText}`,
            resultMsg: errorText || 'Failed to generate cashflow report for archive',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: cashflowResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const cashflowData = await cashflowResponse.json();
      if (cashflowData.transactionStatus !== 8 || !cashflowData.returnObject) {
        return new Response(
          JSON.stringify({
            error: 'Cashflow report generation failed',
            resultMsg: cashflowData.resultMsg || 'Failed to generate cashflow report for archive',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const downloadData = JSON.stringify(cashflowData.returnObject);

      // Insert archive row into cashflow_statement_archive (Postgres equivalent of CashflowStatementArchive)
      const { data: insertResult, error: insertError } = await supabase
        .from('cashflow_statement_archive')
        .insert({
          organization_id: organizationId,
          start_date: fromDate,
          end_date: toDate,
          download_data: downloadData,
          download_format: downloadFormat ?? 1,
          created_date: nowUtc,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to archive cashflow statement:', insertError);
        return new Response(
          JSON.stringify({
            error: insertError.message || 'Failed to archive cashflow statement',
            resultMsg: 'Failed to archive cashflow statement',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          returnObject: insertResult?.id ?? null,
          transactionStatus: 8,
          resultMsg: 'Success',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2) Get a specific archived cashflow report by id
    if (archiveId) {
      const { data: archiveRow, error: archiveError } = await supabase
        .from('cashflow_statement_archive')
        .select('id, download_data')
        .eq('id', archiveId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (archiveError) {
        console.error('Failed to load archived cashflow statement by id:', archiveError);
        return new Response(
          JSON.stringify({
            error: archiveError.message || 'Failed to load archived cashflow statement',
            resultMsg: 'Failed to load archived cashflow statement',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!archiveRow) {
        return new Response(
          JSON.stringify({
            error: 'Archive not found',
            resultMsg: 'Data Not found',
            transactionStatus: 0,
            returnObject: null,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let reportVm: unknown = null;
      try {
        reportVm = archiveRow.download_data ? JSON.parse(archiveRow.download_data as string) : null;
      } catch (e) {
        console.error('Failed to parse archived cashflow DownloadData JSON:', e);
      }

      return new Response(
        JSON.stringify({
          returnObject: reportVm,
          transactionStatus: 8,
          resultMsg: 'Success',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) Default: list archives for organization within date range
    if (!fromDate || !toDate) {
      return new Response(
        JSON.stringify({
          error: 'Missing fromDate or toDate for archive list',
          resultMsg: 'fromDate and toDate are required to list archived cashflow statements',
          transactionStatus: 0,
          returnObject: [],
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: archives, error: listError } = await supabase
      .from('cashflow_statement_archive')
      .select('id, start_date, end_date, created_date, download_format')
      .eq('organization_id', organizationId)
      .gte('start_date', fromDate)
      .lte('end_date', toDate)
      .order('created_date', { ascending: false });

    if (listError) {
      console.error('Failed to list archived cashflow statements:', listError);
      return new Response(
        JSON.stringify({
          error: listError.message || 'Failed to list archived cashflow statements',
          resultMsg: 'Failed to list archived cashflow statements',
          transactionStatus: 0,
          returnObject: [],
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        returnObject: archives ?? [],
        transactionStatus: 8,
        resultMsg: 'Success',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in cashflow-archive-report function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        resultMsg: 'Failed to process request',
        transactionStatus: 0,
        returnObject: [] 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
