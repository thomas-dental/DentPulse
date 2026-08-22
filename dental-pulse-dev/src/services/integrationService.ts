/**
 * Reusable Integration Service
 * This service handles all integration API calls (like cURL)
 * You can call these functions from anywhere in the application
 */

export interface IntegrationApiRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  apiKey?: string;
  timeout?: number;
}

export interface IntegrationApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

/**
 * Generic API call function for integrations
 * Similar to cURL - reusable for any integration API call
 */
export async function callIntegrationApi<T = any>(
  request: IntegrationApiRequest
): Promise<IntegrationApiResponse<T>> {
  const {
    endpoint,
    method = 'GET',
    headers = {},
    body,
    apiKey,
    timeout = 30000, // 30 seconds default
  } = request;

  try {
    // Prepare headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Add API key if provided
    if (apiKey) {
      // Use Bearer token for Authorization header (standard for most APIs)
      requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Make the API call
    const response = await fetch(endpoint, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Parse response
    let data: T;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text as any;
    }

    // Check for error in response body (even if status is 200)
    if (data && typeof data === 'object' && 'error' in data) {
      const errorData = (data as any).error;
      return {
        success: false,
        error: errorData.message || errorData.type || 'API Error',
        status: response.status,
        data,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `API Error: ${response.status} ${response.statusText}`,
        status: response.status,
        data,
      };
    }

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timeout',
      };
    }

    return {
      success: false,
      error: error.message || 'Unknown error occurred',
    };
  }
}

/**
 * Test integration connection
 * Verifies if API key and endpoint are valid
 */
export async function testIntegrationConnection(
  endpoint: string,
  apiKey: string
): Promise<IntegrationApiResponse> {
  // Try a simple health check or auth endpoint
  // Adjust the test endpoint based on integration type
  const testEndpoint = endpoint.endsWith('/') 
    ? `${endpoint}health` 
    : `${endpoint}/health`;

  return callIntegrationApi({
    endpoint: testEndpoint,
    method: 'GET',
    apiKey,
    timeout: 10000, // 10 seconds for connection test
  });
}

/**
 * Sync data from integration
 * Generic sync function that can be customized per integration
 */
export async function syncIntegrationData(
  endpoint: string,
  apiKey: string,
  syncType?: string,
  params?: Record<string, any>
): Promise<IntegrationApiResponse> {
  const syncEndpoint = endpoint.endsWith('/') 
    ? `${endpoint}sync` 
    : `${endpoint}/sync`;

  return callIntegrationApi({
    endpoint: syncEndpoint,
    method: 'POST',
    apiKey,
    body: {
      type: syncType,
      ...params,
    },
  });
}

// Integration-specific services are now in separate files:
// - src/services/integrations/dentallyService.ts
// - src/services/integrations/implicitService.ts
