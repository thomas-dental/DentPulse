import { useState, useCallback } from 'react';
import { PlaidService } from '@/services/plaidService';

export interface PlaidPerson {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  ownership_percent: number | null;
  status: 'pending' | 'in_progress' | 'verified' | 'failed' | 'manual_review';
  idv_completed_at: string | null;
}

export interface PlaidVerification {
  id: string;
  organization_id: string;
  legal_name: string | null;
  companies_house_number: string | null;
  trading_name: string | null;
  address: string | null;
  industry: string;
  kyb_status: 'pending' | 'checking' | 'verified' | 'review' | 'failed';
  kyb_verified_at: string | null;
  bank_status: 'pending' | 'linking' | 'matching' | 'matched' | 'mismatch';
  bank_institution_name: string | null;
  bank_account_mask: string | null;
  bank_holder_name: string | null;
  bank_match_score: number | null;
  overall_status: 'incomplete' | 'complete' | 'manual_review';
  completed_at: string | null;
  people: PlaidPerson[];
}

export function usePlaidOnboarding(orgId: string | undefined) {
  const [verification, setVerification] = useState<PlaidVerification | null>(null);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await PlaidService.getOnboardingState(orgId);
      setVerification(res.verification ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  return { verification, isLoading, error, fetchState, setVerification };
}
