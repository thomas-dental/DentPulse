/**
 * Iplicit Invoice Service
 * Handles business logic for creating invoices in Iplicit
 */

const { supabaseAdmin } = require('../config/supabase');
const {
  getOrRefreshSession,
  createPurchaseInvoice,
  updatePurchaseInvoice,
  fetchPurchaseInvoice,
  abandonPurchaseInvoice,
  deletePurchaseInvoice,
  createProduct,
  generateProductCode,
  createContactAccount,
} = require('../api/iplicit/client');

/**
 * Format date for Iplicit API: '2026-04-03T00:00:00Z'
 */
function formatDateForIplicit(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T00:00:00Z`;
}

/**
 * Create a purchase invoice in Iplicit
 * @param {string} invoiceId - accounts_payable_invoice.id
 * @param {object} invoiceData - Invoice data from frontend
 * @returns {Promise<object>} - Result with iplicitInvoiceId
 */
async function createInvoice(invoiceId, invoiceData, explicitConnectionId = null) {
  console.log('[IplicitInvoiceService] createInvoice called with explicitConnectionId:', explicitConnectionId);
  // Get the invoice from database to get organization_id, location_id and user_id
  const { data: dbInvoice, error: invoiceError } = await supabaseAdmin
    .from('accounts_payable_invoice')
    .select('id, organization_id, location_id, user_id, platform_invoice_id, shared_at')
    .eq('id', invoiceId)
    .single();

  if (invoiceError || !dbInvoice) {
    throw new Error('Invoice not found');
  }

  const organizationId = dbInvoice.organization_id;
  const userId = dbInvoice.user_id;

  // Get platform organization mapping based on location (determines which iplicit connection to use)
  let platformOrgId = null;
  let legalEntityId = null;
  let connectionId = null;

  console.log(`[IplicitInvoiceService] Invoice ${invoiceId}: location_id=${dbInvoice.location_id}, org=${organizationId}`);

  if (dbInvoice.location_id) {
    // Get ALL mappings for this location, then pick the iplicit one
    const { data: mappings } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id, platform_integration_id')
      .eq('location_id', dbInvoice.location_id)
      .eq('organization_id', organizationId);

    console.log(`[IplicitInvoiceService] Found ${mappings?.length || 0} mapping(s) for location ${dbInvoice.location_id}:`, JSON.stringify(mappings));

    // Find the mapping that belongs to an iplicit connection
    if (mappings && mappings.length > 0) {
      // Get all iplicit connection IDs for this org
      const { data: iplicitConns } = await supabaseAdmin
        .from('platform_integrations')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit');

      const iplicitConnIds = new Set((iplicitConns || []).map(c => c.id));

      // Pick the mapping whose platform_integration_id is an iplicit connection
      const iplicitMapping = mappings.find(m => iplicitConnIds.has(m.platform_integration_id));
      const mapping = iplicitMapping || mappings[0]; // fallback to first mapping

      platformOrgId = mapping.platform_integration_organizations_id || null;
      connectionId = mapping.platform_integration_id || null;

      console.log(`[IplicitInvoiceService] Location ${dbInvoice.location_id} mapped to connection ${connectionId}, platformOrg ${platformOrgId}`);
    }

    // Get actual Iplicit org ID (platform_org_id) from platform_integration_organizations
    if (platformOrgId) {
      const { data: platformOrg } = await supabaseAdmin
        .from('platform_integration_organizations')
        .select('platform_org_id')
        .eq('id', platformOrgId)
        .maybeSingle();

      legalEntityId = platformOrg?.platform_org_id || null;
    }
  }

  // Get Iplicit connection — priority: explicitConnectionId > mapped connectionId > first connected
  const resolvedConnectionId = explicitConnectionId || connectionId;

  let connectionQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, client_id, username, client_secret, access_token, token_expires_at')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'iplicit')
    .eq('is_connected', true);

  if (resolvedConnectionId) {
    connectionQuery = connectionQuery.eq('id', resolvedConnectionId);
  }

  const { data: connections, error: connError } = await connectionQuery.limit(1);
  const connection = connections?.[0] || null;

  console.log(`[IplicitInvoiceService] *** CONNECTION RESOLVED *** explicit=${explicitConnectionId}, mapped=${connectionId}, using=${connection?.id}, username=${connection?.username}, domain=${connection?.client_id}`);

  if (connError || !connection) {
    throw new Error('Iplicit integration not found or not connected');
  }

  // Get or refresh session token
  const { sessionToken } = await getOrRefreshSession(
    connection.id,
    connection.client_id,
    connection.username,
    connection.client_secret,
    connection.access_token,
    connection.token_expires_at
  );

  // Get or create contact account for vendor
  let contactAccountId = null;
  let existingSupplier = null;
  const vendorName = (invoiceData.vendor_name || 'Unknown Supplier').trim();
  const vendorNameLower = vendorName.toLowerCase();

  try {
    // First check if supplier exists in iplicit_suppliers table (case-insensitive match using lowercase)
    // Use limit(1) instead of maybeSingle() to handle multiple records - take the first one
    // Also ensure supplier has valid contact_group_id, contact_group, and contact_code (not null)
    console.log('[IplicitInvoiceService] Checking supplier (lowercase):', vendorNameLower);
    const { data: existingSuppliers } = await supabaseAdmin
      .from('iplicit_suppliers')
      .select('contact_account_id, company, contact_group_id, contact_group, contact_code')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .ilike('company', vendorNameLower)
      .not('contact_group_id', 'is', null)
      .not('contact_group', 'is', null)
      .not('contact_code', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1);

    existingSupplier = existingSuppliers?.[0] || null;

    if (existingSupplier?.contact_account_id) {
      // Use existing contact account ID
      contactAccountId = existingSupplier.contact_account_id;
      console.log('[IplicitInvoiceService] Using existing supplier contact account:', contactAccountId);
    } else {
      // Create new contact account in Iplicit and save to our DB
      const newContactId = await createContactAccount(connection.client_id, sessionToken, vendorName);
      contactAccountId = newContactId;
      console.log('[IplicitInvoiceService] Created new contact account in Iplicit:', contactAccountId);

      // Save new supplier to iplicit_suppliers table (save original name)
      await supabaseAdmin
        .from('iplicit_suppliers')
        .insert({
          organization_id: organizationId,
          user_id: userId,
          company: vendorName,
          contact_account_id: contactAccountId,
          platform_integration_id: connection.id,
        });
      console.log('[IplicitInvoiceService] Saved new supplier to database:', vendorName);
    }
  } catch (err) {
    console.error('[IplicitInvoiceService] Failed to get/create contact account:', err.message);
    // Continue without contact account - will use null
  }

  // Create products for line items - check DB by product_name first, then create if not exists
  const lineItemsWithProducts = [];
  const productCache = new Map(); // Cache for duplicate line items within same invoice

  for (const item of invoiceData.line_items || []) {
    const productName = (item.description || '').trim();
    const productNameLower = productName.toLowerCase();
    const productCode = generateProductCode(item.description);
    let productId = null;

    // Check cache first (for duplicate line items in same invoice)
    if (productCache.has(productNameLower)) {
      productId = productCache.get(productNameLower);
      console.log('[IplicitInvoiceService] Using cached product:', productNameLower, productId);
    } else {
      // Check iplicit_products table by product_name (lowercase for consistent matching)
      console.log('[IplicitInvoiceService] Checking product (lowercase):', productNameLower);
      const { data: dbProducts } = await supabaseAdmin
        .from('iplicit_products')
        .select('product_id, product_code, product_name')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .ilike('product_name', productNameLower)
        .limit(1);

      const existingProduct = dbProducts?.[0] || null;

      if (existingProduct?.product_id) {
        // Product exists in DB, use it
        productId = existingProduct.product_id;
        productCache.set(productNameLower, productId);
        console.log('[IplicitInvoiceService] Using existing product from DB:', productNameLower, productId);
      } else {
        // Product not in DB, create in Iplicit and save to DB
        try {
          const productData = {
            code: productCode,
            description: item.description || 'Product',
            purchase: {
              accountId: item.platform_account_id || null,
              isActive: true,
            },
          };

          console.log('[IplicitInvoiceService] Creating product in Iplicit:', productData);
          const newProduct = await createProduct(connection.client_id, sessionToken, productData);
          productId = newProduct?.id || newProduct;
          productCache.set(productNameLower, productId);
          console.log('[IplicitInvoiceService] Product created in Iplicit:', productId);

          // Save new product to iplicit_products table (save original name)
          await supabaseAdmin
            .from('iplicit_products')
            .insert({
              organization_id: organizationId,
              user_id: userId,
              platform_integration_id: connection.id,
              product_id: productId,
              product_code: productCode,
              product_name: productName,
            });
          console.log('[IplicitInvoiceService] Saved product to database:', productName);
        } catch (err) {
          console.error('[IplicitInvoiceService] Failed to create product:', err.message);
          // Continue without product if creation fails
        }
      }
    }

    lineItemsWithProducts.push({
      ...item,
      productId,
    });
  }

  // Calculate totals
  const subtotal = parseFloat(invoiceData.subtotal) || 0;
  const headerTax = parseFloat(invoiceData.tax) || 0;
  const totalAmount = parseFloat(invoiceData.total_amount) || subtotal + headerTax;

  // Always use Standard (20%) tax band — iPlicit calculates tax automatically
  const createDetails = lineItemsWithProducts.map((item) => {
    const netAmount = parseFloat(item.line_total) || 0;
    const quantity = parseFloat(item.quantity) || 1;

    return {
      productId: item.productId || null,
      accountId: item.platform_account_id || item.account_code || null,
      description: item.description || 'Line item',
      netAmount: netAmount,
      netCurrencyAmount: netAmount,
      quantity: quantity,
      taxBandId: 'S',
    };
  });

  // Build Iplicit invoice payload — let iPlicit calculate tax from bands
  const iplicitInvoice = {
    docTypeId: 'APDI',
    legalEntityId: legalEntityId || null,
    contactAccountId: contactAccountId,
    description: 'Invoice from - ' + invoiceData.vendor_name,
    taxDate: formatDateForIplicit(invoiceData.invoice_date) || formatDateForIplicit(new Date()),
    dueDate: formatDateForIplicit(invoiceData.due_date),
    currency: invoiceData.currency || 'GBP',
    docClass: 'PurchaseInvoice',
    details: createDetails,
  };

  if (invoiceData.invoice_number) {
    iplicitInvoice.extRef = invoiceData.invoice_number;
  }

  console.log('[IplicitInvoiceService] Creating invoice:', {
    invoiceId,
    domain: connection.client_id,
    connectionId: connection.id,
    connectionUsername: connection.username,
    explicitConnectionId,
    mappedConnectionId: connectionId,
    invoiceLocationId: dbInvoice.location_id,
    iplicitInvoice,
  });

  // Create invoice in Iplicit
  const iplicitResponse = await createPurchaseInvoice(
    connection.client_id,
    sessionToken,
    iplicitInvoice
  );

  // Extract Iplicit invoice ID from response
  const iplicitInvoiceId = iplicitResponse || iplicitResponse?.invoiceId || iplicitResponse?.docId || null;

  // Create share_at JSON with supplier info
  const shareAtData = JSON.stringify({
    supplier_id: contactAccountId,
    share_date: new Date().toISOString(),
  });

  // Update local invoice with Iplicit reference
  const updateData = {
    platform_invoice_id: iplicitInvoiceId,
    platform_integration_id: connection.id,
    platform_integration_organization_id: platformOrgId,
    platform_name: 'iplicit',
    platform_status: invoiceData.status || 'DRAFT',
    status: 'approved',
    shared_at: dbInvoice.shared_at || new Date().toISOString(),
    share_at: shareAtData,
    updated_at: new Date().toISOString(),
  };

  if (invoiceData.status === 'PAID') {
    updateData.paid_at = new Date().toISOString();
    updateData.status = 'paid';
  }

  await supabaseAdmin
    .from('accounts_payable_invoice')
    .update(updateData)
    .eq('id', invoiceId);

  return {
    success: true,
    iplicitInvoiceId,
    platformInvoiceId: iplicitInvoiceId,
    data: iplicitResponse,
    existingSupplier: existingSupplier,
    contactAccountId: contactAccountId,
  };
}

/**
 * Update a purchase invoice in Iplicit
 * @param {string} invoiceId - accounts_payable_invoice.id
 * @param {object} invoiceData - Invoice data from frontend
 * @returns {Promise<object>} - Result with iplicitInvoiceId
 */
async function updateInvoice(invoiceId, invoiceData, explicitConnectionId = null) {
  // Get the invoice from database
  const { data: dbInvoice, error: invoiceError } = await supabaseAdmin
    .from('accounts_payable_invoice')
    .select('id, organization_id, location_id, user_id, platform_invoice_id, share_at')
    .eq('id', invoiceId)
    .single();

  if (invoiceError || !dbInvoice) {
    throw new Error('Invoice not found');
  }

  if (!dbInvoice.platform_invoice_id) {
    throw new Error('Invoice has not been shared to Iplicit yet');
  }

  const organizationId = dbInvoice.organization_id;
  const userId = dbInvoice.user_id;

  // Get platform organization mapping based on location (determines which iplicit connection to use)
  let legalEntityId = null;
  let mappedConnectionId = null;

  if (dbInvoice.location_id) {
    // Get ALL mappings for this location, then pick the iplicit one
    const { data: mappings } = await supabaseAdmin
      .from('platform_integration_organization_mapping')
      .select('platform_integration_organizations_id, platform_integration_id')
      .eq('location_id', dbInvoice.location_id)
      .eq('organization_id', organizationId);

    if (mappings && mappings.length > 0) {
      // Get all iplicit connection IDs for this org
      const { data: iplicitConns } = await supabaseAdmin
        .from('platform_integrations')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('platform_name', 'iplicit');

      const iplicitConnIds = new Set((iplicitConns || []).map(c => c.id));

      // Pick the mapping whose platform_integration_id is an iplicit connection
      const iplicitMapping = mappings.find(m => iplicitConnIds.has(m.platform_integration_id));
      const mapping = iplicitMapping || mappings[0];

      mappedConnectionId = mapping.platform_integration_id || null;

      if (mapping.platform_integration_organizations_id) {
        const { data: platformOrg } = await supabaseAdmin
          .from('platform_integration_organizations')
          .select('platform_org_id')
          .eq('id', mapping.platform_integration_organizations_id)
          .maybeSingle();

        legalEntityId = platformOrg?.platform_org_id || null;
      }

      console.log(`[IplicitInvoiceService] Update: Location ${dbInvoice.location_id} mapped to connection ${mappedConnectionId}`);
    }
  }

  // Get Iplicit connection — priority: explicitConnectionId > mapped connectionId > first connected
  const resolvedConnectionId = explicitConnectionId || mappedConnectionId;

  let connectionQuery = supabaseAdmin
    .from('platform_integrations')
    .select('id, client_id, username, client_secret, access_token, token_expires_at')
    .eq('organization_id', organizationId)
    .eq('platform_name', 'iplicit')
    .eq('is_connected', true);

  if (resolvedConnectionId) {
    connectionQuery = connectionQuery.eq('id', resolvedConnectionId);
  }

  const { data: connections, error: connError } = await connectionQuery.limit(1);
  const connection = connections?.[0] || null;

  console.log(`[IplicitInvoiceService] Update: Resolved connection: explicit=${explicitConnectionId}, mapped=${mappedConnectionId}, using=${connection?.id}`);

  if (connError || !connection) {
    throw new Error('Iplicit integration not found or not connected');
  }

  // Get or refresh session token
  const { sessionToken } = await getOrRefreshSession(
    connection.id,
    connection.client_id,
    connection.username,
    connection.client_secret,
    connection.access_token,
    connection.token_expires_at
  );

  // Fetch existing invoice from Iplicit to get line item IDs
  const existingIplicitInvoice = await fetchPurchaseInvoice(
    connection.client_id,
    sessionToken,
    dbInvoice.platform_invoice_id
  );

  // Log header-level tax fields to discover correct field names
  const headerTaxFields = {};
  if (existingIplicitInvoice) {
    for (const key of Object.keys(existingIplicitInvoice)) {
      if (key.toLowerCase().includes('tax') || key.toLowerCase().includes('amount') || key.toLowerCase().includes('net') || key.toLowerCase().includes('gross') || key.toLowerCase().includes('explicit') || key.toLowerCase().includes('rate')) {
        headerTaxFields[key] = existingIplicitInvoice[key];
      }
    }
  }
  console.log('[IplicitInvoiceService] iPlicit header tax fields:', JSON.stringify(headerTaxFields, null, 2));

  // Log ALL fields of the first line item to discover correct field names for tax
  const existingDetails = existingIplicitInvoice?.details || [];
  if (existingDetails.length > 0) {
    console.log('[IplicitInvoiceService] FULL first line item from iPlicit:', JSON.stringify(existingDetails[0], null, 2));
    console.log('[IplicitInvoiceService] ALL line item tax fields:', existingDetails.map(d => {
      const taxFields = {};
      for (const key of Object.keys(d)) {
        if (key.toLowerCase().includes('tax') || key.toLowerCase().includes('rate') || key.toLowerCase().includes('band') || key.toLowerCase().includes('amount') || key.toLowerCase().includes('net') || key.toLowerCase().includes('gross') || key.toLowerCase().includes('explicit')) {
          taxFields[key] = d[key];
        }
      }
      return { description: d.description, ...taxFields };
    }));
  }

  // Get or create contact account for vendor (check DB first using lowercase)
  let contactAccountId = null;
  const vendorName = (invoiceData.vendor_name || '').trim();
  const vendorNameLower = vendorName.toLowerCase();

  if (vendorName) {
    console.log('[IplicitInvoiceService] Checking supplier (lowercase):', vendorNameLower);

    // Check iplicit_suppliers table first by company name (lowercase comparison)
    const { data: existingSuppliers } = await supabaseAdmin
      .from('iplicit_suppliers')
      .select('contact_account_id, company, contact_group_id, contact_group, contact_code')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .ilike('company', vendorNameLower)
      .not('contact_group_id', 'is', null)
      .not('contact_group', 'is', null)
      .not('contact_code', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1);

    const existingSupplier = existingSuppliers?.[0] || null;

    if (existingSupplier?.contact_account_id) {
      // Supplier exists in DB, use it
      contactAccountId = existingSupplier.contact_account_id;
      console.log('[IplicitInvoiceService] Using existing supplier from DB:', vendorName, contactAccountId);
    } else {
      // Supplier not in DB, create in Iplicit and save to DB
      try {
        console.log('[IplicitInvoiceService] Creating new supplier in Iplicit:', vendorName);
        const newContactId = await createContactAccount(connection.client_id, sessionToken, vendorName);
        contactAccountId = newContactId;
        console.log('[IplicitInvoiceService] Supplier created:', contactAccountId);

        // Save new supplier to iplicit_suppliers table
        await supabaseAdmin
          .from('iplicit_suppliers')
          .insert({
            organization_id: organizationId,
            user_id: userId,
            company: vendorName,
            contact_account_id: contactAccountId,
            platform_integration_id: connection.id,
          });
        console.log('[IplicitInvoiceService] Saved supplier to database:', vendorName);
      } catch (err) {
        console.error('[IplicitInvoiceService] Failed to create supplier:', err.message);
        // Fallback to existing invoice's contactAccountId
        contactAccountId = existingIplicitInvoice?.contactAccountId || null;
      }
    }
  } else {
    // No vendor name, use existing invoice's contactAccountId
    contactAccountId = existingIplicitInvoice?.contactAccountId || null;
  }

  // Build line items with IDs for update
  const updatedDetails = [];
  const newLineItems = invoiceData.line_items || [];
  const productCache = new Map(); // Cache for duplicate line items

  for (let i = 0; i < newLineItems.length; i++) {
    const item = newLineItems[i];
    const existingDetail = existingDetails[i] || null;

    // Get or create product - check DB by product_name first (using lowercase)
    const productName = (item.description || '').trim();
    const productNameLower = productName.toLowerCase();
    const productCode = generateProductCode(item.description);
    let productId = null;

    console.log('[IplicitInvoiceService] Processing line item:', i, 'Description:', productName, 'Code:', productCode);

    // Check cache first (for duplicate line items in same invoice)
    if (productCache.has(productNameLower)) {
      productId = productCache.get(productNameLower);
      console.log('[IplicitInvoiceService] Using cached product:', productNameLower, productId);
    } else {
      // Check iplicit_products table by product_name (lowercase comparison)
      console.log('[IplicitInvoiceService] Checking DB for product (lowercase):', productNameLower);
      const { data: dbProducts, error: dbError } = await supabaseAdmin
        .from('iplicit_products')
        .select('product_id, product_code, product_name')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .ilike('product_name', productNameLower)
        .limit(1);

      console.log('[IplicitInvoiceService] DB query result:', dbProducts, 'Error:', dbError);

      const existingProduct = dbProducts?.[0] || null;

      if (existingProduct?.product_id) {
        // Product exists in DB, use it
        productId = existingProduct.product_id;
        productCache.set(productNameLower, productId);
        console.log('[IplicitInvoiceService] Using existing product from DB:', productNameLower, productId);
      } else {
        // Product not in DB, create in Iplicit and save to DB
        console.log('[IplicitInvoiceService] Product not found in DB, creating new product...');
        try {
          const productData = {
            code: productCode,
            description: item.description || 'Product',
            purchase: {
              accountId: item.platform_account_id || null,
              isActive: true,
            },
          };

          console.log('[IplicitInvoiceService] Creating product in Iplicit:', JSON.stringify(productData));
          const newProduct = await createProduct(connection.client_id, sessionToken, productData);
          console.log('[IplicitInvoiceService] Iplicit createProduct response:', JSON.stringify(newProduct));
          productId = newProduct?.id || newProduct;
          productCache.set(productNameLower, productId);
          console.log('[IplicitInvoiceService] Product created with ID:', productId);

          // Save new product to iplicit_products table with product_name
          const { error: insertError } = await supabaseAdmin
            .from('iplicit_products')
            .insert({
              organization_id: organizationId,
              user_id: userId,
              platform_integration_id: connection.id,
              product_id: productId,
              product_code: productCode,
              product_name: productName,
            });

          if (insertError) {
            console.error('[IplicitInvoiceService] Failed to save product to DB:', insertError);
          } else {
            console.log('[IplicitInvoiceService] Saved product to database:', productName);
          }
        } catch (err) {
          console.error('[IplicitInvoiceService] Failed to create product:', err.message, err.stack);
        }
      }
    }

    updatedDetails.push({ item, productId, existingDetail });
  }

  // Calculate totals
  const subtotal = parseFloat(invoiceData.subtotal) || 0;
  const headerTax = parseFloat(invoiceData.tax) || 0;
  const totalAmount = parseFloat(invoiceData.total_amount) || subtotal + headerTax;

  // Always use Standard (20%) tax band — iPlicit calculates tax automatically
  const finalDetails = updatedDetails.map((d, idx) => {
    const { item, productId: pId, existingDetail } = d;
    const quantity = parseFloat(item.quantity) || 1;
    const unitPrice = parseFloat(item.unit_price) || parseFloat(item.line_total) / quantity;
    const netAmount = parseFloat(item.line_total) || 0;

    const lineItem = {
      productId: pId || existingDetail?.productId || null,
      accountId: item.platform_account_id || item.account_code || existingDetail?.accountId || null,
      description: item.description || 'Line item',
      netCurrencyAmount: netAmount,
      netAmount: netAmount,
      currencyUnitPrice: unitPrice,
      netCurrencyUnitPrice: unitPrice,
      quantity: quantity,
      taxBandId: 'S',
    };

    // Include existing line item ID for PATCH
    if (existingDetail?.id) {
      lineItem.id = existingDetail.id;
    }

    return lineItem;
  });

  // Simple PATCH — let iPlicit calculate tax from the tax bands
  const iplicitUpdatePayload = {
    docTypeId: 'APDI',
    legalEntityId: legalEntityId || existingIplicitInvoice?.legalEntityId || null,
    contactAccountId: contactAccountId,
    description: 'Invoice from - ' + invoiceData.vendor_name,
    taxDate: existingIplicitInvoice?.taxDate || formatDateForIplicit(invoiceData.invoice_date),
    dueDate: formatDateForIplicit(invoiceData.due_date),
    currency: invoiceData.currency || 'GBP',
    docClass: 'PurchaseInvoice',
    details: finalDetails,
  };

  if (invoiceData.invoice_number) {
    iplicitUpdatePayload.extRef = invoiceData.invoice_number;
  }

  console.log('[IplicitInvoiceService] Updating invoice via PATCH:', {
    invoiceId,
    platformInvoiceId: dbInvoice.platform_invoice_id,
    lineItems: finalDetails.map(d => ({ desc: d.description, net: d.netAmount, taxBandId: d.taxBandId })),
  });

  const iplicitResponse = await updatePurchaseInvoice(
    connection.client_id,
    sessionToken,
    dbInvoice.platform_invoice_id,
    iplicitUpdatePayload
  );

  // Update share_at JSON with new supplier info
  const shareAtData = JSON.stringify({
    supplier_id: contactAccountId,
    share_date: new Date().toISOString(),
  });

  // Update local invoice
  const updateData = {
    platform_status: invoiceData.status || 'DRAFT',
    share_at: shareAtData,
    updated_at: new Date().toISOString(),
  };

  if (invoiceData.status === 'PAID') {
    updateData.paid_at = new Date().toISOString();
    updateData.status = 'paid';
  }

  await supabaseAdmin
    .from('accounts_payable_invoice')
    .update(updateData)
    .eq('id', invoiceId);

  return {
    success: true,
    iplicitInvoiceId: dbInvoice.platform_invoice_id,
    platformInvoiceId: dbInvoice.platform_invoice_id,
    data: iplicitResponse,
    contactAccountId: contactAccountId,
  };
}

module.exports = {
  createInvoice,
  updateInvoice,
};
