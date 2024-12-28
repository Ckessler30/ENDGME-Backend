import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      this.logger.error(
        'Supabase URL and Key must be provided in environment variables.',
      );
      throw new Error(
        'Supabase URL and Key must be provided in environment variables.',
      );
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logger.log('Supabase client created');
  }

  getClient(): SupabaseClient {
    return this.supabase;
  }
}
