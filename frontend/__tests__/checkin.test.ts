import { apiService, SafetyCheckin, StartCheckinPayload } from '../src/services/api';

describe('Dead Man\'s Switch & Duress PIN Services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('should call configurePins with authorization and body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Safety PINs updated successfully.',
        data: { hasSafetyPin: true, hasDuressPin: true },
      }),
    });

    const result = await apiService.configurePins('mock-jwt-token', '1234', '9999');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/checkins/pins'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-jwt-token',
        }),
        body: JSON.stringify({ safetyPin: '1234', duressPin: '9999' }),
      })
    );

    expect(result.success).toBe(true);
    expect(result.data?.hasSafetyPin).toBe(true);
    expect(result.data?.hasDuressPin).toBe(true);
  });

  it('should call startCheckin with duration and location details', async () => {
    const payload: StartCheckinPayload = {
      title: 'Walking Home',
      destination: 'Home',
      durationMinutes: 25,
      startLatitude: 6.9271,
      startLongitude: 79.8612,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'checkin-uuid-123',
          title: 'Walking Home',
          durationMinutes: 25,
          status: 'ACTIVE',
        },
      }),
    });

    const res = await apiService.startCheckin('mock-jwt-token', payload);

    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('ACTIVE');
    expect(res.data?.durationMinutes).toBe(25);
  });

  it('should handle covert duress response safely when duress PIN is entered', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Check-in confirmed. Safe arrival recorded.',
        covertDuress: true,
        data: {
          id: 'checkin-uuid-123',
          status: 'COMPLETED',
        },
      }),
    });

    const res = await apiService.resolveCheckin('mock-jwt-token', 'checkin-uuid-123', '9999');

    expect(res.success).toBe(true);
    expect(res.covertDuress).toBe(true);
    // Deceptive display status ensures an attacker looking over the shoulder is unaware
    expect(res.data?.status).toBe('COMPLETED');
  });

  it('should extend checkin timer duration', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        message: 'Check-in extended by 15 minutes.',
        data: {
          id: 'checkin-uuid-123',
          durationMinutes: 40,
        },
      }),
    });

    const res = await apiService.extendCheckin('mock-jwt-token', 'checkin-uuid-123', 15);
    expect(res.success).toBe(true);
    expect(res.data?.durationMinutes).toBe(40);
  });
});
