const { calculateDistance, calculateEstimatedFare } = require('../src/services/rideService');
const { calculateFare } = require('../src/services/tripService');

describe('Ride Service', () => {
  describe('calculateDistance', () => {
    it('should calculate distance between two points correctly', () => {
      // Bangalore MG Road to Koramangala (~5km)
      const lat1 = 12.9716;
      const lng1 = 77.5946;
      const lat2 = 12.9352;
      const lng2 = 77.6245;

      const distance = calculateDistance(lat1, lng1, lat2, lng2);
      
      expect(distance).toBeGreaterThan(4);
      expect(distance).toBeLessThan(6);
    });

    it('should return 0 for same coordinates', () => {
      const distance = calculateDistance(12.9716, 77.5946, 12.9716, 77.5946);
      expect(distance).toBe(0);
    });
  });

  describe('calculateEstimatedFare', () => {
    it('should calculate economy fare correctly', () => {
      const fare = calculateEstimatedFare(10, 'economy');
      // base (50) + 10km * 12/km = 50 + 120 = 170
      expect(fare).toBe(170);
    });

    it('should calculate premium fare correctly', () => {
      const fare = calculateEstimatedFare(10, 'premium');
      // base (100) + 10km * 18/km = 100 + 180 = 280
      expect(fare).toBe(280);
    });

    it('should calculate xl fare correctly', () => {
      const fare = calculateEstimatedFare(10, 'xl');
      // base (150) + 10km * 22/km = 150 + 220 = 370
      expect(fare).toBe(370);
    });

    it('should default to economy for unknown tier', () => {
      const fare = calculateEstimatedFare(10, 'unknown');
      expect(fare).toBe(170); // Same as economy
    });
  });
});

describe('Trip Service', () => {
  describe('calculateFare', () => {
    it('should calculate fare breakdown correctly', () => {
      const fare = calculateFare('economy', 10, 30, 1);

      expect(fare.baseFare).toBe(50);
      expect(fare.distanceFare).toBe(120); // 10 * 12
      expect(fare.timeFare).toBe(45); // 30 * 1.5
      expect(fare.surgeFare).toBe(0); // No surge
      expect(fare.surgeMultiplier).toBe(1);
      expect(fare.currency).toBe('INR');
    });

    it('should apply surge correctly', () => {
      const fare = calculateFare('economy', 10, 30, 1.5);

      const subtotal = 50 + 120 + 45; // 215
      const surgeFare = subtotal * 0.5; // 107.5
      
      expect(fare.surgeFare).toBe(107.5);
      expect(fare.surgeMultiplier).toBe(1.5);
    });

    it('should calculate taxes correctly', () => {
      const fare = calculateFare('economy', 10, 30, 1);

      const subtotal = 50 + 120 + 45; // 215
      const expectedTax = subtotal * 0.05; // 10.75
      
      expect(fare.taxes).toBe(10.75);
    });

    it('should calculate total correctly', () => {
      const fare = calculateFare('economy', 10, 30, 1);

      const subtotal = 50 + 120 + 45; // 215
      const taxes = subtotal * 0.05; // 10.75
      const expectedTotal = subtotal + taxes; // 225.75
      
      expect(fare.total).toBe(225.75);
    });
  });
});
