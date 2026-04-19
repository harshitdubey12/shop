"use client";

import { useState } from 'react';
import { useAdminBookings, retryAdminTransfer, cancelAdminBooking, flagAdminUser } from '@/lib/api';
import { format } from 'date-fns';

export default function AdminDashboard() {
  const { data: bookings, isLoading, refetch } = useAdminBookings();
  const [filter, setFilter] = useState('all');

  const handleRetryTransfer = async (id: string) => {
    if (confirm('Retry Razorpay transfer for this booking?')) {
      await retryAdminTransfer(id);
      refetch();
    }
  };

  const handleCancelBooking = async (id: string) => {
    if (confirm('Force cancel this booking?')) {
      await cancelAdminBooking(id);
      refetch();
    }
  };

  const handleFlagUser = async (userId: string) => {
    const reason = prompt('Reason for flagging user:');
    if (reason) {
      await flagAdminUser(userId, reason, 50);
      alert('User flagged and 50 points deducted.');
    }
  };

  // Filter bookings based on selected status filter
  const filteredBookings = bookings?.filter((b: any) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return ['created', 'confirmed', 'pending_barber'].includes(b.lifecycle_status);
    if (filter === 'completed') return b.lifecycle_status === 'completed';
    if (filter === 'cancelled') return b.lifecycle_status === 'cancelled';
    if (filter === 'failed') return b.payment_state === 'TRANSFER_FAILED';
    return true;
  });

  const getPaymentBadgeColor = (status: string) => {
    switch(status) {
      case 'TRANSFER_COMPLETED': return 'bg-green-100 text-green-800 border-green-200';
      case 'PAYMENT_CAPTURED': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ORDER_CREATED': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'TRANSFER_FAILED': return 'bg-red-100 text-red-800 border-red-200';
      case 'CREATED': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getLifecycleBadgeColor = (status: string) => {
    switch(status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'confirmed': return 'bg-blue-100 text-blue-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      case 'no_show': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Operational Dashboard</h1>
          <button onClick={() => refetch()} className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 text-sm font-medium transition-colors">
            Refresh Data
          </button>
        </div>

        {/* Filters */}
        <div className="flex space-x-2 mb-6">
          {['all', 'pending', 'completed', 'cancelled', 'failed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking ID / Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User / Vendor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lifecycle</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Payment State</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">Loading bookings...</td>
                  </tr>
                ) : filteredBookings?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No bookings found for this filter.</td>
                  </tr>
                ) : (
                  filteredBookings?.map((b: any) => (
                    <tr key={b.salon_booking_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{b.salon_booking_id.substring(0, 8)}...</div>
                        <div className="text-sm text-gray-500">
                          {format(new Date(b.slot_start_unix * 1000), "MMM d, h:mm a")}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 font-medium">User: {b.user_id.substring(0, 6)}...</div>
                        <div className="text-sm text-gray-500">Vendor: {b.vendor_id.substring(0, 6)}...</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getLifecycleBadgeColor(b.lifecycle_status)}`}>
                          {b.lifecycle_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border ${getPaymentBadgeColor(b.payment_state)}`}>
                          {b.payment_state}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-3">
                          {b.lifecycle_status !== 'cancelled' && b.lifecycle_status !== 'completed' && (
                            <button onClick={() => handleCancelBooking(b.salon_booking_id)} className="text-red-600 hover:text-red-900">Cancel</button>
                          )}
                          {b.payment_state === 'TRANSFER_FAILED' && (
                            <button onClick={() => handleRetryTransfer(b.salon_booking_id)} className="text-blue-600 hover:text-blue-900 font-bold">Retry Transfer</button>
                          )}
                          <button onClick={() => handleFlagUser(b.user_id)} className="text-orange-600 hover:text-orange-900">Flag User</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
