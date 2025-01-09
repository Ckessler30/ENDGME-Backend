import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error(
        'Supabase URL and Key must be provided in environment variables.',
      );
      throw new Error(
        'Supabase URL and Key must be provided in environment variables.',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    });
    this.logger.log('Supabase client created');
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }
}
