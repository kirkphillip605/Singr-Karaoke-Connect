/**
 * Unit tests for VenueService
 */

import { VenueService } from '../../../src/services/venue.service';
import { prisma } from '@singr/database';

describe('VenueService', () => {
  const venueService = new VenueService();
  let testCustomerProfileId: string;
  let testVenueId: string;

  beforeEach(async () => {
    // Create test customer profile
    const user = await prisma.user.create({
      data: {
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hash',
      },
    });

    const profile = await prisma.customerProfile.create({
      data: {
        userId: user.id,
        legalBusinessName: 'Test Business',
      },
    });

    testCustomerProfileId = profile.id;
  });

  describe('create', () => {
    it('should create a venue with auto-generated OpenKJ ID', async () => {
      const venue = await venueService.create(testCustomerProfileId, {
        name: 'Test Venue',
        urlName: 'test-venue',
        address: '123 Main St',
        city: 'Test City',
        state: 'NY',
        postalCode: '10001',
        latitude: 40.7128,
        longitude: -74.0060,
      });

      expect(venue).toHaveProperty('id');
      expect(venue.name).toBe('Test Venue');
      expect(venue.openkjVenueId).toBeGreaterThan(0);
      expect(venue.acceptingRequests).toBe(true);

      testVenueId = venue.id;
    });

    it('should reject duplicate urlName', async () => {
      await venueService.create(testCustomerProfileId, {
        name: 'First Venue',
        urlName: 'duplicate-url',
        address: '123 Main St',
        city: 'Test City',
        state: 'NY',
        postalCode: '10001',
      });

      await expect(
        venueService.create(testCustomerProfileId, {
          name: 'Second Venue',
          urlName: 'duplicate-url',
          address: '456 Other St',
          city: 'Test City',
          state: 'NY',
          postalCode: '10001',
        })
      ).rejects.toThrow();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create multiple venues
      for (let i = 1; i <= 5; i++) {
        await venueService.create(testCustomerProfileId, {
          name: `Venue ${i}`,
          urlName: `venue-${i}`,
          address: `${i} Main St`,
          city: 'Test City',
          state: 'NY',
          postalCode: '10001',
        });
      }
    });

    it('should list all venues for customer', async () => {
      const result = await venueService.list(testCustomerProfileId, {
        page: 1,
        limit: 10,
      });

      expect(result.venues).toHaveLength(5);
      expect(result.pagination.total).toBe(5);
    });

    it('should support pagination', async () => {
      const result = await venueService.list(testCustomerProfileId, {
        page: 1,
        limit: 2,
      });

      expect(result.venues).toHaveLength(2);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      const venue = await venueService.create(testCustomerProfileId, {
        name: 'Original Name',
        urlName: 'original-url',
        address: '123 Main St',
        city: 'Test City',
        state: 'NY',
        postalCode: '10001',
      });
      testVenueId = venue.id;
    });

    it('should update venue details', async () => {
      const updated = await venueService.update(
        testCustomerProfileId,
        testVenueId,
        {
          name: 'Updated Name',
          acceptingRequests: false,
        }
      );

      expect(updated.name).toBe('Updated Name');
      expect(updated.acceptingRequests).toBe(false);
      expect(updated.urlName).toBe('original-url'); // Unchanged
    });

    it('should reject update for non-existent venue', async () => {
      await expect(
        venueService.update(testCustomerProfileId, 'non-existent-id', {
          name: 'New Name',
        })
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      const venue = await venueService.create(testCustomerProfileId, {
        name: 'Delete Me',
        urlName: 'delete-me',
        address: '123 Main St',
        city: 'Test City',
        state: 'NY',
        postalCode: '10001',
      });
      testVenueId = venue.id;
    });

    it('should delete venue', async () => {
      await venueService.delete(testCustomerProfileId, testVenueId);

      // Verify deletion
      const venue = await prisma.venue.findUnique({
        where: { id: testVenueId },
      });
      expect(venue).toBeNull();
    });

    it('should reject delete for non-existent venue', async () => {
      await expect(
        venueService.delete(testCustomerProfileId, 'non-existent-id')
      ).rejects.toThrow();
    });
  });

  describe('publicSearch', () => {
    beforeEach(async () => {
      // Create venues in different cities
      await venueService.create(testCustomerProfileId, {
        name: 'NYC Venue',
        urlName: 'nyc-venue',
        address: '123 Broadway',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
        acceptingRequests: true,
      });

      await venueService.create(testCustomerProfileId, {
        name: 'LA Venue',
        urlName: 'la-venue',
        address: '456 Hollywood Blvd',
        city: 'Los Angeles',
        state: 'CA',
        postalCode: '90001',
        acceptingRequests: false,
      });
    });

    it('should search venues by city', async () => {
      const result = await venueService.publicSearch({
        city: 'New York',
        page: 1,
        limit: 10,
      });

      expect(result.venues).toHaveLength(1);
      expect(result.venues[0].city).toBe('New York');
    });

    it('should filter by accepting requests', async () => {
      const result = await venueService.publicSearch({
        acceptingRequests: true,
        page: 1,
        limit: 10,
      });

      expect(result.venues.every(v => v.acceptingRequests)).toBe(true);
    });

    it('should search by state', async () => {
      const result = await venueService.publicSearch({
        state: 'CA',
        page: 1,
        limit: 10,
      });

      expect(result.venues).toHaveLength(1);
      expect(result.venues[0].state).toBe('CA');
    });
  });
});
