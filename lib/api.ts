/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { useQuery, useMutation } from '@tanstack/react-query';
import { SlotState } from './store';

// Setup Base Axios Instance
export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// --- API Functions ---

export const fetchAvailability = async (vendor_id: string, date_str: string) => {
  const { data } = await apiClient.get(`/marketplace/availability`, {
    params: { vendor_id, date: date_str }
  });
  return data; // Expected: TimeSlot[]
};

export const fetchTrustProfile = async (vendor_id: string) => {
  const { data } = await apiClient.get(`/vendors/${vendor_id}/trust-profile`);
  return data;
};

export const createSlotHold = async (payload: { vendor_id: string; barber_id?: string; slot_start_unix: number }) => {
  const { data } = await apiClient.post(`/marketplace/slot-hold`, payload);
  return data; // Expected: { hold_id: string, expires_at_unix: number }
};

export const fetchFeePreview = async (payload: { vendor_id: string; service_id: string; slot_start_unix: number }) => {
  const { data } = await apiClient.post(`/bookings/preview`, payload);
  return data; 
  /* Expected: { 
       service_price_paise: int, 
       platform_fee_paise: int, 
       tax_paise: int, 
       total_amount_paise: int 
     } 
  */
};

export const createCheckoutSession = async (payload: { hold_id: string; expected_price_paise: number }) => {
  const { data } = await apiClient.post(`/bookings/checkout`, payload);
  return data; // Expected: Razorpay order details and booking ID
};

export const fetchBookingStatus = async (booking_id: string) => {
  const { data } = await apiClient.get(`/bookings/${booking_id}/status`);
  return data;
};

// --- React Query Hooks ---

export const useAvailability = (vendor_id: string, date_str: string) => {
  return useQuery({
    queryKey: ['availability', vendor_id, date_str],
    queryFn: () => fetchAvailability(vendor_id, date_str),
    refetchInterval: 8000, // Poll every 8 seconds as per requirement
  });
};

export const useTrustProfile = (vendor_id: string) => {
  return useQuery({
    queryKey: ['trust-profile', vendor_id],
    queryFn: () => fetchTrustProfile(vendor_id),
  });
};

export const useFeePreview = (payload: { vendor_id: string; service_id: string; slot_start_unix: number } | null) => {
  return useQuery({
    queryKey: ['fee-preview', payload?.vendor_id, payload?.slot_start_unix],
    queryFn: () => fetchFeePreview(payload!),
    enabled: !!payload, // Only fetch if we have a selected slot
  });
};

export const useBookingStatusPoller = (booking_id: string | null) => {
  return useQuery({
    queryKey: ['booking-status', booking_id],
    queryFn: () => fetchBookingStatus(booking_id!),
    enabled: !!booking_id,
    refetchInterval: (query) => {
       // Stop polling if completed or cancelled
       if (query.state.data?.lifecycle_status === 'confirmed' || query.state.data?.lifecycle_status === 'completed' || query.state.data?.lifecycle_status === 'cancelled') {
         return false;
       }
       return 3000; // Poll every 3 seconds
    },
  });
};

// --- Admin API Functions ---
const getAdminHeaders = () => ({
  'X-Admin-Key': process.env.NEXT_PUBLIC_ADMIN_KEY || 'default-admin-key'
});

export const fetchAdminBookings = async () => {
  const { data } = await apiClient.get(`/admin/bookings`, { headers: getAdminHeaders() });
  return data;
};

export const retryAdminTransfer = async (salon_booking_id: string) => {
  const headers = { ...getAdminHeaders(), 'Idempotency-Key': crypto.randomUUID() };
  const { data } = await apiClient.post(`/admin/bookings/${salon_booking_id}/retry-transfer`, {}, { headers });
  return data;
};

export const cancelAdminBooking = async (salon_booking_id: string) => {
  const headers = { ...getAdminHeaders(), 'Idempotency-Key': crypto.randomUUID() };
  const { data } = await apiClient.post(`/admin/bookings/${salon_booking_id}/cancel`, { confirm: true }, { headers });
  return data;
};

export const flagAdminUser = async (user_id: string, reason: string, points_deduction: number = 50) => {
  const headers = { ...getAdminHeaders(), 'Idempotency-Key': crypto.randomUUID() };
  const { data } = await apiClient.post(`/admin/users/${user_id}/flag`, { reason, points_deduction }, { headers });
  return data;
};

export const useAdminBookings = () => {
  return useQuery({
    queryKey: ['admin-bookings'],
    queryFn: fetchAdminBookings,
    refetchInterval: 10000, // Poll every 10 seconds
  });
};
