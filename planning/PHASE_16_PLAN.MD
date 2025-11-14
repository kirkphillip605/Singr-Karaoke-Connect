# Singr Central API Backend - Phase 16

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Author:** kirkphillip605  
**Status:** In Development

---

## Phase 16: Analytics & Reporting

**Objective**: Build comprehensive analytics and reporting system leveraging processed request history data to provide insights for both admins and customers (as paid add-on feature).

### 16.1 Analytics Database Views and Functions

```sql
-- Migration: 016_analytics_reporting.sql

-- Create materialized view for daily request statistics
CREATE MATERIALIZED VIEW daily_request_stats AS
SELECT
  DATE(requested_at) AS date,
  v.customer_profile_id,
  v.id AS venue_id,
  v.name AS venue_name,
  COUNT(*) AS total_requests,
  COUNT(*) FILTER (WHERE processed = true) AS processed_requests,
  COUNT(DISTINCT singer_profile_id) AS unique_singers,
  COUNT(DISTINCT artist) AS unique_artists,
  COUNT(DISTINCT title) AS unique_songs
FROM requests r
JOIN venues v ON r.venue_id = v.id
GROUP BY DATE(requested_at), v.customer_profile_id, v.id, v.name;

CREATE UNIQUE INDEX idx_daily_stats_unique 
  ON daily_request_stats(date, customer_profile_id, venue_id);
CREATE INDEX idx_daily_stats_customer 
  ON daily_request_stats(customer_profile_id, date DESC);
CREATE INDEX idx_daily_stats_venue 
  ON daily_request_stats(venue_id, date DESC);

-- Refresh policy: Run daily at 1 AM UTC
COMMENT ON MATERIALIZED VIEW daily_request_stats IS 
  'Daily aggregated request statistics by venue. Refresh nightly via cron job.';

-- Song popularity aggregation
CREATE MATERIALIZED VIEW song_popularity_stats AS
SELECT
  r.artist,
  r.title,
  LOWER(r.artist || ' - ' || r.title) AS normalized_song,
  v.customer_profile_id,
  v.id AS venue_id,
  COUNT(*) AS request_count,
  COUNT(DISTINCT singer_profile_id) AS unique_requesters,
  COUNT(*) FILTER (WHERE processed = true) AS times_performed,
  MAX(requested_at) AS last_requested_at,
  MIN(requested_at) AS first_requested_at
FROM requests r
JOIN venues v ON r.venue_id = v.id
WHERE processed = true
GROUP BY r.artist, r.title, LOWER(r.artist || ' - ' || r.title), v.customer_profile_id, v.id;

CREATE INDEX idx_song_popularity_customer 
  ON song_popularity_stats(customer_profile_id, request_count DESC);
CREATE INDEX idx_song_popularity_venue 
  ON song_popularity_stats(venue_id, request_count DESC);
CREATE INDEX idx_song_popularity_normalized 
  ON song_popularity_stats(normalized_song, customer_profile_id);

-- Singer activity stats
CREATE MATERIALIZED VIEW singer_activity_stats AS
SELECT
  su.id AS singer_user_id,
  su.name AS singer_name,
  su.email AS singer_email,
  v.customer_profile_id,
  v.id AS venue_id,
  v.name AS venue_name,
  COUNT(*) AS total_requests,
  COUNT(*) FILTER (WHERE processed = true) AS requests_performed,
  COUNT(DISTINCT DATE(requested_at)) AS days_active,
  MAX(requested_at) AS last_request_at,
  MIN(requested_at) AS first_request_at
FROM requests r
JOIN singer_users su ON r.singer_profile_id = su.id
JOIN venues v ON r.venue_id = v.id
GROUP BY su.id, su.name, su.email, v.customer_profile_id, v.id, v.name;

CREATE INDEX idx_singer_activity_customer 
  ON singer_activity_stats(customer_profile_id, total_requests DESC);
CREATE INDEX idx_singer_activity_venue 
  ON singer_activity_stats(venue_id, total_requests DESC);
CREATE INDEX idx_singer_activity_singer 
  ON singer_activity_stats(singer_user_id, customer_profile_id);

-- Saved custom reports table
CREATE TABLE saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES singr_users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  report_type VARCHAR(50) NOT NULL, -- 'song_popularity', 'singer_activity', 'daily_stats', 'custom'
  filters JSONB DEFAULT '{}',
  columns JSONB DEFAULT '[]',
  sort_by JSONB DEFAULT '[]',
  is_public BOOLEAN DEFAULT false,
  schedule_cron VARCHAR(100), -- Optional: cron expression for scheduled reports
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_saved_reports_customer 
  ON saved_reports(customer_profile_id, created_at DESC);
CREATE INDEX idx_saved_reports_creator 
  ON saved_reports(created_by_user_id);
CREATE INDEX idx_saved_reports_type 
  ON saved_reports(report_type);

-- Report execution log
CREATE TABLE report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_report_id UUID REFERENCES saved_reports(id) ON DELETE SET NULL,
  executed_by_user_id UUID REFERENCES singr_users(id) ON DELETE SET NULL,
  report_type VARCHAR(50) NOT NULL,
  filters JSONB DEFAULT '{}',
  format VARCHAR(20) NOT NULL, -- 'json', 'csv', 'xlsx', 'pdf'
  row_count INTEGER,
  execution_time_ms INTEGER,
  file_url TEXT,
  file_size_bytes BIGINT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_report_executions_saved_report 
  ON report_executions(saved_report_id, created_at DESC);
CREATE INDEX idx_report_executions_user 
  ON report_executions(executed_by_user_id, created_at DESC);
CREATE INDEX idx_report_executions_expires 
  ON report_executions(expires_at) 
  WHERE expires_at IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_saved_reports_updated_at
  BEFORE UPDATE ON saved_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY daily_request_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY song_popularity_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY singer_activity_stats;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_analytics_views IS 
  'Refresh all analytics materialized views. Schedule to run daily at 1 AM UTC.';

-- Platform-wide analytics (admin only)
CREATE MATERIALIZED VIEW platform_analytics AS
SELECT
  COUNT(DISTINCT cp.id) AS total_customers,
  COUNT(DISTINCT cp.id) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM subscriptions s 
      WHERE s.customer_profile_id = cp.id 
      AND s.status IN ('active', 'trialing')
    )
  ) AS active_customers,
  COUNT(DISTINCT v.id) AS total_venues,
  COUNT(DISTINCT su.id) AS total_singers,
  COUNT(r.request_id) AS total_requests,
  COUNT(r.request_id) FILTER (WHERE r.processed = true) AS total_processed,
  COUNT(r.request_id) FILTER (
    WHERE r.requested_at >= CURRENT_DATE
  ) AS requests_today,
  COUNT(r.request_id) FILTER (
    WHERE r.requested_at >= DATE_TRUNC('month', CURRENT_DATE)
  ) AS requests_this_month
FROM customer_profiles cp
LEFT JOIN venues v ON v.customer_profile_id = cp.id
LEFT JOIN requests r ON r.venue_id = v.id
LEFT JOIN singer_users su ON r.singer_profile_id = su.id;

CREATE UNIQUE INDEX idx_platform_analytics_single_row 
  ON platform_analytics ((1));

COMMENT ON MATERIALIZED VIEW platform_analytics IS 
  'Platform-wide statistics for admin dashboard. Refresh hourly.';
```

### 16.2 Analytics Service

```typescript
// src/services/analytics-service.ts

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { Parser } from 'json2csv';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export interface ReportFilters {
  venueId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface CustomReportConfig {
  name: string;
  description?: string;
  reportType: 'song_popularity' | 'singer_activity' | 'daily_stats' | 'custom';
  filters: ReportFilters;
  columns?: string[];
  sortBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
}

export class AnalyticsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get daily request statistics
   */
  async getDailyStats(
    customerProfileId: string,
    filters: ReportFilters = {}
  ) {
    const { venueId, startDate, endDate, limit = 30, offset = 0 } = filters;

    const where: any = {
      customerProfileId,
    };

    if (venueId) {
      where.venueId = venueId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = startDate;
      }
      if (endDate) {
        where.date.lte = endDate;
      }
    }

    const [stats, total] = await Promise.all([
      this.prisma.$queryRaw`
        SELECT * FROM daily_request_stats
        WHERE customer_profile_id = ${customerProfileId}::uuid
        ${venueId ? this.prisma.$queryRaw`AND venue_id = ${venueId}::uuid` : this.prisma.$queryRaw``}
        ${startDate ? this.prisma.$queryRaw`AND date >= ${startDate}::date` : this.prisma.$queryRaw``}
        ${endDate ? this.prisma.$queryRaw`AND date <= ${endDate}::date` : this.prisma.$queryRaw``}
        ORDER BY date DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM daily_request_stats
        WHERE customer_profile_id = ${customerProfileId}::uuid
        ${venueId ? this.prisma.$queryRaw`AND venue_id = ${venueId}::uuid` : this.prisma.$queryRaw``}
        ${startDate ? this.prisma.$queryRaw`AND date >= ${startDate}::date` : this.prisma.$queryRaw``}
        ${endDate ? this.prisma.$queryRaw`AND date <= ${endDate}::date` : this.prisma.$queryRaw``}
      `,
    ]);

    return {
      stats,
      pagination: {
        total: Number(total[0].count),
        limit,
        offset,
        hasMore: offset + limit < Number(total[0].count),
      },
    };
  }

  /**
   * Get top songs by request count
   */
  async getTopSongs(
    customerProfileId: string,
    filters: ReportFilters & { venueId?: string } = {}
  ) {
    const { venueId, startDate, endDate, limit = 50 } = filters;

    let query = `
      SELECT
        artist,
        title,
        normalized_song,
        venue_id,
        venue_name,
        request_count,
        unique_requesters,
        times_performed,
        last_requested_at,
        first_requested_at
      FROM song_popularity_stats
      WHERE customer_profile_id = $1
    `;

    const params: any[] = [customerProfileId];
    let paramIndex = 2;

    if (venueId) {
      query += ` AND venue_id = $${paramIndex}`;
      params.push(venueId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND last_requested_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND last_requested_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY request_count DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const songs = await this.prisma.$queryRawUnsafe(query, ...params);

    return songs;
  }

  /**
   * Get most active singers
   */
  async getTopSingers(
    customerProfileId: string,
    filters: ReportFilters & { venueId?: string } = {}
  ) {
    const { venueId, startDate, endDate, limit = 50 } = filters;

    let query = `
      SELECT
        singer_user_id,
        singer_name,
        singer_email,
        venue_id,
        venue_name,
        total_requests,
        requests_performed,
        days_active,
        last_request_at,
        first_request_at
      FROM singer_activity_stats
      WHERE customer_profile_id = $1
    `;

    const params: any[] = [customerProfileId];
    let paramIndex = 2;

    if (venueId) {
      query += ` AND venue_id = $${paramIndex}`;
      params.push(venueId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND last_request_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND last_request_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY total_requests DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const singers = await this.prisma.$queryRawUnsafe(query, ...params);

    return singers;
  }

  /**
   * Get venue comparison statistics
   */
  async getVenueComparison(
    customerProfileId: string,
    filters: { startDate?: Date; endDate?: Date } = {}
  ) {
    const { startDate, endDate } = filters;

    let query = `
      SELECT
        venue_id,
        venue_name,
        SUM(total_requests) as total_requests,
        SUM(processed_requests) as processed_requests,
        AVG(unique_singers) as avg_unique_singers,
        MAX(date) as last_activity_date,
        MIN(date) as first_activity_date,
        COUNT(*) as days_with_activity
      FROM daily_request_stats
      WHERE customer_profile_id = $1
    `;

    const params: any[] = [customerProfileId];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` GROUP BY venue_id, venue_name ORDER BY total_requests DESC`;

    const venues = await this.prisma.$queryRawUnsafe(query, ...params);

    return venues;
  }

  /**
   * Get platform analytics (admin only)
   */
  async getPlatformAnalytics() {
    const stats = await this.prisma.$queryRaw`
      SELECT * FROM platform_analytics
    `;

    // Get top customers by request volume
    const topCustomers = await this.prisma.$queryRaw`
      SELECT
        cp.id,
        cp.business_name,
        su.email,
        COUNT(DISTINCT v.id) as venue_count,
        COUNT(r.request_id) as total_requests,
        COUNT(DISTINCT DATE(r.requested_at)) as active_days
      FROM customer_profiles cp
      JOIN singr_users su ON cp.singr_user_id = su.id
      LEFT JOIN venues v ON v.customer_profile_id = cp.id
      LEFT JOIN requests r ON r.venue_id = v.id
      WHERE EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.customer_profile_id = cp.id
        AND s.status IN ('active', 'trialing')
      )
      GROUP BY cp.id, cp.business_name, su.email
      ORDER BY total_requests DESC
      LIMIT 20
    `;

    // Get most popular songs across platform
    const topPlatformSongs = await this.prisma.$queryRaw`
      SELECT
        artist,
        title,
        SUM(request_count) as total_requests,
        COUNT(DISTINCT customer_profile_id) as customer_count,
        COUNT(DISTINCT venue_id) as venue_count
      FROM song_popularity_stats
      GROUP BY artist, title
      ORDER BY total_requests DESC
      LIMIT 50
    `;

    return {
      overview: stats,
      topCustomers,
      topPlatformSongs,
    };
  }

  /**
   * Save custom report configuration
   */
  async saveReport(
    customerProfileId: string,
    createdByUserId: string,
    config: CustomReportConfig
  ) {
    const report = await this.prisma.savedReport.create({
      data: {
        customerProfileId,
        createdByUserId,
        name: config.name,
        description: config.description,
        reportType: config.reportType,
        filters: config.filters as any,
        columns: config.columns || [],
        sortBy: config.sortBy || [],
      },
    });

    logger.info('Custom report saved', {
      reportId: report.id,
      customerProfileId,
      reportType: config.reportType,
    });

    return report;
  }

  /**
   * Get saved reports
   */
  async getSavedReports(customerProfileId: string) {
    const reports = await this.prisma.savedReport.findMany({
      where: { customerProfileId },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reports;
  }

  /**
   * Execute saved report
   */
  async executeReport(
    reportId: string,
    executedByUserId: string,
    format: 'json' | 'csv' | 'xlsx' | 'pdf' = 'json'
  ) {
    const report = await this.prisma.savedReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    const startTime = Date.now();

    // Fetch data based on report type
    let data: any[];

    switch (report.reportType) {
      case 'song_popularity':
        data = await this.getTopSongs(
          report.customerProfileId,
          report.filters as any
        );
        break;

      case 'singer_activity':
        data = await this.getTopSingers(
          report.customerProfileId,
          report.filters as any
        );
        break;

      case 'daily_stats':
        const result = await this.getDailyStats(
          report.customerProfileId,
          report.filters as any
        );
        data = result.stats;
        break;

      default:
        throw new Error('Unsupported report type');
    }

    const executionTime = Date.now() - startTime;

    // Generate file based on format
    let fileUrl: string | null = null;
    let fileSize: number | null = null;

    if (format !== 'json') {
      const result = await this.generateReportFile(
        data,
        format,
        report.name
      );
      fileUrl = result.url;
      fileSize = result.size;
    }

    // Log execution
    const execution = await this.prisma.reportExecution.create({
      data: {
        savedReportId: reportId,
        executedByUserId,
        reportType: report.reportType,
        filters: report.filters as any,
        format,
        rowCount: data.length,
        executionTimeMs: executionTime,
        fileUrl,
        fileSizeBytes: fileSize ? BigInt(fileSize) : null,
        expiresAt: fileUrl
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
          : null,
      },
    });

    logger.info('Report executed', {
      reportId,
      executionId: execution.id,
      format,
      rowCount: data.length,
      executionTimeMs: executionTime,
    });

    return {
      executionId: execution.id,
      data: format === 'json' ? data : null,
      fileUrl,
      fileSize,
      rowCount: data.length,
      executionTime,
    };
  }

  /**
   * Generate report file in requested format
   */
  private async generateReportFile(
    data: any[],
    format: 'csv' | 'xlsx' | 'pdf',
    reportName: string
  ): Promise<{ url: string; size: number }> {
    const uploadDir = process.env.UPLOAD_DIR || './uploads/reports';
    const filename = `${reportName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${format}`;
    const filepath = join(uploadDir, filename);

    switch (format) {
      case 'csv': {
        const parser = new Parser();
        const csv = parser.parse(data);
        await this.writeFile(filepath, csv);
        break;
      }

      case 'xlsx': {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, filepath);
        break;
      }

      case 'pdf': {
        await this.generatePDF(data, filepath, reportName);
        break;
      }
    }

    const stats = await this.getFileStats(filepath);

    return {
      url: `/uploads/reports/${filename}`,
      size: stats.size,
    };
  }

  /**
   * Generate PDF report
   */
  private async generatePDF(
    data: any[],
    filepath: string,
    reportName: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = createWriteStream(filepath);

      doc.pipe(stream);

      // Header
      doc
        .fontSize(20)
        .text(reportName, { align: 'center' })
        .moveDown();

      doc
        .fontSize(10)
        .text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' })
        .moveDown(2);

      // Table
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        const columnWidth = (doc.page.width - 100) / headers.length;

        // Headers
        doc.fontSize(8).font('Helvetica-Bold');
        headers.forEach((header, i) => {
          doc.text(
            header,
            50 + i * columnWidth,
            doc.y,
            { width: columnWidth, continued: i < headers.length - 1 }
          );
        });
        doc.moveDown();

        // Rows
        doc.font('Helvetica');
        data.slice(0, 50).forEach((row) => {
          const y = doc.y;
          headers.forEach((header, i) => {
            const value = row[header]?.toString() || '';
            doc.text(
              value.substring(0, 30),
              50 + i * columnWidth,
              y,
              { width: columnWidth, continued: i < headers.length - 1 }
            );
          });
          doc.moveDown(0.5);

          if (doc.y > doc.page.height - 100) {
            doc.addPage();
          }
        });

        if (data.length > 50) {
          doc
            .moveDown()
            .text(
              `... and ${data.length - 50} more rows. Download full data as CSV or XLSX.`,
              { align: 'center' }
            );
        }
      } else {
        doc.text('No data available for this report.', { align: 'center' });
      }

      doc.end();

      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  /**
   * Helper to write file
   */
  private writeFile(filepath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = createWriteStream(filepath);
      stream.write(content);
      stream.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  /**
   * Helper to get file stats
   */
  private async getFileStats(filepath: string): Promise<{ size: number }> {
    const fs = await import('fs/promises');
    const stats = await fs.stat(filepath);
    return { size: stats.size };
  }

  /**
   * Delete old report files
   */
  async cleanupExpiredReports() {
    const expired = await this.prisma.reportExecution.findMany({
      where: {
        fileUrl: { not: null },
        expiresAt: { lt: new Date() },
      },
    });

    let deletedCount = 0;

    for (const execution of expired) {
      if (execution.fileUrl) {
        try {
          const filepath = join(
            process.env.UPLOAD_DIR || './uploads/reports',
            execution.fileUrl.split('/').pop()!
          );
          const fs = await import('fs/promises');
          await fs.unlink(filepath);
          deletedCount++;
        } catch (error) {
          logger.warn('Failed to delete expired report file', {
            executionId: execution.id,
            fileUrl: execution.fileUrl,
            error,
          });
        }
      }
    }

    // Mark as cleaned up
    await this.prisma.reportExecution.updateMany({
      where: {
        id: { in: expired.map((e) => e.id) },
      },
      data: {
        fileUrl: null,
      },
    });

    logger.info('Cleaned up expired report files', { deletedCount });

    return deletedCount;
  }

  /**
   * Refresh materialized views
   */
  async refreshViews() {
    await this.prisma.$executeRaw`SELECT refresh_analytics_views()`;
    logger.info('Analytics materialized views refreshed');
  }
}
```

### 16.3 Analytics Routes

```typescript
// src/routes/v1/customer/analytics.ts

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AnalyticsService } from '../../../services/analytics-service';

const ReportFiltersSchema = z.object({
  venueId: z.string().uuid().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const SaveReportSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  reportType: z.enum(['song_popularity', 'singer_activity', 'daily_stats', 'custom']),
  filters: z.object({
    venueId: z.string().uuid().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
  columns: z.array(z.string()).optional(),
  sortBy: z
    .array(
      z.object({
        field: z.string(),
        direction: z.enum(['asc', 'desc']),
      })
    )
    .optional(),
});

const analyticsRoutes: FastifyPluginAsync = async (server) => {
  const analyticsService = new AnalyticsService(server.prisma);

  // All routes require authentication and customer context
  server.addHook('preHandler', server.authenticate);

  // Check for analytics feature access (could be premium feature)
  const checkAnalyticsAccess = async (request: any, reply: any) => {
    const customerProfileId = request.user.activeContext?.id;

    if (!customerProfileId || request.user.activeContext?.type !== 'customer') {
      return reply.code(403).send({
        type: 'authorization_denied',
        title: 'Customer Context Required',
      });
    }

    // TODO: Check if customer has analytics feature enabled
    // For now, require active subscription
    const hasActiveSubscription = await server.prisma.subscription.findFirst({
      where: {
        customerProfileId,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (!hasActiveSubscription) {
      return reply.code(403).send({
        type: 'feature_not_available',
        title: 'Analytics Feature Not Available',
        detail: 'Analytics requires an active subscription',
      });
    }
  };

  server.addHook('preHandler', checkAnalyticsAccess);

  // Get daily statistics
  server.get(
    '/analytics/daily-stats',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Get daily request statistics',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 30 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;
      const filters = ReportFiltersSchema.parse(request.query);

      const result = await analyticsService.getDailyStats(customerProfileId, filters);

      return reply.send(result);
    }
  );

  // Get top songs
  server.get(
    '/analytics/top-songs',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Get most requested songs',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;
      const filters = ReportFiltersSchema.parse(request.query);

      const songs = await analyticsService.getTopSongs(customerProfileId, filters);

      return reply.send({ songs });
    }
  );

  // Get top singers
  server.get(
    '/analytics/top-singers',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Get most active singers',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            venueId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;
      const filters = ReportFiltersSchema.parse(request.query);

      const singers = await analyticsService.getTopSingers(customerProfileId, filters);

      return reply.send({ singers });
    }
  );

  // Get venue comparison
  server.get(
    '/analytics/venue-comparison',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Compare venue performance',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;
      const { startDate, endDate } = request.query as {
        startDate?: Date;
        endDate?: Date;
      };

      const venues = await analyticsService.getVenueComparison(customerProfileId, {
        startDate,
        endDate,
      });

      return reply.send({ venues });
    }
  );

  // Save custom report
  server.post(
    '/analytics/reports',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Save custom report configuration',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name', 'reportType', 'filters'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 1000 },
            reportType: {
              type: 'string',
              enum: ['song_popularity', 'singer_activity', 'daily_stats', 'custom'],
            },
            filters: { type: 'object' },
            columns: { type: 'array', items: { type: 'string' } },
            sortBy: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  direction: { type: 'string', enum: ['asc', 'desc'] },
                },
              },
            },
          },
        },
        response: {
          201: {
            description: 'Report saved',
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              reportType: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;
      const config = SaveReportSchema.parse(request.body);

      const report = await analyticsService.saveReport(
        customerProfileId,
        request.user.id,
        config
      );

      return reply.code(201).send({
        id: report.id,
        name: report.name,
        reportType: report.reportType,
        createdAt: report.createdAt,
      });
    }
  );

  // Get saved reports
  server.get(
    '/analytics/reports',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Get saved custom reports',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const customerProfileId = request.user.activeContext!.id;

      const reports = await analyticsService.getSavedReports(customerProfileId);

      return reply.send({ reports });
    }
  );

  // Execute saved report
  server.post(
    '/analytics/reports/:reportId/execute',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Execute saved report',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            reportId: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              enum: ['json', 'csv', 'xlsx', 'pdf'],
              default: 'json',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { reportId } = request.params as { reportId: string };
      const { format = 'json' } = request.query as { format?: 'json' | 'csv' | 'xlsx' | 'pdf' };

      const result = await analyticsService.executeReport(
        reportId,
        request.user.id,
        format
      );

      return reply.send(result);
    }
  );
};

export default analyticsRoutes;
```

---
