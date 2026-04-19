import { create } from 'zustand';

export interface SlotState {
  vendor_id: string;
  barber_id: string | null;
  service_id: string;
  slot_start_unix: number;
}

interface BookingStore {
  // Slot Hold State
  hold_id: string | null;
  hold_expires_at: number | null;
  selected_slot: SlotState | null;
  
  // Actions
  setSlotHold: (hold_id: string, expires_at: number, slot: SlotState) => void;
  clearSlotHold: () => void;
}

export const useBookingStore = create<BookingStore>((set) => ({
  hold_id: null,
  hold_expires_at: null,
  selected_slot: null,

  setSlotHold: (hold_id, hold_expires_at, selected_slot) => set({
    hold_id,
    hold_expires_at,
    selected_slot
  }),

  clearSlotHold: () => set({
    hold_id: null,
    hold_expires_at: null,
    selected_slot: null
  }),
}));
