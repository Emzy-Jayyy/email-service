// src/email/services/template.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EmailTemplate } from '../types';
import { RedisService } from '../../shared/redis.service';

interface TemplateApiResponse {
  data: EmailTemplate;
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly TEMPLATE_SERVICE_URL =
    process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3004';
  private readonly CACHE_TTL = 3600; // Cache templates for 1 hour

  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
  ) {}

  async getTemplate(template_code: string): Promise<EmailTemplate | null> {
    const cacheKey = `template:${template_code}`;

    try {
      // Try to get from cache first
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.log(`📦 Template found in cache: ${template_code}`);
        return JSON.parse(cached) as EmailTemplate;
      }

      // Fetch from Template Service
      this.logger.log(`🔍 Fetching template from service: ${template_code}`);
      const response = await firstValueFrom(
        this.httpService.get<TemplateApiResponse>(
          `${this.TEMPLATE_SERVICE_URL}/api/v1/templates/${template_code}`,
          {
            timeout: 5000,
          },
        ),
      );

      const template: EmailTemplate = response.data.data;

      // Cache the template
      await this.redisService.set(
        cacheKey,
        JSON.stringify(template),
        this.CACHE_TTL,
      );

      return template;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to fetch template ${template_code}:`,
        errorMessage,
      );
      return null;
    }
  }

  renderTemplate(
    template: EmailTemplate,
    variables: Record<string, any>,
  ): { subject: string; html_body: string; text_body?: string } {
    try {
      // Validate required variables
      const missingVars = template.variables.filter(
        (varName) => !(varName in variables),
      );

      if (missingVars.length > 0) {
        this.logger.warn(
          `Missing template variables: ${missingVars.join(', ')}`,
        );
      }

      // Replace variables in template
      const subject = this.replaceVariables(template.subject, variables);
      const html_body = this.replaceVariables(template.html_body, variables);
      const text_body = template.text_body
        ? this.replaceVariables(template.text_body, variables)
        : undefined;

      return { subject, html_body, text_body };
    } catch (error) {
      this.logger.error('Failed to render template:', error);
      throw error;
    }
  }

  private replaceVariables(
    template: string,
    variables: Record<string, string | number | boolean>,
  ): string {
    let result = template;

    // Replace {{variable}} with actual values
    Object.keys(variables).forEach((key) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      const value = variables[key] ?? '';
      result = result.replace(regex, String(value));
    });

    // Remove any unreplaced variables
    result = result.replace(/{{\s*\w+\s*}}/g, '');

    return result;
  }

  async invalidateCache(template_code: string): Promise<void> {
    const cacheKey = `template:${template_code}`;
    await this.redisService.del(cacheKey);
    this.logger.log(`🗑️ Template cache invalidated: ${template_code}`);
  }
}
