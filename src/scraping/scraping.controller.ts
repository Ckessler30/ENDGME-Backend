import { Controller, Get } from '@nestjs/common';
import { ScrapingService } from './scraping.service';

@Controller('scraping')
export class ScrapingController {
  constructor(private readonly scrapingService: ScrapingService) {}

  @Get('news')
  async scrapeNews() {
    return this.scrapingService.scrapeNews();
  }

  @Get('heroes')
  async scrapeHeroes() {
    return this.scrapingService.scrapeHeroes();
  }

  @Get('lore')
  async scrapeHeroLoreAndStats() {
    return this.scrapingService.scrapeHeroLoreAndStats();
  }

  @Get('abilities')
  async scrapeHeroAbilities() {
    return this.scrapingService.scrapeHeroAbilities();
  }
}
