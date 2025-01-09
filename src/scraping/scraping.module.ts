import { Module } from '@nestjs/common';
import { ScrapingController } from './scraping.controller';
import { ScrapingService } from './scraping.service';
import { SupabaseService } from 'src/supabase/supabase.service';

@Module({
  controllers: [ScrapingController],
  providers: [ScrapingService, SupabaseService],
})
export class ScrapingModule {}
